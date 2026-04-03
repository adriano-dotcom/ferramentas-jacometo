// src/jobs/allianz-inadimplentes.js
// Login AllianzNet → GESTÃO → Financeiro → Gestão de Parcelas → Gestão de Inadimplentes
// Extrai tabela completa (todas as páginas) → CSV → email
// URL: https://www.allianznet.com.br/ngx-epac/public/home

require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_allianz = getCred('allianz')
let LOGIN_USER = _cred_allianz.usuario || ''
let LOGIN_SENHA = _cred_allianz.senha || ''
let PORTAL_URL = getCred('allianz').url || ''

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




const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

const RAMOS = {
  '116': 'Auto',
  '309': 'RC Transportes',
  '312': 'Carga',
  '1211': 'Vida',
  '1251': 'Empresarial',
  '2013': 'Outros',
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
  return RAMOS[codigo] ? `${RAMOS[codigo]} (Ramo ${codigo})` : `Ramo ${codigo}`
}

function classificarErro(msg) {
  if (!msg) return { tipo: 'DESCONHECIDO', label: 'Erro desconhecido', orientacao: 'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN') || u.includes('SENHA') || u.includes('USUARIO') || u.includes('CREDENCIAL') || u.includes('SESSÃO'))
    return { tipo: 'LOGIN_FALHOU',  label: 'Login falhou no AllianzNet',       orientacao: 'Verifique usuário/senha em allianznet.com.br.' }
  if (u.includes('GESTAO') || u.includes('GESTÃO') || u.includes('INADIMPLENTE') || u.includes('MENU'))
    return { tipo: 'NAVEGACAO',     label: 'Erro ao navegar nos menus',         orientacao: 'O layout do AllianzNet pode ter mudado. Verifique manualmente.' }
  if (u.includes('TIMEOUT') || u.includes('EXCEEDED') || u.includes('NAVIGATION'))
    return { tipo: 'TIMEOUT',       label: 'Portal demorou para responder',     orientacao: 'Instabilidade no AllianzNet. Tente novamente.' }
  if (u.includes('PAGINACAO') || u.includes('PAGINAÇÃO') || u.includes('PAGINA'))
    return { tipo: 'PAGINACAO',     label: 'Erro na paginação dos resultados',  orientacao: 'Alguns registros podem não ter sido capturados. Verifique manualmente.' }
  return { tipo: 'OUTRO',           label: msg.substring(0, 80),                orientacao: 'Verifique o log e tente novamente.' }
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function fazerLogin(page) {
  log.info('Acessando AllianzNet...')
  await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(3000)

  // Preenche usuário
  const campoUser = page.locator('input[name*="user"], input[id*="user"], input[placeholder*="suário"], input[placeholder*="uario"], input[type="text"]').first()
  await campoUser.waitFor({ timeout: 15000 })
  await campoUser.fill(LOGIN_USER)

  // Preenche senha
  await page.locator('input[type="password"]').first().fill(LOGIN_SENHA)

  // Clica em Iniciar sessão
  await page.locator('button:has-text("Iniciar sessão"), button:has-text("Entrar"), button[type="submit"]').first().click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // Verifica erro de login
  const erroEl = page.locator('.alert-danger, .error-message, [class*="error"], [class*="Error"]')
  if (await erroEl.count() > 0) {
    const msgErro = await erroEl.first().textContent().catch(() => '')
    throw new Error(`LOGIN_FALHOU: ${msgErro?.trim() || 'Credenciais inválidas'}`)
  }

  log.ok('Login AllianzNet realizado.')
}

// ── Navegação ─────────────────────────────────────────────────────────────────

async function navegarParaInadimplentes(page) {
  log.info('Home → Alertas de Negócio → INADIMPLÊNCIAS')

  // Na home, seção "Alertas de Negócio" tem link direto "INADIMPLÊNCIAS"
  const linkInad = page.locator('text=INADIMPLÊNCIAS').first()
  await linkInad.waitFor({ timeout: 15000 })
  await linkInad.click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000)

  log.ok('Tela de Parcelas Inadimplentes carregada.')
}

// ── Extração ──────────────────────────────────────────────────────────────────

