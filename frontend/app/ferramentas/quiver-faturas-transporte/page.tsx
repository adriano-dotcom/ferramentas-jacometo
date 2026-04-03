'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'

const SEGURADORAS = ['Tokio Marine', 'Sompo', 'AKAD', 'AXA', 'Chubb', 'Allianz']

type StatusJob = 'idle' | 'extraindo' | 'cadastrando' | 'concluido' | 'erro_critico'

interface Resultado {
  segurado: string
  apolice: string
  endosso: string
  ramo: string
  seguradora: string
  premio_liquido: string
  vencimento: string
  status: 'OK' | 'FALHA'
  erro: string | null
  tipo: string | null
  label: string | null
  orientacao: string | null
  screenshotPath: string | null
  arquivoOriginal?: string
}

interface Job {
  id: string
  status: StatusJob
  progresso: number
  total: number
  resultados: Resultado[]
  erro: string | null
}

const COR_TIPO: Record<string, string> = {
  APOLICE_NAO_ENCONTRADA: '#E24B4A',
  MSG069:                 '#BA7517',
  ENDOSSO_DUPLICADO:      '#BA7517',
  IFRAME_TIMEOUT:         '#888780',
  VIGENCIA:               '#D85A30',
  ERRO_GRAVAR:            '#E24B4A',
  TIMEOUT:                '#888780',
  EXTRACAO_FALHOU:        '#D85A30',
  OUTRO:                  '#888780',
}

function BadgeStatus({ status, label }: { status: 'OK'|'FALHA', label?: string|null }) {
  if (status === 'OK') return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#E1F5EE', color: '#085041', fontWeight: 500 }}>✓ OK</span>
  )
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#FCEBEB', color: '#791F1F', fontWeight: 500 }}>
      ✕ {label || 'Falha'}
    </span>
  )
}

