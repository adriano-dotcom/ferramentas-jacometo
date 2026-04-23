// src/jobs/chubb-inadimplentes.js
// Login Azure B2C → Portal ChubbNet → Serviços → Financeiro → Cobrança → Exportar → Email
// URL login: chubbnetlogin.chubblatinamerica.com (Azure B2C com whr=53)
// Portal: sso.chubbnet.com

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

// ── Constantes ────────────────────────────────────────────────────────────────

const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

// Portal ChubbNet — o SSO redireciona automaticamente para o login Azure B2C
const PORTAL_URL_CHUBB = 'https://sso.chubbnet.com'

const EMAIL_DEST = 'jacometo@jacometo.com.br, joao.pedro@jacometo.com.br'

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
  if (u.includes('LOGIN') || u.includes('SENHA') || u.includes('ACCESO') || u.includes('CREDENCIAL') || u.includes('PASSWORD'))
    return { tipo: 'LOGIN_FALHOU',    label: 'Login falhou no ChubbNet',         orientacao: 'Verifique se a senha foi alterada. Acesse manualmente chubbnetlogin.chubblatinamerica.com para testar.' }
  if (u.includes('SERVICOS') || u.includes('SERVIÇOS') || u.includes('FINANCEIRO') || u.includes('COBRANCA') || u.includes('COBRANÇA'))
    return { tipo: 'NAVEGACAO',       label: 'Erro ao navegar nos menus',         orientacao: 'O layout do portal pode ter mudado. Verifique manualmente.' }
  if (u.includes('TIMEOUT') || u.includes('NAVIGATION') || u.includes('EXCEEDED'))
    return { tipo: 'TIMEOUT',         label: 'Portal demorou para responder',     orientacao: 'Instabilidade no ChubbNet. Tente novamente em alguns minutos.' }
  if (u.includes('EXPORTAR') || u.includes('DOWNLOAD') || u.includes('CSV'))
    return { tipo: 'DOWNLOAD_FALHOU', label: 'Falha ao exportar o arquivo',       orientacao: 'Os dados foram extraídos mas o CSV não foi gerado. Verifique o email.' }
  return { tipo: 'OUTRO',            label: msg.substring(0, 80),                orientacao: 'Verifique o log e tente novamente.' }
}

// ── Etapa 1: Login via Azure B2C ─────────────────────────────────────────────
// Fluxo: Abre URL B2C → preenche email → Continuar → preenche senha → Entrar
// O portal depois redireciona para sso.chubbnet.com

