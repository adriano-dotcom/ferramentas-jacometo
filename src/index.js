import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { initMemory, upsertUserContext } from './memory.js';
import { askJarvis, getSessionCost } from './claude.js';
import { sendToJarvis } from './managed-session.js';
import { JARVIS_WELCOME } from './personality.js';
import { initCrons } from './crons.js';
import { MODELS } from './router.js';
import { falarNoTelegram, transcreverAudioTelegram, statusElevenLabs } from './voice.js';
import { pesquisarEResumir, statusWebSearch } from './search.js';

dotenv.config();

const { TELEGRAM_TOKEN, ALLOWED_USER_IDS, USE_MANAGED_AGENTS } = process.env;

const useManagedAgents = USE_MANAGED_AGENTS === 'true';

/** Wrapper: roteia para Managed Agents ou claude.js local */
async function ask(userId, text) {
  if (useManagedAgents) {
    const { resposta } = await sendToJarvis(userId, text);
    return resposta;
  }
  return askJarvis(userId, text);
}

if (!TELEGRAM_TOKEN) throw new Error('TELEGRAM_TOKEN não configurado no .env');

const allowedIds = ALLOWED_USER_IDS
  ? ALLOWED_USER_IDS.split(',').map(id => id.trim())
  : [];

// Inicializa memória
initMemory();

// Inicializa bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('🤖 Jarvis online — aguardando mensagens...');
console.log(`📊 Modelos: Opus=${MODELS.OPUS} | Sonnet=${MODELS.SONNET} | Haiku=${MODELS.HAIKU}`);
console.log(`🔀 Modo: ${useManagedAgents ? '☁️ Managed Agents' : '🏠 Local (claude.js)'}`);

// Verifica se usuário é autorizado
function isAuthorized(userId) {
  if (allowedIds.length === 0) return true; // sem restrição se lista vazia
  return allowedIds.includes(String(userId));
}

// Formata mensagem para Telegram (Markdown)
function formatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '*$1*') // bold
    .replace(/__(.*?)__/g, '_$1_');     // italic
}

// ─── COMANDOS ────────────────────────────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {
  const { id, first_name, last_name, username } = msg.from;

  if (!isAuthorized(id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Acesso não autorizado.');
  }

  await upsertUserContext(String(id), `${first_name} ${last_name || ''}`.trim(), 'equipe');

  // Inicia crons com o chat ID do admin no primeiro /start
  initCrons(bot, msg.chat.id);

  bot.sendMessage(msg.chat.id, JARVIS_WELCOME, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
  if (!isAuthorized(msg.from.id)) return;

  const status = `
🟢 *Jarvis Status*

• Uptime: ${Math.floor(process.uptime() / 60)} min
• Custo sessão: $${getSessionCost().toFixed(4)}

*Modelos ativos:*
• 🧠 Opus — análises complexas, estratégia
• 🎯 Sonnet — consultas, relatórios, leads
• ⚡ Haiku — checks rápidos, alertas, crons

*Integrações:*
• Pipedrive: ${process.env.PIPEDRIVE_API_TOKEN ? '✅' : '❌'}
• Meta Ads: ${process.env.META_ACCESS_TOKEN ? '✅' : '❌'}
• Google Ads: ${process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? '✅' : '❌'}
• TikTok Ads: ${process.env.TIKTOK_ACCESS_TOKEN ? '✅' : '❌'}
• Lovable: ${process.env.LOVABLE_API_KEY ? '✅' : '❌'}
• Orbe Pet: ${process.env.APET_API_KEY ? '✅' : '❌'}

*Cron jobs ativos:*
• 08:00 📋 Briefing diário
• 12:00 ⚡ Check leads
• 17:30 📊 Resumo do dia
• 09:00/14:00 🔔 Alerta Meta Ads
• 07:00 🔔 Leads sem atividade (+48h)
• 20:00 🐾 Resumo Orbe Pet
  `.trim();

  bot.sendMessage(msg.chat.id, status, { parse_mode: 'Markdown' });
});

