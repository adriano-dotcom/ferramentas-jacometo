// src/jobs/plano-hospitalar.js
// Processa lote de clientes do Plano Hospitalar:
// Para cada cliente: login SolusWeb → baixa boleto + fatura → salva no Google Drive → logout
// Email resumo consolidado para mayara@jacometo.com.br + adriano@jacometo.com.br
// Roda 9 dias antes do vencimento de cada lote
require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')
const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const { google } = require('googleapis')
const log    = require('../lib/logger')
const email  = require('../lib/email')
const { abrirBrowser, fecharBrowser } = require('../lib/browser')

const JOBS = new Map()
function criarJob(totalClientes) {
  const id = crypto.randomUUID()
  JOBS.set(id, { id, status:'executando', progresso:0, total:totalClientes, resultados:[], erro:null, criadoEm:Date.now() })
  for (const [k,v] of JOBS) { if (Date.now()-v.criadoEm>7200000) JOBS.delete(k) }
  return id
}
function atualizar(id, dados) { const j=JOBS.get(id); if(j) JOBS.set(id,{...j,...dados}) }
function getJobStatus(req, res) {
  const job = JOBS.get(req.params.jobId)
  if (!job) return res.status(404).json({ erro:'Job não encontrado.' })
  res.json(job)
}

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _credPlano   = getCred('plano_hospitalar')
let PORTAL_URL = _credPlano.url          || 'https://servico.planohospitalar.org.br/solusweb/empresa'
let DRIVE_FOLDER = _credPlano.drive_folder || ''
const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

// ── Google Drive upload ───────────────────────────────────────────────────────

async function uploadDrive(caminhoLocal, nomeRemoto) {
  try {
    const auth  = new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_CREDENTIALS_PATH, scopes:['https://www.googleapis.com/auth/drive.file'] })
    const drive = google.drive({ version:'v3', auth })
    const res   = await drive.files.create({
      resource: { name: nomeRemoto, parents: [DRIVE_FOLDER] },
      media:    { mimeType: nomeRemoto.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/pdf', body: fs.createReadStream(caminhoLocal) },
      fields: 'id,name',
    })
    log.ok(`Drive upload: ${nomeRemoto}`)
    return true
  } catch (e) {
    log.error(`Drive upload falhou (${nomeRemoto}): ${e.message}`)
    return false
  }
}

// ── Processa um cliente ───────────────────────────────────────────────────────

