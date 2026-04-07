// src/jobs/unimed-seguros-inadimplentes.js
// Login portal.segurosunimed.com.br (SSO) → verifica 3 categorias:
// Vida → Relatórios → Relatório de Inadimplência
// Ramos Elementares → Relatórios → Relatório de Inadimplência
// Previdência → Relatórios → Relatório de Inadimplência
require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_unimed_seguros = getCred('unimed_seguros')
let LOGIN_CPF = _cred_unimed_seguros.cpf || ''
let LOGIN_SENHA = _cred_unimed_seguros.senha || ''
let PORTAL_URL = getCred('unimed_seguros').url || ''

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const log    = require('../lib/logger')
const email  = require('../lib/email')
const { abrirBrowser, fecharBrowser } = require('../lib/browser')

const JOBS = new Map()
function criarJob() {
  const id = crypto.randomUUID()
  // total = login (1) + 3 categorias (3) + email (1) = 5
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




const CATEGORIAS   = ['Vida', 'Ramos Elementares', 'Previdência']
const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

async function ss(page, nome) {
  try { fs.mkdirSync(SCREENSHOTS,{recursive:true}); const p=path.join(SCREENSHOTS,nome); await page.screenshot({path:p}); return p } catch { return null }
}

function classErr(msg) {
  if (!msg) return { tipo:'DESCONHECIDO', label:'Erro desconhecido', orientacao:'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN')||u.includes('CPF')||u.includes('SSO')||u.includes('CREDENCIAL'))
    return { tipo:'LOGIN_FALHOU', label:'Login falhou no portal Unimed Seguros', orientacao:'Verifique CPF e senha. Login é via SSO em rh-sso.segurosunimed.com.br.' }
  if (u.includes('SESSAO')||u.includes('SESSÃO')||u.includes('EXPIROU'))
    return { tipo:'SESSAO_EXPIRADA', label:'Sessão expirou durante extração', orientacao:'Portal Unimed tem sessões curtas. Tente novamente.' }
  if (u.includes('VIDA')||u.includes('RAMOS')||u.includes('PREVIDENCIA')||u.includes('CATEGORIA'))
    return { tipo:'NAVEGACAO', label:'Erro ao navegar nas categorias', orientacao:'Verifique o acesso ao segmento no portal.segurosunimed.com.br.' }
  if (u.includes('TIMEOUT')||u.includes('EXCEEDED'))
    return { tipo:'TIMEOUT', label:'Portal Unimed Seguros demorou para responder', orientacao:'Instabilidade no portal. Tente novamente.' }
  return { tipo:'OUTRO', label:msg.substring(0,80), orientacao:'Verifique o log e tente novamente.' }
}

// ── Login via SSO ─────────────────────────────────────────────────────────────

async function fazerLogin(page) {
  log.info('Acessando Unimed Seguros (SSO)...')
  await page.goto(PORTAL_URL, { waitUntil:'networkidle', timeout:45000 })
  await page.waitForTimeout(3000)

  // Seleciona tipo "Corretor" se aparecer tela de seleção
  const btnCorretor = page.locator('button:has-text("Corretor"), a:has-text("Corretor"), [class*="corretor"]').first()
  if (await btnCorretor.count()>0) {
    await btnCorretor.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  }

  // CPF
  const campoCPF = page.locator('input[name*="cpf"], input[id*="cpf"], input[placeholder*="CPF"], input[type="text"]').first()
  await campoCPF.waitFor({ timeout:15000 })
  await campoCPF.fill(LOGIN_CPF)

  // Senha
  await page.locator('input[type="password"]').first().fill(LOGIN_SENHA)

  // Entrar
  await page.locator('button:has-text("Entrar"), button[type="submit"], input[type="submit"]').first().click()
  await page.waitForLoadState('networkidle', { timeout:30000 })
  await page.waitForTimeout(3000)

  // Seleciona corretora JACOMETO se aparecer lista
  const jacometo = page.locator('a:has-text("JACOMETO"), tr:has-text("15191") a, td:has-text("JACOMETO") ~ td a').first()
  if (await jacometo.count()>0) {
    await jacometo.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  }

  // Verifica erro de login
  const erroEl = page.locator('.alert-danger, .error, [class*="error-message"]')
  if (await erroEl.count()>0) {
    const msg = await erroEl.first().textContent().catch(()=>'')
    throw new Error(`LOGIN_FALHOU: ${msg?.trim()||'Credenciais inválidas'}`)
  }

  log.ok('Login Unimed Seguros realizado.')
}

// ── Extrai uma categoria ──────────────────────────────────────────────────────

