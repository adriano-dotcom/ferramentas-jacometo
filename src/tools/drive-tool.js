/**
 * JARVIS — Google Drive Tool (faturas PDF)
 * =========================================
 * Lista e baixa PDFs de faturas de seguradoras no Google Drive.
 * Lazy init: não falha se credenciais não configuradas.
 */

import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH;
const FOLDER_ID        = process.env.DRIVE_FOLDER_FATURAS;

let driveClient = null;

function getDrive() {
  if (driveClient) return driveClient;

  if (!CREDENTIALS_PATH) {
    throw new Error('GOOGLE_CREDENTIALS_PATH não configurado no .env');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  driveClient = google.drive({ version: 'v3', auth });
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

    // Monta query
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
      // Aceita MM/YYYY ou YYYY-MM
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

    // Metadados
    const meta = await drive.files.get({
      fileId,
      fields: 'name, mimeType',
    });

    // Download
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