function ProgressBar({ progresso, total }: { progresso: number, total: number }) {
  const pct = total > 0 ? Math.round((progresso / total) * 100) : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
        <span>{progresso} de {total} faturas</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#1D9E75', borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

function ResultadoRow({ r, idx }: { r: Resultado, idx: number }) {
  const [aberto, setAberto] = useState(r.status === 'FALHA')
  const corTipo = r.tipo ? COR_TIPO[r.tipo] || '#888780' : '#888780'

  return (
    <div style={{
      border: `0.5px solid ${r.status === 'OK' ? 'var(--border)' : corTipo + '55'}`,
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 6,
    }}>
      <div
        onClick={() => setAberto(!aberto)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', cursor: 'pointer',
          background: r.status === 'OK' ? 'var(--surface)' : '#FFF8F8',
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-3)', minWidth: 18 }}>{idx + 1}.</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.segurado}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 1 }}>
            {r.seguradora} · Apólice {r.apolice} · End {String(r.endosso).padStart(6,'0')} · Ramo {r.ramo}
          </div>
        </div>
        <BadgeStatus status={r.status} label={r.label} />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{aberto ? '▲' : '▼'}</span>
      </div>

      {aberto && (
        <div style={{
          padding: '10px 12px',
          borderTop: `0.5px solid ${r.status === 'OK' ? 'var(--border)' : corTipo + '33'}`,
          background: r.status === 'OK' ? 'var(--bg)' : '#FFF5F5',
        }}>
          {r.status === 'OK' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12 }}>
              {[
                ['Prêmio líquido', `R$ ${r.premio_liquido}`],
                ['Vencimento', r.vencimento],
                ['Seguradora', r.seguradora],
                ['Ramo', r.ramo === '54' ? 'RCTR-C (54)' : 'RC-DC (55)'],
              ].map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: 'var(--text-3)' }}>{k}: </span>
                  <span style={{ color: 'var(--text)', fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div style={{
                padding: '8px 10px', borderRadius: 6, marginBottom: 8,
                background: corTipo + '15', border: `0.5px solid ${corTipo}44`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: corTipo, marginBottom: 2 }}>
                  {r.label || 'Erro desconhecido'}
                </div>
                {r.orientacao && (
                  <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                    Ação: {r.orientacao}
                  </div>
                )}
              </div>
              {r.erro && r.erro !== r.label && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', background: 'var(--bg)', padding: '6px 8px', borderRadius: 4, wordBreak: 'break-all' }}>
                  {r.erro}
                </div>
              )}
              {r.screenshotPath && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                  📷 Screenshot salvo: {r.screenshotPath.split('/').pop()}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function QuiverFaturasTransportePage() {
  const [arquivos, setArquivos] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [job, setJob]           = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio] = useState('')
  const inputRef  = useRef<HTMLInputElement>(null)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  const pararPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const iniciarPoll = useCallback((jobId: string) => {
    pararPoll()
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/rpa/quiver-faturas-transporte/status/${jobId}`)
        const data = await res.json() as Job
        setJob(data)
        if (data.status === 'concluido' || data.status === 'erro_critico') pararPoll()
      } catch { /* silencia erros de rede durante poll */ }
    }, 2000)
  }, [pararPoll])

  useEffect(() => () => pararPoll(), [pararPoll])

  function adicionarArquivos(files: FileList) {
    const novos = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    setArquivos(prev => {
      const nomes = new Set(prev.map(f => f.name))
      return [...prev, ...novos.filter(f => !nomes.has(f.name))]
    })
  }

  function remover(nome: string) {
    setArquivos(prev => prev.filter(f => f.name !== nome))
  }

  async function enviar() {
    if (!arquivos.length) return
    setEnviando(true)
    setErroEnvio('')
    setJob(null)

    const form = new FormData()
    arquivos.forEach(f => form.append('arquivos', f))

    try {
      const res  = await fetch('/api/rpa/quiver-faturas-transporte/cadastrar', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.jobId) throw new Error(data.erro || 'Erro no servidor')

      setArquivos([])
      setJob({ id: data.jobId, status: 'extraindo', progresso: 0, total: arquivos.length, resultados: [], erro: null })
      iniciarPoll(data.jobId)
    } catch (e: any) {
      setErroEnvio(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const statusLabel: Record<string, string> = {
    extraindo:     '🔍 Lendo PDFs e extraindo dados via IA...',
    cadastrando:   '⚙️  Cadastrando no Quiver PRO...',
    concluido:     '✅ Processamento concluído',
    erro_critico:  '❌ Erro crítico no processamento',
  }

  const nOk    = job?.resultados.filter(r => r.status === 'OK').length   ?? 0
  const nFalha = job?.resultados.filter(r => r.status === 'FALHA').length ?? 0
  const emProcesso = job && job.status !== 'concluido' && job.status !== 'erro_critico'
  const totalLiq = job?.resultados
    .filter(r => r.status === 'OK')
    .reduce((a, r) => a + (parseFloat((r.premio_liquido || '0').replace(/\./g,'').replace(',','.')) || 0), 0) ?? 0

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Quiver — Faturas Transporte</span>
        {emProcesso && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#1D9E75', animation: 'pulse 1.2s ease-in-out infinite' }} />
          Processando
        </span>}
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem 1rem' }}>

        {/* Upload — só mostra quando não há job ativo */}
        {!job && (
          <>
            <div style={{ marginBottom: '1.25rem' }}>
              <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Cadastro de Faturas de Transporte</h1>
              <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>
                Envie os PDFs (RCTR-C e RC-DC). O sistema extrai os dados automaticamente e cadastra no Quiver PRO.
              </p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
              {SEGURADORAS.map(s => (
                <span key={s} style={{ fontSize: 11, padding: '2px 8px', background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 20, color: 'var(--text-2)' }}>{s}</span>
              ))}
            </div>

            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); adicionarArquivos(e.dataTransfer.files) }}
              style={{
                border: `1.5px dashed ${dragOver ? '#185FA5' : 'var(--border-strong)'}`,
                borderRadius: 'var(--radius)', padding: '1.5rem',
                textAlign: 'center', cursor: 'pointer',
                background: dragOver ? '#E6F1FB' : 'var(--surface)',
                marginBottom: 10, transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 26, marginBottom: 4 }}>📑</div>
              <div style={{ fontSize: 14, color: 'var(--text-2)' }}>
                <strong style={{ color: 'var(--text)' }}>Clique</strong> ou arraste os PDFs · múltiplos arquivos
              </div>
            </div>
            <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
              onChange={e => { if (e.target.files) adicionarArquivos(e.target.files) }} />

            {arquivos.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ padding: '7px 12px', borderBottom: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>{arquivos.length} arquivo{arquivos.length > 1 ? 's' : ''}</span>
                  <button onClick={() => setArquivos([])} style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--text-3)', cursor: 'pointer' }}>Limpar</button>
                </div>
                {arquivos.map((f, i) => (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: i < arquivos.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                    <span style={{ fontSize: 16 }}>📄</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{(f.size/1024).toFixed(1)} KB</div>
                    </div>
                    <button onClick={() => remover(f.name)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {arquivos.some(f => f.name.toLowerCase().includes('allianz')) && (
              <div style={{ padding: '8px 12px', marginBottom: 10, background: '#FAEEDA', border: '0.5px solid #BA7517', borderRadius: 8, fontSize: 12, color: '#633806' }}>
                ⚠️ Allianz detectada — será usado o número do <strong>rodapé</strong> como endosso.
              </div>
            )}

            <button onClick={enviar} disabled={!arquivos.length || enviando} style={{
              width: '100%', padding: '11px',
              background: !arquivos.length || enviando ? 'var(--border)' : '#185FA5',
              color: !arquivos.length || enviando ? 'var(--text-3)' : '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500,
            }}>
              {enviando ? '⏳ Enviando...' : arquivos.length ? `Cadastrar ${arquivos.length} fatura(s)` : 'Selecione os PDFs'}
            </button>

            {erroEnvio && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>
                ❌ {erroEnvio}
              </div>
            )}
          </>
        )}

        {/* Painel de resultado em tempo real */}
        {job && (
          <div>
            {/* Status bar */}
            <div style={{
              padding: '12px 14px', borderRadius: 'var(--radius)', marginBottom: 12,
              background: job.status === 'concluido' && nFalha === 0 ? '#E1F5EE' :
                          job.status === 'erro_critico' ? '#FCEBEB' : 'var(--surface)',
              border: `0.5px solid ${job.status === 'concluido' && nFalha === 0 ? '#1D9E75' : job.status === 'erro_critico' ? '#E24B4A' : 'var(--border)'}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6, color: job.status === 'erro_critico' ? '#791F1F' : 'var(--text)' }}>
                {statusLabel[job.status] || job.status}
              </div>

              {(job.status === 'cadastrando' || job.status === 'concluido') && job.total > 0 && (
                <ProgressBar progresso={job.progresso} total={job.total} />
              )}

              {job.status === 'concluido' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                  {[
                    { label: 'OK', valor: nOk, cor: '#1D9E75', bg: '#E1F5EE' },
                    { label: 'Falhas', valor: nFalha, cor: nFalha > 0 ? '#E24B4A' : 'var(--text-3)', bg: nFalha > 0 ? '#FCEBEB' : 'var(--bg)' },
                    { label: 'Prêmio total', valor: `R$ ${totalLiq.toLocaleString('pt-BR',{minimumFractionDigits:2})}`, cor: 'var(--text)', bg: 'var(--bg)', small: true },
                  ].map(s => (
                    <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: s.small ? 13 : 20, fontWeight: 500, color: s.cor }}>{s.valor}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Lista de resultados */}
            {job.resultados.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 8 }}>
                  Detalhamento ({job.resultados.length} fatura{job.resultados.length > 1 ? 's' : ''})
                  {nFalha > 0 && <span style={{ color: '#E24B4A', marginLeft: 8 }}>· {nFalha} com erro — expanda para ver a ação necessária</span>}
                </div>
                {/* Falhas primeiro */}
                {job.resultados.filter(r => r.status === 'FALHA').map((r, i) => (
                  <ResultadoRow key={`f-${i}`} r={r} idx={job.resultados.indexOf(r)} />
                ))}
                {/* OK depois */}
                {job.resultados.filter(r => r.status === 'OK').map((r, i) => (
                  <ResultadoRow key={`ok-${i}`} r={r} idx={job.resultados.indexOf(r)} />
                ))}
              </div>
            )}

            {/* Ações pós-conclusão */}
            {job.status === 'concluido' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => { setJob(null); setArquivos([]) }} style={{
                  flex: 1, padding: '9px', background: '#185FA5', color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}>
                  Enviar mais faturas
                </button>
                {nFalha > 0 && (
                  <button onClick={() => setJob(null)} style={{
                    flex: 1, padding: '9px', background: '#FCEBEB', color: '#791F1F',
                    border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                  }}>
                    Reenviar faturas com erro ({nFalha})
                  </button>
                )}
              </div>
            )}

            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>
              {job.status !== 'concluido' ? 'Atualiza automaticamente a cada 2 segundos' : `Resumo enviado para jacometo@jacometo.com.br · Job ${job.id.substring(0,8)}...`}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
