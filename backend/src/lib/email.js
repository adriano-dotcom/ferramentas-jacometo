// src/lib/email.js
const nodemailer = require('nodemailer')
const log = require('./logger')

function criarTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

async function enviar({ assunto, corpo, para }) {
  const dest = para || process.env.EMAIL_EQUIPE
  log.info(`Enviando email: ${assunto} → ${dest}`)
  try {
    const t = criarTransport()
    await t.sendMail({
      from: `"Automação Jacometo" <${process.env.SMTP_USER}>`,
      to: dest,
      subject: assunto,
      text: corpo,
    })
    log.ok('Email enviado.')
    return true
  } catch(e) {
    log.error(`Erro email: ${e.message}`)
    return false
  }
}

module.exports = { enviar }
