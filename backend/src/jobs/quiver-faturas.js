// src/jobs/quiver-faturas.js
// Stub legacy — redireciona para o job completo de faturas de transporte.
// A implementação real está em quiver-faturas-transporte.js.
const routeTransporte = require('./quiver-faturas-transporte')

module.exports = routeTransporte
module.exports.getJobStatus = routeTransporte.getJobStatus
