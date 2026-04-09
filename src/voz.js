/**
 * JARVIS — ElevenLabs + Voz
 * ==========================
 * 1. Text-to-Speech (TTS) — ElevenLabs gera áudio com voz do Jarvis
 * 2. Speech-to-Text (STT) — Transcreve áudio recebido no Telegram
 *    usando ElevenLabs STT ou Whisper (OpenAI) como fallback
 *
 * Voz do Jarvis: configurável via ELEVENLABS_VOICE_ID
 * Modelo padrão: eleven_multilingual_v2 (português nativo)
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import axios from 'axios';
import fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
dotenv.config();

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(__dirname, '../../out/audio');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const ELEVEN_KEY  = process.env.ELEVENLABS_API_KEY;
const VOICE_ID    = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // Adam (pt-BR)
const TTS_MODEL   = process.env.ELEVENLABS_MODEL    || 'eleven_multilingual_v2';
const OPENAI_KEY  = process.env.OPENAI_API_KEY; // fallback para Whisper

// ─── CLIENT ───────────────────────────────────────────────────────────────────

function getClient() {
  if (!ELEVEN_KEY) throw new Error('ELEVENLABS_API_KEY não configurado no .env');
  return new ElevenLabsClient({ apiKey: ELEVEN_KEY });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function ensureDir() {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// ─── TEXT-TO-SPEECH ───────────────────────────────────────────────────────────

/**
 * Converte texto em áudio MP3 via ElevenLabs
 * Retorna caminho do arquivo gerado
 */
