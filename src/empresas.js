/**
 * JARVIS OS — Configuração Multi-Empresa
 * ========================================
 * Duas empresas, dois gerentes, dois Chatwoot, dois Pipedrive.
 * Cada empresa tem seu próprio contexto isolado.
 *
 * Empresa 1: Jacometo Seguros de Transporte
 *   CRM:      https://crm.jacometo.com.br
 *   Site:     https://jacometo.com.br
 *   Produto:  RCTR-C, RC-DC, seguros de carga
 *
 * Empresa 2: Orbe Pet
 *   CRM:      https://crm.orbepet.com.br
 *   Site:     https://orbepet.com.br
 *   Produto:  Planos de saúde pet (APet/Angelus)
 */

import dotenv from 'dotenv';
dotenv.config();

// ─── EMPRESAS ─────────────────────────────────────────────────────────────────

export const EMPRESAS = {

  jacometo: {
    id:   'jacometo',
    nome: 'Jacometo Seguros',
    site: 'https://jacometo.com.br',
    cor:  '#0a84ff',
    emoji:'🔵',
    produto: 'Seguro de Transporte (RCTR-C, RC-DC)',

    // Chatwoot
    chatwoot: {
      url:        process.env.CHATWOOT_URL_JACOMETO || 'https://crm.jacometo.com.br',
      token:      process.env.CHATWOOT_TOKEN_JACOMETO,
      account_id: process.env.CHATWOOT_ACCOUNT_JACOMETO || '1',
      webhook_secret: process.env.CHATWOOT_SECRET_JACOMETO,
      inboxes: {
        whatsapp: process.env.INBOX_JACO_WA   || '1',
        site:     process.env.INBOX_JACO_SITE || '2',
        instagram:process.env.INBOX_JACO_IG   || '3',
      },
    },

    // Pipedrive
    pipedrive: {
      domain:    process.env.PIPEDRIVE_DOMAIN_JACOMETO || 'jacometo',
      api_token: process.env.PIPEDRIVE_TOKEN_JACOMETO,
      // Mapa label → owner (conforme TOOLS.md)
      labels: {
        443: 'Adriana', 444: 'Leonardo', 445: 'Garcia',
        446: 'Felipe',  447: 'Barbara',  448: 'Adriano',
        449: 'Alessandro', 451: 'Jacometo seguros',
      },
      user_cobranca: 15830108,
    },

    // Meta Ads
    meta: {
      ad_account_id: process.env.META_AD_ACCOUNT_JACOMETO,
      access_token:  process.env.META_APP_TOKEN_JACOMETO,
      app_id:        process.env.META_APP_ID_JACOMETO,
    },

    // Google Ads
    google: {
      customer_id:    process.env.GOOGLE_ADS_CUSTOMER_JACOMETO,
      developer_token:process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      refresh_token:  process.env.GOOGLE_ADS_REFRESH_JACOMETO,
    },

    // KPIs alvo
    metas: {
      cpl_max:        50,   // CPL máximo aceitável (R$)
      taxa_conv_min:  25,   // Taxa mínima lead→deal (%)
      deals_mes:      20,   // Meta de deals/mês
      ticket_medio:   15000,// Ticket médio R$
    },

    // Outputs
    out_dir: './out/jacometo',
  },

  // ──────────────────────────────────────────────────────────────────────────

  orbe: {
    id:   'orbe',
    nome: 'Orbe Pet',
    site: 'https://orbepet.com.br',
    cor:  '#ff6b9d',
    emoji:'🐾',
    produto: 'Plano de Saúde Pet',

    // Chatwoot PRÓPRIO da Orbe
    chatwoot: {
      url:        process.env.CHATWOOT_URL_ORBE || 'https://crm.orbepet.com.br',
      token:      process.env.CHATWOOT_TOKEN_ORBE,
      account_id: process.env.CHATWOOT_ACCOUNT_ORBE || '1',
      webhook_secret: process.env.CHATWOOT_SECRET_ORBE,
      inboxes: {
        whatsapp:  process.env.INBOX_ORBE_WA   || '1',
        site:      process.env.INBOX_ORBE_SITE || '2',
        instagram: process.env.INBOX_ORBE_IG   || '3',
        tiktok:    process.env.INBOX_ORBE_TT   || '4',
      },
    },

    // Pipedrive (mesmo CRM ou separado — configurável)
    pipedrive: {
      domain:    process.env.PIPEDRIVE_DOMAIN_ORBE || process.env.PIPEDRIVE_DOMAIN_JACOMETO || 'jacometo',
      api_token: process.env.PIPEDRIVE_TOKEN_ORBE  || process.env.PIPEDRIVE_TOKEN_JACOMETO,
      pipeline_id: process.env.PIPEDRIVE_PIPELINE_ORBE || null, // pipeline específico Orbe
    },

    // Meta Ads Orbe
    meta: {
      ad_account_id: process.env.META_AD_ACCOUNT_ORBE || 'act_596420432003943',
      access_token:  process.env.META_APP_TOKEN_ORBE,
      app_id:        process.env.META_APP_ID_ORBE,
    },

    // TikTok Ads Orbe
    tiktok: {
      advertiser_id:  process.env.TIKTOK_ADVERTISER_ORBE,
      access_token:   process.env.TIKTOK_ACCESS_TOKEN,
      refresh_token:  process.env.TIKTOK_REFRESH_TOKEN,
    },

    // Google Ads Orbe
    google: {
      customer_id:   process.env.GOOGLE_ADS_CUSTOMER_ORBE,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_ORBE,
    },

    // Planos Orbe Pet (APet/Angelus)
    planos: {
      'Órbita Essencial': { preco: 37.62,  codigo: 'ESSENCIAL' },
      'Órbita Plus':      { preco: 89.82,  codigo: 'PLUS'      },
      'Órbita Total':     { preco: 107.82, codigo: 'TOTAL'     },
      'Galáxia':          { preco: 138.32, codigo: 'GALAXIA'   },
    },

    // KPIs alvo Orbe
    metas: {
      cpl_max:        45,   // CPL máximo Orbe
      taxa_conv_min:  30,   // Taxa mínima lead→assinatura (%)
      planos_mes:     50,   // Meta de planos/mês
      mrr_meta:       5000, // MRR mensal alvo (R$)
      churn_max:      5,    // Churn máximo (%)
    },

    // APet API
    apet: {
      url:     process.env.APET_API_URL,
      api_key: process.env.APET_API_KEY,
    },

    out_dir: './out/orbe',
  },
};

// ─── HELPER — pega empresa por ID ─────────────────────────────────────────────

export function getEmpresa(id) {
  const empresa = EMPRESAS[id];
  if (!empresa) throw new Error(`Empresa desconhecida: ${id}. Use 'jacometo' ou 'orbe'`);
  return empresa;
}

// ─── HELPER — identifica empresa pelo inbox Chatwoot ─────────────────────────

export function identificarEmpresaPorWebhook(headers, body) {
  // Tenta identificar pelo host do webhook
  const host = headers['x-forwarded-host'] || headers['host'] || '';
  if (host.includes('orbepet')) return 'orbe';
  if (host.includes('jacometo')) return 'jacometo';

  // Fallback: pelo inbox_id mapeado
  const inboxId = String(body?.conversation?.inbox_id || '');
  const orbeInboxes = Object.values(EMPRESAS.orbe.chatwoot.inboxes).map(String);
  if (orbeInboxes.includes(inboxId)) return 'orbe';

  return 'jacometo'; // default
}
