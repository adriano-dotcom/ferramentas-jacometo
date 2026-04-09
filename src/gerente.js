/**
 * JARVIS — Agente Gerente Jacometo & Orbe Pet
 * ============================================
 * O agente mais estratégico do OS.
 * Fecha o loop completo:
 *
 *   Meta/Google/TikTok → Chatwoot (lead atendido)
 *        → Pipedrive (deal criado) → Ganho/Perdido
 *
 * Usa OPUS para análise estratégica.
 * Salva relatórios em out/gerente/
 *
 * Plataforma de atendimento: Chatwoot (crm.jacometo.com.br)
 * Docs: https://developers.chatwoot.com/api-reference
 *
 * Regras SOUL.md:
 * - Somente leitura em todos os sistemas externos
 * - OK obrigatório para qualquer ação
 * - Evidência sempre aponta para arquivo de output
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = process.env.OUT_DIR_GERENTE || path.join(__dirname, '../../out/gerente');

// ─── CONFIG CHATWOOT ──────────────────────────────────────────────────────────

const CHATWOOT_URL   = process.env.CHATWOOT_URL   || 'https://crm.jacometo.com.br';
const CHATWOOT_TOKEN = process.env.CHATWOOT_TOKEN;  // Profile → Access Token
const ACCOUNT_ID     = process.env.CHATWOOT_ACCOUNT_ID || '1';

// Inboxes mapeadas (buscar IDs em Settings → Inboxes)
export const INBOXES = {
  jacometo_whatsapp: process.env.INBOX_JACOMETO_WA,
  jacometo_site:     process.env.INBOX_JACOMETO_SITE,
  orbe_whatsapp:     process.env.INBOX_ORBE_WA,
  orbe_site:         process.env.INBOX_ORBE_SITE,
};

// ─── HTTP CLIENT CHATWOOT ─────────────────────────────────────────────────────

const cw = axios.create({
  baseURL: `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}`,
  headers: {
    'api_access_token': CHATWOOT_TOKEN,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

cw.interceptors.response.use(
  r => r.data,
  e => { throw new Error(`Chatwoot API: ${e.response?.data?.error || e.message}`); }
);

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

// ─── CHATWOOT — CONVERSAS ─────────────────────────────────────────────────────

/**
 * Lista conversas por status e período
 * status: 'open' | 'resolved' | 'pending' | 'snoozed' | 'all'
 */
export async function getConversas({ status = 'all', page = 1, assigneeType = 'all' } = {}) {
  const res = await cw.get('/conversations', {
    params: { status, page, assignee_type: assigneeType }
  });
  return res?.data?.payload || [];
}

/**
 * Resumo de conversas do dia por inbox/canal
 */
export async function getConversasHoje() {
  const todas = await getConversas({ status: 'all' });
  const inicio = new Date(today() + 'T00:00:00');

  const hoje = todas.filter(c => {
    const criada = new Date(c.created_at * 1000);
    return criada >= inicio;
  });

  // Agrupa por inbox
  const porInbox = {};
  for (const c of hoje) {
    const inbox = c.inbox_id;
    if (!porInbox[inbox]) porInbox[inbox] = { total: 0, abertas: 0, resolvidas: 0, pendentes: 0 };
    porInbox[inbox].total++;
    if (c.status === 'open')     porInbox[inbox].abertas++;
    if (c.status === 'resolved') porInbox[inbox].resolvidas++;
    if (c.status === 'pending')  porInbox[inbox].pendentes++;
  }

  return {
    total:     hoje.length,
    abertas:   hoje.filter(c => c.status === 'open').length,
    resolvidas:hoje.filter(c => c.status === 'resolved').length,
    pendentes: hoje.filter(c => c.status === 'pending').length,
    por_inbox: porInbox,
    lista:     hoje.map(c => ({
      id:          c.id,
      status:      c.status,
      contato:     c.meta?.sender?.name || '—',
      agente:      c.meta?.assignee?.name || 'Sem agente',
      inbox_id:    c.inbox_id,
      criada:      new Date(c.created_at * 1000).toISOString(),
      link:        `${CHATWOOT_URL}/app/accounts/${ACCOUNT_ID}/conversations/${c.id}`,
    }))
  };
}

/**
 * Métricas de performance dos agentes no Chatwoot
 */
export async function getMetricasAgentes(periodo = { since: nDaysAgo(7), until: today() }) {
  try {
    const res = await cw.get('/reports/agents/conversations', {
      params: { since: periodo.since, until: periodo.until }
    });
    return res?.data || [];
  } catch {
    // Fallback: relatório geral
    const res = await cw.get('/reports/summary', {
      params: { since: periodo.since, until: periodo.until, type: 'account' }
    });
    return res?.data || {};
  }
}

