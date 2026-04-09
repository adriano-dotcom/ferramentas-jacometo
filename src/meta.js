/**
 * JARVIS — Módulo Meta Marketing API
 * Docs: https://developers.facebook.com/docs/marketing-api/insights
 * Graph API v21.0
 *
 * Dois apps configurados:
 *   - App Jacometo → META_AD_ACCOUNT_JACOMETO + META_APP_TOKEN_JACOMETO
 *   - App Orbe Pet → META_AD_ACCOUNT_ORBE    + META_APP_TOKEN_ORBE
 *
 * Regras críticas (SOUL.md):
 *   - Somente leitura (READ ONLY) — NUNCA altera campanha sem OK do Adriano
 *   - Sugestões: sempre 2 opções + recomendação, depois pede OK
 *   - Outputs salvos em ~/jarvis-claude/out/meta/
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE    = `https://graph.facebook.com/${GRAPH_VERSION}`;
const OUT_DIR       = process.env.OUT_DIR_META || path.join(__dirname, '../../out/meta');

// ─── CONTAS CONFIGURADAS ──────────────────────────────────────────────────────

export const CONTAS = {
  jacometo: {
    nome:          'Jacometo Seguros',
    ad_account_id: process.env.META_AD_ACCOUNT_JACOMETO, // ex: act_123456789
    access_token:  process.env.META_APP_TOKEN_JACOMETO,  // token do App Jacometo
    app_id:        process.env.META_APP_ID_JACOMETO,
    app_secret:    process.env.META_APP_SECRET_JACOMETO,
  },
  orbe: {
    nome:          'Orbe Pet',
    ad_account_id: process.env.META_AD_ACCOUNT_ORBE,    // act_596420432003943
    access_token:  process.env.META_APP_TOKEN_ORBE,
    app_id:        process.env.META_APP_ID_ORBE,
    app_secret:    process.env.META_APP_SECRET_ORBE,
  }
};

// ─── HTTP CLIENT ──────────────────────────────────────────────────────────────

async function graphGet(path, params, token) {
  const res = await axios.get(`${GRAPH_BASE}/${path}`, {
    params: { access_token: token, ...params },
    timeout: 20000,
  });
  if (res.data?.error) throw new Error(`Meta API: ${res.data.error.message}`);
  return res.data;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0];
}

function nDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

async function saveOutput(filename, content) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const filepath = path.join(OUT_DIR, filename);
  await fs.writeFile(filepath, content, 'utf8');
  return filepath;
}

function brl(valor) {
  return `R$ ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

// ─── INSIGHTS POR CONTA ───────────────────────────────────────────────────────

/**
 * Insights resumidos de uma conta de anúncios
 * @param {string} conta - 'jacometo' | 'orbe'
 * @param {string} datePreset - 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d'
 */
export async function getInsightsConta(conta, datePreset = 'today') {
  const c = CONTAS[conta];
  if (!c) throw new Error(`Conta inválida: ${conta}`);

  // Insights API disponível em act_<AD_ACCOUNT_ID>/insights
  const data = await graphGet(
    `${c.ad_account_id}/insights`,
    {
      date_preset: datePreset,
      level:       'account',
      fields: [
        'spend',
        'impressions',
        'clicks',
        'ctr',
        'cpm',
        'cpc',
        'reach',
        'frequency',
        'actions',
        'cost_per_action_type',
        'date_start',
        'date_stop',
      ].join(','),
    },
    c.access_token
  );

  const d = data?.data?.[0] || {};

  // Extrai leads (action_type = lead ou onsite_conversion.lead_grouped)
  const actions     = d.actions || [];
  const leadAction  = actions.find(a =>
    a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
  );
  const leads       = leadAction ? Number(leadAction.value) : 0;
  const spend       = Number(d.spend || 0);
  const cpl         = leads > 0 ? spend / leads : 0;

  return {
    conta:       c.nome,
    periodo:     datePreset,
    data_inicio: d.date_start,
    data_fim:    d.date_stop,
    gasto:       spend,
    impressoes:  Number(d.impressions || 0),
    cliques:     Number(d.clicks || 0),
    ctr:         Number(d.ctr || 0).toFixed(2) + '%',
    cpm:         Number(d.cpm || 0).toFixed(2),
    cpc:         Number(d.cpc || 0).toFixed(2),
    alcance:     Number(d.reach || 0),
    leads,
    cpl:         cpl.toFixed(2),
    // raw para análise
    _actions:    actions,
    _raw:        d,
  };
}