async function fazerLogin(page, loginEmail, loginSenha) {
  // Fluxo: sso.chubbnet.com → redireciona para Acceso (ASP.NET) → Continuar → Azure B2C → Entrar → Portal
  log.info('Acessando sso.chubbnet.com (vai redirecionar para login)...')
  await page.goto(PORTAL_URL_CHUBB, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000) // aguarda redirects automáticos

  let urlAtual = page.url()
  log.info(`URL após redirect inicial: ${urlAtual}`)
  await screenshot(page, 'chubb_01_redirect.png')

  // ── TELA 1: "Acceso" (ASP.NET WebForms) ─────────────────────────────────
  // Tem título "Acceso", input genérico (sem type=email), botão "Continuar"
  // Muitos hidden inputs ASP.NET (__EVENTTARGET, __VIEWSTATE, etc)
  if (urlAtual.includes('chubblatinamerica') || urlAtual.includes('loginazureb2c') || urlAtual.includes('acceso')) {
    log.info('Na tela Acceso (ASP.NET). Preenchendo email...')

    // Encontrar o input visível usando JS (ASP.NET tem muitos hidden inputs)
    const inputSelector = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input')
      for (const inp of inputs) {
        const tipo = (inp.type || 'text').toLowerCase()
        if (['hidden', 'submit', 'button', 'image', 'checkbox', 'radio'].includes(tipo)) continue
        if (inp.offsetWidth > 0 && inp.offsetHeight > 0) {
          // Retorna um seletor único para este input
          if (inp.id) return '#' + inp.id
          if (inp.name) return `input[name="${inp.name}"]`
          return null
        }
      }
      return null
    })

    log.info(`Input encontrado: ${inputSelector || '(genérico)'}`)

    const campoEmail = inputSelector
      ? page.locator(inputSelector).first()
      : page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"])').first()

    await campoEmail.click()
    await campoEmail.fill(loginEmail)
    await screenshot(page, 'chubb_02_email.png')

    // Clicar Continuar
    const btnContinuar = page.locator('a:has-text("Continuar"), button:has-text("Continuar"), input[type="submit"][value*="Continuar"], input[type="submit"]').first()
    await btnContinuar.click()
    log.info('Clicou Continuar...')

    // Aguarda próxima página (Azure B2C ou direto senha)
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(5000)
    urlAtual = page.url()
    log.info(`URL após Continuar: ${urlAtual}`)
    await screenshot(page, 'chubb_03_pos_continuar.png')
  }

  // ── TELA 2: Azure B2C (email + senha + Entrar) ──────────────────────────
  // Pode ter "Acesso Interno" botão + "ou" + form para externos
  // Campos: "Endereço de email de usuários externos" + "Senha" + "Entrar"

  // Verifica se tem campo de senha visível
  const temSenha = await page.locator('input[type="password"]').count()
  if (temSenha > 0) {
    log.info('Tela de senha Azure B2C detectada.')

    // Verifica se o email já está preenchido, senão preenche
    const campoEmailB2C = page.locator('input[type="email"], input[type="text"]').first()
    if (await campoEmailB2C.count() > 0) {
      const valorAtual = await campoEmailB2C.inputValue().catch(() => '')
      if (!valorAtual || !valorAtual.includes('@')) {
        await campoEmailB2C.click()
        await campoEmailB2C.fill(loginEmail)
        log.info('Email preenchido no Azure B2C.')
      } else {
        log.info(`Email já preenchido: ${valorAtual}`)
      }
    }

    // Preenche senha usando click + type (não fill) para garantir eventos JS
    const campoSenha = page.locator('input[type="password"]').first()
    await campoSenha.click()
    await page.waitForTimeout(300)
    await campoSenha.fill('') // limpa
    await campoSenha.type(loginSenha, { delay: 50 }) // digita char por char
    log.info('Senha digitada no Azure B2C.')

    await screenshot(page, 'chubb_04_senha.png')

    // Submit via Enter (mais confiável que clicar botão em Azure B2C)
    await page.keyboard.press('Enter')
    log.info('Pressionou Enter — aguardando redirecionamento ao portal...')
  } else {
    log.warn('Campo de senha não encontrado. Talvez o login já foi feito ou a tela é diferente.')
    await screenshot(page, 'chubb_04_sem_senha.png')
  }

  // ── Aguardar redirects ────────────────────────────────────────────────────
  log.info('Aguardando redirects do Azure B2C...')
  try {
    await page.waitForLoadState('networkidle', { timeout: 45000 })
  } catch {}
  await page.waitForTimeout(8000)

  urlAtual = page.url()
  log.info(`URL após B2C: ${urlAtual}`)
  await screenshot(page, 'chubb_05_pos_login.png')

  // Verifica se falhou (voltou para tela Acceso com campo de input vazio)
  // URL com wtrealm=_trust/ indica token em processamento WS-Federation (OK — continua)
  // URL com wtrealm=sso.chubbnet.com (sem _trust) = login ainda não completado
  const urlLower = urlAtual.toLowerCase()
  const temFormLogin = await page.locator('a:has-text("Continuar"), input[type="password"]:visible').count()

  if (urlLower.includes('loginazureb2c') && !urlLower.includes('_trust') && temFormLogin > 0) {
    // Realmente voltou para o form de login
    await screenshot(page, 'chubb_06_login_falhou.png')
    throw new Error('LOGIN_FALHOU: Voltou ao form de login. Verifique credenciais.')
  }

  // ── Forçar navegação para sso.chubbnet.com (portal real) ──────────────────
  // Os cookies B2C já foram setados. Goto direto carrega o portal sem frames intermediários.
  log.info('Navegando para sso.chubbnet.com (portal real)...')
  await page.goto('https://sso.chubbnet.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => {
    log.warn(`goto portal: ${e.message.substring(0, 60)}`)
  })

  // Esperar o portal renderizar — aguardar aparecer o texto "Serviços" ou "UNIVERSO"
  try {
    await page.waitForFunction(() => {
      const txt = document.body?.textContent || ''
      return txt.includes('Serviços') || txt.includes('UNIVERSO') || txt.includes('Bem-vindo')
    }, { timeout: 30000 })
    log.ok('Portal carregou (Serviços/UNIVERSO detectado)')
  } catch {
    log.warn('Timeout esperando portal renderizar. Continuando mesmo assim...')
  }
  await page.waitForTimeout(3000)

  urlAtual = page.url()
  log.info(`URL final após portal: ${urlAtual}`)
  await screenshot(page, 'chubb_06_portal.png')
  log.ok('Login ChubbNet realizado.')
}