bot.onText(/\/custo/, (msg) => {
  if (!isAuthorized(msg.from.id)) return;
  const cost = getSessionCost();
  const brl = cost * 5.7; // câmbio aproximado
  bot.sendMessage(msg.chat.id,
    `💰 *Custo da sessão*\n\nUSD: $${cost.toFixed(4)}\nBRL: R$ ${brl.toFixed(2)}\n\n_Desde o último restart do Jarvis_`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/briefing/, async (msg) => {
  if (!isAuthorized(msg.from.id)) return;

  const thinking = await bot.sendMessage(msg.chat.id, '⏳ Gerando briefing do dia...');

  try {
    const resposta = await ask(
      String(msg.from.id),
      'Gere um briefing executivo completo do dia: leads novos no Pipedrive, performance dos anúncios Meta Ads de Jacometo e Orbe Pet, atividade dos vendedores, e qualquer ponto de atenção.'
    );
    await bot.deleteMessage(msg.chat.id, thinking.message_id);
    bot.sendMessage(msg.chat.id, formatMarkdown(resposta), { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Erro: ${e.message}`);
  }
});

// ─── COMANDO /voz ─────────────────────────────────────────────────────────────
// Converte a próxima resposta em áudio via ElevenLabs
bot.onText(/\/voz (.+)/, async (msg, match) => {
  if (!isAuthorized(msg.from.id)) return;
  const texto = match[1];

  if (!process.env.ELEVENLABS_API_KEY) {
    return bot.sendMessage(msg.chat.id, '❌ ElevenLabs não configurado. Adicione ELEVENLABS_API_KEY no .env');
  }

  bot.sendChatAction(msg.chat.id, 'record_voice');
  const res = await falarNoTelegram(bot, msg.chat.id, texto);
  if (!res.ok) bot.sendMessage(msg.chat.id, `❌ Erro ao gerar voz: ${res.erro}`);
});

// ─── COMANDO /pesquisar ───────────────────────────────────────────────────────
bot.onText(/\/pesquisar (.+)/, async (msg, match) => {
  if (!isAuthorized(msg.from.id)) return;
  const query = match[1];

  const thinking = await bot.sendMessage(msg.chat.id, `🔍 Pesquisando: "${query}"...`);
  try {
    const res = await pesquisarEResumir(query);
    await bot.deleteMessage(msg.chat.id, thinking.message_id);
    if (res.ok) {
      bot.sendMessage(msg.chat.id, formatMarkdown(res.formatado), { parse_mode: 'Markdown', disable_web_page_preview: true });
    } else {
      bot.sendMessage(msg.chat.id, `❌ Pesquisa falhou: ${res.erro}`);
    }
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Erro: ${e.message}`);
  }
});

// ─── ÁUDIO / VOICE NOTE ───────────────────────────────────────────────────────
// Ouve mensagem de voz e transcreve → processa com Jarvis → responde
bot.on('voice', async (msg) => {
  if (!isAuthorized(msg.from.id)) return;

  const userId  = String(msg.from.id);
  const chatId  = msg.chat.id;

  if (!process.env.ELEVENLABS_API_KEY) {
    return bot.sendMessage(chatId, '❌ ElevenLabs não configurado para transcrição de voz.');
  }

  bot.sendChatAction(chatId, 'typing');
  const transcrevendo = await bot.sendMessage(chatId, '👂 Transcrevendo áudio...');

  try {
    // Transcreve o áudio
    const transcricao = await transcreverAudioTelegram(msg.voice.file_id, bot);

    if (!transcricao.ok || !transcricao.texto) {
      await bot.deleteMessage(chatId, transcrevendo.message_id);
      return bot.sendMessage(chatId, '❌ Não consegui transcrever o áudio. Tente novamente.');
    }

    // Mostra o que foi entendido
    await bot.editMessageText(
      `👂 *Entendi:* "${transcricao.texto}"`,
      { chat_id: chatId, message_id: transcrevendo.message_id, parse_mode: 'Markdown' }
    );

    // Processa com Jarvis
    bot.sendChatAction(chatId, 'typing');
    const resposta = await ask(userId, transcricao.texto);

    // Responde em texto
    bot.sendMessage(chatId, formatMarkdown(resposta), { parse_mode: 'Markdown' });

    // Se quiser resposta em voz também: descomente abaixo
    // await falarNoTelegram(bot, chatId, resposta);

  } catch (e) {
    console.error('Erro ao processar voz:', e);
    await bot.deleteMessage(chatId, transcrevendo.message_id).catch(() => {});
    bot.sendMessage(chatId, `❌ Erro ao processar áudio: ${e.message}`);
  }
});

// Também processa arquivos de áudio enviados manualmente (não só voice notes)
bot.on('audio', async (msg) => {
  if (!isAuthorized(msg.from.id)) return;
  if (!process.env.ELEVENLABS_API_KEY) return;

  const userId = String(msg.from.id);
  const chatId = msg.chat.id;
  const loading = await bot.sendMessage(chatId, '👂 Processando áudio...');

  try {
    const transcricao = await transcreverAudioTelegram(msg.audio.file_id, bot);
    await bot.editMessageText(
      `👂 *Transcrição:* "${transcricao.texto}"`,
      { chat_id: chatId, message_id: loading.message_id, parse_mode: 'Markdown' }
    );
    const resposta = await ask(userId, transcricao.texto);
    bot.sendMessage(chatId, formatMarkdown(resposta), { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `❌ Erro: ${e.message}`);
  }
});

// ─── MENSAGENS LIVRES ─────────────────────────────────────────────────────────

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (!isAuthorized(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Acesso não autorizado.');
  }

  const userId = String(msg.from.id);
  const nome = msg.from.first_name;

  // Mostra "digitando..."
  bot.sendChatAction(msg.chat.id, 'typing');

  const thinking = await bot.sendMessage(msg.chat.id, '⏳ Processando...');

  try {
    const resposta = await ask(userId, msg.text);
    await bot.deleteMessage(msg.chat.id, thinking.message_id);
    bot.sendMessage(msg.chat.id, formatMarkdown(resposta), { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Erro:', e);
    await bot.deleteMessage(msg.chat.id, thinking.message_id);
    bot.sendMessage(msg.chat.id, `❌ Erro ao processar: ${e.message}`);
  }
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n🛑 Jarvis offline.');
  bot.stopPolling();
  process.exit(0);
});

// ─── VOICE — MENSAGEM DE VOZ DO TELEGRAM ─────────────────────────────────────

// Recebe mensagem de voz ou áudio
bot.on(['voice', 'audio'], async (msg) => {
  if (!isAuthorized(msg.from.id)) return;

  const userId  = String(msg.from.id);
  const fileId  = msg.voice?.file_id || msg.audio?.file_id;
  const chatId  = msg.chat.id;

  const thinking = await bot.sendMessage(chatId, '🎙️ Transcrevendo áudio...');

  try {
    // 1. Baixa e transcreve
    const { baixarVozTelegram, transcreverAudio } = await import('./voz.js');
    const download = await baixarVozTelegram(bot, fileId);

    if (!download.ok) {
      await bot.deleteMessage(chatId, thinking.message_id);
      return bot.sendMessage(chatId, `❌ Erro ao baixar áudio: ${download.erro}`);
    }

    const transcricao = await transcreverAudio(download.arquivo);
    if (!transcricao.ok) {
      await bot.deleteMessage(chatId, thinking.message_id);
      return bot.sendMessage(chatId, `❌ Erro ao transcrever: ${transcricao.erro}`);
    }

    const texto = transcricao.texto;
    await bot.deleteMessage(chatId, thinking.message_id);

    // 2. Mostra o que foi transcrito
    await bot.sendMessage(chatId,
      `🎙️ *Você disse:*\n_${texto}_`,
      { parse_mode: 'Markdown' }
    );

    // 3. Responde via Jarvis (texto)
    const thinkingRes = await bot.sendMessage(chatId, '⏳ Processando...');
    const resposta = await ask(userId, texto);
    await bot.deleteMessage(chatId, thinkingRes.message_id);

    // 4. Envia resposta em texto + voz (se pediu resposta em áudio)
    const querAudio = texto.toLowerCase().includes('responde em áudio') ||
                      texto.toLowerCase().includes('fala') ||
                      texto.toLowerCase().includes('me manda áudio') ||
                      texto.toLowerCase().includes('por voz');

    await bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });

    if (querAudio) {
      try {
        const { enviarVozTelegram } = await import('./voz.js');
        await enviarVozTelegram(bot, chatId, resposta);
      } catch (e) {
        console.warn('TTS falhou:', e.message);
      }
    }

  } catch (e) {
    console.error('Erro voice handler:', e);
    bot.sendMessage(chatId, `❌ Erro: ${e.message}`);
  }
});

// Comando /voz — responde em áudio
bot.onText(/\/voz (.+)/, async (msg, match) => {
  if (!isAuthorized(msg.from.id)) return;
  const texto = match[1];
  const { enviarVozTelegram } = await import('./voz.js');
  await bot.sendChatAction(msg.chat.id, 'record_voice');
  await enviarVozTelegram(bot, msg.chat.id, texto);
});

// Comando /vozes — lista vozes disponíveis
bot.onText(/\/vozes/, async (msg) => {
  if (!isAuthorized(msg.from.id)) return;
  const { listarVozes } = await import('./voz.js');
  const res = await listarVozes();
  if (!res.ok) return bot.sendMessage(msg.chat.id, `❌ ${res.erro}`);
  const lista = res.vozes.slice(0, 10).map(v => `• ${v.nome} (\`${v.id}\`)`).join('\n');
  bot.sendMessage(msg.chat.id, `🎙️ *Vozes disponíveis:*\n${lista}`, { parse_mode: 'Markdown' });
});

// Comando /buscar — pesquisa na internet
bot.onText(/\/buscar (.+)/, async (msg, match) => {
  if (!isAuthorized(msg.from.id)) return;
  const query = match[1];
  const { pesquisar } = await import('./search.js');
  const thinking = await bot.sendMessage(msg.chat.id, `🔍 Pesquisando: _${query}_...`, { parse_mode: 'Markdown' });
  const res = await pesquisar(query);
  await bot.deleteMessage(msg.chat.id, thinking.message_id);
  if (!res.ok) return bot.sendMessage(msg.chat.id, `❌ ${res.erro}`);
  const resultado = [
    `🔍 *${query}*`,
    `Fonte: ${res.fonte} · ${res.total} resultados`,
    '',
    ...(res.web || []).slice(0, 4).map(r => `• [${r.titulo}](${r.url})\n  ${(r.descricao||'').slice(0,100)}`),
  ].join('\n');
  bot.sendMessage(msg.chat.id, resultado, { parse_mode: 'Markdown', disable_web_page_preview: true });
});