async function processarCliente(browser, cliente, diaVenc) {
  const { nome, login, senha, cnpj } = cliente
  const resultado = { nome, cnpj, valor:'-', competencia:'-', vencimento:'-', status:'Erro de login', drive:false, erroMsg:'' }

  // Abre nova página para cada cliente (sessão limpa)
  const context = await browser.newContext({ acceptDownloads:true, viewport:{width:1280,height:800} })
  const page    = await context.newPage()
  page.setDefaultTimeout(30000)

  try {
    log.info(`Processando: ${nome} (${login})`)

    // 1. Login
    await page.goto(PORTAL_URL, { waitUntil:'networkidle', timeout:45000 })
    await page.waitForTimeout(5000)
    await page.locator('input[name*="login"], input[id*="login"], input[placeholder*="login"], input[placeholder*="Login"], input[type="text"]').first().fill(login)
    await page.locator('input[type="password"]').first().fill(senha)
    await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login"), input[type="submit"]').first().click()
    await page.waitForLoadState('networkidle', { timeout:30000 })
    await page.waitForTimeout(5000)

    // Verifica login — se tem mensagem de erro visível
    const temErroCred = await page.locator('.alert-danger, .error, .alert-warning').filter({ hasText: /inválid|incorret|falhou/i }).count()
    if (temErroCred > 0) {
      resultado.status = 'Erro de login'
      resultado.erroMsg = 'Login rejeitado — verifique as credenciais.'
      return resultado
    }

    log.ok(`  Login OK: ${nome}`)
    await page.waitForTimeout(5000)

    // 2. Navega para Boletos — clica no menu dropdown
    await page.locator('text=Boletos').first().click()
    await page.waitForTimeout(3000)
    await page.locator('text=Relação boletos').first().click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(5000)
    log.info(`  URL boletos: ${page.url()}`)

    // Detecta iframes — o SolusWeb pode renderizar conteúdo em iframe
    const frames = page.frames()
    log.info(`  Frames: ${frames.length} (${frames.map(f => f.name() || f.url().substring(0,50)).join(', ')})`)

    // Espera a tabela carregar — verifica em TODOS os frames
    let ctx = page // contexto onde a tabela está (page ou frame)
    for (let espera = 0; espera < 15; espera++) {
      // Verifica no frame principal
      let temDoc = await page.locator('text=Em aberto, text=Vencido').first().count()
      if (temDoc > 0) { log.info(`  Tabela carregou em ${(espera+1)*2}s (page)`); break }

      // Verifica em cada frame
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue
        try {
          const temNoFrame = await frame.locator('text=Em aberto, text=Vencido').first().count({ timeout: 500 })
          if (temNoFrame > 0) {
            ctx = frame
            log.info(`  Tabela carregou em ${(espera+1)*2}s (frame: ${frame.name() || frame.url().substring(0,50)})`)
            break
          }
        } catch {}
      }
      if (ctx !== page) break

      await page.waitForTimeout(2000)
    }

    log.info(`  Contexto: ${ctx === page ? 'page principal' : 'iframe'}`)

    // Debug: pega HTML completo renderizado para ver se a tabela existe
    const fullHTML = await page.content()
    const temAbHTML = fullHTML.includes('aberto') || fullHTML.includes('Vencido')
    const temTrHTML = fullHTML.includes('<tr')
    const htmlLen = fullHTML.length
    log.info(`  HTML renderizado: ${htmlLen} chars, tem "aberto": ${temAbHTML}, tem <tr>: ${temTrHTML}`)
    if (!temAbHTML) {
      // Dump parte do HTML para debug
      const idx = fullHTML.indexOf('Relação')
      if (idx > 0) log.info(`  HTML "Relação": ${fullHTML.substring(idx, idx + 300)}`)
    }

    // 3. Identifica TODOS os boletos — tabela usa DIVs, não <table>
    // Usa Playwright locators que funcionam independente da estrutura HTML
    const situacaoEls = await page.locator(':text-is("Em aberto"), :text-is("Vencido")').all()
    log.info(`  Textos "Em aberto"/"Vencido" encontrados: ${situacaoEls.length}`)

    const boletos = []
    for (const el of situacaoEls) {
      const sitText = (await el.textContent().catch(() => '')).trim()
      // Pula o checkbox "Apenas mensalidades em aberto."
      if (sitText.includes('Apenas') || sitText.length > 20) continue

      // Sobe na árvore para pegar o container da "linha" com doc/data/valor
      const lineText = await el.evaluate(node => {
        let parent = node.parentElement
        for (let i = 0; i < 10 && parent; i++) {
          const text = parent.textContent || ''
          if (/\d{7}/.test(text) && /\d{2}\/\d{2}\/\d{4}/.test(text) && text.includes('R$')) {
            return text.replace(/\s+/g, ' ').trim()
          }
          parent = parent.parentElement
        }
        return ''
      })

      if (lineText) {
        const docMatch = lineText.match(/(\d{7})/)
        const dateMatch = lineText.match(/(\d{2}\/\d{2}\/\d{4})/)
        const valMatch = lineText.match(/R\$[:\s]*([\d.,]+)/)
        boletos.push({
          documento: docMatch ? docMatch[1] : '',
          vencimento: dateMatch ? dateMatch[1] : '',
          valor: valMatch ? `R$: ${valMatch[1]}` : '',
          situacao: sitText.toLowerCase(),
          element: el,
        })
        log.info(`  Boleto: Doc ${docMatch?.[1]} Venc ${dateMatch?.[1]} ${valMatch?.[1]} (${sitText})`)
      }
    }
    log.info(`  Boletos em aberto/vencido: ${boletos.length}`)

    if (boletos.length === 0) {
      resultado.status = 'Sem boletos em aberto'
      log.info(`  Sem boletos em aberto para ${nome}`)
      return resultado
    }

    resultado.valor       = boletos.map(b => b.valor).join(' + ')
    resultado.vencimento  = boletos[0].vencimento
    resultado.competencia = boletos[0].referencia?.match(/\d{2}\/\d{4}/)?.[0] || ''

    const nomeBase = nome.replace(/[^A-Z0-9\s]/gi,'').replace(/\s+/g,'_').toUpperCase()

    // 4-6. Para CADA boleto em aberto: expandir → baixar boleto → baixar fatura
    fs.mkdirSync(DOWNLOAD_DIR, {recursive:true})
    resultado.pdfs = []
    let algumDownload = false

    for (let b = 0; b < boletos.length; b++) {
      const bol = boletos[b]
      const compFile = bol.vencimento?.match(/\d{2}\/(\d{2})\/(\d{4})/)?.[0]?.replace(/\//g,'-') || `doc${b+1}`
      log.info(`  [${b+1}/${boletos.length}] Doc ${bol.documento} Venc ${bol.vencimento} ${bol.valor} (${bol.situacao})`)

      // 4a. Clica no "+" perto do documento para expandir detalhes
      const docNum = bol.documento
      // Encontra o texto do documento e clica no "+" mais próximo
      const docEl = page.locator(`:text-is("${docNum}")`)
      if (await docEl.count() > 0) {
        // O "+" está na mesma linha/container — sobe no DOM e clica
        await docEl.evaluate(node => {
          let parent = node.parentElement
          for (let i = 0; i < 10 && parent; i++) {
            // Procura ícone "+" (fa-plus, glyphicon-plus, svg, ou qualquer botão/link)
            const plus = parent.querySelector('[class*="plus"], [class*="expand"], [class*="more"], [class*="fa-plus"]')
            if (plus) { plus.click(); return }
            // Procura o último botão/link no container (geralmente o "+")
            const btns = parent.querySelectorAll('a, button, i, svg')
            const ultimo = btns[btns.length - 1]
            if (ultimo && parent.textContent.includes('Mais')) { ultimo.click(); return }
            parent = parent.parentElement
          }
        })
        log.info(`  "+" clicado para Doc ${docNum}`)
      }
      await page.waitForTimeout(5000)

      // 5a. Baixa boleto deste documento
      try {
        const btnBoleto = ctx.locator('button[title="Boleto"], button[onclick*="boleto"]').first()
        if (await btnBoleto.count() > 0) {
          const popupPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null)
          await btnBoleto.click()
          await page.waitForTimeout(5000)

          const popup = await popupPromise
          if (popup) {
            await popup.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
            const dest = path.join(DOWNLOAD_DIR, `Boleto_${nomeBase}_${compFile}.pdf`)
            const pdfBuffer = await popup.pdf().catch(() => null)
            if (pdfBuffer) {
              fs.writeFileSync(dest, pdfBuffer)
              resultado.pdfs.push(dest)
              algumDownload = true
              log.ok(`    ✓ Boleto ${bol.documento}`)
            }
            await popup.close().catch(() => {})
          }
        }
      } catch (e) { log.warn(`    Boleto ${bol.documento}: ${e.message}`) }

      // 6a. Baixa fatura deste documento
      try {
        const btnFatura = ctx.locator('button[title*="Fatura"], button[onclick*="fatura"]').first()
        if (await btnFatura.count() > 0) {
          const popupPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null)
          await btnFatura.click()
          await page.waitForTimeout(5000)

          const popup = await popupPromise
          if (popup) {
            await popup.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
            const dest = path.join(DOWNLOAD_DIR, `Fatura_${nomeBase}_${compFile}.pdf`)
            const pdfBuffer = await popup.pdf().catch(() => null)
            if (pdfBuffer) {
              fs.writeFileSync(dest, pdfBuffer)
              resultado.pdfs.push(dest)
              algumDownload = true
              log.ok(`    ✓ Fatura ${bol.documento}`)
            }
            await popup.close().catch(() => {})
          }
        }
      } catch (e) { log.warn(`    Fatura ${bol.documento}: ${e.message}`) }

      // Fecha a expansão clicando no "-" (mesmo botão toggle)
      if (await docEl.count() > 0) {
        await docEl.evaluate(node => {
          let parent = node.parentElement
          for (let i = 0; i < 10 && parent; i++) {
            const minus = parent.querySelector('[class*="minus"], [class*="collapse"], [class*="fa-minus"]')
            if (minus) { minus.click(); return }
            parent = parent.parentElement
          }
        })
      }
      await page.waitForTimeout(2000)
    }

    resultado.status = algumDownload ? 'OK' : 'Sem downloads'
    resultado.drive  = algumDownload

  } catch (e) {
    log.error(`Erro ao processar ${nome}: ${e.message}`)
    resultado.status   = 'Erro'
    resultado.erroMsg  = e.message
    await page.screenshot({ path: path.join(SCREENSHOTS, `erro_plano_hosp_${Date.now()}.png`) }).catch(()=>{})
  } finally {
    // SEMPRE fecha tudo antes do próximo cliente
    await context.close().catch(()=>{})
  }

  return resultado
}

