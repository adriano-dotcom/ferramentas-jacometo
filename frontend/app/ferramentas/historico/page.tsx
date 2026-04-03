'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase, type JobHistory } from '../../../lib/supabase'

const RESPONSAVEIS = ['Todos', 'João', 'Giovana', 'Bárbara']
const CORES: Record<string, string> = {
  'João': '#185FA5', 'Giovana': '#1D9E75', 'Bárbara': '#993556',
}
const STATUS_COR: Record<string, { bg: string; text: string; label: string }> = {
  concluido:    { bg: '#E1F5EE', text: '#085041', label: 'OK' },
  erro_critico: { bg: '#FCEBEB', text: '#791F1F', label: 'Erro' },
  executando:   { bg: '#E6F1FB', text: '#0C447C', label: 'Rodando' },
}

function fmt(val: number) {
  return val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}
function fmtData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function fmtDuracao(seg: number | null) {
  if (!seg) return '—'
  if (seg < 60) return `${seg}s`
  return `${Math.floor(seg / 60)}m ${seg % 60}s`
}

export default function HistoricoPage() {
  const [jobs, setJobs]           = useState<JobHistory[]>([])
  const [loading, setLoading]     = useState(true)
  const [filtroResp, setFiltroResp] = useState('Todos')
  const [filtroSeg, setFiltroSeg]   = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const carregar = useCallback(async () => {
    let q = supabase
      .from('jobs_history')
      .select('*')
      .order('iniciado_em', { ascending: false })
      .limit(100)

    if (filtroResp !== 'Todos') q = q.eq('responsavel', filtroResp)
    if (filtroSeg)              q = q.ilike('seguradora_nome', `%${filtroSeg}%`)

    const { data } = await q
    if (data) setJobs(data as JobHistory[])
    setLoading(false)
  }, [filtroResp, filtroSeg])

  useEffect(() => {
    carregar()
    if (!autoRefresh) return
    const t = setInterval(carregar, 8000)
    return () => clearInterval(t)
  }, [carregar, autoRefresh])

  // Resumo
  const total    = jobs.length
  const ok       = jobs.filter(j => j.status === 'concluido').length
  const erros    = jobs.filter(j => j.status === 'erro_critico').length
  const rodando  = jobs.filter(j => j.status === 'executando').length
  const valorTotal = jobs.filter(j => j.status === 'concluido').reduce((a, j) => a + (j.valor_total || 0), 0)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Histórico de Execuções</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {rodando > 0 && (
            <span style={{ fontSize: 11, color: '#185FA5', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#185FA5', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
              {rodando} rodando
            </span>
          )}
          <button onClick={() => setAutoRefresh(!autoRefresh)} style={{ fontSize: 11, padding: '3px 9px', border: '0.5px solid var(--border)', borderRadius: 6, background: autoRefresh ? '#E1F5EE' : 'none', color: autoRefresh ? '#085041' : 'var(--text-3)', cursor: 'pointer' }}>
            {autoRefresh ? '⟳ Auto' : 'Auto'}
          </button>
          <button onClick={carregar} style={{ fontSize: 11, padding: '3px 9px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'var(--text-2)' }}>
            Atualizar
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.5rem 1rem' }}>

        {/* Cards de resumo */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Total', valor: total,  cor: 'var(--text-2)' },
            { label: 'OK',    valor: ok,     cor: '#085041' },
            { label: 'Erros', valor: erros,  cor: '#791F1F' },
            { label: 'Valor',  valor: `R$ ${fmt(valorTotal)}`, cor: '#185FA5' },
          ].map(c => (
            <div key={c.label} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: c.cor }}>{c.valor}</div>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {RESPONSAVEIS.map(r => (
              <button key={r} onClick={() => setFiltroResp(r)} style={{
                fontSize: 12, padding: '5px 12px', borderRadius: 20, border: '0.5px solid var(--border)',
                background: filtroResp === r ? (CORES[r] || '#5F5E5A') : 'var(--surface)',
                color: filtroResp === r ? '#fff' : 'var(--text-2)', cursor: 'pointer',
              }}>{r}</button>
            ))}
          </div>
          <input value={filtroSeg} onChange={e => setFiltroSeg(e.target.value)}
            placeholder="Filtrar seguradora..."
            style={{ flex: 1, minWidth: 140, padding: '5px 10px', border: '0.5px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
          />
        </div>

        {/* Lista de jobs */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '3rem', fontSize: 14 }}>Carregando histórico...</div>
        ) : jobs.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '3rem', fontSize: 14 }}>Nenhum job encontrado. Execute uma automação para ver o histórico aqui.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {jobs.map(job => {
              const st = STATUS_COR[job.status] || STATUS_COR.executando
              const corResp = CORES[job.responsavel] || '#5F5E5A'
              return (
                <div key={job.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Status */}
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: st.bg, color: st.text, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {job.status === 'executando' && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#185FA5', marginRight: 4, animation: 'pulse 1.2s ease-in-out infinite' }} />}
                    {st.label}
                  </span>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {job.seguradora_nome}
                      <span style={{ fontSize: 10, color: corResp, padding: '1px 6px', borderRadius: 10, background: `${corResp}18` }}>{job.responsavel}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                      {fmtData(job.iniciado_em)} · {fmtDuracao(job.duracao_seg)}
                      {job.total_itens > 0 && ` · ${job.total_itens} item(s)`}
                      {job.total_erros > 0 && ` · ${job.total_erros} erro(s)`}
                      {job.valor_total > 0 && ` · R$ ${fmt(job.valor_total)}`}
                    </div>
                    {job.erro_msg && <div style={{ fontSize: 11, color: '#791F1F', marginTop: 2 }}>✗ {job.erro_msg.substring(0, 80)}</div>}
                  </div>

                  {/* Job ID */}
                  <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace', flexShrink: 0 }}>{job.job_id.substring(0, 8)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
