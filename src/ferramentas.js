/**
 * JARVIS OS — Conector: ferramentas.jacometo.com.br
 * ==================================================
 * Lê dados do projeto rodando no Mac Mini Jarvis (outro Mac Mini).
 * URL base: https://ferramentas.jacometo.com.br
 *
 * STATUS: PREPARADO — aguardando configuração de acesso
 *
 * Para ativar, preencher no .env:
 *   FERRAMENTAS_URL=https://ferramentas.jacometo.com.br
 *   FERRAMENTAS_TOKEN=SEU_TOKEN_OU_COOKIE
 *   FERRAMENTAS_TYPE=api|scrape|internal
 *
 * Suporta 3 modos de integração:
 *   1. API REST  — se tiver endpoint /api/*
 *   2. Scraping  — se for interface web (Lovable/Next.js)
 *   3. Internal  — leitura direta via SSH/filesystem (Mac Mini local)
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../../out/ferramentas');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const BASE_URL = process.env.FERRAMENTAS_URL    || 'https://ferramentas.jacometo.com.br';
const TOKEN    = process.env.FERRAMENTAS_TOKEN;   // API key, Bearer, ou cookie de sessão
const TYPE     = process.env.FERRAMENTAS_TYPE     || 'api'; // 'api' | 'scrape' | 'internal'
const USER     = process.env.FERRAMENTAS_USER;    // se precisar de login básico
const PASS     = process.env.FERRAMENTAS_PASS;

// Diretório compartilhado entre os dois Mac Minis (se montado via NFS/SMB)
const SHARED_DIR = process.env.FERRAMENTAS_SHARED_DIR || null; // ex: /Volumes/jarvis-shared

// ─── HTTP CLIENT ──────────────────────────────────────────────────────────────

function buildClient() {
  const headers = { 'Content-Type': 'application/json' };

  // Suporte a múltiplos tipos de autenticação
  if (TOKEN) {
    // Tenta Bearer primeiro, fallback para cookie ou custom header
    if (TOKEN.startsWith('ey')) {
      headers['Authorization'] = `Bearer ${TOKEN}`;
    } else if (TOKEN.includes('=')) {
      headers['Cookie'] = TOKEN; // cookie de sessão
    } else {
      headers['X-API-Key']     = TOKEN;
      headers['Authorization'] = `Bearer ${TOKEN}`;
    }
  }

  const config = {
    baseURL:  BASE_URL,
    headers,
    timeout:  15000,
    // Ignora SSL self-signed (Mac Mini local)
    // httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  };

  // Auth básico se configurado
  if (USER && PASS) config.auth = { username: USER, password: PASS };

  return axios.create(config);
}

// ─── VERIFICAÇÃO DE STATUS ────────────────────────────────────────────────────

/**
 * Verifica se a plataforma está online e acessível
 * Tenta diferentes endpoints comuns
 */
export async function verificarStatus() {
  const client = buildClient();
  const endpoints = [
    '/api/health',
    '/api/status',
    '/health',
    '/status',
    '/api',
    '/ferramentas/api',
    '/',
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await client.get(endpoint, { timeout: 5000 });
      return {
        online:   true,
        endpoint,
        status:   res.status,
        tipo:     detectarTipo(res),
        data:     res.data,
      };
    } catch (e) {
      if (e.response?.status === 401 || e.response?.status === 403) {
        return {
          online:   true,
          endpoint,
          status:   e.response.status,
          tipo:     'protegido',
          erro:     'Autenticação necessária — configurar FERRAMENTAS_TOKEN no .env',
        };
      }
      // continua tentando outros endpoints
    }
  }

  return { online: false, erro: 'Nenhum endpoint respondeu — verificar URL e rede' };
}

function detectarTipo(res) {
  const ct = res.headers?.['content-type'] || '';
  if (ct.includes('application/json')) return 'api-json';
  if (ct.includes('text/html'))        return 'webapp';
  return 'desconhecido';
}

// ─── MODO API REST ────────────────────────────────────────────────────────────

/**
 * Busca dados genéricos de um endpoint da API
 * Adaptar conforme rotas disponíveis na plataforma
 */
export async function apiGet(endpoint, params = {}) {
  if (TYPE !== 'api') throw new Error('Modo API não configurado. Definir FERRAMENTAS_TYPE=api');
  const client = buildClient();
  try {
    const res = await client.get(endpoint, { params });
    return { ok: true, data: res.data, endpoint };
  } catch (e) {
    return { ok: false, erro: e.response?.data || e.message, endpoint };
  }
}

export async function apiPost(endpoint, body = {}) {
  if (TYPE !== 'api') throw new Error('Modo API não configurado');
  const client = buildClient();
  try {
    const res = await client.post(endpoint, body);
    return { ok: true, data: res.data };
  } catch (e) {
    return { ok: false, erro: e.response?.data || e.message };
  }
}

// ─── ENDPOINTS PROVÁVEIS (detectados pelo nome "ferramentas") ─────────────────
// Adaptar conforme documentação real da plataforma

/**
 * Busca cotações/propostas geradas na plataforma
 */
export async function getCotacoes(filtros = {}) {
  const endpoints = [
    '/api/cotacoes',
    '/api/propostas',
    '/api/quotes',
    '/ferramentas/api/cotacoes',
    '/api/v1/cotacoes',
  ];

  for (const ep of endpoints) {
    const res = await apiGet(ep, filtros);
    if (res.ok) return res;
  }

  return { ok: false, erro: 'Endpoint de cotações não encontrado — verificar rotas da plataforma' };
}

/**
 * Busca apólices gerenciadas
 */
