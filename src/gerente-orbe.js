/**
 * JARVIS — Gerente Orbe Pet
 * ==========================
 * Gerente específico para Orbe Pet.
 * Mesmo formato do Gerente Jacometo, mas com:
 *   - Métricas de plano pet (MRR, churn, planos ativos)
 *   - Chatwoot próprio: crm.orbepet.com.br
 *   - TikTok como canal principal
 *   - Foco em assinatura recorrente (não ticket único)
 *
 * Loop Orbe:
 *   Meta/TikTok/Google → Lead → Chatwoot Orbe
 *     → Pipedrive Orbe → Plano ativado APet → MRR
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMPRESAS } from './empresas.js';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORBE = EMPRESAS.orbe;
const OUT_DIR = path.join(__dirname, '../../out/orbe');

// ─── HTTP CLIENT CHATWOOT ORBE ────────────────────────────────────────────────

function cwOrbe() {
  return axios.create({
    baseURL: `${ORBE.chatwoot.url}/api/v1/accounts/${ORBE.chatwoot.account_id}`,
    headers: { 'api_access_token': ORBE.chatwoot.token, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().split('T')[0]; }
function nDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
async function saveOutput(filename, content) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const fp = path.join(OUT_DIR, filename);
  await fs.writeFile(fp, content, 'utf8');
  return fp;
}
function brl(v) {
  return `R$ ${Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}`;
}

// ─── CHATWOOT ORBE — CONVERSAS ────────────────────────────────────────────────

export async function getConversasOrbeHoje() {
  const cw = cwOrbe();
  const res = await cw.get('/conversations', { params: { status: 'all', page: 1 } });
  const todas = res.data?.payload || [];
  const inicio = new Date(today() + 'T00:00:00');

  const hoje = todas.filter(c => new Date(c.created_at * 1000) >= inicio);

  // Identifica canal de origem (inbox)
  const porCanal = {
    whatsapp:  hoje.filter(c => String(c.inbox_id) === String(ORBE.chatwoot.inboxes.whatsapp)).length,
    site:      hoje.filter(c => String(c.inbox_id) === String(ORBE.chatwoot.inboxes.site)).length,
    instagram: hoje.filter(c => String(c.inbox_id) === String(ORBE.chatwoot.inboxes.instagram)).length,
    tiktok:    hoje.filter(c => String(c.inbox_id) === String(ORBE.chatwoot.inboxes.tiktok)).length,
  };

  return {
    total:      hoje.length,
    abertas:    hoje.filter(c => c.status === 'open').length,
    resolvidas: hoje.filter(c => c.status === 'resolved').length,
    pendentes:  hoje.filter(c => c.status === 'pending').length,
    por_canal:  porCanal,
    lista: hoje.map(c => ({
      id:       c.id,
      status:   c.status,
      contato:  c.meta?.sender?.name || '—',
      agente:   c.meta?.assignee?.name || 'Bot',
      inbox_id: c.inbox_id,
      link:     `${ORBE.chatwoot.url}/app/accounts/${ORBE.chatwoot.account_id}/conversations/${c.id}`,
    }))
  };
}

// ─── MÉTRICAS ESPECÍFICAS ORBE ────────────────────────────────────────────────

/**
 * Busca planos ativos na APet
 * Retorna MRR, planos por tipo, churn
 */
export async function getMetricasAPet() {
  if (!ORBE.apet.url || !ORBE.apet.api_key) {
    return { erro: 'APet não configurado — APET_API_URL e APET_API_KEY necessários' };
  }
  try {
    const res = await axios.get(`${ORBE.apet.url}/dashboard/summary`, {
      headers: { Authorization: `Bearer ${ORBE.apet.api_key}` },
      timeout: 10000,
    });
    return res.data;
  } catch (e) {
    return { erro: `APet API: ${e.message}` };
  }
}

/**
 * Calcula MRR estimado pelos deals ganhos no Pipedrive
 * (fallback quando APet não estiver configurado)
 */
