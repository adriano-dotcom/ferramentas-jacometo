/**
 * JARVIS — Extrator de Faturas (Claude Vision)
 * ==============================================
 * Usa Claude Sonnet com PDF como document para extrair dados
 * estruturados de faturas de seguradoras de transporte.
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../lib/supabase.js';

// Lazy init — garante que dotenv já rodou
let _client;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── REGRAS POR SEGURADORA ─────────────────────────────────────────────────────

const REGRAS_SEGURADORA = {
  tokio: `SEGURADORA: Tokio Marine
- apolice: extraia o número da apólice e retorne APENAS os últimos 6 dígitos
- ramo: sempre retorne "TRANSPORTE_NACIONAL"
- endosso: número do endosso conforme consta no documento (ex: "Endosso / Fatura nº.: 620143")
- premio: valor do PRÊMIO LÍQUIDO FINAL (após ajustes/mínimo). Procure "PRÊMIO LÍQUIDO FINAL" na composição do prêmio
- iof: valor do IOF separado
- vencimento: data de vencimento da parcela no formato DD/MM/YYYY
- competencia: mês/ano de referência no formato MM/YYYY
- periodo_inicio: data INÍCIO do período de EMBARQUES (seção "Resumo de Embarques - Subgrupo: Período de DD/MM/YYYY à DD/MM/YYYY"). ATENÇÃO: use o período dos EMBARQUES, NÃO a vigência do seguro
- periodo_fim: data FIM do período de EMBARQUES. ATENÇÃO: use o período dos EMBARQUES, NÃO a vigência do seguro`,

  akad: `SEGURADORA: AKAD
- apolice: encontre o campo "Nº Apólice Akad" e retorne APENAS os últimos 6 dígitos
- endosso: encontre o campo "Nº Fatura Akad" e retorne APENAS os últimos 6 dígitos
- premio: valor do prêmio líquido
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY
- periodo_inicio: data INÍCIO do período de embarques/movimento. NÃO usar vigência do seguro
- periodo_fim: data FIM do período de embarques/movimento. NÃO usar vigência do seguro`,

  sompo: `SEGURADORA: Sompo
- IMPORTANTE: processar APENAS documentos do tipo "Conta Mensal". Se não for, retorne erro.
- apolice: número da apólice conforme documento
- endosso: número do endosso
- competencia: extraia do campo "Movimento MM/YYYY"
- premio: valor do prêmio líquido
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- periodo_inicio: data INÍCIO do período de movimento/embarques. NÃO usar vigência do seguro
- periodo_fim: data FIM do período de movimento/embarques. NÃO usar vigência do seguro`,

  'axa_rctr': `SEGURADORA: AXA (RCTR-C) — Ramo 0654
- ramo: retorne "RCTR-C"
- apolice: CRÍTICO — o número completo tem formato "02852.2026.0043.0654.0014929". Retorne APENAS os últimos 5 dígitos SEM zeros à esquerda. Ex: "0014929" → "14929"
- endosso: número do endosso
- premio: valor do prêmio líquido (PRÊMIO LÍQUIDO FINAL se houver composição)
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY
- periodo_inicio: data INÍCIO do período de embarques/movimento. NÃO usar vigência do seguro
- periodo_fim: data FIM do período de embarques/movimento. NÃO usar vigência do seguro`,

  'axa_rcdc': `SEGURADORA: AXA (RC-DC) — Ramo 0655
- ramo: retorne "RC-DC"
- apolice: CRÍTICO — o número completo tem formato "02852.2026.0043.0655.0008268". Retorne APENAS os últimos 4 dígitos SEM zeros à esquerda. Ex: "0008268" → "8268"
- endosso: número do endosso
- premio: valor do prêmio líquido (PRÊMIO LÍQUIDO FINAL se houver composição)
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY
- periodo_inicio: data INÍCIO do período de embarques/movimento. NÃO usar vigência do seguro
- periodo_fim: data FIM do período de embarques/movimento. NÃO usar vigência do seguro`,

  chubb: `SEGURADORA: Chubb
- apolice: extraia o número, remova TODOS os pontos, retorne o número limpo
- endosso: extraia o número, retorne APENAS os 2 últimos dígitos após o ponto
- premio: valor do prêmio líquido
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY
- periodo_inicio: data INÍCIO do período de embarques/movimento. NÃO usar vigência do seguro
- periodo_fim: data FIM do período de embarques/movimento. NÃO usar vigência do seguro`,

  allianz: `SEGURADORA: Allianz
- apolice: extraia o número da apólice e retorne APENAS os últimos 7 dígitos. Ex: "5177202523550001166" → "0001166"
- endosso: CRÍTICO — use o "Nº Fatura" do RODAPÉ DA SEGUNDA PÁGINA (ou última página). IGNORE o número da primeira página pois pode ser diferente. Ex: rodapé "Nº Fatura: 9" → endosso "9"
- premio: valor do prêmio líquido (PRÊMIO LÍQUIDO FINAL se houver composição)
- iof: valor do IOF
- vencimento: data de vencimento DD/MM/YYYY
- competencia: mês/ano de referência MM/YYYY
- periodo_inicio: data INÍCIO do período de embarques/movimento. NÃO usar vigência do seguro
- periodo_fim: data FIM do período de embarques/movimento. NÃO usar vigência do seguro`,
};

// AXA resolve dinamicamente pelo ramo (0654=RCTR-C, 0655=RC-DC)
function getRegra(seguradora, ramo) {
  if (seguradora === 'axa') {
    if (ramo && (ramo.includes('dc') || ramo.includes('DC') || ramo.includes('0655'))) {
      return REGRAS_SEGURADORA['axa_rcdc'];
    }
    return REGRAS_SEGURADORA['axa_rctr'];
  }
  return REGRAS_SEGURADORA[seguradora];
}

/**
 * Identifica a seguradora a partir do conteúdo do PDF usando Claude Vision.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{ok: boolean, seguradora?: string, ramo?: string, erro?: string}>}
 */
