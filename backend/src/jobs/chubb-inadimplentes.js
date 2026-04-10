// src/jobs/chubb-inadimplentes.js
// Login no ChubbNet → Serviços → Financeiro → Cobrança → extrai parcelas pendentes → CSV + email
// Portal: https://sso.chubbnet.com  (NÃO usar brportal.chubb.com)

require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_chubb = getCred('chubb')
let LOGIN_EMAIL = _cred_chubb.email || ''
let LOGIN_SENHA = _cred_chubb.senha || ''
let PORTAL_URL = getCred('chubb').url || ''

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
  JOBS.set(id, { id, status: 'executando', progresso: 0, total: 1, resultados: [], erro: null, criadoEm: Date.now() })
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
  if (!msg) return { tipo: 'DESCONHECIDO', label: 'Erro desconhecido', orientacao: 'Tente novamente ou verifique o log.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN') || u.includes('SENHA') || u.includes('ACCESO') || u.includes('CREDENCIAL'))
    return { tipo: 'LOGIN_FALHOU',    label: 'Login falhou no ChubbNet',         orientacao: 'Verifique se a senha foi alterada em sso.chubbnet.com.' }
  if (u.includes('SERVICOS') || u.includes('SERVIÇOS') || u.includes('FINANCEIRO') || u.includes('COBRANCA'))
    return { tipo: 'NAVEGACAO',       label: 'Erro ao navegar nos menus',         orientacao: 'O layout do portal pode ter mudado. Verifique manualmente.' }
  if (u.includes('TIMEOUT') || u.includes('NAVIGATION') || u.includes('EXCEEDED'))
    return { tipo: 'TIMEOUT',         label: 'Portal demorou para responder',     orientacao: 'Instabilidade no ChubbNet. Tente novamente em alguns minutos.' }
  if (u.includes('EXPORTAR') || u.includes('DOWNLOAD') || u.includes('CSV'))
    return { tipo: 'DOWNLOAD_FALHOU', label: 'Falha ao exportar o arquivo',       orientacao: 'Os dados foram extraídos mas o CSV não foi gerado. Verifique o email.' }
  return { tipo: 'OUTRO',            label: msg.substring(0, 80),                orientacao: 'Verifique o log e tente novamente.' }
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function fazerLogin(page) {
  log.info('Acessando ChubbNet...')
  await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2000)

  // Campo de email/login — pode aparecer em português ou espanhol
  const campoEmail = page.locator('input[type="email"], input[name*="email"], input[name*="user"], input[placeholder*="mail"], input[placeholder*="correo"]').first()
  await campoEmail.waitFor({ timeout: 15000 })
  await campoEmail.fill(LOGIN_EMAIL)
  log.info('Email preenchido.')

  // Botão Continuar (pode estar em PT ou ES)
  const btnContinuar = page.locator('button:has-text("Continuar"), button:has-text("Continue"), button:has-text("Siguiente"), input[type="submit"]').first()
  await btnContinuar.click()
  await page.waitForTimeout(2000)

  // Campo de senha (aparece após clicar Continuar)
  const campoSenha = page.locator('input[type="password"]').first()
  await campoSenha.waitFor({ timeout: 10000 })
  await campoSenha.fill(LOGIN_SENHA)

  // Botão Entrar
  const btnEntrar = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Iniciar"), button:has-text("Sign in"), button:has-text("Login")').first()
  await btnEntrar.click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // Verifica se login foi bem sucedido
  const urlAtual = page.url()
  if (urlAtual.includes('login') || urlAtual.includes('sso') || urlAtual.includes('auth')) {
    const erroVisivel = await page.locator('.error, .alert-danger, [class*="error"], [class*="Error"]').count()
    if (erroVisivel > 0) {
      const msgErro = await page.locator('.error, .alert-danger').first().textContent().catch(() => '')
      throw new Error(`LOGIN_FALHOU: ${msgErro || 'Credenciais inválidas'}`)
    }
  }
  log.ok('Login ChubbNet realizado.')
}

