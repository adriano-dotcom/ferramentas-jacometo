// src/jobs/sompo-inadimplentes.js
// Login corretor.sompo.com.br → COBRANÇA → Consultar Parcelas → Situação:Pendente → Ramo:Todos → exporta
require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_sompo = getCred('sompo')
let LOGIN_USER = _cred_sompo.usuario || ''
let LOGIN_SENHA = _cred_sompo.senha || ''
let PORTAL_URL = getCred('sompo').url || ''

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const log    = require('../lib/logger')
const email  = require('../lib/email')
const { abrirBrowser, fecharBrowser } = require('../lib/browser')

const JOBS = new Map()
function criarJob() {
  const id = crypto.randomUUID()
  JOBS.set(id, { id, status: 'executando', progresso: 0, total: 5, resultados: [], erro: null, criadoEm: Date.now() })
  for (const [k, v] of JOBS) { if (Date.now() - v.criadoEm > 7200000) JOBS.delete(k) }
  return id
}
function atualizar(id, dados) { const j = JOBS.get(id); if (j) JOBS.set(id, { ...j, ...dados }) }
function getJobStatus(req, res) {
  const job = JOBS.get(req.params.jobId)
  if (!job) return res.status(404).json({ erro: 'Job não encontrado.' })
  res.json(job)
}




const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

async function ss(page, nome) {
  try { fs.mkdirSync(SCREENSHOTS, {recursive:true}); const p=path.join(SCREENSHOTS,nome); await page.screenshot({path:p}); return p } catch { return null }
}

function classErr(msg) {
  if (!msg) return { tipo:'DESCONHECIDO', label:'Erro desconhecido', orientacao:'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN')||u.includes('SENHA')||u.includes('USUARIO')) return { tipo:'LOGIN_FALHOU', label:'Login falhou no portal Sompo', orientacao:'Verifique código de usuário e senha em corretor.sompo.com.br.' }
  if (u.includes('COBRANCA')||u.includes('MENU')||u.includes('PARCELA')) return { tipo:'NAVEGACAO', label:'Erro ao navegar no menu Sompo', orientacao:'Caminho: COBRANÇA → Consultar Parcelas. Layout pode ter mudado.' }
  if (u.includes('TIMEOUT')||u.includes('EXCEEDED')) return { tipo:'TIMEOUT', label:'Portal Sompo demorou para responder', orientacao:'Instabilidade. Tente novamente.' }
  return { tipo:'OUTRO', label:msg.substring(0,80), orientacao:'Verifique o log e tente novamente.' }
}

