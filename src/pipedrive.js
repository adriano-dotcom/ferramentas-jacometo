/**
 * JARVIS — Módulo Pipedrive API v2
 * Documentação: https://developers.pipedrive.com/docs/api/v1
 *
 * Regras críticas (SOUL.md):
 * - NUNCA deletar/arquivar deals, persons, organizations
 * - Labels são ENUM → sempre usar ID da opção
 * - Activities de cobrança → user_id 15830108
 * - Toda ação de escrita exige OK do Adriano antes
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/api/v2`;
const TOKEN    = process.env.PIPEDRIVE_API_TOKEN;
const OUT_DIR  = process.env.OUT_DIR || path.join(__dirname, '../../out/pipedrive');

// Mapa owner → label_option_id (conforme TOOLS.md)
export const LABEL_MAP = {
  443: '01 - Adriana',
  444: '02 - Leonardo',
  445: '03 - Garcia',
  446: '04 - Felipe',
  447: '05 - Barbara',
  448: '06 - Adriano',
  449: '07 - Alessandro',
  451: '08 - Jacometo seguros',
};

// User ID especial para atividades de cobrança
export const USER_COBRANCA = 15830108;

// ─── HTTP CLIENT ──────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: BASE_URL,
  params:  { api_token: TOKEN },
  timeout: 15000,
});

api.interceptors.response.use(
  r => r.data,
  e => { throw new Error(`Pipedrive API: ${e.response?.data?.error || e.message}`); }
);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function saveOutput(filename, content) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const filepath = path.join(OUT_DIR, filename);
  await fs.writeFile(filepath, content, 'utf8');
  return filepath;
}

// ─── DEALS ───────────────────────────────────────────────────────────────────

/**
 * Lista todos os deals abertos com paginação automática
 */
export async function getAllOpenDeals(limit = 500) {
  const deals = [];
  let cursor = null;

  do {
    const params = { status: 'open', limit: Math.min(limit, 500) };
    if (cursor) params.cursor = cursor;

    const res = await api.get('/deals', { params });
    deals.push(...(res.data || []));
    cursor = res.additional_data?.next_cursor || null;
  } while (cursor && deals.length < limit);

  return deals;
}

/**
 * Leads/deals criados hoje
 */
export async function getDealsHoje() {
  const res = await api.get('/deals', {
    params: {
      status:        'open',
      updated_since: `${today()}T00:00:00Z`,
      sort_by:       'add_time',
      sort_direction:'desc',
      limit:         100,
    }
  });

  // Filtra apenas os criados hoje (updated_since retorna atualizados também)
  const deals = (res.data || []).filter(d =>
    d.add_time?.startsWith(today())
  );

  return deals.map(d => ({
    id:           d.id,
    titulo:       d.title,
    valor:        d.value || 0,
    moeda:        d.currency,
    responsavel:  d.owner_id?.name || '—',
    owner_id:     d.owner_id?.id,
    pipeline_id:  d.pipeline_id,
    stage_id:     d.stage_id,
    label:        d.label,
    criado:       d.add_time,
    link:         `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/deal/${d.id}`,
  }));
}

/**
 * Deals sem atividade há mais de N horas
 */
export async function getDealsSemsAtividade(horasLimit = 48) {
  const deals = await getAllOpenDeals();
  const limite = new Date(Date.now() - horasLimit * 60 * 60 * 1000);

  return deals
    .filter(d => {
      const ultima = d.last_activity_date
        ? new Date(d.last_activity_date)
        : new Date(d.add_time);
      return ultima < limite;
    })
    .map(d => ({
      id:           d.id,
      titulo:       d.title,
      responsavel:  d.owner_id?.name || '—',
      owner_id:     d.owner_id?.id,
      ultima_ativ:  d.last_activity_date || d.add_time,
      horas_sem:    Math.round((Date.now() - new Date(d.last_activity_date || d.add_time)) / 3600000),
      link:         `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/deal/${d.id}`,
    }))
    .sort((a, b) => b.horas_sem - a.horas_sem);
}

/**
 * Resumo do funil por estágio
 */
