/**
 * JARVIS — Email de Confirmação de Fatura
 * =========================================
 * Envia email com resultado do cadastro de fatura no Quiver PRO.
 * De: adriano@jacometo.com.br → Para: jacometo@jacometo.com.br
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const {
  SMTP_HOST = 'smtp.gmail.com',
  SMTP_PORT = '587',
  SMTP_USER,
  SMTP_PASS,
  EMAIL_REMETENTE = 'adriano@jacometo.com.br',
  EMAIL_DESTINO = 'jacometo@jacometo.com.br',
} = process.env;

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP_USER e SMTP_PASS não configurados no .env');
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return transporter;
}

/**
 * Envia email de confirmação de cadastro de fatura.
 *
 * @param {Object} dados
 * @param {string} dados.segurado
 * @param {string} dados.seguradora
 * @param {string} dados.apolice
 * @param {string} dados.endosso
 * @param {number|string} dados.premio
 * @param {string} dados.vencimento
 * @param {string} dados.ramo
 * @param {boolean} dados.sucesso
 * @param {string} [dados.erro]
 * @returns {Promise<{ok: boolean, messageId?: string, erro?: string}>}
 */
export async function enviarConfirmacao(dados) {
  const {
    segurado = '—',
    seguradora = '—',
    apolice = '—',
    endosso = '—',
    premio = '—',
    vencimento = '—',
    ramo = '—',
    sucesso,
    erro,
    dadosExtraidos,
  } = dados;

  const emoji = sucesso ? '✅' : '❌';
  const status = sucesso ? 'Cadastrada com sucesso' : `Erro: ${erro || 'desconhecido'}`;
  const corStatus = sucesso ? '#16a34a' : '#dc2626';

  const assunto = sucesso
    ? `✅ Fatura cadastrada — ${seguradora.toUpperCase()} Apólice ${apolice}`
    : `❌ Fatura com erro — ${seguradora.toUpperCase()} ${segurado}`;

  const premioFmt = typeof premio === 'number'
    ? `R$ ${premio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : `R$ ${premio}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, Arial, sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="margin-bottom: 4px;">${emoji} Fatura de Transporte</h2>
  <p style="color: #666; margin-top: 0;">Cadastro automático Quiver PRO — Jarvis OS</p>

  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr style="background: #f8f9fa;">
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; font-weight: 600;">Segurado</td>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6;">${segurado}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; font-weight: 600;">Seguradora</td>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6;">${seguradora.toUpperCase()}</td>
    </tr>
    <tr style="background: #f8f9fa;">
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; font-weight: 600;">Apólice</td>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6;">${apolice}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; font-weight: 600;">Endosso</td>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6;">${endosso}</td>
    </tr>
    <tr style="background: #f8f9fa;">
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; font-weight: 600;">Prêmio</td>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; font-weight: 600;">${premioFmt}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; font-weight: 600;">Vencimento</td>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6;">${vencimento}</td>
    </tr>
    <tr style="background: #f8f9fa;">
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; font-weight: 600;">Ramo</td>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6;">${ramo}</td>
    </tr>
    <tr>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; font-weight: 600;">Status</td>
      <td style="padding: 10px 14px; border: 1px solid #dee2e6; color: ${corStatus}; font-weight: 600;">${status}</td>
    </tr>
  </table>

  ${!sucesso && dadosExtraidos ? `
  <h3 style="margin-top: 20px; color: #dc2626;">Dados extraídos pelo Claude Vision</h3>
  <pre style="background: #f8f9fa; padding: 12px; border-radius: 6px; font-size: 13px; overflow-x: auto;">${JSON.stringify(dadosExtraidos, null, 2)}</pre>

  <p style="margin-top: 16px;">
    <a href="https://ferramentas.jacometo.com.br/ferramentas/faturas/erros"
       style="display: inline-block; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
      Corrigir no painel →
    </a>
  </p>
  <p style="color: #666; font-size: 13px;">Acesse o painel, corrija os dados e reprocesse.</p>
  ` : ''}

  <p style="color: #999; font-size: 12px; margin-top: 24px;">
    Enviado automaticamente por Jarvis OS — Jacometo Corretora de Seguros
  </p>
</body>
</html>`;

  try {
    const t = getTransporter();
    const info = await t.sendMail({
      from: `"Jarvis OS" <${EMAIL_REMETENTE}>`,
      to: EMAIL_DESTINO,
      subject: assunto,
      html,
    });

    console.log(`  📧 Email enviado: ${info.messageId}`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`  ❌ Email falhou: ${err.message}`);
    return { ok: false, erro: err.message };
  }
}
