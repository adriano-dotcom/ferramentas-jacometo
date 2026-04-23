// src/server.js — Backend RPA Jacometo Seguros
require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const log     = require('./lib/logger')
const db      = require('./lib/database')

const app  = express()
const PORT = process.env.PORT || 3001

fs.mkdirSync(path.resolve(process.env.DOWNLOAD_DIR || './downloads'), { recursive: true })
fs.mkdirSync('./downloads/screenshots', { recursive: true })
fs.mkdirSync('./config', { recursive: true })
fs.mkdirSync('./logs',   { recursive: true })

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true }))

const upload = multer({
  dest: path.resolve(process.env.DOWNLOAD_DIR || './downloads'),
  limits: { fileSize: 20 * 1024 * 1024 },
})

const { routeGetConfig, routePostConfig, routeTestConfig } = require('./jobs/config')
const routeUnimedGrupos              = require('./jobs/unimed-grupos')
const routeUnimedBoletos             = require('./jobs/unimed-boletos')
const { getJobStatus: statusUnimedBol } = routeUnimedBoletos
const routeQuiverFaturas             = require('./jobs/quiver-faturas')
const routeQuiverFaturasTransporte   = require('./jobs/quiver-faturas-transporte')
const { getJobStatus: statusTransporte } = routeQuiverFaturasTransporte
const routeRelatorioParcelas         = require('./jobs/relatorio-parcelas')
const routePlanoHospitalar           = require('./jobs/plano-hospitalar')
const { getJobStatus: statusPlanoHosp } = routePlanoHospitalar
const routeAllianz   = require('./jobs/allianz-inadimplentes')
const routeTokio     = require('./jobs/tokio-inadimplentes')
const routeAxa       = require('./jobs/axa-inadimplentes')
const routeChubb     = require('./jobs/chubb-inadimplentes')
const routeSompo     = require('./jobs/sompo-inadimplentes')
const routeAkad      = require('./jobs/akad-inadimplentes')
const routeYelum     = require('./jobs/yelum-inadimplentes')
const routeMitsui    = require('./jobs/mitsui-inadimplentes')
const routeEssor     = require('./jobs/essor-inadimplentes')
const routeMetlife   = require('./jobs/metlife-inadimplentes')
const routeUnimedSeg  = require('./jobs/unimed-seguros-inadimplentes')
const routePortoSeguro = require('./jobs/porto-seguro-inadimplentes')
const { getJobStatus: statusAllianz   } = routeAllianz
const { getJobStatus: statusTokio     } = routeTokio
const { getJobStatus: statusAxa       } = routeAxa
const { getJobStatus: statusChubb     } = routeChubb
const { getJobStatus: statusSompo     } = routeSompo
const { getJobStatus: statusAkad      } = routeAkad
const { getJobStatus: statusYelum     } = routeYelum
const { getJobStatus: statusMitsui    } = routeMitsui
const { getJobStatus: statusEssor     } = routeEssor
const { getJobStatus: statusMetlife   } = routeMetlife
const { getJobStatus: statusUnimedSeg } = routeUnimedSeg
const { getJobStatus: statusPortoSeguro } = routePortoSeguro

// Monitor de Averbacao (pode não existir ainda)
let iniciarMonitor = () => {}
try { ({ iniciarMonitor } = require('./jobs/monitor-averbacao')) } catch { log.warn('Monitor de averbação não encontrado — pulando.') }

// Scheduler (cron de inadimplentes)
const { iniciarScheduler, recarregar: recarregarCron, listarAgendamentos } = require('./lib/scheduler')

// ── Histórico e dados (Supabase) ─────────────────────────────────────────────
app.get('/api/historico', async (req, res) => {
  const { seguradora, responsavel, limite } = req.query
  const data = await db.buscarHistorico({ seguradora, responsavel, limite: Number(limite) || 50 })
  res.json({ ok: true, data })
})

app.get('/api/clientes-plano-hospitalar', async (req, res) => {
  const { vencimento } = req.query
  const data = await db.buscarClientesPlanoHospitalar(vencimento ? Number(vencimento) : null)
  res.json({ ok: true, data })
})

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime(), ts: new Date().toISOString() }))

app.get('/api/config',         routeGetConfig)
app.post('/api/config',        routePostConfig)
app.post('/api/config/testar', routeTestConfig)

app.post('/api/unimed-grupos/processar',             upload.single('arquivo'),  routeUnimedGrupos)
app.post('/api/unimed-boletos/executar',             routeUnimedBoletos);    app.get('/api/unimed-boletos/status/:jobId',       statusUnimedBol)
app.post('/api/quiver-faturas/cadastrar',            upload.array('arquivos'),  routeQuiverFaturas)
app.get ('/api/quiver-faturas/status/:jobId',                                   routeQuiverFaturas.getJobStatus)
app.post('/api/quiver-faturas-transporte/cadastrar', upload.array('arquivos'),  routeQuiverFaturasTransporte)
app.get('/api/quiver-faturas-transporte/status/:jobId', statusTransporte)
app.post('/api/relatorio-parcelas/gerar',            routeRelatorioParcelas)
app.post('/api/plano-hospitalar/executar',           routePlanoHospitalar)
app.get('/api/plano-hospitalar/status/:jobId',      statusPlanoHosp)