async function pesquisarEBaixarCSV(page) {
  log.info('Pesquisando (filtros em branco = todos os ramos)...')

  // Clica em Pesquisar com filtros vazios (todos os ramos, todos os registros)
  await page.locator('a:has-text("Pesquisar"), input[value="Pesquisar"], button:has-text("Pesquisar")').first().click()
  await page.waitForLoadState('networkidle', { timeout: 45000 })
  await page.waitForTimeout(3000)

  // Verifica se tem resultados — espera pela tabela RESULTADO - TOTAIS
  const temResultado = await page.locator('text=RESULTADO - TOTAIS, text=RESULTADO - POR PARCELA').first().count()
  if (temResultado === 0) {
    log.info('Nenhum resultado encontrado (sem inadimplentes).')
    return { csvPath: null, totalParcelas: 0 }
  }

  // Clica em "Gerar Planilha" para baixar o CSV completo do portal
  log.info('Clicando em Gerar Planilha para download do CSV...')
  const btnGerar = page.locator('a:has-text("Gerar Planilha"), input[value="Gerar Planilha"], button:has-text("Gerar Planilha")').first()
  await btnGerar.waitFor({ timeout: 15000 })

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    btnGerar.click(),
  ])

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
  const dest = path.join(DOWNLOAD_DIR, `ALLIANZ_INADIMPLENTES_${hoje}.csv`)
  await download.saveAs(dest)
  log.ok(`CSV baixado: ${dest}`)

  // Lê o CSV para contar parcelas e montar resultados
  const parcelas = parsearCSV(dest)
  log.ok(`CSV parseado: ${parcelas.length} parcela(s).`)

  return { csvPath: dest, parcelas }
}

function parsearCSV(csvPath) {
  const conteudo = fs.readFileSync(csvPath, 'latin1')
  const linhas = conteudo.split('\n')

  // Encontra a linha de cabeçalho (começa com RECIBO;)
  const idxCab = linhas.findIndex(l => l.startsWith('RECIBO;'))
  if (idxCab < 0) return []

  const cabs = linhas[idxCab].split(';').map(c => c.trim())
  const parcelas = []

  for (let i = idxCab + 1; i < linhas.length; i++) {
    const l = linhas[i].trim()
    if (!l) continue
    const cols = l.split(';').map(c => c.replace(/^="?|"?$/g, '').trim())
    if (cols.length < 5) continue

    const obj = {}
    cabs.forEach((cab, idx) => { obj[cab] = cols[idx] || '' })

    parcelas.push({
      recibo:       obj['RECIBO'] || '',
      ramo:         obj['RAMO'] || '',
      ramo_br:      obj['RAMO_BR'] || '',
      vencimento:   obj['VENCIMENTO'] || '',
      apolice:      obj['APOLICE'] || '',
      parcela:      obj['PARCELA'] || '',
      cpf_cnpj:     obj['CPF_CNPJ'] || '',
      segurado:     obj['SEGURADO'] || '',
      premio:       obj['PREMIO_TOTAL'] || '',
      comissao:     obj['COMISSAO'] || '',
      prev_cancel:  obj['DT_PREV_CANC'] || '',
      fim_cobert:   obj['DT_FIM_COBERT'] || '',
      adesao:       obj['NR_ADESAO'] || '',
    })
  }

  return parcelas
}

// ── CSV manual ────────────────────────────────────────────────────────────────

function gerarCSV(parcelas) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
  const dest = path.join(DOWNLOAD_DIR, `ALLIANZ_INADIMPLENTES_${hoje}.csv`)

  const cab = 'recibo;parcela;vencimento;cpf_cnpj;segurado;ramo;fim_cobertura;prev_cancelamento;premio_liquido;comissao'
  const linhas = parcelas.map(p =>
    [p.recibo, p.parcela, p.vencimento, p.cpf_cnpj, p.segurado, p.ramo, p.fim_cobertura, p.prev_cancel, p.premio_liquido, p.comissao]
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

  const totalPremio = parcelas.reduce((a, p) => a + (parseFloat((p.premio_liquido||'0').replace('.','').replace(',','.')) || 0), 0)
  const totalComissao = parcelas.reduce((a, p) => a + (parseFloat((p.comissao||'0').replace('.','').replace(',','.')) || 0), 0)
  const seguradosUnicos = new Set(parcelas.map(p => p.cpf_cnpj || p.segurado)).size

  // Agrupa por ramo
  const porRamo = {}
  for (const p of parcelas) {
    const r = p.ramo || 'Sem ramo'
    if (!porRamo[r]) porRamo[r] = []
    porRamo[r].push(p)
  }

  const resumoRamos = Object.entries(porRamo).map(([ramo, ps]) => {
    const tot = ps.reduce((a, p) => a + (parseFloat((p.premio_liquido||'0').replace('.','').replace(',','.')) || 0), 0)
    return `  ${nomRamo(ramo)}: ${ps.length} parcela(s) — R$ ${tot.toLocaleString('pt-BR',{minimumFractionDigits:2})}`
  }).join('\n')

  // Agrupa por segurado
  const porSegurado = {}
  for (const p of parcelas) {
    const k = `${p.segurado}__${p.cpf_cnpj}`
    if (!porSegurado[k]) porSegurado[k] = []
    porSegurado[k].push(p)
  }

  const detalhes = Object.entries(porSegurado).map(([key, ps]) => {
    const [nome, doc] = key.split('__')
    const tot = ps.reduce((a, p) => a + (parseFloat((p.premio_liquido||'0').replace('.','').replace(',','.')) || 0), 0)
    const linhas = ps.map(p =>
      `   - Recibo ${p.recibo} | ${nomRamo(p.ramo)} | Venc: ${p.vencimento} | R$ ${p.premio_liquido} | Cancel: ${p.prev_cancel}`
    ).join('\n')
    return `>> ${nome} (${doc})\n   Parcelas: ${ps.length} | Total: R$ ${tot.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n${linhas}`
  }).join('\n\n')

  const semResultados = parcelas.length === 0

  const corpo = semResultados
    ? `Prezado Adriano,\n\nNenhuma parcela em atraso encontrada no AllianzNet em ${hoje}.\n\nCorretor: JACOMETO CORRETORA DE SEGUROS LTDA\n\nAtenciosamente,\nSistema Ferramentas Jacometo`
    : `RELATÓRIO DE PARCELAS EM ATRASO - ALLIANZ\nData: ${hoje}\nCorretor: JACOMETO CORRETORA DE SEGUROS LTDA\nJob: ${jobId}\n\n${'='.repeat(60)}\nRESUMO GERAL\n${'='.repeat(60)}\nTotal de parcelas inadimplentes: ${parcelas.length}\nTotal de segurados distintos: ${seguradosUnicos}\nPrêmio líquido total em atraso: R$ ${totalPremio.toLocaleString('pt-BR',{minimumFractionDigits:2})}\nComissão total em risco: R$ ${totalComissao.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\nPOR RAMO:\n${resumoRamos}\n\n${'='.repeat(60)}\nDETALHAMENTO POR SEGURADO\n${'='.repeat(60)}\n\n${detalhes}\n\n${csvPath ? 'Arquivo CSV em anexo.' : ''}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`

  await email.enviar({
    assunto: semResultados
      ? `Allianz — Sem inadimplentes em ${hoje}`
      : `[AllianzNet] Inadimplentes — ${parcelas.length} parcela(s) — ${hoje}`,
    corpo,
    anexo: csvPath || undefined,
  })
  log.ok('Email enviado.')
}

