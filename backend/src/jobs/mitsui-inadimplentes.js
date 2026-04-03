// src/jobs/mitsui-inadimplentes.js
// Login www4.msig.com.br/kitonline → FINANCEIRO → Parcelas e 2ª Via de Boleto → aba Pendentes
// Período: Vencimento de 01/01/ano_corrente até hoje
require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_mitsui = getCred('mitsui')
let LOGIN_USER = _cred_mitsui.usuario || ''
let LOGIN_SENHA = _cred_mitsui.senha || ''
let PORTAL_URL = getCred('mitsui').url || ''

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const log    = require('../lib/logger')
const email  = require('../lib/email')
const { abrirBrowser, fecharBrowser } = require('../lib/browser')

const JOBS = new Map()
function criarJob() {
  const id = crypto.randomUUID()
  JOBS.set(id, { id, status:'executando', progresso:0, total:5, resultados:[], erro:null, criadoEm:Date.now() })
  for (const [k,v] of JOBS) { if (Date.now()-v.criadoEm>7200000) JOBS.delete(k) }
  return id
}
function atualizar(id, dados) { const j=JOBS.get(id); if(j) JOBS.set(id,{...j,...dados}) }
module.exports.getJobStatus = (req, res) => {
  const job = JOBS.get(req.params.jobId)
  if (!job) return res.status(404).json({ erro:'Job não encontrado.' })
  res.json(job)
}




const COD_CORRETOR  = '0104339'
const DOWNLOAD_DIR  = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS   = path.resolve('./downloads/screenshots')

async function ss(page, nome) {
  try { fs.mkdirSync(SCREENSHOTS,{recursive:true}); const p=path.join(SCREENSHOTS,nome); await page.screenshot({path:p}); return p } catch { return null }
}
function classErr(msg) {
  if (!msg) return { tipo:'DESCONHECIDO', label:'Erro desconhecido', orientacao:'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN')||u.includes('USUARIO')||u.includes('SENHA')) return { tipo:'LOGIN_FALHOU', label:'Login falhou no portal Mitsui', orientacao:'Verifique usuário e senha em www4.msig.com.br/kitonline/.' }
  if (u.includes('FINANCEIRO')||u.includes('PARCELA')||u.includes('ABA')) return { tipo:'NAVEGACAO', label:'Erro ao navegar no portal Mitsui', orientacao:'Caminho: FINANCEIRO → Parcelas e 2ª Via de Boleto → aba Pendentes.' }
  if (u.includes('TIMEOUT')||u.includes('EXCEEDED')) return { tipo:'TIMEOUT', label:'Portal Mitsui demorou para responder', orientacao:'Portal antigo pode ser lento. Tente novamente.' }
  return { tipo:'OUTRO', label:msg.substring(0,80), orientacao:'Verifique o log e tente novamente.' }
}

