/**
 * JARVIS — Caixa Agent Setup
 * ===========================
 * Registra custom tools no agente CAIXA via Managed Agents API.
 * Executar: node src/agents/caixa-setup.js
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const CAIXA_AGENT_ID = process.env.CAIXA_AGENT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const CUSTOM_TOOLS = [
  {
    type: 'agent_toolset_20260401',
  },
  {
    type: 'custom',
    name: 'cadastrar_fatura_quiver',
    description: 'Cadastra fatura mensal de seguradora de transporte no Quiver PRO via Playwright no Mac Mini. Use quando receber PDF de fatura de RCTR-C ou RC-DC das seguradoras Tokio Marine, AKAD, Sompo, AXA, Chubb ou Allianz.',
    input_schema: {
      type: 'object',
      properties: {
        seguradora: {
          type: 'string',
          enum: ['tokio', 'akad', 'sompo', 'axa', 'chubb', 'allianz'],
          description: 'Nome da seguradora',
        },
        apolice: {
          type: 'string',
          description: 'Número da apólice conforme regra de cada seguradora',
        },
        endosso: {
          type: 'string',
          description: 'Número do endosso',
        },
        premio: {
          type: 'number',
          description: 'Valor do prêmio líquido em R$',
        },
        iof: {
          type: 'number',
          description: 'Valor do IOF em R$',
        },
        vencimento: {
          type: 'string',
          description: 'Data de vencimento no formato DD/MM/YYYY',
        },
        ramo: {
          type: 'string',
          enum: ['RCTR-C', 'RC-DC', 'TRANSPORTE_NACIONAL'],
          description: 'Ramo do seguro',
        },
        competencia: {
          type: 'string',
          description: 'Mês/ano de referência no formato MM/YYYY',
        },
      },
      required: ['seguradora', 'apolice', 'endosso', 'premio', 'vencimento', 'ramo'],
    },
  },
  {
    type: 'custom',
    name: 'buscar_fatura_drive',
    description: 'Busca e baixa PDFs de faturas de seguradoras no Google Drive. Use quando precisar processar faturas recebidas.',
    input_schema: {
      type: 'object',
      properties: {
        seguradora: {
          type: 'string',
          description: 'Nome da seguradora para filtrar',
        },
        mes: {
          type: 'string',
          description: 'Mês/ano no formato MM/YYYY',
        },
      },
    },
  },
];

async function setup() {
  if (!CAIXA_AGENT_ID) {
    console.error('❌ CAIXA_AGENT_ID não configurado no .env');
    process.exit(1);
  }

  console.log(`🔧 Atualizando agente CAIXA: ${CAIXA_AGENT_ID}`);

  // 1. Busca version atual
  const agent = await client.beta.agents.retrieve(CAIXA_AGENT_ID);
  console.log(`  📌 Version atual: ${agent.version}`);
  console.log(`  🔧 Tools atuais: ${agent.tools.map(t => t.type === 'custom' ? t.name : t.type).join(', ')}`);

  // 2. Atualiza com custom tools
  const updated = await client.beta.agents.update(CAIXA_AGENT_ID, {
    version: agent.version,
    tools: CUSTOM_TOOLS,
  });

  console.log(`\n✅ Agente CAIXA atualizado!`);
  console.log(`  📌 Nova version: ${updated.version}`);
  console.log(`  🔧 Tools registradas:`);
  for (const t of updated.tools) {
    if (t.type === 'custom') {
      console.log(`    • [custom] ${t.name} — ${t.description.slice(0, 60)}...`);
    } else {
      console.log(`    • [${t.type}]`);
    }
  }
}

setup().catch(err => {
  console.error('❌ Erro no setup:', err.message);
  if (err.status === 409) {
    console.error('  ↳ Conflito de version — outro processo atualizou o agente. Execute novamente.');
  }
  process.exit(1);
});
