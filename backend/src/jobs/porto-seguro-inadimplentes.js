// src/jobs/porto-seguro-inadimplentes.js
// Login corretor.portoseguro.com.br → Parcelas vencidas → CSV + email
// Stealth browser (playwright-extra) com fallback visível para CAPTCHA
require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

const _cred_porto = getCred('porto_seguro')
let LOGIN_USER  = _cred_porto.usuario || ''
let LOGIN_SENHA = _cred_porto.senha   || ''
let PORTAL_URL  = _cred_porto.url     || 'https://corretor.portoseguro.com.br/corretoronline/'
let SUSEP       = _cred_porto.susep   || ''

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const log    = require('../lib/logger')
const email  = require('../lib/email')
const { fecharBrowser } = require('../lib/browser')

// Stealth: playwright-extra + stealth plugin (mesmo padrão Sompo)
const { chromium: stealthChromium } = require('playwright-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
stealthChromium.use(StealthPlugin())

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
const COOKIES_PATH = path.resolve('./downloads/porto-seguro-cookies.json')

async function ss(page, nome) {
  try { fs.mkdirSync(SCREENSHOTS, { recursive: true }); const p = path.join(SCREENSHOTS, nome); await page.screenshot({ path: p }); return p } catch { return null }
}

function classErr(msg) {
  if (!msg) return { tipo: 'DESCONHECIDO', label: 'Erro desconhecido', orientacao: 'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('CAPTCHA') || u.includes('RECAPTCHA')) return { tipo: 'CAPTCHA', label: 'CAPTCHA detectado no portal', orientacao: 'Acesse o portal manualmente uma vez para resolver o CAPTCHA, depois tente novamente.' }
  if (u.includes('LOGIN') || u.includes('SENHA') || u.includes('CPF')) return { tipo: 'LOGIN_FALHOU', label: 'Login falhou no portal Porto Seguro', orientacao: 'Verifique CPF e senha em Configurações.' }
  if (u.includes('SUSEP')) return { tipo: 'NAVEGACAO', label: 'Erro ao selecionar SUSEP', orientacao: 'Verifique se o código SUSEP está correto nas configurações.' }
  if (u.includes('TIMEOUT') || u.includes('EXCEEDED')) return { tipo: 'TIMEOUT', label: 'Portal Porto Seguro demorou para responder', orientacao: 'Instabilidade. Tente novamente.' }
  if (u.includes('PARCELA') || u.includes('TABELA') || u.includes('VENCID')) return { tipo: 'NAVEGACAO', label: 'Erro ao extrair parcelas', orientacao: 'Layout do portal pode ter mudado. Verifique o log.' }
  return { tipo: 'OUTRO', label: msg.substring(0, 80), orientacao: 'Verifique o log e tente novamente.' }
}

// ── Detecta CAPTCHA na página ────────────────────────────────────────────────
async function detectarCaptcha(page) {
  return page.evaluate(() => {
    return !!(
      document.querySelector('iframe[src*="recaptcha"]') ||
      document.querySelector('iframe[src*="captcha"]') ||
      document.querySelector('.g-recaptcha') ||
      document.querySelector('[data-sitekey]')
    )
  })
}

// ── Abre browser stealth ─────────────────────────────────────────────────────
async function abrirStealthBrowser(headless = true) {
  log.info(`Abrindo browser stealth (headless: ${headless})...`)
  const browser = await stealthChromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })
  // Restaura cookies
  try {
    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'))
      await context.addCookies(cookies)
      log.info(`  Cookies restaurados (${cookies.length})`)
    }
  } catch { /* sem cookies anteriores */ }
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.setDefaultNavigationTimeout(45000)
  log.ok('Browser stealth pronto.')
  return { browser, context, page }
}

// ── Salva cookies para próxima execução ──────────────────────────────────────
async function salvarCookies(context) {
  try {
    const cookies = await context.cookies()
    fs.mkdirSync(path.dirname(COOKIES_PATH), { recursive: true })
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2))
    log.info(`  Cookies salvos (${cookies.length})`)
  } catch { /* ok */ }
}

