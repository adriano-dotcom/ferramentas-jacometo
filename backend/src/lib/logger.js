// src/lib/logger.js
const fs   = require('fs')
const path = require('path')

const LOG_DIR = path.resolve('./logs')

function ts() {
  return new Date().toISOString().replace('T',' ').substring(0,19)
}
function write(level, msg) {
  const line = `[${ts()}] [${level}] ${msg}`
  console.log(line)
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    const f = path.join(LOG_DIR, `rpa-${new Date().toISOString().substring(0,10)}.log`)
    fs.appendFileSync(f, line + '\n')
  } catch {}
}

module.exports = {
  info:  m => write('INFO ', m),
  ok:    m => write('OK   ', m),
  warn:  m => write('WARN ', m),
  error: m => write('ERROR', m),
}
