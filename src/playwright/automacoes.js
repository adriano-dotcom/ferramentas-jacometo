/**
 * JARVIS — Automações Específicas
 * =================================
 * Funções de automação prontas para cada site.
 * Todas usam o engine.js e sites.js por baixo.
 *
 * REGRA: qualquer função com requer_ok=true
 *        verifica aprovado===true antes de executar.
 */

import { executar, screenshot, abrirPagina } from './engine.js';
import { login, SITES } from './sites.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR    = path.join(__dirname, '../../../out');

function hoje() { return new Date().toISOString().split('T')[0]; }
async function salvar(subdir, nome, conteudo) {
  const dir = path.join(OUT_DIR, subdir);
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, nome);
  await fs.writeFile(fp, conteudo);
  return fp;
}

// ─── GUARD DE APROVAÇÃO ───────────────────────────────────────────────────────

function checarAprovacao(nomeTarefa, aprovado) {
  if (!aprovado) {
    return {
      ok:        false,
      bloqueado: true,
      tarefa:    nomeTarefa,
      motivo:    `"${nomeTarefa}" envolve ação financeira ou alteração de dados. Confirme com Adriano antes.`,
      como:      'Responda com "sim, pode executar" ou chame novamente com aprovado=true',
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUIVER PRO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cadastra fatura de seguro de transporte no Quiver PRO
 * REQUER APROVAÇÃO — ação que altera dados no sistema
 */
export async function cadastrarFaturaQuiver({
  seguradora,
  numero_apolice,
  numero_endosso,
  competencia,
  valor_premio,
  data_vencimento,
  aprovado = false,
}) {
  const bloq = checarAprovacao('Cadastro de Fatura Quiver PRO', aprovado);
  if (bloq) return bloq;

  // Garante login
  const loginRes = await login('quiver');
  if (!loginRes.ok) return loginRes;

  return executar('quiver', async (page) => {
    // Navega para cadastro de faturas/endossos
    await page.goto(`${SITES.quiver.url}/faturas/novo`, { waitUntil: 'networkidle' });
    await screenshot(page, 'quiver_nova_fatura');

    // Preenche campos (adaptar seletores conforme HTML real do Quiver)
    await page.selectOption('select[name="seguradora"]', { label: seguradora }).catch(() =>
      page.fill('input[name="seguradora"]', seguradora)
    );
    await page.fill('input[name="apolice"], #apolice',          numero_apolice || '');
    await page.fill('input[name="endosso"], #endosso',          numero_endosso || '');
    await page.fill('input[name="competencia"], #competencia',  competencia    || '');
    await page.fill('input[name="valor"], #valor_premio',       String(valor_premio || ''));
    await page.fill('input[name="vencimento"], #vencimento',    data_vencimento || '');

    await screenshot(page, 'quiver_fatura_preenchida');

    // Salva
    await page.click('button[type="submit"], .btn-salvar, .salvar');
    await page.waitForSelector('.sucesso, .alert-success, .confirmacao', { timeout: 10000 });
    await screenshot(page, 'quiver_fatura_salva');

    return {
      msg:         `Fatura ${seguradora} cadastrada no Quiver PRO`,
      seguradora,
      competencia,
      valor_premio,
    };
  });
}

/**
 * Extrai relatório de faturas/endossos do Quiver PRO
 */
export async function relatorioFaturasQuiver({ mes, seguradora } = {}) {
  const loginRes = await login('quiver');
  if (!loginRes.ok) return loginRes;

  return executar('quiver', async (page) => {
    const url = `${SITES.quiver.url}/relatorios/faturas`;
    await page.goto(url, { waitUntil: 'networkidle' });

    // Aplica filtros se informados
    if (mes)        await page.fill('input[name="mes"], #mes', mes).catch(() => {});
    if (seguradora) await page.selectOption('select[name="seguradora"]', { label: seguradora }).catch(() => {});

    if (mes || seguradora) {
      await page.click('button.filtrar, .btn-filtrar, button[type="submit"]').catch(() => {});
      await page.waitForLoadState('networkidle');
    }

    // Extrai tabela de faturas
    const faturas = await page.$$eval('table tbody tr', rows =>
      rows.map(row => ({
        colunas: Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim())
      }))
    ).catch(() => []);

    await screenshot(page, 'quiver_relatorio');

    // Salva relatório
    const conteudo = `# Faturas Quiver PRO — ${hoje()}\n${
      seguradora ? `Seguradora: ${seguradora}\n` : ''
    }${mes ? `Mês: ${mes}\n` : ''}\n${
      faturas.map(f => f.colunas.join(' | ')).join('\n')
    }`;
    const fp = await salvar('quiver', `faturas_${hoje()}.md`, conteudo);

    return { faturas, total: faturas.length, filepath: fp };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATM SEGUROS — Parcelas em Atraso
// ═══════════════════════════════════════════════════════════════════════════════

export async function relatorioParcelasATM() {
  const loginRes = await login('atm');
  if (!loginRes.ok) return loginRes;

  return executar('atm', async (page) => {
    const url = process.env.ATM_URL_PARCELAS || `${SITES.atm.url}/financeiro/parcelas-atraso`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshot(page, 'atm_parcelas');

    // Extrai parcelas em atraso
    const parcelas = await page.$$eval(
      'table tbody tr, .lista-parcelas .item, .parcela',
      items => items.map(el => ({
        texto: el.innerText.trim().replace(/\s+/g, ' ')
      }))
    ).catch(() => []);

    const conteudo = [
      `# ATM — Parcelas em Atraso — ${hoje()}`,
      '',
      ...parcelas.map(p => `- ${p.texto}`),
      '',
      `Total: ${parcelas.length} parcelas`,
    ].join('\n');

    const fp = await salvar('parcelas', `atm_${hoje()}.md`, conteudo);

    return { parcelas, total: parcelas.length, filepath: fp };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// NDN SEGUROS — Parcelas em Atraso
// ═══════════════════════════════════════════════════════════════════════════════

export async function relatorioParcelasNDN() {
  const loginRes = await login('ndn');
  if (!loginRes.ok) return loginRes;

  return executar('ndn', async (page) => {
    const url = process.env.NDN_URL_PARCELAS || `${SITES.ndn.url}/financeiro/inadimplentes`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshot(page, 'ndn_parcelas');

    const parcelas = await page.$$eval(
      'table tbody tr, .inadimplentes .row, .parcela-vencida',
      items => items.map(el => ({ texto: el.innerText.trim().replace(/\s+/g, ' ') }))
    ).catch(() => []);

    const conteudo = [
      `# NDN — Parcelas em Atraso — ${hoje()}`,
      '',
      ...parcelas.map(p => `- ${p.texto}`),
      '',
      `Total: ${parcelas.length} parcelas`,
    ].join('\n');

    const fp = await salvar('parcelas', `ndn_${hoje()}.md`, conteudo);

    return { parcelas, total: parcelas.length, filepath: fp };
  });
}

/**
 * Relatório consolidado de todas as seguradoras
 */
export async function relatorioParcelasConsolidado() {
  const [atm, ndn] = await Promise.allSettled([
    relatorioParcelasATM(),
    relatorioParcelasNDN(),
  ]);

  const resumo = {
    atm:   atm.value  || { ok: false, erro: atm.reason?.message },
    ndn:   ndn.value  || { ok: false, erro: ndn.reason?.message },
    total: (atm.value?.total || 0) + (ndn.value?.total || 0),
    data:  hoje(),
  };

  const conteudo = [
    `# Parcelas em Atraso — Consolidado — ${hoje()}`,
    '',
    `## ATM: ${resumo.atm.total || 0} parcelas`,
    resumo.atm.ok ? `→ Relatório: ${resumo.atm.filepath}` : `→ Erro: ${resumo.atm.erro}`,
    '',
    `## NDN: ${resumo.ndn.total || 0} parcelas`,
    resumo.ndn.ok ? `→ Relatório: ${resumo.ndn.filepath}` : `→ Erro: ${resumo.ndn.erro}`,
    '',
    `## Total geral: ${resumo.total} parcelas em atraso`,
  ].join('\n');

  const fp = await salvar('parcelas', `consolidado_${hoje()}.md`, conteudo);
  resumo.filepath = fp;
  resumo.markdown = conteudo;

  return resumo;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEGURADORAS — Relatórios gerais
// ═══════════════════════════════════════════════════════════════════════════════

export async function relatorioSeguradora(siteId) {
  const site = SITES[siteId];
  if (!site) return { ok: false, erro: `Site ${siteId} não mapeado` };

  const loginRes = await login(siteId);
  if (!loginRes.ok) return loginRes;

  return executar(siteId, async (page) => {
    await page.goto(site.url, { waitUntil: 'networkidle' });
    await screenshot(page, `${siteId}_home`);

    const texto = await page.innerText('body').catch(() => '');
    return {
      site:    site.nome,
      online:  true,
      preview: texto.slice(0, 1000),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAÚDE — Faturas do departamento
// ═══════════════════════════════════════════════════════════════════════════════

export async function emitirFaturaSaude({ operadora, mes, aprovado = false }) {
  const bloq = checarAprovacao('Emissão de Fatura de Saúde', aprovado);
  if (bloq) return bloq;

  if (!SITES.saude_operadora.url) {
    return { ok: false, erro: 'SAUDE_URL não configurado no .env' };
  }

  const loginRes = await login('saude_operadora');
  if (!loginRes.ok) return loginRes;

  return executar('saude_operadora', async (page) => {
    const url = process.env.SAUDE_URL_FATURAS || `${SITES.saude_operadora.url}/faturas`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await screenshot(page, 'saude_faturas');

    if (mes) await page.fill('input[name="mes"], #competencia', mes).catch(() => {});

    await page.click('button.gerar-fatura, .emitir, button[type="submit"]').catch(() => {});
    await page.waitForLoadState('networkidle');
    await screenshot(page, 'saude_fatura_gerada');

    return { msg: `Fatura saúde emitida — ${operadora} — ${mes}`, operadora, mes };
  });
}

export async function relatorioSaude() {
  const loginRes = await login('saude_operadora');
  if (!loginRes.ok) return loginRes;

  return executar('saude_operadora', async (page) => {
    const url = process.env.SAUDE_URL_RELATORIO || `${SITES.saude_operadora.url}/relatorios`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await screenshot(page, 'saude_relatorio');

    const dados = await page.innerText('body').catch(() => '');
    const fp    = await salvar('saude', `relatorio_${hoje()}.md`,
      `# Relatório Saúde — ${hoje()}\n\n${dados.slice(0, 5000)}`
    );

    return { filepath: fp, preview: dados.slice(0, 500) };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOMAÇÃO GENÉRICA (para quando o Jarvis precisar entrar em qualquer site)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Abre qualquer URL e retorna conteúdo + screenshot
 * Usa sessão do site se disponível
 */
export async function abrirSite(url, siteId = 'generic') {
  return executar(siteId, async (page) => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const titulo = await page.title();
    const texto  = await page.innerText('body').catch(() => '');
    await screenshot(page, `${siteId}_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`);
    return { url, titulo, texto: texto.slice(0, 3000) };
  });
}

/**
 * Preenche um formulário em qualquer site
 * campos = { seletor: valor, ... }
 * REQUER APROVAÇÃO se submit=true
 */
export async function preencherFormulario(url, campos, { siteId = 'generic', submit = false, aprovado = false } = {}) {
  if (submit) {
    const bloq = checarAprovacao(`Preenchimento de formulário em ${url}`, aprovado);
    if (bloq) return bloq;
  }

  return executar(siteId, async (page) => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshot(page, `${siteId}_pre_form`);

    for (const [seletor, valor] of Object.entries(campos)) {
      await page.fill(seletor, String(valor)).catch(async () => {
        // Fallback: tenta select ou checkbox
        await page.selectOption(seletor, String(valor)).catch(() => {});
      });
    }

    await screenshot(page, `${siteId}_form_preenchido`);

    if (submit) {
      await page.click('button[type="submit"], .btn-salvar, .submit').catch(() => {});
      await page.waitForLoadState('networkidle');
      await screenshot(page, `${siteId}_form_enviado`);
    }

    return { url, campos_preenchidos: Object.keys(campos).length, submetido: submit };
  });
}