// ── Handler principal ─────────────────────────────────────────────────────────

module.exports = async function routeAllianzInadimplentes(req, res) {
  const jobId = criarJob()
  log.info(`Job Allianz inadimplentes — ${jobId}`)
  res.json({ ok: true, jobId, mensagem: 'Iniciando extração de inadimplentes da Allianz.' })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, 'allianz')
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred('allianz')
    PORTAL_URL = _creds.url || PORTAL_URL
    LOGIN_USER = _creds.usuario || LOGIN_USER
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()
    try {
      // 1. Login
      atualizar(jobId, { progresso: 0 })
      await fazerLogin(page)
      atualizar(jobId, { progresso: 1 })

      // 2. Navegação até INADIMPLÊNCIAS
      await navegarParaInadimplentes(page)
      atualizar(jobId, { progresso: 2 })

      // 3. Pesquisar e baixar CSV via "Gerar Planilha"
      const { csvPath, parcelas } = await pesquisarEBaixarCSV(page)
      atualizar(jobId, { progresso: 4 })

      // Monta resultados para o JobStatus
      const resultados = (!parcelas || parcelas.length === 0)
        ? [{ nome: 'Nenhuma parcela em atraso encontrada', status: 'OK', label: null, orientacao: null, erro: null, tipo: null }]
        : parcelas.map(p => ({
            nome: p.segurado,
            sub:  `${nomRamo(p.ramo)} · Recibo ${p.recibo} | Apólice ${p.apolice} | R$ ${p.premio} | Venc: ${p.vencimento} | Cancel: ${p.prev_cancel}`,
            status: 'OK',
            label: null, orientacao: null, erro: null, tipo: null,
          }))

      atualizar(jobId, { status: 'concluido', progresso: 5, resultados })
      await db.jobConcluido(jobId, 'allianz', { resultados, csvPath: csvPath || null }, _inicio)

      // 4. Email
      await enviarEmail(parcelas || [], csvPath, jobId)
      log.ok(`Job ${jobId} concluído: ${(parcelas || []).length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const ss = await screenshot(page, `erro_allianz_${Date.now()}.png`)
      const cl = classificarErro(e.message)
      atualizar(jobId, {
        status: 'erro_critico', erro: e.message,
        resultados: [{ nome: 'Allianz — Extração falhou', sub: cl.label, status: 'FALHA', label: cl.label, orientacao: cl.orientacao, erro: e.message, tipo: cl.tipo, screenshotPath: ss }],
      })
      await db.jobErro(jobId, 'allianz', e.message, _inicio)
      await email.enviar({
        assunto: '❌ Allianz inadimplentes — Erro na extração',
        corpo: `Erro ao extrair inadimplentes da Allianz.\n\nJob: ${jobId}\nErro: ${e.message}\nTipo: ${cl.label}\nAção: ${cl.orientacao}${ss ? `\nScreenshot: ${ss}` : ''}`,
      })
    } finally {
      await fecharBrowser(browser)
    }
  })
}

module.exports.getJobStatus = getJobStatus
