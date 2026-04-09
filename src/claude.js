import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { buildSystemPrompt } from './personality.js';
import { getHistory, saveMessage, buildMemoryContext } from './memory.js';
import { TOOLS, executeTool } from './skills.js';
import { routeModel, estimateCost, MODELS } from './router.js';

dotenv.config();

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
let sessionCost = 0;

export async function askJarvis(userId, userMessage) {
  const { model, reason } = routeModel(userMessage);
  console.log(`🤖 [${model}] ${reason}`);
  return askJarvisWithModel(userId, model, userMessage, true);
}

export async function askJarvisWithModel(userId, model, userMessage, saveHistory = false) {
  const history = saveHistory ? await getHistory(userId, 20) : [];
  if (saveHistory) await saveMessage(userId, 'user', userMessage);

  // Injeta memória no system prompt — coração do sistema
  const memCtx  = saveHistory ? await buildMemoryContext(userId) : '';
  const system   = buildSystemPrompt(memCtx);

  const messages = [...history, { role: 'user', content: userMessage }];

  let response = await claude.messages.create({
    model,
    max_tokens: model === MODELS.HAIKU ? 1024 : 4096,
    system,
    tools: TOOLS,
    messages,
  });

  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults   = [];

    for (const toolUse of toolUseBlocks) {
      const result = await executeTool(toolUse.name, toolUse.input, { userId });
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await claude.messages.create({
      model,
      max_tokens: model === MODELS.HAIKU ? 1024 : 4096,
      system,
      tools: TOOLS,
      messages,
    });
  }

  const cost = estimateCost(model, response.usage?.input_tokens || 0, response.usage?.output_tokens || 0);
  sessionCost += cost;
  console.log(`💰 $${cost.toFixed(5)} | sessão $${sessionCost.toFixed(4)}`);

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  if (saveHistory) await saveMessage(userId, 'assistant', text, { model, tokens: response.usage?.output_tokens });

  return text;
}

export function getSessionCost() { return sessionCost; }