async function extrairCategoria(page, categoria) {
  log.info(`Extraindo categoria: ${categoria}...`)
  const parcelas = []

  try {
    // Volta ao painel principal
    const btnHome = page.locator('a:has-text("Início"), a:has-text("Home"), a[href="/"], a[href*="home"], a[href*="painel"]').first()
    if (await btnHome.count()>0) { await btnHome.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(2000) }

    // Clica no card da categoria
    const seletores = {
      'Vida': '.card:has-text("Vida"), a:has-text("Vida"), [class*="card"]:has-text("Vida")',
      'Ramos Elementares': '.card:has-text("Ramos"), a:has-text("Ramos"), [class*="card"]:has-text("Ramos")',
      'Previdência': '.card:has-text("Previdência"), a:has-text("Previdência"), [class*="card"]:has-text("Previd")',
    }

    const card = page.locator(seletores[categoria]).first()
    if (await card.count()===0) {
      log.warn(`Card "${categoria}" não encontrado — pulando.`)
      return []
    }
    await card.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Relatórios → Relatório de Inadimplência
    await page.locator('a:has-text("Relatórios"), span:has-text("Relatórios")').first().click()
    await page.waitForTimeout(1500)
    await page.locator('a:has-text("Relatório de Inadimplência"), a:has-text("Inadimplência"), a:has-text("Inadimplencia")').first().click()
    await page.waitForLoadState('networkidle', { timeout:30000 })
    await page.waitForTimeout(3000)

    // Filtro de período: 01/01/ano_corrente até hoje
    const hoje = new Date()
    const ini  = `01/01/${hoje.getFullYear()}`
    const fim  = `${String(hoje.getDate()).padStart(2,'0')}/${String(hoje.getMonth()+1).padStart(2,'0')}/${hoje.getFullYear()}`

    const fIni = page.locator('input[name*="inicio"], input[name*="dataini"], input[placeholder*="nicio"]').first()
    const fFim = page.locator('input[name*="fim"], input[name*="datafim"], input[placeholder*="im"]').first()
    if (await fIni.count()>0) await fIni.fill(ini)
    if (await fFim.count()>0) await fFim.fill(fim)

    // Gera/busca relatório
    const btnGerar = page.locator('button:has-text("Gerar"), button:has-text("Buscar"), button:has-text("Pesquisar"), button[type="submit"]').first()
    if (await btnGerar.count()>0) {
      await btnGerar.click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)
    }

    // Extrai tabela — paginação
    let pagina = 1
    while (true) {
      const linhas = await page.locator('table tbody tr, [class*="row"]:not([class*="header"])').all()
      for (const linha of linhas) {
        const cols = await linha.locator('td').all()
        if (cols.length<4) continue
        const v = await Promise.all(cols.map((c)=>c.textContent().then((t)=>t?.trim()||'')))
        // Colunas: Produto | Apólice | Cliente | CPF/CNPJ | Parcela | Valor | Vencimento | Status | Forma Pgto
        if (v[0]&&v[1]) parcelas.push({
          categoria,
          produto:      v[0]||'', apolice:v[1]||'', cliente:v[2]||'', cpf_cnpj:v[3]||'',
          parcela:      v[4]||'', valor:v[5]||'',   vencimento:v[6]||'', status:v[7]||'',
          forma_pgto:   v[8]||'',
        })
      }
      const next = page.locator('a:has-text("Próxima"), [aria-label="Next"], .pagination-next').first()
      if (await next.count()===0||!await next.isEnabled().catch(()=>false)) break
      await next.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(2000)
      if (++pagina>50) break
    }

    log.ok(`${categoria}: ${parcelas.length} registro(s).`)
  } catch (e) {
    log.warn(`Erro ao extrair ${categoria}: ${e.message}`)
  }

  return parcelas
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function gerarCSV(parcelas) {
  if (!parcelas.length) return null
  fs.mkdirSync(DOWNLOAD_DIR, {recursive:true})
  const dest = path.join(DOWNLOAD_DIR, `UNIMED_SEGUROS_INADIMPLENTES_${new Date().toISOString().substring(0,10).replace(/-/g,'_')}.csv`)
  const cab = 'categoria;produto;apolice;cliente;cpf_cnpj;parcela;valor;vencimento;status;forma_pgto'
  const linhas = parcelas.map(p=>[p.categoria,p.produto,p.apolice,p.cliente,p.cpf_cnpj,p.parcela,p.valor,p.vencimento,p.status,p.forma_pgto].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(';'))
  fs.writeFileSync(dest,[cab,...linhas].join('\n'))
  log.ok(`CSV: ${dest}`)
  return dest
}

// ── Handler principal ─────────────────────────────────────────────────────────

