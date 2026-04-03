// src/jobs/yelum-inadimplentes.js
// Login auth-broker.yelumseguros.com.br → Gestão de Parcelas → Atrasadas → TODOS os estabelecimentos
// Estabelecimentos: Joinville 0003, Londrina 0001, Londrina 0002
require('dotenv').config()
const { getCred } = require('./config')
const db = require('../lib/database')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _cred_yelum = getCred('yelum')
let LOGIN_CPF = _cred_yelum.cpf || ''
let LOGIN_SENHA = _cred_yelum.senha || ''
let PORTAL_URL = _cred_yelum.portal_url || ''
const LOGIN_URL = _cred_yelum.url || 'https://auth-broker.yelumseguros.com.br/login'

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
function getJobStatus(req, res) {
  const job = JOBS.get(req.params.jobId)
  if (!job) return res.status(404).json({ erro:'Job não encontrado.' })
  res.json(job)
}





const ESTABELECIMENTOS = ['Joinville 0003', 'Londrina 0001', 'Londrina 0002']
const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')

async function ss(page, nome) {
  try { fs.mkdirSync(SCREENSHOTS,{recursive:true}); const p=path.join(SCREENSHOTS,nome); await page.screenshot({path:p}); return p } catch { return null }
}
function classErr(msg) {
  if (!msg) return { tipo:'DESCONHECIDO', label:'Erro desconhecido', orientacao:'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN')||u.includes('CPF')||u.includes('SENHA')) return { tipo:'LOGIN_FALHOU', label:'Login falhou no portal Yelum', orientacao:'Verifique CPF e senha em auth-broker.yelumseguros.com.br.' }
  if (u.includes('ESTABELECIMENTO')||u.includes('GESTAO')||u.includes('MENU')) return { tipo:'NAVEGACAO', label:'Erro ao navegar no Yelum', orientacao:'Verifique se os estabelecimentos estão ativos.' }
  if (u.includes('TIMEOUT')||u.includes('EXCEEDED')) return { tipo:'TIMEOUT', label:'Portal Yelum demorou para responder', orientacao:'Instabilidade. Cuidado ao exportar — pode causar logout.' }
  return { tipo:'OUTRO', label:msg.substring(0,80), orientacao:'Verifique o log e tente novamente.' }
}