// ── Etapa 2: Navegar para Serviços → Financeiro → Cobrança ──────────────────

async function navegarParaCobranca(page) {
  log.info('Navegando para Serviços → Financeiro → Cobrança...')

  // Primeiro: screenshot e log do que tem na tela para debug
  await screenshot(page, 'chubb_06_portal.png')
  const bodyText = await page.locator('body').textContent().catch(() => '')
  log.info(`Texto no portal (primeiros 300 chars): ${bodyText.substring(0, 300).replace(/\s+/g, ' ')}`)

  // Portal: cards clicáveis à direita. "Serviços" abre em nova aba/popup.
  await screenshot(page, 'chubb_09_pre_servicos.png')
  await page.waitForTimeout(2000)

  // Listener para capturar nova página (popup/nova aba)
  const context = page.context()
  const novaPaginaPromise = context.waitForEvent('page', { timeout: 20000 }).catch(() => null)

  // Clicar no card "Serviços"
  log.info('Clicando no card Serviços (pode abrir em nova aba)...')
  try {
    const cardServicos = page.locator('a:has-text("Serviços"), div:has-text("Serviços"):not(:has(div:has-text("Serviços")))').first()
    await cardServicos.waitFor({ state: 'visible', timeout: 20000 })
    await cardServicos.click()
  } catch (e) {
    const clicou = await page.evaluate(() => {
      const els = document.querySelectorAll('a, div, td, span')
      for (const el of els) {
        const txt = el.textContent?.trim()
        if (txt === 'Serviços' && el.offsetWidth > 0 && el.offsetHeight > 0) { el.click(); return true }
      }
      return false
    })
    if (!clicou) {
      await screenshot(page, 'chubb_10_sem_servicos.png')
      throw new Error('NAVEGACAO: Não encontrou card "Serviços" no portal.')
    }
  }

  // Aguarda possível nova aba
  await page.waitForTimeout(3000)
  const novaPagina = await novaPaginaPromise

  // Decide qual página usar: se veio nova aba, usa ela; senão continua na mesma
  let pageAtiva = page
  if (novaPagina) {
    log.info('Serviços abriu em nova aba! URL: ' + novaPagina.url())
    await novaPagina.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
    await novaPagina.waitForTimeout(5000)
    pageAtiva = novaPagina
  } else {
    log.info('Serviços navegou na mesma aba.')
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(5000)
  }

  await pageAtiva.screenshot({ path: require('path').join(SCREENSHOTS, 'chubb_10_apos_servicos.png'), fullPage: false }).catch(() => {})
  log.info(`Página ativa agora: ${pageAtiva.url()}`)

  // ── Menu top: hover/click em "Financeiro" → dropdown → "Cobrança" ────────
  log.info('Abrindo menu Financeiro...')
  try {
    const menuFinanceiro = pageAtiva.locator('a:has-text("Financeiro"), .dropdown-toggle:has-text("Financeiro"), [data-toggle="dropdown"]:has-text("Financeiro")').first()
    await menuFinanceiro.waitFor({ state: 'visible', timeout: 20000 })
    await menuFinanceiro.hover()
    await page.waitForTimeout(500)
    await menuFinanceiro.click()
    log.info('Clicou em Financeiro.')
  } catch (e) {
    log.warn(`Financeiro falhou: ${e.message.substring(0, 80)}`)
    await pageAtiva.screenshot({ path: require('path').join(SCREENSHOTS, 'chubb_11_sem_financeiro.png'), fullPage: false }).catch(() => {})
    throw new Error('NAVEGACAO: Não encontrou menu "Financeiro" na página de Serviços.')
  }

  await pageAtiva.waitForTimeout(2000)
  await pageAtiva.screenshot({ path: require('path').join(SCREENSHOTS, 'chubb_11_financeiro.png'), fullPage: false }).catch(() => {})

  // ── Clicar em "Cobrança" no submenu ──────────────────────────────────────
  log.info('Clicando em Cobrança...')
  const linkCobranca = pageAtiva.locator('a:has-text("Cobrança"), li:has-text("Cobrança") a').first()
  await linkCobranca.waitFor({ state: 'visible', timeout: 10000 })
  await linkCobranca.click()
  await pageAtiva.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {})
  await pageAtiva.waitForTimeout(4000)

  await pageAtiva.screenshot({ path: require('path').join(SCREENSHOTS, 'chubb_12_cobranca.png'), fullPage: false }).catch(() => {})
  log.ok('Tela de Cobrança carregada.')

  return pageAtiva // Retorna a página ativa para as próximas etapas
}

