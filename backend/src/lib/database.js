// src/lib/database.js
// Integração Supabase — salva histórico de jobs e resultados
// Usado pelos jobs ao concluir ou falhar
// Se SUPABASE_URL não estiver configurado, opera em modo silencioso (sem erro)

const { createClient } = require('@supabase/supabase-js')
const log = require('./logger')

// ── Cliente ───────────────────────────────────────────────────────────────────

let _supabase = null

function getClient() {
  if (_supabase) return _supabase
  const url  = process.env.SUPABASE_URL
  const key  = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    log.warn('Supabase não configurado — histórico de jobs desativado. Configure SUPABASE_URL e SUPABASE_SERVICE_KEY no .env')
    return null
  }
  _supabase = createClient(url, key, {
    auth: { persistSession: false },
  })
  return _supabase
}

// ── Mapa de seguradora → metadados ────────────────────────────────────────────

const META = {
  allianz:        { nome: 'Allianz',          responsavel: 'João' },
  tokio:          { nome: 'Tokio Marine',      responsavel: 'João' },
  axa:            { nome: 'AXA',               responsavel: 'João' },
  chubb:          { nome: 'Chubb',             responsavel: 'João' },
  sompo:          { nome: 'Sompo',             responsavel: 'João' },
  akad:           { nome: 'AKAD Digital',      responsavel: 'João' },
  yelum:          { nome: 'Yelum Seguros',     responsavel: 'João' },
  mitsui:         { nome: 'Mitsui (MSIG)',     responsavel: 'João' },
  essor:          { nome: 'Essor',             responsavel: 'João' },
  metlife:        { nome: 'MetLife',           responsavel: 'João' },
  unimed_seguros: { nome: 'Unimed Seguros',    responsavel: 'João' },
  unimed_boletos: { nome: 'Unimed Boletos',    responsavel: 'Giovana' },
  unimed_grupos:  { nome: 'Unimed Grupos',     responsavel: 'Giovana' },
  quiver:         { nome: 'Quiver Faturas',    responsavel: 'Giovana' },
  quiver_transporte: { nome: 'Quiver Transporte', responsavel: 'Giovana' },
  plano_hospitalar: { nome: 'Plano Hospitalar', responsavel: 'Bárbara' },
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Registra início de um job.
 * Chamar logo após criar o jobId, antes do setImmediate.
 */
async function jobIniciado(jobId, seguradora) {
  const db = getClient()
  if (!db) return
  const meta = META[seguradora] || { nome: seguradora, responsavel: 'Sistema' }
  try {
    await db.from('jobs_history').insert({
      job_id:         jobId,
      seguradora,
      seguradora_nome: meta.nome,
      responsavel:    meta.responsavel,
      status:         'executando',
      iniciado_em:    new Date().toISOString(),
    })
  } catch (e) {
    log.warn(`DB jobIniciado: ${e.message}`)
  }
}

/**
 * Registra conclusão bem-sucedida de um job.
 * @param {string} jobId
 * @param {string} seguradora
 * @param {object} dados - { resultados, totalItens, totalErros, valorTotal, csvPath }
 * @param {Date} inicio - Date() do início para calcular duração
 */
async function jobConcluido(jobId, seguradora, dados = {}, inicio = null) {
  const db = getClient()
  if (!db) return

  const { resultados = [], totalItens, totalErros, valorTotal, csvPath } = dados
  const agora = new Date()
  const duracaoSeg = inicio ? Math.round((agora - inicio) / 1000) : null

  // Calcula totais a partir dos resultados se não foram passados
  const itens  = totalItens  ?? resultados.length
  const erros  = totalErros  ?? resultados.filter(r => r.status === 'FALHA').length
  const valor  = valorTotal  ?? 0

  try {
    // Atualiza registro do job
    await db.from('jobs_history').update({
      status:       'concluido',
      total_itens:  itens,
      total_erros:  erros,
      valor_total:  valor,
      csv_path:     csvPath || null,
      concluido_em: agora.toISOString(),
      duracao_seg:  duracaoSeg,
    }).eq('job_id', jobId)

    // Insere resultados individuais (se houver)
    if (resultados.length > 0) {
      const rows = resultados.map(r => ({
        job_id:       jobId,
        nome:         r.nome || '',
        sub:          r.sub  || null,
        status:       r.status || 'OK',
        tipo_erro:    r.tipo  || null,
        label_erro:   r.label || null,
        orientacao:   r.orientacao || null,
        erro_tecnico: r.erro  || null,
      }))
      await db.from('job_results').insert(rows)
    }

    log.ok(`DB: job ${jobId} (${seguradora}) salvo — ${itens} itens, ${erros} erros`)
  } catch (e) {
    log.warn(`DB jobConcluido: ${e.message}`)
  }
}

/**
 * Registra falha crítica de um job.
 */
async function jobErro(jobId, seguradora, erroMsg, inicio = null) {
  const db = getClient()
  if (!db) return
  const agora = new Date()
  const duracaoSeg = inicio ? Math.round((agora - inicio) / 1000) : null
  try {
    await db.from('jobs_history').update({
      status:       'erro_critico',
      erro_msg:     erroMsg,
      concluido_em: agora.toISOString(),
      duracao_seg:  duracaoSeg,
    }).eq('job_id', jobId)
    log.ok(`DB: job ${jobId} (${seguradora}) erro registrado`)
  } catch (e) {
    log.warn(`DB jobErro: ${e.message}`)
  }
}

/**
 * Busca clientes do Plano Hospitalar por dia de vencimento.
 * Usado pelo job plano-hospitalar.js em vez da planilha.
 */
async function buscarClientesPlanoHospitalar(diaVenc) {
  const db = getClient()
  if (!db) return null  // fallback: job usa planilha enviada pelo usuário

  try {
    const query = db.from('clientes_plano_hospitalar').select('*').eq('ativo', true)
    if (diaVenc) query.eq('vencimento', diaVenc)

    const { data, error } = await query.order('nome')
    if (error) throw error
    return data || []
  } catch (e) {
    log.warn(`DB buscarClientes: ${e.message}`)
    return null
  }
}

/**
 * Busca histórico de jobs para o dashboard.
 */
async function buscarHistorico({ seguradora, responsavel, limite = 50 } = {}) {
  const db = getClient()
  if (!db) return []
  try {
    let q = db.from('jobs_history').select('*').order('iniciado_em', { ascending: false }).limit(limite)
    if (seguradora)  q = q.eq('seguradora', seguradora)
    if (responsavel) q = q.eq('responsavel', responsavel)
    const { data } = await q
    return data || []
  } catch (e) {
    log.warn(`DB buscarHistorico: ${e.message}`)
    return []
  }
}

module.exports = {
  jobIniciado,
  jobConcluido,
  jobErro,
  buscarClientesPlanoHospitalar,
  buscarHistorico,
}