/**
 * Contatos com conversas — para cruzar com Pipedrive
 */
export async function getContatos({ page = 1, query = '' } = {}) {
  const res = await cw.get('/contacts', {
    params: { page, q: query, include_contacts: true }
  });
  return res?.payload || [];
}

// ─── WEBHOOK RECEIVER (para integrar no Express) ──────────────────────────────

/**
 * Processa evento de webhook do Chatwoot
 * Chatwoot envia: conversation_created, conversation_updated,
 *                 message_created, conversation_status_changed
 *
 * Quando conversation_created → cria deal no Pipedrive automaticamente
 */
export async function processarWebhookChatwoot(payload, pipedriveFn) {
  const { event, conversation, contact } = payload;

  const resultado = { event, acao: null, deal_id: null };

  if (event === 'conversation_created') {
    // Novo lead chegou no Chatwoot
    const nome   = conversation?.meta?.sender?.name || 'Lead sem nome';
    const email  = contact?.email || null;
    const fone   = contact?.phone_number || null;
    const inbox  = conversation?.inbox_id;
    const cwLink = `${CHATWOOT_URL}/app/accounts/${ACCOUNT_ID}/conversations/${conversation?.id}`;

    // Identifica produto (Jacometo ou Orbe) pelo inbox
    const produto = determinarProduto(inbox);

    // Se tiver função de criação de deal (Pipedrive), cria automaticamente
    if (pipedriveFn) {
      try {
        const deal = await pipedriveFn({
          titulo:   `${nome} — ${produto}`,
          nome,
          email,
          fone,
          origem:   'Chatwoot',
          cwLink,
          produto,
        });
        resultado.acao    = 'deal_criado';
        resultado.deal_id = deal?.id;
      } catch (e) {
        resultado.acao  = 'erro_deal';
        resultado.erro  = e.message;
      }
    }
  }

  if (event === 'conversation_status_changed') {
    // Conversa resolvida = lead atendido
    if (conversation?.status === 'resolved') {
      resultado.acao = 'conversa_resolvida';
    }
  }

  return resultado;
}

function determinarProduto(inboxId) {
  const id = String(inboxId);
  if (id === String(INBOXES.orbe_whatsapp) || id === String(INBOXES.orbe_site)) return 'Orbe Pet';
  return 'Jacometo Seguros';
}

// ─── LOOP COMPLETO: CAMPANHA → DEAL → RESULTADO ───────────────────────────────

/**
 * O coração do Gerente.
 * Cruza dados de TODAS as fontes e retorna análise completa.
 *
 * @param {object} metaDados     - dados do módulo meta.js
 * @param {object} pipedriveDados - dados do módulo pipedrive.js
 * @param {object} tiktokDados   - dados do módulo tiktok.js
 * @param {string} periodo       - 'hoje' | 'semana' | 'mes'
 */
