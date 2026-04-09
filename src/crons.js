import { TASK_TYPES, MODELS } from './router.js';
import { askJarvisWithModel } from './claude.js';
import { rememberFact, recallFact } from './memory.js';

// Cron jobs são tarefas agendadas que o Jarvis executa automaticamente
// sem precisar de comando do usuário

let bot;
let adminChatId;

export function initCrons(telegramBot, chatId) {
  bot = telegramBot;
  adminChatId = chatId;

  console.log('⏰ Cron jobs iniciados');

  // Registra todos os crons
  scheduleAll();
}

// ─── AGENDADOR SIMPLES ────────────────────────────────────────────────────────

function scheduleAll() {
  // Verifica horário a cada minuto
  setInterval(checkSchedule, 60 * 1000);
}

function timeMatch(hour, minute = 0) {
  const now = new Date();
  // Ajusta para horário de Brasília (UTC-3)
  const br = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return br.getHours() === hour && br.getMinutes() === minute;
}

function isWeekday() {
  const now = new Date();
  const br = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = br.getDay();
  return day >= 1 && day <= 5; // Segunda a sexta
}

async function checkSchedule() {
  // ── SEGUNDA A SEXTA ────────────────────────────────────────────────────────

  if (isWeekday()) {

    // 08:00 — Briefing diário completo (Sonnet)
    if (timeMatch(8, 0)) await cronBriefingDiario();

    // 12:00 — Check rápido de leads (Haiku)
    if (timeMatch(12, 0)) await cronCheckLeads();

    // 17:30 — Resumo do dia (Sonnet)
    if (timeMatch(17, 30)) await cronResumoDia();

    // 09:00, 14:00 — Alerta Meta Ads se gasto alto (Haiku)
    if (timeMatch(9, 0) || timeMatch(14, 0)) await cronAlertaMetaAds();

  }

  // ── TODO DIA ───────────────────────────────────────────────────────────────

  // 07:00 — Verifica se há leads sem atividade há +48h (Haiku)
  if (timeMatch(7, 0)) await cronLeadsSemAtividade();

  // 07:30 — Verifica saúde do Agente ARQUIVO (Haiku)
  if (timeMatch(7, 30)) await cronStatusArquivo();

  // 20:00 — Resumo Orbe Pet (Sonnet)
  if (timeMatch(20, 0)) await cronResumoOrbePet();
}

// ─── CRON JOBS ────────────────────────────────────────────────────────────────

