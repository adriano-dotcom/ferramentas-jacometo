/**
 * JARVIS — Playwright Engine
 * ==========================
 * Motor central de automação de browser nativo no Mac Mini 2.
 *
 * Capacidades:
 *   - Navegar em qualquer site (seguradoras, Quiver, ATM, NDN, saúde)
 *   - Preencher formulários, clicar, fazer upload/download
 *   - Tirar screenshots de evidência
 *   - Salvar estado de login (cookies/session) por site
 *   - Executar scripts de automação parametrizados
 *
 * Regras SOUL.md:
 *   - NUNCA executa ação destrutiva/financeira sem OK explícito
 *   - Screenshot obrigatório antes e depois de qualquer ação
 *   - Credenciais NUNCA aparecem no chat ou nos logs visíveis
 *   - Sessões salvas em ~/.jarvis/sessions/ (fora do repositório)
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = process.env.PLAYWRIGHT_SESSIONS_DIR
  || path.join(process.env.HOME || '~', '.jarvis', 'sessions');
const SCREENSHOTS_DIR = process.env.PLAYWRIGHT_SCREENSHOTS_DIR
  || path.join(__dirname, '../../../out/screenshots');
const DOWNLOADS_DIR = process.env.PLAYWRIGHT_DOWNLOADS_DIR
  || path.join(__dirname, '../../../out/downloads');

// ─── BROWSER SINGLETON ────────────────────────────────────────────────────────

let _browser = null;

export async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false', // headless por padrão
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled', // evita detecção de bot
      ],
      slowMo: Number(process.env.PLAYWRIGHT_SLOW_MO) || 0,
    });
    console.log('🎭 Playwright browser iniciado');
  }
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    console.log('🎭 Playwright browser encerrado');
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function hoje() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
function slugify(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30); }

async function ensureDirs() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
}

// ─── SESSÃO (login persistente por site) ─────────────────────────────────────

export function sessionPath(siteId) {
  return path.join(SESSIONS_DIR, `${slugify(siteId)}.json`);
}

export async function temSessao(siteId) {
  try {
    await fs.access(sessionPath(siteId));
    return true;
  } catch { return false; }
}

export async function salvarSessao(context, siteId) {
  await ensureDirs();
  await context.storageState({ path: sessionPath(siteId) });
  console.log(`✅ Sessão salva: ${siteId}`);
}

export async function carregarSessao(siteId) {
  const p = sessionPath(siteId);
  try {
    await fs.access(p);
    return p;
  } catch { return undefined; }
}

// ─── SCREENSHOT ───────────────────────────────────────────────────────────────

export async function screenshot(page, nome) {
  await ensureDirs();
  const filename = `${hoje()}_${slugify(nome)}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`📸 Screenshot: ${filepath}`);
  return filepath;
}

// ─── CRIAR CONTEXTO ───────────────────────────────────────────────────────────

/**
 * Cria contexto de browser para um site específico
 * Carrega sessão salva automaticamente se disponível
 */
export async function criarContexto(siteId, opcoes = {}) {
  const browser  = await getBrowser();
  const sessao   = await carregarSessao(siteId);

  const context = await browser.newContext({
    storageState:    sessao,
    acceptDownloads: true,
    downloadsPath:   DOWNLOADS_DIR,
    viewport:        { width: 1280, height: 800 },
    userAgent:       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale:          'pt-BR',
    timezoneId:      'America/Sao_Paulo',
    ...opcoes,
  });

  return context;
}

// ─── EXECUTAR AUTOMAÇÃO ───────────────────────────────────────────────────────

/**
 * Executa uma função de automação com contexto gerenciado.
 * Garante que browser e contexto são fechados ao final.
 * Tira screenshot automático em caso de erro.
 *
 * @param {string}   siteId   - identificador do site (usado para sessão e logs)
 * @param {Function} fn       - async (page, context) => resultado
 * @param {object}   opcoes   - opções extras do contexto
 */
export async function executar(siteId, fn, opcoes = {}) {
  await ensureDirs();
  const context = await criarContexto(siteId, opcoes);
  const page    = await context.newPage();

  // Intercepta erros de console para log
  page.on('console', msg => {
    if (msg.type() === 'error') console.warn(`[${siteId}] Console Error:`, msg.text());
  });

  let resultado;
  try {
    resultado = await fn(page, context);
    await screenshot(page, `${siteId}_sucesso`);
    return { ok: true, resultado, siteId };
  } catch (erro) {
    const ss = await screenshot(page, `${siteId}_erro`).catch(() => null);
    console.error(`❌ Playwright [${siteId}]:`, erro.message);
    return { ok: false, erro: erro.message, screenshot: ss, siteId };
  } finally {
    await context.close();
  }
}

// ─── AÇÕES GENÉRICAS ──────────────────────────────────────────────────────────

/**
 * Navega até uma URL e retorna o conteúdo da página
 */
export async function abrirPagina(url, siteId = 'generic') {
  return executar(siteId, async (page) => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const titulo  = await page.title();
    const texto   = await page.innerText('body').catch(() => '');
    return { url, titulo, texto: texto.slice(0, 3000) };
  });
}

/**
 * Faz download de um arquivo e retorna o caminho local
 */
export async function baixarArquivo(url, siteId = 'download') {
  return executar(siteId, async (page, context) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.goto(url),
    ]);
    const filename = download.suggestedFilename() || `download_${hoje()}`;
    const filepath = path.join(DOWNLOADS_DIR, filename);
    await download.saveAs(filepath);
    return { filename, filepath };
  });
}

/**
 * Extrai tabela de uma página
 */
export async function extrairTabela(url, seletor, siteId = 'extract') {
  return executar(siteId, async (page) => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const tabela = await page.$$eval(`${seletor} tr`, rows =>
      rows.map(row =>
        Array.from(row.querySelectorAll('td,th')).map(cell => cell.innerText.trim())
      )
    );
    return { tabela, linhas: tabela.length };
  });
}
