'use client'
import { useState } from 'react'
import Link from 'next/link'
import { JobStatus, useJobPolling, type Job } from '../../../components/JobStatus'

const SEGURADORAS = [
  { id: 'allianz',  nome: 'Allianz' },
  { id: 'tokio',   nome: 'Tokio Marine' },
  { id: 'axa',     nome: 'AXA' },
  { id: 'sompo',   nome: 'Sompo' },
  { id: 'akad',    nome: 'AKAD' },
  { id: 'chubb',   nome: 'Chubb' },
  { id: 'yelum',   nome: 'Yelum' },
  { id: 'unimed',  nome: 'Unimed' },
  { id: 'mitsui',  nome: 'Mitsui' },
  { id: 'essor',   nome: 'Essor' },
  { id: 'metlife', nome: 'MetLife' },
]

export default function RelatorioParcelasPage() {
  const [selecionadas, setSelecionadas] = useState<string[]>(SEGURADORAS.map(s => s.id))
  const [enviando, setEnviando]         = useState(false)
  const [job, setJob]                   = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio]       = useState('')

  useJobPolling(
    job?.status !== 'concluido' && job?.status !== 'erro_critico' ? job?.id ?? null : null,
    setJob,
    '/relatorio-parcelas'
  )

  function toggle(id: string) {
    setSelecionadas(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  async function gerar() {
    setEnviando(true); setErroEnvio('')
    try {
      const res  = await fetch('/api/rpa/relatorio-parcelas/gerar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seguradoras: selecionadas }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro || 'Erro no servidor')
      setJob({ id: data.jobId || 'parc-' + Date.now(), status: 'executando', progresso: 0, total: selecionadas.length, resultados: [], erro: null })
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
        <span style={{ fontSize: 13, fontWeight: 500 }}>Parcelas em Atraso</span>
        {job && job.status !== 'concluido' && job.status !== 'erro_critico' && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Acessando portais
          </span>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Relatório de Inadimplência</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem' }}>Selecione as seguradoras. O sistema acessa cada portal e extrai as parcelas em atraso.</p>
        {!job && (
          <>
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Seguradoras</span>
                <button onClick={() => setSelecionadas(selecionadas.length === SEGURADORAS.length ? [] : SEGURADORAS.map(s => s.id))} style={{ background: 'none', border: 'none', fontSize: 12, color: '#1D9E75', cursor: 'pointer' }}>
                  {selecionadas.length === SEGURADORAS.length ? 'Desmarcar todas' : 'Selecionar todas'}
                </button>
              </div>
              {SEGURADORAS.map((s, i) => (
                <div key={s.id} onClick={() => toggle(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer', borderBottom: i < SEGURADORAS.length - 1 ? '0.5px solid var(--border)' : 'none', background: selecionadas.includes(s.id) ? '#E1F5EE' : 'transparent', transition: 'background 0.1s' }}>
                  <div style={{ width: 18, height: 18, border: `1.5px solid ${selecionadas.includes(s.id) ? '#1D9E75' : 'var(--border-strong)'}`, borderRadius: 4, background: selecionadas.includes(s.id) ? '#1D9E75' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', flexShrink: 0 }}>
                    {selecionadas.includes(s.id) ? '✓' : ''}
                  </div>
                  <span style={{ fontSize: 14 }}>{s.nome}</span>
                </div>
              ))}
            </div>
            <button onClick={gerar} disabled={!selecionadas.length || enviando} style={{ width: '100%', padding: '11px', background: !selecionadas.length || enviando ? 'var(--border)' : '#185FA5', color: !selecionadas.length || enviando ? 'var(--text-3)' : '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500 }}>
              {enviando ? '⏳ Iniciando...' : `Gerar relatório — ${selecionadas.length} seguradora(s)`}
            </button>
            {erroEnvio && <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>❌ {erroEnvio}</div>}
          </>
        )}
        <JobStatus
          job={job}
          statusLabel={{ executando: '⚙️  Acessando portais das seguradoras...', concluido: '✅ Relatórios gerados e enviados por email' }}
          onNovaExecucao={() => { setJob(null) }}
        />
      </div>
    </div>
  )
}