async function cronBriefingDiario() {
  console.log('⏰ Cron: Briefing diário');
  try {
    const resposta = await askJarvisWithModel(
      'cron-system',
      TASK_TYPES.BRIEFING_DAILY.model,
      `Gere o briefing executivo do dia para Adriano. Inclua:
      1. Leads novos no Pipedrive (últimas 24h)
      2. Atividade dos vendedores
      3. Performance Meta Ads Jacometo e Orbe Pet
      4. Qualquer alerta ou ponto de atenção
      Seja direto e use dados reais das ferramentas.`
    );

    await bot.sendMessage(adminChatId,
      `🌅 *Bom dia! Briefing de ${hoje()}*\n\n${resposta}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('Erro briefing diário:', e.message);
  }
}

async function cronCheckLeads() {
  console.log('⏰ Cron: Check leads meio-dia');
  try {
    const resposta = await askJarvisWithModel(
      'cron-system',
      TASK_TYPES.CRON_CHECK.model,
      `Faça um check rápido: quantos leads entraram no Pipedrive hoje pela manhã? 
      Algum lead quente que precisa de atenção agora? Resposta em 3 linhas máximo.`
    );

    await bot.sendMessage(adminChatId,
      `☀️ *Check 12h*\n\n${resposta}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('Erro check leads:', e.message);
  }
}

async function cronResumoDia() {
  console.log('⏰ Cron: Resumo fim do dia');
  try {
    const resposta = await askJarvisWithModel(
      'cron-system',
      TASK_TYPES.SALES_REPORT.model,
      `Gere o resumo do dia de trabalho:
      1. Total de leads trabalhados hoje
      2. Deals avançados no funil
      3. Gasto total em anúncios hoje vs. ontem
      4. O que ficou pendente para amanhã
      Seja conciso.`
    );

    await bot.sendMessage(adminChatId,
      `🌆 *Resumo do dia — ${hoje()}*\n\n${resposta}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('Erro resumo dia:', e.message);
  }
}

async function cronAlertaMetaAds() {
  console.log('⏰ Cron: Alerta Meta Ads');
  try {
    const resposta = await askJarvisWithModel(
      'cron-system',
      TASK_TYPES.ALERT_SIMPLE.model,
      `Verifique o gasto Meta Ads de hoje (Jacometo + Orbe Pet).
      Se o gasto estiver acima de 80% do orçamento diário, avise com urgência.
      Se estiver normal, responda apenas "✅ Meta Ads normal".
      Seja brevíssimo.`
    );

    // Só envia se não for "normal"
    if (!resposta.toLowerCase().includes('normal')) {
      await bot.sendMessage(adminChatId,
        `⚠️ *Alerta Meta Ads*\n\n${resposta}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e) {
    console.error('Erro alerta meta ads:', e.message);
  }
}

async function cronLeadsSemAtividade() {  console.log('⏰ Cron: Leads sem atividade');
  try {
    const resposta = await askJarvisWithModel(
      'cron-system',
      TASK_TYPES.ALERT_SIMPLE.model,
      `Verifique no Pipedrive se há leads/deals abertos sem nenhuma atividade há mais de 48 horas.
      Liste os nomes e responsáveis. Se não houver, responda "✅ Todos os leads com atividade recente".`
    );

    if (!resposta.toLowerCase().includes('✅')) {
      await bot.sendMessage(adminChatId,
        `🔔 *Leads sem atividade (+48h)*\n\n${resposta}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e) {
    console.error('Erro leads sem atividade:', e.message);
  }
}

async function cronResumoOrbePet() {
  console.log('⏰ Cron: Resumo Orbe Pet');
  try {
    const resposta = await askJarvisWithModel(
      'cron-system',
      TASK_TYPES.ORBE_REPORT.model,
      `Gere o resumo diário da Orbe Pet:
      1. Novos planos ativados hoje
      2. Performance anúncios Meta + Google + TikTok
      3. Atendimentos pendentes
      Seja direto.`
    );

    await bot.sendMessage(adminChatId,
      `🐾 *Orbe Pet — Resumo ${hoje()}*\n\n${resposta}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('Erro resumo Orbe Pet:', e.message);
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function hoje() {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

async function cronStatusArquivo() {
  console.log('⏰ Cron: Status Agente ARQUIVO');
  try {
    const { statusAgenteArquivo } = await import('./arquivo.js');
    const status = await statusAgenteArquivo();

    // Só notifica se houver problema
    if (!status.api.online) {
      await bot.sendMessage(adminChatId,
        `⚠️ *Agente ARQUIVO offline*\n\nferrramentas.jacometo.com.br não respondeu.\nVerificar Mac Mini Jarvis.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Verifica crons com erro no Mission Control
    const mc = status.mission_control?.data;
    if (mc) {
      const erros = Object.entries(mc)
        .filter(([, v]) => v?.lastError || v?.status === 'late')
        .map(([k, v]) => `• ${k}: ${v.lastError || 'atrasado'}`);

      if (erros.length > 0) {
        await bot.sendMessage(adminChatId,
          `🔴 *Agente ARQUIVO — Erros Detectados*\n\n${erros.join('\n')}`,
          { parse_mode: 'Markdown' }
        );
      }
    }
  } catch (e) {
    console.error('Erro cron status arquivo:', e.message);
  }
}