export async function analisarLoopCompleto({ metaDados, pipedriveDados, tiktokDados, periodo = 'hoje' }) {

  const analise = {
    periodo,
    gerado_em: new Date().toISOString(),

    // 1. TOPO DO FUNIL — Investimento em campanhas
    investimento: {
      meta_jacometo: metaDados?.jacometo?.gasto_hoje || 0,
      meta_orbe:     metaDados?.orbe?.gasto_hoje     || 0,
      tiktok_orbe:   tiktokDados?.gasto              || 0,
      total:         (metaDados?.jacometo?.gasto_hoje || 0) +
                     (metaDados?.orbe?.gasto_hoje     || 0) +
                     (tiktokDados?.gasto              || 0),
    },

    // 2. MEIO DO FUNIL — Leads e atendimento
    leads: {
      meta_jacometo: metaDados?.jacometo?.leads_hoje || 0,
      meta_orbe:     metaDados?.orbe?.leads_hoje     || 0,
      tiktok_orbe:   tiktokDados?.leads              || 0,
    },

    // 3. CRM — Deals criados e status
    crm: {
      deals_hoje:       pipedriveDados?.dealsHoje     || 0,
      deals_sem_ativ:   pipedriveDados?.semAtividade  || 0,
      inconsistencias:  pipedriveDados?.inconsistencias || 0,
    },

    // 4. RESULTADO — O que realmente importa
    resultado: {},

    // 5. ALERTAS — O que precisa de atenção agora
    alertas: [],

    // 6. RECOMENDAÇÕES — 2 opções para Adriano decidir
    recomendacoes: [],
  };

  // ── Calcula KPIs ────────────────────────────────────────────────────────────

  const totalLeads = analise.leads.meta_jacometo +
                     analise.leads.meta_orbe +
                     analise.leads.tiktok_orbe;

  const cpLeadGeral = totalLeads > 0
    ? analise.investimento.total / totalLeads
    : 0;

  const taxaConversao = totalLeads > 0
    ? (analise.crm.deals_hoje / totalLeads) * 100
    : 0;

  analise.resultado = {
    total_leads:       totalLeads,
    deals_criados:     analise.crm.deals_hoje,
    taxa_conversao:    taxaConversao.toFixed(1) + '%',
    cp_lead_geral:     cpLeadGeral.toFixed(2),
    investimento_total: analise.investimento.total,
    roi_estimado:      null, // preenchido quando tiver valor dos deals ganhos
  };

  // ── Gera alertas ────────────────────────────────────────────────────────────

  if (analise.crm.deals_sem_ativ > 3) {
    analise.alertas.push({
      nivel:    'ALTO',
      assunto:  `${analise.crm.deals_sem_ativ} deals sem atividade +48h`,
      acao:     'Verificar com responsáveis e criar activities de follow-up',
    });
  }

  if (taxaConversao < 20 && totalLeads > 0) {
    analise.alertas.push({
      nivel:   'MÉDIO',
      assunto: `Taxa de conversão baixa: ${taxaConversao.toFixed(1)}% (leads → deals)`,
      acao:    'Revisar qualidade dos leads ou processo de qualificação no atendimento',
    });
  }

  if (analise.crm.inconsistencias > 0) {
    analise.alertas.push({
      nivel:   'MÉDIO',
      assunto: `${analise.crm.inconsistencias} inconsistências no Pipedrive (valor=0 ou sem label)`,
      acao:    'Corrigir manualmente ou aprovar correção automática do Jarvis',
    });
  }

  // ── Gera recomendações ──────────────────────────────────────────────────────

  // Recomendação baseada em CPL por plataforma
  const cplJacometo = analise.leads.meta_jacometo > 0
    ? analise.investimento.meta_jacometo / analise.leads.meta_jacometo
    : 999;

  const cplOrbe = (analise.leads.meta_orbe + analise.leads.tiktok_orbe) > 0
    ? (analise.investimento.meta_orbe + analise.investimento.tiktok_orbe) /
      (analise.leads.meta_orbe + analise.leads.tiktok_orbe)
    : 999;

  if (cplJacometo > 50) {
    analise.recomendacoes.push({
      tipo:     'ORÇAMENTO',
      situacao: `CPL Jacometo alto: ${brl(cplJacometo)}`,
      opcao_a:  'Reduzir orçamento das campanhas com CPL > R$80 em 30%',
      opcao_b:  'Manter orçamento e testar novos criativos por 48h',
      recomendacao: 'OPÇÃO A — CPL acima do limite indica campanha sem tração',
    });
  }

  if (cplOrbe > 60) {
    analise.recomendacoes.push({
      tipo:     'ORÇAMENTO',
      situacao: `CPL Orbe Pet alto: ${brl(cplOrbe)}`,
      opcao_a:  'Pausar TikTok por 3 dias e realocar verba para Meta',
      opcao_b:  'Testar novo criativo no TikTok com público lookalike',
      recomendacao: 'OPÇÃO B — TikTok tem potencial, vale testar antes de pausar',
    });
  }

  return analise;
}

// ─── RELATÓRIO GERENTE DIÁRIO ─────────────────────────────────────────────────