app.post('/api/allianz-inadimplentes/executar',             routeAllianz);    app.get('/api/allianz-inadimplentes/status/:jobId',    statusAllianz)
app.post('/api/tokio-inadimplentes/executar',               routeTokio);      app.get('/api/tokio-inadimplentes/status/:jobId',      statusTokio)
app.post('/api/axa-inadimplentes/executar',                 routeAxa);        app.get('/api/axa-inadimplentes/status/:jobId',        statusAxa)
app.post('/api/chubb-inadimplentes/executar',               routeChubb);      app.get('/api/chubb-inadimplentes/status/:jobId',      statusChubb)
app.post('/api/sompo-inadimplentes/executar',               routeSompo);      app.get('/api/sompo-inadimplentes/status/:jobId',      statusSompo)
app.post('/api/akad-inadimplentes/executar',                routeAkad);       app.get('/api/akad-inadimplentes/status/:jobId',       statusAkad)
app.post('/api/yelum-inadimplentes/executar',               routeYelum);      app.get('/api/yelum-inadimplentes/status/:jobId',      statusYelum)
app.post('/api/mitsui-inadimplentes/executar',              routeMitsui);     app.get('/api/mitsui-inadimplentes/status/:jobId',     statusMitsui)
app.post('/api/essor-inadimplentes/executar',               routeEssor);      app.get('/api/essor-inadimplentes/status/:jobId',      statusEssor)
app.post('/api/metlife-inadimplentes/executar',             routeMetlife);    app.get('/api/metlife-inadimplentes/status/:jobId',    statusMetlife)
app.post('/api/unimed-seguros-inadimplentes/executar',      routeUnimedSeg);  app.get('/api/unimed-seguros-inadimplentes/status/:jobId', statusUnimedSeg)
app.post('/api/porto-seguro-inadimplentes/executar',       routePortoSeguro); app.get('/api/porto-seguro-inadimplentes/status/:jobId',  statusPortoSeguro)

// ── Giacomet — mesmos handlers, corretora='giacomet' injetada no body ────────
function giacomet(handler) { return (req, res) => { req.body = { ...req.body, corretora: 'giacomet' }; handler(req, res) } }
app.post('/api/giacomet-allianz-inadimplentes/executar',  giacomet(routeAllianz));    app.get('/api/giacomet-allianz-inadimplentes/status/:jobId',  statusAllianz)
app.post('/api/giacomet-akad-inadimplentes/executar',     giacomet(routeAkad));       app.get('/api/giacomet-akad-inadimplentes/status/:jobId',     statusAkad)
app.post('/api/giacomet-yelum-inadimplentes/executar',    giacomet(routeYelum));      app.get('/api/giacomet-yelum-inadimplentes/status/:jobId',    statusYelum)
app.post('/api/giacomet-mitsui-inadimplentes/executar',   giacomet(routeMitsui));     app.get('/api/giacomet-mitsui-inadimplentes/status/:jobId',   statusMitsui)
app.post('/api/giacomet-unimed-inadimplentes/executar',   giacomet(routeUnimedSeg));  app.get('/api/giacomet-unimed-inadimplentes/status/:jobId',   statusUnimedSeg)
app.post('/api/giacomet-metlife-inadimplentes/executar',  giacomet(routeMetlife));    app.get('/api/giacomet-metlife-inadimplentes/status/:jobId',  statusMetlife)
app.post('/api/giacomet-tokio-inadimplentes/executar',   giacomet(routeTokio));     app.get('/api/giacomet-tokio-inadimplentes/status/:jobId',   statusTokio)
app.post('/api/giacomet-axa-inadimplentes/executar',     giacomet(routeAxa));       app.get('/api/giacomet-axa-inadimplentes/status/:jobId',     statusAxa)
app.post('/api/giacomet-chubb-inadimplentes/executar',   giacomet(routeChubb));     app.get('/api/giacomet-chubb-inadimplentes/status/:jobId',   statusChubb)
app.post('/api/giacomet-sompo-inadimplentes/executar',   giacomet(routeSompo));     app.get('/api/giacomet-sompo-inadimplentes/status/:jobId',   statusSompo)
app.post('/api/giacomet-essor-inadimplentes/executar',   giacomet(routeEssor));     app.get('/api/giacomet-essor-inadimplentes/status/:jobId',   statusEssor)
app.post('/api/giacomet-porto-seguro-inadimplentes/executar', giacomet(routePortoSeguro)); app.get('/api/giacomet-porto-seguro-inadimplentes/status/:jobId', statusPortoSeguro)

// Monitor de Averbacao (pode não existir ainda)
try { app.use('/api/monitor-averbacao', require('./routes/monitor-averbacao')) } catch { /* módulo não existe ainda */ }

// Cron — agendamentos automáticos
app.get('/api/cron', (req, res) => res.json({ ok: true, agendamentos: listarAgendamentos() }))
app.post('/api/cron/recarregar', (req, res) => { recarregarCron(); res.json({ ok: true, agendamentos: listarAgendamentos() }) })

// Pipedrive → Monitor de Averbacao (webhook, pode não existir ainda)
try { app.use('/api/pipedrive', require('./routes/pipedrive')) } catch { /* módulo não existe ainda */ }

app.listen(PORT, () => {
  log.ok(`Backend RPA Jacometo — porta ${PORT}`)
  log.ok(`Playwright headless: ${process.env.HEADLESS !== 'false'}`)
  log.ok(`Frontend: ${process.env.FRONTEND_URL || '*'}`)

  // Inicia monitor de averbacao (cron 08:00 e 14:00)
  iniciarMonitor()

  // Inicia scheduler de inadimplentes (horários do painel)
  iniciarScheduler()
})
