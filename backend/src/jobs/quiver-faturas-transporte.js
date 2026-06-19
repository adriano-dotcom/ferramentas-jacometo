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
const XLSX = require('xlsx')

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
// Arquivos recebidos via upload em múltiplos chunks (lotes grandes), aguardando o
// chunk final p/ iniciar o processamento. Fora de JOBS p/ não vazar caminhos de
// arquivo no status retornado ao frontend.
const PENDENTES = new Map()

function criarJob(total) {
  const id = crypto.randomUUID()
  JOBS.set(id, { id, status: 'extraindo', progresso: 0, total, faturas: [], resultados: [], erro: null, criadoEm: Date.now() })
  for (const [k, v] of JOBS) { if (Date.now() - v.criadoEm > 7200000) { JOBS.delete(k); PENDENTES.delete(k) } }
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
window.setSelectByText = (doc, id, text) => {
  const el = doc.getElementById(id);
  if (!el) { console.warn('[Quiver] setSelectByText: não encontrado:', id); return false; }
  const alvo = String(text).trim().toLowerCase();
  for (const opt of el.options || []) {
    if ((opt.textContent || '').trim().toLowerCase() === alvo) {
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[Quiver] setSelectByText:', id, '=', text, '→ value:', opt.value);
      return true;
    }
  }
  console.warn('[Quiver] setSelectByText: opção não encontrada:', id, text);
  return false;
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
window.startFatura = (apolice, endosso, emissao, inicio, fim, proposta, vencimento, premioLiq, seguradora, subtipoLabel) => {
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
      // Aguarda resultados da busca (retry até 12s — Quiver pode ser lento)
      const tentarAbrir = (tentativa) => {
        const doc1 = document.getElementById('ZonaInterna').contentDocument;
        const links = doc1.querySelectorAll('a[onclick*="RowDblClick"]');
        if (links.length) {
          links[0].click();
          continuarFluxo();
          return;
        }
        if (tentativa < 6) { setTimeout(() => tentarAbrir(tentativa+1), 2000); return; }
        window.__quiverErro = 'APOLICE_NAO_ENCONTRADA';
      };
      setTimeout(() => tentarAbrir(1), 3000);
      const continuarFluxo = () => {
        setTimeout(() => {
          const d2 = window.getDoc2();
          if (!d2) { window.__quiverErro = 'IFRAME_NAO_CARREGOU'; return; }
          window.setField(d2, 'Documento_TipoDocumento', '9');
          setTimeout(() => {
            const d2 = window.getDoc2();
            if (!d2) { window.__quiverErro = 'SUBTIPO_NAO_CARREGOU'; return; }
            const segL = (seguradora || '').toLowerCase();
            const subL = (subtipoLabel || '').trim();
            let subtipoPorTexto = false;
            if (subL) {
              // SubTipo informado explicitamente (ex: planilha AKAD RC-V → "FATURA MENSAL")
              window.setSelectByText(d2, 'Documento_SubTipo', subL);
              subtipoPorTexto = true;
            } else if (segL.includes('unimed')) {
              // Unimed Vida em Grupo: subtipo "FATURA MENSAL"
              window.setSelectByText(d2, 'Documento_SubTipo', 'FATURA MENSAL');
              subtipoPorTexto = true;
            } else {
              // Transporte: "Movimento Fatura - Transportes" (value=36)
              window.setField(d2, 'Documento_SubTipo', '36');
            }
            // Allianz/AKAD: endosso com 6 dígitos (padding zeros). Tokio/AXA/Unimed/FATURA MENSAL: EXATO como veio.
            const subUpper = subL.toUpperCase();
            const endFmt = (segL.includes('tokio') || segL.includes('axa') || segL.includes('chubb') || segL.includes('unimed') || subUpper === 'FATURA MENSAL') ? String(endosso) : String(endosso).padStart(6,'0');
            // Quando SubTipo é alterado por TEXTO, há postback ASP.NET que pode resetar campos.
            // Aguardamos esse postback antes de preencher os demais campos, então re-verificamos TipoDocumento.
            const aposSubtipo = () => {
              const d2 = window.getDoc2();
              if (!d2) { window.__quiverErro = 'IFRAME_POS_SUBTIPO_PERDEU'; return; }
              // Re-aplica TipoDocumento se o postback tiver zerado
              const tipoEl = d2.getElementById('Documento_TipoDocumento');
              if (tipoEl && (!tipoEl.value || tipoEl.value === '' || tipoEl.value === '0')) {
                window.setField(d2, 'Documento_TipoDocumento', '9');
              }
              // Re-aplica SubTipo se zerou
              const subEl = d2.getElementById('Documento_SubTipo');
              if (subEl && (!subEl.value || subEl.value === '' || subEl.value === '0') && subL) {
                window.setSelectByText(d2, 'Documento_SubTipo', subL);
              }
              window.setField(d2, 'Documento_Endosso', endFmt);
              window.setField(d2, 'Documento_DataEmissao', emissao);
              window.setField(d2, 'Documento_InicioVigencia', inicio);
              window.setField(d2, 'Documento_TerminoVigencia', fim);
              window.setField(d2, 'Documento_PropostaCia', proposta);
              const btg = d2.getElementById('BtGravar');
              if (!btg) { window.__quiverErro = 'BTN_GRAVAR_NAO_ENCONTRADO'; return; }
              btg.click();
              // SIM no alerta de endosso duplicado (MSG097)
              setTimeout(() => {
                const d2 = window.getDoc2(); if (!d2) return;
                window.clickBtn(d2, 'SIM');
                const errs = window.lerErros(d2);
                if (errs && !window.__quiverErro) window.__quiverErro = 'GRAVAR1:' + errs;
              }, 1000);
              // Polling: espera "Aguarde..." sumir, então abre Prêmios
              setTimeout(() => esperarAguardeESomir(1), 3000);
            };
            // Postback do SubTipo por TEXTO requer espera adicional (~2s); por value (36) não há postback.
            if (subtipoPorTexto) setTimeout(aposSubtipo, 2000); else aposSubtipo();
            // Polling: espera "Aguarde..." sumir, então abre Prêmios
            const esperarAguardeESomir = (tentativa) => {
              const d2 = window.getDoc2(); if (!d2) { if (tentativa < 30) setTimeout(() => esperarAguardeESomir(tentativa+1), 1000); return; }
              // Procura overlay/modal "Aguarde" no doc principal e no doc2
              const textosOverlay = [document.body.innerText, d2.body ? d2.body.innerText : ''].join(' ').toLowerCase()
              const aguardando = textosOverlay.includes('aguarde') && textosOverlay.includes('processando')
              if (aguardando && tentativa < 30) { setTimeout(() => esperarAguardeESomir(tentativa+1), 1000); return; }
              // OK — abre Prêmios
              for (const a of d2.querySelectorAll('a')) {
                if (a.textContent.trim().includes('Prêmio')||a.textContent.trim().includes('Premio')) { a.click(); break; }
              }
              setTimeout(() => {
                const d2 = window.getDoc2(); if (!d2) return;
                // Verifica alerta "É necessário salvar..."
                const txt = (d2.body.innerText || '').toLowerCase()
                if (txt.includes('necessário salvar') || txt.includes('necessario salvar')) {
                  window.__quiverErro = 'ABA_PREMIOS_BLOQUEADA_GRAVAR_PRIMEIRO';
                  return;
                }
                window.setField(d2, 'Documento_DataVencPrimeira', vencimento);
                window.setField(d2, 'Documento_PremioLiqDesc', premioLiq);
                setTimeout(() => {
                  const d2 = window.getDoc2(); if (!d2) return;
                  const btg2 = d2.getElementById('BtGravar');
                  if (btg2) btg2.click();
                  setTimeout(() => {
                    const d2 = window.getDoc2(); if (!d2) return;
                    window.clickBtn(d2, 'OK');
                    const errs = window.lerErros(d2);
                    if (errs && !window.__quiverErro) window.__quiverErro = 'GRAVAR2:' + errs;
                    window.__premioGravado = true;
                  }, 2500);
                }, 2000);
              }, 2500);
            };
          }, 3500);
        }, 3000);
      };
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

// Recebe "DD/MM/YYYY" e devolve {inicio, fim} = primeiro e último dia daquele mês.
// Ex: "01/05/2026" → { inicio: "01/05/2026", fim: "31/05/2026" }
// Usado na AKAD: a "data do endosso" (vigência) é o mês INTEIRO do "Início de vigência".
function mesCompletoVigencia(dataStr) {
  const m = String(dataStr || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const mes = Number(m[2]), ano = Number(m[3])
  if (mes < 1 || mes > 12) return null
  // new Date(ano, mes, 0) = dia 0 do mês seguinte (mês 1-based) = último dia deste mês
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const mm = String(mes).padStart(2, '0')
  return { inicio: `01/${mm}/${ano}`, fim: `${String(ultimoDia).padStart(2, '0')}/${mm}/${ano}` }
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
      model: 'claude-sonnet-4-5',
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

AKAD (Resp. Civil Desvio de Carga - RC-DC / Transporte):
- apolice: use o "Número da Apólice Akad" COMPLETO (ex: 027982025010655002035). O sistema usa os últimos 6 dígitos = a apólice no Quiver (ex: 002035). NÃO use o "Número da Apólice Susep" — seus últimos 6 dígitos são DIFERENTES (ex: 020035) e dão "apólice não encontrada".
- endosso: últimos 6 dígitos do "Número da Fatura Susep" MANTENDO zeros à esquerda (ex: "000009", NÃO "9"). Em AKAD o endosso é a sequência final após a apólice na "Número da Fatura Susep".
- inicio_vigencia: a data do campo "Início de vigência às 24 horas de" (ex: 01/05/2026). O sistema converte para o MÊS INTEIRO (primeiro ao último dia).
- fim_vigencia: IGNORE o campo "Término de vigência" — deixe vazio. O sistema calcula o último dia do mês do início de vigência.
- emissao: a "Data de Emissão" (ex: 15/06/2026).
- vencimento: a data em "Vencimento(s)" (ex: "001 20/06/2026" → 20/06/2026).
- premio_liquido: o "Prêmio Líquido R$" do "Demonstrativo de Prêmio" (ex: 650,00).
- ramo: "55" (RC-DC).

SOMPO / AXA:
- Siga os campos conforme aparecem no documento.
- AXA: o "Nomenclatura de Ramo e Produto" indica o ramo. Mapear:
  • 0654 → ramo "54" (RCTR-C)
  • 0655 → ramo "55" (RC-DC)
  • 0659 → ramo "59" (RC-V — Responsabilidade Civil do Veículo)
  • 0621 → ramo "21" (Transporte Nacional)

CHUBB (todos os dados ficam na 2ª PÁGINA do PDF — IGNORE página 1):
- seguradora: "Chubb".
- apolice: o campo "Apólice" no cabeçalho da página 2, EXATAMENTE como aparece com pontos (ex: "23.54.0036010.31"). NÃO remova pontos — o sistema cuida disso.
- endosso: o campo "Endosso" EXATO como no PDF, SEM zeros à esquerda (ex: "403915").
- inicio_vigencia / fim_vigencia: da seção "Vigência — Das 24:00h do dia DD/MM/YYYY às 24:00h do dia DD/MM/YYYY". A primeira data é inicio_vigencia, a segunda é fim_vigencia.
- emissao: a data no RODAPÉ "SAO PAULO, DD DE MÊS DE YYYY - HH:MMhs" — converta o mês por extenso (ex: "16 DE JUNHO DE 2026" → "16/06/2026").
- premio_liquido: use "Prêmio Líquido Chubb" do "Demonstrativo do Prêmio" (ex: 800,00).
- vencimento: se não houver data explícita, use a data de emissão.
- ramo: do quadro "Ramos" — 0654 → "54" (RCTR-C), 0655 → "55" (RC-DC).

UNIMED SEGUROS (Vida em Grupo / Acidentes Pessoais / Garantia Funeral — "Discriminação de Prêmios"):
- seguradora: "Unimed Seguros".
- apolice: use o "Código do Grupo" (ex: 82940). NÃO use os números das apólices VG/AP/AUXFUN do quadro à direita.
- endosso: use o "Número Fatura" EXATAMENTE como aparece, sem zeros à esquerda (ex: 2682556).
- inicio_vigencia / fim_vigencia: use o "Período de Vigência" (ex: "01/02/2026 a 28/02/2026" → 01/02/2026 e 28/02/2026). Este período é a vigência do endosso/fatura.
- premio_liquido: use "Prêmio Líquido" (ex: 144,51).
- vencimento: use "Data de Vencimento".
- emissao: use "Data de Emissão".
- ramo: deixe vazio (não é transporte).

ICATU (seguro de VIDA — cabeçalho "ICATU" + "Dados - Nº da fatura"):
- seguradora: "Icatu".
- apolice: use o campo "Nº DA APÓLICE / CONTRATO" SEM os pontos (ex: "93.759.742" → "93759742").
- endosso: use o "Dados - Nº da fatura" EXATAMENTE como aparece, sem zeros à esquerda (ex: "20").
- inicio_vigencia / fim_vigencia: use o "PERÍODO DE VIGÊNCIA/COMPETÊNCIA: De DD/MM/YYYY até DD/MM/YYYY" (ex: "De 01/05/2026 até 31/05/2026" → inicio 01/05/2026, fim 31/05/2026).
- emissao: use "DATA DE EMISSÃO" (ex: 01/06/2026).
- vencimento: use "VENCIMENTO" (ex: 20/06/2026).
- premio_liquido: use "Prêmio Líquido Total" do "Resumo do Faturamento" (ex: 633,55). NÃO use o "Prêmio Total" nem o "Prêmio a Pagar".
- ramo: deixe vazio (não é transporte).

Formato de resposta:
{"seguradora":"Tokio Marine|Sompo|AKAD|AXA|Chubb|Allianz|Unimed Seguros|Icatu","apolice":"número completo (Unimed: Código do Grupo; Chubb: COM pontos ex 23.54.0036010.31; Icatu: Nº da Apólice/Contrato sem pontos ex 93759742)","endosso":"EXATAMENTE como na fatura, SEM zeros à esquerda (ex: 5, não 005). EXCEÇÃO: AKAD mantém 6 dígitos com zeros (ex: 000009)","ramo":"54 (RCTR-C), 55 (RC-DC), 59 (RC-V) ou 21 (Transporte Nacional) — vazio para Unimed","segurado":"","cnpj":"","emissao":"DD/MM/YYYY","proposta_cia":"","inicio_vigencia":"DD/MM/YYYY (Tokio: do Resumo Embarques; Unimed: Período de Vigência; Chubb: 1ª data da Vigência da pág 2)","fim_vigencia":"DD/MM/YYYY (Tokio: do Resumo Embarques; Unimed: Período de Vigência; Chubb: 2ª data da Vigência da pág 2)","premio_liquido":"ex:1.234,56","vencimento":"DD/MM/YYYY"}` },
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

// ── Parser de planilha (AKAD RC-V e similares) ────────────────────────────────

function normalizarChave(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function valorPorChaves(row, ...candidatas) {
  for (const c of candidatas) {
    const k = normalizarChave(c)
    if (row[k] !== undefined && row[k] !== '') return row[k]
  }
  return ''
}

function formatarData(v) {
  if (v === null || v === undefined || v === '') return ''
  // Se já é string "DD/MM/YYYY", retorna
  const s = String(v).trim()
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s
  // Se é serial Excel (número), converte
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(s)) {
    const dt = XLSX.SSF.parse_date_code(Number(v))
    if (dt) return `${String(dt.d).padStart(2,'0')}/${String(dt.m).padStart(2,'0')}/${dt.y}`
  }
  // Se ISO yyyy-mm-dd
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return s
}

function formatarPremioXlsx(v) {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') return v.toFixed(2).replace('.', ',')
  // Strip prefixo monetário (ex: "R$ 112,50" → "112,50") e espaços
  const limpo = String(v).replace(/r\$\s*/i, '').replace(/\s+/g, '').trim()
  return normalizarPremio(limpo)
}

function parseXLSXFaturas(buffer, nomeArquivo) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const faturas = []
  for (const nomeAba of wb.SheetNames) {
    const ws = wb.Sheets[nomeAba]
    const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' })
    for (const raw of rows) {
      // Normaliza chaves (acento, espaço, case)
      const r = {}
      for (const k of Object.keys(raw)) r[normalizarChave(k)] = raw[k]

      const apolice  = String(valorPorChaves(r, 'Nº Apólice', 'No Apolice', 'Apolice', 'Numero Apolice') || '').trim()
      const endosso  = String(valorPorChaves(r, 'Nº Endosso', 'No Endosso', 'Endosso', 'Numero Endosso') || '').trim()
      const segNome  = String(valorPorChaves(r, 'Seguradora') || '').trim()
      if (!apolice || !segNome) continue // linha vazia

      const fatura = {
        seguradora: segNome,
        apolice,
        endosso,
        ramo: String(valorPorChaves(r, 'Ramo') || '').trim(),
        segurado: String(valorPorChaves(r, 'Cliente', 'Segurado') || '').trim(),
        cnpj: String(valorPorChaves(r, 'CNPJ') || '').trim(),
        emissao: formatarData(valorPorChaves(r, 'Data Emissão', 'Data Emissao', 'Emissao')),
        proposta_cia: String(valorPorChaves(r, 'Proposta Cia', 'Proposta') || '').trim(),
        inicio_vigencia: formatarData(valorPorChaves(r, 'Início Vigência', 'Inicio Vigencia', 'Inicio Vigência')),
        fim_vigencia:    formatarData(valorPorChaves(r, 'Término Vigência', 'Termino Vigencia', 'Termino Vigência', 'Fim Vigencia')),
        premio_liquido:  formatarPremioXlsx(valorPorChaves(r, 'Prêmio Líquido', 'Premio Liquido', 'Premio')),
        vencimento:      formatarData(valorPorChaves(r, 'Vencimento', 'Data Vencimento')),
        subtipoLabel:    String(valorPorChaves(r, 'Sub-tipo Documento', 'Subtipo Documento', 'Sub-tipo') || '').trim(),
        arquivoOriginal: nomeArquivo,
      }
      faturas.push(fatura)
    }
  }
  return faturas
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
  } else if (segLower.includes('akad')) {
    // AKAD: últimos 6 dígitos da "Número da Apólice Akad" (mantém zeros)
    // ex: 027982025010655002035 → 002035 (NÃO usar a Susep, cujos últimos 6 = 020035)
    const apNum = String(apoliceQuiver).replace(/\D/g, '')
    if (apNum.length > 6) apoliceQuiver = apNum.slice(-6)
    // Endosso: últimos 6 dígitos com zeros (ex: 000009)
    if (fatura.endosso) {
      const endNum = String(fatura.endosso).replace(/\D/g, '')
      fatura.endosso = endNum.length >= 6 ? endNum.slice(-6) : endNum.padStart(6, '0')
    }
    // Data do endosso (vigência): primeiro e último dia do mês do "Início de vigência"
    // ex: início 01/05/2026 → vigência 01/05/2026 a 31/05/2026
    const vig = mesCompletoVigencia(fatura.inicio_vigencia)
    if (vig) { fatura.inicio_vigencia = vig.inicio; fatura.fim_vigencia = vig.fim }
    log.info(`  AKAD: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver} | endosso → ${fatura.endosso} | vigência → ${fatura.inicio_vigencia}→${fatura.fim_vigencia}`)
  } else if (segLower.includes('icatu')) {
    // Icatu (seguro de vida): apólice = campo "Nº DA APÓLICE / CONTRATO" SEM os pontos (ex: 93759742)
    apoliceQuiver = String(apoliceQuiver).replace(/\D/g, '')
    // Endosso = "Dados - Nº da fatura" EXATO, sem zeros à esquerda (ex: 20)
    if (fatura.endosso) fatura.endosso = String(fatura.endosso).replace(/\D/g, '').replace(/^0+/, '') || fatura.endosso
    // Sub-tipo no Quiver: FATURA MENSAL (vida em grupo) — também força endosso EXATO no startFatura
    fatura.subtipoLabel = fatura.subtipoLabel || 'FATURA MENSAL'
    log.info(`  Icatu: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver} | endosso → ${fatura.endosso} | subtipo FATURA MENSAL`)
  } else if (segLower.includes('unimed')) {
    // Unimed Seguros (Vida em Grupo): apólice no Quiver = Código do Grupo (ex: 82940)
    // Endosso = Número Fatura (ex: 2682556), sem zeros à esquerda.
    apoliceQuiver = String(apoliceQuiver).replace(/\D/g, '').replace(/^0+/, '') || apoliceQuiver
    if (fatura.endosso) {
      fatura.endosso = String(fatura.endosso).replace(/\D/g, '').replace(/^0+/, '') || fatura.endosso
    }
    log.info(`  Unimed: apólice (Código do Grupo) ${fatura.apolice} → Quiver busca ${apoliceQuiver} | endosso → ${fatura.endosso}`)
  } else if (segLower.includes('axa')) {
    // AXA: formato 02852.2026.0043.RAMO.NNNNNNN
    // Ramo 0654 (RCTR-C)             → últimos 5 dígitos sem zeros
    // Ramo 0655 (RC-DC)              → últimos 4 dígitos sem zeros
    // Ramo 0621 (Transporte Nacional)→ últimos 4 dígitos sem zeros
    // Ramo 0659 (RC-V)               → últimos 3 dígitos sem zeros
    const ramoStr = (fatura.ramo || '').toUpperCase()
    const apSemPontos = apoliceQuiver.replace(/\./g, '')
    if (ramoStr.includes('RC-V') || ramoStr.includes('RCV') || ramoStr.includes('0659') || ramoStr === '59') {
      apoliceQuiver = apSemPontos.slice(-3).replace(/^0+/, '') || apSemPontos.slice(-3)
      log.info(`  AXA RC-V: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver}`)
    } else if (ramoStr.includes('DC') || ramoStr.includes('0655') || ramoStr === '55') {
      apoliceQuiver = apSemPontos.slice(-4).replace(/^0+/, '') || apSemPontos.slice(-4)
      log.info(`  AXA RC-DC: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver}`)
    } else if (ramoStr.includes('TRANSPORTE NACIONAL') || ramoStr.includes('0621') || ramoStr === '21') {
      apoliceQuiver = apSemPontos.slice(-4).replace(/^0+/, '') || apSemPontos.slice(-4)
      log.info(`  AXA Transporte Nacional: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver}`)
    } else {
      apoliceQuiver = apSemPontos.slice(-5).replace(/^0+/, '') || apSemPontos.slice(-5)
      log.info(`  AXA RCTR-C: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver}`)
    }
  } else if (segLower.includes('chubb')) {
    // Chubb: apólice formato AA.RR.NNNNNNN.SS (ex: 23.54.0036010.31)
    // Quiver busca: 3 primeiros campos SEM pontos (ex: 23540036010), descarta o .SS final
    const partes = String(apoliceQuiver).split('.')
    if (partes.length >= 3) {
      apoliceQuiver = partes.slice(0, 3).join('')
    }
    log.info(`  Chubb: apólice ${fatura.apolice} → Quiver busca ${apoliceQuiver} | endosso → ${fatura.endosso}`)
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
      '${fatura.seguradora || ''}','${fatura.subtipoLabel || ''}'
    )`)

    // Aguarda o JS executar todo o fluxo (dados básicos + Prêmios + GRAVAR)
    log.info('Aguardando JS executar fluxo completo (dados básicos + prêmio + gravar)...')
    let gravado = false
    let erroAntes = null
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000)
      gravado = await page.evaluate(() => window.__premioGravado === true)
      erroAntes = await page.evaluate(() => window.__quiverErro || null)
      if (gravado || erroAntes) break
    }

    if (false) {
      // FASE 2 desativada — JS agora faz tudo (volta ao fluxo simples que funcionava)
      log.info('Aba Prêmios pronta. Buscando frame com #Documento_PremioLiquido...')

      const allFrames = page.frames()
      log.info(`Total de frames: ${allFrames.length}`)
      let frameAlvo = null
      let campoIdReal = 'Documento_PremioLiquido'
      for (const fr of allFrames) {
        try {
          const has = await fr.evaluate(() => {
            const el = document.getElementById('Documento_PremioLiquido')
            return !!(el && el.tagName === 'INPUT')
          })
          if (has) { frameAlvo = fr; log.info(`✓ Frame com #Documento_PremioLiquido: ${fr.url().substring(0,80)}`); break }
        } catch {}
      }

      // Fallback de descoberta dinâmica caso o ID mude
      if (!frameAlvo) for (const fr of allFrames) {
        try {
          const found = await fr.evaluate(() => {
            const regex = /^\s*pr[êe]mio l[íi]quido mensal\s*$/i
            const isEditable = (el) => el && el.tagName === 'INPUT' && !el.readOnly && !el.disabled && el.type !== 'hidden'

            // Estratégia A: aria-label / placeholder com texto exato
            for (const i of document.querySelectorAll('input')) {
              const lab = (i.getAttribute('aria-label') || '') + ' ' + (i.getAttribute('placeholder') || '')
              if (regex.test(lab.trim()) && isEditable(i)) {
                return { id: i.id, name: i.name, value: i.value, via: 'aria/placeholder' }
              }
            }

            // Estratégia B: encontra elemento de texto exato "Prêmio líquido mensal"
            // e busca input EDITÁVEL adjacente (label-for, next-sibling, célula vizinha)
            const elsTexto = []
            for (const el of document.querySelectorAll('label, span, td, div')) {
              const t = (el.textContent || '').trim()
              if (regex.test(t)) elsTexto.push(el)
            }
            for (const l of elsTexto) {
              // (1) label[for]
              const forId = l.getAttribute && l.getAttribute('for')
              if (forId) { const el = document.getElementById(forId); if (isEditable(el)) return { id: el.id, name: el.name, value: el.value, via: 'label-for' } }
              // (2) próximo input no fluxo do DOM
              let n = l.nextElementSibling
              while (n) {
                if (n.tagName === 'INPUT' && isEditable(n)) return { id: n.id, name: n.name, value: n.value, via: 'sibling' }
                const inner = n.querySelector && n.querySelector('input')
                if (isEditable(inner)) return { id: inner.id, name: inner.name, value: inner.value, via: 'sibling-inner' }
                n = n.nextElementSibling
              }
              // (3) célula <td> vizinha
              const td = l.closest && l.closest('td')
              if (td) {
                let sib = td.nextElementSibling
                while (sib) {
                  const inp = sib.querySelector && sib.querySelector('input')
                  if (isEditable(inp)) return { id: inp.id, name: inp.name, value: inp.value, via: 'td-next' }
                  sib = sib.nextElementSibling
                }
              }
              // (4) input EDITÁVEL mais próximo dentro do mesmo <tr> (depois do label)
              const tr = l.closest && l.closest('tr')
              if (tr) {
                const inputs = Array.from(tr.querySelectorAll('input')).filter(isEditable)
                if (inputs.length) return { id: inputs[0].id, name: inputs[0].name, value: inputs[0].value, via: 'tr-input' }
              }
            }

            // Estratégia C (debug): retorna todos inputs editáveis com label próximo
            const dump = []
            for (const i of document.querySelectorAll('input')) {
              if (!isEditable(i)) continue
              const idn = ((i.id || '') + ' ' + (i.name || '')).toLowerCase()
              if (idn.includes('premio') || idn.includes('mensal') || idn.includes('liquido') || idn.includes('liq')) {
                dump.push({ id: i.id, name: i.name, value: i.value })
              }
            }
            return dump.length ? { id: dump[0].id, name: dump[0].name, value: dump[0].value, via: 'fallback', candidatos: dump } : null
          })
          if (found) {
            frameAlvo = fr
            campoIdReal = found.id
            log.info(`✓ Frame "Prêmio líquido mensal" — ID="${found.id}" name="${found.name}" via=${found.via}`)
            if (found.candidatos) log.info(`  candidatos: ${JSON.stringify(found.candidatos)}`)
            break
          }
        } catch {}
      }

      if (frameAlvo && campoIdReal) {
        try {
          const premioVal = await page.evaluate(() => window.__premioParaDigitar)
          log.info(`Digitando prêmio "${premioVal}" em #${campoIdReal}`)

          // Lista todos inputs Prêmio/Mensal antes da digitação (debug)
          const inputsAntes = await frameAlvo.evaluate(() => {
            return Array.from(document.querySelectorAll('input')).filter(i => {
              const idn = ((i.id||'') + ' ' + (i.name||'')).toLowerCase()
              return idn.includes('premio') || idn.includes('mensal') || idn.includes('iof')
            }).map(i => ({ id: i.id, value: i.value, readonly: i.readOnly }))
          }).catch(() => [])
          log.info(`Inputs Prêmio/IOF antes: ${JSON.stringify(inputsAntes)}`)

          // DEBUG: inspeciona TODOS os atributos do elemento pra achar onde está o postback real
          const attrs = await frameAlvo.evaluate((id) => {
            const el = document.getElementById(id)
            if (!el) return null
            const out = { tagName: el.tagName, type: el.type, outerHTML: el.outerHTML.substring(0, 400) }
            for (const a of el.attributes) out[a.name] = a.value.substring(0, 200)
            return out
          }, campoIdReal)
          log.info(`Atributos #${campoIdReal}: ${JSON.stringify(attrs)}`)

          // DEBUG: localiza qualquer elemento com onclick/texto contendo "AbrePremio" ou "Abrir"
          const toggles = await frameAlvo.evaluate(() => {
            const results = []
            for (const el of document.querySelectorAll('a, input, button, span, label, div, img')) {
              const oc = (el.getAttribute('onclick') || '') + ' ' + (el.getAttribute('onchange') || '')
              const txt = (el.textContent || '').trim().substring(0, 80)
              const id = el.id || ''
              const cls = el.className || ''
              const matches = /abrepremio|abrirpremio|abrir.?pr[êe]mio|premioaberto|premioschk|abrir.?fatura|chk.?premio|liberar.?pr[êe]mio/i
              if (matches.test(oc) || matches.test(txt) || matches.test(id) || matches.test(cls)) {
                results.push({ tag: el.tagName, id, cls: cls.substring(0,60), txt, onclick: oc.substring(0,150), type: el.type })
              }
            }
            return results.slice(0, 15)
          }).catch(() => [])
          log.info(`Toggles encontrados: ${JSON.stringify(toggles)}`)

          // Estratégia FINAL: o campo está disabled + cálculo é via eventoAjaxJQuery('PremioLiquidoOnBlur')
          // 1) Remove disabled
          // 2) Set value + onfocus (SetOldValue) + onchange (SetUpdate+Chkvalor) + onkeyup (ChkNumber)
          // 3) Chama eventoAjaxJQuery('PremioLiquidoOnBlur') que faz AJAX ao servidor → recalcula IOF + total
          const aplicacao = await frameAlvo.evaluate((args) => {
            const { id, valor } = args
            const el = document.getElementById(id)
            if (!el) return { ok: false, erro: 'campo nao encontrado' }
            el.scrollIntoView({ block: 'center' })

            const estavaDisabled = el.disabled
            if (estavaDisabled) { el.disabled = false; el.removeAttribute('disabled') }

            // Captura valor antigo (Quiver compara via SetOldValue)
            el.focus()
            try { if (typeof window.SetOldValue === 'function') window.SetOldValue(el) } catch {}

            // Define novo valor
            el.value = valor
            // Dispara eventos de teclado e change (handlers inline)
            for (const evt of ['keydown','keypress','input','keyup','change']) {
              el.dispatchEvent(new Event(evt, { bubbles: true }))
            }
            try { (new Function(el.getAttribute('onchange') || '')).call(el) } catch {}

            // CHAMA O CÁLCULO REAL DO QUIVER (via AJAX jQuery)
            let ajaxOk = false
            try {
              if (typeof window.eventoAjaxJQuery === 'function') {
                window.eventoAjaxJQuery('PremioLiquidoOnBlur')
                ajaxOk = true
              }
            } catch (e) {}

            // Dispara onblur inline também (redundância)
            try { (new Function(el.getAttribute('onblur') || '')).call(el) } catch {}
            el.dispatchEvent(new Event('blur', { bubbles: true }))

            return { ok: true, valorFinal: el.value, estavaDisabled, ajaxOk }
          }, { id: campoIdReal, valor: premioVal })
          log.info(`Aplicação prêmio: ${JSON.stringify(aplicacao)}`)
          log.info('✓ AJAX disparado, aguardando recálculo no servidor...')

          // Aguarda AJAX servidor + recálculo de IOF e Prêmio Mensal
          await page.waitForTimeout(8000)

          // Valida estado pós-Tab — verifica se Prêmio Total foi recalculado
          const pos = await frameAlvo.evaluate(() => {
            const v = id => { const e = document.getElementById(id); return e ? e.value : null }
            return {
              premioLiquido: v('Documento_PremioLiquido'),
              premioLiqDesc: v('Documento_PremioLiqDesc'),
              percIof: v('Documento_PercIof'),
              iof: v('Documento_Iof'),
              premioTotal: v('Documento_PremioTotal'),
              premioTotal2: v('Documento_PremioTotal2'),
            }
          }).catch(() => ({}))
          log.info(`Estado pós-Tab: ${JSON.stringify(pos)}`)
          const premioOk = pos.premioTotal && pos.premioTotal !== '0,00' && pos.premioLiquido !== '0,00'
          if (!premioOk) {
            log.warn(`⚠️ Prêmio não persistiu (liq=${pos.premioLiquido} total=${pos.premioTotal}). NÃO vai gravar.`)
            await page.evaluate(() => { window.__quiverErro = 'PREMIO_NAO_PERSISTIU' })
          } else {
            log.info(`✓ Prêmio recalculado: líq=${pos.premioLiquido} IOF=${pos.iof} total=${pos.premioTotal}. Clicando GRAVAR...`)
            // Clica GRAVAR via JS (rodapé)
            await page.evaluate(() => {
              const d2 = window.getDoc2(); if (!d2) { window.__quiverErro = 'IFRAME_PERDIDO_GRAVAR'; return }
              const btn = d2.getElementById('BtGravar')
              if (!btn) { window.__quiverErro = 'BT_GRAVAR_NAO_ENCONTRADO'; return }
              btn.click()
            })
            await page.waitForTimeout(2500)
          }

          await page.evaluate(() => {
            const d2 = window.getDoc2(); if (!d2) return
            window.clickBtn(d2, 'OK')
            const errs = window.lerErros(d2)
            if (errs && !window.__quiverErro) window.__quiverErro = 'GRAVAR2:' + errs
          })
          await page.waitForTimeout(2000)
        } catch (e) {
          log.error(`Falha digitar+Tab: ${e.message.substring(0, 150)}`)
          await page.evaluate((m) => { window.__quiverErro = 'TAB_PLAYWRIGHT:' + m }, e.message.substring(0, 100))
        }
      } else {
        log.error('Campo editável "Prêmio líquido mensal" não localizado em nenhum frame!')
        // Debug: lista TODOS inputs do frame mais provável
        try {
          for (const fr of allFrames) {
            const dump = await fr.evaluate(() => {
              return Array.from(document.querySelectorAll('input')).slice(0, 60).map(i => ({ id: i.id, name: i.name, type: i.type, readonly: i.readOnly }))
            }).catch(() => null)
            if (dump && dump.length > 5) {
              log.info(`Dump frame ${fr.url().substring(0,60)}: ${JSON.stringify(dump).substring(0,800)}`)
            }
          }
        } catch {}
        await page.evaluate(() => { window.__quiverErro = 'CAMPO_PREMIO_MENSAL_NAO_ENCONTRADO' })
      }
    }
    if (erroAntes) log.warn(`Erro JS: ${erroAntes}`)
    if (!gravado && !erroAntes) log.warn('Timeout — JS não sinalizou __premioGravado.')

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
  // Upload pode chegar em VÁRIOS chunks (lotes grandes que estouram o limite ~100MB
  // do Cloudflare por requisição). Acumulamos em PENDENTES e só processamos quando
  // chega o chunk final. Sem 'jobId'/'final' = envio único (comportamento original,
  // usado pelo drive-watcher e pela página de transporte).
  const recebidos = req.files || []
  const ehFinal   = req.body?.final !== 'false' // ausente ou 'true' => processar agora
  let   jobId     = (req.body?.jobId || '').trim()

  if (jobId) {
    if (!JOBS.has(jobId)) return res.status(404).json({ erro: 'Job não encontrado (pode ter expirado). Reinicie o envio.' })
    PENDENTES.set(jobId, (PENDENTES.get(jobId) || []).concat(recebidos))
  } else {
    if (!recebidos.length) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' })
    jobId = criarJob(recebidos.length)
    PENDENTES.set(jobId, recebidos.slice())
  }

  const arquivos = PENDENTES.get(jobId) || []
  atualizar(jobId, { total: arquivos.length, status: ehFinal ? 'extraindo' : 'recebendo' })

  // Ainda há chunks por vir — confirma recebimento parcial e aguarda o resto.
  if (!ehFinal) return res.json({ ok: true, jobId, recebidos: arquivos.length, aguardandoMais: true })

  // Chunk final (ou envio único): processa TODOS os arquivos acumulados.
  PENDENTES.delete(jobId)
  if (!arquivos.length) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' })
  const nPdf  = arquivos.filter(a => a.originalname.toLowerCase().endsWith('.pdf')).length
  const nXls  = arquivos.filter(a => /\.(xlsx|xls)$/i.test(a.originalname)).length
  log.info(`Job ${jobId} — ${arquivos.length} arquivo(s) (${nPdf} PDF, ${nXls} XLSX)`)

  res.json({ ok: true, jobId, mensagem: `${arquivos.length} arquivo(s) recebido(s). Processando.` })

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

        // XLSX: planilha de faturas (uma linha por fatura — ex: AKAD RC-V)
        if (/\.(xlsx|xls)$/i.test(arq.originalname)) {
          try {
            const buf = fs.readFileSync(arq.path)
            const linhas = parseXLSXFaturas(buf, arq.originalname)
            if (linhas.length) {
              faturas.push(...linhas)
              log.ok(`Planilha ${arq.originalname}: ${linhas.length} fatura(s) extraída(s)`)
            } else {
              const curr = JOBS.get(jobId)
              atualizar(jobId, { resultados: [...curr.resultados, {
                segurado: arq.originalname, apolice: '—', endosso: '—', ramo: '—',
                premio_liquido: '—', vencimento: '—', status: 'FALHA',
                tipo: 'EXTRACAO_FALHOU', label: 'Planilha sem linhas válidas',
                orientacao: 'Verifique cabeçalhos: Nº Apólice, Nº Endosso, Seguradora, Início/Término Vigência, Data Emissão, Prêmio Líquido, Vencimento.',
                screenshotPath: null,
              }]})
            }
          } catch (e) {
            log.error(`XLSX ${arq.originalname}: ${e.message}`)
            const curr = JOBS.get(jobId)
            atualizar(jobId, { resultados: [...curr.resultados, {
              segurado: arq.originalname, apolice: '—', endosso: '—', ramo: '—',
              premio_liquido: '—', vencimento: '—', status: 'FALHA',
              tipo: 'EXTRACAO_FALHOU', label: 'Erro ao ler planilha',
              orientacao: 'Verifique se o XLSX está íntegro.', erro: e.message, screenshotPath: null,
            }]})
          }
          try { fs.unlinkSync(arq.path) } catch {}
          continue
        }

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

    // ── Cadastro Quiver (com retry de falhas transitórias + isolamento de crash) ──
    // Em lotes grandes a sessão do Quiver degrada e aparecem falhas transitórias
    // ("Erro ao gravar", timeouts do portal). Antes, cada falha era definitiva e um
    // crash de página abortava TODO o lote. Agora reentamos falhas transitórias e,
    // num crash duro, relançamos o browser sem perder o restante das faturas.
    const RETRYABLE = new Set(['ERRO_GRAVAR', 'MSG069', 'IFRAME_TIMEOUT', 'TIMEOUT'])
    const MAX_TENTATIVAS = 3 // 1 inicial + 2 retentativas (só p/ erros transitórios)

    let { browser, page } = await abrirBrowser()

    // Cadastra uma fatura tolerando falhas transitórias e crash de página/browser.
    // NÃO reenta erros de dados (apólice não encontrada, endosso duplicado, vigência).
    const cadastrarComRetry = async (fatura, i) => {
      let ultimo = null
      for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        try {
          const r = await cadastrarFatura(page, fatura, i)
          if (r.status === 'OK' || !RETRYABLE.has(r.tipo)) return r // sucesso ou falha definitiva
          ultimo = r
          if (tentativa < MAX_TENTATIVAS) {
            log.warn(`Retry ${tentativa}/${MAX_TENTATIVAS - 1} [${fatura.apolice}] — ${r.label}`)
            await page.waitForTimeout(2000)
            try { await recuperarSessao(page) } catch {}
          }
        } catch (e) {
          // Crash duro: página/browser pode ter morrido. Relança e segue o lote.
          log.error(`Crash no cadastro [${fatura.apolice}] (tentativa ${tentativa}): ${e.message}`)
          ultimo = { ...fatura, status: 'FALHA', erro: e.message, screenshotPath: null, ...classificarErro(e.message) }
          if (tentativa < MAX_TENTATIVAS) {
            try { await fecharBrowser(browser) } catch {}
            try {
              ;({ browser, page } = await abrirBrowser())
              await loginQuiver(page)
              log.ok('Browser relançado após crash — lote continua.')
            } catch (e2) { log.error(`Falha ao relançar browser: ${e2.message}`) }
          }
        }
      }
      return ultimo
    }

    try {
      await loginQuiver(page)
      for (let i = 0; i < faturas.length; i++) {
        const resultado = await cadastrarComRetry(faturas[i], i)
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
