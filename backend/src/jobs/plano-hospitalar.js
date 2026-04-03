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
module.exports.getJobStatus = (req, res) => {
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
    await page.waitForTimeout(2000)
    await page.locator('input[name*="login"], input[id*="login"], input[type="text"]').first().fill(login)
    await page.locator('input[type="password"]').first().fill(senha)
    await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login")').first().click()
    await page.waitForLoadState('networkidle', { timeout:30000 })
    await page.waitForTimeout(2500)

    // Verifica login
    const loginErr = await page.locator('.error, .alert-danger, [class*="error"]').count()
    if (loginErr>0 || page.url().includes('login')) {
      resultado.status = 'Erro de login'
      resultado.erroMsg = 'Login rejeitado — verifique as credenciais.'
      return resultado
    }

    // 2. Boletos → Relação boletos
    await page.locator('a:has-text("Boletos"), button:has-text("Boletos")').first().click()
    await page.waitForTimeout(1000)
    await page.locator('a:has-text("Relação boletos"), a:has-text("Relação de Boletos"), a:has-text("Relação")').first().click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2500)

    // 3. Identifica boletos "Em aberto"
    const linhas = await page.locator('table tbody tr, [class*="row"]:not([class*="header"])').all()
    let boletoAberto = null

    for (const linha of linhas) {
      const texto = await linha.textContent().catch(()=>'')
      if (/em\s*aberto/i.test(texto)) {
        const cols = await linha.locator('td').all()
        const v = await Promise.all(cols.map(c=>c.textContent().then(t=>t?.trim()||'')))
        boletoAberto = {
          documento:   v[0]||'',
          vencimento:  v[1]||'',
          referencia:  v[2]||'',
          valor:       v[3]||'',
          competencia: v[2]?.match(/\d{2}\/\d{4}/)?.[0] || '',
          linha,
        }
        break
      }
    }

    if (!boletoAberto) {
      resultado.status = 'Sem boletos em aberto'
      return resultado
    }

    resultado.valor       = boletoAberto.valor
    resultado.vencimento  = boletoAberto.vencimento
    resultado.competencia = boletoAberto.competencia

    // Formata competência para nome de arquivo
    const compFile = boletoAberto.competencia.replace('/','-') || new Date().toLocaleDateString('pt-BR',{month:'2-digit',year:'numeric'}).replace('/','-')
    const nomeBase = nome.replace(/[^A-Z0-9\s]/gi,'').replace(/\s+/g,'_').toUpperCase()

    // 4. Expande boleto (botão "Mais..." ou ícone)
    const btnMais = boletoAberto.linha.locator('button:has-text("Mais"), a:has-text("Mais"), [class*="expand"], [class*="detalhe"]').first()
    if (await btnMais.count()>0) { await btnMais.click(); await page.waitForTimeout(1500) }

    fs.mkdirSync(DOWNLOAD_DIR, {recursive:true})

    // 5. Baixa boleto (ícone impressora — Boleto/Cartão)
    let boleto_ok = false
    try {
      const btnBoleto = page.locator('[class*="boleto"] [title*="imprimir"], [class*="boleto"] [title*="PDF"], [class*="Boleto"] button, [class*="boleto"] a').first()
      if (await btnBoleto.count()>0) {
        const [dl] = await Promise.all([page.waitForEvent('download',{timeout:15000}), btnBoleto.click()])
        const dest = path.join(DOWNLOAD_DIR,`Boleto_${nomeBase}_${compFile}.pdf`)
        await dl.saveAs(dest)
        boleto_ok = await uploadDrive(dest, `Boleto_${nomeBase}_${compFile}.pdf`)
        try { fs.unlinkSync(dest) } catch {}
      }
    } catch (e) { log.warn(`Boleto de ${nome}: ${e.message}`) }

    // 6. Baixa fatura PDF e Excel
    let fatura_ok = false
    try {
      // Fatura PDF
      const btnFaturaPDF = page.locator('[class*="fatura"] [title*="PDF"], [class*="Fatura"] [title*="PDF"], [class*="fatura"] a[href*=".pdf"]').first()
      if (await btnFaturaPDF.count()>0) {
        const [dl] = await Promise.all([page.waitForEvent('download',{timeout:15000}), btnFaturaPDF.click()])
        // Pode abrir nova aba
        const novaAba = await Promise.race([
          page.waitForEvent('popup',{timeout:3000}).catch(()=>null),
          Promise.resolve(null),
        ])
        const pag = novaAba || page
        const dest = path.join(DOWNLOAD_DIR,`Fatura_${nomeBase}_${compFile}.pdf`)
        await dl.saveAs(dest)
        await uploadDrive(dest,`Fatura_${nomeBase}_${compFile}.pdf`)
        if (novaAba) await novaAba.close().catch(()=>{})
        try { fs.unlinkSync(dest) } catch {}
        fatura_ok = true
      }

      // Fatura Excel
      const btnFaturaXLS = page.locator('[class*="fatura"] [title*="Excel"], [class*="Fatura"] [title*="Excel"], [class*="fatura"] a[href*=".xlsx"]').first()
      if (await btnFaturaXLS.count()>0) {
        const [dl] = await Promise.all([page.waitForEvent('download',{timeout:15000}), btnFaturaXLS.click()])
        const dest = path.join(DOWNLOAD_DIR,`Fatura_${nomeBase}_${compFile}.xlsx`)
        await dl.saveAs(dest)
        await uploadDrive(dest,`Fatura_${nomeBase}_${compFile}.xlsx`)
        try { fs.unlinkSync(dest) } catch {}
        fatura_ok = true
      }
    } catch (e) { log.warn(`Fatura de ${nome}: ${e.message}`) }

    resultado.status = 'OK - Drive'
    resultado.drive  = true

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
      para: `mayara@jacometo.com.br`,
      cc:   `adriano@jacometo.com.br`,
    })

    atualizar(jobId, { status:'concluido' })
      await db.jobConcluido(jobId, 'plano_hospitalar', { resultados, csvPath: csvPath || null }, _inicio)
    log.ok(`Job ${jobId} concluído: ${nOk} OK · ${nSemBol} sem boletos · ${nErro} erro(s).`)
  })
}
