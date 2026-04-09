'use client'
import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'

interface FaturaErro {
  id: number
  arquivo: string
  seguradora: string
  status: string
  dados_extraidos: any
  dados_corrigidos: any
  erro_tipo: string | null
  erro_mensagem: string | null
  created_at: string
}

const SEGURADORAS = ['tokio', 'akad', 'sompo', 'axa', 'chubb', 'allianz']
const RAMOS = ['RCTR-C', 'RC-DC', 'TRANSPORTE_NACIONAL']

function fmtData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function CampoForm({ label, value, onChange, type = 'text', options }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
  options?: string[]
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>{label}</label>
      {options ? (
        <select value={value} onChange={e => onChange(e.target.value)} style={{
          padding: '7px 10px', border: '0.5px solid var(--border)', borderRadius: 8,
          background: 'var(--surface)', color: 'var(--text)', fontSize: 13,
        }}>
          <option value="">Selecionar</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} style={{
          padding: '7px 10px', border: '0.5px solid var(--border)', borderRadius: 8,
          background: 'var(--surface)', color: 'var(--text)', fontSize: 13,
        }} />
      )}
    </div>
  )
}

function FaturaCard({ fatura, onCorrigido }: { fatura: FaturaErro; onCorrigido: () => void }) {
  const ext = fatura.dados_extraidos || {}
  const [form, setForm] = useState({
    seguradora: fatura.seguradora || '',
    apolice: ext.apolice || '',
    endosso: ext.endosso || '',
    premio: String(ext.premio || ''),
    vencimento: ext.vencimento || '',
    ramo: ext.ramo || '',
    competencia: ext.competencia || '',
  })
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null)

  const set = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))

  async function corrigir() {
    setEnviando(true)
    setResultado(null)
    try {
      // 1. Salva dados corrigidos no Supabase
      const { error } = await supabase.from('faturas_log').update({
        dados_corrigidos: form,
        status: 'revisao',
        updated_at: new Date().toISOString(),
      }).eq('id', fatura.id)

      if (error) throw new Error(error.message)

      // 2. Salva caso de erro para treinamento
      if (fatura.dados_extraidos) {
        await supabase.from('regras_seguradora').upsert({
          seguradora: fatura.seguradora,
          tipo: 'caso_erro',
          dados_errados: fatura.dados_extraidos,
          dados_corretos: form,
          descricao: `Correção manual: ${fatura.erro_mensagem || 'sem erro'} — ${fatura.arquivo}`,
        }, { onConflict: 'seguradora,tipo,descricao' })
      }

      setResultado({ ok: true, msg: 'Dados corrigidos salvos. O extrator vai aprender com esta correção.' })
      setTimeout(onCorrigido, 2000)
    } catch (e: any) {
      setResultado({ ok: false, msg: e.message })
    }
    setEnviando(false)
  }

  async function ignorar() {
    try {
      await supabase.from('faturas_log').update({
        status: 'ignorado',
        updated_at: new Date().toISOString(),
      }).eq('id', fatura.id)
      onCorrigido()
    } catch { /* silencia */ }
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '0.5px solid var(--border)',
      borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>📄</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{fatura.arquivo}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {fmtData(fatura.created_at)} · {fatura.seguradora?.toUpperCase() || '?'}
          </div>
        </div>
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 10,
          background: '#FCEBEB', color: '#791F1F', fontWeight: 600,
        }}>
          {fatura.erro_tipo || 'erro'}
        </span>
      </div>

      {/* Erro */}
      <div style={{ padding: '10px 16px', background: '#FFF5F5', borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#791F1F', marginBottom: 4 }}>
          ❌ {fatura.erro_mensagem || 'Erro desconhecido'}
        </div>
      </div>

      {/* Dados extraidos */}
      {fatura.dados_extraidos && (
        <div style={{ padding: '10px 16px', borderBottom: '0.5px solid var(--border)', background: 'var(--bg)' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-3)', marginBottom: 6 }}>
            Dados extraidos pelo Claude Vision:
          </div>
          <pre style={{
            fontSize: 12, fontFamily: 'monospace', color: 'var(--text-2)',
            margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {JSON.stringify(fatura.dados_extraidos, null, 2)}
          </pre>
        </div>
      )}

      {/* Formulario de correcao */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 10 }}>
          Corrigir dados:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <CampoForm label="Seguradora" value={form.seguradora} onChange={set('seguradora')} options={SEGURADORAS} />
          <CampoForm label="Ramo" value={form.ramo} onChange={set('ramo')} options={RAMOS} />
          <CampoForm label="Apolice" value={form.apolice} onChange={set('apolice')} />
          <CampoForm label="Endosso" value={form.endosso} onChange={set('endosso')} />
          <CampoForm label="Premio (R$)" value={form.premio} onChange={set('premio')} type="number" />
          <CampoForm label="Vencimento" value={form.vencimento} onChange={set('vencimento')} />
          <CampoForm label="Competencia" value={form.competencia} onChange={set('competencia')} />
        </div>

        {resultado && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: resultado.ok ? '#E1F5EE' : '#FCEBEB',
            color: resultado.ok ? '#085041' : '#791F1F',
            fontSize: 13,
          }}>
            {resultado.ok ? '✅' : '❌'} {resultado.msg}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={corrigir} disabled={enviando} style={{
            flex: 1, padding: '9px', border: 'none', borderRadius: 8,
            background: enviando ? 'var(--border)' : '#185FA5',
            color: enviando ? 'var(--text-3)' : '#fff',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>
            {enviando ? '⏳ Reprocessando...' : 'Reprocessar com dados corrigidos'}
          </button>
          <button onClick={ignorar} style={{
            padding: '9px 16px', border: '0.5px solid var(--border)', borderRadius: 8,
            background: 'var(--surface)', color: 'var(--text-3)',
            fontSize: 13, cursor: 'pointer',
          }}>
            Ignorar
          </button>
        </div>
      </div>
    </div>
  )
}

function FaturasErrosContent() {
  const searchParams = useSearchParams()
  const [faturas, setFaturas] = useState<FaturaErro[]>([])
  const [loading, setLoading] = useState(true)

  async function carregar() {
    try {
      const { data } = await supabase
        .from('faturas_log')
        .select('*')
        .in('status', ['erro', 'revisao'])
        .order('created_at', { ascending: false })
        .limit(50)
      if (data) setFaturas(data as FaturaErro[])
    } catch { /* silencia */ }
    setLoading(false)
  }

  useEffect(() => { carregar() }, [])

  // Se veio com ?id=X, mostra esse primeiro
  const idFoco = searchParams.get('id')
  const ordenadas = idFoco
    ? [...faturas].sort((a, b) => (a.id === Number(idFoco) ? -1 : b.id === Number(idFoco) ? 1 : 0))
    : faturas

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas/faturas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Faturas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Correção de Erros</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#791F1F', fontWeight: 500 }}>
          {faturas.length} fatura(s) com erro
        </span>
      </div>

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '1.5rem 1rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '3rem', fontSize: 14 }}>Carregando...</div>
        ) : faturas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Nenhum erro pendente</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              Todas as faturas foram processadas com sucesso.
            </div>
            <Link href="/ferramentas/faturas" style={{
              display: 'inline-block', marginTop: 16, padding: '8px 20px',
              background: 'var(--accent)', color: '#fff', borderRadius: 8, fontSize: 13,
            }}>
              Ver todas as faturas
            </Link>
          </div>
        ) : (
          ordenadas.map(f => (
            <FaturaCard key={f.id} fatura={f} onCorrigido={carregar} />
          ))
        )}
      </div>
    </div>
  )
}

export default function FaturasErrosPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>Carregando...</div>}>
      <FaturasErrosContent />
    </Suspense>
  )
}