export async function textoParaAudio(texto, opcoes = {}) {
  await ensureDir();

  const voiceId = opcoes.voiceId || VOICE_ID;
  const model   = opcoes.model   || TTS_MODEL;
  const nome    = opcoes.nome    || `jarvis_${timestamp()}.mp3`;
  const arquivo = path.join(AUDIO_DIR, nome);

  try {
    const client = getClient();

    // Gera áudio como stream
    const audioStream = await client.textToSpeech.convert(voiceId, {
      text:    texto,
      modelId: model,
      voiceSettings: {
        stability:        opcoes.stability        || 0.5,
        similarity_boost: opcoes.similarityBoost  || 0.8,
        style:            opcoes.style            || 0.2,
        use_speaker_boost:true,
      },
    });

    // Salva em arquivo
    const writeStream = createWriteStream(arquivo);
    for await (const chunk of audioStream) {
      writeStream.write(chunk);
    }
    writeStream.end();

    // Aguarda flush
    await new Promise((res, rej) => {
      writeStream.on('finish', res);
      writeStream.on('error', rej);
    });

    console.log(`🔊 TTS gerado: ${arquivo}`);
    return { ok: true, arquivo, tamanho: (await fs.stat(arquivo)).size };

  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/**
 * Gera áudio e envia como voice note no Telegram
 * Converte MP3 → OGG Opus (formato que o Telegram aceita como voz)
 */
export async function enviarVozTelegram(bot, chatId, texto, opcoes = {}) {
  // Gera áudio
  const resultado = await textoParaAudio(texto, opcoes);
  if (!resultado.ok) {
    await bot.sendMessage(chatId, `❌ Falha ao gerar áudio: ${resultado.erro}`);
    return resultado;
  }

  // Converte MP3 → OGG Opus para Telegram
  const mp3 = resultado.arquivo;
  const ogg = mp3.replace('.mp3', '.ogg');

  try {
    await execAsync(`ffmpeg -i "${mp3}" -c:a libopus -b:a 64k "${ogg}" -y 2>/dev/null`);
    await bot.sendVoice(chatId, ogg);
    // Limpa arquivos temporários
    await Promise.all([fs.unlink(mp3), fs.unlink(ogg)]).catch(() => {});
    return { ok: true, enviado: true };
  } catch (e) {
    // Fallback: envia como audio file se OGG falhar (ffmpeg não instalado)
    try {
      await bot.sendAudio(chatId, mp3, {}, { filename: 'jarvis.mp3', contentType: 'audio/mp3' });
      await fs.unlink(mp3).catch(() => {});
      return { ok: true, enviado: true, formato: 'mp3' };
    } catch (e2) {
      return { ok: false, erro: `ffmpeg: ${e.message} | sendAudio: ${e2.message}` };
    }
  }
}

/**
 * Lista vozes disponíveis no ElevenLabs
 */
export async function listarVozes() {
  try {
    const client = getClient();
    const res = await client.voices.getAll();
    return {
      ok:   true,
      vozes: (res.voices || []).map(v => ({
        id:       v.voice_id,
        nome:     v.name,
        categoria:v.category,
        labels:   v.labels,
      })),
    };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ─── SPEECH-TO-TEXT ───────────────────────────────────────────────────────────

/**
 * Transcreve arquivo de áudio para texto
 * Usa ElevenLabs STT (se disponível) ou Whisper (OpenAI) como fallback
 *
 * @param {string} arquivoAudio - caminho do arquivo .ogg/.mp3/.wav
 */
export async function transcreverAudio(arquivoAudio) {
  // Tenta ElevenLabs STT primeiro
  if (ELEVEN_KEY) {
    try {
      const client = getClient();
      const audio  = createReadStream(arquivoAudio);

      const res = await client.speechToText.convert({
        audio,
        modelId:        'scribe_v1',
        languageCode:   'pt',
        tagAudioEvents: false,
        diarize:        false,
      });

      return {
        ok:      true,
        texto:   res.text || res.transcript || '',
        fonte:   'elevenlabs',
        idioma:  res.language_code,
      };
    } catch (e) {
      console.warn('ElevenLabs STT falhou, tentando Whisper:', e.message);
    }
  }

  // Fallback: Whisper (OpenAI)
  if (OPENAI_KEY) {
    return whisperTranscrever(arquivoAudio);
  }

  return {
    ok:    false,
    erro:  'Nenhum STT configurado. Configure ELEVENLABS_API_KEY ou OPENAI_API_KEY.',
  };
}

async function whisperTranscrever(arquivoAudio) {
  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', createReadStream(arquivoAudio), {
      filename:    path.basename(arquivoAudio),
      contentType: 'audio/ogg',
    });
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const res = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        timeout: 30000,
      }
    );
    return { ok: true, texto: res.data.text, fonte: 'whisper' };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ─── DOWNLOAD DE VOZ DO TELEGRAM ─────────────────────────────────────────────

/**
 * Baixa arquivo de voz do Telegram e converte para MP3
 * Retorna caminho do arquivo local
 */
export async function baixarVozTelegram(bot, fileId) {
  await ensureDir();

  try {
    // Pega URL do arquivo
    const file    = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;

    // Baixa o OGG
    const oggPath = path.join(AUDIO_DIR, `voz_${timestamp()}.ogg`);
    const mp3Path = oggPath.replace('.ogg', '.mp3');

    const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
    await fs.writeFile(oggPath, Buffer.from(response.data));

    // Converte OGG → MP3 com ffmpeg (melhor compatibilidade com STT)
    try {
      await execAsync(`ffmpeg -i "${oggPath}" -vn -ar 16000 -ac 1 -b:a 128k "${mp3Path}" -y 2>/dev/null`);
      await fs.unlink(oggPath).catch(() => {});
      return { ok: true, arquivo: mp3Path, formato: 'mp3' };
    } catch {
      // Se ffmpeg não disponível, usa OGG diretamente
      return { ok: true, arquivo: oggPath, formato: 'ogg' };
    }
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/**
 * Status da integração ElevenLabs
 */
export async function statusElevenLabs() {
  const config = {
    api_key_configurado: !!ELEVEN_KEY,
    voice_id:            VOICE_ID,
    model:               TTS_MODEL,
    openai_fallback:     !!OPENAI_KEY,
    ffmpeg_instalado:    false,
  };

  // Verifica ffmpeg
  try {
    await execAsync('ffmpeg -version');
    config.ffmpeg_instalado = true;
  } catch {}

  // Verifica conta ElevenLabs
  if (ELEVEN_KEY) {
    try {
      const client = getClient();
      const user   = await client.user.get();
      config.plano     = user.subscription?.tier;
      config.caracteres_usados    = user.subscription?.character_count;
      config.caracteres_limite    = user.subscription?.character_limit;
      config.api_ok = true;
    } catch (e) {
      config.api_ok = false;
      config.api_erro = e.message;
    }
  }

  return config;
}
