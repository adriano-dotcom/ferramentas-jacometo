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

  // Na home, clica "INADIMPLÊNCIAS" (pode estar na page ou num frame)
  const linkInad = page.locator('text=INADIMPLÊNCIAS').first()
  await linkInad.waitFor({ timeout: 15000 })
  await linkInad.click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(4000)

  log.ok('Tela de Parcelas Inadimplentes carregada.')

  // Após o clique, o conteúdo carrega dentro do iframe "appArea"
  const ctx = await entrarNoFrame(page)
  return ctx
}

// Entra no iframe "appArea" do AllianzNet (o portal renderiza tudo dentro dele)
async function entrarNoFrame(page) {
  const frames = page.frames()
  log.info(`Frames detectados: ${frames.length} (${frames.map(f => f.name() || f.url().substring(0, 50)).join(', ')})`)

  // Procura pelo frame "appArea" que é onde o AllianzNet renderiza o conteúdo
  const appArea = frames.find(f => f.name() === 'appArea')
  if (appArea) {
    log.ok('Usando frame: appArea')
    // Espera o frame carregar conteúdo
    await appArea.waitForLoadState('domcontentloaded').catch(() => {})
    await page.waitForTimeout(2000)
    return appArea
  }

  // Fallback: tenta qualquer frame que não seja o principal
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue
    log.ok(`Usando frame fallback: ${frame.name() || frame.url().substring(0, 60)}`)
    return frame
  }

  return page
}

// ── Extração ──────────────────────────────────────────────────────────────────

async function pesquisarEBaixarCSV(ctx, page, jobId) {
  log.info('Verificando resultados (vindo de INADIMPLÊNCIAS, pode já estar carregado)...')

  // Resultados podem já estar carregados ao vir do link INADIMPLÊNCIAS
  let temResultado = await ctx.locator('text=RESULTADO - TOTAIS').count()
  if (temResultado === 0) {
    log.info('Resultados não carregados, clicando em Pesquisar...')
    await ctx.locator(':text-is("Pesquisar"), a:has-text("Pesquisar"), input[value*="Pesquisar"], button:has-text("Pesquisar")').first().click()
    await page.waitForLoadState('networkidle', { timeout: 45000 })
    await page.waitForTimeout(3000)
  }

  temResultado = await ctx.locator('text=RESULTADO - TOTAIS').count()
  if (temResultado === 0) {
    log.info('Nenhum resultado encontrado (sem inadimplentes).')
    return { csvPaths: [], parcelas: [] }
  }

  // Conta quantos ramos tem na tabela de TOTAIS
  log.info('Contando ramos na tabela de RESULTADO - TOTAIS...')

  async function contarLinhasRamo(frame) {
    // Linhas de ramo na tabela TOTAIS têm formato:
    // <tr><td>320096</td><td>116 - Acidentes Pessoais...</td><td>81</td>...
    // Buscamos <tr> que tenha uma <td> com exatamente "320096" como texto
    // e que tenha pelo menos 5 <td> (descarta filtros/cabeçalhos)
    const todas = await frame.locator('tr:has(td)').all()
    const linhas = []
    for (const tr of todas) {
      const tds = await tr.locator('td').all()
      if (tds.length < 5) continue
      // A primeira <td> deve conter o código do corretor
      const primeiraTd = await tds[0].textContent().catch(() => '')
      if (primeiraTd.trim() === '320096') {
        const segundaTd = await tds[1].textContent().catch(() => '')
        log.info(`  Ramo encontrado: ${segundaTd.trim()}`)
        linhas.push(tr)
      }
    }
    return linhas
  }

  let linhasRamo = await contarLinhasRamo(ctx)
  log.info(`Ramos encontrados: ${linhasRamo.length}`)

  // Itera por cada ramo: clica na linha → Gerar Planilha → Voltar
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const hoje = new Date().toISOString().substring(0, 10).replace(/-/g, '_')
  const csvPaths = []
  const todasParcelas = []

  for (let idx = 0; idx < linhasRamo.length; idx++) {
    // Re-localiza após cada "Voltar" (DOM muda)
    const ctxAtualizar = await entrarNoFrame(page)
    linhasRamo = await contarLinhasRamo(ctxAtualizar)
    if (idx >= linhasRamo.length) break

    const textoLinha = await linhasRamo[idx].textContent().catch(() => '')
    const nomeRamo = textoLinha.replace(/\s+/g, ' ').trim().substring(0, 80)
    log.info(`[${idx + 1}/${linhasRamo.length}] Abrindo ramo: ${nomeRamo}`)

    // Clica na linha para entrar em POR PARCELA
    await linhasRamo[idx].click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    // Atualiza o contexto (pode ter mudado de frame)
    const ctxAtual = await entrarNoFrame(page)

    // Procura "Gerar Planilha"
    const btnGerar = ctxAtual.locator('a:has-text("Gerar Planilha"), input[value*="Gerar Planilha"], :text-is("Gerar Planilha")').first()
    const temBtn = await btnGerar.count()

    if (temBtn > 0) {
      log.info(`  → Gerar Planilha encontrado, baixando...`)
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30000 }),
          btnGerar.click(),
        ])
        const ramoNum = textoLinha.match(/\d{3,4}/) ? textoLinha.match(/\d{3,4}/)[0] : idx
        const dest = path.join(DOWNLOAD_DIR, `ALLIANZ_INADIMPLENTES_${hoje}_ramo${ramoNum}.csv`)
        await download.saveAs(dest)
        csvPaths.push(dest)
        log.ok(`  → CSV baixado: ${dest}`)

        // Parseia o CSV
        const parcelas = parsearCSV(dest)
        todasParcelas.push(...parcelas)
        log.ok(`  → ${parcelas.length} parcela(s) neste ramo`)
      } catch (e) {
        log.warn(`  → Erro ao baixar CSV do ramo: ${e.message}`)
      }
    } else {
      log.warn(`  → "Gerar Planilha" não encontrado neste ramo`)
    }

    // Atualiza progresso
    atualizar(jobId, { progresso: 3, total: 5 })

    // Clica em "Voltar" para retornar à tabela de TOTAIS
    const btnVoltar = ctxAtual.locator('a:has-text("Voltar"), input[value*="Voltar"], :text-is("Voltar")').first()
    if (await btnVoltar.count() > 0) {
      await btnVoltar.click()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(3000)
    } else {
      log.warn('  → Botão "Voltar" não encontrado, tentando navegar de volta...')
      await page.goBack()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(3000)
    }
  }

  log.ok(`Total: ${csvPaths.length} arquivo(s) CSV, ${todasParcelas.length} parcela(s).`)
  return { csvPaths, parcelas: todasParcelas }
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

