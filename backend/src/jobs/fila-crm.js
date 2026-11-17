// src/jobs/fila-crm.js
// Fila do CRM (módulo Faturamento) → cadastro no Quiver.
//
// O CRM guarda a fila: a fatura já enviada ao segurado é autorizada por quem opera e fica "na fila". Este processo pergunta ao CRM
// qual é a próxima, grava no Quiver com o MESMO robô do upload (cadastrarFatura, em modo estrito) e devolve o resultado. Só faz
// conexão de saída: nada novo fica exposto neste servidor.
//
// Liga sozinho no boot se CRM_FILA_URL e CRM_FILA_TOKEN estiverem no .env; sem eles não faz nada.
//
// Regras do modo estrito (diferentes do upload pela tela):
//   - endosso que já existe NÃO é regravado: volta "duplicado" (o CRM marca "já estava no Quiver");
//   - sem o sinal de gravação em 60 s é FALHA, nunca "OK";
//   - todo sucesso leva um print da tela como comprovante — o CRM recusa "cadastrada" sem ele;
//   - uma fatura por vez, e a fila espera se houver lote de upload rodando (mesmo usuário do Quiver).
const fs = require('fs')
const log = require('../lib/logger')
const { abrirBrowser, fecharBrowser } = require('../lib/browser')
const robo = require('./quiver-faturas-transporte')

const URL = process.env.CRM_FILA_URL
const TOKEN = process.env.CRM_FILA_TOKEN
const INTERVALO_MS = Math.max(15, Number(process.env.CRM_FILA_INTERVALO) || 60) * 1000
const PAUSA_ENTRE_FATURAS_MS = 3000
const MAX_FALHAS_PORTAL = 3               // seguidas: o Quiver está fora, a fila descansa
const DESCANSO_PORTAL_MS = 15 * 60 * 1000
const MAX_COMPROVANTE_BYTES = 2 * 1024 * 1024
const TECNICOS = new Set(['ERRO_GRAVAR', 'MSG069', 'IFRAME_TIMEOUT', 'TIMEOUT'])
// Tempo máximo de cada etapa. O Playwright não tem limite em page.evaluate: com o Quiver fora do ar a página fica muda e a chamada
// nunca volta (17/11/2026: a fila ficou presa numa fatura por mais de 8 minutos). Passou do limite, o navegador é fechado.
const LIMITE_LOGIN_MS = 60 * 1000
// O MINI-02 às vezes não resolve o endereço do Quiver por alguns segundos (ERR_NAME_NOT_RESOLVED, 17/11/2026). Antes de desistir de
// entrar, o robô insiste: nada foi gravado ainda, então repetir é seguro e não gasta uma tentativa da fatura.
const TENTATIVAS_LOGIN = 4
const ESPERA_ENTRE_LOGINS_MS = 20 * 1000
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const LIMITE_CADASTRO_MS = 4 * 60 * 1000
const LIMITE_FECHAR_MS = 20 * 1000
class TempoEsgotado extends Error {}
function comLimite(promessa, ms) {
  let t
  return Promise.race([promessa, new Promise((_, rej) => { t = setTimeout(() => rej(new TempoEsgotado(`passou de ${Math.round(ms / 1000)}s`)), ms) })])
    .finally(() => clearTimeout(t))
}
// Vida em grupo: sub-tipo do Quiver conhecido só para estas seguradoras (o robô já trata as duas). Para as demais o CRM precisa mandar
// "subtipo_label"; sem isso a fatura volta como exceção, em vez de ser gravada com o sub-tipo de transporte.
const VIDA_CONHECIDA = ['unimed', 'icatu']

let sessao = null        // { browser, page }
let falhasPortal = 0
let rodando = false

