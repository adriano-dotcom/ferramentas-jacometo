'use client'
// components/JobStatus.tsx
// Componente reutilizável de acompanhamento de job com polling automático.
// Usado em todas as telas de ferramentas.

import { useState, useEffect, useRef, useCallback } from 'react'

export type StatusJob = 'idle' | 'extraindo' | 'cadastrando' | 'executando' | 'baixando' | 'processando' | 'concluido' | 'erro_critico'

export interface Resultado {
  // identificação
  nome: string          // nome principal (segurado, cliente, grupo...)
  sub?: string          // linha secundária opcional (apólice, seguradora...)
  // resultado
  status: 'OK' | 'FALHA' | 'AVISO'
  // erro detalhado
  erro?: string | null
  label?: string | null        // título amigável do erro
  orientacao?: string | null   // o que fazer
  tipo?: string | null         // código interno do erro
  detalhe?: string | null      // detalhe técnico (stacktrace, mensagem raw)
  screenshotPath?: string | null
}

export interface Job {
  id: string
  status: StatusJob
  progresso: number
  total: number
  resultados: Resultado[]
  erro: string | null
}

interface Props {
  job: Job | null
  statusLabel?: Partial<Record<StatusJob, string>>
  onNovaExecucao?: () => void
  onReenviarErros?: () => void
  labelReenviar?: string
  mostrarPremioTotal?: boolean
  calcularTotal?: (r: Resultado) => number
}

const STATUS_LABEL_PADRAO: Record<StatusJob, string> = {
  idle:        '',
  extraindo:   '🔍 Lendo e extraindo dados...',
  cadastrando: '⚙️  Cadastrando no sistema...',
  executando:  '⚙️  Executando automação...',
  baixando:    '⬇️  Baixando arquivos...',
  processando: '🔄 Processando...',
  concluido:   '✅ Concluído',
  erro_critico:'❌ Erro crítico',
}

const COR_TIPO: Record<string, { bg: string; border: string; text: string }> = {
  APOLICE_NAO_ENCONTRADA: { bg: '#FCEBEB', border: '#E24B4A55', text: '#E24B4A' },
  MSG069:                 { bg: '#FAEEDA', border: '#BA751755', text: '#BA7517' },
  ENDOSSO_DUPLICADO:      { bg: '#FAEEDA', border: '#BA751755', text: '#BA7517' },
  IFRAME_TIMEOUT:         { bg: '#F1EFE8', border: '#88878055', text: '#5F5E5A' },
  VIGENCIA:               { bg: '#FAECE7', border: '#D85A3055', text: '#993C1D' },
  ERRO_GRAVAR:            { bg: '#FCEBEB', border: '#E24B4A55', text: '#E24B4A' },
  TIMEOUT:                { bg: '#F1EFE8', border: '#88878055', text: '#5F5E5A' },
  EXTRACAO_FALHOU:        { bg: '#FAECE7', border: '#D85A3055', text: '#993C1D' },
  LOGIN_FALHOU:           { bg: '#FCEBEB', border: '#E24B4A55', text: '#E24B4A' },
  SESSAO_EXPIRADA:        { bg: '#FAEEDA', border: '#BA751755', text: '#BA7517' },
  DOWNLOAD_FALHOU:        { bg: '#FAEEDA', border: '#BA751755', text: '#BA7517' },
  SEM_RESULTADOS:         { bg: '#F1EFE8', border: '#88878055', text: '#5F5E5A' },
  OUTRO:                  { bg: '#F1EFE8', border: '#88878055', text: '#5F5E5A' },
  DESCONHECIDO:           { bg: '#F1EFE8', border: '#88878055', text: '#5F5E5A' },
}

function corDoTipo(tipo?: string | null) {
  return (tipo && COR_TIPO[tipo]) || COR_TIPO['DESCONHECIDO']
}

function BadgeStatus({ status, label }: { status: 'OK'|'FALHA'|'AVISO', label?: string|null }) {
  if (status === 'OK') return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#E1F5EE', color: '#085041', fontWeight: 500, whiteSpace: 'nowrap' }}>✓ OK</span>
  )
  if (status === 'AVISO') return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#FAEEDA', color: '#633806', fontWeight: 500, whiteSpace: 'nowrap' }}>⚠ {label || 'Aviso'}</span>
  )
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#FCEBEB', color: '#791F1F', fontWeight: 500, whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>
      ✕ {label || 'Falha'}
    </span>
  )
}