module.exports = async function routeMitsuiInadimplentes(req, res) {
  const jobId = criarJob()
  log.info(`Job Mitsui inadimplentes — ${jobId}`)
  res.json({ ok:true, jobId, mensagem:'Iniciando extração de inadimplentes da Mitsui (MSIG).' })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, 'mitsui')
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred('mitsui')
    PORTAL_URL = _creds.url || PORTAL_URL
    LOGIN_USER = _creds.usuario || LOGIN_USER
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    const { browser, page } = await abrirBrowser()
    try {
      // 1. Login
      log.info('Acessando Mitsui Kit Online...')
      await page.goto(PORTAL_URL, { waitUntil:'networkidle', timeout:45000 })
      await page.waitForTimeout(2000)
      await page.locator('input[name*="user"], input[id*="user"], input[type="text"]').first().fill(LOGIN_USER)
      await page.locator('input[type="password"]').first().fill(LOGIN_SENHA)
      await page.locator('button[type="submit"], input[type="submit"], button:has-text("Entrar")').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(2500)
      atualizar(jobId, { progresso:1 })

      // 2. FINANCEIRO → Parcelas e 2ª Via de Boleto
      log.info('Navegando para Parcelas e 2ª Via de Boleto...')
      await page.locator('a:has-text("FINANCEIRO"), li:has-text("FINANCEIRO") > a').first().click()
      await page.waitForTimeout(1500)
      await page.locator('a:has-text("Parcelas e 2ª Via"), a:has-text("Parcelas"), a:has-text("2ª Via de Boleto")').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(2000)
      atualizar(jobId, { progresso:2 })

      // 3. Preenche filtros e pesquisa
      log.info('Aplicando filtros: Corretor=0104339, Produto=Todos, Período=Vencimento...')
      const hoje = new Date()
      const anoCorrente = hoje.getFullYear()
      const dataInicio = `01/01/${anoCorrente}`
      const dataFim    = `${String(hoje.getDate()).padStart(2,'0')}/${String(hoje.getMonth()+1).padStart(2,'0')}/${anoCorrente}`

      // Corretor (pode já vir preenchido)
      const fCorretor = page.locator('input[name*="corretor"], input[id*="corretor"]').first()
      if (await fCorretor.count()>0 && !await fCorretor.inputValue()) await fCorretor.fill(COD_CORRETOR)

      // Produto: Todos
      const selProd = page.locator('select[name*="produto"], select[id*="produto"]').first()
      if (await selProd.count()>0) await selProd.selectOption({ label:/todos/i }).catch(()=>{})

      // Tipo período: Vencimento
      const selTipo = page.locator('select[name*="tipo"], select[id*="tipo"]').first()
      if (await selTipo.count()>0) await selTipo.selectOption({ label:/vencimento/i }).catch(()=>{})

      // Datas
      const fIni = page.locator('input[name*="dtini"], input[name*="inicio"], input[id*="dtini"]').first()
      const fFim = page.locator('input[name*="dtfim"], input[name*="fim"], input[id*="dtfim"]').first()
      if (await fIni.count()>0) await fIni.fill(dataInicio)
      if (await fFim.count()>0) await fFim.fill(dataFim)

      // Pesquisar (botão lupa ou submit)
      await page.locator('button:has-text("Pesquisar"), input[type="image"][title*="pesquis"], button[type="submit"]').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)

      // 4. Clica na aba Pendentes
      log.info('Selecionando aba Pendentes...')
      await page.locator('a:has-text("Pendentes"), button:has-text("Pendentes"), [class*="tab"]:has-text("Pendentes")').first().click()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)
      atualizar(jobId, { progresso:3 })

      // 5. Extrai dados
      log.info('Extraindo dados da aba Pendentes...')
      const parcelas = []
      let pagina = 1
      while (true) {
        const linhas = await page.locator('table tbody tr').all()
        for (const linha of linhas) {
          const cols = await linha.locator('td').all()
          if (cols.length<5) continue
          const v = await Promise.all(cols.map(c=>c.textContent().then(t=>t?.trim()||'')))
          // Segurado | Corretor | Apólice | Endosso | Renovação Fácil | Parcela | Vencto | Valor
          const nome = v[0]; if (!nome||nome.length<2) continue
          parcelas.push({ segurado:v[0], corretor:v[1]||COD_CORRETOR, apolice:v[2]||'', endosso:v[3]||'', renovacao_facil:v[4]||'', parcela:v[5]||'', vencimento:v[6]||'', valor:v[7]||'' })
        }
        const next = page.locator('a:has-text("Próxima"), [title="Próxima"], img[title*="roxim"]').first()
        if (await next.count()===0||!await next.isEnabled().catch(()=>false)) break
        await next.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(2000)
        if (++pagina>50) break
      }
      log.ok(`${parcelas.length} parcela(s) pendente(s) extraída(s).`)

      // CSV
      let csvPath = null
      if (parcelas.length>0) {
        fs.mkdirSync(DOWNLOAD_DIR,{recursive:true})
        const dest = path.join(DOWNLOAD_DIR,`MITSUI_INADIMPLENTES_${new Date().toISOString().substring(0,10).replace(/-/g,'_')}.csv`)
        fs.writeFileSync(dest, ['segurado;corretor;apolice;endosso;renovacao_facil;parcela;vencimento;valor', ...parcelas.map(p=>[p.segurado,p.corretor,p.apolice,p.endosso,p.renovacao_facil,p.parcela,p.vencimento,p.valor].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(';'))].join('\n'))
        csvPath = dest
      }
      atualizar(jobId, { progresso:4 })

      const resultados = parcelas.length===0
        ? [{ nome:'Nenhuma parcela pendente encontrada', sub:`Corretor: ${COD_CORRETOR} · Período: ${dataInicio} a ${dataFim}`, status:'OK', label:null, orientacao:null, erro:null, tipo:null }]
        : parcelas.map(p=>({ nome:p.segurado, sub:`Apólice ${p.apolice} | End ${p.endosso} | Parcela ${p.parcela} | R$ ${p.valor} | Venc: ${p.vencimento}${p.renovacao_facil==='Sim'?' · Renovação Fácil':''}`, status:'OK', label:null, orientacao:null, erro:null, tipo:null }))

      atualizar(jobId, { status:'concluido', progresso:5, resultados })
      await db.jobConcluido(jobId, 'mitsui', { resultados, csvPath: csvPath || null }, _inicio)

      const hoje2 = new Date().toLocaleDateString('pt-BR')
      const total = parcelas.reduce((a,p)=>a+(parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.'))||0),0)
      await email.enviar({
        assunto: parcelas.length===0 ? `Mitsui — Sem inadimplentes em ${hoje2}` : `Mitsui (MSIG) — Parcelas Pendentes — ${parcelas.length} parcela(s) — ${hoje2}`,
        corpo: `RELATÓRIO DE PARCELAS PENDENTES - MITSUI (MSIG)\nData: ${hoje2}\nCorretor: ${COD_CORRETOR} - JACOMETO CORRETORA DE SEGUROS LTDA\nJob: ${jobId}\n\nTotal: ${parcelas.length} parcela(s)\nValor total pendente: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\n${parcelas.map((p,i)=>`${i+1}. ${p.segurado}\n   Apólice: ${p.apolice} | Endosso: ${p.endosso}\n   Parcela ${p.parcela} - R$ ${p.valor} - Venc: ${p.vencimento} - Renovação Fácil: ${p.renovacao_facil||'N/A'}`).join('\n\n')}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`,
        anexo: csvPath||undefined,
      })
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const s = await ss(page,`erro_mitsui_${Date.now()}.png`)
      const cl = classErr(e.message)
      atualizar(jobId, { status:'erro_critico', erro:e.message, resultados:[{ nome:'Mitsui — Extração falhou', sub:cl.label, status:'FALHA', label:cl.label, orientacao:cl.orientacao, erro:e.message, tipo:cl.tipo, screenshotPath:s }] })
      await db.jobErro(jobId, 'mitsui', e.message, _inicio)
      await email.enviar({ assunto:'❌ Mitsui inadimplentes — Erro', corpo:`Job: ${jobId}\nErro: ${e.message}\nAção: ${cl.orientacao}` })
    } finally { await fecharBrowser(browser) }
  })
}
