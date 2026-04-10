// src/jobs/axa-inadimplentes.js
// Login e-solutions.axa.com.br → SERVIÇOS (hover) → Pagamento e Boletos
// Filtro: Status = "Vencido" → FILTRAR → DOWNLOAD *.PDF → email
// Todos os ramos são Transportes (código 43)

require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

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

const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

async function ss(page, nome) {
  try {
    fs.mkdirSync(SCREENSHOTS, { recursive: true })
    const p = path.join(SCREENSHOTS, nome)
    await page.screenshot({ path: p, fullPage: false })
    return p
  } catch { return null }
}

function classErr(msg) {
  if (!msg) return { tipo: 'DESCONHECIDO', label: 'Erro desconhecido', orientacao: 'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN') || u.includes('SENHA') || u.includes('EMAIL') || u.includes('CREDENCIAL') || u.includes('AUTENT'))
    return { tipo: 'LOGIN_FALHOU', label: 'Login falhou no portal AXA', orientacao: 'Verifique email e senha em e-solutions.axa.com.br.' }
  if (u.includes('SERVICOS') || u.includes('SERVIÇOS') || u.includes('FINANCEIRO') || u.includes('BOLETO') || u.includes('MENU') || u.includes('NAVEGACAO'))
    return { tipo: 'NAVEGACAO', label: 'Erro ao navegar no menu AXA', orientacao: 'Caminho: SERVIÇOS → Pagamento e Boletos.' }
  if (u.includes('TIMEOUT') || u.includes('EXCEEDED') || u.includes('NAVIGATION'))
    return { tipo: 'TIMEOUT', label: 'Portal AXA demorou para responder', orientacao: 'Instabilidade no portal. Tente novamente.' }
  if (u.includes('DOWNLOAD') || u.includes('PDF') || u.includes('CSV'))
    return { tipo: 'DOWNLOAD_FALHOU', label: 'Falha ao baixar PDF', orientacao: 'Tente baixar manualmente pelo portal.' }
  if (u.includes('FILTRO') || u.includes('VENCIDO'))
    return { tipo: 'FILTRO', label: 'Erro ao aplicar filtro Vencido', orientacao: 'Selecione Status = Vencido manualmente.' }
  return { tipo: 'OUTRO', label: msg.substring(0, 80), orientacao: 'Verifique o log e tente novamente.' }
}

// ── 1. Login ─────────────────────────────────────────────────────────────────

async function fazerLogin(page, portalUrl, loginEmail, loginSenha) {
  log.info('Acessando e-solutions AXA...')
  await page.goto(portalUrl, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2500)

  // Campo de email
  const campoEmail = page.locator('input[type="email"], input[name*="email"], input[name*="user"], input[placeholder*="mail"], input[placeholder*="usuário"]').first()
  await campoEmail.waitFor({ timeout: 15000 })
  await campoEmail.fill(loginEmail)

  // Senha
  await page.locator('input[type="password"]').first().fill(loginSenha)

  // Botão entrar
  await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login"), input[type="submit"]').first().click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // Verifica erro de login
  const erroEl = page.locator('.alert-danger, .error, [class*="error-message"], [class*="login-error"]')
  if (await erroEl.count() > 0) {
    const msg = await erroEl.first().textContent().catch(() => '')
    throw new Error(`LOGIN_FALHOU: ${msg?.trim() || 'Credenciais inválidas'}`)
  }

  // Verifica se ainda está na tela de login
  if (page.url().includes('login') || page.url() === portalUrl + '/') {
    const hasPassword = await page.locator('input[type="password"]').count()
    if (hasPassword > 0) throw new Error('LOGIN_FALHOU: ainda na tela de login após submissão')
  }

  log.ok('Login AXA realizado.')
}

// ── 2. Navegação: SERVIÇOS (hover) → Pagamento e Boletos ────────────────────

