/**
 * JARVIS — ElevenLabs (Voz Bidirecional)
 * =========================================
 * Text-to-Speech: Jarvis fala via ElevenLabs → áudio no Telegram
 * Speech-to-Text: Ouve áudio do Telegram → transcreve → responde
 *
 * SDK oficial: @elevenlabs/elevenlabs-js
 * Modelo TTS: eleven_multilingual_v2 (suporta PT-BR nativamente)
 * Modelo STT: scribe_v2 (99 idiomas, detecta PT automaticamente)
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(__dirname, '../../out/audio');

// ─── CONFIG ELEVENLABS ────────────────────────────────────────────────────────

const API_KEY = process.env.ELEVENLABS_API_KEY;

// Vozes disponíveis — você pode trocar pelo ID da sua voz clonada
// Para clonar sua voz: elevenlabs.io/voice-lab
export const VOZES = {
  jarvis:    process.env.ELEVENLABS_VOICE_JARVIS    || 'pNInz6obpgDQGcFmaJgB', // Adam (default)
  adriano:   process.env.ELEVENLABS_VOICE_ADRIANO   || null,  // Voz clonada do Adriano (opcional)
  assistente:process.env.ELEVENLABS_VOICE_ASSISTENTE|| 'EXAVITQu4vr4xnSDxMaL', // Sarah (feminina)
};

// Modelo padrão
const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2';
const STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';

function getClient() {
  if (!API_KEY) throw new Error('ELEVENLABS_API_KEY não configurado no .env');
  return new ElevenLabsClient({ apiKey: API_KEY });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function agora() { return Date.now(); }
async function ensureDir() { await fs.mkdir(AUDIO_DIR, { recursive: true }); }

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT-TO-SPEECH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converte texto em áudio MP3 usando ElevenLabs
 * Retorna o caminho do arquivo gerado
 *
 * @param {string} texto     - texto a converter
 * @param {string} vozId     - ID da voz (padrão: VOZES.jarvis)
 * @param {object} opcoes    - { stability, similarityBoost, style }
 */
export async function textoParaAudio(texto, vozId = null, opcoes = {}) {
  await ensureDir();
  const client = getClient();
  const voz    = vozId || VOZES.jarvis;

  console.log(`🎙️ ElevenLabs TTS: "${texto.slice(0, 50)}..." [voz: ${voz}]`);

  // Gera áudio como stream
  const audioStream = await client.textToSpeech.convert(voz, {
    text:     texto,
    model_id: TTS_MODEL,
    language_code: 'pt', // força PT-BR
    voice_settings: {
      stability:        opcoes.stability        ?? 0.5,
      similarity_boost: opcoes.similarityBoost  ?? 0.8,
      style:            opcoes.style            ?? 0.0,
      use_speaker_boost: true,
    },
  });

  // Salva em arquivo
  const filename = `jarvis_${agora()}.mp3`;
  const filepath = path.join(AUDIO_DIR, filename);

  // Converte ReadableStream para Buffer
  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  await fs.writeFile(filepath, buffer);

  console.log(`✅ Áudio gerado: ${filepath} (${buffer.length} bytes)`);

  return {
    ok:       true,
    filepath,
    filename,
    tamanho:  buffer.length,
    duracao_estimada: Math.round(texto.length / 15), // ~15 chars/segundo
    voz,
    texto: texto.slice(0, 100),
  };
}

/**
 * Lista vozes disponíveis na conta ElevenLabs
 */
export async function listarVozes() {
  const client = getClient();
  const res    = await client.voices.search();
  return (res.voices || []).map(v => ({
    id:       v.voice_id,
    nome:     v.name,
    categoria: v.category,
    preview:  v.preview_url,
  }));
}

/**
 * Verifica créditos restantes na conta ElevenLabs
 */
