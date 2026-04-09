/**
 * JARVIS — Extrator de Faturas (Claude Vision)
 * ==============================================
 * Usa Claude Sonnet com PDF como document para extrair dados
 * estruturados de faturas de seguradoras de transporte.
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── REGRAS POR SEGURADORA ─────────────────────────────────────────────────────

const REGRAS_SEGURADORA = {
  tokio: `SEGURADORA: Tokio Marine
- apolice: extraia o número da apólice e retorne APENAS os últimos 6 dígitos
- ramo: sempre retorne "TRANSPORTE_NACIONAL"
- endosso: número do endosso conforme consta no documento
- premio: valor do prêmio líquido (sem IOF)
- iof: valor do IOF separado
- vencimento: data de vencimento no formato DD/MM/YYYY
- competencia: mês/ano de referência no formato MM/YYYY`,

  akad: `SEGURADORA: AKAD
- apolice: encontre o campo "Nº Apólice Akad" e retorne APENAS os últimos 6 dígitos
- endosso: encontre o campo "Nº Fatura Akad" e retorne APENAS os últimos 6 dígitos
- premio: valor do prêmio líquido
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY`,

  sompo: `SEGURADORA: Sompo
- IMPORTANTE: processar APENAS documentos do tipo "Conta Mensal". Se não for, retorne erro.
- apolice: número da apólice conforme documento
- endosso: número do endosso
- competencia: extraia do campo "Movimento MM/YYYY"
- premio: valor do prêmio líquido
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY`,

  'axa_rctr': `SEGURADORA: AXA (RCTR-C)
- ramo: retorne "RCTR-C"
- apolice: extraia o número da apólice, remova zeros à esquerda, retorne APENAS os últimos 5 dígitos
- endosso: número do endosso
- premio: valor do prêmio líquido
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY`,

  'axa_rcdc': `SEGURADORA: AXA (RC-DC)
- ramo: retorne "RC-DC"
- apolice: extraia o número da apólice, remova zeros à esquerda, retorne APENAS os últimos 4 dígitos
- endosso: número do endosso
- premio: valor do prêmio líquido
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY`,

  chubb: `SEGURADORA: Chubb
- apolice: extraia o número, remova TODOS os pontos, retorne o número limpo
- endosso: extraia o número, retorne APENAS os 2 últimos dígitos após o ponto
- premio: valor do prêmio líquido
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY`,

  allianz: `SEGURADORA: Allianz
- apolice: extraia o número da apólice e retorne APENAS os últimos 7 dígitos
- endosso: número do endosso
- premio: valor do prêmio líquido
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY`,
};

// AXA resolve dinamicamente pelo ramo
function getRegra(seguradora, ramo) {
  if (seguradora === 'axa') {
    if (ramo && ramo.toLowerCase().includes('dc')) return REGRAS_SEGURADORA['axa_rcdc'];
    return REGRAS_SEGURADORA['axa_rctr'];
  }
  return REGRAS_SEGURADORA[seguradora];
}

/**
 * Extrai dados estruturados de uma fatura PDF usando Claude Vision.
 *
 * @param {Buffer} pdfBuffer — conteúdo do PDF
 * @param {string} seguradora — tokio|akad|sompo|axa|chubb|allianz
 * @param {string} [ramo] — ramo para AXA (rctr-c ou rc-dc)
 * @returns {Promise<{ok: boolean, dados?: object, erro?: string}>}
 */
export async function extrairDadosFatura(pdfBuffer, seguradora, ramo) {
  const regra = getRegra(seguradora, ramo);
  if (!regra) {
    return { ok: false, erro: `Seguradora desconhecida: ${seguradora}` };
  }

  const prompt = `Você é um assistente especializado em extrair dados de faturas de seguros de transporte.

Analise o PDF da fatura e extraia os seguintes campos:

${regra}

REGRAS GERAIS:
- Valores monetários: retorne como número (float), sem R$, sem pontos de milhar. Ex: 1234.56
- Datas: retorne sempre no formato DD/MM/YYYY
- Se um campo não for encontrado, retorne null
- Se o documento não for uma fatura válida, retorne {"erro": "motivo"}

Retorne APENAS um JSON válido, sem markdown, sem explicação:
{"apolice": "...", "endosso": "...", "premio": 0.00, "iof": 0.00, "vencimento": "DD/MM/YYYY", "ramo": "...", "competencia": "MM/YYYY"}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBuffer.toString('base64'),
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Parse JSON — tenta direto, depois com regex
    let dados;
    try {
      dados = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        dados = JSON.parse(match[0]);
      } else {
        return { ok: false, erro: `Resposta não é JSON: ${text.slice(0, 200)}` };
      }
    }

    if (dados.erro) {
      return { ok: false, erro: dados.erro };
    }

    // Valida campos obrigatórios
    const obrigatorios = ['apolice', 'premio', 'vencimento'];
    const faltando = obrigatorios.filter(k => !dados[k] && dados[k] !== 0);
    if (faltando.length > 0) {
      return { ok: false, erro: `Campos faltando: ${faltando.join(', ')}`, dados };
    }

    return { ok: true, dados };
  } catch (err) {
    return { ok: false, erro: `Erro Anthropic: ${err.message}` };
  }
}
