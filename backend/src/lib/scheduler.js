// src/lib/scheduler.js
// Agendador de jobs automáticos — usa node-cron
// Horários e dias da semana configuráveis por seguradora via painel de configurações
//
// Formato do campo "cron" no painel:
//   "seg,qua,sex@08:00"         → Roda seg, qua e sex às 08:00
//   "ter,qui@08:00,14:00"       → Roda ter e qui às 08:00 e 14:00
//   "seg,ter,qua,qui,sex@09:30" → Roda seg a sex (dias úteis) às 09:30
//   ""                          → Desativado

const cron = require('node-cron')
const log  = require('./logger')
const { getCred } = require('../jobs/config')
const http = require('http')

// ── Mapa de chave config → rota do backend ───────────────────────────────────
const JOBS_AGENDAVEIS = {
  allianz:          '/api/allianz-inadimplentes/executar',
  tokio:            '/api/tokio-inadimplentes/executar',
  axa:              '/api/axa-inadimplentes/executar',
  chubb:            '/api/chubb-inadimplentes/executar',
  sompo:            '/api/sompo-inadimplentes/executar',
  akad:             '/api/akad-inadimplentes/executar',
  yelum:            '/api/yelum-inadimplentes/executar',
  mitsui:           '/api/mitsui-inadimplentes/executar',
  essor:            '/api/essor-inadimplentes/executar',
  metlife:          '/api/metlife-inadimplentes/executar',
  unimed_seguros:   '/api/unimed-seguros-inadimplentes/executar',
  unimed_boletos:   '/api/unimed-boletos/executar',
  porto_seguro:     '/api/porto-seguro-inadimplentes/executar',
  plano_hospitalar: '/api/plano-hospitalar/executar',
}

// Giacomet — mesmas rotas, corretora injetada no body
const JOBS_AGENDAVEIS_GIACOMET = {
  giacomet_allianz:      '/api/giacomet-allianz-inadimplentes/executar',
  giacomet_akad:         '/api/giacomet-akad-inadimplentes/executar',
  giacomet_yelum:        '/api/giacomet-yelum-inadimplentes/executar',
  giacomet_mitsui:       '/api/giacomet-mitsui-inadimplentes/executar',
  giacomet_unimed:       '/api/giacomet-unimed-inadimplentes/executar',
  giacomet_metlife:      '/api/giacomet-metlife-inadimplentes/executar',
  giacomet_tokio:        '/api/giacomet-tokio-inadimplentes/executar',
  giacomet_axa:          '/api/giacomet-axa-inadimplentes/executar',
  giacomet_chubb:        '/api/giacomet-chubb-inadimplentes/executar',
  giacomet_sompo:        '/api/giacomet-sompo-inadimplentes/executar',
  giacomet_essor:        '/api/giacomet-essor-inadimplentes/executar',
  giacomet_porto_seguro: '/api/giacomet-porto-seguro-inadimplentes/executar',
}

const TODOS_JOBS = { ...JOBS_AGENDAVEIS, ...JOBS_AGENDAVEIS_GIACOMET }

const PORT = process.env.PORT || 3001

// ── Mapa de dia abreviado → número cron ──────────────────────────────────────
const DIA_PARA_CRON = {
  dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6,
}

const DIAS_LABELS = {
  0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab',
}

// ── Dispara job via HTTP local ───────────────────────────────────────────────
function dispararJob(chave, rota) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: rota,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          log.ok(`[CRON] ${chave} disparado — jobId: ${data.jobId || '?'}`)
        } catch {
          log.ok(`[CRON] ${chave} disparado — status ${res.statusCode}`)
        }
        resolve()
      })
    })
    req.on('error', (e) => {
      log.error(`[CRON] Erro ao disparar ${chave}: ${e.message}`)
      resolve()
    })
    req.write('{}')
    req.end()
  })
}

