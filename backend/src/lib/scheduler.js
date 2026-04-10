// src/lib/scheduler.js
// Agendador de jobs automáticos — usa node-cron
// Horários configuráveis por seguradora via painel de configurações
// Roda apenas seg-sex (dias úteis)

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

const PORT = process.env.PORT || 3001

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

// ── Converte "HH:MM" para expressão cron (seg-sex) ──────────────────────────
function horarioParaCron(horario) {
  const match = horario.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hora = parseInt(match[1])
  const min  = parseInt(match[2])
  if (hora < 0 || hora > 23 || min < 0 || min > 59) return null
  return `${min} ${hora} * * 1-5` // seg(1) a sex(5)
}

// ── Múltiplos horários: "08:00,14:00" → array de crons ──────────────────────
function parsearHorarios(valor) {
  if (!valor || typeof valor !== 'string') return []
  return valor.split(',')
    .map(h => h.trim())
    .filter(Boolean)
    .map(h => ({ horario: h, cron: horarioParaCron(h) }))
    .filter(h => h.cron)
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

  for (const [chave, rota] of Object.entries(JOBS_AGENDAVEIS)) {
    const cred = getCred(chave)
    const horarioStr = cred.cron || ''
    if (!horarioStr) continue

    const horarios = parsearHorarios(horarioStr)
    if (horarios.length === 0) continue

    const tarefas = []
    for (const { horario, cron: expr } of horarios) {
      const tarefa = cron.schedule(expr, () => {
        log.info(`[CRON] Executando ${chave} (agendado ${horario})...`)
        dispararJob(chave, rota)
      }, { timezone: 'America/Sao_Paulo' })
      tarefas.push(tarefa)
      total++
      log.info(`[CRON] ${chave} agendado: ${horario} (seg-sex)`)
    }
    tarefasAtivas.set(chave, tarefas)
  }

  if (total === 0) {
    log.info('[CRON] Nenhum job agendado. Configure horários no painel (campo "cron").')
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
  for (const [chave, rota] of Object.entries(JOBS_AGENDAVEIS)) {
    const cred = getCred(chave)
    const horarioStr = cred.cron || ''
    const ativo = tarefasAtivas.has(chave)
    lista.push({ chave, rota, horario: horarioStr || null, ativo })
  }
  return lista
}

module.exports = { iniciarScheduler, recarregar, listarAgendamentos }
