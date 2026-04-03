'use client'
import { useState } from 'react'
import Link from 'next/link'
import { JobStatus, useJobPolling, type Job } from '../../../components/JobStatus'

const CATEGORIAS = [
  { id: 'vida',    nome: 'Vida',             cor: '#E24B4A', desc: 'MULTIVIDA, GLOBAL VIDA, VIDA MULHER...' },
  { id: 'ramos',   nome: 'Ramos Elementares', cor: '#185FA5', desc: 'Produtos elementares' },
  { id: 'prev',    nome: 'Previdência',        cor: '#1D9E75', desc: 'Planos previdenciários' },
]

export default function UnimedSegurosInadimplentesPage() {
  const [executando, setExecutando] = useState(false)
  const [job, setJob]               = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio]   = useState('')

  useJobPolling(
    job?.status !== 'concluido' && job?.status !== 'erro_critico' ? job?.id ?? null : null,
    setJob,
    '/unimed-seguros-inadimplentes'
  )

  async function executar() {
    setExecutando(true); setErroEnvio('')
    try {
      const res  = await fetch('/api/rpa/unimed-seguros-inadimplentes/executar', { method: 'POST' })
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
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Unimed Seguros — Inadimplentes</span>
        {emProcesso && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Verificando categorias
          </span>
        )}
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Inadimplentes — Unimed Seguros</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          Acessa o portal Unimed Seguros e extrai o Relatório de Inadimplência em 3 categorias separadamente.
        </p>

        {!job && (
          <>
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
              {/* Portal */}
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Portal</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>portal.segurosunimed.com.br</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>Login SSO · Relatórios → Relatório de Inadimplência</div>
              </div>

              {/* 3 categorias */}
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Categorias verificadas em sequência</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {CATEGORIAS.map((c, i) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', background: c.cor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0 }}>{i + 1}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{c.nome}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Período */}
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Período</div>
                <div style={{ fontSize: 13 }}>01/01/{new Date().getFullYear()} até hoje</div>
              </div>

              {/* Resultado */}
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Resultado</div>
                <div style={{ fontSize: 13 }}>Email + CSV para <strong>jacometo@jacometo.com.br</strong></div>
              </div>
            </div>

            <div style={{ padding: '8px 12px', marginBottom: 14, background: '#FAEEDA', border: '0.5px solid #BA7517', borderRadius: 8, fontSize: 12, color: '#633806' }}>
              ⚠️ O portal Unimed Seguros usa SSO e pode ter sessões curtas. Se uma categoria falhar, as outras continuam sendo processadas.
            </div>

            <button onClick={executar} disabled={executando} style={{
              width: '100%', padding: '12px',
              background: executando ? 'var(--border)' : '#E24B4A',
              color: executando ? 'var(--text-3)' : '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: executando ? 'not-allowed' : 'pointer',
            }}>
              {executando ? '⏳ Iniciando...' : 'Extrair inadimplentes — 3 categorias'}
            </button>

            {erroEnvio && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>❌ {erroEnvio}</div>
            )}
          </>
        )}

        <JobStatus
          job={job}
          statusLabel={{
            executando: '⚙️  Verificando categorias Vida, Ramos Elementares, Previdência...',
            concluido:  '✅ Todas as categorias verificadas e relatório enviado',
          }}
          onNovaExecucao={() => setJob(null)}
        />
      </div>
    </div>
  )
}