// ─── CAMPANHAS ────────────────────────────────────────────────────────────────

/**
 * Lista campanhas ativas de uma conta com performance
 */
export async function getCampanhas(conta, datePreset = 'last_7d') {
  const c = CONTAS[conta];

  const data = await graphGet(
    `${c.ad_account_id}/campaigns`,
    {
      fields: [
        'id',
        'name',
        'status',
        'effective_status',
        'objective',
        'daily_budget',
        'lifetime_budget',
        `insights.date_preset(${datePreset}){spend,impressions,clicks,ctr,actions,cost_per_action_type,reach}`,
      ].join(','),
      limit: 50,
    },
    c.access_token
  );

  return (data?.data || []).map(camp => {
    const ins     = camp.insights?.data?.[0] || {};
    const actions = ins.actions || [];
    const leads   = actions.find(a => a.action_type === 'lead')?.value || 0;
    const spend   = Number(ins.spend || 0);

    return {
      id:              camp.id,
      nome:            camp.name,
      status:          camp.effective_status,
      objetivo:        camp.objective,
      orcamento_dia:   camp.daily_budget ? Number(camp.daily_budget) / 100 : null,
      orcamento_total: camp.lifetime_budget ? Number(camp.lifetime_budget) / 100 : null,
      gasto_periodo:   spend,
      impressoes:      Number(ins.impressions || 0),
      cliques:         Number(ins.clicks || 0),
      ctr:             Number(ins.ctr || 0).toFixed(2) + '%',
      alcance:         Number(ins.reach || 0),
      leads:           Number(leads),
      cpl:             leads > 0 ? (spend / Number(leads)).toFixed(2) : '—',
      link:            `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${c.ad_account_id.replace('act_','')}&selected_campaign_ids=${camp.id}`,
    };
  });
}

// ─── TOP E PIORES CAMPANHAS ───────────────────────────────────────────────────

export async function getTopCampanhas(conta, datePreset = 'last_7d', top = 3) {
  const campanhas = await getCampanhas(conta, datePreset);
  const ativas    = campanhas.filter(c => c.status === 'ACTIVE');

  const porCPL = [...ativas]
    .filter(c => c.leads > 0)
    .sort((a, b) => Number(a.cpl) - Number(b.cpl));

  const piorCPL = [...porCPL].reverse().slice(0, top);
  const melhorCPL = porCPL.slice(0, top);

  return {
    melhores: melhorCPL,
    piores:   piorCPL,
    total_ativas: ativas.length,
  };
}

// ─── ADSETS ──────────────────────────────────────────────────────────────────

export async function getAdSets(conta, campaignId, datePreset = 'last_7d') {
  const c = CONTAS[conta];

  const data = await graphGet(
    `${campaignId}/adsets`,
    {
      fields: [
        'id', 'name', 'status', 'effective_status',
        'daily_budget', 'bid_amount', 'targeting',
        `insights.date_preset(${datePreset}){spend,impressions,clicks,actions,reach}`,
      ].join(','),
    },
    c.access_token
  );

  return (data?.data || []).map(s => {
    const ins   = s.insights?.data?.[0] || {};
    const leads = ins.actions?.find(a => a.action_type === 'lead')?.value || 0;
    const spend = Number(ins.spend || 0);
    return {
      id:     s.id,
      nome:   s.name,
      status: s.effective_status,
      gasto:  spend,
      leads:  Number(leads),
      cpl:    leads > 0 ? (spend / Number(leads)).toFixed(2) : '—',
      alcance: Number(ins.reach || 0),
    };
  });
}