// ── Handler principal ─────────────────────────────────────────────────────────

module.exports = async function routePlanoHospitalar(req, res) {
  // Body: { clientes: [{nome, login, senha, cnpj, vencimento}], diaVenc: 5|10|15|20|25|30 }
  const { clientes = [], diaVenc = '' } = req.body || {}

  if (!clientes.length) {
    return res.status(400).json({ erro:'Envie a lista de clientes no body: { clientes: [{nome, login, senha, cnpj, vencimento}], diaVenc }' })
  }

  const jobId = criarJob(clientes.length)
  log.info(`Job Plano Hospitalar — ${jobId} — ${clientes.length} cliente(s) — venc dia ${diaVenc}`)
  res.json({ ok:true, jobId, mensagem:`Processando ${clientes.length} cliente(s) do Plano Hospitalar (vencimento dia ${diaVenc}).` })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, 'plano_hospitalar')
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred('plano_hospitalar')
    PORTAL_URL   = _creds.url          || PORTAL_URL
    DRIVE_FOLDER = _creds.drive_folder || DRIVE_FOLDER
    const { browser } = await abrirBrowser()
    const todos = []

    try {
      for (let i=0; i<clientes.length; i++) {
        const resultado = await processarCliente(browser, clientes[i], diaVenc)
        todos.push(resultado)

        const jobAtual = JOBS.get(jobId)
        const resultadosFront = todos.map(r=>({
          nome:       r.nome,
          sub:        r.status === 'OK'
            ? `R$ ${r.valor} · Venc: ${r.vencimento} · Comp: ${r.competencia} · Drive ✓`
            : r.status === 'Sem boletos em aberto'
              ? 'Sem boletos em aberto'
              : `Erro: ${r.erroMsg||r.status}`,
          status:     r.status === 'OK' ? 'OK' : r.status === 'Sem boletos em aberto' ? 'AVISO' : 'FALHA',
          label:      r.status !== 'OK' && r.status !== 'Sem boletos em aberto' ? r.status : null,
          orientacao: r.status === 'Erro de login' ? 'Verifique as credenciais do cliente no SolusWeb.' : r.erroMsg ? 'Tente processar manualmente.' : null,
          erro:       r.erroMsg||null,
          tipo:       r.status === 'Erro de login' ? 'LOGIN_FALHOU' : r.erroMsg ? 'OUTRO' : null,
        }))
        atualizar(jobId, { progresso:i+1, resultados:resultadosFront })
        log.info(`[${i+1}/${clientes.length}] ${resultado.nome} → ${resultado.status}`)
      }
    } finally {
      await fecharBrowser(browser)
    }

    // Email resumo com todos os PDFs anexados
    const hoje       = new Date().toLocaleDateString('pt-BR')
    const nOk        = todos.filter(r=>r.status==='OK').length
    const nSemBol    = todos.filter(r=>r.status==='Sem boletos em aberto').length
    const nErro      = todos.filter(r=>r.status!=='OK'&&r.status!=='Sem boletos em aberto').length
    const totalValor = todos.filter(r=>r.status==='OK').reduce((a,r)=>a+(parseFloat((r.valor||'0').replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.'))||0),0)

    // Coleta todos os PDFs baixados para anexar
    const anexos = []
    for (const r of todos) {
      if (r.pdfs && r.pdfs.length > 0) {
        for (const f of r.pdfs) {
          if (fs.existsSync(f)) anexos.push(f)
        }
      }
    }

    const tabela = todos.map((r,i)=>
      `${i+1} | ${r.nome} | ${r.valor!=='-'?'R$ '+r.valor:'-'} | ${r.competencia||'-'} | ${r.vencimento||'-'} | ${r.status}`
    ).join('\n')

    const corpo = `Resumo Plano Hospitalar - Vencimento dia ${diaVenc} - ${hoje}\n\n# | Cliente | Valor | Competência | Vencimento | Status\n${tabela}\n\nTotal OK: ${nOk}\nSem boletos: ${nSemBol}\nErros: ${nErro}\nValor total: R$ ${totalValor.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n${anexos.length > 0 ? `\n${anexos.length} arquivo(s) PDF em anexo.` : ''}\n\nJob: ${jobId}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`

    await email.enviar({
      assunto: `Plano Hospitalar - Venc dia ${diaVenc} - ${hoje} - ${nOk} OK / ${clientes.length} clientes`,
      corpo,
      para: 'jacometo@jacometo.com.br,mayara@jacometo.com.br,barbara.saude@jacometo.com.br',
      anexo: anexos.length > 0 ? anexos : undefined,
    })

    // Limpa PDFs temporários após envio
    for (const f of anexos) { try { fs.unlinkSync(f) } catch {} }

    const resultadosFinal = JOBS.get(jobId)?.resultados || []
    atualizar(jobId, { status:'concluido' })
    await db.jobConcluido(jobId, 'plano_hospitalar', { resultados: resultadosFinal }, _inicio).catch(()=>{})
    log.ok(`Job ${jobId} concluído: ${nOk} OK · ${nSemBol} sem boletos · ${nErro} erro(s) · ${anexos.length} anexo(s).`)
  })
}
module.exports.getJobStatus = getJobStatus
