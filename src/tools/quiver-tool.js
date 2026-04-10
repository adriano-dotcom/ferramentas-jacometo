/**
 * JARVIS — Quiver Tool (cadastro de faturas transporte)
 * =====================================================
 * Envia PDFs de faturas para api-ferramentas.jacometo.com.br
 * O backend do outro Mac Mini faz:
 *   1. Extrai dados do PDF via Claude Vision
 *   2. Abre Playwright no Quiver PRO
 *   3. Cadastra a fatura automaticamente
 *
 * Endpoint: POST /api/quiver-faturas-transporte/cadastrar (multipart)
 * Status:   GET  /api/quiver-faturas-transporte/status/:jobId
 */

import axios from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.ARQUIVO_URL || 'https://api-ferramentas.jacometo.com.br';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

const POLL_INTERVAL = 3000;
const MAX_WAIT = 180000; // 3 min — extração + Playwright demora

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Cadastra faturas de transporte enviando PDFs para o backend RPA.
 * O backend faz extração + cadastro no Quiver PRO automaticamente.
 * Se dados_extraidos for fornecido, envia junto para o backend usar
 * em vez de fazer sua própria extração.
 *
 * @param {Array<{buffer: Buffer, nome: string, dados_extraidos?: object}>} pdfs — array de PDFs
 * @returns {Promise<{sucesso: boolean, mensagem: string, jobId?: string, resultado?: object}>}
 */
export async function cadastrarFaturas(pdfs) {
  if (!pdfs || pdfs.length === 0) {
    return { sucesso: false, mensagem: 'Nenhum PDF fornecido.' };
  }

  console.log(`  📋 Quiver: enviando ${pdfs.length} PDF(s) para cadastro`);

  // 1. Monta multipart com os PDFs + dados extraídos
  const form = new FormData();
  for (const pdf of pdfs) {
    form.append('arquivos', pdf.buffer, {
      filename: pdf.nome || 'fatura.pdf',
      contentType: 'application/pdf',
    });
  }

  // Envia dados extraídos para o backend usar (evita re-extração e garante dados corretos)
  const dadosList = pdfs.filter(p => p.dados_extraidos).map(p => p.dados_extraidos);
  if (dadosList.length > 0) {
    form.append('dados_extraidos', JSON.stringify(dadosList));
  }

  // 2. Envia para o backend
  let jobId;
  try {
    const res = await api.post('/api/quiver-faturas-transporte/cadastrar', form, {
      headers: form.getHeaders(),
      timeout: 60000,
    });
    jobId = res.data?.jobId || res.data?.job_id;
  } catch (err) {
    return {
      sucesso: false,
      mensagem: `Erro ao enviar PDFs: ${err.response?.data?.erro || err.message}`,
    };
  }

  if (!jobId) {
    return { sucesso: false, mensagem: 'API não retornou jobId.' };
  }

  console.log(`  🆔 Job: ${jobId}`);

  // 3. Poll status até concluir
  return pollStatus(jobId);
}

/**
 * Cadastra uma única fatura (conveniência).
 */
export async function cadastrarFatura(dados) {
  // Se recebeu buffer direto, envia como PDF
  if (dados.buffer) {
    return cadastrarFaturas([{ buffer: dados.buffer, nome: dados.nome || 'fatura.pdf' }]);
  }

  // Se recebeu dados estruturados sem PDF, precisa buscar o PDF primeiro
  return {
    sucesso: false,
    mensagem: 'cadastrarFatura precisa de um PDF (buffer). Use buscar_fatura_drive para baixar o PDF primeiro, depois envie aqui.',
  };
}

/**
 * Consulta status de um job de cadastro.
 */
export async function pollStatus(jobId) {
  const start = Date.now();

  while ((Date.now() - start) < MAX_WAIT) {
    await sleep(POLL_INTERVAL);

    try {
      const res = await api.get(`/api/quiver-faturas-transporte/status/${jobId}`);
      const job = res.data || res;

      if (job.status === 'concluido') {
        const resultados = job.resultados || [];
        const ok = resultados.filter(r => r.status === 'OK');
        const falha = resultados.filter(r => r.status === 'FALHA');

        return {
          sucesso: falha.length === 0,
          mensagem: `${ok.length} cadastrada(s), ${falha.length} falha(s)`,
          jobId,
          resultado: {
            total: resultados.length,
            ok: ok.map(r => ({
              segurado: r.segurado, apolice: r.apolice,
              endosso: r.endosso, premio: r.premio_liquido,
            })),
            falhas: falha.map(r => ({
              segurado: r.segurado, apolice: r.apolice,
              erro: r.label || r.erro, acao: r.orientacao,
            })),
          },
        };
      }

      if (job.status === 'erro_critico') {
        return {
          sucesso: false, mensagem: `Erro crítico: ${job.erro}`, jobId,
        };
      }

      // extraindo, cadastrando — continua
      const progresso = job.progresso ? `${job.progresso}/${job.total}` : job.status;
      console.log(`  ⏳ Job ${jobId}: ${progresso} (${Math.round((Date.now() - start) / 1000)}s)`);

    } catch (err) {
      if (err.response?.status === 404) {
        return { sucesso: false, mensagem: `Job ${jobId} não encontrado.`, jobId };
      }
      console.warn(`  ⚠️ Poll falhou: ${err.message}`);
    }
  }

  return {
    sucesso: false,
    mensagem: `Timeout: job ${jobId} não concluiu em ${MAX_WAIT / 1000}s.`,
    jobId,
  };
}