// ─── INSIGHTS 14 DIAS (relatório padrão do Jarvis) ───────────────────────────

export async function getRelatorio14d(conta) {
  const [hoje, ontem, ultimos7, ultimos14] = await Promise.all([
    getInsightsConta(conta, 'today'),
    getInsightsConta(conta, 'yesterday'),
    getInsightsConta(conta, 'last_7d'),
    getInsightsConta(conta, 'last_14d'),
  ]);

  const campanhas = await getCampanhas(conta, 'last_14d');
  const top       = await getTopCampanhas(conta, 'last_14d');

  return { hoje, ontem, ultimos7, ultimos14, campanhas, top };
}

// ─── META × CRM (cobertura de conversas) ─────────────────────────────────────

/**
 * Calcula GAP entre conversas iniciadas no Meta e inbounds no CRM
 * O CRM precisa expor endpoint próprio (Lovable/plataforma de atendimento)
 */
export async function calcularGapMetaCRM(conta, crmInboundHoje, crmAutoHoje) {
  const ins = await getInsightsConta(conta, 'today');

  // Conversas Meta = actions do tipo messaging_conversation_started_7d
  const metaConversas = ins._actions?.find(
    a => a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
  )?.value || ins.leads || 0;

  const gapCobertura = metaConversas - crmInboundHoje;
  const gapAuto      = metaConversas - crmAutoHoje;

  return {
    conta:            CONTAS[conta].nome,
    meta_conversas:   Number(metaConversas),
    crm_inbound:      crmInboundHoje,
    crm_auto_nina:    crmAutoHoje,
    gap_cobertura:    gapCobertura,
    gap_auto:         gapAuto,
    alerta_cobertura: gapCobertura > 5,
    alerta_auto:      gapAuto > 10,
  };
}

// ─── ALERTA GASTO ─────────────────────────────────────────────────────────────

/**
 * Verifica se gasto hoje está acima de % do orçamento diário
 * Retorna alerta se >= limitePercent
 */
export async function alertaGasto(conta, limitePercent = 80) {
  const ins       = await getInsightsConta(conta, 'today');
  const campanhas = await getCampanhas(conta, 'today');

  const orcamentoTotal = campanhas
    .filter(c => c.orcamento_dia)
    .reduce((sum, c) => sum + c.orcamento_dia, 0);

  const percentGasto = orcamentoTotal > 0
    ? (ins.gasto / orcamentoTotal) * 100
    : 0;

  const alerta = percentGasto >= limitePercent;

  return {
    conta:           CONTAS[conta].nome,
    gasto_hoje:      ins.gasto,
    orcamento_total: orcamentoTotal,
    percent_gasto:   percentGasto.toFixed(1) + '%',
    alerta,
    mensagem:        alerta
      ? `⚠️ ${CONTAS[conta].nome}: ${percentGasto.toFixed(0)}% do orçamento já gasto hoje (${brl(ins.gasto)} de ${brl(orcamentoTotal)})`
      : `✅ ${CONTAS[conta].nome}: gasto normal (${percentGasto.toFixed(0)}% — ${brl(ins.gasto)})`,
  };
}

// ─── RELATÓRIO DIÁRIO COMPLETO ────────────────────────────────────────────────