// ── Login no portal ──────────────────────────────────────────────────────────
async function fazerLogin(page) {
  log.info('Acessando portal Porto Seguro...')
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(3000)

  // Aceita cookies se aparecer
  const btnCookies = page.locator('button:has-text("Aceitar"), button:has-text("ACEITAR"), button:has-text("Aceitar todos")')
  if (await btnCookies.count() > 0) {
    await btnCookies.first().click().catch(() => {})
    await page.waitForTimeout(1000)
    log.info('  Cookies aceitos.')
  }

  // Verifica se já está logado (cookies de sessão anteriores)
  const urlAtual = page.url()
  if (urlAtual.includes('dashboard') || urlAtual.includes('home') || urlAtual.includes('corretor')) {
    // Pode já estar logado — verifica se tem campo de login
    const inputCpf = page.locator('input[name*="cpf" i], input[id*="cpf" i], input[placeholder*="CPF" i], input[name*="login" i], input[id*="login" i]').first()
    if (await inputCpf.count() === 0) {
      log.ok('  Já logado via cookies de sessão.')
      return true
    }
  }

  // Preenche CPF
  const inputCpf = page.locator('input[name*="cpf" i], input[id*="cpf" i], input[placeholder*="CPF" i], input[name*="login" i], input[id*="login" i]').first()
  if (await inputCpf.count() === 0) {
    // Tenta seletores mais genéricos
    const inputs = page.locator('input[type="text"], input[type="tel"], input:not([type="password"]):not([type="hidden"])').first()
    await inputs.click()
    await inputs.fill(LOGIN_USER)
  } else {
    await inputCpf.click()
    await inputCpf.fill(LOGIN_USER)
  }
  log.info('  CPF preenchido.')
  await page.waitForTimeout(500)

  // Preenche senha
  const inputSenha = page.locator('input[type="password"]').first()
  await inputSenha.click()
  await inputSenha.fill(LOGIN_SENHA)
  log.info('  Senha preenchida.')
  await page.waitForTimeout(500)

  // Envia formulário (Enter — botão pode estar desabilitado como em outros portais)
  await page.keyboard.press('Enter')
  log.info('  Formulário enviado (Enter).')
  await page.waitForTimeout(5000)

  return false // não estava logado antes, login foi tentado
}

