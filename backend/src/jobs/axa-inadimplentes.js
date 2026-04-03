// src/jobs/axa-inadimplentes.js
// Login e-solutions.axa.com.br → Serviços → Financeiro → Pagamento e Boletos
// Filtra por Status "em atraso" → exporta → CSV → email
// Todos os ramos são Transportes (código 43)

require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_axa = getCred('axa')
let LOGIN_EMAIL = _cred_axa.email || ''
let LOGIN_SENHA = _cred_axa.senha || ''
let PORTAL_URL = getCred('axa').url || ''

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

module.exports.getJobStatus = (req, res) => {
  const job = JOBS.get(req.params.jobId)
  if (!job) return res.status(404).json({ erro: 'Job não encontrado.' })
  res.json(job)
}

// ── Constantes ────────────────────────────────────────────────────────────────




const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

// ── Helpers ───────────────────────────────────────────────────────────────────

async function screenshot(page, nome) {
  try {
    fs.mkdirSync(SCREENSHOTS, { recursive: true })
    const p = path.join(SCREENSHOTS, nome)
    await page.screenshot({ path: p, fullPage: false })
    return p
  } catch { return null }
}

function classificarErro(msg) {
  if (!msg) return { tipo: 'DESCONHECIDO', label: 'Erro desconhecido', orientacao: 'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN') || u.includes('SENHA') || u.includes('EMAIL') || u.includes('CREDENCIAL') || u.includes('AUTENT'))
    return { tipo: 'LOGIN_FALHOU',    label: 'Login falhou no portal AXA',           orientacao: 'Verifique email e senha em e-solutions.axa.com.br.' }
  if (u.includes('SERVICOS') || u.includes('SERVIÇOS') || u.includes('FINANCEIRO') || u.includes('BOLETO') || u.includes('MENU'))
    return { tipo: 'NAVEGACAO',       label: 'Erro ao navegar no menu AXA',          orientacao: 'Layout do portal pode ter mudado. Caminho: Serviços → Financeiro → Pagamento e Boletos.' }
  if (u.includes('TIMEOUT') || u.includes('EXCEEDED') || u.includes('NAVIGATION'))
    return { tipo: 'TIMEOUT',         label: 'Portal AXA demorou para responder',    orientacao: 'Instabilidade no portal. Tente novamente em alguns minutos.' }
  if (u.includes('EXPORT') || u.includes('DOWNLOAD') || u.includes('CSV'))
    return { tipo: 'DOWNLOAD_FALHOU', label: 'Falha ao exportar arquivo',             orientacao: 'Dados extraídos da tela mas arquivo não gerado. Verifique o email com os dados.' }
  if (u.includes('STATUS') || u.includes('FILTRO') || u.includes('ATRASO'))
    return { tipo: 'FILTRO',          label: 'Erro ao aplicar filtro de status',      orientacao: 'Tente filtrar manualmente por "Em atraso" no portal.' }
  return { tipo: 'OUTRO',             label: msg.substring(0, 80),                    orientacao: 'Verifique o log e tente novamente.' }
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function fazerLogin(page) {
  log.info('Acessando e-solutions AXA...')
  await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2500)

  // Campo de email
  const campoEmail = page.locator('input[type="email"], input[name*="email"], input[name*="user"], input[placeholder*="mail"], input[placeholder*="usuário"]').first()
  await campoEmail.waitFor({ timeout: 15000 })
  await campoEmail.fill(LOGIN_EMAIL)

  // Senha
  await page.locator('input[type="password"]').first().fill(LOGIN_SENHA)

  // Botão entrar
  await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login"), input[type="submit"]').first().click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // Verifica erro
  const erroEl = page.locator('.alert-danger, .error, [class*="error-message"], [class*="login-error"]')
  if (await erroEl.count() > 0) {
    const msg = await erroEl.first().textContent().catch(() => '')
    throw new Error(`LOGIN_FALHOU: ${msg?.trim() || 'Credenciais inválidas'}`)
  }

  // Verifica se ainda está na tela de login
  if (page.url().includes('login') || page.url() === PORTAL_URL + '/') {
    const hasPassword = await page.locator('input[type="password"]').count()
    if (hasPassword > 0) throw new Error('LOGIN_FALHOU: ainda na tela de login após submissão')
  }

  log.ok('Login AXA realizado.')
}