// ── Navegação até Cobrança ────────────────────────────────────────────────────

async function navegarParaCobranca(page) {
  log.info('Navegando para Serviços...')

  // Clica no ícone/link de Serviços
  await page.locator('a:has-text("Serviços"), a:has-text("Servicios"), a:has-text("Services"), [title*="Serviço"], [title*="Servicio"]').first().click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)

  // Clica em Financeiro
  log.info('Abrindo Financeiro...')
  await page.locator('a:has-text("Financeiro"), a:has-text("Financiero"), a:has-text("Financial")').first().click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  // Clica em Cobrança
  log.info('Abrindo Cobrança...')
  await page.locator('a:has-text("Cobrança"), a:has-text("Cobranças"), a:has-text("Cobranza"), a:has-text("Billing")').first().click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)

  log.ok('Tela de Cobrança carregada.')
}

// ── Filtros e extração ────────────────────────────────────────────────────────

async function aplicarFiltrosEBuscar(page) {
  log.info('Aplicando filtros: Todos os ramos / Pendente / 120 dias...')

  // Ramo: Todos os ramos
  const selectRamo = page.locator('select[name*="ramo"], select[id*="ramo"], select[name*="Ramo"]').first()
  if (await selectRamo.count() > 0) {
    await selectRamo.selectOption({ label: /todos/i })
  }

  // Situação: Pendente de Pagamento
  const selectSituacao = page.locator('select[name*="situac"], select[id*="situac"], select[name*="status"]').first()
  if (await selectSituacao.count() > 0) {
    await selectSituacao.selectOption({ label: /pendente/i })
  }

  // Período: Últimos 120 dias
  const selectPeriodo = page.locator('select[name*="period"], select[id*="period"], select[name*="dias"]').first()
  if (await selectPeriodo.count() > 0) {
    try { await selectPeriodo.selectOption({ label: /120/i }) } catch {
      // Tenta com valor numérico
      try { await selectPeriodo.selectOption('120') } catch { log.warn('Não foi possível selecionar 120 dias.') }
    }
  }

  // Buscar
  await page.locator('button:has-text("Buscar"), button:has-text("Pesquisar"), input[type="submit"][value*="Buscar"], button[type="submit"]').first().click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.waitForTimeout(3000)

  log.ok('Filtros aplicados e busca realizada.')
}

async function extrairDadosTabela(page) {
  log.info('Extraindo dados da tabela...')

  const parcelas = []

  // Lê todas as linhas da tabela (pode ter múltiplos ramos)
  const linhas = await page.locator('table tbody tr, .result-row, [class*="row"]:not([class*="header"])').all()
  log.info(`Linhas encontradas: ${linhas.length}`)

  let ramoAtual = ''

  for (const linha of linhas) {
    const texto = await linha.textContent().catch(() => '')
    if (!texto?.trim()) continue

    // Detecta cabeçalho de ramo (ex: "Ramo 54 - R.C. Transp.Rod. Carga")
    if (/ramo\s*\d+/i.test(texto) && !(await linha.locator('td').count())) {
      ramoAtual = texto.trim()
      continue
    }

    const colunas = await linha.locator('td').all()
    if (colunas.length < 4) continue

    const vals = await Promise.all(colunas.map(c => c.textContent().then(t => t?.trim() || '')))

    // Estrutura esperada: Apólice | Endosso | Segurado | Emissão | Prêmio Total | Parc | Venc/Canc
    const parcela = {
      ramo:         ramoAtual,
      apolice:      vals[0] || '',
      endosso:      vals[1] || '',
      segurado:     vals[2] || '',
      emissao:      vals[3] || '',
      premio_total: vals[4] || '',
      parcela:      vals[5] || '',
      vencimento:   vals[6] || '',
      status:       vals[7] || 'PENDENTE DE PAGAMENTO',
    }

    if (parcela.apolice && parcela.segurado) {
      parcelas.push(parcela)
    }
  }

  log.ok(`${parcelas.length} parcela(s) extraída(s).`)
  return parcelas
}

