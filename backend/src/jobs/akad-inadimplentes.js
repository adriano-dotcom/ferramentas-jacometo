// src/jobs/akad-inadimplentes.js
// Login digital.akadseguros.com.br → Financeiro → Parcelas em Aberto
require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_akad = getCred('akad')
let LOGIN_CPF = _cred_akad.cpf || ''
let LOGIN_SENHA = _cred_akad.senha || ''
let PORTAL_URL = getCred('akad').url || ''

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const log    = require('../lib/logger')
const email  = require('../lib/email')
const { abrirBrowser, fecharBrowser } = require('../lib/browser')

const JOBS = new Map()
function criarJob() {
  const id = crypto.randomUUID()
  JOBS.set(id, { id, status:'executando', progresso:0, total:5, resultados:[], erro:null, criadoEm:Date.now() })
  for (const [k,v] of JOBS) { if (Date.now()-v.criadoEm>7200000) JOBS.delete(k) }
  return id
}
function atualizar(id, dados) { const j=JOBS.get(id); if(j) JOBS.set(id,{...j,...dados}) }
module.exports.getJobStatus = (req, res) => {
  const job = JOBS.get(req.params.jobId)
  if (!job) return res.status(404).json({ erro:'Job não encontrado.' })
  res.json(job)
}




const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

async function ss(page, nome) {
  try { fs.mkdirSync(SCREENSHOTS,{recursive:true}); const p=path.join(SCREENSHOTS,nome); await page.screenshot({path:p}); return p } catch { return null }
}
function classErr(msg) {
  if (!msg) return { tipo:'DESCONHECIDO', label:'Erro desconhecido', orientacao:'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN')||u.includes('CPF')||u.includes('SENHA')) return { tipo:'LOGIN_FALHOU', label:'Login falhou no portal AKAD Digital', orientacao:'Verifique CPF e senha em digital.akadseguros.com.br.' }
  if (u.includes('FINANCEIRO')||u.includes('PARCELA')||u.includes('MENU')) return { tipo:'NAVEGACAO', label:'Erro ao navegar no portal AKAD', orientacao:'Caminho: Ferramentas → Financeiro → Parcelas em Aberto.' }
  if (u.includes('TIMEOUT')||u.includes('EXCEEDED')) return { tipo:'TIMEOUT', label:'Portal AKAD demorou para responder', orientacao:'Instabilidade. Tente novamente.' }
  return { tipo:'OUTRO', label:msg.substring(0,80), orientacao:'Verifique o log e tente novamente.' }
}

