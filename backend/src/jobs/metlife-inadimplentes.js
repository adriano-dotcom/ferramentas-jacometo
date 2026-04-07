// src/jobs/metlife-inadimplentes.js
// Login login.metlife.com.br → Cobrança → Clientes inadimplentes (vencidas > 7 dias)
require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_metlife = getCred('metlife')
let LOGIN_USER = _cred_metlife.usuario || ''
let LOGIN_SENHA = _cred_metlife.senha || ''
let LOGIN_URL = getCred('metlife').url || ''

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
function getJobStatus(req, res) {
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
  if (u.includes('LOGIN')||u.includes('USUARIO')||u.includes('SENHA')) return { tipo:'LOGIN_FALHOU', label:'Login falhou no portal MetLife', orientacao:'Verifique usuário e senha em login.metlife.com.br.' }
  if (u.includes('COBRANCA')||u.includes('INADIMPLENTE')||u.includes('MENU')) return { tipo:'NAVEGACAO', label:'Erro ao navegar no portal MetLife', orientacao:'Caminho: Cobrança → Clientes inadimplentes.' }
  if (u.includes('TIMEOUT')||u.includes('EXCEEDED')) return { tipo:'TIMEOUT', label:'Portal MetLife demorou para responder', orientacao:'Instabilidade. Tente novamente.' }
  return { tipo:'OUTRO', label:msg.substring(0,80), orientacao:'Verifique o log e tente novamente.' }
}