export function calcularMRREstimado(dealsGanhos = []) {
  let mrr = 0;
  const por_plano = {};

  for (const deal of dealsGanhos) {
    mrr += deal.value || 0;
    const plano = deal.titulo?.split('—')?.[1]?.trim() || 'Desconhecido';
    if (!por_plano[plano]) por_plano[plano] = { count: 0, mrr: 0 };
    por_plano[plano].count++;
    por_plano[plano].mrr += deal.value || 0;
  }

  return { mrr, por_plano };
}

// ─── LOOP COMPLETO ORBE ───────────────────────────────────────────────────────

export async function analisarLoopOrbe({ metaDados, tiktokDados, googleDados, pipedriveDados }) {
  const conversas = await getConversasOrbeHoje().catch(() => null);
  const apet      = await getMetricasAPet().catch(() => ({ erro: 'indisponível' }));

  const investimento = {
    meta:   metaDados?.gasto_hoje   || 0,
    tiktok: tiktokDados?.gasto      || 0,
    google: googleDados?.gasto      || 0,
    total:  (metaDados?.gasto_hoje  || 0) + (tiktokDados?.gasto || 0) + (googleDados?.gasto || 0),
  };

  const leads = {
    meta:   metaDados?.leads_hoje   || 0,
    tiktok: tiktokDados?.leads      || 0,
    google: googleDados?.leads      || 0,
    total:  (metaDados?.leads_hoje  || 0) + (tiktokDados?.leads || 0) + (googleDados?.leads || 0),
  };

  const totalLeads   = leads.total;
  const atendimentos = conversas?.total || 0;
  const planos       = pipedriveDados?.dealsHoje || 0;
  const cpl          = totalLeads > 0 ? investimento.total / totalLeads : 0;
  const taxaConv     = totalLeads > 0 ? (planos / totalLeads) * 100 : 0;
  const taxaAtend    = totalLeads > 0 ? (atendimentos / totalLeads) * 100 : 0;
  const cpPlano      = planos > 0 ? investimento.total / planos : 0;

  // Alertas específicos Orbe
  const alertas = [];

  if (tiktokDados?.erro || !tiktokDados) {
    alertas.push({ nivel: 'ALTO', assunto: 'TikTok Orbe offline — token expirado', acao: 'Renovar TIKTOK_REFRESH_TOKEN urgente — TikTok é canal principal Orbe' });
  }

  if (cpl > ORBE.metas.cpl_max) {
    alertas.push({ nivel: 'ALTO', assunto: `CPL acima do limite: ${brl(cpl)} (meta: ${brl(ORBE.metas.cpl_max)})`, acao: 'Revisar segmentação de público ou pausar campanha mais cara' });
  }

  if (taxaConv < ORBE.metas.taxa_conv_min && totalLeads > 5) {
    alertas.push({ nivel: 'MÉDIO', assunto: `Taxa conv. ${taxaConv.toFixed(1)}% abaixo da meta (${ORBE.metas.taxa_conv_min}%)`, acao: 'Verificar qualidade do atendimento no Chatwoot Orbe' });
  }

  if (conversas?.pendentes > 5) {
    alertas.push({ nivel: 'MÉDIO', assunto: `${conversas.pendentes} conversas pendentes no Chatwoot`, acao: 'Acionar equipe de atendimento Orbe' });
  }

  // Recomendações
  const recomendacoes = [];

  if (leads.tiktok < leads.meta && investimento.tiktok > 0) {
    const cplTiktok = leads.tiktok > 0 ? investimento.tiktok / leads.tiktok : 999;
    const cplMeta   = leads.meta   > 0 ? investimento.meta   / leads.meta   : 999;
    if (cplTiktok > cplMeta * 1.5) {
      recomendacoes.push({
        tipo:     'ALOCAÇÃO',
        situacao: `TikTok CPL ${brl(cplTiktok)} vs Meta CPL ${brl(cplMeta)}`,
        opcao_a:  `Migrar 30% do budget TikTok para Meta (economia ~${brl(investimento.tiktok * 0.3 * 0.3)}/dia)`,
        opcao_b:  'Manter TikTok e testar novo criativo com duração <15s (melhor CTR no TikTok)',
        recomendacao: 'OPÇÃO B — TikTok tem audience diferente, vale otimizar antes de migrar',
      });
    }
  }

  return {
    empresa:       'orbe',
    periodo:       today(),
    investimento,
    leads,
    atendimentos,
    planos,
    cpl:           cpl.toFixed(2),
    taxa_conv:     taxaConv.toFixed(1) + '%',
    taxa_atend:    taxaAtend.toFixed(1) + '%',
    cp_plano:      cpPlano.toFixed(2),
    mrr_estimado:  planos * 89.82, // ticket médio estimado
    apet,
    conversas,
    alertas,
    recomendacoes,
  };
}

