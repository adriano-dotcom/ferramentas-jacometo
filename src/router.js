// ─── ROTEADOR DE MODELOS ─────────────────────────────────────────────────────
// Cada tarefa usa o modelo ideal: custo x inteligência balanceados

export const MODELS = {
  OPUS:   'claude-opus-4-6',    // Análises complexas, estratégia, sinistros
  SONNET: 'claude-sonnet-4-6',  // Consultas gerais, leads, relatórios
  HAIKU:  'claude-haiku-4-5-20251001'  // Respostas rápidas, cron checks, alertas simples
};

// Classificação de tarefas por modelo
const TASK_ROUTES = {

  // ── HAIKU — rápido e barato ───────────────────────────────────────────────
  // Checks automáticos, alertas, respostas simples
  haiku: [
    'leads hoje',
    'quantos leads',
    'status',
    'gasto hoje',
    'cpl hoje',
    'quanto gastou',
    'resumo rápido',
    'ok',
    'sim',
    'não',
    'obrigado',
    'oi',
    'olá',
    'bom dia',
    'boa tarde',
  ],

  // ── SONNET — equilibrado ──────────────────────────────────────────────────
  // Consultas, relatórios, análise de funil, fiscalização de vendedores
  sonnet: [
    'leads',
    'vendas',
    'pipedrive',
    'funil',
    'vendedor',
    'meta ads',
    'google ads',
    'tiktok',
    'campanha',
    'orbe pet',
    'atendimento',
    'briefing',
    'relatório',
    'performance',
    'semana',
    'mês',
    'comparar',
  ],

  // ── OPUS — máxima inteligência ────────────────────────────────────────────
  // Estratégia, análise de sinistro, decisões complexas, análise jurídica
  opus: [
    'estratégia', 'analisar', 'sinistro', 'aig', 'susep', 'jurídico',
    'contrato', 'apólice complexa', 'projeção', 'previsão', 'por que',
    'como melhorar', 'plano de ação', 'diagnóstico', 'recomendação',
    'decisão', 'risco', 'precificação',
    // ferramentas
    'apólice', 'apolices', 'cotação', 'sinistros', 'transportadora',
  ]
};

// Tipos de tarefa fixos (cron jobs e tools internas)
export const TASK_TYPES = {
  // Cron jobs — sempre Haiku (barato, frequente)
  CRON_CHECK:      { model: MODELS.HAIKU,  label: '⚡ Check rápido' },
  ALERT_SIMPLE:    { model: MODELS.HAIKU,  label: '🔔 Alerta simples' },

  // Consultas — Sonnet
  LEADS_REPORT:    { model: MODELS.SONNET, label: '📊 Relatório de leads' },
  ADS_REPORT:      { model: MODELS.SONNET, label: '📣 Relatório de anúncios' },
  SALES_REPORT:    { model: MODELS.SONNET, label: '💰 Relatório de vendas' },
  BRIEFING_DAILY:  { model: MODELS.SONNET, label: '📋 Briefing diário' },
  ORBE_REPORT:     { model: MODELS.SONNET, label: '🐾 Relatório Orbe Pet' },

  // Análises complexas — Opus
  STRATEGY:        { model: MODELS.OPUS,   label: '🧠 Análise estratégica' },
  CLAIM_ANALYSIS:  { model: MODELS.OPUS,   label: '⚖️ Análise de sinistro' },
  DEEP_ANALYSIS:   { model: MODELS.OPUS,   label: '🔬 Análise profunda' },
};

/**
 * Detecta automaticamente o modelo ideal pela mensagem do usuário
 */
export function routeModel(message) {
  const text = message.toLowerCase();

  // Verifica Opus primeiro (maior prioridade)
  for (const keyword of TASK_ROUTES.opus) {
    if (text.includes(keyword)) {
      return {
        model: MODELS.OPUS,
        reason: `🧠 Usando Opus — tarefa complexa detectada ("${keyword}")`
      };
    }
  }

  // Verifica Haiku (respostas simples)
  for (const keyword of TASK_ROUTES.haiku) {
    if (text === keyword || text.startsWith(keyword)) {
      return {
        model: MODELS.HAIKU,
        reason: `⚡ Usando Haiku — resposta rápida`
      };
    }
  }

  // Default: Sonnet para tudo mais
  return {
    model: MODELS.SONNET,
    reason: `🎯 Usando Sonnet — consulta geral`
  };
}

/**
 * Custo estimado por modelo (USD por 1M tokens)
 * Para monitoramento de gastos
 */
export const MODEL_COSTS = {
  [MODELS.HAIKU]:  { input: 0.80,  output: 4.00  },
  [MODELS.SONNET]: { input: 3.00,  output: 15.00 },
  [MODELS.OPUS]:   { input: 15.00, output: 75.00 },
};

export function estimateCost(model, inputTokens, outputTokens) {
  const costs = MODEL_COSTS[model];
  if (!costs) return 0;
  return (
    (inputTokens / 1_000_000) * costs.input +
    (outputTokens / 1_000_000) * costs.output
  );
}
