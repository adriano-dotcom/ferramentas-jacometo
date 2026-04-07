// src/jobs/essor-inadimplentes.js
// Login portal.essor.com.br → Consultas → Parcelas Pendentes
require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_essor = getCred('essor')
let LOGIN_CNPJ = _cred_essor.cnpj || ''
let LOGIN_SENHA = _cred_essor.senha || ''
let PORTAL_URL = getCred('essor').url || ''

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
  if (u.includes('LOGIN')||u.includes('CNPJ')||u.includes('SENHA')) return { tipo:'LOGIN_FALHOU', label:'Login falhou no portal Essor', orientacao:'Verifique CNPJ e senha em portal.essor.com.br.' }
  if (u.includes('CONSULTA')||u.includes('PARCELA')||u.includes('MENU')) return { tipo:'NAVEGACAO', label:'Erro ao navegar no portal Essor', orientacao:'Caminho: Consultas → Parcelas Pendentes.' }
  if (u.includes('TIMEOUT')||u.includes('EXCEEDED')) return { tipo:'TIMEOUT', label:'Portal Essor demorou para responder', orientacao:'Instabilidade. Tente novamente.' }
  return { tipo:'OUTRO', label:msg.substring(0,80), orientacao:'Verifique o log e tente novamente.' }
}

module.exports = async function routeEssorInadimplentes(req, res) {
  const jobId = criarJob()
  log.info(`Job Essor inadimplentes — ${jobId}`)
  res.json({ ok:true, jobId, mensagem:'Iniciando extração de inadimplentes da Essor.' })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, 'essor')
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred('essor')
    PORTAL_URL = _creds.url || PORTAL_URL
    LOGIN_CNPJ = _creds.cnpj || LOGIN_CNPJ
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()
    try {
      // 1. Login com CNPJ
      log.info('Acessando portal Essor...')
      await page.goto(PORTAL_URL, { waitUntil:'networkidle', timeout:45000 })
      await page.waitForTimeout(2000)
      await page.locator('input[name*="cnpj"], input[name*="user"], input[placeholder*="CNPJ"], input[type="text"]').first().fill(LOGIN_CNPJ)
      await page.locator('input[type="password"]').first().fill(LOGIN_SENHA)
      await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login"), input[type="submit"]').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso:1 })

      // 2. Consultas → Parcelas Pendentes
      log.info('Navegando para Parcelas Pendentes...')
      await page.locator('a:has-text("Consultas"), li:has-text("Consultas") > a').first().click()
      await page.waitForTimeout(1500)
      await page.locator('a:has-text("Parcelas Pendentes"), a:has-text("Inadimplentes"), a:has-text("Pendentes")').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso:2 })

      // 3. Pesquisa (sem filtros ou com filtro amplo)
      const btnBuscar = page.locator('button:has-text("Pesquisar"), button:has-text("Buscar"), button[type="submit"]').first()
      if (await btnBuscar.count()>0) {
        await btnBuscar.click()
        await page.waitForLoadState('networkidle', { timeout:30000 })
        await page.waitForTimeout(3000)
      }
      atualizar(jobId, { progresso:3 })

      // 4. Extrai dados
      // Colunas Essor: Segurado | Apólice | Endosso | Parcela | Valor | Vencimento | Dias em Atraso
      const parcelas = []
      let pagina = 1
      while (true) {
        const linhas = await page.locator('table tbody tr, [class*="row"]:not([class*="header"])').all()
        for (const linha of linhas) {
          const cols = await linha.locator('td').all()
          if (cols.length<5) continue
          const v = await Promise.all(cols.map(c=>c.textContent().then(t=>t?.trim()||'')))
          if (v[0]&&v[1]) parcelas.push({ segurado:v[0], apolice:v[1]||'', endosso:v[2]||'', parcela:v[3]||'', valor:v[4]||'', vencimento:v[5]||'', dias_atraso:v[6]||'' })
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
        const dest = path.join(DOWNLOAD_DIR,`ESSOR_INADIMPLENTES_${new Date().toISOString().substring(0,10).replace(/-/g,'_')}.csv`)
        fs.writeFileSync(dest, ['segurado;apolice;endosso;parcela;valor;vencimento;dias_atraso', ...parcelas.map(p=>[p.segurado,p.apolice,p.endosso,p.parcela,p.valor,p.vencimento,p.dias_atraso].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(';'))].join('\n'))
        csvPath = dest
      }
      atualizar(jobId, { progresso:4 })

      const resultados = parcelas.length===0
        ? [{ nome:'Nenhuma parcela pendente encontrada', status:'OK', label:null, orientacao:null, erro:null, tipo:null }]
        : parcelas.map(p=>({ nome:p.segurado, sub:`Apólice ${p.apolice} | End ${p.endosso} | Parcela ${p.parcela} | R$ ${p.valor} | Venc: ${p.vencimento}${p.dias_atraso?` | ${p.dias_atraso} dias em atraso`:''}`, status:'OK', label:null, orientacao:null, erro:null, tipo:null }))

      atualizar(jobId, { status:'concluido', progresso:5, resultados })
      await db.jobConcluido(jobId, 'essor', { resultados, csvPath: csvPath || null }, _inicio)

      const hoje = new Date().toLocaleDateString('pt-BR')
      const total = parcelas.reduce((a,p)=>a+(parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.'))||0),0)
      await email.enviar({
        assunto: parcelas.length===0 ? `Essor — Sem inadimplentes em ${hoje}` : `Essor — Parcelas Pendentes — ${parcelas.length} parcela(s) — ${hoje}`,
        corpo: `RELATÓRIO DE PARCELAS PENDENTES - ESSOR\nData: ${hoje}\nJob: ${jobId}\n\nTotal: ${parcelas.length} parcela(s)\nValor total: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\n${parcelas.map((p,i)=>`${i+1}. ${p.segurado}\n   Apólice ${p.apolice} | End ${p.endosso} | Parcela ${p.parcela}\n   R$ ${p.valor} | Venc: ${p.vencimento}${p.dias_atraso?` | ${p.dias_atraso} dias em atraso`:''}`).join('\n\n')}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`,
        anexo: csvPath||undefined,
      })
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const s = await ss(page,`erro_essor_${Date.now()}.png`)
      const cl = classErr(e.message)
      atualizar(jobId, { status:'erro_critico', erro:e.message, resultados:[{ nome:'Essor — Extração falhou', sub:cl.label, status:'FALHA', label:cl.label, orientacao:cl.orientacao, erro:e.message, tipo:cl.tipo, screenshotPath:s }] })
      await db.jobErro(jobId, 'essor', e.message, _inicio)
      await email.enviar({ assunto:'❌ Essor inadimplentes — Erro', corpo:`Job: ${jobId}\nErro: ${e.message}\nAção: ${cl.orientacao}` })
    } finally { await fecharBrowser(browser) }
  })
}
module.exports.getJobStatus = getJobStatus
