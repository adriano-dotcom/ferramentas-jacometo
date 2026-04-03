// src/lib/browser.js
// Fábrica de browser Playwright compartilhada por todas as automações

const { chromium } = require('playwright')
const log = require('./logger')

async function abrirBrowser(opcoes = {}) {
  log.info('Abrindo browser Playwright...')
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    ...opcoes,
  })

  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  })

  const page = await context.newPage()

  // Timeout padrão generoso para portais lentos
  page.setDefaultTimeout(30000)
  page.setDefaultNavigationTimeout(45000)

  log.ok('Browser pronto.')
  return { browser, context, page }
}

async function fecharBrowser(browser) {
  try { await browser.close() } catch {}
  log.info('Browser fechado.')
}

module.exports = { abrirBrowser, fecharBrowser }
