/**
 * JARVIS — Drive Watcher
 * =======================
 * Monitora pasta do Google Drive a cada 2 minutos.
 * Detecta PDFs novos, extrai dados, cadastra no Quiver, envia email.
 *
 * Marca arquivos processados com propriedade customizada:
 *   appProperties.jacometo_processado = "true"
 *
 * Move para subpasta "Processados" ou "Erros" conforme resultado.
 */

import { google } from 'googleapis';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
const TOKEN_PATH       = './token.json';
const FOLDER_ID        = process.env.DRIVE_FOLDER_FATURAS;
const POLL_INTERVAL    = 2 * 60 * 1000; // 2 minutos

// Stats
const stats = {
  ativo: false,
  ultimaVerificacao: null,
  totalProcessados: 0,
  totalErros: 0,
  ultimoArquivo: null,
};

let driveClient = null;
let intervalId = null;

// ── SUBPASTAS ─────────────────────────────────────────────────────────────────
// Cache de IDs das subpastas "Processados" e "Erros"
const subfolderCache = {};

async function getOrCreateSubfolder(drive, parentId, name) {
  const key = `${parentId}/${name}`;
  if (subfolderCache[key]) return subfolderCache[key];

  // Busca existente
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
  });

  if (res.data.files?.length > 0) {
    subfolderCache[key] = res.data.files[0].id;
    return subfolderCache[key];
  }

  // Cria
  const folder = await drive.files.create({
    requestBody: { name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });

  subfolderCache[key] = folder.data.id;
  console.log(`  📁 Subpasta criada: ${name} (${folder.data.id})`);
  return subfolderCache[key];
}

// ── DRIVE CLIENT ──────────────────────────────────────────────────────────────

function getDrive() {
  if (driveClient) return driveClient;

  if (!fs.existsSync(CREDENTIALS_PATH) || !fs.existsSync(TOKEN_PATH)) {
    throw new Error('Credenciais Google não configuradas. Rode: node src/tools/drive-auth.js');
  }

  const { installed } = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const oauth2 = new google.auth.OAuth2(installed.client_id, installed.client_secret, 'http://localhost:3333');
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oauth2.setCredentials(tokens);

  oauth2.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });

  driveClient = google.drive({ version: 'v3', auth: oauth2 });
  return driveClient;
}

// ── DETECTAR SEGURADORA ───────────────────────────────────────────────────────

const SEGURADORAS = ['allianz', 'tokio', 'akad', 'sompo', 'axa', 'chubb'];

function detectarSeguradora(nomeArquivo) {
  const lower = nomeArquivo.toLowerCase();
  for (const seg of SEGURADORAS) {
    if (lower.includes(seg)) return seg;
  }
  return null;
}

// ── PROCESSAR PDF ─────────────────────────────────────────────────────────────

async function processarPDF(drive, arquivo) {
  const { id, name } = arquivo;
  console.log(`\n📄 Processando: ${name}`);

  const seguradora = detectarSeguradora(name);
  if (!seguradora) {
    console.log(`  ⚠️ Seguradora não detectada no nome: ${name}`);
    await moverParaSubpasta(drive, id, 'Erros');
    await marcarProcessado(drive, id);
    stats.totalErros++;

    const { enviarConfirmacao } = await import('../lib/email-confirmacao.js');
    await enviarConfirmacao({
      segurado: name, seguradora: '?', apolice: '—', endosso: '—',
      premio: '—', vencimento: '—', ramo: '—', sucesso: false,
      erro: `Seguradora não detectada no nome do arquivo. Renomeie com: allianz, tokio, akad, sompo, axa ou chubb.`,
    });
    return;
  }

  // 1. Baixa PDF
  let pdfBuffer;
  try {
    const res = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
    pdfBuffer = Buffer.from(res.data);
    console.log(`  ⬇️ Baixado: ${Math.round(pdfBuffer.length / 1024)} KB`);
  } catch (err) {
    console.error(`  ❌ Erro ao baixar: ${err.message}`);
    stats.totalErros++;
    return;
  }

  // 2. Extrai dados com Claude Vision
  let dadosExtraidos;
  try {
    const { extrairDadosFatura } = await import('../tools/extrator-fatura.js');
    const ext = await extrairDadosFatura(pdfBuffer, seguradora);
    if (!ext.ok) {
      console.log(`  ❌ Extração falhou: ${ext.erro}`);
      await moverParaSubpasta(drive, id, 'Erros');
      await marcarProcessado(drive, id);
      stats.totalErros++;

      const { enviarConfirmacao } = await import('../lib/email-confirmacao.js');
      await enviarConfirmacao({
        segurado: name, seguradora, apolice: ext.dados?.apolice || '—',
        endosso: '—', premio: '—', vencimento: '—', ramo: '—',
        sucesso: false, erro: `Extração falhou: ${ext.erro}`,
      });
      return;
    }
    dadosExtraidos = ext.dados;
    console.log(`  🔍 Extraído: ${seguradora} apólice ${dadosExtraidos.apolice} prêmio ${dadosExtraidos.premio}`);
  } catch (err) {
    console.error(`  ❌ Erro na extração: ${err.message}`);
    stats.totalErros++;
    return;
  }

  // 3. Cadastra no Quiver PRO via backend RPA
  let resultado;
  try {
    const { cadastrarFaturas } = await import('../tools/quiver-tool.js');
    resultado = await cadastrarFaturas([{ buffer: pdfBuffer, nome: name }]);
    console.log(`  📋 Quiver: ${resultado.mensagem}`);
  } catch (err) {
    console.error(`  ❌ Erro no cadastro: ${err.message}`);
    resultado = { sucesso: false, mensagem: err.message };
  }

  // 4. Move para subpasta
  const destino = resultado.sucesso ? 'Processados' : 'Erros';
  await moverParaSubpasta(drive, id, destino);
  await marcarProcessado(drive, id);

  if (resultado.sucesso) stats.totalProcessados++;
  else stats.totalErros++;

  stats.ultimoArquivo = name;

  // 5. Envia email
  try {
    const { enviarConfirmacao } = await import('../lib/email-confirmacao.js');

    const seguradoNome = resultado.resultado?.ok?.[0]?.segurado || name;
    const apolice = resultado.resultado?.ok?.[0]?.apolice || dadosExtraidos.apolice || '—';
    const endosso = resultado.resultado?.ok?.[0]?.endosso || dadosExtraidos.endosso || '—';
    const premio = resultado.resultado?.ok?.[0]?.premio || dadosExtraidos.premio || '—';
    const erroMsg = resultado.resultado?.falhas?.[0]?.erro || resultado.mensagem;

    await enviarConfirmacao({
      segurado: seguradoNome,
      seguradora,
      apolice,
      endosso,
      premio,
      vencimento: dadosExtraidos.vencimento || '—',
      ramo: dadosExtraidos.ramo || '—',
      sucesso: resultado.sucesso,
      erro: resultado.sucesso ? null : erroMsg,
    });
  } catch (err) {
    console.error(`  ⚠️ Email falhou: ${err.message}`);
  }
}