export async function getFunilVendas() {
  const deals = await getAllOpenDeals();
  const funil = {};

  for (const d of deals) {
    const key = d.stage_id;
    if (!funil[key]) funil[key] = { stage_id: key, count: 0, valor_total: 0, deals: [] };
    funil[key].count++;
    funil[key].valor_total += d.value || 0;
    funil[key].deals.push({ id: d.id, titulo: d.title, valor: d.value });
  }

  return Object.values(funil).sort((a, b) => a.stage_id - b.stage_id);
}

/**
 * Atividade por vendedor (deals ativos)
 */
export async function getAtividadePorVendedor() {
  const deals = await getAllOpenDeals();
  const por_vendedor = {};

  for (const d of deals) {
    const nome = d.owner_id?.name || 'Sem dono';
    if (!por_vendedor[nome]) {
      por_vendedor[nome] = { deals: 0, valor: 0, sem_atividade: 0 };
    }
    por_vendedor[nome].deals++;
    por_vendedor[nome].valor += d.value || 0;
    if (!d.last_activity_date) por_vendedor[nome].sem_atividade++;
  }

  return por_vendedor;
}

/**
 * Deals com valor=0 em etapas avançadas (inconsistência)
 */
export async function getDealsValorZero(stageIdMinimo = 3) {
  const deals = await getAllOpenDeals();
  return deals
    .filter(d => (!d.value || d.value === 0) && d.stage_id >= stageIdMinimo)
    .map(d => ({
      id:          d.id,
      titulo:      d.title,
      responsavel: d.owner_id?.name || '—',
      stage_id:    d.stage_id,
      link:        `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/deal/${d.id}`,
    }));
}

/**
 * Deals sem label (inconsistência)
 */
export async function getDealsEmptyLabel() {
  const deals = await getAllOpenDeals();
  return deals
    .filter(d => !d.label)
    .map(d => ({
      id:          d.id,
      titulo:      d.title,
      owner_id:    d.owner_id?.id,
      responsavel: d.owner_id?.name || '—',
      link:        `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/deal/${d.id}`,
    }));
}

// ─── ACTIVITIES ───────────────────────────────────────────────────────────────

/**
 * Busca atividades abertas por vendedor
 */
export async function getAtividadesAbertas(ownerId = null) {
  const params = { done: false, limit: 200 };
  if (ownerId) params.owner_id = ownerId;

  const res = await api.get('/activities', { params });
  return (res.data || []).map(a => ({
    id:          a.id,
    tipo:        a.type,
    assunto:     a.subject,
    deal_id:     a.deal_id,
    owner_id:    a.owner_id,
    due_date:    a.due_date,
    due_time:    a.due_time,
    vencida:     a.due_date < today(),
  }));
}

/**
 * Cria activity em um deal (requer OK do Adriano)
 * Regra: cobrança → user_id = USER_COBRANCA
 */
export async function criarActivity({ deal_id, subject, type = 'task', due_date, due_time, note, owner_id, is_cobranca = false }) {
  const body = {
    subject,
    type,
    deal_id,
    due_date: due_date || today(),
    note,
    owner_id: is_cobranca ? USER_COBRANCA : owner_id,
  };
  if (due_time) body.due_time = due_time;

  const res = await api.post('/activities', body);
  return res.data;
}

// ─── NOTES ───────────────────────────────────────────────────────────────────

/**
 * Cria uma nota em um deal (para inconsistências)
 */
export async function criarNota({ deal_id, content }) {
  // Notes ainda usam API v1
  const res = await axios.post(
    `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/api/v1/notes`,
    { deal_id, content },
    { params: { api_token: TOKEN } }
  );
  return res.data?.data;
}

// ─── DEAL UPDATE ─────────────────────────────────────────────────────────────

/**
 * Atualiza label de um deal (ENUM → usar ID)
 * Requer OK do Adriano antes de chamar
 */
export async function updateDealLabel(dealId, labelOptionId) {
  if (!Object.keys(LABEL_MAP).includes(String(labelOptionId))) {
    throw new Error(`label_option_id inválido: ${labelOptionId}. Use: ${Object.keys(LABEL_MAP).join(', ')}`);
  }
  const res = await api.patch(`/deals/${dealId}`, { label: labelOptionId });
  return res.data;
}

// ─── WEBHOOKS ─────────────────────────────────────────────────────────────────

/**
 * Lista webhooks configurados
 */
export async function getWebhooks() {
  const res = await axios.get(
    `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/api/v1/webhooks`,
    { params: { api_token: TOKEN } }
  );
  return res.data?.data || [];
}

