'use client'
import { useState } from 'react'
import Link from 'next/link'
import { JobStatus, useJobPolling, type Job } from '../../../components/JobStatus'

const ETAPAS = ['Login AllianzNet', 'Gestão de Inadimplentes', 'Extração de dados', 'Geração CSV', 'Email enviado']

export default function AllianzInadimplentesPage() {
  const [executando, setExecutando] = useState(false)
  const [job, setJob]               = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio]   = useState('')

  useJobPolling(
    job?.status !== 'concluido' && job?.status !== 'erro_critico' ? job?.id ?? null : null,
    setJob,
    '/allianz-inadimplentes'
  )

  async function executar() {
    setExecutando(true); setErroEnvio('')
    try {
      const res  = await fetch('/api/rpa/allianz-inadimplentes/executar', { method: 'POST' })
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
        <span style={{ fontSize: 13, fontWeight: 500 }}>Allianz — Gestão de Inadimplentes</span>
        {emProcesso && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Acessando AllianzNet
          </span>
        )}
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Parcelas em Atraso — Allianz</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          Acessa o AllianzNet, extrai todos os inadimplentes (todas as páginas) e envia relatório CSV por email.
        </p>

        {!job && (
          <>
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Portal</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>AllianzNet — allianznet.com.br</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>GESTÃO → Financeiro → Gestão de Parcelas → Gestão de Inadimplentes</div>
              </div>
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Ramos mapeados</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {[['116','Auto'],['309','RC Transportes'],['312','Carga'],['1211','Vida'],['1251','Empresarial']].map(([cod,nome]) => (
                    <span key={cod} style={{ fontSize: 11, padding: '2px 8px', background: '#E6F1FB', color: '#0C447C', borderRadius: 20 }}>Ramo {cod} — {nome}</span>
                  ))}
                </div>
              </div>
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Etapas do processo</div>
                {ETAPAS.map((e, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, color: 'var(--text-2)' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>{i+1}</span>
                    {e}
                  </div>
                ))}
              </div>
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Resultado</div>
                <div style={{ fontSize: 13 }}>Email + CSV para <strong>jacometo@jacometo.com.br</strong></div>
              </div>
            </div>

            <div style={{ padding: '9px 12px', background: '#E6F1FB', border: '0.5px solid #185FA5', borderRadius: 8, fontSize: 12, color: '#0C447C', marginBottom: 14 }}>
              ℹ️ Filtros em branco = todos os registros. Paginação automática até o fim da lista.
            </div>

            <button onClick={executar} disabled={executando} style={{
              width: '100%', padding: '12px',
              background: executando ? 'var(--border)' : '#185FA5',
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
          statusLabel={{ executando: '⚙️  Extraindo dados do AllianzNet...', concluido: '✅ Inadimplentes extraídos e relatório enviado' }}
          onNovaExecucao={() => setJob(null)}
        />
      </div>
    </div>
  )
}