// ─── RELATÓRIO DIÁRIO ORBE ────────────────────────────────────────────────────

export async function gerarRelatorioOrbe({ metaDados, tiktokDados, googleDados, pipedriveDados }) {
  const loop = await analisarLoopOrbe({ metaDados, tiktokDados, googleDados, pipedriveDados });
  const data = today();

  const linhas = [
    `# Gerente Orbe Pet — ${data}`,
    `Gerado: ${new Date().toISOString()} | Modelo: OPUS`,
    '',
    `## 🔄 Loop Completo Orbe Pet`,
    `💰 Investido: ${brl(loop.investimento.total)} (Meta: ${brl(loop.investimento.meta)} | TikTok: ${brl(loop.investimento.tiktok)} | Google: ${brl(loop.investimento.google)})`,
    `📣 Leads: ${loop.leads.total} (Meta: ${loop.leads.meta} | TikTok: ${loop.leads.tiktok} | Google: ${loop.leads.google})`,
    `💬 Atendimentos: ${loop.atendimentos} (${loop.taxa_atend} dos leads)`,
    `🐾 Planos ativados: ${loop.planos} | Taxa conv: ${loop.taxa_conv}`,
    `💵 CPL médio: ${brl(loop.cpl)} | Custo/plano: ${brl(loop.cp_plano)}`,
    `📈 MRR estimado hoje: ${brl(loop.mrr_estimado)}`,
    '',
    `## 📊 Por Canal`,
    `- Meta Ads:  ${loop.leads.meta} leads | CPL ${brl(loop.investimento.meta > 0 && loop.leads.meta > 0 ? loop.investimento.meta / loop.leads.meta : 0)}`,
    `- TikTok:    ${loop.leads.tiktok} leads | CPL ${brl(loop.investimento.tiktok > 0 && loop.leads.tiktok > 0 ? loop.investimento.tiktok / loop.leads.tiktok : 0)}`,
    `- Google:    ${loop.leads.google} leads | CPL ${brl(loop.investimento.google > 0 && loop.leads.google > 0 ? loop.investimento.google / loop.leads.google : 0)}`,
    '',
    `## ⚠️ Alertas (${loop.alertas.length})`,
    loop.alertas.map(a => `[${a.nivel}] ${a.assunto}\n→ ${a.acao}`).join('\n\n') || '✅ Nenhum alerta.',
    '',
    `## 🧠 Recomendações`,
    loop.recomendacoes.map(r => [
      `**[${r.tipo}]** ${r.situacao}`,
      `A: ${r.opcao_a}`,
      `B: ${r.opcao_b}`,
      `→ ${r.recomendacao}`,
    ].join('\n')).join('\n\n') || '✅ Sem recomendações.',
    '',
    `→ out/orbe/gerente_orbe_${data}.md`,
  ];

  const content  = linhas.join('\n');
  const filepath = await saveOutput(`gerente_orbe_${data}.md`, content);
  return { loop, filepath, markdown: content };
}
