'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Seguradora {
  label: string
  url: string
  campos: Record<string, string>
}

interface Config {
  [key: string]: Seguradora
}

const CAMPOS_SENSIVEIS = ['senha', 'password']
const ICONE: Record<string, string> = {
  allianz: '🔵', tokio: '🔴', axa: '🔷', chubb: '⬛',
  sompo: '🟦', akad: '🟩', yelum: '🟡', mitsui: '🔶',
  essor: '🟪', metlife: '⚪', unimed_seguros: '🔴', unimed_boletos: '🔴',
  quiver: '⚙️', plano_hospitalar: '🏥',
  giacomet_yelum: '🟡', giacomet_mitsui: '🔶', giacomet_allianz: '🔵',
  giacomet_unimed: '🔴', giacomet_akad: '🟩', giacomet_aig: '⬜',
  giacomet_berkley: '🟫', giacomet_metlife: '⚪',
}

function CampoSenha({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const [visivel, setVisivel] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type={visivel ? 'text' : 'password'}
        value={valor}
        onChange={e => onChange(e.target.value)}
        style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '0.5px solid var(--border-strong)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: visivel ? 'inherit' : 'monospace' }}
      />
      <button onClick={() => setVisivel(!visivel)} style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12 }}>
        {visivel ? 'Ocultar' : 'Ver'}
      </button>
    </div>
  )
}

