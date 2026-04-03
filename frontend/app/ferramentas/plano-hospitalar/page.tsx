'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import { JobStatus, useJobPolling, type Job } from '../../../components/JobStatus'

const LOTES = [
  { dia: 5,  exec: '26 do mês anterior' },
  { dia: 10, exec: 'Dia 1 do mês' },
  { dia: 13, exec: 'Dia 4 do mês' },
  { dia: 15, exec: 'Dia 6 do mês' },
  { dia: 20, exec: 'Dia 11 do mês' },
  { dia: 25, exec: 'Dia 16 do mês' },
  { dia: 30, exec: 'Dia 21 do mês' },
]

interface Cliente { nome: string; login: string; senha: string; cnpj: string; vencimento: string }

export default function PlanoHospitalarPage() {
  const [diaVenc, setDiaVenc]         = useState<number | null>(null)
  const [clientes, setClientes]       = useState<Cliente[]>([])
  const [planilha, setPlanilha]       = useState<File | null>(null)
  const [executando, setExecutando]   = useState(false)
  const [job, setJob]                 = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useJobPolling(
    job?.status !== 'concluido' && job?.status !== 'erro_critico' ? job?.id ?? null : null,
    setJob,
    '/plano-hospitalar'
  )

  // Lê planilha Excel no browser e extrai clientes
  async function lerPlanilha(file: File) {
    setPlanilha(file)
    // Envia para o backend para parsing
    const form = new FormData()
    form.append('planilha', file)
    try {
      const res  = await fetch('/api/rpa/plano-hospitalar/parse-planilha', { method: 'POST', body: form })
      const data = await res.json()
      if (res.ok && data.clientes) {
        setClientes(data.clientes)
      }
    } catch { /* silencia — usuário pode confirmar manualmente */ }
  }

  async function executar() {
    if (!diaVenc || !clientes.length) return
    setExecutando(true); setErroEnvio('')
    try {
      const res  = await fetch('/api/rpa/plano-hospitalar/executar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientes, diaVenc }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro || 'Erro no servidor')
      setJob({ id: data.jobId, status: 'executando', progresso: 0, total: clientes.length, resultados: [], erro: null })
    } catch (e: any) {
      setErroEnvio(e.message)
    } finally {
      setExecutando(false)
    }
  }

  const emProcesso  = job && job.status !== 'concluido' && job.status !== 'erro_critico'
  const diaHoje     = new Date().getDate()
  const loteHoje    = LOTES.find(l => {
    const execDia = l.exec === '26 do mês anterior' ? 26 : parseInt(l.exec.replace('Dia ','').split(' ')[0])
    return execDia === diaHoje
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Plano Hospitalar — Boletos</span>
        {emProcesso && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Processando clientes
          </span>
        )}
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Boletos e Faturas — Plano Hospitalar</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          Para cada cliente: login no SolusWeb, baixa boleto + fatura em aberto e salva no Google Drive. Email resumo consolidado para Mayara e Adriano.
        </p>

        {!job && (
          <>
            {/* Seleção do lote */}
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Lote de vencimento</span>
                {loteHoje && <span style={{ fontSize: 11, color: '#1D9E75' }}>dia {loteHoje.dia} está programado para hoje</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
                {LOTES.map((l, i) => (
                  <div key={l.dia} onClick={() => setDiaVenc(l.dia)} style={{
                    padding: '10px 8px', textAlign: 'center', cursor: 'pointer',
                    borderRight: i < LOTES.length - 1 ? '0.5px solid var(--border)' : 'none',
                    borderBottom: i < 4 ? '0.5px solid var(--border)' : 'none',
                    background: diaVenc === l.dia ? '#E1F5EE' : 'transparent',
                    transition: 'background 0.1s',
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: diaVenc === l.dia ? '#085041' : 'var(--text)' }}>Dia {l.dia}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{l.exec}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Upload planilha */}
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Planilha de clientes</div>
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) lerPlanilha(f) }}
                style={{
                  border: `1.5px dashed ${planilha ? '#1D9E75' : 'var(--border-strong)'}`,
                  borderRadius: 8, padding: '1.25rem', textAlign: 'center', cursor: 'pointer',
                  background: planilha ? '#E1F5EE' : 'var(--bg)', transition: 'all 0.15s',
                }}
              >
                {planilha ? (
                  <div>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>📊</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#085041' }}>{planilha.name}</div>
                    {clientes.length > 0 && <div style={{ fontSize: 12, color: '#1D9E75', marginTop: 2 }}>{clientes.length} clientes identificados</div>}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>📋</div>
                    <div style={{ fontSize: 13, color: 'var(--text-2)' }}><strong style={{ color: 'var(--text)' }}>Clique</strong> ou arraste a planilha de clientes</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>Colunas: Nome, CNPJ, Login, Senha, Vencimento</div>
                  </div>
                )}
              </div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) lerPlanilha(e.target.files[0]) }} />
            </div>

            {/* Resumo */}
            {clientes.length > 0 && diaVenc && (
              <div style={{ background: '#E1F5EE', border: '0.5px solid #1D9E75', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#085041' }}>
                ✓ Pronto para processar <strong>{clientes.filter(c => String(c.vencimento) === String(diaVenc)).length || clientes.length}</strong> cliente(s) · Vencimento dia {diaVenc}
              </div>
            )}

            <div style={{ padding: '8px 12px', marginBottom: 12, background: '#E6F1FB', border: '0.5px solid #185FA5', borderRadius: 8, fontSize: 12, color: '#0C447C' }}>
              ℹ️ Cada cliente é processado individualmente com sessão isolada. Erros em um cliente não afetam os outros. Arquivos salvos no Google Drive — NÃO enviados por email.
            </div>

            <button onClick={executar} disabled={!diaVenc || !clientes.length || executando} style={{
              width: '100%', padding: '12px',
              background: !diaVenc || !clientes.length || executando ? 'var(--border)' : '#993556',
              color: !diaVenc || !clientes.length || executando ? 'var(--text-3)' : '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: !diaVenc || !clientes.length ? 'not-allowed' : 'pointer',
            }}>
              {executando ? '⏳ Iniciando...' : !diaVenc ? 'Selecione o lote' : !clientes.length ? 'Carregue a planilha' : `Processar ${clientes.length} cliente(s) — lote dia ${diaVenc}`}
            </button>

            {erroEnvio && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>❌ {erroEnvio}</div>
            )}
          </>
        )}

        <JobStatus
          job={job}
          statusLabel={{
            executando: '⚙️  Processando clientes no SolusWeb e salvando no Drive...',
            concluido:  '✅ Todos os clientes processados — resumo enviado para Mayara e Adriano',
          }}
          onNovaExecucao={() => { setJob(null); setPlanilha(null); setClientes([]); setDiaVenc(null) }}
        />
      </div>
    </div>
  )
}
