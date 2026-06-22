// src/server.js — Backend RPA Jacometo Seguros
// Sistema enxuto: apenas o Cadastro de Faturas no Quiver PRO.
// As automações de inadimplentes/boletos das demais seguradoras rodam no Mac mini 01.
require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const log     = require('./lib/logger')

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
const routeQuiverFaturas = require('./jobs/quiver-faturas')

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime(), ts: new Date().toISOString() }))

// ── Config — credenciais do Quiver (sem mexer no código) ─────────────────────
app.get('/api/config',         routeGetConfig)
app.post('/api/config',        routePostConfig)
app.post('/api/config/testar', routeTestConfig)

// ── Quiver — Cadastro de Faturas ─────────────────────────────────────────────
app.post('/api/quiver-faturas/cadastrar',     upload.array('arquivos'), routeQuiverFaturas)
app.get ('/api/quiver-faturas/status/:jobId',                           routeQuiverFaturas.getJobStatus)

app.listen(PORT, () => {
  log.ok(`Backend RPA Jacometo — porta ${PORT}`)
  log.ok(`Playwright headless: ${process.env.HEADLESS !== 'false'}`)
  log.ok(`Frontend: ${process.env.FRONTEND_URL || '*'}`)
})