export async function getApolices(filtros = {}) {
  const endpoints = [
    '/api/apolices',
    '/api/policies',
    '/ferramentas/api/apolices',
    '/api/v1/apolices',
  ];

  for (const ep of endpoints) {
    const res = await apiGet(ep, filtros);
    if (res.ok) return res;
  }

  return { ok: false, erro: 'Endpoint de apólices não encontrado' };
}

/**
 * Busca clientes/transportadoras
 */
export async function getClientes(filtros = {}) {
  const endpoints = [
    '/api/clientes',
    '/api/customers',
    '/api/transportadoras',
    '/ferramentas/api/clientes',
  ];

  for (const ep of endpoints) {
    const res = await apiGet(ep, filtros);
    if (res.ok) return res;
  }

  return { ok: false, erro: 'Endpoint de clientes não encontrado' };
}

/**
 * Busca sinistros
 */
export async function getSinistros(filtros = {}) {
  const endpoints = [
    '/api/sinistros',
    '/api/claims',
    '/ferramentas/api/sinistros',
  ];

  for (const ep of endpoints) {
    const res = await apiGet(ep, filtros);
    if (res.ok) return res;
  }

  return { ok: false, erro: 'Endpoint de sinistros não encontrado' };
}

// ─── MODO INTERNAL (Mac Mini → Mac Mini) ─────────────────────────────────────

/**
 * Lê arquivos de output gerados pelo Jarvis do outro Mac Mini
 * Funciona se os dois Macs tiverem pasta compartilhada (NFS, SMB ou mesmo iCloud Drive)
 */
export async function lerOutputsJarvisExterno(subdir = '') {
  if (!SHARED_DIR) {
    return { ok: false, erro: 'FERRAMENTAS_SHARED_DIR não configurado. Montar pasta compartilhada entre os dois Mac Minis.' };
  }

  try {
    const dir = path.join(SHARED_DIR, subdir);
    const files = await fs.readdir(dir);
    const mdFiles = files.filter(f => f.endsWith('.md') || f.endsWith('.json'));

    const outputs = [];
    for (const file of mdFiles.slice(-10)) { // últimos 10 arquivos
      const content = await fs.readFile(path.join(dir, file), 'utf8');
      outputs.push({ arquivo: file, conteudo: content.slice(0, 2000) }); // primeiros 2000 chars
    }

    return { ok: true, outputs, total: files.length };
  } catch (e) {
    return { ok: false, erro: `Erro ao ler diretório compartilhado: ${e.message}` };
  }
}

// ─── SNAPSHOT COMPLETO ────────────────────────────────────────────────────────

/**
 * Tenta buscar todos os dados disponíveis da plataforma
 * Usado pelo Gerente para cruzar dados
 */
export async function getSnapshotCompleto() {
  const [status, cotacoes, apolices, clientes, sinistros] = await Promise.allSettled([
    verificarStatus(),
    getCotacoes(),
    getApolices(),
    getClientes(),
    getSinistros(),
  ]);

  const snapshot = {
    timestamp:    new Date().toISOString(),
    url:          BASE_URL,
    tipo:         TYPE,
    status:       status.value  || { online: false },
    cotacoes:     cotacoes.value || { ok: false },
    apolices:     apolices.value || { ok: false },
    clientes:     clientes.value || { ok: false },
    sinistros:    sinistros.value || { ok: false },
    configurado:  !!TOKEN,
  };

  // Salva snapshot
  await fs.mkdir(OUT_DIR, { recursive: true }).catch(() => {});
  const hoje = new Date().toISOString().split('T')[0];
  await fs.writeFile(
    path.join(OUT_DIR, `ferramentas_${hoje}.json`),
    JSON.stringify(snapshot, null, 2)
  ).catch(() => {});

  return snapshot;
}

// ─── DESCOBERTA DE API (para quando não souber as rotas) ─────────────────────

/**
 * Tenta descobrir rotas disponíveis na plataforma
 * Útil para quando a documentação não estiver disponível
 */
export async function descobrirRotas() {
  const client = buildClient();
  const candidatos = [
    // Padrões REST comuns
    '/api', '/api/v1', '/api/v2',
    // Específicos de seguros
    '/api/cotacoes', '/api/apolices', '/api/sinistros', '/api/clientes',
    '/api/veiculos', '/api/cargas', '/api/transportadoras',
    '/api/seguradoras', '/api/ramos', '/api/coberturas',
    // Padrões Next.js / Lovable
    '/api/data', '/api/dashboard', '/api/reports',
    '/api/ferramentas', '/ferramentas/api',
    // OpenAPI / Swagger
    '/docs', '/swagger', '/openapi.json', '/api/docs',
    // Relatórios
    '/api/relatorios', '/api/reports', '/api/analytics',
  ];

  const encontradas = [];
  const results = await Promise.allSettled(
    candidatos.map(ep => client.get(ep, { timeout: 3000 }))
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      encontradas.push({
        endpoint: candidatos[i],
        status:   result.value.status,
        tipo:     detectarTipo(result.value),
        preview:  JSON.stringify(result.value.data).slice(0, 100),
      });
    } else if (result.reason?.response?.status === 401 ||
               result.reason?.response?.status === 403) {
      encontradas.push({
        endpoint: candidatos[i],
        status:   result.reason.response.status,
        tipo:     'protegido',
        preview:  'Autenticação necessária',
      });
    }
  });

  return {
    url:        BASE_URL,
    encontradas,
    total:      encontradas.length,
    instrucao:  encontradas.length === 0
      ? 'Nenhuma rota pública encontrada. Verificar: 1) URL correta 2) Token no .env 3) Firewall/VPN'
      : `${encontradas.length} rotas encontradas. Configurar endpoints no .env.`,
  };
}
