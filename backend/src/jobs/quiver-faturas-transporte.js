// src/jobs/quiver-faturas-transporte.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), override: true })
const { getCred } = require('./config')
const db = require('../lib/database')
const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const log    = require('../lib/logger')
const email  = require('../lib/email')
const { abrirBrowser, fecharBrowser } = require('../lib/browser')

// ── Credenciais (lidas do painel de configurações) ──────────────────────────────
const _credQuiver  = getCred('quiver')
let QUIVER_URL = _credQuiver.url   || 'https://jacometo.corretor-online.com.br/fastBoot/menuFast.Aspx'
let _qCorretor = _credQuiver.corretor || 'JACOMETO'
let _qUsuario = _credQuiver.usuario  || 'Adriano.jacometo'
let _qSenha = _credQuiver.senha    || ''
let QUIVER_LOGIN = `Logar('${_qCorretor}', '${_qUsuario}', '${_qSenha}')`
const SCREENSHOTS_DIR = path.resolve('./downloads/screenshots')

// ── Store de jobs em memória ──────────────────────────────────────────────────

const JOBS = new Map()

function criarJob(total) {
  const id = crypto.randomUUID()
  JOBS.set(id, { id, status: 'extraindo', progresso: 0, total, faturas: [], resultados: [], erro: null, criadoEm: Date.now() })
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

// ── Helpers JS injetados no Quiver ────────────────────────────────────────────

const HELPERS_JS = `
window.__quiverErro = null;
window.getDoc2 = () => {
  const zi = document.getElementById('ZonaInterna'); if (!zi) return null;
  const zi2 = zi.contentDocument.getElementById('ZonaInterna'); if (!zi2) return null;
  return zi2.contentDocument;
};
window.setField = (doc, id, val) => {
  const el = doc.getElementById(id);
  if (!el) { console.warn('[Quiver] setField: elemento não encontrado:', id); return false; }
  el.value = val;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('[Quiver] setField:', id, '=', val, '→ actual:', el.value);
  return true;
};
window.clickBtn = (doc, text) => {
  for (const btn of doc.querySelectorAll('button, input[type="button"], a')) {
    if (btn.textContent.trim().includes(text) || (btn.value||'').includes(text)) { btn.click(); return true; }
  } return false;
};
window.lerErros = (doc) => {
  if (!doc) return '';
  const sels = '.msg-erro,.alert-danger,.erro,span[style*="red"],[class*="error"],[class*="Error"],[id*="Error"]';
  return Array.from(doc.querySelectorAll(sels)).map(e => e.textContent.trim()).filter(Boolean).join(' | ');
};
window.startFatura = (apolice, endosso, emissao, inicio, fim, proposta, vencimento, premioLiq, seguradora) => {
  for (const a of document.querySelectorAll('a')) {
    if (a.textContent.trim() === 'Operacional') { a.click(); break; }
  }
  setTimeout(() => {
    const doc1 = document.getElementById('ZonaInterna').contentDocument;
    for (const a of doc1.querySelectorAll('a')) {
      if (a.textContent.trim().includes('Incluir novo pedido')) { a.click(); break; }
    }
    setTimeout(() => {
      const doc1 = document.getElementById('ZonaInterna').contentDocument;
      const ap = doc1.getElementById('Apolice'); if (ap) ap.value = apolice;
      for (const btn of doc1.querySelectorAll('button')) {
        if (btn.textContent.trim() === 'Pesquisar') { btn.click(); break; }
      }
      setTimeout(() => {
        const doc1 = document.getElementById('ZonaInterna').contentDocument;
        const links = doc1.querySelectorAll('a[onclick*="RowDblClick"]');
        if (!links.length) { window.__quiverErro = 'APOLICE_NAO_ENCONTRADA'; return; }
        links[0].click();
        setTimeout(() => {
          const d2 = window.getDoc2();
          if (!d2) { window.__quiverErro = 'IFRAME_NAO_CARREGOU'; return; }
          window.setField(d2, 'Documento_TipoDocumento', '9');
          setTimeout(() => {
            const d2 = window.getDoc2();
            if (!d2) { window.__quiverErro = 'SUBTIPO_NAO_CARREGOU'; return; }
            window.setField(d2, 'Documento_SubTipo', '36');
            // Allianz: endosso com 6 dígitos (padding zeros). Tokio Marine: SEM zeros.
            const endFmt = (seguradora || '').toLowerCase().includes('tokio') ? String(endosso) : String(endosso).padStart(6,'0');
            window.setField(d2, 'Documento_Endosso', endFmt);
            window.setField(d2, 'Documento_DataEmissao', emissao);
            window.setField(d2, 'Documento_InicioVigencia', inicio);
            window.setField(d2, 'Documento_TerminoVigencia', fim);
            window.setField(d2, 'Documento_PropostaCia', proposta);
            const btg = d2.getElementById('BtGravar');
            if (!btg) { window.__quiverErro = 'BTN_GRAVAR_NAO_ENCONTRADO'; return; }
            btg.click();
            setTimeout(() => {
              const d2 = window.getDoc2(); if (!d2) return;
              window.clickBtn(d2, 'SIM');
              const errs = window.lerErros(d2);
              if (errs && !window.__quiverErro) window.__quiverErro = 'GRAVAR1:' + errs;
            }, 1000);
            setTimeout(() => {
              const d2 = window.getDoc2(); if (!d2) return;
              for (const a of d2.querySelectorAll('a')) {
                if (a.textContent.trim().includes('Prêmio')||a.textContent.trim().includes('Premio')) { a.click(); break; }
              }
              setTimeout(() => {
                const d2 = window.getDoc2(); if (!d2) return;
                window.setField(d2, 'Documento_DataVencPrimeira', vencimento);
                window.setField(d2, 'Documento_PremioLiqDesc', premioLiq);
                // NÃO clica Gravar aqui — Playwright vai fazer Tab real + Gravar
                // Marca flag para Playwright saber que prêmio foi preenchido
                window.__premioPreenchido = true;
              }, 2000);
            }, 6000);
          }, 3500);
        }, 3000);
      }, 3000);
    }, 2000);
  }, 2000);
};
`

// ── Classificação de erros ────────────────────────────────────────────────────

const ERROS = [
  { match: ['APOLICE_NAO_ENCONTRADA'],      tipo: 'APOLICE_NAO_ENCONTRADA', label: 'Apólice não encontrada',         orientacao: 'Verifique se a apólice está ativa e cadastrada no Quiver PRO.' },
  { match: ['MSG069','SUBTIPO','SUBTIPO_NAO_CARREGOU'], tipo: 'MSG069',   label: 'Erro MSG069 — Sub-tipo',          orientacao: 'Problema de timing. Reenvie esta fatura.' },
  { match: ['MSG097','ENDOSSO_DUPLICADO'],  tipo: 'ENDOSSO_DUPLICADO',     label: 'Endosso já cadastrado (MSG097)', orientacao: 'Esta fatura já existe no Quiver. Verifique se foi cadastrada anteriormente.' },
  { match: ['IFRAME_NAO_CARREGOU','BTN_GRAVAR_NAO_ENCONTRADO'], tipo: 'IFRAME_TIMEOUT', label: 'Quiver não carregou corretamente', orientacao: 'Portal lento. Reenvie o PDF.' },
  { match: ['VIGENCIA','VIGOR'],            tipo: 'VIGENCIA',              label: 'Datas fora da vigência',         orientacao: 'Verifique as datas de início e fim no PDF.' },
  { match: ['GRAVAR1','GRAVAR2'],           tipo: 'ERRO_GRAVAR',           label: 'Erro ao gravar no Quiver',      orientacao: 'Cadastre manualmente e verifique o log.' },
  { match: ['TIMEOUT','NAVIGATION'],        tipo: 'TIMEOUT',               label: 'Timeout — portal demorou',      orientacao: 'Quiver estava lento. Reenvie o PDF.' },
]

function classificarErro(msg) {
  if (!msg) return { tipo: 'DESCONHECIDO', label: 'Erro desconhecido', orientacao: 'Verifique o log e tente novamente.' }
  const upper = msg.toUpperCase()
  for (const def of ERROS) {
    if (def.match.some(m => upper.includes(m))) return { tipo: def.tipo, label: def.label, orientacao: def.orientacao }
  }
  return { tipo: 'OUTRO', label: msg.substring(0, 100), orientacao: 'Cadastre manualmente ou tente reenviar.' }
}

// Normaliza prêmio para formato brasileiro "X.XXX,YY" (sempre com vírgula decimal)
// Aceita:
//   - número JS: 3295.56 → "3295,56"
//   - string decimal JS: "3295.56" → "3295,56"
//   - string pt-BR: "3.295,56" → "3295,56" (remove separador de milhar)
//   - string com vírgula: "3295,56" → "3295,56"
// Importante: NÃO quebrar valores grandes (bug anterior: "3.295,56".replace('.', ',') → "3,295,56")
function normalizarPremio(v) {
  if (v === null || v === undefined || v === '') return ''
  // Se é número, converte direto substituindo ponto por vírgula
  if (typeof v === 'number') return v.toFixed(2).replace('.', ',')
  const s = String(v).trim()
  if (!s) return ''
  // Se contém vírgula → formato pt-BR: apenas remove pontos de milhar
  if (s.includes(',')) return s.replace(/\./g, '')
  // Só tem ponto → formato decimal JS: troca único ponto por vírgula
  // Se tiver múltiplos pontos (ex: "3.295"), é separador de milhar sem centavos
  const pontos = (s.match(/\./g) || []).length
  if (pontos === 1) return s.replace('.', ',')
  // Múltiplos pontos (ex: "3.295") → remove todos e assume que já é inteiro
  return s.replace(/\./g, '')
}

// ── Extração de PDF via Claude API ────────────────────────────────────────────

async function extrairDadosPDF(pdfBase64, nomeArquivo) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: `Extraia dados desta fatura de seguro transporte. Retorne APENAS JSON sem markdown.

REGRAS POR SEGURADORA:

TOKIO MARINE:
- O endosso é o "Endosso / Fatura nº." — NÃO adicione zeros à esquerda. Se está "5", retorne "5" (não "05" nem "005").
- Para inicio_vigencia e fim_vigencia, use o PERÍODO do "Resumo de Embarques - Subgrupo" (ex: "01/03/2026 à 31/03/2026"), NÃO a vigência da apólice.
- A vigência da apólice (ex: 27/11/2025 até 27/11/2026) é da apólice inteira — IGNORE para as datas.
- premio_liquido: use o "PRÊMIO LÍQUIDO FINAL" da composição do prêmio.
- vencimento: do "Demonstrativo e Fracionamento do Prêmio".

ALLIANZ:
- O número do endosso/fatura está SEMPRE no RODAPÉ DA PÁGINA 2 (última página).
- O rodapé mostra "Nº Apólice: XXXXXXXXXXXXXXXXXXX" e "Nº Fatura: N"
- Use o "Nº Fatura" do rodapé da página 2 como endosso — NÃO use o da página 1 pois pode ser diferente.
- A apólice completa também deve vir do rodapé da página 2.

SOMPO / AKAD / AXA / CHUBB:
- Siga os campos conforme aparecem no documento.

Formato de resposta:
{"seguradora":"Tokio Marine|Sompo|AKAD|AXA|Chubb|Allianz","apolice":"número completo","endosso":"EXATAMENTE como na fatura, SEM zeros à esquerda (ex: 5, não 005)","ramo":"54 ou 55","segurado":"","cnpj":"","emissao":"DD/MM/YYYY","proposta_cia":"","inicio_vigencia":"DD/MM/YYYY (Tokio: do Resumo Embarques)","fim_vigencia":"DD/MM/YYYY (Tokio: do Resumo Embarques)","premio_liquido":"ex:1.234,56","vencimento":"DD/MM/YYYY"}` },
        ],
      }],
    }),
  })
  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    log.error(`Claude API ${response.status}: ${errBody.substring(0, 200)}`)
    return null
  }
  const data = await response.json()
  const texto = data.content?.find(b => b.type === 'text')?.text || ''
  log.info(`Claude extraiu: ${texto.substring(0, 150)}`)
  try {
    const parsed = JSON.parse(texto.replace(/```json|```/g, '').trim())
    // Normaliza prêmio: "3.295,56" → "3295,56" (evita Quiver interpretar ponto como decimal)
    if (parsed && parsed.premio_liquido) parsed.premio_liquido = normalizarPremio(parsed.premio_liquido)
    return parsed
  } catch { log.error(`JSON parse falhou: ${texto.substring(0,100)}`); return null }
}

