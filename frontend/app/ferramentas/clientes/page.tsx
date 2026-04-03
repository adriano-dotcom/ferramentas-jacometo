'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, type ClientePlanoHospitalar } from '../../../lib/supabase'

const DIAS_VENC = [5, 10, 13, 15, 20, 25, 30]

const VAZIO: Omit<ClientePlanoHospitalar, 'id' | 'created_at' | 'updated_at'> = {
  nome: '', cnpj: '', login: '', senha: '', vencimento: 5, ativo: true, observacao: null,
}

function fmtCNPJ(v: string) {
  const n = v.replace(/\D/g, '').substring(0, 14)
  return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') || n
}

export default function ClientesPage() {
  const [clientes, setClientes]     = useState<ClientePlanoHospitalar[]>([])
  const [loading, setLoading]       = useState(true)
  const [filtroDia, setFiltroDia]   = useState<number | null>(null)
  const [filtroAtivo, setFiltroAtivo] = useState<boolean | null>(true)
  const [editando, setEditando]     = useState<ClientePlanoHospitalar | null>(null)
  const [form, setForm]             = useState(VAZIO)
  const [salvando, setSalvando]     = useState(false)
  const [msg, setMsg]               = useState('')
  const [busca, setBusca]           = useState('')

  async function carregar() {
    setLoading(true)
    let q = supabase.from('clientes_plano_hospitalar').select('*').order('nome')
    if (filtroDia !== null) q = q.eq('vencimento', filtroDia)
    if (filtroAtivo !== null) q = q.eq('ativo', filtroAtivo)
    const { data } = await q
    setClientes((data || []) as ClientePlanoHospitalar[])
    setLoading(false)
  }

  useEffect(() => { carregar() }, [filtroDia, filtroAtivo])

  function abrirNovo() {
    setEditando(null)
    setForm(VAZIO)
  }

  function abrirEditar(c: ClientePlanoHospitalar) {
    setEditando(c)
    setForm({ nome: c.nome, cnpj: c.cnpj, login: c.login, senha: c.senha, vencimento: c.vencimento, ativo: c.ativo, observacao: c.observacao })
  }

  async function salvar() {
    if (!form.nome || !form.login) return setMsg('Nome e Login são obrigatórios.')
    setSalvando(true); setMsg('')
    const payload = { ...form, cnpj: form.cnpj.replace(/\D/g, '') }
    let err
    if (editando) {
      const { error } = await supabase.from('clientes_plano_hospitalar').update(payload).eq('id', editando.id)
      err = error
    } else {
      const { error } = await supabase.from('clientes_plano_hospitalar').insert(payload)
      err = error
    }
    if (err) { setMsg(`Erro: ${err.message}`); setSalvando(false); return }
    setMsg(editando ? 'Cliente atualizado.' : 'Cliente adicionado.')
    setEditando(null); setForm(VAZIO)
    await carregar()
    setSalvando(false)
    setTimeout(() => setMsg(''), 3000)
  }

  async function toggleAtivo(c: ClientePlanoHospitalar) {
    await supabase.from('clientes_plano_hospitalar').update({ ativo: !c.ativo }).eq('id', c.id)
    carregar()
  }

  async function excluir(c: ClientePlanoHospitalar) {
    if (!confirm(`Excluir ${c.nome}?`)) return
    await supabase.from('clientes_plano_hospitalar').delete().eq('id', c.id)
    carregar()
  }

  const clientesFiltrados = clientes.filter(c =>
    !busca || c.nome.toLowerCase().includes(busca.toLowerCase()) || c.cnpj.includes(busca)
  )
  const totalAtivos = clientes.filter(c => c.ativo).length

  const inputStyle = { width: '100%', padding: '7px 10px', border: '0.5px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <Link href="/ferramentas/plano-hospitalar" style={{ color: 'var(--text-3)', fontSize: 13 }}>Plano Hospitalar</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Clientes ({totalAtivos} ativos)</span>
        <button onClick={abrirNovo} style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 14px', background: '#993556', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 500 }}>
          + Novo cliente
        </button>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.5rem 1rem', display: 'grid', gridTemplateColumns: editando !== undefined ? '1fr 340px' : '1fr', gap: 16 }}>

        {/* Lista */}
        <div>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou CNPJ..."
              style={{ flex: 1, minWidth: 180, padding: '6px 10px', border: '0.5px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }} />
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setFiltroDia(null)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '0.5px solid var(--border)', background: filtroDia === null ? '#993556' : 'var(--surface)', color: filtroDia === null ? '#fff' : 'var(--text-2)', cursor: 'pointer' }}>Todos</button>
              {DIAS_VENC.map(d => (
                <button key={d} onClick={() => setFiltroDia(filtroDia === d ? null : d)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '0.5px solid var(--border)', background: filtroDia === d ? '#993556' : 'var(--surface)', color: filtroDia === d ? '#fff' : 'var(--text-2)', cursor: 'pointer' }}>Dia {d}</button>
              ))}
            </div>
            <button onClick={() => setFiltroAtivo(filtroAtivo === true ? null : true)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '0.5px solid var(--border)', background: filtroAtivo === true ? '#1D9E75' : 'var(--surface)', color: filtroAtivo === true ? '#fff' : 'var(--text-2)', cursor: 'pointer' }}>
              Só ativos
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem', fontSize: 14 }}>Carregando...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {clientesFiltrados.map(c => (
                <div key={c.id} style={{ background: 'var(--surface)', border: `0.5px solid ${c.ativo ? 'var(--border)' : 'var(--border)'}`, borderRadius: 10, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, opacity: c.ativo ? 1 : 0.5 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.nome}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                      CNPJ {fmtCNPJ(c.cnpj)} · Login: {c.login} · Venc: dia {c.vencimento}
                      {c.observacao && ` · ${c.observacao}`}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: c.ativo ? '#E1F5EE' : 'var(--bg)', color: c.ativo ? '#085041' : 'var(--text-3)' }}>
                    {c.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button onClick={() => abrirEditar(c)} style={{ fontSize: 11, padding: '3px 9px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'var(--text-2)' }}>Editar</button>
                    <button onClick={() => toggleAtivo(c)} style={{ fontSize: 11, padding: '3px 9px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>{c.ativo ? 'Desativar' : 'Ativar'}</button>
                    <button onClick={() => excluir(c)} style={{ fontSize: 11, padding: '3px 9px', border: '0.5px solid #E24B4A', borderRadius: 6, background: 'none', cursor: 'pointer', color: '#E24B4A' }}>Excluir</button>
                  </div>
                </div>
              ))}
              {clientesFiltrados.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem', fontSize: 14 }}>Nenhum cliente encontrado. Clique em "+ Novo cliente".</div>
              )}
            </div>
          )}
        </div>

        {/* Formulário (novo ou editar) */}
        {(editando !== null || form.nome !== '') && (
          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '16px', height: 'fit-content', position: 'sticky', top: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>{editando ? 'Editar cliente' : 'Novo cliente'}</div>

            {[
              { label: 'Nome da empresa *', field: 'nome' as const },
              { label: 'CNPJ', field: 'cnpj' as const },
              { label: 'Login (CNPJ sem pontuação) *', field: 'login' as const },
              { label: 'Senha', field: 'senha' as const },
              { label: 'Observação', field: 'observacao' as const },
            ].map(({ label, field }) => (
              <div key={field} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>{label}</label>
                <input value={(form[field] as string) || ''} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))} style={inputStyle} />
              </div>
            ))}

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>Dia de vencimento</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {DIAS_VENC.map(d => (
                  <button key={d} onClick={() => setForm(p => ({ ...p, vencimento: d }))} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, border: '0.5px solid var(--border)', background: form.vencimento === d ? '#993556' : 'var(--bg)', color: form.vencimento === d ? '#fff' : 'var(--text-2)', cursor: 'pointer' }}>
                    Dia {d}
                  </button>
                ))}
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.ativo} onChange={e => setForm(p => ({ ...p, ativo: e.target.checked }))} />
              Cliente ativo
            </label>

            {msg && <div style={{ padding: '8px 10px', background: msg.startsWith('Erro') ? '#FCEBEB' : '#E1F5EE', borderRadius: 7, fontSize: 12, color: msg.startsWith('Erro') ? '#791F1F' : '#085041', marginBottom: 10 }}>{msg}</div>}

            <div style={{ display: 'flex', gap: 7 }}>
              <button onClick={salvar} disabled={salvando} style={{ flex: 1, padding: '9px', background: salvando ? 'var(--border)' : '#993556', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Adicionar cliente'}
              </button>
              <button onClick={() => { setEditando(null); setForm(VAZIO) }} style={{ padding: '9px 14px', background: 'none', border: '0.5px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', color: 'var(--text-3)' }}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
