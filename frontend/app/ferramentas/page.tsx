'use client'
import Link from 'next/link'
import { useState } from 'react'

const USUARIO_CORES: Record<string, string> = {
  'Giovana':   '#1D9E75',
  'João':      '#185FA5',
  'Bárbara':   '#993556',
  'Giacomet':  '#B8860B',
  'Todos':     '#5F5E5A',
}

const FERRAMENTAS = [
  {
    slug: 'quiver-faturas',
    nome: 'Quiver — Cadastro de Faturas',
    descricao: 'PDF (RCTR-C / RC-DC) ou planilha XLSX (AKAD RC-V) → extrai via IA → cadastra no Quiver PRO',
    responsavel: 'Giovana',
    seguradora: 'Tokio, Sompo, AKAD, AXA, Chubb, Allianz, Unimed',
    tipo: 'upload',
    status: 'ativo',
  },
  {
    slug: 'faturas',
    nome: '📋 Revisão de Faturas',
    descricao: 'Acompanha o que foi cadastrado, revisa e corrige erros de extração',
    responsavel: 'Giovana',
    seguradora: 'Quiver',
    tipo: 'automatico',
    status: 'ativo',
  },
]

const TIPO_LABEL: Record<string, string> = {
  upload: 'Upload',
  automatico: 'Automático',
}

export default function FeramentasPage() {
  const [filtro, setFiltro] = useState('Todos')
  const usuarios = ['Todos', 'Giovana']

  const lista = filtro === 'Todos'
    ? FERRAMENTAS
    : FERRAMENTAS.filter(f => f.responsavel === filtro)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '0.5px solid var(--border)',
        padding: '1rem 1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, background: 'var(--accent-bg)',
            borderRadius: 8, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 16,
          }}>🛡️</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Ferramentas Jacometo</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Hub interno</div>
          </div>
        </div>
        <a href="/api/auth/logout" style={{
          fontSize: 12, color: 'var(--text-3)',
          padding: '4px 10px',
          border: '0.5px solid var(--border)',
          borderRadius: 6,
        }}>Sair</a>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.5rem 1rem' }}>
        {/* Filtro por responsável */}
        <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {usuarios.map(u => (
            <button
              key={u}
              onClick={() => setFiltro(u)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: '0.5px solid var(--border)',
                background: filtro === u ? USUARIO_CORES[u] : 'var(--surface)',
                color: filtro === u ? '#fff' : 'var(--text-2)',
                fontSize: 13, fontWeight: filtro === u ? 500 : 400,
                transition: 'all 0.15s',
              }}
            >{u}</button>
          ))}
        </div>

        {/* Grid de ferramentas */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 12,
        }}>
          {lista.map(f => (
            <FerramentaCard key={f.slug} f={f} />
          ))}
        </div>
      </div>
    </div>
  )
}

function FerramentaCard({ f }: { f: typeof FERRAMENTAS[0] }) {
  const cor = USUARIO_CORES[f.responsavel] || '#5F5E5A'
  const ativo = f.status === 'ativo'

  return (
    <div style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '1.25rem',
      opacity: ativo ? 1 : 0.6,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Barra de cor do responsável */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 3, background: cor, borderRadius: '12px 12px 0 0',
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 3 }}>{f.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{f.descricao}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{
          fontSize: 11, padding: '2px 8px',
          background: 'var(--bg)', border: '0.5px solid var(--border)',
          borderRadius: 20, color: 'var(--text-2)',
        }}>{f.seguradora}</span>
        <span style={{
          fontSize: 11, padding: '2px 8px',
          background: 'var(--bg)', border: '0.5px solid var(--border)',
          borderRadius: 20, color: 'var(--text-2)',
        }}>{TIPO_LABEL[f.tipo]}</span>
        <span style={{
          fontSize: 11, padding: '2px 8px',
          borderRadius: 20,
          background: f.responsavel === 'Giovana' ? '#E1F5EE' :
                      f.responsavel === 'João' ? '#E6F1FB' :
                      f.responsavel === 'Giacomet' ? '#FFF3CD' : '#FBEAF0',
          color: cor,
          fontWeight: 500,
        }}>{f.responsavel}</span>

        <div style={{ marginLeft: 'auto' }}>
          {ativo ? (
            <Link href={`/ferramentas/${f.slug}`} style={{
              display: 'inline-block',
              padding: '6px 14px',
              background: cor, color: '#fff',
              borderRadius: 8, fontSize: 13, fontWeight: 500,
            }}>Abrir →</Link>
          ) : (
            <span style={{
              fontSize: 12, color: 'var(--text-3)',
              padding: '6px 14px',
              border: '0.5px solid var(--border)',
              borderRadius: 8,
            }}>Em breve</span>
          )}
        </div>
      </div>
    </div>
  )
}
