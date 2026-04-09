'use client'
import { useState } from 'react'
import Link from 'next/link'
import { JobStatus, useJobPolling, type Job } from '../../../components/JobStatus'

export default function Page() {
  const [executando, setExecutando] = useState(false)
  const [job, setJob]               = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio]   = useState('')

  useJobPolling(
    job?.status !== 'concluido' && job?.status !== 'erro_critico' ? job?.id ?? null : null,
    setJob,
    '/essor-inadimplentes'
  )

  async function executar() {
    setExecutando(true); setErroEnvio('')
    try {
      const res  = await fetch('/api/rpa/essor-inadimplentes/executar', { method: 'POST' })
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
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/ </span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Essor — Parcelas Pendentes</span>
        {emProcesso && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Acessando portal
          </span>
        )}
      </div>
      <div style={{ maxWidth: 540, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Parcelas Pendentes — Essor</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem', lineHeight: 1.5 }}>Acessa o portal Essor com CNPJ da Jacometo, extrai parcelas pendentes com dias em atraso.</p>
        {!job && (
          <>
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Portal</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>portal.essor.com.br</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>Consultas → Parcelas Pendentes</div>
              </div>
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Etapas</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, color: 'var(--text-2)' }}><span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>1</span>Login Essor (CNPJ)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, color: 'var(--text-2)' }}><span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>2</span>Consultas → Parcelas Pendentes</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, color: 'var(--text-2)' }}><span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>3</span>Pesquisa</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, color: 'var(--text-2)' }}><span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>4</span>Extração + CSV</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, color: 'var(--text-2)' }}><span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>5</span>Email enviado</div>
              </div>
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Resultado</div>
                <div style={{ fontSize: 13 }}>Email + CSV para <strong>jacometo@jacometo.com.br</strong></div>
              </div>
            </div>
            
            <div style={{ padding: '8px 12px', marginBottom: 14, background: '#E6F1FB', border: '0.5px solid #185FA5', borderRadius: 8, fontSize: 12, color: '#0C447C' }}>
              ℹ️ Login com CNPJ (16959586000156). Inclui coluna de dias em atraso por parcela.
            </div>
            <button onClick={executar} disabled={executando} style={{ width: '100%', padding: '12px', background: executando ? 'var(--border)' : '#185FA5', color: executando ? 'var(--text-3)' : '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: executando ? 'not-allowed' : 'pointer' }}>
              {executando ? '⏳ Iniciando...' : 'Extrair inadimplentes'}
            </button>
            {erroEnvio && <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>❌ {erroEnvio}</div>}
          </>
        )}
        <JobStatus job={job} statusLabel={{ executando: '⚙️  Acessando portal...', concluido: '✅ Inadimplentes extraídos e relatório enviado' }} onNovaExecucao={() => setJob(null)} />
      </div>
    </div>
  )
}
