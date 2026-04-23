'use client'
import { useState } from 'react'
import Link from 'next/link'
import { JobStatus, useJobPolling, type Job } from '../../../components/JobStatus'

const ETAPAS = [
  'Login Azure B2C',
  'Serviços → Financeiro → Cobrança',
  'Filtros (120 dias) + Buscar',
  'Extrair tabela + Exportar',
  'Enviar email',
]

export default function ChubbInadimplentesPage() {
  const [executando, setExecutando] = useState(false)
  const [job, setJob]               = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio]   = useState('')

  useJobPolling(
    job?.status !== 'concluido' && job?.status !== 'erro_critico' ? job?.id ?? null : null,
    setJob,
    '/chubb-inadimplentes'
  )

  async function executar() {
    setExecutando(true)
    setErroEnvio('')
    try {
      const res  = await fetch('/api/rpa/chubb-inadimplentes/executar', { method: 'POST' })
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

      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Chubb — Parcelas Pendentes</span>
        {emProcesso && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Acessando ChubbNet
          </span>
        )}
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Parcelas Pendentes — Chubb</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          O sistema entra no portal ChubbNet via Azure B2C, navega até Cobrança, extrai parcelas pendentes e envia o relatório por email.
        </p>

        {!job && (
          <>
            {/* Info do que será feito */}
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>

              {/* Portal */}
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Portal</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>ChubbNet — Login Azure B2C</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>Email → Continuar → Senha → Portal</div>
              </div>

              {/* Etapas */}
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>5 etapas automatizadas</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {ETAPAS.map((etapa, i) => (
                    <div key={i} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#185FA5', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                      {etapa}
                    </div>
                  ))}
                </div>
              </div>

              {/* Filtros */}
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Filtros aplicados</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['Todos os ramos', 'Pendente de pagamento', 'Últimos 120 dias'].map(f => (
                    <span key={f} style={{ fontSize: 11, padding: '3px 9px', background: '#E1F5EE', color: '#085041', borderRadius: 20 }}>{f}</span>
                  ))}
                </div>
              </div>

              {/* Ramos */}
              <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Ramos cobertos</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { ramo: 'Ramo 54', desc: 'RC Transp. Rod. Carga' },
                    { ramo: 'Ramo 55', desc: 'RCF Desv. de Carga' },
                  ].map(r => (
                    <div key={r.ramo} style={{ flex: 1, padding: '8px 10px', background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{r.ramo}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 1 }}>{r.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Entrega */}
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Resultado</div>
                <div style={{ fontSize: 13 }}>Exportar + Email para <span style={{ fontWeight: 500 }}>jacometo@jacometo.com.br</span></div>
              </div>
            </div>

            {/* Aviso portal */}
            <div style={{ padding: '9px 12px', background: '#FAEEDA', border: '0.5px solid #BA7517', borderRadius: 8, fontSize: 12, color: '#633806', marginBottom: 14 }}>
              ⚠️ Usar <strong>sso.chubbnet.com</strong> (login via Azure B2C) — não confundir com brportal.chubb.com (iBroker, sem financeiro).
            </div>

            <button
              onClick={executar}
              disabled={executando}
              style={{
                width: '100%', padding: '12px',
                background: executando ? 'var(--border)' : '#185FA5',
                color: executando ? 'var(--text-3)' : '#fff',
                border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: executando ? 'not-allowed' : 'pointer',
              }}
            >
              {executando ? '⏳ Iniciando...' : 'Extrair parcelas pendentes'}
            </button>

            {erroEnvio && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>
                ❌ {erroEnvio}
              </div>
            )}
          </>
        )}

        {/* Painel de acompanhamento */}
        <JobStatus
          job={job}
          statusLabel={{
            executando: '⚙️  Acessando portal ChubbNet...',
            concluido:  '✅ Parcelas extraídas e relatório enviado',
          }}
          onNovaExecucao={() => setJob(null)}
        />
      </div>
    </div>
  )
}