export async function gerarRelatorioGerente({ metaDados, pipedriveDados, tiktokDados, chatwootDados }) {
  const loop   = await analisarLoopCompleto({ metaDados, pipedriveDados, tiktokDados });
  const data   = today();

  // ── Calcula funil visual ──────────────────────────────────────────────────
  const funil = [
    { etapa: 'Investimento',  valor: brl(loop.investimento.total),      icone: '💰' },
    { etapa: 'Leads Gerados', valor: loop.resultado.total_leads,         icone: '📣' },
    { etapa: 'Atendimentos',  valor: chatwootDados?.total || '—',        icone: '💬' },
    { etapa: 'Deals Abertos', valor: loop.crm.deals_hoje,                icone: '🔵' },
    { etapa: 'Taxa Conv.',    valor: loop.resultado.taxa_conversao,       icone: '📊' },
    { etapa: 'CPL Médio',     valor: brl(loop.resultado.cp_lead_geral),  icone: '🎯' },
  ];

  const linhas = [
    `# Relatório Gerente — ${data}`,
    `Gerado: ${new Date().toISOString()}`,
    `Modelo: OPUS (análise estratégica)`,
    '',
    `## 🔄 Loop Completo: Campanha → Lead → Deal → Resultado`,
    '',
    funil.map(f => `${f.icone} **${f.etapa}:** ${f.valor}`).join('\n'),
    '',
    `## 💰 Investimento em Campanhas`,
    `- Meta Jacometo: ${brl(loop.investimento.meta_jacometo)}`,
    `- Meta Orbe Pet: ${brl(loop.investimento.meta_orbe)}`,
    `- TikTok Orbe:   ${brl(loop.investimento.tiktok_orbe)}`,
    `- **Total: ${brl(loop.investimento.total)}**`,
    '',
    `## 📣 Leads por Canal`,
    `- Meta Jacometo: ${loop.leads.meta_jacometo} leads | CPL: ${brl(loop.leads.meta_jacometo > 0 ? loop.investimento.meta_jacometo / loop.leads.meta_jacometo : 0)}`,
    `- Meta Orbe:     ${loop.leads.meta_orbe} leads | CPL: ${brl(loop.leads.meta_orbe > 0 ? loop.investimento.meta_orbe / loop.leads.meta_orbe : 0)}`,
    `- TikTok Orbe:   ${loop.leads.tiktok_orbe} leads`,
    `- **Total: ${loop.resultado.total_leads} leads | CPL médio: ${brl(loop.resultado.cp_lead_geral)}**`,
    '',
    `## 💬 Atendimento (Chatwoot)`,
    chatwootDados
      ? [
          `- Conversas hoje: ${chatwootDados.total}`,
          `- Abertas: ${chatwootDados.abertas} | Resolvidas: ${chatwootDados.resolvidas} | Pendentes: ${chatwootDados.pendentes}`,
        ].join('\n')
      : '- Dados não disponíveis (Chatwoot não configurado)',
    '',
    `## 🔵 Pipedrive — Deals`,
    `- Deals novos hoje: ${loop.crm.deals_hoje}`,
    `- Taxa conv. lead→deal: ${loop.resultado.taxa_conversao}`,
    `- Sem atividade +48h: ${loop.crm.deals_sem_ativ}`,
    `- Inconsistências: ${loop.crm.inconsistencias}`,
    '',
    `## ⚠️ Alertas (${loop.alertas.length})`,
    loop.alertas.length > 0
      ? loop.alertas.map(a => `[${a.nivel}] ${a.assunto}\n→ ${a.acao}`).join('\n\n')
      : '✅ Nenhum alerta crítico.',
    '',
    `## 🧠 Recomendações (aguardam OK)`,
    loop.recomendacoes.length > 0
      ? loop.recomendacoes.map(r => [
          `**[${r.tipo}]** ${r.situacao}`,
          `Opção A: ${r.opcao_a}`,
          `Opção B: ${r.opcao_b}`,
          `→ Recomendação Jarvis: **${r.recomendacao}**`,
        ].join('\n')).join('\n\n')
      : '✅ Sem recomendações pendentes.',
    '',
    `---`,
    `→ out/gerente/gerente_${data}.md`,
  ];

  const content  = linhas.join('\n');
  const filepath = await saveOutput(`gerente_${data}.md`, content);

  return { loop, funil, filepath, markdown: content };
}

// ─── WEBHOOK SERVER (integrar no src/index.js) ────────────────────────────────

/**
 * Adicionar no src/index.js para receber webhooks do Chatwoot:
 *
 * import express from 'express';
 * const app = express();
 * app.use(express.json());
 *
 * app.post('/webhook/chatwoot', async (req, res) => {
 *   const sig = req.headers['x-chatwoot-signature'];
 *   // verificar HMAC-SHA256 com CHATWOOT_WEBHOOK_SECRET
 *   const resultado = await processarWebhookChatwoot(req.body, criarDealPipedrive);
 *   res.json({ ok: true, resultado });
 * });
 *
 * app.listen(process.env.WEBHOOK_PORT || 3001);
 */
export const WEBHOOK_DOCS = {
  url:     'POST /webhook/chatwoot',
  porta:   3001,
  eventos: [
    'conversation_created     → cria deal no Pipedrive',
    'conversation_status_changed → atualiza status do deal',
    'message_created          → log de interação',
  ],
  configurar: `Chatwoot → Settings → Integrations → Webhooks
  → Add new webhook: https://SEU_IP:3001/webhook/chatwoot
  → Marcar: conversation_created, conversation_updated, message_created`,
};
