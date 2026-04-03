// src/lib/email.js
// Envia emails via Resend (API) ou SMTP (fallback)
const fs   = require('fs')
const path = require('path')
const log  = require('./logger')

async function enviarViaResend({ assunto, corpo, dest, anexos }) {
  const { Resend } = require('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)

  // Monta anexos como buffer para a API do Resend
  const attachments = anexos.map(f => ({
    filename: path.basename(f),
    content: fs.readFileSync(f),
  }))

  const from = process.env.RESEND_FROM || 'Automação Jacometo <automacao@jacometo.com.br>'

  const { data, error } = await resend.emails.send({
    from,
    to: dest.split(',').map(e => e.trim()),
    subject: assunto,
    text: corpo,
    attachments: attachments.length > 0 ? attachments : undefined,
  })

  if (error) throw new Error(error.message || JSON.stringify(error))
  log.ok(`Email enviado via Resend (id: ${data?.id})`)
  return true
}

async function enviarViaSMTP({ assunto, corpo, dest, anexos }) {
  const nodemailer = require('nodemailer')
  const t = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  const attachments = anexos.map(f => ({
    filename: path.basename(f),
    path: f,
  }))

  await t.sendMail({
    from: `"Automação Jacometo" <${process.env.SMTP_USER}>`,
    to: dest,
    subject: assunto,
    text: corpo,
    attachments,
  })

  log.ok('Email enviado via SMTP.')
  return true
}

async function enviar({ assunto, corpo, para, anexo }) {
  const dest = para || process.env.EMAIL_EQUIPE
  log.info(`Enviando email: ${assunto} → ${dest}`)

  // Monta lista de anexos (aceita string, array, ou undefined)
  let anexos = []
  if (anexo) {
    anexos = Array.isArray(anexo) ? anexo : [anexo]
  }

  try {
    // Prioridade: Resend (API) > SMTP
    if (process.env.RESEND_API_KEY) {
      return await enviarViaResend({ assunto, corpo, dest, anexos })
    }
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      return await enviarViaSMTP({ assunto, corpo, dest, anexos })
    }
    log.warn('Nenhum provedor de email configurado (RESEND_API_KEY ou SMTP_USER/SMTP_PASS)')
    return false
  } catch (e) {
    log.error(`Erro email: ${e.message}`)
    return false
  }
}

module.exports = { enviar }