module.exports = async function routeMetlifeInadimplentes(req, res) {
  const corretora = req.body?.corretora || 'jacometo'
  const credKey = corretora === 'giacomet' ? 'giacomet_metlife' : 'metlife'
  const nomeCorretora = corretora === 'giacomet' ? 'GIACOMET' : 'JACOMETO'

  const jobId = criarJob()
  log.info(`Job MetLife inadimplentes [${nomeCorretora}] — ${jobId}`)
  res.json({ ok:true, jobId, mensagem:'Iniciando extração de inadimplentes da MetLife.' })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, credKey)
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred(credKey)
    LOGIN_URL = _creds.url || LOGIN_URL
    LOGIN_USER = _creds.usuario || LOGIN_USER
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()
    try {
      // 1. Login
      log.info('Acessando MetLife...')
      await page.goto(LOGIN_URL, { waitUntil:'networkidle', timeout:45000 })
      await page.waitForTimeout(2500)
      await page.locator('input[name*="user"], input[name*="login"], input[id*="user"], input[type="text"]').first().fill(LOGIN_USER)
      await page.locator('input[type="password"]').first().fill(LOGIN_SENHA)
      await page.locator('button[type="submit"], input[type="submit"], button:has-text("Entrar"), button:has-text("Login")').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso:1 })

      // 2. Cobrança → Clientes inadimplentes
      log.info('Navegando para Clientes Inadimplentes...')
      await page.locator('a:has-text("Cobrança"), a:has-text("Cobranças"), li:has-text("Cobrança") > a').first().click()
      await page.waitForTimeout(1500)
      await page.locator('a:has-text("Clientes inadimplentes"), a:has-text("Inadimplentes"), a:has-text("Clientes Inadimplentes")').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso:2 })

      // 3. Filtro: parcelas vencidas acima de 7 dias
      log.info('Aplicando filtro: vencidas > 7 dias...')
      const selFiltro = page.locator('select[name*="filtro"], select[name*="dias"], select[id*="vencid"]').first()
      if (await selFiltro.count()>0) await selFiltro.selectOption({ label:/7/i }).catch(()=>{})

      const btnBuscar = page.locator('button:has-text("Pesquisar"), button:has-text("Buscar"), button[type="submit"]').first()
      if (await btnBuscar.count()>0) {
        await btnBuscar.click()
        await page.waitForLoadState('networkidle', { timeout:30000 })
        await page.waitForTimeout(3000)
      }
      atualizar(jobId, { progresso:3 })

      // 4. Extrai dados
      const parcelas = []
      let pagina = 1
      while (true) {
        const linhas = await page.locator('table tbody tr, [class*="row"]:not([class*="header"])').all()
        for (const linha of linhas) {
          const cols = await linha.locator('td').all()
          if (cols.length<4) continue
          const v = await Promise.all(cols.map(c=>c.textContent().then(t=>t?.trim()||'')))
          if (v[0]&&v[1]) parcelas.push({ segurado:v[0], cpf_cnpj:v[1]||'', produto:v[2]||'', apolice:v[3]||'', parcela:v[4]||'', valor:v[5]||'', vencimento:v[6]||'', status:v[7]||'Inadimplente' })
        }
        const next = page.locator('a:has-text("Próxima"), [aria-label="Next"], .pagination-next').first()
        if (await next.count()===0||!await next.isEnabled().catch(()=>false)) break
        await next.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(2000)
        if (++pagina>50) break
      }
      log.ok(`${parcelas.length} parcela(s) extraída(s).`)

      let csvPath = null
      if (parcelas.length>0) {
        fs.mkdirSync(DOWNLOAD_DIR,{recursive:true})
        const dest = path.join(DOWNLOAD_DIR,`METLIFE_INADIMPLENTES_${new Date().toISOString().substring(0,10).replace(/-/g,'_')}.csv`)
        fs.writeFileSync(dest, ['segurado;cpf_cnpj;produto;apolice;parcela;valor;vencimento;status', ...parcelas.map(p=>[p.segurado,p.cpf_cnpj,p.produto,p.apolice,p.parcela,p.valor,p.vencimento,p.status].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(';'))].join('\n'))
        csvPath = dest
      }
      atualizar(jobId, { progresso:4 })

      const resultados = parcelas.length===0
        ? [{ nome:'Nenhum cliente inadimplente encontrado', sub:'Filtro: vencidas acima de 7 dias', status:'OK', label:null, orientacao:null, erro:null, tipo:null }]
        : parcelas.map(p=>({ nome:p.segurado, sub:`${p.produto} · Apólice ${p.apolice} | Parcela ${p.parcela} | R$ ${p.valor} | Venc: ${p.vencimento}`, status:'OK', label:null, orientacao:null, erro:null, tipo:null }))

      atualizar(jobId, { status:'concluido', progresso:5, resultados })
      await db.jobConcluido(jobId, 'metlife', { resultados, csvPath: csvPath || null }, _inicio)

      const hoje = new Date().toLocaleDateString('pt-BR')
      const total = parcelas.reduce((a,p)=>a+(parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.'))||0),0)
      await email.enviar({
        assunto: parcelas.length===0 ? `MetLife — Sem inadimplentes em ${hoje}` : `MetLife — Clientes Inadimplentes — ${parcelas.length} parcela(s) — ${hoje}`,
        corpo: `RELATÓRIO DE CLIENTES INADIMPLENTES - METLIFE\nData: ${hoje}\nFiltro: Parcelas vencidas acima de 7 dias\nJob: ${jobId}\n\nTotal: ${parcelas.length} parcela(s)\nValor total: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\n${parcelas.map((p,i)=>`${i+1}. ${p.segurado} (${p.cpf_cnpj})\n   ${p.produto} | Apólice ${p.apolice} | Parcela ${p.parcela}\n   R$ ${p.valor} | Venc: ${p.vencimento}`).join('\n\n')}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`,
        anexo: csvPath||undefined,
      })
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const s = await ss(page,`erro_metlife_${Date.now()}.png`)
      const cl = classErr(e.message)
      atualizar(jobId, { status:'erro_critico', erro:e.message, resultados:[{ nome:'MetLife — Extração falhou', sub:cl.label, status:'FALHA', label:cl.label, orientacao:cl.orientacao, erro:e.message, tipo:cl.tipo, screenshotPath:s }] })
      await db.jobErro(jobId, 'metlife', e.message, _inicio)
      await email.enviar({ assunto:'❌ MetLife inadimplentes — Erro', corpo:`Job: ${jobId}\nErro: ${e.message}\nAção: ${cl.orientacao}` })
    } finally { await fecharBrowser(browser) }
  })
}
module.exports.getJobStatus = getJobStatus