export async function gerarRelatorioDiarioMeta() {
  const [jacometo, orbe] = await Promise.all([
    getRelatorio14d('jacometo').catch(e => ({ erro: e.message })),
    getRelatorio14d('orbe').catch(e => ({ erro: e.message })),
  ]);

  const data = today();

  const linhas = [
    `# Relatório Meta Ads — ${data}`,
    `Gerado: ${new Date().toISOString()}`,
    '',
    `## Jacometo Seguros`,
    jacometo.erro ? `> ❌ Erro: ${jacometo.erro}` : [
      `### Hoje`,
      `- Gasto: ${brl(jacometo.hoje.gasto)} | Leads: ${jacometo.hoje.leads} | CPL: ${brl(jacometo.hoje.cpl)}`,
      `- CTR: ${jacometo.hoje.ctr} | CPM: R$ ${jacometo.hoje.cpm} | Alcance: ${jacometo.hoje.alcance?.toLocaleString('pt-BR')}`,
      '',
      `### Últimos 14 dias`,
      `- Gasto: ${brl(jacometo.ultimos14.gasto)} | Leads: ${jacometo.ultimos14.leads} | CPL: ${brl(jacometo.ultimos14.cpl)}`,
      '',
      `### Top campanhas (14d)`,
      ...(jacometo.top?.melhores || []).map(c => `✅ ${c.nome} — CPL ${brl(c.cpl)} | Leads: ${c.leads}`),
      '',
      `### Piores campanhas (14d)`,
      ...(jacometo.top?.piores || []).map(c => `⚠️ ${c.nome} — CPL ${brl(c.cpl)} | Leads: ${c.leads}`),
    ].join('\n'),
    '',
    `## Orbe Pet`,
    orbe.erro ? `> ❌ Erro: ${orbe.erro}` : [
      `### Hoje`,
      `- Gasto: ${brl(orbe.hoje.gasto)} | Leads: ${orbe.hoje.leads} | CPL: ${brl(orbe.hoje.cpl)}`,
      `- CTR: ${orbe.hoje.ctr} | CPM: R$ ${orbe.hoje.cpm} | Alcance: ${orbe.hoje.alcance?.toLocaleString('pt-BR')}`,
      '',
      `### Últimos 14 dias`,
      `- Gasto: ${brl(orbe.ultimos14.gasto)} | Leads: ${orbe.ultimos14.leads} | CPL: ${brl(orbe.ultimos14.cpl)}`,
      '',
      `### Top campanhas (14d)`,
      ...(orbe.top?.melhores || []).map(c => `✅ ${c.nome} — CPL ${brl(c.cpl)} | Leads: ${c.leads}`),
      '',
      `### Piores campanhas (14d)`,
      ...(orbe.top?.piores || []).map(c => `⚠️ ${c.nome} — CPL ${brl(c.cpl)} | Leads: ${c.leads}`),
    ].join('\n'),
  ];

  const content  = linhas.join('\n');
  const filepath = await saveOutput(`meta_${data}.md`, content);

  return {
    data,
    jacometo: jacometo.erro ? null : {
      gasto_hoje:  jacometo.hoje.gasto,
      leads_hoje:  jacometo.hoje.leads,
      cpl_hoje:    jacometo.hoje.cpl,
      gasto_14d:   jacometo.ultimos14.gasto,
    },
    orbe: orbe.erro ? null : {
      gasto_hoje:  orbe.hoje.gasto,
      leads_hoje:  orbe.hoje.leads,
      cpl_hoje:    orbe.hoje.cpl,
      gasto_14d:   orbe.ultimos14.gasto,
    },
    filepath,
    markdown: content,
  };
}

// ─── VERIFICAR TOKEN ──────────────────────────────────────────────────────────

/**
 * Verifica validade dos tokens dos dois apps
 * Retorna status e data de expiração
 */
export async function verificarTokens() {
  const resultado = {};

  for (const [key, c] of Object.entries(CONTAS)) {
    try {
      const res = await graphGet('me', { fields: 'id,name' }, c.access_token);
      resultado[key] = { ok: true, id: res.id, nome: res.name };
    } catch (e) {
      resultado[key] = { ok: false, erro: e.message };
    }
  }

  return resultado;
}
