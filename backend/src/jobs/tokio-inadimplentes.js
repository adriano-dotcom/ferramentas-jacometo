// src/jobs/tokio-inadimplentes.js
// Login Tokio Marine SSO → FINANCEIRO → Relatórios Clientes → Clientes Inadimplentes
// Extrai tabela (todas páginas) → CSV → email
// URL SSO: https://ssoportais3.tokiomarine.com.br/openam/XUI/?realm=TOKIOLFR

require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_tokio = getCred('tokio')
let LOGIN_CPF = _cred_tokio.cpf || ''
let LOGIN_SENHA = _cred_tokio.senha || ''
let LOGIN_URL = getCred('tokio').url || ''

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const log    = require('../lib/logger')
const email  = require('../lib/email')
const { abrirBrowser, fecharBrowser } = require('../lib/browser')

// ── Store de jobs ─────────────────────────────────────────────────────────────

const JOBS = new Map()

function criarJob() {
  const id = crypto.randomUUID()
  JOBS.set(id, { id, status: 'executando', progresso: 0, total: 5, resultados: [], erro: null, criadoEm: Date.now() })
  for (const [k, v] of JOBS) { if (Date.now() - v.criadoEm > 7200000) JOBS.delete(k) }
  return id
}

function atualizar(id, dados) {
  const job = JOBS.get(id)
  if (job) JOBS.set(id, { ...job, ...dados })
}

function getJobStatus(req, res) {
  const job = JOBS.get(req.params.jobId)
  if (!job) return res.status(404).json({ erro: 'Job não encontrado.' })
  res.json(job)
}

// ── Constantes ────────────────────────────────────────────────────────────────


const PORTAL_URL   = 'http://portalparceiros.tokiomarine.com.br/group/portal-corretor'


const COD_CORRETOR = '842244'
const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