// ── Playwright ────────────────────────────────────────────────────────────────

async function loginQuiver(page) {
  await page.goto(QUIVER_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  if (page.url().includes('default.aspx')) {
    await page.evaluate(QUIVER_LOGIN)
    await page.waitForTimeout(4500)
  }
}

async function recuperarSessao(page) {
  await page.goto(QUIVER_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  if (page.url().includes('default.aspx')) {
    await page.evaluate(QUIVER_LOGIN)
    await page.waitForTimeout(4500)
  }
}

async function screenshot(page, nome) {
  try {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
    const p = path.join(SCREENSHOTS_DIR, nome)
    await page.screenshot({ path: p, fullPage: false })
    return p
  } catch { return null }
}

async function cadastrarFatura(page, fatura, idx) {
  // Cada seguradora tem formato diferente de busca no Quiver
  let apoliceQuiver = fatura.apolice || ''
  const segLower = (fatura.seguradora || '').toLowerCase()

  if (segLower.includes('allianz') && apoliceQuiver.length > 7) {
    // Allianz: últimos 7 dígitos (ex: 5177202623540000397 → 0000397)
    apoliceQuiver = apoliceQuiver.slice(-7)
    log.info(`  Allianz: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver}`)
  } else if (segLower.includes('tokio') && apoliceQuiver.length > 6) {
    // Tokio Marine: últimos 6 dígitos
    apoliceQuiver = apoliceQuiver.slice(-6)
    log.info(`  Tokio: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver}`)
  } else if (segLower.includes('axa')) {
    // AXA: formato 02852.2026.0043.RAMO.NNNNNNN
    // Ramo 0654 (RCTR-C) → últimos 5 dígitos sem zeros
    // Ramo 0655 (RC-DC)  → últimos 4 dígitos sem zeros
    const ramoStr = (fatura.ramo || '').toUpperCase()
    if (ramoStr.includes('DC') || ramoStr.includes('0655') || ramoStr === '55') {
      apoliceQuiver = apoliceQuiver.replace(/\./g, '').slice(-4).replace(/^0+/, '')
      log.info(`  AXA RC-DC: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver}`)
    } else {
      apoliceQuiver = apoliceQuiver.replace(/\./g, '').slice(-5).replace(/^0+/, '')
      log.info(`  AXA RCTR-C: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver}`)
    }
  }

  log.info(`[${idx + 1}] ${fatura.segurado} — ${apoliceQuiver} end ${fatura.endosso} | prêmio: "${fatura.premio_liquido}" | vig: ${fatura.inicio_vigencia}→${fatura.fim_vigencia} | venc: ${fatura.vencimento}`)
  await page.evaluate(() => { window.__quiverErro = null })

  try {
    await page.evaluate(HELPERS_JS)
    await page.waitForTimeout(300)

    await page.evaluate(`window.startFatura(
      '${apoliceQuiver}','${fatura.endosso}','${fatura.emissao}',
      '${fatura.inicio_vigencia}','${fatura.fim_vigencia}',
      '${fatura.proposta_cia || ''}','${fatura.vencimento}','${fatura.premio_liquido}',
      '${fatura.seguradora || ''}'
    )`)

    // Espera o JS preencher campos (Dados Básicos + abrir aba Prêmios + preencher prêmio)
    // Chain de setTimeouts: 2+2+3+3+3.5+6+2 = ~21.5s para preencher prêmio
    // Polling a cada 2s até flag ficar true (máximo 30s)
    log.info('Aguardando JS preencher prêmio...')
    let premioOk = false
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(2000)
      premioOk = await page.evaluate(() => window.__premioPreenchido === true)
      if (premioOk) break
      // Verifica se deu erro antes
      const erroAntes = await page.evaluate(() => window.__quiverErro || null)
      if (erroAntes) break
    }

    if (premioOk) {
      log.info('Prêmio preenchido pelo JS. Fazendo Tab real via Playwright...')

      // Acessa o iframe interno (ZonaInterna > ZonaInterna) onde está o campo
      const frame1 = page.frame({ name: 'ZonaInterna' }) || page.frames().find(f => f.url().includes('ZonaInterna') || f.name() === 'ZonaInterna')
      let frameAlvo = frame1

      if (frame1) {
        // Tenta achar o sub-frame
        const frame2 = frame1.childFrames().find(f => f.name() === 'ZonaInterna' || f.url().includes('endosso') || f.url().includes('Documento'))
        if (frame2) frameAlvo = frame2
      }

      if (frameAlvo) {
        try {
          // Clica no campo prêmio líquido e pressiona Tab (evento REAL do browser)
          const campoPremio = frameAlvo.locator('#Documento_PremioLiqDesc')
          if (await campoPremio.count() > 0) {
            await campoPremio.click()
            await page.waitForTimeout(300)
            await campoPremio.press('Tab')
            log.info('Tab real enviado no campo prêmio via Playwright.')
            await page.waitForTimeout(3000) // aguarda Quiver recalcular
          } else {
            log.warn('Campo Documento_PremioLiqDesc não encontrado no frame.')
          }
        } catch (e) {
          log.warn(`Tab via Playwright falhou: ${e.message.substring(0, 60)}`)
        }
      } else {
        log.warn('Frame interno não encontrado para Tab.')
      }

      // Agora clica Gravar via JS
      await page.evaluate(() => {
        const d2 = window.getDoc2(); if (!d2) return;
        d2.getElementById('BtGravar').click();
      })
      await page.waitForTimeout(2000)

      // Trata alertas (OK/SIM)
      await page.evaluate(() => {
        const d2 = window.getDoc2(); if (!d2) return;
        window.clickBtn(d2, 'OK');
      })
      await page.waitForTimeout(2000)
    } else {
      // Fallback: espera o tempo total (fluxo antigo)
      log.warn('Flag __premioPreenchido não detectada. Aguardando fluxo JS completo...')
      await page.waitForTimeout(12000)
    }

    const erroJs = await page.evaluate(() => window.__quiverErro || null)

    if (erroJs) {
      const ss = await screenshot(page, `erro_${fatura.apolice}_end${fatura.endosso}_${Date.now()}.png`)
      await recuperarSessao(page)
      const classif = classificarErro(erroJs)
      log.warn(`FALHA [${fatura.apolice}]: ${classif.label}`)
      return { ...fatura, status: 'FALHA', erro: erroJs, screenshotPath: ss, ...classif }
    }

    await recuperarSessao(page)
    log.ok(`OK [${fatura.apolice}] ${fatura.segurado}`)
    return { ...fatura, status: 'OK', erro: null, tipo: null, label: null, orientacao: null, screenshotPath: null }

  } catch (e) {
    const ss = await screenshot(page, `erro_${fatura.apolice}_${Date.now()}.png`)
    await recuperarSessao(page)
    const classif = classificarErro(e.message)
    log.error(`ERRO [${fatura.apolice}]: ${e.message}`)
    return { ...fatura, status: 'FALHA', erro: e.message, screenshotPath: ss, ...classif }
  }
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function enviarResumo(resultados, jobId) {
  const ok    = resultados.filter(r => r.status === 'OK')
  const falha = resultados.filter(r => r.status === 'FALHA')
  const segs  = [...new Set(resultados.map(r => r.seguradora).filter(Boolean))].join(', ')
  const total = ok.reduce((a, r) => a + (parseFloat((r.premio_liquido||'0').replace(/\./g,'').replace(',','.')) || 0), 0)
  const emoji = falha.length === 0 ? '✅' : ok.length === 0 ? '❌' : '⚠️'

  const linhasOK    = ok.map(r => `✅ ${r.segurado} | Ramo ${r.ramo} | Apólice ${r.apolice} | End ${String(r.endosso).padStart(6,'0')} | R$ ${r.premio_liquido} | Venc ${r.vencimento}`).join('\n')
  const linhasFalha = falha.map(r => `❌ ${r.segurado} | Apólice ${r.apolice}\n   Motivo: ${r.label || r.erro}\n   Ação: ${r.orientacao || ''}`).join('\n\n')

  await email.enviar({
    assunto: `${emoji} Faturas Transporte — ${segs} (${ok.length}✅${falha.length > 0 ? ' ' + falha.length + '❌' : ''})`,
    corpo: `Resultado do cadastro de faturas de transporte.\n\nJob: ${jobId}\nSeguradoras: ${segs}\nResultado: ${ok.length} OK | ${falha.length} falha(s)\nPrêmio líquido total: R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\n${ok.length > 0 ? 'CADASTRADAS:\n' + linhasOK + '\n' : ''}${falha.length > 0 ? '\nFALHAS — AÇÃO NECESSÁRIA:\n' + linhasFalha : ''}\n\nTipo: Fatura | Subtipo: Movimento Fatura - Transportes\nSistema Ferramentas Jacometo`,
  })
}

// ── Handler Express ───────────────────────────────────────────────────────────

module.exports = async function routeQuiverFaturasTransporte(req, res) {
  const arquivos = req.files || []
  if (!arquivos.length) return res.status(400).json({ erro: 'Nenhum PDF enviado.' })

  const jobId = criarJob(arquivos.length)
  log.info(`Job ${jobId} — ${arquivos.length} PDF(s)`)

  res.json({ ok: true, jobId, mensagem: `${arquivos.length} PDF(s) recebido(s). Processando.` })

  setImmediate(async () => {
    const _inicio = new Date()
    await db.jobIniciado(jobId, 'quiver_transporte')
    // Recarrega credenciais a cada execução (para pegar atualizações do painel)
    const _creds = getCred('quiver')
    QUIVER_URL   = _creds.url       || QUIVER_URL
    _qCorretor   = _creds.corretor  || _qCorretor
    _qUsuario    = _creds.usuario   || _qUsuario
    _qSenha      = _creds.senha     || _qSenha
    QUIVER_LOGIN = `Logar('${_qCorretor}', '${_qUsuario}', '${_qSenha}')`
    // ── Extração ──────────────────────────────────────────────────────────────
    const faturas = []
    atualizar(jobId, { status: 'extraindo' })

    // Verifica se recebeu dados pré-extraídos do Jarvis OS (drive-watcher)
    let dadosPreExtraidos = null
    try {
      if (req.body?.dados_extraidos) {
        dadosPreExtraidos = JSON.parse(req.body.dados_extraidos)
        log.info(`Recebido dados pré-extraídos para ${dadosPreExtraidos.length} fatura(s)`)
      }
    } catch { /* ignora parse error */ }

    for (let idx = 0; idx < arquivos.length; idx++) {
      const arq = arquivos[idx]
      try {
        let dados = null

        // Se tem dados pré-extraídos do Jarvis OS, converte para formato do backend
        if (dadosPreExtraidos?.[idx]) {
          const pre = dadosPreExtraidos[idx]
          dados = {
            seguradora: (pre.seguradora || '').charAt(0).toUpperCase() + (pre.seguradora || '').slice(1),
            apolice: String(pre.apolice || ''),
            endosso: String(pre.endosso || ''),
            ramo: pre.ramo || '',
            segurado: '',
            cnpj: '',
            emissao: '',
            proposta_cia: '',
            inicio_vigencia: pre.periodo_inicio || '',
            fim_vigencia: pre.periodo_fim || '',
            premio_liquido: normalizarPremio(pre.premio),
            vencimento: pre.vencimento || '',
          }
          log.ok(`Usando dados pré-extraídos: ${arq.originalname} — apólice ${dados.apolice}`)
        } else {
          dados = await extrairDadosPDF(fs.readFileSync(arq.path).toString('base64'), arq.originalname)
        }

        if (dados) {
          faturas.push({ ...dados, arquivoOriginal: arq.originalname })
          log.ok(`Extraído: ${arq.originalname}`)
        } else {
          const curr = JOBS.get(jobId)
          atualizar(jobId, { resultados: [...curr.resultados, {
            segurado: arq.originalname, apolice: '—', endosso: '—', ramo: '—',
            premio_liquido: '—', vencimento: '—', status: 'FALHA',
            tipo: 'EXTRACAO_FALHOU', label: 'PDF não reconhecido',
            orientacao: 'Verifique se é uma fatura de transporte válida.', screenshotPath: null,
          }]})
        }
      } catch (e) { log.error(`PDF ${arq.originalname}: ${e.message}`) }
      finally { try { fs.unlinkSync(arq.path) } catch {} }
    }

    if (!faturas.length) {
      atualizar(jobId, { status: 'concluido' })
      await db.jobConcluido(jobId, 'quiver_transporte', { resultados, csvPath: csvPath || null }, _inicio)
      await email.enviar({ assunto: '❌ Faturas Transporte — Falha extração', corpo: 'Nenhum dado extraído dos PDFs enviados.' })
      return
    }

    faturas.sort((a, b) => a.segurado < b.segurado ? -1 : a.segurado > b.segurado ? 1 : Number(a.ramo) - Number(b.ramo))
    atualizar(jobId, { faturas, status: 'cadastrando', total: faturas.length + (JOBS.get(jobId)?.resultados?.length || 0) })

    // ── Cadastro Quiver ───────────────────────────────────────────────────────
    const { browser, page } = await abrirBrowser()

    try {
      await loginQuiver(page)
      for (let i = 0; i < faturas.length; i++) {
        const resultado = await cadastrarFatura(page, faturas[i], i)
        const curr = JOBS.get(jobId)
        atualizar(jobId, { progresso: i + 1, resultados: [...curr.resultados, resultado] })
      }
    } catch (e) {
      log.error(`Erro crítico: ${e.message}`)
      atualizar(jobId, { status: 'erro_critico', erro: e.message })
    } finally {
      await fecharBrowser(browser)
    }

    // ── Finaliza ──────────────────────────────────────────────────────────────
    const jobFinal = JOBS.get(jobId)
    atualizar(jobId, { status: 'concluido' })
    await enviarResumo(jobFinal.resultados, jobId)
    log.ok(`Job ${jobId} concluído: ${jobFinal.resultados.filter(r=>r.status==='OK').length}/${jobFinal.resultados.length} OK`)
  })
}
module.exports.getJobStatus = getJobStatus