// ── Extrai dados da tabela de parcelas ───────────────────────────────────────
async function extrairParcelas(page) {
  return page.evaluate(() => {
    const rows = []
    const tabela = document.querySelector('table')
    if (!tabela) return rows
    const trs = tabela.querySelectorAll('tbody tr, tr')
    for (const tr of trs) {
      const tds = tr.querySelectorAll('td')
      if (tds.length < 5) continue // pula headers ou linhas vazias
      const texto = Array.from(tds).map(td => (td.textContent || '').trim())
      rows.push(texto)
    }
    return rows
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

module.exports = async function routePortoSeguroInadimplentes(req, res) {
  const corretora = req.body?.corretora || 'jacometo'
  const credKey = corretora === 'giacomet' ? 'giacomet_porto_seguro' : 'porto_seguro'
  const nomeCorretora = corretora === 'giacomet' ? 'GIACOMET' : 'JACOMETO'

  const jobId = criarJob()
  log.info(`Job Porto Seguro inadimplentes [${nomeCorretora}] — ${jobId}`)
  res.json({ ok: true, jobId, mensagem: `Iniciando extração de inadimplentes da Porto Seguro (${nomeCorretora}).` })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, credKey)

    // Recarrega credenciais (pega atualizações do painel)
    const _creds = getCred(credKey)
    PORTAL_URL  = _creds.url     || PORTAL_URL
    LOGIN_USER  = _creds.usuario || LOGIN_USER
    LOGIN_SENHA = _creds.senha   || LOGIN_SENHA
    SUSEP       = _creds.susep   || SUSEP

    let browser, context, page

    try {
      // ── Tentativa 1: Stealth headless ──────────────────────────────
      ;({ browser, context, page } = await abrirStealthBrowser(process.env.HEADLESS !== 'false'))

      // ── 1. Login ───────────────────────────────────────────────────
      const jaLogado = await fazerLogin(page)
      atualizar(jobId, { progresso: 1 })

      // Detecta CAPTCHA
      if (await detectarCaptcha(page)) {
        log.warn('CAPTCHA detectado! Tentando fallback com browser visível...')
        await salvarCookies(context) // salva o que tiver
        await browser.close()

        // ── Tentativa 2: Browser visível (usuário resolve CAPTCHA) ──
        ;({ browser, context, page } = await abrirStealthBrowser(false))
        await fazerLogin(page)

        // Aguarda até 120s para CAPTCHA ser resolvido
        if (await detectarCaptcha(page)) {
          log.warn('Aguardando resolução manual do CAPTCHA (120s)...')
          atualizar(jobId, { status: 'executando', erro: 'CAPTCHA detectado — resolva no navegador visível do Mac Mini' })
          const inicio = Date.now()
          while (Date.now() - inicio < 120000) {
            await page.waitForTimeout(3000)
            if (!(await detectarCaptcha(page))) {
              log.ok('  CAPTCHA resolvido!')
              break
            }
          }
          if (await detectarCaptcha(page)) {
            throw new Error('CAPTCHA não foi resolvido em 120 segundos. Acesse o portal manualmente.')
          }
        }
        atualizar(jobId, { progresso: 1, erro: null })
      }

      // Verifica se login teve sucesso (espera redirecionamento)
      await page.waitForTimeout(3000)
      const urlPosLogin = page.url()
      log.info(`  URL pós-login: ${urlPosLogin}`)

      // Se ainda está na página de login, algo falhou
      const aindaTemLogin = await page.locator('input[type="password"]').count()
      if (aindaTemLogin > 0) {
        await ss(page, `erro_porto_login_${Date.now()}.png`)
        throw new Error('Login falhou — verifique CPF e senha nas Configurações.')
      }

      await salvarCookies(context)
      log.ok('  Login OK.')

      // ── 2. Selecionar SUSEP ────────────────────────────────────────
      if (SUSEP) {
        log.info(`Selecionando SUSEP: ${SUSEP}...`)
        // Busca dropdown ou lista de SUSEP
        const susepOpt = page.locator(`text=${SUSEP}`).first()
        if (await susepOpt.count() > 0) {
          await susepOpt.click()
          await page.waitForTimeout(3000)
          log.ok(`  SUSEP ${SUSEP} selecionada.`)
        } else {
          // Tenta selecionar via select element
          const selects = page.locator('select')
          const count = await selects.count()
          for (let i = 0; i < count; i++) {
            const opts = await selects.nth(i).locator('option').allTextContents()
            const match = opts.find(o => o.includes(SUSEP))
            if (match) {
              await selects.nth(i).selectOption({ label: match })
              await page.waitForTimeout(2000)
              log.ok(`  SUSEP selecionada via dropdown.`)
              break
            }
          }
        }
      }
      atualizar(jobId, { progresso: 2 })

      // ── 3. Navegar para parcelas vencidas ──────────────────────────
      log.info('Navegando para parcelas vencidas...')

      // Tenta clicar no card "Parcelas vencidas" no dashboard
      const cardParcelas = page.locator('text=Parcelas vencidas, text=parcelas vencidas, :has-text("Parcelas vencidas")').first()
      if (await cardParcelas.count() > 0) {
        await cardParcelas.click()
        await page.waitForTimeout(3000)
        log.ok('  Card parcelas vencidas clicado.')
      } else {
        // Tenta navegar pelo menu
        const menuFinanceiro = page.locator('text=Financeiro, a:has-text("Financeiro"), button:has-text("Financeiro")').first()
        if (await menuFinanceiro.count() > 0) {
          await menuFinanceiro.click()
          await page.waitForTimeout(2000)
        }
        const menuParcelas = page.locator('text=Parcelas, a:has-text("Parcelas"), text=Cobrança').first()
        if (await menuParcelas.count() > 0) {
          await menuParcelas.click()
          await page.waitForTimeout(3000)
        }
      }

      // Aplica filtro "Vencidas"
      const filtroVencidas = page.locator('select:near(:text("parcelas")), select:near(:text("Buscar"))').first()
      if (await filtroVencidas.count() > 0) {
        try {
          await filtroVencidas.selectOption({ label: 'Vencidas' })
          await page.waitForTimeout(2000)
          log.info('  Filtro "Vencidas" aplicado.')
        } catch {
          log.warn('  Não conseguiu aplicar filtro Vencidas via select.')
        }
      }

      await ss(page, `porto_parcelas_${Date.now()}.png`)
      atualizar(jobId, { progresso: 3 })

      // ── 4. Extrair tabela + CSV ────────────────────────────────────
      log.info('Extraindo dados da tabela...')

      // Espera tabela carregar
      await page.waitForSelector('table', { timeout: 15000 }).catch(() => null)
      await page.waitForTimeout(2000)

      let todasParcelas = []
      let paginaAtual = 1

      // Loop de paginação
      while (true) {
        log.info(`  Processando página ${paginaAtual}...`)
        const dadosPagina = await extrairParcelas(page)
        log.info(`  ${dadosPagina.length} linhas extraídas na página ${paginaAtual}.`)

        for (const cols of dadosPagina) {
          // Mapeia colunas — ajustar conforme layout real do portal
          // Colunas esperadas: Cliente, CPF/CNPJ, Produto, Apólice, Susep, Valor, Vencimento, Status, Forma Pgto, Parcela
          todasParcelas.push({
            cliente:          cols[0] || '',
            cpf_cnpj:         cols[1] || '',
            produto:          cols[2] || '',
            apolice:          cols[3] || '',
            susep:            cols[4] || '',
            valor:            cols[5] || '',
            vencimento:       cols[6] || '',
            status:           cols[7] || '',
            forma_pagamento:  cols[8] || '',
            parcela:          cols[9] || '',
          })
        }

        // Próxima página
        const btnProx = page.locator('button:has-text("Próxim"), a:has-text("Próxim"), button:has-text("›"), a:has-text("›"), [aria-label="Próxima página"], [aria-label="Next"]').first()
        if (await btnProx.count() > 0 && await btnProx.isEnabled()) {
          await btnProx.click()
          await page.waitForTimeout(3000)
          paginaAtual++
          if (paginaAtual > 50) break // segurança contra loop infinito
        } else {
          break
        }
      }

      log.info(`Total: ${todasParcelas.length} parcelas extraídas.`)

      // Gera CSV
      let csvPath = null
      if (todasParcelas.length > 0) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
        const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
        csvPath = path.join(DOWNLOAD_DIR, `PORTO_SEGURO_INADIMPLENTES_${hoje}.csv`)
        const cab = 'cliente;cpf_cnpj;produto;apolice;susep;valor;vencimento;status;forma_pagamento;parcela'
        const linhas = todasParcelas.map(p =>
          [p.cliente, p.cpf_cnpj, p.produto, p.apolice, p.susep, p.valor, p.vencimento, p.status, p.forma_pagamento, p.parcela]
            .map(v => `"${(v || '').replace(/"/g, '""')}"`)
            .join(';')
        )
        fs.writeFileSync(csvPath, [cab, ...linhas].join('\n'), 'utf8')
        log.ok(`CSV: ${csvPath}`)
      }
      atualizar(jobId, { progresso: 4 })

      // ── 5. Email + Finalizar ───────────────────────────────────────
      log.info('Enviando email...')

      const resultados = todasParcelas.length === 0
        ? [{ nome: 'Nenhuma parcela vencida encontrada', sub: null, status: 'AVISO', label: null, orientacao: null, erro: null, tipo: null }]
        : todasParcelas.map(p => ({
            nome: p.cliente || 'Sem nome',
            sub: `${p.produto || 'Produto'} | Apólice ${p.apolice} | R$ ${p.valor} | Venc: ${p.vencimento}`,
            status: 'OK', label: null, orientacao: null, erro: null, tipo: null,
          }))

      // Calcula valor total
      let valorTotal = 0
      for (const p of todasParcelas) {
        const v = (p.valor || '').replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.')
        const n = parseFloat(v)
        if (!isNaN(n)) valorTotal += n
      }

      atualizar(jobId, { status: 'concluido', progresso: 5, resultados })
      await db.jobConcluido(jobId, 'porto_seguro', { resultados, csvPath, totalItens: todasParcelas.length, valorTotal }, _inicio)

      const hoje2 = new Date().toLocaleDateString('pt-BR')
      await email.enviar({
        assunto: `[Porto Seguro] Parcelas Vencidas — ${todasParcelas.length} parcela(s) — ${hoje2}`,
        corpo: `RELATÓRIO DE INADIMPLENTES — PORTO SEGURO\n` +
               `Data: ${hoje2}\n` +
               `Job: ${jobId}\n\n` +
               `Total de parcelas vencidas: ${todasParcelas.length}\n` +
               `Valor total em atraso: R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
               (SUSEP ? `SUSEP: ${SUSEP}\n` : '') +
               `\nArquivo CSV em anexo.\n\n` +
               `Atenciosamente,\nSistema Ferramentas Jacometo`,
        para: 'jacometo@jacometo.com.br',
        anexo: csvPath ? [csvPath] : undefined,
      })

      await salvarCookies(context)
      log.ok(`Job ${jobId} concluído: ${todasParcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const s = page ? await ss(page, `erro_porto_seguro_${Date.now()}.png`) : null
      const cl = classErr(e.message)
      atualizar(jobId, {
        status: 'erro_critico',
        erro: e.message,
        resultados: [{
          nome: 'Porto Seguro — Extração falhou',
          sub: cl.label,
          status: 'FALHA',
          label: cl.label,
          orientacao: cl.orientacao,
          erro: e.message,
          tipo: cl.tipo,
          screenshotPath: s,
        }],
      })
      await db.jobErro(jobId, 'porto_seguro', e.message, _inicio)
      await email.enviar({
        assunto: `Porto Seguro inadimplentes — Erro`,
        corpo: `Job: ${jobId}\nErro: ${e.message}\nTipo: ${cl.label}\nAção: ${cl.orientacao}`,
        para: 'jacometo@jacometo.com.br',
      })
    } finally {
      if (browser) await browser.close().catch(() => {})
    }
  })
}

module.exports.getJobStatus = getJobStatus