const RAMOS = {
  '540': 'RC Transportes (540)',
  '550': 'Carga/Transportes (550)',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function screenshot(page, nome) {
  try {
    fs.mkdirSync(SCREENSHOTS, { recursive: true })
    const p = path.join(SCREENSHOTS, nome)
    await page.screenshot({ path: p, fullPage: false })
    return p
  } catch { return null }
}

function nomRamo(codigo) {
  return RAMOS[codigo] || `Ramo ${codigo}`
}

function classificarErro(msg) {
  if (!msg) return { tipo: 'DESCONHECIDO', label: 'Erro desconhecido', orientacao: 'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('AUTHENTICATION') || u.includes('FAILED') || u.includes('LOGIN') || u.includes('SENHA') || u.includes('CPF'))
    return { tipo: 'LOGIN_FALHOU',  label: 'Falha de autenticação no portal Tokio', orientacao: 'Verifique CPF e senha em portalparceiros.tokiomarine.com.br. O UserName é o CPF (11 dígitos).' }
  if (u.includes('FINANCEIRO') || u.includes('MENU') || u.includes('INADIMPLENTE') || u.includes('RELATORIO'))
    return { tipo: 'NAVEGACAO',     label: 'Erro ao navegar nos menus',             orientacao: 'Layout do portal pode ter mudado. Verifique manualmente.' }
  if (u.includes('TIMEOUT') || u.includes('EXCEEDED') || u.includes('OPENAM') || u.includes('FORGEROCK'))
    return { tipo: 'TIMEOUT',       label: 'Portal Tokio demorou para responder',   orientacao: 'O portal usa ForgeRock SSO e pode ser lento. Aguarde e tente novamente.' }
  if (u.includes('PAGINA') || u.includes('PAGINAÇÃO'))
    return { tipo: 'PAGINACAO',     label: 'Erro na paginação',                     orientacao: 'Alguns registros podem não ter sido capturados. Verifique manualmente.' }
  return { tipo: 'OUTRO',           label: msg.substring(0, 80),                     orientacao: 'Verifique o log e tente novamente.' }
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function fazerLogin(page) {
  log.info('Acessando portal Tokio Marine (ForgeRock SSO)...')
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(5000) // SSO pode ser lento

  // Campo UserName
  const campoUser = page.locator('input[name="IDToken1"], input[id="IDToken1"], input[placeholder*="UserName"], input[placeholder*="usuário"], input[type="text"]').first()
  await campoUser.waitFor({ timeout: 20000 })
  await campoUser.fill(LOGIN_CPF)
  log.info('CPF preenchido.')

  // Campo Password
  const campoSenha = page.locator('input[name="IDToken2"], input[id="IDToken2"], input[type="password"]').first()
  await campoSenha.fill(LOGIN_SENHA)

  // Botão ENTRAR (texto pode ser "ENTRAR", "Entrar", "LOG IN")
  await page.locator('button:has-text("ENTRAR"), button:has-text("Entrar"), button:has-text("LOG IN"), input[type="submit"], button[type="submit"]').first().click()
  await page.waitForLoadState('networkidle', { timeout: 45000 })
  await page.waitForTimeout(5000) // Redirect pós-SSO demora

  // Verifica falha de login
  const erroEl = page.locator('.alert-danger, .error, .fr-alert, [class*="error"]')
  if (await erroEl.count() > 0) {
    const msg = await erroEl.first().textContent().catch(() => '')
    if (msg?.toLowerCase().includes('authentication') || msg?.toLowerCase().includes('falhou') || msg?.toLowerCase().includes('inválid')) {
      throw new Error(`AUTHENTICATION_FAILED: ${msg?.trim()}`)
    }
  }

  // Fecha banner de cookies se aparecer
  const btnCookie = page.locator('text=ENTENDI, button:has-text("ENTENDI"), a:has-text("ENTENDI")').first()
  if (await btnCookie.count() > 0) {
    await btnCookie.click().catch(() => {})
    await page.waitForTimeout(2000)
    log.info('Banner de cookies fechado.')
  }

  // Tela intermediária: "Acesse os Portais" — clica no card "Corretor"
  const temCorretor = await page.locator('text=Corretor').count()
  if (temCorretor > 0) {
    log.info('Tela de seleção de portal — clicando em "Corretor"...')

    // Pode abrir nova aba — espera popup
    const popupPromise = page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null)

    // Clica no card com Playwright locator (force click para garantir)
    await page.locator(':text-is("Corretor")').first().click({ force: true })
    await page.waitForTimeout(5000)

    // Verifica se abriu nova aba
    const popup = await popupPromise
    if (popup) {
      log.info(`  Corretor abriu nova aba: ${popup.url().substring(0, 80)}`)
      await popup.waitForLoadState('networkidle', { timeout: 30000 })
      await popup.waitForTimeout(5000)
      // Usa a nova aba como página principal para o resto do fluxo
      // Retorna a popup para ser usada
      return popup
    }

    // Se não abriu nova aba, navega direto para o portal do corretor
    const urlAtual = page.url()
    log.info(`  URL após clique Corretor: ${urlAtual}`)
    if (urlAtual.includes('Acesse') || urlAtual.includes('portais') || !urlAtual.includes('portal')) {
      // Tenta navegar direto para o portal do corretor
      log.info('  Clique não navegou, tentando URL direta...')
      await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(5000)
    }
  }

  // Verifica se chegou no portal do corretor
  if (!page.url().includes('portalparceiros') && !page.url().includes('portal-corretor')) {
    await page.waitForURL('**/portal**', { timeout: 15000 }).catch(() => {})
  }

  log.ok(`Login Tokio Marine realizado. URL: ${page.url()}`)
}

// ── Navegação ─────────────────────────────────────────────────────────────────

async function navegarParaInadimplentes(page) {
  log.info('Navegando: FINANCEIRO → Relatórios Clientes → Clientes Inadimplentes')

  // FINANCEIRO (menu lateral — clica para expandir)
  await page.locator('a:has-text("FINANCEIRO"), li:has-text("FINANCEIRO") > a, [data-qa*="financeiro"]').first().click()
  await page.waitForTimeout(3000)

  // Relatórios Clientes (submenu dentro do accordion FINANCEIRO)
  // O submenu pode não estar visível após o clique — usa force click
  await page.locator('a:has-text("Relatórios Clientes"), a:has-text("Relatórios de Clientes")').first().click({ force: true })
  await page.waitForTimeout(2000)

  // Clientes Inadimplentes (sub-submenu)
  await page.locator('a:has-text("Clientes inadimplentes"), a:has-text("Inadimplentes")').first().click({ force: true })
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.waitForTimeout(5000)

  log.ok('Tela de Clientes Inadimplentes carregada.')
}

// ── Extração ──────────────────────────────────────────────────────────────────

async function extrairDashboard(page) {
  // Tenta capturar o totalizador do dashboard antes de navegar
  try {
    const card = await page.locator('[class*="inadimplente"], [class*="card"]:has-text("PARCELAS INADIMPLENTES")').first().textContent().catch(() => '')
    if (card) log.info(`Dashboard — ${card.trim().substring(0, 100)}`)
  } catch { /* ignora */ }
}

async function extrairTabela(page) {
  log.info('Extraindo dados (todas as páginas)...')

  await extrairDashboard(page)

  const parcelas = []
  let pagina = 1

  while (true) {
    log.info(`Página ${pagina}...`)

    const linhas = await page.locator('table tbody tr, [class*="result"] tr:not(:first-child)').all()

    for (const linha of linhas) {
      const cols = await linha.locator('td').all()
      if (cols.length < 5) continue

      const vals = await Promise.all(cols.map(c => c.textContent().then(t => t?.trim() || '')))

      // SEGURADO | CPF/CNPJ | RAMO | APÓLICE | ENDOSSO | PARCELA | VENCIMENTO | VALOR | REPIQUE
      const p = {
        segurado:   vals[0] || '',
        cpf_cnpj:   vals[1] || '',
        ramo:       vals[2] || '',
        apolice:    vals[3] || '',
        endosso:    vals[4] || '',
        parcela:    vals[5] || '',
        vencimento: vals[6] || '',
        valor:      vals[7] || '',
        repique:    vals[8] || '',
      }

      if (p.segurado && p.apolice) parcelas.push(p)
    }

    // Próxima página
    const btnNext = page.locator('a:has-text("Próxima"), [aria-label="Next page"], .pagination li:last-child a:not(.disabled)').first()
    const temNext = await btnNext.count() > 0 && await btnNext.isEnabled().catch(() => false)
    if (!temNext) break

    await btnNext.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    pagina++

    if (pagina > 50) { log.warn('Limite de 50 páginas atingido.'); break }
  }

  log.ok(`${parcelas.length} parcela(s) extraída(s) em ${pagina} página(s).`)
  return parcelas
}

async function tentarExportar(page) {
  try {
    const btn = page.locator('button:has-text("Exportar"), a:has-text("Exportar"), a:has-text("Excel"), a:has-text("CSV"), button:has-text("Excel")').first()
    if (await btn.count() === 0) return null

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      btn.click(),
    ])
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
    const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
    const dest = path.join(DOWNLOAD_DIR, `TOKIO_MARINE_INADIMPLENTES_${hoje}_export.xlsx`)
    await download.saveAs(dest)
    log.ok(`Exportado: ${dest}`)
    return dest
  } catch (e) {
    log.warn(`Export falhou: ${e.message}`)
    return null
  }
}