// ── Parser do novo formato: "seg,qua,sex@08:00,14:00" ──────────────────────
function parsearCronConfig(valor) {
  if (!valor || typeof valor !== 'string') return []

  const str = valor.trim().toLowerCase()
  if (!str) return []

  // Formato: DIAS@HORARIOS
  // Suporte legado: só "HH:MM" sem @ → assume seg-sex
  let diasPart, horariosPart

  if (str.includes('@')) {
    const parts = str.split('@')
    diasPart = parts[0].trim()
    horariosPart = parts[1].trim()
  } else {
    // Formato legado: "08:00" ou "08:00,14:00" → seg-sex
    diasPart = 'seg,ter,qua,qui,sex'
    horariosPart = str
  }

  // Parse dias
  const diasStr = diasPart.split(',').map(d => d.trim()).filter(Boolean)
  const diasCron = diasStr
    .map(d => DIA_PARA_CRON[d])
    .filter(n => n !== undefined)

  if (diasCron.length === 0) return []

  // Parse horários
  const horarios = horariosPart.split(',').map(h => h.trim()).filter(Boolean)
  const resultado = []

  for (const horario of horarios) {
    const match = horario.match(/^(\d{1,2}):(\d{2})$/)
    if (!match) continue
    const hora = parseInt(match[1])
    const min  = parseInt(match[2])
    if (hora < 0 || hora > 23 || min < 0 || min > 59) continue

    const diasExpr = diasCron.join(',')
    const cronExpr = `${min} ${hora} * * ${diasExpr}`

    const diasLabels = diasCron.map(n => DIAS_LABELS[n]).join(',')
    resultado.push({
      horario,
      dias: diasLabels,
      cron: cronExpr,
      descricao: `${diasLabels} às ${horario}`,
    })
  }

  return resultado
}

// ── Store de tarefas ativas ──────────────────────────────────────────────────
const tarefasAtivas = new Map() // chave → [ScheduledTask, ...]

function pararTodas() {
  for (const [chave, tarefas] of tarefasAtivas) {
    for (const t of tarefas) t.stop()
  }
  tarefasAtivas.clear()
}

// ── Recarrega agendamentos do config ─────────────────────────────────────────
function recarregar() {
  pararTodas()
  let total = 0

  for (const [chave, rota] of Object.entries(TODOS_JOBS)) {
    const cred = getCred(chave)
    const cronStr = cred.cron || ''
    if (!cronStr) continue

    const agendamentos = parsearCronConfig(cronStr)
    if (agendamentos.length === 0) continue

    const tarefas = []
    for (const ag of agendamentos) {
      const tarefa = cron.schedule(ag.cron, () => {
        log.info(`[CRON] Executando ${chave} (agendado: ${ag.descricao})...`)
        dispararJob(chave, rota)
      }, { timezone: 'America/Sao_Paulo' })
      tarefas.push(tarefa)
      total++
      log.info(`[CRON] ${chave} agendado: ${ag.descricao}`)
    }
    tarefasAtivas.set(chave, tarefas)
  }

  if (total === 0) {
    log.info('[CRON] Nenhum job agendado. Configure dias e horários no painel (campo "cron").')
  } else {
    log.ok(`[CRON] ${total} agendamento(s) ativo(s).`)
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

function iniciarScheduler() {
  log.info('[CRON] Iniciando scheduler...')
  recarregar()

  // Recarrega a cada 5 min (pega mudanças do painel sem restart)
  setInterval(recarregar, 5 * 60 * 1000)
}

function listarAgendamentos() {
  const lista = []
  for (const [chave, rota] of Object.entries(TODOS_JOBS)) {
    const cred = getCred(chave)
    const cronStr = cred.cron || ''
    const agendamentos = parsearCronConfig(cronStr)
    const ativo = tarefasAtivas.has(chave)
    lista.push({
      chave,
      rota,
      cron: cronStr || null,
      agendamentos: agendamentos.map(a => a.descricao),
      ativo,
    })
  }
  return lista
}

module.exports = { iniciarScheduler, recarregar, listarAgendamentos }