async function enviarEmail(parcelas, csvPaths, jobId) {
  // csvPaths pode ser string (legado) ou array de caminhos
  const anexos = Array.isArray(csvPaths) ? csvPaths : (csvPaths ? [csvPaths] : [])
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
    : `RELATÓRIO DE PARCELAS EM ATRASO - ALLIANZ\nData: ${hoje}\nCorretor: JACOMETO CORRETORA DE SEGUROS LTDA\nJob: ${jobId}\n\n${'='.repeat(60)}\nRESUMO GERAL\n${'='.repeat(60)}\nTotal de parcelas inadimplentes: ${parcelas.length}\nTotal de segurados distintos: ${seguradosUnicos}\nPrêmio líquido total em atraso: R$ ${totalPremio.toLocaleString('pt-BR',{minimumFractionDigits:2})}\nComissão total em risco: R$ ${totalComissao.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\nPOR RAMO:\n${resumoRamos}\n\n${'='.repeat(60)}\nDETALHAMENTO POR SEGURADO\n${'='.repeat(60)}\n\n${detalhes}\n\n${anexos.length > 0 ? `${anexos.length} arquivo(s) CSV em anexo.` : ''}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`

  await email.enviar({
    assunto: semResultados
      ? `Allianz — Sem inadimplentes em ${hoje}`
      : `[AllianzNet] Inadimplentes — ${parcelas.length} parcela(s) — ${hoje}`,
    corpo,
    anexo: anexos.length > 0 ? anexos : undefined,
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

      // 2. Navegação até INADIMPLÊNCIAS (retorna o frame correto)
      const ctx = await navegarParaInadimplentes(page)
      atualizar(jobId, { progresso: 2 })

      // 3. Para cada ramo: clicar → Gerar Planilha → Voltar
      const { csvPaths, parcelas } = await pesquisarEBaixarCSV(ctx, page, jobId)
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
      const csvPath = csvPaths.length > 0 ? csvPaths[0] : null
      await db.jobConcluido(jobId, 'allianz', { resultados, csvPath }, _inicio)

      // 4. Email com todos os CSVs anexados
      await enviarEmail(parcelas || [], csvPaths, jobId)
      log.ok(`Job ${jobId} concluído: ${(parcelas || []).length} parcela(s), ${csvPaths.length} arquivo(s).`)

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
