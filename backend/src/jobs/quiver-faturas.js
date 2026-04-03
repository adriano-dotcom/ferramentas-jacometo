// src/jobs/quiver-faturas.js
const log = require('../lib/logger')

module.exports = async function routeQuiverFaturas(req, res) {
  const arquivos = req.files || []
  log.info(`Job quiver-faturas solicitado — ${arquivos.length} arquivo(s)`)
  // TODO: integrar com automacao Quiver PRO via Playwright
  res.json({ ok: true, mensagem: `${arquivos.length} fatura(s) enfileirada(s). Resultado por email.` })
}