async function navegarParaBoletos(page) {
  log.info('Navegando: SERVIÇOS → Pagamento e Boletos...')

  // O menu SERVIÇOS é um dropdown que abre no hover
  // Dentro dele: CONSULTAS e FINANCEIRO (com Pagamento e Boletos)

  // Estratégia 1: Hover no menu SERVIÇOS → clicar em "Pagamento e Boletos"
  try {
    log.info('Tentativa 1: Hover SERVIÇOS → clique Pagamento e Boletos...')
    const menuServicos = page.locator('a:has-text("SERVIÇOS"), a:has-text("Serviços"), a:has-text("SERVICOS")').first()
    await menuServicos.hover()
    await page.waitForTimeout(1500)

    // O dropdown abriu — clicar direto em "Pagamento e Boletos"
    const linkBoletos = page.locator('a:has-text("Pagamento e Boletos")').first()
    await linkBoletos.waitFor({ state: 'visible', timeout: 5000 })
    await linkBoletos.click()
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.waitForTimeout(3000)

    // Verifica se carregou a tela correta
    const titulo = await page.locator('h1, h2, h3, [class*="title"], [class*="header"]').filter({ hasText: /pagamento|boleto/i }).count()
    const temFiltro = await page.locator('select, [class*="filter"], [class*="filtro"]').count()
    if (titulo > 0 || temFiltro > 0) {
      log.ok('Tela Pagamento e Boletos carregada (via hover menu).')
      return
    }
  } catch (e) {
    log.warn(`Hover menu falhou: ${e.message}`)
  }

  // Estratégia 2: Navegar pela rota hash diretamente (AngularJS SPA)
  try {
    log.info('Tentativa 2: Navegação direta #!/lista-parcelas...')
    const baseUrl = page.url().split('#')[0]
    await page.goto(baseUrl + '#!/lista-parcelas', { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(4000)

    const temConteudo = await page.locator('select, table, [class*="filter"], [class*="filtro"]').count()
    if (temConteudo > 0) {
      log.ok('Tela Pagamento e Boletos carregada (via rota hash).')
      return
    }
  } catch (e) {
    log.warn(`Rota hash falhou: ${e.message}`)
  }

  // Estratégia 3: Clique forçado via JavaScript
  try {
    log.info('Tentativa 3: JS click no link...')
    const clicou = await page.evaluate(() => {
      // Procura o link por texto ou href
      const links = Array.from(document.querySelectorAll('a'))
      const link = links.find(a =>
        a.textContent?.includes('Pagamento e Boletos') ||
        a.getAttribute('href')?.includes('lista-parcelas') ||
        a.getAttribute('ui-sref')?.includes('lista-parcelas')
      )
      if (link) { link.click(); return true }
      return false
    })
    if (clicou) {
      await page.waitForLoadState('networkidle', { timeout: 20000 })
      await page.waitForTimeout(3000)
      log.ok('Tela Pagamento e Boletos carregada (via JS click).')
      return
    }
  } catch (e) {
    log.warn(`JS click falhou: ${e.message}`)
  }

  // Estratégia 4: Hash direto via JS (último recurso)
  try {
    log.info('Tentativa 4: window.location.hash...')
    await page.evaluate(() => { window.location.hash = '#!/lista-parcelas' })
    await page.waitForTimeout(5000)
    log.ok('Tela Pagamento e Boletos carregada (via hash direto).')
    return
  } catch (e) {
    throw new Error(`NAVEGACAO: Não foi possível acessar Pagamento e Boletos. ${e.message}`)
  }
}

// ── 3. Filtro: Status = "Vencido" → FILTRAR ─────────────────────────────────

async function filtrarVencidos(page) {
  log.info('Verificando filtro Status = Vencido...')

  // O portal já abre com Status = "Vencido" por padrão e dados carregados
  // Só precisamos garantir que "Vencido" está selecionado e clicar FILTRAR se necessário

  // Verifica se já tem dados na tabela (pode já estar carregado)
  const jaTemDados = await page.locator('table tbody tr').count().catch(() => 0)
  if (jaTemDados > 0) {
    log.ok(`Tabela já carregada com ${jaTemDados} linha(s) — filtro Vencido já aplicado.`)
    return
  }

  // Se não tem dados, tenta selecionar Vencido e filtrar
  try {
    // O select de Status é visível; o outro (tipoBusca) é hidden
    // Usar ng-model para pegar o correto, ou pegar só selects visíveis
    const selectStatus = page.locator('select:visible').first()
    const temSelect = await selectStatus.count()

    if (temSelect > 0) {
      try { await selectStatus.selectOption({ label: 'Vencido' }) } catch {
        try { await selectStatus.selectOption('Vencido') } catch {
          log.info('Select já estava em Vencido ou não acessível.')
        }
      }
      await page.waitForTimeout(500)
    }

    // Clicar FILTRAR
    const btnFiltrar = page.locator('button:has-text("FILTRAR"), button:has-text("Filtrar")').first()
    if (await btnFiltrar.count() > 0) {
      await btnFiltrar.click()
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      await page.waitForTimeout(4000)
      log.ok('Filtro FILTRAR clicado — dados carregados.')
    }
  } catch (e) {
    log.warn(`Filtro manual falhou: ${e.message} — prosseguindo com dados atuais.`)
  }
}

// ── 4. Extração da tabela (para resumo no email) ────────────────────────────

async function extrairParcelas(page) {
  log.info('Extraindo parcelas vencidas da tabela...')

  await page.waitForSelector('table', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2000)

  const todasParcelas = []
  let pagina = 1

  while (true) {
    log.info(`Página ${pagina}...`)

    const linhas = await page.locator('table tbody tr').all()
    log.info(`  ${linhas.length} linha(s) encontrada(s)`)

    for (const linha of linhas) {
      const cols = await linha.locator('td').all()
      if (cols.length < 3) continue

      const vals = await Promise.all(cols.map(c => c.textContent().then(t => t?.trim().replace(/\s+/g, ' ') || '')))

      // Colunas reais do portal AXA:
      // VENCIMENTO | APÓLICE/ENDOSSO | ESTIPULANTE/SEGURADO | PARCELA | VALOR DO PRÊMIO | (ícones) | (botão PRORROGAR)
      //
      // A coluna APÓLICE/ENDOSSO contém duas linhas:
      //   "02852.2023.0043.0654.0008961 Endosso: 4"
      // A coluna PARCELA contém:
      //   "R$ 600,00 1/1"

      const colApolice = vals[1] || ''
      const matchEndosso = colApolice.match(/Endosso:\s*(\d+)/i)
      const apolice = colApolice.replace(/Endosso:\s*\d+/i, '').trim()
      const endosso = matchEndosso ? matchEndosso[1] : ''

      const parcela = {
        vencimento:     vals[0] || '',
        apolice:        apolice,
        endosso:        endosso,
        segurado:       vals[2] || '',
        parcela_valor:  vals[3] || '',
        valor_premio:   vals[4] || '',
        ramo:           'Transportes (43)',
      }

      if (!parcela.apolice && !parcela.segurado) continue
      todasParcelas.push(parcela)
    }

    // Paginação — cuidado: o portal tem botão "Próximas Renovações" que NÃO é paginação
    // Procurar apenas dentro de .pagination ou navegação numérica
    const btnNext = page.locator(
      '.pagination a:has-text(">"), .pagination a:has-text("»"), .pagination .next a, ' +
      'ul.pagination li:not(.disabled):last-child a, ' +
      'nav[aria-label*="paginat"] a:last-child, ' +
      '[class*="pagination"] a[aria-label*="Next"], [class*="pagination"] a[aria-label*="next"]'
    ).first()
    const temNext = await btnNext.count() > 0 && await btnNext.isVisible().catch(() => false)
    if (!temNext) break

    await btnNext.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    pagina++

    if (pagina > 50) { log.warn('Limite de 50 páginas atingido.'); break }
  }

  log.ok(`${todasParcelas.length} parcela(s) vencida(s) extraída(s) em ${pagina} página(s).`)
  return todasParcelas
}

// ── 5. Download PDF ──────────────────────────────────────────────────────────

async function baixarPDF(page) {
  log.info('Baixando PDF via botão DOWNLOAD...')
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })

  // O portal tem um botão DOWNLOAD que abre dropdown com *.PDF, *.CSV, *.XLS
  // Precisamos: clicar DOWNLOAD → clicar *.PDF

  // Clicar no botão DOWNLOAD
  const btnDownload = page.locator('button:has-text("DOWNLOAD"), button:has-text("Download"), a:has-text("DOWNLOAD")').first()
  await btnDownload.waitFor({ timeout: 10000 })
  await btnDownload.click()
  await page.waitForTimeout(1500)

  // Clicar em *.PDF no dropdown
  const opcaoPDF = page.locator('a:has-text(".PDF"), a:has-text("PDF"), button:has-text(".PDF"), button:has-text("PDF"), li:has-text("PDF")').first()

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    opcaoPDF.click(),
  ])

  const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
  const dest = path.join(DOWNLOAD_DIR, `AXA_INADIMPLENTES_${hoje}.pdf`)
  await download.saveAs(dest)
  log.ok(`PDF salvo: ${dest}`)
  return dest
}