const limpar = (v) => String(v == null ? '' : v).replace(/['"`\\\r\n]/g, ' ').trim()

async function chamar(corpo) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-robo-token': TOKEN },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(60000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`CRM ${r.status}: ${String(j.erro || '').slice(0, 200)}`)
  return j
}

async function abrirSessao() {
  if (sessao) return sessao
  const { browser, page } = await abrirBrowser()
  await robo.loginQuiver(page)
  sessao = { browser, page }
  return sessao
}
async function fecharSessao() {
  if (!sessao) return
  const b = sessao.browser
  sessao = null
  await comLimite(fecharBrowser(b), LIMITE_FECHAR_MS).catch((e) => log.warn(`[fila-crm] navegador não fechou direito: ${e.message}`))
}

/** Fatura da fila → objeto que o robô entende (mesmo formato do upload). */
function paraRobo(item) {
  return {
    seguradora: limpar(item.seguradora),
    apolice: limpar(item.apolice),
    endosso: limpar(item.endosso),
    ramo: limpar(item.ramo),
    segurado: limpar(item.segurado),
    cnpj: limpar(item.cnpj),
    emissao: limpar(item.emissao),
    proposta_cia: limpar(item.proposta_cia),
    inicio_vigencia: limpar(item.inicio_vigencia),
    fim_vigencia: limpar(item.fim_vigencia),
    premio_liquido: limpar(item.premio_liquido),
    vencimento: limpar(item.vencimento),
    subtipoLabel: limpar(item.subtipo_label),
    arquivoOriginal: `fila-crm-${item.id}`,
  }
}

function lerComprovante(caminho) {
  try {
    if (!caminho) return null
    const b = fs.readFileSync(caminho)
    return b.length > 0 && b.length <= MAX_COMPROVANTE_BYTES ? b.toString('base64') : null
  } catch { return null }
}

/** Processa UMA fatura e devolve o corpo do resultado para o CRM. */
async function processar(item) {
  const fatura = paraRobo(item)
  const seg = fatura.seguradora.toLowerCase()
  for (const k of ['seguradora', 'apolice', 'endosso', 'emissao', 'inicio_vigencia', 'fim_vigencia', 'premio_liquido', 'vencimento']) {
    if (!fatura[k]) return { ok: false, tecnico: false, erro_tipo: 'DADO_FALTANDO', erro: `Fatura sem ${k} — completar no CRM` }
  }
  if (item.tipo === 'vida' && !fatura.subtipoLabel && !VIDA_CONHECIDA.some((s) => seg.includes(s))) {
    return { ok: false, tecnico: false, erro_tipo: 'SUBTIPO_VIDA_NAO_DEFINIDO',
      erro: `Sub-tipo de vida em grupo não definido para ${fatura.seguradora}: informar o texto do sub-tipo do Quiver` }
  }
  if (item.tipo !== 'vida' && item.tipo !== 'carga') {
    return { ok: false, tecnico: false, erro_tipo: 'TIPO_INVALIDO', erro: `Tipo "${item.tipo}" não é carga nem vida` }
  }

  let r
  try {
    let page
    let erroLogin = null
    for (let n = 1; n <= TENTATIVAS_LOGIN && !page; n++) {
      try {
        ({ page } = await comLimite(abrirSessao(), LIMITE_LOGIN_MS))
      } catch (e) {
        erroLogin = e
        await fecharSessao()
        log.warn(`[fila-crm] não entrou no Quiver (${n}/${TENTATIVAS_LOGIN}): ${String(e.message || e).split('\n')[0].slice(0, 160)}`)
        if (n < TENTATIVAS_LOGIN) await dormir(ESPERA_ENTRE_LOGINS_MS)
      }
    }
    if (!page) {
      // não chegou a entrar no Quiver: nada foi gravado, pode tentar de novo mais tarde
      falhasPortal++
      return { ok: false, tecnico: true, erro_tipo: 'TIMEOUT',
        erro: `Não foi possível entrar no Quiver depois de ${TENTATIVAS_LOGIN} tentativas: ${String((erroLogin && erroLogin.message) || erroLogin).split('\n')[0].slice(0, 300)}` }
    }
    try {
      r = await comLimite(robo.cadastrarFatura(page, fatura, 0, { estrito: true, apoliceQuiver: limpar(item.apolice_quiver) || null }), LIMITE_CADASTRO_MS)
    } catch (e) {
      if (!(e instanceof TempoEsgotado)) throw e
      // travou no meio do cadastro: não dá para saber se gravou. Não tenta de novo sozinho — alguém confere no Quiver.
      await fecharSessao()
      falhasPortal++
      return { ok: false, tecnico: false, erro_tipo: 'CONFERIR_NO_QUIVER',
        erro: `O robô travou durante o cadastro (${e.message}). Conferir no Quiver se o endosso foi gravado antes de mandar de novo.` }
    }
  } catch (e) {
    // navegador ou sessão morreram: fecha tudo; a próxima tentativa abre de novo
    await fecharSessao()
    falhasPortal++
    return { ok: false, tecnico: true, erro_tipo: 'TIMEOUT', erro: `Sessão do Quiver caiu: ${String(e.message || e).slice(0, 300)}` }
  }

  const comprovante_base64 = lerComprovante(r.screenshotPath)
  if (r.status === 'OK') {
    falhasPortal = 0
    if (!comprovante_base64) {
      // gravou, mas não há prova: quem opera confere no Quiver antes de dar como cadastrada
      return { ok: false, tecnico: false, erro_tipo: 'CONFERIR_NO_QUIVER', erro: 'O robô concluiu, mas não conseguiu tirar o comprovante. Conferir no Quiver.' }
    }
    return { ok: true, comprovante_base64, apolice_buscada: limpar(item.apolice_quiver) || fatura.apolice }
  }
  if (robo.ehFalhaPortalQuiver(r)) falhasPortal++; else falhasPortal = 0
  if (r.tipo === 'ENDOSSO_DUPLICADO') {
    // Numa 2ª tentativa, "duplicado" pode ser a 1ª que gravou pela metade (documento criado sem o prêmio): não dá para afirmar que está certo.
    if (Number(item.tentativa) > 1) {
      return { ok: false, tecnico: false, erro_tipo: 'CONFERIR_NO_QUIVER', comprovante_base64,
        erro: 'O endosso apareceu como já existente numa nova tentativa: pode ter sido gravado sem o prêmio. Conferir no Quiver.' }
    }
    return { ok: false, duplicado: true, comprovante_base64, erro: 'Endosso já existe no Quiver (MSG097)' }
  }
  return { ok: false, tecnico: TECNICOS.has(r.tipo), erro_tipo: r.tipo || 'OUTRO', comprovante_base64,
    erro: `${r.label || 'Falha'}${r.erro && r.erro !== r.label ? ` — ${String(r.erro).slice(0, 300)}` : ''}` }
}

async function ciclo() {
  if (rodando) return
  rodando = true
  let proximo = INTERVALO_MS
  try {
    if (robo.temJobAtivo()) return            // lote de upload rodando: espera
    if (falhasPortal >= MAX_FALHAS_PORTAL) {  // Quiver fora: descansa e zera
      log.warn(`[fila-crm] ${falhasPortal} falhas seguidas do portal — pausa de ${DESCANSO_PORTAL_MS / 60000} min`)
      falhasPortal = 0
      await fecharSessao()
      proximo = DESCANSO_PORTAL_MS
      return
    }
    const { item } = await chamar({ acao: 'pegar', robo: 'ferramentas-jacometo' })
    if (!item) { await fecharSessao(); return }   // fila vazia: não deixa navegador aberto à toa
    log.info(`[fila-crm] fatura ${item.id} (${item.seguradora} ${item.apolice}/${item.endosso}, tentativa ${item.tentativa})`)
    const resultado = await processar(item)
    const resp = await chamar({ acao: 'resultado', id: item.id, ...resultado })
    log[resultado.ok ? 'ok' : 'warn'](`[fila-crm] fatura ${item.id} → ${resp.situacao_quiver}${resultado.erro ? ` (${resultado.erro})` : ''}`)
    proximo = PAUSA_ENTRE_FATURAS_MS            // tinha fatura: olha a próxima logo
  } catch (e) {
    log.error(`[fila-crm] ${e.message}`)
  } finally {
    rodando = false
    setTimeout(ciclo, proximo).unref?.()
  }
}

function iniciar() {
  if (!URL || !TOKEN) { log.info('[fila-crm] desligada (CRM_FILA_URL / CRM_FILA_TOKEN ausentes no .env)'); return false }
  log.ok(`[fila-crm] ligada — consulta a cada ${INTERVALO_MS / 1000}s`)
  setTimeout(ciclo, 10000).unref?.()
  return true
}

module.exports = { iniciar, processar, paraRobo }
