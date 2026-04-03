'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import { JobStatus, type Job } from '../../../components/JobStatus'

export default function UnimedGruposPage() {
  const [arquivo, setArquivo]     = useState<File | null>(null)
  const [enviando, setEnviando]   = useState(false)
  const [job, setJob]             = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function selecionarArquivo(file: File) { setArquivo(file); setJob(null); setErroEnvio('') }

  async function processar() {
    if (!arquivo) return
    setEnviando(true); setErroEnvio('')
    const form = new FormData()
    form.append('arquivo', arquivo)
    try {
      const res  = await fetch('/api/rpa/unimed-grupos/processar', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro || 'Erro no servidor')
      setJob({
        id: 'grupos-' + Date.now(),
        status: 'concluido',
        progresso: data.total,
        total: data.total,
        erro: null,
        resultados: [
          { nome: `${data.adicionados} grupo(s) adicionado(s)`, status: data.adicionados > 0 ? 'OK' : 'AVISO', label: data.adicionados > 0 ? null : 'Nenhum grupo novo', orientacao: null, erro: null, tipo: null },
          { nome: `${data.removidos} grupo(s) removido(s)`, status: data.removidos > 0 ? 'AVISO' : 'OK', label: data.removidos > 0 ? 'Grupos removidos' : null, orientacao: data.removidos > 0 ? 'Verifique se a remoção foi intencional.' : null, erro: null, tipo: data.removidos > 0 ? 'SEM_RESULTADOS' : null },
          { nome: `${data.emailEnviado ? 'Email enviado' : 'Email não enviado'}`, status: data.emailEnviado ? 'OK' : 'AVISO', label: data.emailEnviado ? null : 'Email não foi enviado', orientacao: data.emailEnviado ? null : 'Verifique as configurações de SMTP.', erro: null, tipo: null },
        ],
      })
      setArquivo(null)
    } catch (e: any) {
      setErroEnvio(e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/ferramentas" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Ferramentas</Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Unimed — Grupos Vida</span>
      </div>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Atualização de grupos</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem' }}>Envie a planilha. O sistema detecta mudanças e notifica a equipe.</p>
        {!job && (
          <>
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: 12 }}>
              <div onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) selecionarArquivo(f) }}
                style={{ border: `1.5px dashed ${arquivo ? '#1D9E75' : 'var(--border-strong)'}`, borderRadius: 8, padding: '1.5rem', textAlign: 'center', cursor: 'pointer', background: arquivo ? '#E1F5EE' : 'var(--bg)' }}>
                {arquivo ? (
                  <div><div style={{ fontSize: 24, marginBottom: 4 }}>📊</div><div style={{ fontSize: 14, fontWeight: 500, color: '#085041' }}>{arquivo.name}</div></div>
                ) : (
                  <div><div style={{ fontSize: 24, marginBottom: 4 }}>📄</div><div style={{ fontSize: 14, color: 'var(--text-2)' }}><strong style={{ color: 'var(--text)' }}>Clique</strong> ou arraste a planilha · .xlsx ou .csv</div></div>
                )}
              </div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { if(e.target.files?.[0]) selecionarArquivo(e.target.files[0]) }} />
            </div>
            <button onClick={processar} disabled={!arquivo || enviando} style={{ width: '100%', padding: '11px', background: !arquivo || enviando ? 'var(--border)' : '#1D9E75', color: !arquivo || enviando ? 'var(--text-3)' : '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500 }}>
              {enviando ? '⏳ Processando...' : 'Processar planilha'}
            </button>
            {erroEnvio && <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>❌ {erroEnvio}</div>}
          </>
        )}
        <JobStatus job={job} statusLabel={{ concluido: '✅ Planilha processada' }} onNovaExecucao={() => { setJob(null); setArquivo(null) }} />
      </div>
    </div>
  )
}