// Fallback: gerar CSV manual se PDF falhar
function gerarCSV(parcelas) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
  const dest = path.join(DOWNLOAD_DIR, `AXA_INADIMPLENTES_${hoje}.csv`)

  const cab = 'vencimento;apolice;endosso;segurado;parcela;valor_premio;ramo'
  const linhas = parcelas.map(p =>
    [p.vencimento, p.apolice, p.endosso, p.segurado, p.parcela_valor, p.valor_premio, p.ramo]
      .map(v => `"${(v || '').replace(/"/g, '""')}"`)
      .join(';')
  )

  fs.writeFileSync(dest, [cab, ...linhas].join('\n'), 'utf8')
  log.ok(`CSV fallback gerado: ${dest}`)
  return dest
}

// ── Email ────────────────────────────────────────────────────────────────────

async function enviarEmail(parcelas, arquivoPath, jobId, nomeCorretora) {
  const hoje = new Date().toLocaleDateString('pt-BR')

  const totalPremio = parcelas.reduce((a, p) => {
    return a + (parseFloat((p.valor_premio || '0').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0)
  }, 0)
  const seguradosUnicos = new Set(parcelas.map(p => p.segurado)).size

  const semResultados = parcelas.length === 0

  // Agrupa por segurado
  const porSegurado = parcelas.reduce((acc, p) => {
    const k = p.segurado || 'Sem nome'
    if (!acc[k]) acc[k] = []
    acc[k].push(p)
    return acc
  }, {})

  const detalhes = Object.entries(porSegurado).map(([nome, ps]) => {
    const tot = ps.reduce((a, p) => a + (parseFloat((p.valor_premio || '0').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0), 0)
    const linhas = ps.map(p =>
      `   - Apólice ${p.apolice}${p.endosso ? ` End ${p.endosso}` : ''} | ${p.parcela_valor} | Prêmio ${p.valor_premio} | Venc: ${p.vencimento}`
    ).join('\n')
    return `>> ${nome}\n   Parcelas: ${ps.length} | Total prêmios: R$ ${tot.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n${linhas}`
  }).join('\n\n')

  const corpo = semResultados
    ? `Nenhuma parcela vencida encontrada no portal AXA em ${hoje}.\n\nRamo: Transportes (43)\nCorretora: ${nomeCorretora}\nPortal: e-solutions.axa.com.br`
    : `RELATÓRIO DE PARCELAS VENCIDAS — AXA\nData: ${hoje}\nCorretora: ${nomeCorretora}\nRamo: Transportes (43)\nJob: ${jobId}\n\n${'='.repeat(60)}\nRESUMO\n${'='.repeat(60)}\nTotal de parcelas vencidas: ${parcelas.length}\nSegurados distintos: ${seguradosUnicos}\nValor total prêmios: R$ ${totalPremio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n${'='.repeat(60)}\nDETALHAMENTO POR SEGURADO\n${'='.repeat(60)}\n\n${detalhes}\n\n${arquivoPath ? (arquivoPath.endsWith('.pdf') ? 'PDF do portal em anexo.' : 'CSV em anexo.') : ''}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`

  await email.enviar({
    assunto: semResultados
      ? `AXA — Sem parcelas vencidas em ${hoje}`
      : `AXA — Parcelas Vencidas — ${parcelas.length} parcela(s) — ${hoje}`,
    corpo,
    anexo: arquivoPath || undefined,
    para: 'jacometo@jacometo.com.br, joao.pedro@jacometo.com.br',
  })
  log.ok('Email enviado para jacometo@jacometo.com.br e joao.pedro@jacometo.com.br.')
}

// ── Handler principal ────────────────────────────────────────────────────────

module.exports = async function routeAxaInadimplentes(req, res) {
  const corretora = req.body?.corretora || 'jacometo'
  const credKey = corretora === 'giacomet' ? 'giacomet_axa' : 'axa'
  const nomeCorretora = corretora === 'giacomet' ? 'GIACOMET' : 'JACOMETO'

  const jobId = criarJob()
  log.info(`Job AXA inadimplentes [${nomeCorretora}] — ${jobId}`)
  res.json({ ok: true, jobId, mensagem: `Iniciando extração de parcelas vencidas da AXA (${nomeCorretora}).` })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, credKey)

    // Recarrega credenciais a cada execução
    const _creds = getCred(credKey)
    const portalUrl = _creds.url || 'https://e-solutions.axa.com.br'
    const loginEmail = _creds.email || ''
    const loginSenha = _creds.senha || ''

    const { browser, page } = await abrirBrowser()
    try {
      // ── Etapa 1: Login ──
      atualizar(jobId, { progresso: 0 })
      await fazerLogin(page, portalUrl, loginEmail, loginSenha)
      atualizar(jobId, { progresso: 1 })

      // ── Etapa 2: SERVIÇOS → Pagamento e Boletos ──
      await navegarParaBoletos(page)
      atualizar(jobId, { progresso: 2 })

      // ── Etapa 3: Filtro Status = Vencido → FILTRAR ──
      await filtrarVencidos(page)
      atualizar(jobId, { progresso: 3 })

      // ── Etapa 4: Extrair tabela + Download PDF ──
      const parcelas = await extrairParcelas(page)

      let arquivoPath = null
      try {
        arquivoPath = await baixarPDF(page)
      } catch (e) {
        log.warn(`Download PDF falhou: ${e.message} — gerando CSV como fallback.`)
        if (parcelas.length > 0) arquivoPath = gerarCSV(parcelas)
      }
      atualizar(jobId, { progresso: 4 })

      // Monta resultados para o JobStatus
      const resultados = parcelas.length === 0
        ? [{ nome: 'Nenhuma parcela vencida encontrada', sub: 'Ramo: Transportes (43) · e-solutions.axa.com.br', status: 'OK', label: null, orientacao: null, erro: null, tipo: null }]
        : parcelas.map(p => ({
            nome: p.segurado,
            sub: `Ramo 43 · Apólice ${p.apolice}${p.endosso ? ` End ${p.endosso}` : ''} | ${p.parcela_valor} | Prêmio ${p.valor_premio} | Venc: ${p.vencimento}`,
            status: 'OK',
            label: null, orientacao: null, erro: null, tipo: null,
          }))

      atualizar(jobId, { status: 'concluido', progresso: 5, resultados })
      await db.jobConcluido(jobId, 'axa', { resultados, csvPath: arquivoPath || null }, _inicio)

      // ── Etapa 5: Enviar email ──
      await enviarEmail(parcelas, arquivoPath, jobId, nomeCorretora)
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s) vencida(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const screenshot = await ss(page, `erro_axa_${Date.now()}.png`)
      const cl = classErr(e.message)
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
          screenshotPath: screenshot,
        }],
      })
      await db.jobErro(jobId, 'axa', e.message, _inicio)
      await email.enviar({
        assunto: `❌ AXA inadimplentes (${nomeCorretora}) — Erro`,
        corpo: `Erro ao extrair parcelas vencidas da AXA.\n\nJob: ${jobId}\nCorretora: ${nomeCorretora}\nErro: ${e.message}\nTipo: ${cl.label}\nAção: ${cl.orientacao}`,
        para: 'jacometo@jacometo.com.br, joao.pedro@jacometo.com.br',
      })
    } finally {
      await fecharBrowser(browser)
    }
  })
}
module.exports.getJobStatus = getJobStatus