// ── Etapa 3: Aplicar filtros e buscar ────────────────────────────────────────
// Filtros: Ramo = Todos | Situação = Pendente de Pagamento | Período = 120 dias

async function aplicarFiltrosEBuscar(page) {
  // Ramo=Todos e Situação=Pendente vêm pré-preenchidos.
  // Período vem 7 dias por default — PRECISA trocar para 120 dias.
  log.info('Ajustando Período para 120 dias (default é 7 dias)...')

  // Seleciona "Últimos 120 dias." no dropdown de período
  // Baseado no screenshot: último select da direita na linha "Período"
  const selectPeriodo = page.locator('select').filter({ hasText: /dias/i }).first()
  let selecionou = false

  if (await selectPeriodo.count() > 0) {
    try {
      await selectPeriodo.selectOption({ label: 'Últimos 120 dias.' })
      selecionou = true
      log.info('Período: Últimos 120 dias.')
    } catch {}
    if (!selecionou) {
      try {
        await selectPeriodo.selectOption({ label: /120/i })
        selecionou = true
        log.info('Período selecionado (regex 120).')
      } catch {}
    }
    if (!selecionou) {
      // Busca manual pela option que contém "120"
      const options = await selectPeriodo.locator('option').all()
      for (const opt of options) {
        const txt = (await opt.textContent())?.trim() || ''
        if (txt.includes('120')) {
          const val = await opt.getAttribute('value')
          await selectPeriodo.selectOption(val)
          selecionou = true
          log.info(`Período selecionado: "${txt}"`)
          break
        }
      }
    }
  }

  if (!selecionou) {
    // Fallback via JS: procura qualquer select com option contendo "120"
    selecionou = await page.evaluate(() => {
      const selects = document.querySelectorAll('select')
      for (const sel of selects) {
        for (const opt of sel.options) {
          if (opt.textContent?.includes('120')) {
            sel.value = opt.value
            sel.dispatchEvent(new Event('change', { bubbles: true }))
            return true
          }
        }
      }
      return false
    })
    if (selecionou) log.info('Período 120 dias selecionado via JS.')
  }

  if (!selecionou) log.warn('Não conseguiu selecionar 120 dias — prosseguindo com default.')

  await screenshot(page, 'chubb_13_filtros.png')

  // Buscar
  log.info('Clicando Buscar...')
  const btnBuscar = page.locator('button:has-text("Buscar"), input[type="submit"][value*="Buscar"], input[type="button"][value*="Buscar"], a:has-text("Buscar")').first()
  await btnBuscar.waitFor({ state: 'visible', timeout: 10000 })
  await btnBuscar.click()
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(5000)

  await screenshot(page, 'chubb_14_resultado.png')
  log.ok('Busca realizada com Período=120 dias.')
}

// ── Etapa 4: Extrair dados da tabela ─────────────────────────────────────────
// Colunas: Apólice | Endosso | Segurado | (espaço) | Emissão | Prêmio Total | Parc | Venc/Canc
// Tem cabeçalhos de ramo: "RAMO 54 - R.C. TRANSP.ROD. CARGA" etc.
// Tem totais parciais por ramo e total geral