// ── HELPERS DRIVE ─────────────────────────────────────────────────────────────

async function marcarProcessado(drive, fileId) {
  try {
    await drive.files.update({
      fileId,
      requestBody: { appProperties: { jacometo_processado: 'true' } },
    });
  } catch (err) {
    console.warn(`  ⚠️ Falha ao marcar processado: ${err.message}`);
  }
}

async function moverParaSubpasta(drive, fileId, subfolderName) {
  try {
    const destId = await getOrCreateSubfolder(drive, FOLDER_ID, subfolderName);

    // Pega parents atuais
    const file = await drive.files.get({ fileId, fields: 'parents' });
    const previousParents = (file.data.parents || []).join(',');

    await drive.files.update({
      fileId,
      addParents: destId,
      removeParents: previousParents,
      fields: 'id, parents',
    });
    console.log(`  📂 Movido para ${subfolderName}`);
  } catch (err) {
    console.warn(`  ⚠️ Falha ao mover: ${err.message}`);
  }
}

// ── VERIFICAÇÃO PRINCIPAL ─────────────────────────────────────────────────────

async function verificar() {
  try {
    const drive = getDrive();

    // Busca PDFs na pasta que NÃO têm appProperties.jacometo_processado
    const res = await drive.files.list({
      q: [
        `'${FOLDER_ID}' in parents`,
        `mimeType = 'application/pdf'`,
        `trashed = false`,
        `appProperties has { key='jacometo_processado' and value='true' } = false`,
      ].join(' and ').replace(` = false`, ''),
      fields: 'files(id, name, createdTime, appProperties)',
      orderBy: 'createdTime asc',
      pageSize: 20,
    });

    // Filtra manualmente os não processados (Drive API não suporta "NOT has" em appProperties)
    const todosPdfs = res.data.files || [];
    const novos = todosPdfs.filter(f => !f.appProperties?.jacometo_processado);

    stats.ultimaVerificacao = new Date().toISOString();

    if (novos.length === 0) return;

    console.log(`\n🔔 Drive Watcher: ${novos.length} PDF(s) novo(s) detectado(s)`);

    for (const arquivo of novos) {
      await processarPDF(drive, arquivo);
    }

  } catch (err) {
    console.error(`❌ Drive Watcher erro: ${err.message}`);
  }
}

// ── START / STOP / STATUS ─────────────────────────────────────────────────────

export function iniciarWatcher() {
  if (!FOLDER_ID) {
    console.warn('⚠️ DRIVE_FOLDER_FATURAS não configurado. Drive Watcher desativado.');
    return;
  }

  if (!fs.existsSync(TOKEN_PATH)) {
    console.warn('⚠️ token.json não encontrado. Rode: node src/tools/drive-auth.js');
    return;
  }

  stats.ativo = true;
  console.log(`👁️ Drive Watcher ativo — pasta ${FOLDER_ID} — intervalo ${POLL_INTERVAL / 1000}s`);

  // Primeira verificação imediata
  verificar();

  // Depois a cada 2 minutos
  intervalId = setInterval(verificar, POLL_INTERVAL);
}

export function pararWatcher() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stats.ativo = false;
  console.log('⏹️ Drive Watcher parado');
}

export function getStatus() {
  return { ...stats };
}
