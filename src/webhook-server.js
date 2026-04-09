/**
 * JARVIS — Webhook Server (Multi-empresa)
 * Porta 3001 — recebe eventos de:
 *   - crm.jacometo.com.br  → /webhook/jacometo
 *   - crm.orbepet.com.br   → /webhook/orbe
 */

import express from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { processarWebhookChatwoot } from './gerente.js';
import { EMPRESAS, identificarEmpresaPorWebhook } from './empresas.js';

dotenv.config();

const app  = express();
const PORT = process.env.WEBHOOK_PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── VERIFICAÇÃO HMAC ─────────────────────────────────────────────────────────

function verificarAssinatura(rawBody, timestamp, assinatura, secret) {
  if (!secret) return true;
  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(assinatura || ''), Buffer.from(expected));
  } catch { return false; }
}

// ─── WEBHOOK JACOMETO ─────────────────────────────────────────────────────────

app.post('/webhook/jacometo', async (req, res) => {
  const sig       = req.headers['x-chatwoot-signature'];
  const timestamp = req.headers['x-chatwoot-timestamp'];
  const secret    = EMPRESAS.jacometo.chatwoot.webhook_secret;

  if (!verificarAssinatura(JSON.stringify(req.body), timestamp, sig, secret)) {
    return res.status(401).json({ error: 'Assinatura inválida' });
  }

  const { event } = req.body;
  console.log(`📥 [JACOMETO] Webhook: ${event}`);

  try {
    const resultado = await processarWebhookChatwoot(req.body, null, 'jacometo');
    notificarTelegram('jacometo', event, req.body, resultado);
    res.json({ ok: true, empresa: 'jacometo', resultado });
  } catch (e) {
    console.error('❌ Webhook Jacometo:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── WEBHOOK ORBE PET ─────────────────────────────────────────────────────────

app.post('/webhook/orbe', async (req, res) => {
  const sig       = req.headers['x-chatwoot-signature'];
  const timestamp = req.headers['x-chatwoot-timestamp'];
  const secret    = EMPRESAS.orbe.chatwoot.webhook_secret;

  if (!verificarAssinatura(JSON.stringify(req.body), timestamp, sig, secret)) {
    return res.status(401).json({ error: 'Assinatura inválida' });
  }

  const { event } = req.body;
  console.log(`📥 [ORBE] Webhook: ${event}`);

  try {
    const resultado = await processarWebhookChatwoot(req.body, null, 'orbe');
    notificarTelegram('orbe', event, req.body, resultado);
    res.json({ ok: true, empresa: 'orbe', resultado });
  } catch (e) {
    console.error('❌ Webhook Orbe:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── NOTIFICAÇÃO TELEGRAM ─────────────────────────────────────────────────────

function notificarTelegram(empresa, event, body, resultado) {
  if (!global.jarvisTelegramBot || !global.jarvisAdminChatId) return;

  const cfg   = EMPRESAS[empresa];
  const nome  = body?.conversation?.meta?.sender?.name || 'Lead';
  const inbox = body?.conversation?.inbox_id;

  if (event === 'conversation_created') {
    const msg = `${cfg.emoji} *Novo lead ${cfg.nome}!*\n👤 ${nome}\n💬 [Ver conversa](${cfg.chatwoot.url}/app/accounts/${cfg.chatwoot.account_id}/conversations/${body?.conversation?.id})`;
    global.jarvisTelegramBot.sendMessage(global.jarvisAdminChatId, msg, { parse_mode: 'Markdown' });
  }

  if (resultado?.acao === 'deal_criado') {
    const msg = `✅ Deal criado no Pipedrive #${resultado.deal_id} — ${cfg.nome}`;
    global.jarvisTelegramBot.sendMessage(global.jarvisAdminChatId, msg, { parse_mode: 'Markdown' });
  }
}

// ─── HEALTH ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    empresas: {
      jacometo: { webhook: '/webhook/jacometo', chatwoot: EMPRESAS.jacometo.chatwoot.url },
      orbe:     { webhook: '/webhook/orbe',     chatwoot: EMPRESAS.orbe.chatwoot.url    },
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── START ────────────────────────────────────────────────────────────────────

export function startWebhookServer(telegramBot, adminChatId) {
  global.jarvisTelegramBot = telegramBot;
  global.jarvisAdminChatId = adminChatId;

  app.listen(PORT, () => {
    console.log(`\n🌐 Webhook Server — porta ${PORT}`);
    console.log(`   POST /webhook/jacometo  ← crm.jacometo.com.br`);
    console.log(`   POST /webhook/orbe      ← crm.orbepet.com.br`);
    console.log(`   GET  /health\n`);
  });

  return app;
}