function ResultadoItem({ r, idx, abertoPadrao }: { r: Resultado; idx: number; abertoPadrao: boolean }) {
  const [open, setOpen] = useState(abertoPadrao)
  const cor = corDoTipo(r.tipo)

  return (
    <div style={{
      border: `0.5px solid ${r.status !== 'OK' ? cor.border : 'var(--color-border-tertiary)'}`,
      borderRadius: 8, overflow: 'hidden', marginBottom: 6,
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', cursor: 'pointer',
          background: r.status !== 'OK' ? cor.bg + '66' : 'var(--color-background-primary)',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', minWidth: 20 }}>{idx + 1}.</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.nome}
          </div>
          {r.sub && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 1 }}>{r.sub}</div>}
        </div>
        <BadgeStatus status={r.status} label={r.label} />
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{
          padding: '10px 12px',
          borderTop: `0.5px solid ${r.status !== 'OK' ? cor.border : 'var(--color-border-tertiary)'}`,
          background: r.status !== 'OK' ? cor.bg + '44' : 'var(--color-background-secondary)',
          fontSize: 12,
        }}>
          {r.status === 'OK' ? (
            <div style={{ color: 'var(--color-text-secondary)' }}>
              Cadastrado com sucesso.{r.detalhe ? ` ${r.detalhe}` : ''}
            </div>
          ) : (
            <div>
              {/* Caixa de erro principal */}
              <div style={{ background: cor.bg, border: `0.5px solid ${cor.border}`, borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: cor.text, marginBottom: r.orientacao ? 4 : 0 }}>
                  {r.label || 'Erro desconhecido'}
                </div>
                {r.orientacao && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                    <strong style={{ color: 'var(--color-text-primary)' }}>O que fazer:</strong> {r.orientacao}
                  </div>
                )}
              </div>
              {/* Detalhe técnico */}
              {(r.detalhe || r.erro) && (
                <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--color-text-tertiary)', background: 'var(--color-background-primary)', padding: '5px 8px', borderRadius: 4, wordBreak: 'break-all', marginBottom: 6 }}>
                  {r.detalhe || r.erro}
                </div>
              )}
              {/* Screenshot */}
              {r.screenshotPath && (
                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>📷</span>
                  <span>Screenshot: {r.screenshotPath.split('/').pop()}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProgressBar({ progresso, total }: { progresso: number; total: number }) {
  const pct = total > 0 ? Math.round((progresso / total) * 100) : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
        <span>{progresso} de {total}</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 5, background: 'var(--color-background-secondary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#1D9E75', borderRadius: 3, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  )
}

export function JobStatus({ job, statusLabel, onNovaExecucao, onReenviarErros, labelReenviar, mostrarPremioTotal, calcularTotal }: Props) {
  if (!job || job.status === 'idle') return null

  const labels = { ...STATUS_LABEL_PADRAO, ...statusLabel }
  const emProcesso = job.status !== 'concluido' && job.status !== 'erro_critico'
  const nOk    = job.resultados.filter(r => r.status === 'OK').length
  const nFalha = job.resultados.filter(r => r.status === 'FALHA').length
  const nAviso = job.resultados.filter(r => r.status === 'AVISO').length

  const totalLiq = mostrarPremioTotal && calcularTotal
    ? job.resultados.filter(r => r.status === 'OK').reduce((a, r) => a + calcularTotal(r), 0)
    : null

  const corCard = job.status === 'erro_critico'
    ? { bg: '#FCEBEB', border: '#E24B4A', text: '#791F1F' }
    : job.status === 'concluido' && nFalha === 0
      ? { bg: '#E1F5EE', border: '#1D9E75', text: '#085041' }
      : job.status === 'concluido' && nFalha > 0
        ? { bg: '#FAEEDA', border: '#BA7517', text: '#633806' }
        : { bg: 'var(--color-background-primary)', border: 'var(--color-border-tertiary)', text: 'var(--color-text-primary)' }

  const falhas  = job.resultados.filter(r => r.status === 'FALHA')
  const avisos  = job.resultados.filter(r => r.status === 'AVISO')
  const oks     = job.resultados.filter(r => r.status === 'OK')

  return (
    <div style={{ marginTop: 12 }}>

      {/* Card de status principal */}
      <div style={{
        background: corCard.bg, border: `0.5px solid ${corCard.border}`,
        borderRadius: 10, padding: '12px 14px', marginBottom: 12,
      }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: corCard.text, marginBottom: 8 }}>
          {labels[job.status] || job.status}
        </div>

        {/* Barra de progresso */}
        {(emProcesso || job.status === 'concluido') && job.total > 0 && (
          <ProgressBar progresso={job.progresso} total={job.total} />
        )}

        {/* Erro crítico */}
        {job.status === 'erro_critico' && job.erro && (
          <div style={{ fontSize: 12, color: '#E24B4A', fontFamily: 'monospace', background: '#FCEBEB', padding: '6px 8px', borderRadius: 4, marginTop: 4 }}>
            {job.erro}
          </div>
        )}

        {/* Resumo numérico (só quando tem resultados) */}
        {job.resultados.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${mostrarPremioTotal ? 4 : 3}, minmax(0,1fr))`, gap: 8, marginTop: 8 }}>
            <div style={{ background: '#E1F5EE', borderRadius: 7, padding: '7px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#1D9E75' }}>{nOk}</div>
              <div style={{ fontSize: 10, color: '#085041' }}>OK</div>
            </div>
            <div style={{ background: nFalha > 0 ? '#FCEBEB' : 'var(--color-background-secondary)', borderRadius: 7, padding: '7px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 500, color: nFalha > 0 ? '#E24B4A' : 'var(--color-text-tertiary)' }}>{nFalha}</div>
              <div style={{ fontSize: 10, color: nFalha > 0 ? '#791F1F' : 'var(--color-text-tertiary)' }}>Falha{nFalha !== 1 ? 's' : ''}</div>
            </div>
            {nAviso > 0 && (
              <div style={{ background: '#FAEEDA', borderRadius: 7, padding: '7px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 500, color: '#BA7517' }}>{nAviso}</div>
                <div style={{ fontSize: 10, color: '#633806' }}>Aviso{nAviso !== 1 ? 's' : ''}</div>
              </div>
            )}
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 7, padding: '7px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-text-primary)' }}>{job.resultados.length}</div>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Total</div>
            </div>
            {totalLiq !== null && (
              <div style={{ background: 'var(--color-background-secondary)', borderRadius: 7, padding: '7px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  R$ {totalLiq.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Prêmio total</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lista de resultados — falhas primeiro */}
      {job.resultados.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Detalhamento ({job.resultados.length})</span>
            {nFalha > 0 && (
              <span style={{ color: '#E24B4A', fontSize: 11 }}>· {nFalha} com erro — expanda para ver a ação</span>
            )}
          </div>

          {/* Falhas primeiro (abertas) */}
          {falhas.map((r, i) => (
            <ResultadoItem key={`f-${i}`} r={r} idx={job.resultados.indexOf(r)} abertoPadrao={true} />
          ))}
          {/* Avisos */}
          {avisos.map((r, i) => (
            <ResultadoItem key={`a-${i}`} r={r} idx={job.resultados.indexOf(r)} abertoPadrao={true} />
          ))}
          {/* OK (fechados) */}
          {oks.map((r, i) => (
            <ResultadoItem key={`ok-${i}`} r={r} idx={job.resultados.indexOf(r)} abertoPadrao={false} />
          ))}
        </div>
      )}

      {/* Nota de rodapé */}
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', margin: '8px 0' }}>
        {emProcesso
          ? 'Atualiza automaticamente a cada 2 segundos'
          : `Resumo enviado para jacometo@jacometo.com.br · Job ${job.id.substring(0, 8)}...`
        }
      </div>

      {/* Ações */}
      {job.status === 'concluido' && (onNovaExecucao || (onReenviarErros && nFalha > 0)) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {onNovaExecucao && (
            <button onClick={onNovaExecucao} style={{
              flex: 1, padding: '9px', background: '#185FA5', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}>
              Nova execução
            </button>
          )}
          {onReenviarErros && nFalha > 0 && (
            <button onClick={onReenviarErros} style={{
              flex: 1, padding: '9px', background: '#FCEBEB', color: '#791F1F',
              border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, cursor: 'pointer',
            }}>
              {labelReenviar || `Reenviar com erro (${nFalha})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Hook de polling reutilizável
export function useJobPolling(jobId: string | null, onUpdate: (job: Job) => void, rota: string) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const parar = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  useEffect(() => {
    if (!jobId) return
    parar()
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/rpa${rota}/status/${jobId}`)
        const data = await res.json() as Job
        onUpdate(data)
        if (data.status === 'concluido' || data.status === 'erro_critico') parar()
      } catch {}
    }, 2000)
    return parar
  }, [jobId, rota, onUpdate, parar])

  return parar
}