// ── Navegação ─────────────────────────────────────────────────────────────────

async function navegarParaBoletos(page) {
  log.info('Navegando: Serviços → Financeiro → Pagamento e Boletos...')

  // Serviços
  await page.locator('a:has-text("Serviços"), a:has-text("Servicos"), li:has-text("Serviços") > a, [href*="servic"]').first().click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)

  // Financeiro
  await page.locator('a:has-text("Financeiro"), li:has-text("Financeiro") > a').first().click()
  await page.waitForTimeout(1500)

  // Pagamento e Boletos
  await page.locator('a:has-text("Pagamento e Boletos"), a:has-text("Pagamentos"), a:has-text("Boletos")').first().click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.waitForTimeout(3000)

  log.ok('Tela Pagamento e Boletos carregada.')
}

// ── Extração ──────────────────────────────────────────────────────────────────

async function extrairParcelas(page) {
  log.info('Extraindo parcelas em atraso...')

  // Aguarda tabela carregar
  await page.waitForSelector('table, [class*="table"], [class*="grid"]', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2000)

  const todasParcelas = []
  let pagina = 1

  while (true) {
    log.info(`Página ${pagina}...`)

    const linhas = await page.locator('table tbody tr, [class*="row"]:not([class*="header"]):not([class*="thead"])').all()
    log.info(`  ${linhas.length} linha(s) encontrada(s)`)

    for (const linha of linhas) {
      const cols = await linha.locator('td').all()
      if (cols.length < 4) continue

      const vals = await Promise.all(cols.map(c => c.textContent().then(t => t?.trim() || '')))

      // Colunas: Vencimento | Apólice | Endosso | Segurado/Estipulante | CNPJ | Parcela | Valor Prêmio | IOF | Juros | Status
      const parcela = {
        vencimento:   vals[0] || '',
        apolice:      vals[1] || '',
        endosso:      vals[2] || '',
        segurado:     vals[3] || '',
        cnpj:         vals[4] || '',
        parcela:      vals[5] || '',
        valor_premio: vals[6] || '',
        iof:          vals[7] || '',
        juros:        vals[8] || '',
        status:       vals[9] || '',
        ramo:         'Transportes (43)', // todos os ramos AXA são Transportes
      }

      if (!parcela.apolice && !parcela.segurado) continue

      // Filtra apenas "em atraso" — flexível para variações de texto
      const statusLower = parcela.status.toLowerCase()
      const emAtraso = statusLower.includes('atraso') ||
                       statusLower.includes('vencid') ||
                       statusLower.includes('inadimpl') ||
                       statusLower.includes('pendente') ||
                       statusLower.includes('overdue')

      if (emAtraso || parcela.status === '') {
        todasParcelas.push(parcela)
      }
    }

    // Paginação
    const btnNext = page.locator('a:has-text("Próxima"), a:has-text("Próximo"), [aria-label*="Next"], .pagination-next:not(.disabled), li.next:not(.disabled) a').first()
    const temNext = await btnNext.count() > 0 && await btnNext.isEnabled().catch(() => false)
    if (!temNext) break

    await btnNext.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    pagina++

    if (pagina > 50) { log.warn('Limite de 50 páginas atingido.'); break }
  }

  log.ok(`${todasParcelas.length} parcela(s) em atraso extraída(s) em ${pagina} página(s).`)
  return todasParcelas
}

