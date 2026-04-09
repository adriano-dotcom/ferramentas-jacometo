/**
 * JARVIS — Google Drive Tool (faturas PDF)
 * =========================================
 * Lista e baixa PDFs de faturas de seguradoras no Google Drive.
 * Usa OAuth2 (installed app) com refresh token salvo em token.json.
 * Lazy init: não falha se credenciais não configuradas.
 */

import { google } from 'googleapis';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
const TOKEN_PATH       = './token.json';
const FOLDER_ID        = process.env.DRIVE_FOLDER_FATURAS;

let driveClient = null;

function getDrive() {
  if (driveClient) return driveClient;

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`Credenciais não encontradas: ${CREDENTIALS_PATH}. Rode: node src/tools/drive-auth.js`);
  }

  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('Token OAuth2 não encontrado. Rode: node src/tools/drive-auth.js');
  }

  const { installed } = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret } = installed;

  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3333');
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oauth2.setCredentials(tokens);

  // Salva tokens renovados automaticamente
  oauth2.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });

  driveClient = google.drive({ version: 'v3', auth: oauth2 });
  return driveClient;
}

/**
 * Lista PDFs de faturas no Google Drive filtrados por seguradora e mês.
 *
 * @param {string} seguradora — nome para filtrar (tokio, akad, sompo, etc.)
 * @param {string} [mes] — mês no formato MM/YYYY ou YYYY-MM
 * @returns {Promise<{ok: boolean, arquivos: Array}>}
 */
export async function listarFaturasDrive(seguradora, mes) {
  try {
    const drive = getDrive();

    const qParts = [
      `mimeType = 'application/pdf'`,
      `trashed = false`,
    ];

    if (FOLDER_ID) {
      qParts.push(`'${FOLDER_ID}' in parents`);
    }

    if (seguradora) {
      qParts.push(`name contains '${seguradora}'`);
    }

    if (mes) {
      const normalized = mes.includes('/') ? mes : mes.split('-').reverse().join('/');
      qParts.push(`name contains '${normalized}'`);
    }

    const res = await drive.files.list({
      q: qParts.join(' and '),
      fields: 'files(id, name, size, createdTime, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 50,
    });

    return {
      ok: true,
      arquivos: (res.data.files || []).map(f => ({
        id: f.id,
        nome: f.name,
        tamanho: f.size ? `${Math.round(f.size / 1024)}KB` : '?',
        criado: f.createdTime,
        modificado: f.modifiedTime,
      })),
    };
  } catch (err) {
    return { ok: false, erro: err.message, arquivos: [] };
  }
}

/**
 * Baixa um PDF do Google Drive.
 *
 * @param {string} fileId — ID do arquivo no Drive
 * @returns {Promise<{ok: boolean, buffer?: Buffer, nome?: string}>}
 */
export async function baixarPDF(fileId) {
  try {
    const drive = getDrive();

    const meta = await drive.files.get({
      fileId,
      fields: 'name, mimeType',
    });

    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    return {
      ok: true,
      buffer: Buffer.from(res.data),
      nome: meta.data.name,
      mimeType: meta.data.mimeType,
    };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}