function gerarCSV(parcelas) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
  const dest = path.join(DOWNLOAD_DIR, `TOKIO_MARINE_INADIMPLENTES_${hoje}.csv`)

  const cab = 'segurado;cpf_cnpj;ramo;apolice;endosso;parcela;vencimento;valor;repique'
  const linhas = parcelas.map(p =>
    [p.segurado, p.cpf_cnpj, p.ramo, p.apolice, p.endosso, p.parcela, p.vencimento, p.valor, p.repique]
      .map(v => `"${(v||'').replace(/"/g,'""')}"`)
      .join(';')
  )

  fs.writeFileSync(dest, [cab, ...linhas].join('\n'), 'utf8')
  log.ok(`CSV: ${dest}`)
  return dest
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function enviarEmail(parcelas, csvPath, jobId) {
  const hoje = new Date().toLocaleDateString('pt-BR')

  const totalValor = parcelas.reduce((a, p) => a + (parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.')) || 0), 0)
  const seguradosUnicos = new Set(parcelas.map(p => p.cpf_cnpj || p.segurado)).size

  const porRamo = parcelas.reduce((acc, p) => {
    const r = p.ramo || 'Outros'
    if (!acc[r]) acc[r] = []
    acc[r].push(p)
    return acc
  }, {})

  const resumoRamos = Object.entries(porRamo).map(([r, ps]) => {
    const tot = ps.reduce((a, p) => a + (parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.')) || 0), 0)
    return `  ${nomRamo(r)}: ${ps.length} parcela(s) — R$ ${tot.toLocaleString('pt-BR',{minimumFractionDigits:2})}`
  }).join('\n')

  const porSegurado = parcelas.reduce((acc, p) => {
    const k = `${p.segurado}__${p.cpf_cnpj}`
    if (!acc[k]) acc[k] = []
    acc[k].push(p)
    return acc
  }, {})

  const detalhes = Object.entries(porSegurado).map(([key, ps]) => {
    const [nome, doc] = key.split('__')
    const tot = ps.reduce((a, p) => a + (parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.')) || 0), 0)
    const linhas = ps.map(p =>
      `   - Apólice ${p.apolice} End ${p.endosso} | ${nomRamo(p.ramo)} | Venc: ${p.vencimento} | R$ ${p.valor}${p.repique === 'S' ? ' | REPIQUE' : ''}`
    ).join('\n')
    return `>> ${nome} (${doc})\n   Parcelas em atraso: ${ps.length} | Total: R$ ${tot.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n${linhas}`
  }).join('\n\n')

  const semResultados = parcelas.length === 0

  const corpo = semResultados
    ? `Prezado Adriano,\n\nNenhum cliente inadimplente encontrado na Tokio Marine em ${hoje}.\n\nCorretor: JACOMETO CORRETORA DE SEGUROS LTDA (Código ${COD_CORRETOR})\n\nAtenciosamente,\nSistema Ferramentas Jacometo`
    : `RELATÓRIO DE CLIENTES INADIMPLENTES - TOKIO MARINE\nData: ${hoje}\nCorretor: JACOMETO CORRETORA DE SEGUROS LTDA (Código ${COD_CORRETOR})\nJob: ${jobId}\n\n${'='.repeat(60)}\nRESUMO GERAL\n${'='.repeat(60)}\nTotal de parcelas inadimplentes: ${parcelas.length}\nTotal de segurados distintos: ${seguradosUnicos}\nValor total em atraso: R$ ${totalValor.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\nPOR RAMO:\n${resumoRamos}\n\n${'='.repeat(60)}\nDETALHAMENTO POR SEGURADO\n${'='.repeat(60)}\n\n${detalhes}\n\n${csvPath ? 'Arquivo em anexo.' : ''}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`

  await email.enviar({
    assunto: semResultados
      ? `Tokio Marine — Sem inadimplentes em ${hoje}`
      : `[Tokio Marine] Inadimplentes — ${parcelas.length} parcela(s) — ${hoje}`,
    corpo,
    anexo: csvPath || undefined,
  })
  log.ok('Email enviado.')
}

// ── Handler principal ─────────────────────────────────────────────────────────

module.exports = async function routeTokioInadimplentes(req, res) {
  const corretora = req.body?.corretora || 'jacometo'
  const credKey = corretora === 'giacomet' ? 'giacomet_tokio' : 'tokio'
  const nomeCorretora = corretora === 'giacomet' ? 'GIACOMET' : 'JACOMETO'

  const jobId = criarJob()
  log.info(`Job Tokio Marine inadimplentes [${nomeCorretora}] — ${jobId}`)
  res.json({ ok: true, jobId, mensagem: `Iniciando extração de inadimplentes da Tokio Marine (${nomeCorretora}).` })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, credKey)
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred(credKey)
    LOGIN_URL = _creds.url || LOGIN_URL
    LOGIN_CPF = _creds.cpf || LOGIN_CPF
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()
    try {
      atualizar(jobId, { progresso: 0 })
      const portalPage = await fazerLogin(page) || page
      atualizar(jobId, { progresso: 1 })

      await navegarParaInadimplentes(portalPage)
      atualizar(jobId, { progresso: 2 })

      const parcelas = await extrairTabela(portalPage)
      atualizar(jobId, { progresso: 3 })

      let csvPath = await tentarExportar(portalPage)
      if (!csvPath && parcelas.length > 0) csvPath = gerarCSV(parcelas)
      atualizar(jobId, { progresso: 4 })

      const resultados = parcelas.length === 0
        ? [{ nome: 'Nenhum cliente inadimplente encontrado', status: 'OK', label: null, orientacao: null, erro: null, tipo: null }]
        : parcelas.map(p => ({
            nome: p.segurado,
            sub:  `${nomRamo(p.ramo)} · Apólice ${p.apolice} End ${p.endosso} | Parcela ${p.parcela} | R$ ${p.valor} | Venc: ${p.vencimento}${p.repique === 'S' ? ' · REPIQUE' : ''}`,
            status: 'OK',
            label: null, orientacao: null, erro: null, tipo: null,
          }))

      atualizar(jobId, { status: 'concluido', progresso: 5, resultados })
      await db.jobConcluido(jobId, 'tokio', { resultados, csvPath: csvPath || null }, _inicio)

      await enviarEmail(parcelas, csvPath, jobId)
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const ss = await screenshot(page, `erro_tokio_${Date.now()}.png`)
      const cl = classificarErro(e.message)
      atualizar(jobId, {
        status: 'erro_critico', erro: e.message,
        resultados: [{ nome: 'Tokio Marine — Extração falhou', sub: cl.label, status: 'FALHA', label: cl.label, orientacao: cl.orientacao, erro: e.message, tipo: cl.tipo, screenshotPath: ss }],
      })
      await db.jobErro(jobId, 'tokio', e.message, _inicio)
      await email.enviar({
        assunto: '❌ Tokio Marine inadimplentes — Erro na extração',
        corpo: `Erro ao extrair inadimplentes da Tokio Marine.\n\nJob: ${jobId}\nErro: ${e.message}\nTipo: ${cl.label}\nAção: ${cl.orientacao}${ss ? `\nScreenshot: ${ss}` : ''}`,
      })
    } finally {
      await fecharBrowser(browser)
    }
  })
}
module.exports.getJobStatus = getJobStatus
