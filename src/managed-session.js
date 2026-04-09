/**
 * JARVIS — Managed Agents Session Manager
 * =========================================
 * Router inteligente: analisa a mensagem e direciona para o agente
 * especialista certo (Caixa, Radar-J, Radar-Pet, ou Hub).
 *
 * Fluxo: routeToAgent → createSession → sendMessage → resposta
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

// Custom tool handlers (lazy imported)
const CUSTOM_TOOL_HANDLERS = {
  cadastrar_fatura_quiver: async (input) => {
    const { cadastrarFatura } = await import('./tools/quiver-tool.js');
    return cadastrarFatura(input);
  },
  buscar_fatura_drive: async (input) => {
    const { listarFaturasDrive, baixarPDF } = await import('./tools/drive-tool.js');
    if (input.fileId) return baixarPDF(input.fileId);
    return listarFaturasDrive(input.seguradora, input.mes);
  },
};

const {
  ANTHROPIC_API_KEY,
  JARVIS_ENV_ID,
  JARVIS_HUB_AGENT_ID,
  CAIXA_AGENT_ID,
  RADAR_J_AGENT_ID,
  RADAR_PET_AGENT_ID,
} = process.env;

const client = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
  timeout: 5 * 60 * 1000,
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 4 * 60 * 1000;

// ── AGENT ROUTES ──────────────────────────────────────────────────────────────

const ROUTES = [
  {
    id: 'caixa',
    env: () => CAIXA_AGENT_ID,
    label: 'Agente Caixa (Quiver)',
    keywords: [
      'fatura', 'quiver', 'cadastrar', 'boleto', 'inadimplente',
      'tokio', 'akad', 'sompo', 'axa', 'chubb', 'allianz',
    ],
  },
  {
    id: 'radar-j',
    env: () => RADAR_J_AGENT_ID,
    label: 'Radar Jacometo',
    keywords: [
      'meta', 'campanha', 'lead', 'pipedrive', 'transportadora',
      'rctr', 'rcdc',
    ],
  },
  {
    id: 'radar-pet',
    env: () => RADAR_PET_AGENT_ID,
    label: 'Radar Pet',
    keywords: [
      'orbe', 'pet', 'tiktok', 'plano saude', 'plano saúde',
      'angelus', 'essencial', 'plus', 'total', 'galaxia', 'galáxia',
    ],
  },
];

/**
 * Analisa a mensagem e retorna o agent_id + label do agente correto.
 */
export function routeToAgent(message) {
  const text = message.toLowerCase();

  for (const route of ROUTES) {
    for (const kw of route.keywords) {
      if (text.includes(kw)) {
        const agentId = route.env();
        if (agentId) {
          return { agentId, label: route.label, routeId: route.id };
        }
        // Se env var não configurada, fallback para hub
        break;
      }
    }
  }

  return {
    agentId: JARVIS_HUB_AGENT_ID,
    label: 'Jarvis Hub',
    routeId: 'hub',
  };
}

// ── SESSION MANAGEMENT ────────────────────────────────────────────────────────

/**
 * Cria uma nova session no Managed Agents.
 * @returns {string} sessionId
 */
export async function createSession(agentId, title = 'jarvis-session') {
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: JARVIS_ENV_ID,
    title,
  });

  console.log(`  🆕 Session: ${session.id} (agent: ${agentId.slice(-8)})`);
  return session.id;
}

// ── SEND MESSAGE + POLL ───────────────────────────────────────────────────────

/**
 * Envia mensagem para uma session e aguarda resposta por polling.
 * @returns {string} texto da resposta
 */
export async function sendMessage(sessionId, message) {
  // 1. Envia evento user.message
  await client.beta.sessions.events.send(sessionId, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: message }],
    }],
  });

  // 2. Poll até session ficar idle com resposta
  const startTime = Date.now();
  const seenIds = new Set();
  let responseText = '';
  const toolsUsed = [];

  while ((Date.now() - startTime) < MAX_WAIT_MS) {
    const session = await client.beta.sessions.retrieve(sessionId);

    // Busca todos os eventos
    const events = [];
    for await (const ev of client.beta.sessions.events.list(sessionId)) {
      events.push(ev);
    }

    // Processa apenas novos
    let handledCustomTool = false;
    for (const event of events) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);

      switch (event.type) {
        case 'agent.message':
          for (const block of (event.content || [])) {
            if (block.type === 'text' && block.text) {
              responseText += block.text;
            }
          }
          break;

        case 'agent.tool_use':
          toolsUsed.push(event.name);
          console.log(`  🔧 [${event.name}]`);
          break;

        case 'agent.custom_tool_use': {
          // Executa custom tool localmente e envia resultado de volta
          const handler = CUSTOM_TOOL_HANDLERS[event.name];
          toolsUsed.push(`custom:${event.name}`);
          console.log(`  🔧 [custom] ${event.name}`);

          let result;
          if (handler) {
            try {
              result = await handler(event.input || {});
            } catch (err) {
              result = { sucesso: false, erro: err.message };
              console.error(`  ❌ Custom tool error: ${err.message}`);
            }
          } else {
            result = { sucesso: false, erro: `Tool desconhecida: ${event.name}` };
          }

          // Envia resultado de volta para o agente
          await client.beta.sessions.events.send(sessionId, {
            events: [{
              type: 'user.custom_tool_result',
              custom_tool_use_id: event.id,
              content: JSON.stringify(result),
            }],
          });

          handledCustomTool = true;
          break;
        }
      }
    }

    // Se acabou de enviar resultado de custom tool, continua polling (agente vai processar)
    if (handledCustomTool) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Session idle + temos resposta → pronto
    if (session.status === 'idle' && responseText.length > 0) {
      break;
    }

    // Session idle sem resposta por muito tempo → timeout
    if (session.status === 'idle' && (Date.now() - startTime) > 30000) {
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (toolsUsed.length > 0) {
    console.log(`  📊 Tools: ${toolsUsed.join(', ')}`);
  }

  return responseText || '(sem resposta do agente)';
}

// ── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

/**
 * Envia mensagem para o Jarvis — roteia para o agente certo automaticamente.
 *
 * @param {string} userId  — ID do Telegram
 * @param {string} message — texto do usuário
 * @returns {Promise<{resposta: string, agente: string}>}
 */
export async function sendToJarvis(userId, message) {
  const { agentId, label, routeId } = routeToAgent(message);
  console.log(`🔀 [${label}] user=${userId}`);

  const sessionId = await createSession(agentId, `tg-${userId}-${routeId}`);
  const resposta = await sendMessage(sessionId, message);

  return { resposta, agente: label };
}

/**
 * Invalida sessions (noop agora — cada chamada cria session nova).
 */
export function clearSession() {}
