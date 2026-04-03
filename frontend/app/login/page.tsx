'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErro('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    })
    if (res.ok) {
      router.push('/ferramentas')
    } else {
      setErro('Senha incorreta.')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: '1rem',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '2rem',
        width: '100%', maxWidth: '360px',
      }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{
            width: 40, height: 40,
            background: 'var(--accent-bg)',
            borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '1rem',
            fontSize: 20,
          }}>🛡️</div>
          <h1 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>
            Ferramentas Jacometo
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
            Acesso restrito à equipe interna
          </p>
        </div>

        <form onSubmit={entrar}>
          <input
            type="password"
            placeholder="Senha de acesso"
            value={senha}
            onChange={e => setSenha(e.target.value)}
            autoFocus
            style={{
              width: '100%', padding: '10px 12px',
              border: `0.5px solid ${erro ? '#E24B4A' : 'var(--border-strong)'}`,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 15,
              outline: 'none',
              marginBottom: 8,
            }}
          />
          {erro && (
            <p style={{ fontSize: 12, color: '#E24B4A', marginBottom: 8 }}>{erro}</p>
          )}
          <button
            type="submit"
            disabled={loading || !senha}
            style={{
              width: '100%', padding: '10px',
              background: loading || !senha ? 'var(--border)' : 'var(--accent)',
              color: loading || !senha ? 'var(--text-3)' : '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14, fontWeight: 500,
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
