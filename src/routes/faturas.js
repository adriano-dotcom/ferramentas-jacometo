/**
 * JARVIS — Rotas de Faturas (erros + correção)
 * ==============================================
 * GET  /api/faturas/erros       — lista faturas com erro
 * POST /api/faturas/:id/corrigir — corrige e reprocessa
 */

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';

const router = Router();

/**
 * GET /api/faturas/log
 * Lista todas as faturas processadas (sucesso + erro).
 */
router.get('/log', async (req, res) => {
  try {
    const { limit = 100, status, seguradora } = req.query;

    let query = supabase
      .from('faturas_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (status) query = query.eq('status', status);
    if (seguradora) query = query.eq('seguradora', seguradora);

    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, erro: error.message });

    res.json({ ok: true, total: data.length, faturas: data });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

/**
 * GET /api/faturas/erros
 * Lista faturas com status 'erro' ou 'revisao', mais recentes primeiro.
 */
router.get('/erros', async (req, res) => {
  try {
    const { limit = 50, seguradora } = req.query;

    let query = supabase
      .from('faturas_log')
      .select('*')
      .in('status', ['erro', 'revisao'])
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (seguradora) query = query.eq('seguradora', seguradora);

    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, erro: error.message });

    res.json({ ok: true, total: data.length, faturas: data });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

/**
 * POST /api/faturas/:id/corrigir
 * Recebe dados corrigidos, salva, tenta reprocessar no Quiver,
 * e registra o caso de erro + correção para treinamento.
 */
router.post('/:id/corrigir', async (req, res) => {
  try {
    const { id } = req.params;
    const { dados_corrigidos } = req.body;

    if (!dados_corrigidos) {
      return res.status(400).json({ ok: false, erro: 'dados_corrigidos é obrigatório' });
    }

    // 1. Busca o registro original
    const { data: fatura, error: fetchErr } = await supabase
      .from('faturas_log')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !fatura) {
      return res.status(404).json({ ok: false, erro: 'Fatura não encontrada' });
    }

    // 2. Salva dados corrigidos
    await supabase.from('faturas_log').update({
      dados_corrigidos,
      status: 'reprocessando',
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    // 3. Tenta cadastrar no Quiver com dados corrigidos
    let resultado;
    try {
      const { cadastrarFaturas } = await import('../tools/quiver-tool.js');

      // Monta um "PDF fake" — na verdade envia os dados já extraídos
      // O backend do outro Mac Mini aceita dados JSON também
      const axios = (await import('axios')).default;
      const BASE_URL = process.env.ARQUIVO_URL || 'https://api-ferramentas.jacometo.com.br';

      // Envia como JSON direto para o endpoint de cadastro manual
      const resp = await axios.post(`${BASE_URL}/api/quiver-faturas-transporte/cadastrar-manual`, {
        ...dados_corrigidos,
        origem: 'correcao-jarvis',
      }, { timeout: 30000 });

      const jobId = resp.data?.jobId;
      if (jobId) {
        const { pollStatus } = await import('../tools/quiver-tool.js');
        resultado = await pollStatus(jobId);
      } else {
        resultado = { sucesso: false, mensagem: 'Endpoint manual não retornou jobId' };
      }
    } catch (err) {
      resultado = { sucesso: false, mensagem: err.message };
    }

    // 4. Atualiza status
    const novoStatus = resultado.sucesso ? 'sucesso' : 'erro';
    await supabase.from('faturas_log').update({
      status: novoStatus,
      quiver_job_id: resultado.jobId || fatura.quiver_job_id,
      erro_mensagem: resultado.sucesso ? null : resultado.mensagem,
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    // 5. Salva caso de erro + correção para treinamento
    if (fatura.dados_extraidos && dados_corrigidos) {
      await supabase.from('regras_seguradora').upsert({
        seguradora: fatura.seguradora,
        tipo: 'caso_erro',
        dados_errados: fatura.dados_extraidos,
        dados_corretos: dados_corrigidos,
        descricao: `Correção: ${fatura.erro_mensagem || 'manual'} — arquivo ${fatura.arquivo}`,
      }, { onConflict: 'seguradora,tipo,descricao' });
    }

    res.json({
      ok: true,
      status: novoStatus,
      mensagem: resultado.sucesso
        ? 'Fatura corrigida e cadastrada com sucesso'
        : `Correção salva mas cadastro falhou: ${resultado.mensagem}`,
      resultado,
    });

  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

export default router;