async function tentarExportar(page, jobId) {
  try {
    const btnExportar = page.locator('button:has-text("Exportar"), a:has-text("Exportar"), button:has-text("Export"), a:has-text("Download")').first()
    if (await btnExportar.count() === 0) {
      log.warn('Botão exportar não encontrado — usando dados extraídos da tela.')
      return null
    }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      btnExportar.click(),
    ])

    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
    const hoje  = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
    const nome  = `CHUBB_INADIMPLENTES_${hoje}.csv`
    const dest  = path.join(DOWNLOAD_DIR, nome)
    await download.saveAs(dest)
    log.ok(`Exportado: ${nome}`)
    return dest
  } catch (e) {
    log.warn(`Exportação falhou: ${e.message}`)
    return null
  }
}

// ── Geração de CSV manual ─────────────────────────────────────────────────────

function gerarCSV(parcelas) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
  const nome = `CHUBB_INADIMPLENTES_${hoje}.csv`
  const dest = path.join(DOWNLOAD_DIR, nome)

  const cabecalho = 'ramo;apolice;endosso;segurado;emissao;premio_total;parcela;vencimento;status'
  const linhas = parcelas.map(p =>
    [p.ramo, p.apolice, p.endosso, p.segurado, p.emissao, p.premio_total, p.parcela, p.vencimento, p.status]
      .map(v => `"${(v || '').replace(/"/g, '""')}"`)
      .join(';')
  )

  fs.writeFileSync(dest, [cabecalho, ...linhas].join('\n'), 'utf8')
  log.ok(`CSV gerado: ${nome}`)
  return dest
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function enviarEmail(parcelas, csvPath, jobId) {
  const hoje = new Date().toLocaleDateString('pt-BR')

  const totalValor = parcelas.reduce((acc, p) => {
    const v = parseFloat((p.premio_total || '0').replace(/\./g, '').replace(',', '.')) || 0
    return acc + v
  }, 0)

  // Agrupa por ramo
  const porRamo = parcelas.reduce((acc, p) => {
    const r = p.ramo || 'Sem ramo'
    if (!acc[r]) acc[r] = []
    acc[r].push(p)
    return acc
  }, {})

  const resumoRamos = Object.entries(porRamo)
    .map(([ramo, ps]) => {
      const total = ps.reduce((a, p) => a + (parseFloat((p.premio_total||'0').replace(/\./g,'').replace(',','.')) || 0), 0)
      return `  ${ramo}: ${ps.length} parcela(s) — R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    }).join('\n')

  const detalhes = Object.entries(porRamo).map(([ramo, ps]) => {
    const linhas = ps.map((p, i) =>
      `  ${i + 1}. ${p.segurado}\n     Apólice ${p.apolice} | End ${p.endosso} | Parcela ${p.parcela} | R$ ${p.premio_total} | Venc: ${p.vencimento}`
    ).join('\n')
    return `${ramo}:\n${linhas}`
  }).join('\n\n')

  const semResultados = parcelas.length === 0

  const corpo = semResultados
    ? `Prezado Adriano,\n\nNenhuma parcela pendente encontrada na Chubb em ${hoje}.\n\nFiltros utilizados: Todos os ramos | Pendente de Pagamento | Últimos 120 dias\n\nAtenciosamente,\nSistema Ferramentas Jacometo`
    : `Prezado Adriano,\n\nSegue o relatório de parcelas pendentes da Chubb.\n\nData: ${hoje}\nJob: ${jobId}\n\nResumo:\n- Total de parcelas pendentes: ${parcelas.length}\n- Valor total pendente: R$ ${totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\nPor ramo:\n${resumoRamos}\n\nDetalhamento:\n${detalhes}\n\n${csvPath ? 'Arquivo CSV em anexo para controle.' : ''}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`

  const assunto = semResultados
    ? `Chubb — Sem inadimplentes em ${hoje}`
    : `Relatório Inadimplentes Chubb — ${parcelas.length} parcela(s) — ${hoje}`

  await email.enviar({ assunto, corpo, anexo: csvPath || undefined })
  log.ok('Email enviado.')
}

// ── Handler principal ─────────────────────────────────────────────────────────

module.exports = async function routeChubbInadimplentes(req, res) {
  const corretora = req.body?.corretora || 'jacometo'
  const credKey = corretora === 'giacomet' ? 'giacomet_chubb' : 'chubb'
  const nomeCorretora = corretora === 'giacomet' ? 'GIACOMET' : 'JACOMETO'

  const jobId = criarJob()
  log.info(`Job Chubb inadimplentes [${nomeCorretora}] — ${jobId}`)

  res.json({ ok: true, jobId, mensagem: `Iniciando extração de inadimplentes da Chubb (${nomeCorretora}).` })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, credKey)
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred(credKey)
    PORTAL_URL = _creds.url || PORTAL_URL
    LOGIN_EMAIL = _creds.email || LOGIN_EMAIL
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()

    try {
      // ── Login ───────────────────────────────────────────────────────────────
      atualizar(jobId, { status: 'executando', progresso: 0, total: 4 })

      await fazerLogin(page)
      atualizar(jobId, { progresso: 1 })

      // ── Navegar até Cobrança ────────────────────────────────────────────────
      await navegarParaCobranca(page)
      atualizar(jobId, { progresso: 2 })

      // ── Aplicar filtros e buscar ────────────────────────────────────────────
      await aplicarFiltrosEBuscar(page)
      atualizar(jobId, { progresso: 3 })

      // ── Extrair dados ───────────────────────────────────────────────────────
      const parcelas = await extrairDadosTabela(page)

      // Tenta exportar CSV do portal; se falhar, gera manualmente
      let csvPath = await tentarExportar(page, jobId)
      if (!csvPath && parcelas.length > 0) {
        csvPath = gerarCSV(parcelas)
      }

      atualizar(jobId, { progresso: 4 })

      // Monta resultados para o componente JobStatus do frontend
      const resultados = parcelas.length === 0
        ? [{ nome: 'Nenhuma parcela pendente encontrada', sub: 'Filtro: Todos os ramos | Últimos 120 dias', status: 'OK', label: null, orientacao: null, erro: null, tipo: null }]
        : parcelas.map(p => ({
            nome: p.segurado,
            sub:  `${p.ramo} · Apólice ${p.apolice} | Parcela ${p.parcela} | R$ ${p.premio_total} | Venc: ${p.vencimento}`,
            status: 'OK',
            label: null, orientacao: null, erro: null, tipo: null,
          }))

      atualizar(jobId, { status: 'concluido', resultados, csvPath })
      await db.jobConcluido(jobId, 'chubb', { resultados, csvPath: csvPath || null }, _inicio)

      // ── Email ───────────────────────────────────────────────────────────────
      await enviarEmail(parcelas, csvPath, jobId)
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const ss = await screenshot(page, `erro_chubb_${Date.now()}.png`)
      const classif = classificarErro(e.message)
      atualizar(jobId, {
        status: 'erro_critico',
        erro: e.message,
        resultados: [{
          nome: 'Chubb — Extração falhou',
          sub:  classif.label,
          status: 'FALHA',
          label: classif.label,
          orientacao: classif.orientacao,
          erro: e.message,
          tipo: classif.tipo,
          screenshotPath: ss,
        }],
      })
      await db.jobErro(jobId, 'chubb', e.message, _inicio)

      await email.enviar({
        assunto: `❌ Chubb inadimplentes — Erro na extração`,
        corpo: `Erro ao extrair inadimplentes da Chubb.\n\nJob: ${jobId}\nErro: ${e.message}\nTipo: ${classif.label}\nAção: ${classif.orientacao}${ss ? `\nScreenshot: ${ss}` : ''}`,
      })
    } finally {
      await fecharBrowser(browser)
    }
  })
}
module.exports.getJobStatus = getJobStatus
