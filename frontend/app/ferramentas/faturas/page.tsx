'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'

interface Fatura {
  id: number
  arquivo: string
  seguradora: string
  status: string
  dados_extraidos: any
  dados_corrigidos: any
  erro_tipo: string | null
  erro_mensagem: string | null
  quiver_job_id: string | null
  created_at: string
}

const STATUS_COR: Record<string, { bg: string; text: string; label: string; emoji: string }> = {
  sucesso:      { bg: '#E1F5EE', text: '#085041', label: 'Cadastrada',   emoji: '✅' },
  erro:         { bg: '#FCEBEB', text: '#791F1F', label: 'Erro',         emoji: '❌' },
  revisao:      { bg: '#FAEEDA', text: '#633806', label: 'Revisão',      emoji: '⚠️' },
  processando:  { bg: '#E6F1FB', text: '#0C447C', label: 'Processando', emoji: '⏳' },
  reprocessando:{ bg: '#E6F1FB', text: '#0C447C', label: 'Reprocessando',emoji: '🔄' },
}

function fmtData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtPremio(dados: any) {
  if (!dados) return '—'
  const p = dados.premio || dados.premio_liquido
  if (!p) return '—'
  if (typeof p === 'number') return `R$ ${p.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  return `R$ ${p}`
}

export default function FaturasPage() {
  const [faturas, setFaturas]     = useState<Fatura[]>([])
  const [loading, setLoading]     = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('Todos')
  const [autoRefresh, setAutoRefresh]   = useState(true)

  const carregar = useCallback(async () => {
    try {
      let query = supabase
        .from('faturas_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (filtroStatus !== 'Todos') query = query.eq('status', filtroStatus.toLowerCase())

      const { data } = await query
      if (data) setFaturas(data as Fatura[])
    } catch { /* silencia */ }
    setLoading(false)
  }, [filtroStatus])

  useEffect(() => {
    carregar()
    if (!autoRefresh) return
    const t = setInterval(carregar, 10000)
    return () => clearInterval(t)
  }, [carregar, autoRefresh])

  const total    = faturas.length
  const ok       = faturas.filter(f => f.status === 'sucesso').length
  const erros    = faturas.filter(f => f.status === 'erro').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Faturas de Transporte</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {erros > 0 && (
            <Link href="/ferramentas/faturas/erros" style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 8,
              background: '#FCEBEB', color: '#791F1F', fontWeight: 500,
              border: '0.5px solid #E24B4A',
            }}>
              {erros} erro(s) — Corrigir →
            </Link>
          )}
          <button onClick={() => setAutoRefresh(!autoRefresh)} style={{
            fontSize: 11, padding: '3px 9px', border: '0.5px solid var(--border)', borderRadius: 6,
            background: autoRefresh ? '#E1F5EE' : 'none', color: autoRefresh ? '#085041' : 'var(--text-3)', cursor: 'pointer',
          }}>
            {autoRefresh ? '⟳ Auto' : 'Auto'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.5rem 1rem' }}>
        {/* Cards resumo */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Total', valor: total, cor: 'var(--text-2)' },
            { label: 'Cadastradas', valor: ok, cor: '#085041' },
            { label: 'Erros', valor: erros, cor: '#791F1F' },
          ].map(c => (
            <div key={c.label} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: c.cor }}>{c.valor}</div>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {['Todos', 'Sucesso', 'Erro', 'Revisao'].map(s => (
            <button key={s} onClick={() => setFiltroStatus(s)} style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 20, border: '0.5px solid var(--border)',
              background: filtroStatus === s ? 'var(--accent)' : 'var(--surface)',
              color: filtroStatus === s ? '#fff' : 'var(--text-2)', cursor: 'pointer',
            }}>{s}</button>
          ))}
        </div>

        {/* Tabela */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '3rem', fontSize: 14 }}>Carregando faturas...</div>
        ) : faturas.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '3rem', fontSize: 14 }}>
            Nenhuma fatura encontrada. O Drive Watcher processa automaticamente PDFs na pasta do Drive.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {faturas.map(f => {
              const st = STATUS_COR[f.status] || STATUS_COR.processando
              return (
                <div key={f.id} style={{
                  background: 'var(--surface)', border: '0.5px solid var(--border)',
                  borderRadius: 10, padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  {/* Status badge */}
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 10,
                    background: st.bg, color: st.text, fontWeight: 600,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {st.emoji} {st.label}
                  </span>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.arquivo}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                      {fmtData(f.created_at)}
                      {f.seguradora && f.seguradora !== '?' && <> · <span style={{ textTransform: 'capitalize' }}>{f.seguradora}</span></>}
                      {f.dados_extraidos?.apolice && <> · Ap {f.dados_extraidos.apolice}</>}
                      <> · {fmtPremio(f.dados_extraidos)}</>
                    </div>
                    {f.erro_mensagem && (
                      <div style={{ fontSize: 11, color: '#791F1F', marginTop: 2 }}>
                        ✗ {f.erro_mensagem.substring(0, 100)}
                      </div>
                    )}
                  </div>

                  {/* Ação */}
                  {f.status === 'erro' && (
                    <Link href={`/ferramentas/faturas/erros?id=${f.id}`} style={{
                      fontSize: 12, padding: '5px 12px', borderRadius: 8,
                      background: '#185FA5', color: '#fff', fontWeight: 500,
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      Corrigir
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
