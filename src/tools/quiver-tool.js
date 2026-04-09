/**
 * JARVIS — Quiver Tool (cadastro de faturas transporte)
 * =====================================================
 * Envia dados de fatura para ferramentas.jacometo.com.br
 * que executa o cadastro no Quiver PRO via Playwright.
 */

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.ARQUIVO_URL || 'https://ferramentas.jacometo.com.br';
const TOKEN    = process.env.ARQUIVO_TOKEN;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`,
    'X-Jarvis-OS': '2',
  },
});

api.interceptors.response.use(
  r => r.data,
  e => { throw new Error(`Quiver API: ${e.response?.data?.error || e.message}`); }
);

const POLL_INTERVAL = 3000;
const MAX_WAIT = 120000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Cadastra fatura de seguradora de transporte no Quiver PRO.
 *
 * @param {Object} dados
 * @param {string} dados.seguradora — tokio|akad|sompo|axa|chubb|allianz
 * @param {string} dados.apolice — número da apólice (já formatado)
 * @param {string} dados.endosso — número do endosso
 * @param {number} dados.premio — valor do prêmio líquido
 * @param {number} [dados.iof] — valor do IOF
 * @param {string} dados.vencimento — DD/MM/YYYY
 * @param {string} dados.ramo — RCTR-C|RC-DC|TRANSPORTE_NACIONAL
 * @param {string} [dados.competencia] — MM/YYYY
 * @returns {Promise<{sucesso: boolean, mensagem: string, resultado?: object}>}
 */
export async function cadastrarFatura(dados) {
  console.log(`  📋 Quiver: cadastrando fatura ${dados.seguradora} — ${dados.apolice}`);

  // 1. Dispara job
  let jobId;
  try {
    const res = await api.post('/api/quiver-faturas-transporte/executar', {
      ...dados,
      origem: 'jarvis-os-caixa',
      timestamp: new Date().toISOString(),
    });
    jobId = res.job_id || res.jobId || res.id;
  } catch (err) {
    return {
      sucesso: false,
      mensagem: `Erro ao disparar cadastro: ${err.message}. Verificar se ferramentas.jacometo.com.br está online.`,
    };
  }

  if (!jobId) {
    return { sucesso: false, mensagem: 'API não retornou job_id. Verificar endpoint.' };
  }

  // 2. Poll status
  const start = Date.now();
  while ((Date.now() - start) < MAX_WAIT) {
    await sleep(POLL_INTERVAL);

    try {
      const status = await api.get(`/api/quiver-faturas-transporte/status/${jobId}`);

      if (status.status === 'done') {
        return {
          sucesso: true,
          mensagem: `Fatura cadastrada com sucesso: ${dados.seguradora} ${dados.apolice}`,
          resultado: status.resultado || status,
        };
      }

      if (status.status === 'error') {
        return {
          sucesso: false,
          mensagem: `Erro no cadastro: ${status.error || 'erro desconhecido'}`,
          resultado: status,
        };
      }

      // queued ou running — continua polling
      console.log(`  ⏳ Job ${jobId}: ${status.status} (${Math.round((Date.now() - start) / 1000)}s)`);
    } catch (err) {
      console.warn(`  ⚠️ Poll falhou: ${err.message}`);
    }
  }

  return {
    sucesso: false,
    mensagem: `Timeout: job ${jobId} não concluiu em ${MAX_WAIT / 1000}s. Verifique manualmente.`,
  };
}