module.exports = async function routeYelumInadimplentes(req, res) {
  const jobId = criarJob()
  log.info(`Job Yelum inadimplentes — ${jobId}`)
  res.json({ ok:true, jobId, mensagem:'Iniciando extração de inadimplentes da Yelum.' })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, 'yelum')
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred('yelum')
    LOGIN_CPF = _creds.cpf || LOGIN_CPF
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    PORTAL_URL = _creds.portal_url || PORTAL_URL
    LOGIN_URL = _creds.url || LOGIN_URL
    const { browser, page } = await abrirBrowser()
    try {
      // 1. Login OAuth2
      log.info('Acessando Yelum (OAuth2)...')
      await page.goto(LOGIN_URL, { waitUntil:'networkidle', timeout:45000 })
      await page.waitForTimeout(2500)
      await page.locator('input[name*="cpf"], input[name*="user"], input[placeholder*="CPF"], input[type="text"]').first().fill(LOGIN_CPF)
      await page.locator('input[type="password"]').first().fill(LOGIN_SENHA)
      await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login")').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso:1 })

      // 2. Navegar para Gestão de Parcelas
      log.info('Acessando Gestão de Parcelas...')
      await page.goto(PORTAL_URL, { waitUntil:'networkidle', timeout:30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso:2 })

      // 3. Filtros: Status=Atrasadas, Estabelecimentos=Todos, Período=90 dias
      log.info('Aplicando filtros...')

      // Status: Atrasadas
      const selStatus = page.locator('select[name*="status"], select[id*="status"], [class*="select"]:has-text("Status")').first()
      if (await selStatus.count()>0) await selStatus.selectOption({ label:/atrasad/i }).catch(()=>{})

      // Seleciona TODOS os estabelecimentos (checkboxes ou select múltiplo)
      // Tenta marcar todos via checkbox
      const checkboxes = await page.locator('input[type="checkbox"][name*="estabelec"], input[type="checkbox"][id*="estabelec"]').all()
      for (const cb of checkboxes) { if (!await cb.isChecked()) await cb.check().catch(()=>{}) }

      // Ou via select múltiplo
      const selEstab = page.locator('select[name*="estabelec"], select[id*="estabelec"]').first()
      if (await selEstab.count()>0) {
        const opts = await selEstab.locator('option').all()
        const vals = await Promise.all(opts.map(o=>o.getAttribute('value')))
        await selEstab.selectOption(vals.filter(Boolean))
      }

      // Período: últimos 90 dias
      const selPeriodo = page.locator('select[name*="period"], select[id*="period"]').first()
      if (await selPeriodo.count()>0) await selPeriodo.selectOption({ label:/90/i }).catch(()=>{})

      await page.locator('button:has-text("Buscar"), button:has-text("Pesquisar"), button[type="submit"]').first().click()
      await page.waitForLoadState('networkidle', { timeout:30000 })
      await page.waitForTimeout(3000)
      atualizar(jobId, { progresso:3 })

      // 4. Extrai dados — NÃO exportar CSV pois pode causar logout
      log.info('Extraindo dados da tabela...')
      const parcelas = []
      let pagina = 1
      while (true) {
        const linhas = await page.locator('table tbody tr, [class*="row"]:not([class*="header"])').all()
        for (const linha of linhas) {
          const cols = await linha.locator('td').all()
          if (cols.length<4) continue
          const v = await Promise.all(cols.map(c=>c.textContent().then(t=>t?.trim()||'')))
          // Colunas Yelum: Cliente | CPF/CNPJ | Produto/Ramo | Apólice | Parcela | Venc Original | Venc Atual | Valor | Forma Pgto | Status
          if (v[0]&&v[3]) parcelas.push({
            cliente:v[0], cpf_cnpj:v[1]||'', produto:v[2]||'', apolice:v[3]||'',
            parcela:v[4]||'', venc_original:v[5]||'', venc_atual:v[6]||'',
            valor:v[7]||'', forma_pgto:v[8]||'', status:v[9]||'Atrasada',
          })
        }
        const next = page.locator('a:has-text("Próxima"), [aria-label="Next"], .pagination-next').first()
        if (await next.count()===0||!await next.isEnabled().catch(()=>false)) break
        await next.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(2000)
        if (++pagina>50) break
      }
      log.ok(`${parcelas.length} parcela(s) extraída(s) — NÃO exportando para evitar logout.`)

      // Gera CSV manual (sem exportar do portal)
      let csvPath = null
      if (parcelas.length>0) {
        fs.mkdirSync(DOWNLOAD_DIR,{recursive:true})
        const dest = path.join(DOWNLOAD_DIR,`YELUM_INADIMPLENTES_${new Date().toISOString().substring(0,10).replace(/-/g,'_')}.csv`)
        fs.writeFileSync(dest, ['cliente;cpf_cnpj;produto;apolice;parcela;venc_original;venc_atual;valor;forma_pgto;status', ...parcelas.map(p=>[p.cliente,p.cpf_cnpj,p.produto,p.apolice,p.parcela,p.venc_original,p.venc_atual,p.valor,p.forma_pgto,p.status].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(';'))].join('\n'))
        csvPath = dest
      }
      atualizar(jobId, { progresso:4 })

      const resultados = parcelas.length===0
        ? [{ nome:'Nenhuma parcela em atraso encontrada', sub:`Estabelecimentos: ${ESTABELECIMENTOS.join(', ')}`, status:'OK', label:null, orientacao:null, erro:null, tipo:null }]
        : parcelas.map(p=>({ nome:p.cliente, sub:`${p.produto} · Apólice ${p.apolice} | Parc ${p.parcela} | R$ ${p.valor} | Venc: ${p.venc_atual} (orig: ${p.venc_original})`, status:'OK', label:null, orientacao:null, erro:null, tipo:null }))

      atualizar(jobId, { status:'concluido', progresso:5, resultados })
      await db.jobConcluido(jobId, 'yelum', { resultados, csvPath: csvPath || null }, _inicio)

      const hoje = new Date().toLocaleDateString('pt-BR')
      const total = parcelas.reduce((a,p)=>a+(parseFloat((p.valor||'0').replace(/\./g,'').replace(',','.'))||0),0)
      const estabs = [...new Set(parcelas.map(p=>p.produto||''))].filter(Boolean).join(', ') || ESTABELECIMENTOS.join(', ')

      await email.enviar({
        assunto: parcelas.length===0 ? `Yelum — Sem inadimplentes em ${hoje}` : `Yelum — Parcelas Atrasadas — ${parcelas.length} parcela(s) — ${hoje}`,
        corpo: `RELATÓRIO DE PARCELAS ATRASADAS - YELUM SEGUROS\nData: ${hoje}\nEstabelecimentos: ${ESTABELECIMENTOS.join(', ')}\nJob: ${jobId}\n\nResumo:\n- Total de parcelas atrasadas: ${parcelas.length}\n- Valor total em atraso: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\n${parcelas.map((p,i)=>`${i+1}. ${p.cliente} (${p.cpf_cnpj})\n   ${p.produto} | Apólice ${p.apolice} | Parcela ${p.parcela}\n   R$ ${p.valor} | Venc Original: ${p.venc_original} | Venc Atual: ${p.venc_atual} | ${p.forma_pgto}`).join('\n\n')}\n\nAtenciosamente,\nSistema Ferramentas Jacometo`,
        anexo: csvPath||undefined,
      })
      log.ok(`Job ${jobId} concluído: ${parcelas.length} parcela(s).`)

    } catch (e) {
      log.error(`Erro crítico [${jobId}]: ${e.message}`)
      const s = await ss(page,`erro_yelum_${Date.now()}.png`)
      const cl = classErr(e.message)
      atualizar(jobId, { status:'erro_critico', erro:e.message, resultados:[{ nome:'Yelum — Extração falhou', sub:cl.label, status:'FALHA', label:cl.label, orientacao:cl.orientacao, erro:e.message, tipo:cl.tipo, screenshotPath:s }] })
      await db.jobErro(jobId, 'yelum', e.message, _inicio)
      await email.enviar({ assunto:'❌ Yelum inadimplentes — Erro', corpo:`Job: ${jobId}\nErro: ${e.message}\nAção: ${cl.orientacao}` })
    } finally { await fecharBrowser(browser) }
  })
}
module.exports.getJobStatus = getJobStatus
