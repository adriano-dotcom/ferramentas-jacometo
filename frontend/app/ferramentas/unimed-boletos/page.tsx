'use client'
import { useState } from 'react'
import Link from 'next/link'
import { JobStatus, useJobPolling, type Job } from '../../../components/JobStatus'

export default function UnimedBoletosPage() {
  const [dia, setDia]           = useState<string>('')
  const [enviando, setEnviando] = useState(false)
  const [job, setJob]           = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio] = useState('')

  const diaHoje = new Date().getDate()
  const diaAuto = [5,10,15].includes(diaHoje) ? diaHoje : null

  useJobPolling(
    job?.status !== 'concluido' && job?.status !== 'erro_critico' ? job?.id ?? null : null,
    setJob,
    '/unimed-boletos'
  )

  async function executar() {
    setEnviando(true); setErroEnvio('')
    try {
      const res  = await fetch('/api/rpa/unimed-boletos/executar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dia: dia || diaAuto }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro || 'Erro no servidor')
      setJob({ id: data.jobId || 'boletos-' + Date.now(), status: 'executando', progresso: 0, total: 0, resultados: [], erro: null })
    } catch (e: any) {
      setErroEnvio(e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Unimed — Boletos Vida</span>
        {job && job.status !== 'concluido' && job.status !== 'erro_critico' && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Processando
          </span>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>2ª Via de Boletos</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem' }}>O sistema entra no portal Unimed e baixa os boletos de todos os grupos.</p>
        {!job && (
          <>
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Lote a processar</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[5,10,15].map(d => (
                  <button key={d} onClick={() => setDia(String(d))} style={{ flex: 1, padding: '10px', border: `0.5px solid ${dia === String(d) ? '#1D9E75' : 'var(--border-strong)'}`, borderRadius: 8, background: dia === String(d) ? '#E1F5EE' : 'var(--bg)', color: dia === String(d) ? '#085041' : 'var(--text-2)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                    Dia {d}
                    {diaAuto === d && <div style={{ fontSize: 10, color: '#1D9E75', marginTop: 2 }}>hoje</div>}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={executar} disabled={enviando} style={{ width: '100%', padding: '11px', background: enviando ? 'var(--border)' : '#1D9E75', color: enviando ? 'var(--text-3)' : '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500 }}>
              {enviando ? '⏳ Iniciando...' : 'Executar agora'}
            </button>
            {erroEnvio && <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>❌ {erroEnvio}</div>}
          </>
        )}
        <JobStatus
          job={job}
          statusLabel={{ baixando: '⬇️  Baixando boletos do portal Unimed...', concluido: '✅ Boletos baixados e salvos no Drive' }}
          onNovaExecucao={() => { setJob(null); setDia('') }}
        />
      </div>
    </div>
  )
}
