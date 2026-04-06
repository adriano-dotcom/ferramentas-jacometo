'use client'
import { useState } from 'react'
import Link from 'next/link'
import { JobStatus, useJobPolling, type Job } from '../../../components/JobStatus'

export default function GiacometAkadPage() {
  const [executando, setExecutando] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio] = useState('')

  useJobPolling(
    job?.status !== 'concluido' && job?.status !== 'erro_critico' ? job?.id ?? null : null,
    setJob,
    '/giacomet-akad-inadimplentes'
  )

  async function executar() {
    setExecutando(true); setErroEnvio('')
    try {
      const res = await fetch('/api/rpa/giacomet-akad-inadimplentes/executar', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro || 'Erro no servidor')
      setJob({ id: data.jobId, status: 'executando', progresso: 0, total: 5, resultados: [], erro: null })
    } catch (e: any) {
      setErroEnvio(e.message)
    } finally {
      setExecutando(false)
    }
  }

  const emProcesso = job && job.status !== 'concluido' && job.status !== 'erro_critico'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <style>{'@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}'}</style>
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Giacomet — AKAD</span>
        {emProcesso && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#B8860B', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#B8860B', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Acessando portal
          </span>
        )}
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Parcelas em Atraso — Giacomet AKAD</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          Acessa o portal, extrai inadimplentes e envia relatório CSV por email. Corretora: GIACOMET.
        </p>

        {!job && (
          <>
            <div style={{ padding: '9px 12px', background: '#FFF3CD', border: '0.5px solid #B8860B', borderRadius: 8, fontSize: 12, color: '#856404', marginBottom: 14 }}>
              Corretora GIACOMET — credenciais específicas configuradas no painel.
            </div>

            <button onClick={executar} disabled={executando} style={{
              width: '100%', padding: '12px',
              background: executando ? 'var(--border)' : '#B8860B',
              color: executando ? 'var(--text-3)' : '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: executando ? 'not-allowed' : 'pointer',
            }}>
              {executando ? '⏳ Iniciando...' : 'Extrair inadimplentes'}
            </button>

            {erroEnvio && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>❌ {erroEnvio}</div>
            )}
          </>
        )}

        <JobStatus
          job={job}
          statusLabel={{ executando: '⚙️ Extraindo dados...', concluido: '✅ Inadimplentes extraídos e relatório enviado' }}
          onNovaExecucao={() => setJob(null)}
        />
      </div>
    </div>
  )
}
