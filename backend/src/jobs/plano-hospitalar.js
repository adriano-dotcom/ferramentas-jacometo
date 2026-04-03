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
    await page.waitForTimeout(3000)

    // 2. Navega para Boletos via URL (o menu dropdown nem sempre funciona)
    // Extrai o idSessao da URL atual para manter a sessão
    const urlAtual = page.url()
    const sessaoMatch = urlAtual.match(/idSessao=([a-f0-9]+)/)
    const idSessao = sessaoMatch ? sessaoMatch[1] : ''

    // Tenta clicar no menu primeiro
    try {
      await page.locator('text=Boletos').first().click()
      await page.waitForTimeout(2000)
      await page.locator('text=Relação boletos').first().click({ timeout: 3000 })
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(5000)
    } catch {
      // Fallback: navega direto pela URL
      const baseUrl = PORTAL_URL.replace(/\/empresa.*/, '/empresa')
      const boletosUrl = `${baseUrl}/mensalidades/pagamentos/boletos${idSessao ? '?idSessao=' + idSessao : ''}`
      log.info(`  Menu falhou, navegando direto: ${boletosUrl}`)
      await page.goto(boletosUrl, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(5000)
    }

    log.info(`  Tela de boletos: ${page.url()}`)

    // 3. Verifica se tem "Em aberto" na página
    const temAberto = await page.locator('text=Em aberto').first().count()
    log.info(`  "Em aberto" encontrado: ${temAberto > 0 ? 'SIM' : 'NÃO'}`)

    if (temAberto === 0) {
      resultado.status = 'Sem boletos em aberto'
      log.info(`  Sem boletos em aberto para ${nome}`)
      return resultado
    }

    // Extrai dados visíveis
    const textoPage = await page.locator('body').textContent().catch(() => '')
    const matchVal = textoPage.match(/R\$[:\s]*([\d.,]+)/)
    const matchComp = textoPage.match(/Competência[:\s]*(\d{2}\/\d{4})/) || textoPage.match(/(\d{2}\/\d{4})/)
    const matchVenc = textoPage.match(/(\d{2}\/\d{2}\/\d{4})/)

    resultado.valor       = matchVal ? `R$ ${matchVal[1]}` : '-'
    resultado.vencimento  = matchVenc ? matchVenc[1] : '-'
    resultado.competencia = matchComp ? matchComp[1] : ''

    const compFile = resultado.competencia.replace('/','-') || new Date().toLocaleDateString('pt-BR',{month:'2-digit',year:'numeric'}).replace('/','-')
    const nomeBase = nome.replace(/[^A-Z0-9\s]/gi,'').replace(/\s+/g,'_').toUpperCase()
    log.info(`  Boleto: Venc ${resultado.vencimento} ${resultado.valor}`)

    // 4. Clica no ícone "+" (Mais...) da linha "Em aberto" para expandir
    // Usa evaluate para encontrar a linha correta no DOM
    const clicouMais = await page.evaluate(() => {
      // Encontra todas as linhas/rows que contêm "Em aberto"
      const tds = document.querySelectorAll('td, div')
      for (const td of tds) {
        if (td.textContent.trim() === 'Em aberto') {
          // Encontrou a célula "Em aberto", agora pega o "+" na mesma linha
          const row = td.closest('tr') || td.parentElement
          if (row) {
            // Procura o ícone "+" ou link "Mais" na linha
            const plus = row.querySelector('a[class*="plus"], [class*="plus"], svg, a:last-child, td:last-child a, td:last-child button')
            if (plus) { plus.click(); return 'clicked_row' }
            // Fallback: clica no último <a> ou <td> da linha
            const lastLink = row.querySelector('td:last-child')
            if (lastLink) { lastLink.click(); return 'clicked_last_td' }
          }
        }
      }
      return null
    })
    log.info(`  Expandir "Mais...": ${clicouMais || 'NÃO encontrado'}`)
    await page.waitForTimeout(5000)

    fs.mkdirSync(DOWNLOAD_DIR, {recursive:true})

    // 5. Baixa boleto — ícone impressora ao lado de "Boleto/Cartão:"
    let boleto_ok = false
    try {
      await page.waitForTimeout(2000)
      const temBoleto = await page.locator('text=Boleto/Cartão').count() + await page.locator('text=Boleto/Cart').count()
      log.info(`  Seção Boleto/Cartão: ${temBoleto > 0 ? 'SIM' : 'NÃO'}`)

      if (temBoleto > 0) {
        // Mapeia TODOS os links da página para debug
        const allLinks = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href]')
          return Array.from(links).map(a => ({ href: a.href, text: a.textContent.trim().substring(0,30), title: a.title || '' }))
        })
        const boletoLinks = allLinks.filter(l => l.href.includes('boleto') || l.href.includes('Boleto') || l.href.includes('imprimir') || l.href.includes('print') || l.title.includes('oleto'))
        log.info(`  Links boleto encontrados: ${boletoLinks.length}`)
        boletoLinks.forEach(l => log.info(`    → ${l.href.substring(0,80)} [${l.title}]`))

        // Clica no primeiro ícone/link perto de "Boleto/Cartão:"
        // Usa Playwright locator relativo
        const boletoClickResult = await page.evaluate(() => {
          // Busca qualquer elemento que contenha "Boleto/Cart" como texto direto (não filho)
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            const node = walker.currentNode
            if (node.textContent.includes('Boleto/Cart')) {
              // Encontrou! Agora pega os links <a> próximos
              const container = node.parentElement?.parentElement || node.parentElement
              if (container) {
                const links = container.querySelectorAll('a')
                for (const link of links) {
                  if (link.href && !link.textContent.includes('Boleto/Cart')) {
                    link.click()
                    return { clicked: true, href: link.href }
                  }
                }
              }
            }
          }
          return { clicked: false }
        })
        log.info(`  Clique boleto: ${JSON.stringify(boletoClickResult)}`)

        if (boletoClickResult.clicked) {
          await page.waitForTimeout(5000)
          // Verifica se abriu nova aba com o PDF
          const pages = context.pages()
          if (pages.length > 1) {
            const novaAba = pages[pages.length - 1]
            await novaAba.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
            const novaUrl = novaAba.url()
            log.info(`  Nova aba: ${novaUrl.substring(0,80)}`)

            // Se é PDF, tenta download
            if (novaUrl.includes('.pdf') || novaUrl.includes('boleto') || novaUrl.includes('print')) {
              const dest = path.join(DOWNLOAD_DIR, `Boleto_${nomeBase}_${compFile}.pdf`)
              // Tenta salvar como PDF via print
              const pdfBuffer = await novaAba.pdf().catch(() => null)
              if (pdfBuffer) {
                fs.writeFileSync(dest, pdfBuffer)
                boleto_ok = await uploadDrive(dest, `Boleto_${nomeBase}_${compFile}.pdf`)
                try { fs.unlinkSync(dest) } catch {}
                log.ok(`  ✓ Boleto salvo como PDF: ${nome}`)
              }
            }
            await novaAba.close().catch(() => {})
          }

          // Verifica download direto
          const dl = await page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
          if (dl) {
            const dest = path.join(DOWNLOAD_DIR, `Boleto_${nomeBase}_${compFile}.pdf`)
            await dl.saveAs(dest)
            boleto_ok = await uploadDrive(dest, `Boleto_${nomeBase}_${compFile}.pdf`)
            try { fs.unlinkSync(dest) } catch {}
            log.ok(`  ✓ Boleto baixado: ${nome}`)
          }
        }
      }
    } catch (e) { log.warn(`  Boleto de ${nome}: ${e.message}`) }

    // 6. Baixa fatura PDF
    let fatura_ok = false
    try {
      const temFatura = await page.locator('text=Fatura:').count()
      log.info(`  Seção Fatura: ${temFatura > 0 ? 'SIM' : 'NÃO'}`)

      if (temFatura > 0) {
        const faturaClickResult = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            const node = walker.currentNode
            if (node.textContent.trim() === 'Fatura:') {
              const container = node.parentElement?.parentElement || node.parentElement
              if (container) {
                const links = container.querySelectorAll('a')
                for (const link of links) {
                  if (link.href && !link.textContent.includes('Fatura')) {
                    link.click()
                    return { clicked: true, href: link.href }
                  }
                }
              }
            }
          }
          return { clicked: false }
        })
        log.info(`  Clique fatura: ${JSON.stringify(faturaClickResult)}`)

        if (faturaClickResult.clicked) {
          await page.waitForTimeout(5000)
          const pages = context.pages()
          if (pages.length > 1) {
            const novaAba = pages[pages.length - 1]
            await novaAba.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
            const dest = path.join(DOWNLOAD_DIR, `Fatura_${nomeBase}_${compFile}.pdf`)
            const pdfBuffer = await novaAba.pdf().catch(() => null)
            if (pdfBuffer) {
              fs.writeFileSync(dest, pdfBuffer)
              await uploadDrive(dest, `Fatura_${nomeBase}_${compFile}.pdf`)
              try { fs.unlinkSync(dest) } catch {}
              fatura_ok = true
              log.ok(`  ✓ Fatura salva: ${nome}`)
            }
            await novaAba.close().catch(() => {})
          }

          const dl = await page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
          if (dl) {
            const dest = path.join(DOWNLOAD_DIR, `Fatura_${nomeBase}_${compFile}.pdf`)
            await dl.saveAs(dest)
            await uploadDrive(dest, `Fatura_${nomeBase}_${compFile}.pdf`)
            try { fs.unlinkSync(dest) } catch {}
            fatura_ok = true
            log.ok(`  ✓ Fatura baixada: ${nome}`)
          }
        }
      }
    } catch (e) { log.warn(`  Fatura de ${nome}: ${e.message}`) }

    resultado.status = boleto_ok || fatura_ok ? 'OK - Drive' : 'Sem downloads'
    resultado.drive  = boleto_ok || fatura_ok

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
          sub:        r.status === 'OK - Drive'
            ? `R$ ${r.valor} · Venc: ${r.vencimento} · Comp: ${r.competencia} · Drive ✓`
            : r.status === 'Sem boletos em aberto'
              ? 'Sem boletos em aberto'
              : `Erro: ${r.erroMsg||r.status}`,
          status:     r.status === 'OK - Drive' ? 'OK' : r.status === 'Sem boletos em aberto' ? 'AVISO' : 'FALHA',
          label:      r.status !== 'OK - Drive' && r.status !== 'Sem boletos em aberto' ? r.status : null,
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

    // Email resumo consolidado
    const hoje       = new Date().toLocaleDateString('pt-BR')
    const nOk        = todos.filter(r=>r.status==='OK - Drive').length
    const nSemBol    = todos.filter(r=>r.status==='Sem boletos em aberto').length
    const nErro      = todos.filter(r=>r.status!=='OK - Drive'&&r.status!=='Sem boletos em aberto').length
    const totalValor = todos.filter(r=>r.status==='OK - Drive').reduce((a,r)=>a+(parseFloat((r.valor||'0').replace(/\./g,'').replace(',','.'))||0),0)

    const tabela = todos.map((r,i)=>
      `${i+1} | ${r.nome} | ${r.valor!=='-'?'R$ '+r.valor:'-'} | ${r.competencia||'-'} | ${r.vencimento||'-'} | ${r.status}`
    ).join('\n')

    const corpo = `Resumo Plano Hospitalar - Vencimento dia ${diaVenc} - ${hoje}\n\nArquivos salvos no Google Drive:\nhttps://drive.google.com/drive/folders/${DRIVE_FOLDER}\n\n# | Cliente | Valor | Competência | Vencimento | Status\n${tabela}\n\nTotal salvos no Drive: ${nOk}\nSem boletos: ${nSemBol}\nErros: ${nErro}\nValor total processado: R$ ${totalValor.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\nJob: ${jobId}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`

    await email.enviar({
      assunto: `Resumo - Plano Hospitalar - Vencimento dia ${diaVenc} - ${hoje} - ${clientes.length} clientes processados`,
      corpo,
      para: process.env.EMAIL_EQUIPE || 'jacometo@jacometo.com.br',
    })

    atualizar(jobId, { status:'concluido' })
      await db.jobConcluido(jobId, 'plano_hospitalar', { resultados, csvPath: csvPath || null }, _inicio)
    log.ok(`Job ${jobId} concluído: ${nOk} OK · ${nSemBol} sem boletos · ${nErro} erro(s).`)
  })
}
module.exports.getJobStatus = getJobStatus