async function extrairDadosTabela(page) {
  log.info('Extraindo dados da tabela...')

  const parcelas = []

  // Espera a tabela aparecer
  const tabela = page.locator('table').first()
  await tabela.waitFor({ timeout: 10000 }).catch(() => {})

  // Pega todas as linhas da tabela
  const linhas = await page.locator('table tr').all()
  log.info(`Linhas na tabela: ${linhas.length}`)

  let ramoAtual = ''

  for (const linha of linhas) {
    const texto = (await linha.textContent().catch(() => '') || '').trim()
    if (!texto) continue

    // Ignora cabeçalho da tabela (th)
    const ths = await linha.locator('th').count()
    if (ths > 0) continue

    // Detecta cabeçalho de ramo (ex: "RAMO 54 - R.C. TRANSP.ROD. CARGA")
    if (/RAMO\s*\d+/i.test(texto)) {
      const colunas = await linha.locator('td').count()
      // Se tem poucas colunas (1-2), é um cabeçalho de ramo
      if (colunas <= 2) {
        ramoAtual = texto.replace(/\s+/g, ' ').trim()
        continue
      }
    }

    // Ignora linhas de total
    if (/TOTAL\s*(RAMO|PENDENTE|GERAL)/i.test(texto)) continue
    if (/PENDENTE DE PAGAMENTO\s*-\s*R\$/i.test(texto)) continue

    const colunas = await linha.locator('td').all()
    if (colunas.length < 5) continue

    const vals = await Promise.all(colunas.map(c => c.textContent().then(t => t?.trim() || '').catch(() => '')))

    // A tabela pode ter um checkbox na primeira coluna (radio button)
    // Detecta offset: se primeiro valor parece vazio ou é checkbox
    let offset = 0
    if (vals[0] === '' || vals[0].length <= 1) offset = 1

    const apolice     = vals[offset + 0] || ''
    const endosso     = vals[offset + 1] || ''
    const segurado    = vals[offset + 2] || ''
    // Pode ter coluna vazia entre segurado e emissão
    let emissaoIdx = offset + 3
    // Pula colunas vazias
    while (emissaoIdx < vals.length && !vals[emissaoIdx]) emissaoIdx++
    const emissao     = vals[emissaoIdx] || ''
    const premio      = vals[emissaoIdx + 1] || ''
    const parcNum     = vals[emissaoIdx + 2] || ''
    const vencCanc    = vals[emissaoIdx + 3] || ''

    // Valida: apólice deve ser numérica
    if (!/\d{5,}/.test(apolice)) continue

    const parcela = {
      ramo:         ramoAtual,
      apolice,
      endosso,
      segurado,
      emissao,
      premio_total: premio,
      parcela:      parcNum,
      vencimento:   vencCanc,
      status:       'PENDENTE DE PAGAMENTO',
    }

    parcelas.push(parcela)
  }

  log.ok(`${parcelas.length} parcela(s) extraída(s).`)
  return parcelas
}

// ── Etapa 4b: Exportar arquivo do portal ─────────────────────────────────────

async function tentarExportar(page, jobId) {
  try {
    log.info('Tentando exportar via botão Exportar...')
    const btnExportar = page.locator('button:has-text("Exportar"), input[type="button"][value*="Exportar"], a:has-text("Exportar"), input[type="submit"][value*="Exportar"]').first()

    if (await btnExportar.count() === 0) {
      log.warn('Botão Exportar não encontrado — usando dados extraídos da tela.')
      return null
    }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      btnExportar.click(),
    ])

    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
    const hoje  = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
    const nomeOriginal = download.suggestedFilename() || `CHUBB_INADIMPLENTES_${hoje}.xls`
    const dest  = path.join(DOWNLOAD_DIR, `CHUBB_INADIMPLENTES_${hoje}${path.extname(nomeOriginal) || '.xls'}`)
    await download.saveAs(dest)
    log.ok(`Exportado: ${path.basename(dest)}`)
    return dest
  } catch (e) {
    log.warn(`Exportação falhou: ${e.message}`)
    return null
  }
}

// ── Gerar CSV manualmente ────────────────────────────────────────────────────

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