export async function statusElevenLabs() {
  try {
    const client = getClient();
    const user   = await client.user.get();
    const sub    = user.subscription;
    return {
      ok:              true,
      plano:           sub?.tier,
      caracteres_usados: sub?.character_count,
      caracteres_limite: sub?.character_limit,
      vozes_clonadas:  sub?.voice_count,
      vozes_limite:    sub?.max_voice_add_edits,
      reset_em:        sub?.next_character_count_reset_unix
        ? new Date(sub.next_character_count_reset_unix * 1000).toLocaleDateString('pt-BR')
        : null,
    };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPEECH-TO-TEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transcreve arquivo de áudio usando ElevenLabs Scribe v2
 * Suporta: MP3, OGG, WAV, M4A, FLAC, OPUS (formato do Telegram)
 *
 * @param {string} audioPath - caminho do arquivo de áudio
 * @param {string} idioma    - código ISO 639-1 (null = auto-detecta)
 */
export async function transcriverAudio(audioPath, idioma = null) {
  const client = getClient();

  console.log(`👂 ElevenLabs STT: ${audioPath}`);

  // Lê o arquivo como Blob
  const buffer   = await fs.readFile(audioPath);
  const ext      = path.extname(audioPath).slice(1).toLowerCase();
  const mimeType = {
    mp3:  'audio/mpeg',
    ogg:  'audio/ogg',
    oga:  'audio/ogg',
    wav:  'audio/wav',
    m4a:  'audio/mp4',
    flac: 'audio/flac',
    opus: 'audio/opus',
    webm: 'audio/webm',
  }[ext] || 'audio/mpeg';

  const audioBlob = new Blob([buffer], { type: mimeType });

  const params = {
    file:             audioBlob,
    model_id:         STT_MODEL,
    tag_audio_events: true,
    diarize:          false, // só um falante
  };

  if (idioma) params.language_code = idioma;

  const resultado = await client.speechToText.convert(params);

  console.log(`✅ Transcrição: "${resultado.text?.slice(0, 80)}..."`);

  return {
    ok:       true,
    texto:    resultado.text,
    idioma:   resultado.language_code,
    duracao:  resultado.audio_duration_secs,
    palavras: resultado.words?.length || 0,
  };
}

/**
 * Baixa áudio do Telegram e transcreve
 * Retorna o texto transcrito
 *
 * @param {string} fileId   - file_id do Telegram
 * @param {object} bot      - instância do TelegramBot
 */
export async function transcreverAudioTelegram(fileId, bot) {
  await ensureDir();

  // Obtém URL do arquivo no Telegram
  const fileInfo = await bot.getFile(fileId);
  const fileUrl  = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;

  // Determina extensão do arquivo
  const ext      = path.extname(fileInfo.file_path) || '.oga'; // Telegram usa .oga (ogg audio)
  const filename = `voice_${agora()}${ext}`;
  const filepath = path.join(AUDIO_DIR, filename);

  // Baixa o arquivo
  console.log(`📥 Baixando áudio Telegram: ${fileInfo.file_path}`);
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
  await fs.writeFile(filepath, Buffer.from(response.data));

  // Transcreve
  const resultado = await transcriverAudio(filepath, null);

  // Limpa arquivo temporário após transcrição
  await fs.unlink(filepath).catch(() => {});

  return resultado;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRAÇÃO TELEGRAM — envia áudio como voice note
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gera áudio e envia como voice note no Telegram
 *
 * @param {object} bot      - instância do TelegramBot
 * @param {string} chatId   - ID do chat
 * @param {string} texto    - texto para converter em voz
 * @param {string} vozId    - ID da voz ElevenLabs (opcional)
 */
export async function falarNoTelegram(bot, chatId, texto, vozId = null) {
  try {
    // Gera o áudio
    const audio = await textoParaAudio(texto, vozId);
    if (!audio.ok) throw new Error(audio.erro);

    // Envia como voice note (aparece como mensagem de voz)
    await bot.sendVoice(chatId, audio.filepath, {
      caption: `🎙️ _Jarvis em voz_`,
      parse_mode: 'Markdown',
    });

    // Remove arquivo após envio
    await fs.unlink(audio.filepath).catch(() => {});

    return { ok: true, enviado: true, caracteres: texto.length };
  } catch (e) {
    console.error('❌ Erro ao falar no Telegram:', e.message);
    return { ok: false, erro: e.message };
  }
}

/**
 * Envia arquivo de áudio MP3 (não voice note — útil para relatórios em áudio)
 */
export async function enviarAudioMp3(bot, chatId, texto, titulo = 'Jarvis Audio', vozId = null) {
  const audio = await textoParaAudio(texto, vozId);
  if (!audio.ok) return audio;

  await bot.sendAudio(chatId, audio.filepath, {
    title:     titulo,
    performer: 'Jarvis OS',
    caption:   `🎙️ ${titulo}`,
  });

  await fs.unlink(audio.filepath).catch(() => {});
  return { ok: true };
}
