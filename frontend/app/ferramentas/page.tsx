'use client'
import Link from 'next/link'
import { useState } from 'react'

const USUARIO_CORES: Record<string, string> = {
  'Giovana':  '#1D9E75',
  'João':     '#185FA5',
  'Bárbara':  '#993556',
  'Todos':    '#5F5E5A',
}

const FERRAMENTAS = [
  {
    slug: 'unimed-grupos',
    nome: 'Unimed — Grupos Vida',
    descricao: 'Atualiza lista de grupos e notifica a equipe por email',
    responsavel: 'Giovana',
    seguradora: 'Unimed',
    tipo: 'upload',
    status: 'ativo',
  },
  {
    slug: 'unimed-boletos',
    nome: 'Unimed — Boletos Vida',
    descricao: 'Baixa 2ª via de boletos por grupo e salva no Drive',
    responsavel: 'Giovana',
    seguradora: 'Unimed',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'quiver-faturas',
    nome: 'Quiver — Cadastro de Faturas',
    descricao: 'Cadastra faturas RCTR-C e RC-DC no Quiver PRO',
    responsavel: 'Giovana',
    seguradora: 'Várias',
    tipo: 'upload',
    status: 'ativo',
  },
  {
    slug: 'quiver-faturas-transporte',
    nome: 'Quiver — Faturas Transporte',
    descricao: 'PDF de fatura → extrai via IA → cadastra no Quiver PRO automaticamente',
    responsavel: 'Giovana',
    seguradora: 'Tokio, Sompo, AKAD, AXA, Chubb, Allianz',
    tipo: 'upload',
    status: 'ativo',
  },
  {
    slug: 'allianz-inadimplentes',
    nome: 'Allianz — Gestão de Inadimplentes',
    descricao: 'AllianzNet · GESTÃO → Financeiro → Gestão de Inadimplentes · todas as páginas',
    responsavel: 'João',
    seguradora: 'Allianz',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'tokio-inadimplentes',
    nome: 'Tokio Marine — Inadimplentes',
    descricao: 'Portal Corretor · FINANCEIRO → Clientes Inadimplentes · CSV + email',
    responsavel: 'João',
    seguradora: 'Tokio Marine',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'axa-inadimplentes',
    nome: 'AXA — Parcelas em Atraso',
    descricao: 'e-solutions.axa.com.br · Serviços → Financeiro → Pagamento e Boletos · Ramo 43',
    responsavel: 'João',
    seguradora: 'AXA',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'chubb-inadimplentes',
    nome: 'Chubb — Parcelas Pendentes',
    descricao: 'ChubbNet → Serviços → Financeiro → Cobrança · todos os ramos · 120 dias',
    responsavel: 'João',
    seguradora: 'Chubb',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'sompo-inadimplentes',
    nome: 'Sompo — Parcelas Pendentes',
    descricao: 'Portal Corretor · COBRANÇA → Consultar Parcelas · Situação Pendente',
    responsavel: 'João',
    seguradora: 'Sompo',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'akad-inadimplentes',
    nome: 'AKAD — Parcelas em Aberto',
    descricao: 'AKAD Digital · Financeiro → Parcelas em Aberto · todos os ramos',
    responsavel: 'João',
    seguradora: 'AKAD',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'yelum-inadimplentes',
    nome: 'Yelum — Parcelas Atrasadas',
    descricao: 'Gestão de Parcelas · todos os estabelecimentos · últimos 90 dias',
    responsavel: 'João',
    seguradora: 'Yelum',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'mitsui-inadimplentes',
    nome: 'Mitsui — Parcelas Pendentes',
    descricao: 'Kit Online · FINANCEIRO → aba Pendentes · período vencimento',
    responsavel: 'João',
    seguradora: 'Mitsui',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'essor-inadimplentes',
    nome: 'Essor — Parcelas Pendentes',
    descricao: 'portal.essor.com.br · Consultas → Parcelas Pendentes · dias em atraso',
    responsavel: 'João',
    seguradora: 'Essor',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'metlife-inadimplentes',
    nome: 'MetLife — Inadimplentes',
    descricao: 'Portal MetLife · Cobrança → Clientes inadimplentes · vencidas > 7 dias',
    responsavel: 'João',
    seguradora: 'MetLife',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'unimed-seguros-inadimplentes',
    nome: 'Unimed Seguros — Inadimplentes',
    descricao: 'Vida + Ramos Elementares + Previdência · Relatório de Inadimplência · 3 categorias',
    responsavel: 'João',
    seguradora: 'Unimed',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'plano-hospitalar',
    nome: 'Plano Hospitalar — Boletos',
    descricao: 'SolusWeb · 30+ clientes · boleto + fatura → Google Drive · email resumo',
    responsavel: 'Bárbara',
    seguradora: 'Saúde',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'historico',
    nome: '📊 Histórico',
    descricao: 'Todas as execuções — status, duração, erros e valor total por seguradora',
    responsavel: 'Todos',
    seguradora: 'Sistema',
    tipo: 'automatico',
    status: 'ativo',
  },
  {
    slug: 'configuracoes',
    nome: '⚙️ Configurações',
    descricao: 'Atualizar usuários, senhas e URLs das seguradoras — sem mexer no código',
    responsavel: 'Todos',
    seguradora: 'Sistema',
    tipo: 'upload',
    status: 'ativo',
  },
  {
    slug: 'relatorio-parcelas',
    nome: 'Parcelas em Atraso',
    descricao: 'Extrai relatório de inadimplência de todas as seguradoras',
    responsavel: 'João',
    seguradora: 'Todas',
    tipo: 'automatico',
    status: 'em-breve',
  },
  {
    slug: 'saude-faturas',
    nome: 'Saúde — Faturas',
    descricao: 'Baixa faturas dos planos de saúde (Unimed, etc.)',
    responsavel: 'Bárbara',
    seguradora: 'Saúde',
    tipo: 'automatico',
    status: 'em-breve',
  },
]

const TIPO_LABEL: Record<string, string> = {
  upload: 'Upload',
  automatico: 'Automático',
}

export default function FeramentasPage() {
  const [filtro, setFiltro] = useState('Todos')
  const usuarios = ['Todos', 'Giovana', 'João', 'Bárbara']

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
                      f.responsavel === 'João' ? '#E6F1FB' : '#FBEAF0',
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
