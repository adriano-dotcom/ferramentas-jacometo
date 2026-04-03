// src/jobs/relatorio-parcelas.js
const log = require('../lib/logger')

module.exports = async function routeParcelas(req, res) {
  const { seguradoras } = req.body || {}
  log.info(`Job relatorio-parcelas solicitado — seguradoras: ${JSON.stringify(seguradoras || 'todas')}`)
  // TODO: Playwright em cada portal de seguradora para extrair inadimplência
  res.json({ ok: true, mensagem: 'Relatório sendo gerado. Você receberá por email em alguns minutos.' })
}