/**
 * Cria webhook para receber eventos em tempo real
 * Útil para notificar Jarvis quando novo deal entra
 */
export async function criarWebhook({ subscription_url, event_action, event_object }) {
  const res = await axios.post(
    `https://${process.env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/api/v1/webhooks`,
    { subscription_url, event_action, event_object },
    { params: { api_token: TOKEN } }
  );
  return res.data?.data;
}

// ─── RELATÓRIO DIÁRIO ────────────────────────────────────────────────────────

/**
 * Gera relatório completo do dia e salva em out/pipedrive/
 */
export async function gerarRelatorioDiario() {
  const [dealsHoje, semAtiv, valorZero, semLabel, porVendedor] = await Promise.all([
    getDealsHoje(),
    getDealsSemsAtividade(48),
    getDealsValorZero(),
    getDealsEmptyLabel(),
    getAtividadePorVendedor(),
  ]);

  const data = today();
  const lines = [
    `# Relatório Pipedrive — ${data}`,
    `Gerado: ${new Date().toISOString()}`,
    '',
    `## Deals novos hoje: ${dealsHoje.length}`,
    ...dealsHoje.map(d => `- [${d.titulo}](${d.link}) | R$ ${d.valor?.toLocaleString('pt-BR')} | ${d.responsavel}`),
    '',
    `## Sem atividade +48h: ${semAtiv.length}`,
    ...semAtiv.map(d => `- [${d.titulo}](${d.link}) | ${d.horas_sem}h | ${d.responsavel}`),
    '',
    `## Inconsistências — Valor=0 em etapa avançada: ${valorZero.length}`,
    ...valorZero.map(d => `- [${d.titulo}](${d.link}) | Stage ${d.stage_id} | ${d.responsavel}`),
    '',
    `## Inconsistências — Sem label: ${semLabel.length}`,
    ...semLabel.map(d => `- [${d.titulo}](${d.link}) | ${d.responsavel}`),
    '',
    `## Atividade por vendedor`,
    ...Object.entries(porVendedor).map(([nome, v]) =>
      `- **${nome}**: ${v.deals} deals | R$ ${v.valor?.toLocaleString('pt-BR')} | ${v.sem_atividade} sem atividade`
    ),
  ];

  const content = lines.join('\n');
  const filepath = await saveOutput(`pipedrive_${data}.md`, content);

  return {
    data,
    dealsHoje:   dealsHoje.length,
    semAtividade: semAtiv.length,
    inconsistencias: valorZero.length + semLabel.length,
    porVendedor,
    filepath,
    markdown: content,
  };
}

// ─── CONSISTÊNCIA CRM (cron 09:00) ───────────────────────────────────────────

/**
 * Roda verificação de consistência e cria notes/activities para inconsistências
 * Retorna lista de ações tomadas (para log)
 */
export async function rodarConsistenciaCRM({ criarNotas = false } = {}) {
  const [valorZero, semLabel] = await Promise.all([
    getDealsValorZero(),
    getDealsEmptyLabel(),
  ]);

  const acoes = [];

  // Cria notas nas inconsistências (se autorizado)
  if (criarNotas) {
    for (const deal of valorZero) {
      await criarNota({
        deal_id: deal.id,
        content: `⚠️ Inconsistência detectada pelo Jarvis (${today()}): VALOR=0 em etapa avançada (Stage ${deal.stage_id}). Por favor revisar.`
      });
      acoes.push({ tipo: 'nota', deal_id: deal.id, motivo: 'VALOR=0_EM_ETAPA_AVANCADA' });
    }
  }

  const filepath = await saveOutput(
    `consistencia_${today()}.md`,
    [
      `# Consistência CRM — ${today()}`,
      `## VALOR=0 em etapa avançada (${valorZero.length})`,
      ...valorZero.map(d => `- [${d.id}] ${d.titulo} — ${d.responsavel} — Stage ${d.stage_id} — ${d.link}`),
      `## Sem label (${semLabel.length})`,
      ...semLabel.map(d => `- [${d.id}] ${d.titulo} — ${d.responsavel} — ${d.link}`),
      `## Ações tomadas`,
      ...acoes.map(a => `- ${a.tipo} criada em deal ${a.deal_id}: ${a.motivo}`),
    ].join('\n')
  );

  return { valorZero, semLabel, acoes, filepath };
}
