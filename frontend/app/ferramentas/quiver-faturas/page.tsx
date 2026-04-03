'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import { JobStatus, useJobPolling, type Job } from '../../../components/JobStatus'

export default function QuiverFaturasPage() {
  const [arquivos, setArquivos]   = useState<File[]>([])
  const [enviando, setEnviando]   = useState(false)
  const [job, setJob]             = useState<Job | null>(null)
  const [erroEnvio, setErroEnvio] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useJobPolling(
    job?.status !== 'concluido' && job?.status !== 'erro_critico' ? job?.id ?? null : null,
    setJob,
    '/quiver-faturas'
  )

  function adicionarArquivos(files: FileList) {
    const novos = Array.from(files).filter(f => f.name.endsWith('.pdf'))
    setArquivos(prev => { const nomes = new Set(prev.map(f => f.name)); return [...prev, ...novos.filter(f => !nomes.has(f.name))] })
  }

  async function enviar() {
    if (!arquivos.length) return
    setEnviando(true); setErroEnvio('')
    const form = new FormData()
    arquivos.forEach(f => form.append('arquivos', f))
    try {
      const res  = await fetch('/api/rpa/quiver-faturas/cadastrar', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.erro || 'Erro no servidor')
      setArquivos([])
      setJob({ id: data.jobId || 'qf-' + Date.now(), status: 'cadastrando', progresso: 0, total: arquivos.length, resultados: [], erro: null })
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
        <span style={{ fontSize: 13, fontWeight: 500 }}>Quiver — Cadastro de Faturas</span>
        {job && job.status !== 'concluido' && job.status !== 'erro_critico' && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Processando
          </span>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Cadastro de Faturas</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: '1.5rem' }}>Envie os PDFs. O sistema extrai e cadastra no Quiver PRO automaticamente.</p>
        {!job && (
          <>
            <div onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); adicionarArquivos(e.dataTransfer.files) }}
              style={{ border: '1.5px dashed var(--border-strong)', borderRadius: 12, padding: '1.5rem', textAlign: 'center', cursor: 'pointer', background: 'var(--surface)', marginBottom: 12 }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>📑</div>
              <div style={{ fontSize: 14, color: 'var(--text-2)' }}><strong style={{ color: 'var(--text)' }}>Clique</strong> ou arraste os PDFs · múltiplos arquivos</div>
            </div>
            <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={e => { if(e.target.files) adicionarArquivos(e.target.files) }} />
            {arquivos.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
                {arquivos.map((f, i) => (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: i < arquivos.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                    <span>📄</span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{f.name}</div><div style={{ fontSize: 11, color: 'var(--text-3)' }}>{(f.size/1024).toFixed(1)} KB</div></div>
                    <button onClick={() => setArquivos(p => p.filter(a => a.name !== f.name))} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={enviar} disabled={!arquivos.length || enviando} style={{ width: '100%', padding: '11px', background: !arquivos.length || enviando ? 'var(--border)' : '#185FA5', color: !arquivos.length || enviando ? 'var(--text-3)' : '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500 }}>
              {enviando ? '⏳ Enviando...' : arquivos.length ? `Cadastrar ${arquivos.length} fatura(s)` : 'Selecione os PDFs'}
            </button>
            {erroEnvio && <div style={{ marginTop: 10, padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#791F1F' }}>❌ {erroEnvio}</div>}
          </>
        )}
        <JobStatus
          job={job}
          statusLabel={{ cadastrando: '⚙️  Cadastrando no Quiver PRO...', concluido: '✅ Faturas cadastradas' }}
          onNovaExecucao={() => { setJob(null); setArquivos([]) }}
          onReenviarErros={() => { setJob(null); setArquivos([]) }}
        />
      </div>
    </div>
  )
}