module.exports = async function routeAkadInadimplentes(req, res) {
  const jobId = criarJob()
  log.info(`Job AKAD inadimplentes — ${jobId}`)
  res.json({ ok:true, jobId, mensagem:'Iniciando extração de inadimplentes da AKAD.' })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, 'akad')
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred('akad')
    PORTAL_URL = _creds.url || PORTAL_URL
    LOGIN_CPF = _creds.cpf || LOGIN_CPF
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()
    try {
      // 1. Login
      log.info('Acessando AKAD Digital...')
      await page.goto(PORTAL_URL, { waitUntil:'networkidle', timeout:45000 })
      await page.waitForTimeout(2500)
      await page.locator('input[name*="cpf"], input[name*="user"], input[placeholder*="CPF"], input[type="text"]').first().fill(LOGIN_CPF)
      await page.locator('input[type="password"]').first().fill(LOGIN_SENHA)
      await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login")').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso:1 })

      // 2. Ferramentas → Financeiro → Parcelas em Aberto
      log.info('Navegando para Parcelas em Aberto...')
      await page.locator('a:has-text("Ferramentas"), a:has-text("Financeiro")').first().click()
      await page.waitForTimeout(1500)
      await page.locator('a:has-text("Financeiro")').first().click().catch(async () => {
        // Pode ser submenu direto
        await page.locator('a:has-text("Parcelas"), a:has-text("Cobrança")').first().click()
      })
      await page.waitForTimeout(1500)
      await page.locator('a:has-text("Parcelas em Aberto"), a:has-text("Inadimplentes"), a:has-text("Em Aberto")').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso:2 })

      // 3. Extrai dados
      log.info('Extraindo dados...')
      const parcelas = []
      let pagina = 1
      while (true) {
        const linhas = await page.locator('table tbody tr, [class*="row"]:not([class*="header"])').all()
        for (const linha of linhas) {
          const cols = await linha.locator('td').all()
          if (cols.length < 4) continue
          const v = await Promise.all(cols.map(c=>c.textContent().then(t=>t?.trim()||'')))
          if (v[0]&&v[1]) parcelas.push({ segurado:v[0], cnpj:v[1]||'', apolice:v[2]||'', endosso:v[3]||'', ramo:v[4]||'', valor:v[5]||'', vencimento:v[6]||'', status:v[7]||'Em Aberto' })
        }
        const next = page.locator('a:has-text("Próxima"), [aria-label="Next"], .pagination-next').first()
        if (await next.count()===0||!await next.isEnabled().catch(()=>false)) break
        await next.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(2000)
        if (++pagina>50) break
      }
      log.ok(`${parcelas.length} parcela(s) extraída(s).`)
      atualizar(jobId, { progresso:3 })

      // Exporta se disponível
      let csvPath = null
      try {
        const btn = page.locator('button:has-text("Exportar"), a:has-text("Exportar"), a:has-text("CSV"), a:has-text("Excel")').first()
        if (await btn.count()>0) {
          const [dl] = await Promise.all([page.waitForEvent('download',{timeout:15000}), btn.click()])
          fs.mkdirSync(DOWNLOAD_DIR,{recursive:true})
          const d = path.join(DOWNLOAD_DIR,`AKAD_INADIMPLENTES_${new Date().toISOString().substring(0,10).replace(/-/g,'_')}.csv`)
          await dl.saveAs(d); csvPath=d
        }
      } catch { log.warn('Exportação AKAD falhou.') }

      if (!csvPath && parcelas.length>0) {
        const dest = path.join(DOWNLOAD_DIR,`AKAD_INADIMPLENTES_${new Date().toISOString().substring(0,10).replace(/-/g,'_')}.csv`)
        fs.mkdirSync(DOWNLOAD_DIR,{recursive:true})
        fs.writeFileSync(dest, ['segurado;cnpj;apolice;endosso;ramo;valor;vencimento;status', ...parcelas.map(p=>[p.segurado,p.cnpj,p.apolice,p.endosso,p.ramo,p.valor,p.vencimento,p.status].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(';'))].join('\n'))
        csvPath = dest
      }
      atualizar(jobId, { progresso:4 })

      const resultados = parcelas.length===0
        ? [{ nome:'Nenhuma parcela em aberto encontrada', status:'OK', label:null, orientacao:null, erro:null, tipo:null }]
        : parcelas.map(p=>({ nome:p.segurado, sub:`${p.ramo||'Transportes'} · Apólice ${p.apolice} | R$ ${p.valor} | Venc: ${p.vencimento}`, status:'OK', label:null, orientacao:null, erro:null, tipo:null }))

      atualizar(jobId, { status:'concluido', progresso:5, resultados })
      await db.jobConcluido(jobId, 'akad', { resultados, csvPath: csvPath || null }, _inicio)

      const hoje = new Date().toLocaleDateString('pt-BR')
      const total = parcelas.reduce((a,p)=>a+(parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.'))||0),0)
      await email.enviar({
        assunto: parcelas.length===0 ? `AKAD — Sem inadimplentes em ${hoje}` : `AKAD — Parcelas em Aberto — ${parcelas.length} parcela(s) — ${hoje}`,
        corpo: parcelas.length===0
          ? `Prezado Adriano,\n\nNenhuma parcela em aberto encontrada na AKAD em ${hoje}.\n\nAtenciosamente,\nSistema Ferramentas Jacometo`
          : `RELATÓRIO DE PARCELAS EM ABERTO - AKAD Digital\nData: ${hoje}\nJob: ${jobId}\n\nTotal: ${parcelas.length} parcela(s)\nValor total: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\n${parcelas.map((p,i)=>`${i+1}. ${p.segurado}\n   Apólice ${p.apolice} | ${p.ramo||'Transportes'} | R$ ${p.valor} | Venc: ${p.vencimento}`).join('\n\n')}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`,
        anexo: csvPath||undefined,
      })
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const s = await ss(page,`erro_akad_${Date.now()}.png`)
      const cl = classErr(e.message)
      atualizar(jobId, { status:'erro_critico', erro:e.message, resultados:[{ nome:'AKAD — Extração falhou', sub:cl.label, status:'FALHA', label:cl.label, orientacao:cl.orientacao, erro:e.message, tipo:cl.tipo, screenshotPath:s }] })
      await db.jobErro(jobId, 'akad', e.message, _inicio)
      await email.enviar({ assunto:'❌ AKAD inadimplentes — Erro', corpo:`Job: ${jobId}\nErro: ${e.message}\nAção: ${cl.orientacao}` })
    } finally { await fecharBrowser(browser) }
  })
}