export async function identificarSeguradora(pdfBuffer) {
  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') },
          },
          {
            type: 'text',
            text: `Identifique a seguradora que emitiu esta fatura de seguro de transporte.

Seguradoras possíveis: tokio, akad, sompo, axa, chubb, allianz

Se for AXA, identifique o ramo pelo código na apólice:
- Código 0654 = RCTR-C (ex: 02852.2026.0043.0654.XXXXX)
- Código 0655 = RC-DC (ex: 02852.2026.0043.0655.XXXXX)
Ou pelo título do documento se mencionar RCTR-C ou RC-DC

Retorne APENAS JSON, sem explicação:
{"seguradora": "nome_em_minusculo", "ramo": "RCTR-C ou RC-DC ou null"}

Se não for uma fatura de seguro de transporte, retorne:
{"seguradora": null, "erro": "motivo"}`,
          },
        ],
      }],
    });

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let dados;
    try { dados = JSON.parse(text); } catch {
      const match = text.match(/\{[\s\S]*\}/);
      dados = match ? JSON.parse(match[0]) : null;
    }
    if (!dados || !dados.seguradora) {
      return { ok: false, erro: dados?.erro || 'Seguradora não identificada' };
    }
    return { ok: true, seguradora: dados.seguradora.toLowerCase(), ramo: dados.ramo || null };
  } catch (err) {
    return { ok: false, erro: `Erro na identificação: ${err.message}` };
  }
}

/**
 * Extrai dados estruturados de uma fatura PDF usando Claude Vision.
 *
 * @param {Buffer} pdfBuffer — conteúdo do PDF
 * @param {string} seguradora — tokio|akad|sompo|axa|chubb|allianz
 * @param {string} [ramo] — ramo para AXA (rctr-c ou rc-dc)
 * @returns {Promise<{ok: boolean, dados?: object, erro?: string}>}
 */
/**
 * Busca casos de erro anteriores para a seguradora no Supabase.
 * Retorna string formatada para injetar no prompt.
 */
async function buscarCasosErro(seguradora) {
  try {
    const { data } = await supabase
      .from('regras_seguradora')
      .select('regra_apolice, regra_endosso, regra_premio, regra_vencimento, regra_ramo, exemplos, casos_erro')
      .eq('seguradora', seguradora)
      .eq('ativo', true)
      .limit(1)
      .single();

    if (!data) return '';

    let ctx = '\n\nREGRAS ESPECÍFICAS APRENDIDAS:';
    if (data.regra_premio) ctx += `\n- PRÊMIO: ${data.regra_premio}`;
    if (data.regra_apolice) ctx += `\n- APÓLICE: ${data.regra_apolice}`;
    if (data.regra_endosso) ctx += `\n- ENDOSSO: ${data.regra_endosso}`;

    if (data.casos_erro?.length > 0) {
      ctx += '\n\nERROS CONHECIDOS — NÃO repita:';
      for (const c of data.casos_erro) {
        ctx += `\n- ❌ ${c.erro} → ✅ ${c.correto} (campo: ${c.campo})`;
      }
    }

    if (data.exemplos?.length > 0) {
      ctx += `\n\nEXEMPLO CORRETO: ${JSON.stringify(data.exemplos[0])}`;
    }

    return ctx + '\n';
  } catch {
    return '';
  }
}

export async function extrairDadosFatura(pdfBuffer, seguradora, ramo) {
  const regra = getRegra(seguradora, ramo);
  if (!regra) {
    return { ok: false, erro: `Seguradora desconhecida: ${seguradora}` };
  }

  // Busca casos de erro anteriores para injetar no prompt
  const casosErro = await buscarCasosErro(seguradora);

  const prompt = `Você é um assistente especializado em extrair dados de faturas de seguros de transporte.

Analise o PDF da fatura e extraia os seguintes campos:

${regra}
${casosErro}
REGRAS GERAIS:
- Valores monetários: retorne como número (float), sem R$, sem pontos de milhar. Ex: 1234.56
- Datas: retorne sempre no formato DD/MM/YYYY
- Se um campo não for encontrado, retorne null
- Se o documento não for uma fatura válida, retorne {"erro": "motivo"}
- CRÍTICO: periodo_inicio e periodo_fim devem ser do PERÍODO DE EMBARQUES/MOVIMENTO, NUNCA da vigência do seguro. A vigência é anual (ex: 30/04/2025 a 30/04/2026), já o período dos embarques é mensal (ex: 01/03/2026 a 31/03/2026).

Retorne APENAS um JSON válido, sem markdown, sem explicação:
{"apolice": "...", "endosso": "...", "premio": 0.00, "iof": 0.00, "vencimento": "DD/MM/YYYY", "ramo": "...", "competencia": "MM/YYYY", "periodo_inicio": "DD/MM/YYYY", "periodo_fim": "DD/MM/YYYY"}`;

  try {
    const response = await getClient().messages.create({
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