async function tentarExportar(page) {
  try {
    const btn = page.locator(
      'button:has-text("Exportar"), a:has-text("Exportar"), button:has-text("Export"), ' +
      'button:has-text("Excel"), a:has-text("Excel"), button:has-text("CSV"), a:has-text("Download")'
    ).first()

    if (await btn.count() === 0) {
      log.warn('Botão exportar não encontrado.')
      return null
    }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      btn.click(),
    ])

    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
    const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
    const ext  = download.suggestedFilename().endsWith('.xlsx') ? '.xlsx' : '.csv'
    const dest = path.join(DOWNLOAD_DIR, `AXA_INADIMPLENTES_${hoje}_export${ext}`)
    await download.saveAs(dest)
    log.ok(`Exportado: ${dest}`)
    return dest
  } catch (e) {
    log.warn(`Exportação falhou: ${e.message}`)
    return null
  }
}

function gerarCSV(parcelas) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
  const dest = path.join(DOWNLOAD_DIR, `AXA_INADIMPLENTES_${hoje}.csv`)

  const cab = 'vencimento;apolice;endosso;segurado;cnpj;parcela;valor_premio;iof;juros;status;ramo'
  const linhas = parcelas.map(p =>
    [p.vencimento, p.apolice, p.endosso, p.segurado, p.cnpj, p.parcela, p.valor_premio, p.iof, p.juros, p.status, p.ramo]
      .map(v => `"${(v||'').replace(/"/g, '""')}"`)
      .join(';')
  )

  fs.writeFileSync(dest, [cab, ...linhas].join('\n'), 'utf8')
  log.ok(`CSV gerado: ${dest}`)
  return dest
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function enviarEmail(parcelas, csvPath, jobId) {
  const hoje = new Date().toLocaleDateString('pt-BR')

  const totalPremio = parcelas.reduce((a, p) => {
    return a + (parseFloat((p.valor_premio||'0').replace(/\./g,'').replace(',','.')) || 0)
  }, 0)
  const totalJuros = parcelas.reduce((a, p) => {
    return a + (parseFloat((p.juros||'0').replace(/\./g,'').replace(',','.')) || 0)
  }, 0)
  const seguradosUnicos = new Set(parcelas.map(p => p.cnpj || p.segurado)).size

  // Agrupa por segurado
  const porSegurado = parcelas.reduce((acc, p) => {
    const k = `${p.segurado}__${p.cnpj}`
    if (!acc[k]) acc[k] = []
    acc[k].push(p)
    return acc
  }, {})

  const detalhes = Object.entries(porSegurado).map(([key, ps]) => {
    const [nome, cnpj] = key.split('__')
    const tot = ps.reduce((a, p) => a + (parseFloat((p.valor_premio||'0').replace(/\./g,'').replace(',','.')) || 0), 0)
    const linhas = ps.map(p =>
      `   - Apólice ${p.apolice} | End ${p.endosso} | Parcela ${p.parcela} | Prêmio R$ ${p.valor_premio} | Juros R$ ${p.juros} | Venc: ${p.vencimento}`
    ).join('\n')
    return `>> ${nome} (CNPJ: ${cnpj})\n   Parcelas: ${ps.length} | Total prêmio: R$ ${tot.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n${linhas}`
  }).join('\n\n')

  const semResultados = parcelas.length === 0

  const corpo = semResultados
    ? `Prezado Adriano,\n\nNenhuma parcela em atraso encontrada no portal AXA em ${hoje}.\n\nRamo: Transportes (código 43)\nPortal: e-solutions.axa.com.br\n\nAtenciosamente,\nSistema Ferramentas Jacometo`
    : `RELATÓRIO DE PARCELAS EM ATRASO - AXA\nData: ${hoje}\nCorretor: JACOMETO CORRETORA DE SEGUROS LTDA\nRamo: Transportes (código 43)\nJob: ${jobId}\n\n${'='.repeat(60)}\nRESUMO GERAL\n${'='.repeat(60)}\nTotal de parcelas em atraso: ${parcelas.length}\nTotal de segurados distintos: ${seguradosUnicos}\nValor total de prêmios: R$ ${totalPremio.toLocaleString('pt-BR',{minimumFractionDigits:2})}\nTotal de juros acumulados: R$ ${totalJuros.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\n${'='.repeat(60)}\nDETALHAMENTO POR SEGURADO\n${'='.repeat(60)}\n\n${detalhes}\n\n${csvPath ? 'Arquivo CSV em anexo para controle.' : ''}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`

  await email.enviar({
    assunto: semResultados
      ? `AXA — Sem inadimplentes em ${hoje}`
      : `AXA — Parcelas em Atraso — ${parcelas.length} parcela(s) — ${hoje}`,
    corpo,
    anexo: csvPath || undefined,
  })
  log.ok('Email enviado.')
}

