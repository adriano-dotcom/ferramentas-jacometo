// src/jobs/saude-faturas.js
const log = require('../lib/logger')

module.exports = async function routeSaudeFaturas(req, res) {
  const { operadoras } = req.body || {}
  log.info(`Job saude-faturas solicitado — operadoras: ${JSON.stringify(operadoras || 'todas')}`)
  // TODO: Playwright nos portais de operadoras de saúde
  res.json({ ok: true, mensagem: 'Extração sendo executada. Resultado por email.' })
}
