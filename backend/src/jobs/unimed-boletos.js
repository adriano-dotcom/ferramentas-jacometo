// src/jobs/unimed-boletos.js
const log = require('../lib/logger')

module.exports = async function routeUnimedBoletos(req, res) {
  const { dia } = req.body || {}
  log.info(`Job unimed-boletos solicitado (dia: ${dia || 'auto'})`)
  // TODO: integrar com src/automacoes/unimed/boletos.js
  res.json({ ok: true, mensagem: 'Job enfileirado. Você receberá o resultado por email.' })
}