module.exports = async function routeUnimedSegurosInadimplentes(req, res) {
  const corretora = req.body?.corretora || 'jacometo'
  const credKey = corretora === 'giacomet' ? 'giacomet_unimed' : 'unimed_seguros'
  const nomeCorretora = corretora === 'giacomet' ? 'GIACOMET' : 'JACOMETO'

  const jobId = criarJob()
  log.info(`Job Unimed Seguros inadimplentes [${nomeCorretora}] — ${jobId}`)
  res.json({ ok:true, jobId, mensagem:'Iniciando extração de inadimplentes da Unimed Seguros (Vida, Ramos Elementares, Previdência).' })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, credKey)
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred(credKey)
    LOGIN_CPF  = _creds.cpf || LOGIN_CPF
    PORTAL_URL = _creds.url || PORTAL_URL
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()
    try {
      atualizar(jobId, { progresso:0 })
      await fazerLogin(page)
      atualizar(jobId, { progresso:1 })

      const todasParcelas = []
      const resultadosCat = []

      for (let i=0; i<CATEGORIAS.length; i++) {
        const cat = CATEGORIAS[i]
        const parcelas = await extrairCategoria(page, cat)
        todasParcelas.push(...parcelas)
        resultadosCat.push({
          nome: `${cat} — ${parcelas.length} registro(s)`,
          sub: parcelas.length > 0
            ? parcelas.slice(0,3).map(p=>`${p.cliente} | R$ ${p.valor} | Venc: ${p.vencimento}`).join(' · ')
            : 'Nenhuma inadimplência encontrada',
          status: 'OK',
          label: null, orientacao: null, erro: null, tipo: null,
        })
        atualizar(jobId, { progresso: i+2, resultados: [...resultadosCat] })
      }

      const csvPath = gerarCSV(todasParcelas)
      atualizar(jobId, { progresso:5 })

      // Email
      const hoje = new Date().toLocaleDateString('pt-BR')
      const total = todasParcelas.reduce((a,p)=>a+(parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.'))||0),0)
      const catComDados = CATEGORIAS.filter(c=>todasParcelas.some(p=>p.categoria===c))

      const porCategoria = CATEGORIAS.map(cat=>{
        const ps = todasParcelas.filter(p=>p.categoria===cat)
        if (!ps.length) return `\n${cat}:\n  Nenhuma inadimplência encontrada.`
        const tot = ps.reduce((a,p)=>a+(parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.'))||0),0)
        return `\n${cat} (${ps.length} parcela(s) — R$ ${tot.toLocaleString('pt-BR',{minimumFractionDigits:2})}):\n${ps.map(p=>`  ${p.cliente} (${p.cpf_cnpj})\n  ${p.produto} | Apólice: ${p.apolice}\n  Parcela ${p.parcela} - R$ ${p.valor} - Venc: ${p.vencimento} - ${p.forma_pgto}`).join('\n\n')}`
      }).join('\n')

      await email.enviar({
        assunto: todasParcelas.length===0
          ? `Unimed Seguros — Sem inadimplentes em ${hoje}`
          : `Unimed Seguros — Inadimplentes — ${todasParcelas.length} parcela(s) — ${hoje}`,
        corpo: `RELATÓRIO DE INADIMPLENTES - UNIMED SEGUROS\nData: ${hoje}\nCorretor: JACOMETO CORRETORA DE SEGUROS LTDA\nJob: ${jobId}\n\nResumo:\n- Total: ${todasParcelas.length} parcela(s)\n- Valor total: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n- Categorias verificadas: ${CATEGORIAS.join(', ')}\n- Com inadimplências: ${catComDados.join(', ')||'Nenhuma'}${porCategoria}\n\n${csvPath?'CSV em anexo.':''}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`,
        anexo: csvPath||undefined,
      })

      atualizar(jobId, { status:'concluido' })
      await db.jobConcluido(jobId, 'unimed_seguros', { resultados, csvPath: csvPath || null }, _inicio)
      log.ok(`Job ${jobId} concluído: ${todasParcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const s = await ss(page,`erro_unimed_seg_${Date.now()}.png`)
      const cl = classErr(e.message)
      atualizar(jobId, { status:'erro_critico', erro:e.message, resultados:[{ nome:'Unimed Seguros — Extração falhou', sub:cl.label, status:'FALHA', label:cl.label, orientacao:cl.orientacao, erro:e.message, tipo:cl.tipo, screenshotPath:s }] })
      await db.jobErro(jobId, 'unimed_seguros', e.message, _inicio)
      await email.enviar({ assunto:'❌ Unimed Seguros inadimplentes — Erro', corpo:`Job: ${jobId}\nErro: ${e.message}\nAção: ${cl.orientacao}` })
    } finally { await fecharBrowser(browser) }
  })
}
module.exports.getJobStatus = getJobStatus