// ── Handler principal ─────────────────────────────────────────────────────────

module.exports = async function routeAxaInadimplentes(req, res) {
  const jobId = criarJob()
  log.info(`Job AXA inadimplentes — ${jobId}`)
  res.json({ ok: true, jobId, mensagem: 'Iniciando extração de inadimplentes da AXA.' })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, 'axa')
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred('axa')
    PORTAL_URL = _creds.url || PORTAL_URL
    LOGIN_EMAIL = _creds.email || LOGIN_EMAIL
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()
    try {
      // 1. Login
      atualizar(jobId, { progresso: 0 })
      await fazerLogin(page)
      atualizar(jobId, { progresso: 1 })

      // 2. Navegação
      await navegarParaBoletos(page)
      atualizar(jobId, { progresso: 2 })

      // 3. Extração (todas as páginas, filtro por status em atraso)
      const parcelas = await extrairParcelas(page)
      atualizar(jobId, { progresso: 3 })

      // 4. Exporta CSV (portal ou manual)
      let csvPath = await tentarExportar(page)
      if (!csvPath && parcelas.length > 0) csvPath = gerarCSV(parcelas)
      atualizar(jobId, { progresso: 4 })

      // Monta resultados para o JobStatus
      const resultados = parcelas.length === 0
        ? [{ nome: 'Nenhuma parcela em atraso encontrada', sub: 'Ramo: Transportes (43) · e-solutions.axa.com.br', status: 'OK', label: null, orientacao: null, erro: null, tipo: null }]
        : parcelas.map(p => ({
            nome: p.segurado,
            sub:  `Ramo 43 · Apólice ${p.apolice} | End ${p.endosso} | Parcela ${p.parcela} | R$ ${p.valor_premio} | Juros R$ ${p.juros} | Venc: ${p.vencimento}`,
            status: 'OK',
            label: null, orientacao: null, erro: null, tipo: null,
          }))

      atualizar(jobId, { status: 'concluido', progresso: 5, resultados })
      await db.jobConcluido(jobId, 'axa', { resultados, csvPath: csvPath || null }, _inicio)

      // 5. Email
      await enviarEmail(parcelas, csvPath, jobId)
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const ss = await screenshot(page, `erro_axa_${Date.now()}.png`)
      const cl = classificarErro(e.message)
      atualizar(jobId, {
        status: 'erro_critico', erro: e.message,
        resultados: [{
          nome: 'AXA — Extração falhou',
          sub: cl.label,
          status: 'FALHA',
          label: cl.label,
          orientacao: cl.orientacao,
          erro: e.message,
          tipo: cl.tipo,
          screenshotPath: ss,
        }],
      })
      await db.jobErro(jobId, 'axa', e.message, _inicio)
      await email.enviar({
        assunto: '❌ AXA inadimplentes — Erro na extração',
        corpo: `Erro ao extrair inadimplentes da AXA.\n\nJob: ${jobId}\nErro: ${e.message}\nTipo: ${cl.label}\nAção: ${cl.orientacao}${ss ? `\nScreenshot: ${ss}` : ''}`,
      })
    } finally {
      await fecharBrowser(browser)
    }
  })
}