function CardSeguradora({ id, seg, onSalvar, salvando }: {
  id: string
  seg: Seguradora
  onSalvar: (id: string, dados: Partial<Seguradora>) => Promise<void>
  salvando: string | null
}) {
  const [editando, setEditando]   = useState(false)
  const [url, setUrl]             = useState(seg.url)
  const [campos, setCampos]       = useState<Record<string, string>>({ ...seg.campos })
  const [testando, setTestando]   = useState(false)
  const [statusUrl, setStatusUrl] = useState<'ok' | 'erro' | null>(null)
  const [salvouOk, setSalvouOk]   = useState(false)

  const isSalvando = salvando === id

  async function testar() {
    setTestando(true); setStatusUrl(null)
    try {
      const res  = await fetch('/api/rpa/config/testar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seguradora: id }) })
      const data = await res.json()
      setStatusUrl(data.acessivel ? 'ok' : 'erro')
    } catch { setStatusUrl('erro') }
    setTestando(false)
  }

  async function salvar() {
    await onSalvar(id, { url, campos })
    setSalvouOk(true)
    setEditando(false)
    setTimeout(() => setSalvouOk(false), 3000)
  }

  function cancelar() {
    setUrl(seg.url)
    setCampos({ ...seg.campos })
    setEditando(false)
  }

  return (
    <div style={{
      background: 'var(--surface)', border: `0.5px solid ${salvouOk ? '#1D9E75' : 'var(--border)'}`,
      borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.3s',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: editando ? '0.5px solid var(--border)' : 'none', cursor: 'pointer' }}
        onClick={() => !editando && setEditando(true)}>
        <span style={{ fontSize: 18 }}>{ICONE[id] || '🔑'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{seg.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1, fontFamily: 'monospace' }}>{seg.url}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {salvouOk && <span style={{ fontSize: 11, color: '#1D9E75' }}>✓ salvo</span>}
          {statusUrl === 'ok'  && <span style={{ fontSize: 11, color: '#1D9E75' }}>● online</span>}
          {statusUrl === 'erro' && <span style={{ fontSize: 11, color: '#E24B4A' }}>● offline</span>}
          {!editando && <span style={{ fontSize: 11, color: 'var(--text-3)', padding: '3px 8px', border: '0.5px solid var(--border)', borderRadius: 6 }}>Editar</span>}
        </div>
      </div>

      {/* Campos editáveis */}
      {editando && (
        <div style={{ padding: '14px' }}>
          {/* URL */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>URL do portal</label>
            <input value={url} onChange={e => setUrl(e.target.value)} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '0.5px solid var(--border-strong)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: 'monospace' }} />
          </div>

          {/* Campos de credenciais */}
          {Object.entries(campos).map(([campo, valor]) => (
            <div key={campo} style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4, textTransform: 'capitalize' }}>
                {campo.replace(/_/g, ' ')}
                {CAMPOS_SENSIVEIS.includes(campo) && <span style={{ color: '#BA7517', marginLeft: 4 }}>🔒 criptografado</span>}
              </label>
              {CAMPOS_SENSIVEIS.includes(campo)
                ? <CampoSenha valor={valor} onChange={v => setCampos(p => ({ ...p, [campo]: v }))} />
                : <input value={valor} onChange={e => setCampos(p => ({ ...p, [campo]: e.target.value }))} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '0.5px solid var(--border-strong)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
              }
            </div>
          ))}

          {/* Ações */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={salvar} disabled={isSalvando} style={{ flex: 1, padding: '8px', background: isSalvando ? 'var(--border)' : '#1D9E75', color: isSalvando ? 'var(--text-3)' : '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              {isSalvando ? '⏳ Salvando...' : '✓ Salvar'}
            </button>
            <button onClick={testar} disabled={testando} style={{ padding: '8px 14px', background: 'none', border: '0.5px solid var(--border)', borderRadius: 7, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
              {testando ? '...' : '🔗 Testar URL'}
            </button>
            <button onClick={cancelar} style={{ padding: '8px 14px', background: 'none', border: '0.5px solid var(--border)', borderRadius: 7, fontSize: 13, color: 'var(--text-3)', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ConfiguracoesPage() {
  const [config, setConfig]   = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [busca, setBusca]     = useState('')
  const [msgGlobal, setMsgGlobal] = useState('')

  useEffect(() => { carregarConfig() }, [])

  async function carregarConfig() {
    setLoading(true)
    try {
      const res  = await fetch('/api/rpa/config')
      const data = await res.json()
      if (data.config) setConfig(data.config)
    } catch { setMsgGlobal('Erro ao carregar configurações.') }
    setLoading(false)
  }

  async function salvarCredencial(id: string, dados: Partial<Seguradora>) {
    setSalvando(id)
    try {
      // Salva URL
      if (dados.url !== config?.[id]?.url) {
        await fetch('/api/rpa/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ seguradora:id, url:dados.url }) })
      }
      // Salva cada campo alterado
      for (const [campo, valor] of Object.entries(dados.campos || {})) {
        if (valor !== config?.[id]?.campos?.[campo]) {
          await fetch('/api/rpa/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ seguradora:id, campo, valor }) })
        }
      }
      // Atualiza estado local
      setConfig(prev => prev ? { ...prev, [id]: { ...prev[id], ...dados, campos: { ...prev[id]?.campos, ...dados.campos } } } : prev)
    } catch (e: any) {
      setMsgGlobal(`Erro ao salvar: ${e.message}`)
    }
    setSalvando(null)
  }

  const configFiltrada = config
    ? Object.entries(config).filter(([id, seg]) =>
        !busca || seg.label.toLowerCase().includes(busca.toLowerCase()) || id.includes(busca.toLowerCase())
      )
    : []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>⚙️ Configurações — Credenciais</span>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '1.5rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Credenciais das Seguradoras</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
          Atualize usuários, senhas e URLs sem precisar mexer no código. Senhas são criptografadas antes de salvar.
        </p>

        {/* Alerta de segurança */}
        <div style={{ padding: '10px 14px', background: '#FAEEDA', border: '0.5px solid #BA7517', borderRadius: 8, fontSize: 12, color: '#633806', marginBottom: '1.25rem' }}>
          🔒 As senhas são criptografadas com AES-256 antes de serem salvas no servidor. Nunca são enviadas em texto puro.
        </div>

        {msgGlobal && (
          <div style={{ padding: '10px 14px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F', marginBottom: 12 }}>❌ {msgGlobal}</div>
        )}

        {/* Busca */}
        <input
          type="text"
          placeholder="Buscar seguradora..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '0.5px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, marginBottom: 14 }}
        />

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem', fontSize: 14 }}>Carregando configurações...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {configFiltrada.map(([id, seg]) => (
              <CardSeguradora key={id} id={id} seg={seg} onSalvar={salvarCredencial} salvando={salvando} />
            ))}
            {configFiltrada.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem', fontSize: 14 }}>Nenhuma seguradora encontrada.</div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-3)' }}>
          💡 Clique em qualquer card para editar. Use "Testar URL" para verificar se o portal está acessível antes de rodar a automação.
        </div>
      </div>
    </div>
  )
}