module.exports = async function routeSompoInadimplentes(req, res) {
  const jobId = criarJob()
  log.info(`Job Sompo inadimplentes — ${jobId}`)
  res.json({ ok: true, jobId, mensagem: 'Iniciando extração de inadimplentes da Sompo.' })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, 'sompo')
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred('sompo')
    PORTAL_URL = _creds.url || PORTAL_URL
    LOGIN_USER = _creds.usuario || LOGIN_USER
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()
    try {
      // 1. Login
      log.info('Acessando portal Sompo...')
      await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 45000 })
      await page.waitForTimeout(2000)
      await page.locator('input[name*="user"], input[id*="user"], input[type="text"]').first().fill(LOGIN_USER)
      await page.locator('input[type="password"]').first().fill(LOGIN_SENHA)
      await page.locator('button[type="submit"], input[type="submit"], button:has-text("Entrar")').first().click()
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso: 1 })

      // 2. Navegar para COBRANÇA > Consultar Parcelas
      log.info('Navegando para COBRANÇA → Consultar Parcelas...')
      await page.locator('a:has-text("COBRANÇA"), a:has-text("Cobrança"), a:has-text("COBRAN")').first().click()
      await page.waitForTimeout(1500)
      await page.locator('a:has-text("Consultar Parcelas"), a:has-text("2ª via"), a:has-text("Boleto")').first().click()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)
      atualizar(jobId, { progresso: 2 })

      // 3. Filtros: Situação=Pendente, Ramo=Todos, período amplo
      log.info('Aplicando filtros...')
      const hoje = new Date()
      const anoPassado = new Date(hoje.getFullYear() - 1, 0, 1)
      const dataInicio = `${String(anoPassado.getDate()).padStart(2,'0')}/${String(anoPassado.getMonth()+1).padStart(2,'0')}/${anoPassado.getFullYear()}`
      const dataFim    = `${String(hoje.getDate()).padStart(2,'0')}/${String(hoje.getMonth()+1).padStart(2,'0')}/${hoje.getFullYear()}`

      // Situação: Pendente
      const selSit = page.locator('select[name*="situac"], select[id*="situac"], select[name*="status"]').first()
      if (await selSit.count() > 0) await selSit.selectOption({ label: /pendente/i }).catch(() => {})

      // Ramo: Todos
      const selRamo = page.locator('select[name*="ramo"], select[id*="ramo"]').first()
      if (await selRamo.count() > 0) await selRamo.selectOption({ label: /todos/i }).catch(() => {})

      // Período de vencimento
      const dtIni = page.locator('input[name*="dataini"], input[name*="inicio"], input[id*="dataini"]').first()
      const dtFim = page.locator('input[name*="datafim"], input[name*="fim"], input[id*="datafim"]').first()
      if (await dtIni.count() > 0) await dtIni.fill(dataInicio)
      if (await dtFim.count() > 0) await dtFim.fill(dataFim)

      await page.locator('button:has-text("Pesquisar"), button:has-text("Consultar"), button[type="submit"]').first().click()
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso: 3 })

      // 4. Extrai dados
      log.info('Extraindo dados...')
      const parcelas = []
      let pagina = 1
      while (true) {
        const linhas = await page.locator('table tbody tr').all()
        for (const linha of linhas) {
          const cols = await linha.locator('td').all()
          if (cols.length < 4) continue
          const v = await Promise.all(cols.map(c => c.textContent().then(t => t?.trim()||'')))
          if (v[0] && v[2]) parcelas.push({ segurado:v[0], cnpj:v[1]||'', apolice:v[2]||'', endosso:v[3]||'', ramo:v[4]||'', valor:v[5]||'', vencimento:v[6]||'', status:v[7]||'Pendente' })
        }
        const next = page.locator('a:has-text("Próxima"), [aria-label="Next"], .pagination-next:not(.disabled)').first()
        if (await next.count() === 0 || !await next.isEnabled().catch(()=>false)) break
        await next.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(2000)
        if (++pagina > 50) break
      }
      log.ok(`${parcelas.length} parcela(s) extraída(s).`)

      // Tenta exportar Excel
      let csvPath = null
      try {
        const btnExp = page.locator('button:has-text("Exportar"), a:has-text("Excel"), a:has-text("Exportar")').first()
        if (await btnExp.count() > 0) {
          const [dl] = await Promise.all([page.waitForEvent('download',{timeout:15000}), btnExp.click()])
          fs.mkdirSync(DOWNLOAD_DIR,{recursive:true})
          const d = path.join(DOWNLOAD_DIR, `SOMPO_INADIMPLENTES_${new Date().toISOString().substring(0,10).replace(/-/g,'_')}.xlsx`)
          await dl.saveAs(d); csvPath = d; log.ok(`Exportado: ${d}`)
        }
      } catch { log.warn('Exportação falhou, gerando CSV manual.') }

      if (!csvPath && parcelas.length > 0) {
        const dest = path.join(DOWNLOAD_DIR, `SOMPO_INADIMPLENTES_${new Date().toISOString().substring(0,10).replace(/-/g,'_')}.csv`)
        fs.mkdirSync(DOWNLOAD_DIR,{recursive:true})
        fs.writeFileSync(dest, ['segurado;cnpj;apolice;endosso;ramo;valor;vencimento;status', ...parcelas.map(p=>[p.segurado,p.cnpj,p.apolice,p.endosso,p.ramo,p.valor,p.vencimento,p.status].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(';'))].join('\n'))
        csvPath = dest
      }
      atualizar(jobId, { progresso: 4 })

      const resultados = parcelas.length === 0
        ? [{ nome:'Nenhuma parcela pendente encontrada', status:'OK', label:null, orientacao:null, erro:null, tipo:null }]
        : parcelas.map(p=>({ nome:p.segurado, sub:`${p.ramo} · Apólice ${p.apolice} | R$ ${p.valor} | Venc: ${p.vencimento}`, status:'OK', label:null, orientacao:null, erro:null, tipo:null }))

      atualizar(jobId, { status:'concluido', progresso:5, resultados })
      await db.jobConcluido(jobId, 'sompo', { resultados, csvPath: csvPath || null }, _inicio)

      // 5. Email
      const hoje2 = new Date().toLocaleDateString('pt-BR')
      const total = parcelas.reduce((a,p)=>a+(parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.'))||0),0)
      await email.enviar({
        assunto: parcelas.length === 0 ? `Sompo — Sem inadimplentes em ${hoje2}` : `Sompo — Parcelas Pendentes — ${parcelas.length} parcela(s) — ${hoje2}`,
        corpo: parcelas.length === 0
          ? `Prezado Adriano,\n\nNenhuma parcela pendente encontrada na Sompo em ${hoje2}.\n\nAtenciosamente,\nSistema Ferramentas Jacometo`
          : `RELATÓRIO DE PARCELAS PENDENTES - SOMPO\nData: ${hoje2}\nJob: ${jobId}\n\nTotal: ${parcelas.length} parcela(s)\nValor total: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\n${parcelas.map((p,i)=>`${i+1}. ${p.segurado}\n   Apólice ${p.apolice} | ${p.ramo} | R$ ${p.valor} | Venc: ${p.vencimento}`).join('\n\n')}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`,
        anexo: csvPath || undefined,
      })
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const s = await ss(page, `erro_sompo_${Date.now()}.png`)
      const cl = classErr(e.message)
      atualizar(jobId, { status:'erro_critico', erro:e.message, resultados:[{ nome:'Sompo — Extração falhou', sub:cl.label, status:'FALHA', label:cl.label, orientacao:cl.orientacao, erro:e.message, tipo:cl.tipo, screenshotPath:s }] })
      await db.jobErro(jobId, 'sompo', e.message, _inicio)
      await email.enviar({ assunto:'❌ Sompo inadimplentes — Erro', corpo:`Job: ${jobId}\nErro: ${e.message}\nTipo: ${cl.label}\nAção: ${cl.orientacao}` })
    } finally { await fecharBrowser(browser) }
  })
}
module.exports.getJobStatus = getJobStatus