// ── Etapa 5: Enviar email ────────────────────────────────────────────────────

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
    ? `Prezado(a),\n\nNenhuma parcela pendente encontrada na Chubb em ${hoje}.\n\nFiltros utilizados: Todos os ramos | Pendente de Pagamento | Últimos 120 dias\n\nAtenciosamente,\nSistema Ferramentas Jacometo`
    : `Prezado(a),\n\nSegue o relatório de parcelas pendentes da Chubb.\n\nData: ${hoje}\nJob: ${jobId}\n\nResumo:\n- Total de parcelas pendentes: ${parcelas.length}\n- Valor total pendente: R$ ${totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\nPor ramo:\n${resumoRamos}\n\nDetalhamento:\n${detalhes}\n\n${csvPath ? 'Arquivo em anexo para controle.' : ''}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`

  const assunto = semResultados
    ? `Chubb — Sem inadimplentes em ${hoje}`
    : `Relatório Inadimplentes Chubb — ${parcelas.length} parcela(s) — ${hoje}`

  await email.enviar({ assunto, corpo, para: EMAIL_DEST, anexo: csvPath || undefined })
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

    // Recarrega credenciais a cada execução
    const _creds = getCred(credKey)
    const loginEmail = _creds.email || ''
    const loginSenha = _creds.senha || ''

    if (!loginEmail || !loginSenha) {
      log.error('Credenciais Chubb não configuradas no painel!')
      atualizar(jobId, {
        status: 'erro_critico',
        erro: 'Credenciais não configuradas',
        resultados: [{
          nome: 'Chubb — Credenciais faltando',
          sub: 'Configure email e senha no painel de configurações',
          status: 'FALHA',
          label: 'Credenciais não configuradas',
          orientacao: 'Acesse /ferramentas/configuracoes e preencha email e senha da Chubb.',
          erro: 'Credenciais vazias', tipo: 'LOGIN_FALHOU',
        }],
      })
      await db.jobErro(jobId, credKey, 'Credenciais não configuradas', _inicio)
      return
    }

    const { browser, page } = await abrirBrowser()

    try {
      // ── Etapa 1: Login via Azure B2C ───────────────────────────────────────
      atualizar(jobId, { status: 'executando', progresso: 0, total: 5 })
      await fazerLogin(page, loginEmail, loginSenha)
      atualizar(jobId, { progresso: 1 })

      // ── Etapa 2: Navegar até Cobrança ──────────────────────────────────────
      // Serviços pode abrir em nova aba — navegarParaCobranca retorna a página ativa
      const pageAtiva = await navegarParaCobranca(page) || page
      atualizar(jobId, { progresso: 2 })

      // ── Etapa 3: Aplicar filtros e buscar ──────────────────────────────────
      await aplicarFiltrosEBuscar(pageAtiva)
      atualizar(jobId, { progresso: 3 })

      // ── Etapa 4: Extrair dados + exportar ──────────────────────────────────
      const parcelas = await extrairDadosTabela(pageAtiva)

      // Tenta exportar do portal; se falhar, gera CSV manualmente
      let csvPath = await tentarExportar(pageAtiva, jobId)
      if (!csvPath && parcelas.length > 0) {
        csvPath = gerarCSV(parcelas)
      }
      atualizar(jobId, { progresso: 4 })

      // Monta resultados para o componente JobStatus do frontend
      const resultados = parcelas.length === 0
        ? [{ nome: 'Nenhuma parcela pendente encontrada', sub: 'Filtro: Todos os ramos | Pendente | 120 dias', status: 'OK', label: null, orientacao: null, erro: null, tipo: null }]
        : parcelas.map(p => ({
            nome: p.segurado,
            sub:  `${p.ramo} · Apólice ${p.apolice} | Parcela ${p.parcela} | R$ ${p.premio_total} | Venc: ${p.vencimento}`,
            status: 'OK',
            label: null, orientacao: null, erro: null, tipo: null,
          }))

      atualizar(jobId, { status: 'concluido', resultados, csvPath })
      await db.jobConcluido(jobId, credKey, { resultados, csvPath: csvPath || null }, _inicio)

      // ── Etapa 5: Enviar email ──────────────────────────────────────────────
      await enviarEmail(parcelas, csvPath, jobId)
      atualizar(jobId, { progresso: 5 })
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
      await db.jobErro(jobId, credKey, e.message, _inicio)

      // Email de erro
      await email.enviar({
        assunto: `❌ Chubb inadimplentes — Erro na extração`,
        corpo: `Erro ao extrair inadimplentes da Chubb.\n\nCorretora: ${nomeCorretora}\nJob: ${jobId}\nErro: ${e.message}\nTipo: ${classif.label}\nAção: ${classif.orientacao}${ss ? `\nScreenshot: ${ss}` : ''}`,
        para: EMAIL_DEST,
      })
    } finally {
      await fecharBrowser(browser)
    }
  })
}
module.exports.getJobStatus = getJobStatus
