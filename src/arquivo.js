/**
 * JARVIS OS — Agente ARQUIVO (Mac Mini Jarvis)
 * =============================================
 * Integração com ferramentas.jacometo.com.br
 * Projeto baseado em Playwright rodando no outro Mac Mini.
 *
 * O Agente ARQUIVO executa automações em:
 *   - Quiver PRO          → cadastro de faturas de transporte
 *   - Seguradoras (ATM, NDN, e outras) → relatórios de parcelas em atraso
 *   - Sites de saúde      → faturas departamento de saúde
 *
 * Comunicação entre os dois Mac Minis:
 *   Modo 1 — HTTP API     : POST /api/tasks → dispara automação
 *   Modo 2 — Shared Files : lê outputs de ~/clawd/out/ via pasta compartilhada
 *   Modo 3 — SSH          : executa comando remoto no Mac Mini Jarvis
 *
 * Regras SOUL.md:
 *   - NUNCA dispara automação em produção sem OK do Adriano
 *   - Toda automação com lado financeiro exige confirmação explícita
 *   - Screenshots de evidência obrigatórios para auditoria
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const ARQUIVO_URL    = process.env.ARQUIVO_URL    || 'https://ferramentas.jacometo.com.br';
const ARQUIVO_TOKEN  = process.env.ARQUIVO_TOKEN;   // API key do projeto ferramentas
const ARQUIVO_SECRET = process.env.ARQUIVO_SECRET;  // HMAC secret para webhook de retorno
const SHARED_DIR     = process.env.ARQUIVO_SHARED_DIR; // pasta montada do outro Mac Mini
                                                         // ex: /Volumes/JarvisShared/clawd/out
const OUT_DIR        = path.join(__dirname, '../../out/arquivo');

// ─── HTTP CLIENT ──────────────────────────────────────────────────────────────

function client() {
  return axios.create({
    baseURL: ARQUIVO_URL,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${ARQUIVO_TOKEN}`,
      'X-Jarvis-OS':   '2', // identifica o novo Mac Mini
    },
    timeout: 30000, // automações Playwright podem demorar
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function hoje() { return new Date().toISOString().split('T')[0]; }
async function salvar(nome, conteudo) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const fp = path.join(OUT_DIR, nome);
  await fs.writeFile(fp, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2));
  return fp;
}

// ─── TIPOS DE TAREFA ──────────────────────────────────────────────────────────

export const TAREFAS = {
  // ── QUIVER PRO ─────────────────────────────────────────────────────────────
  QUIVER_CADASTRO_FATURA: {
    id:          'quiver.cadastro_fatura',
    nome:        'Cadastro de Fatura no Quiver PRO',
    descricao:   'Cadastra fatura mensal de seguro transporte (RCTR-C, RC-DC) como endosso/fatura',
    requer_ok:   true,    // financeiro → exige OK do Adriano
    seguradoras: ['Tokio Marine','Sompo','AKAD','AXA','Chubb','Allianz'],
    timeout:     120000,  // 2 minutos por fatura
  },

  // ── RELATÓRIOS SEGURADORAS ─────────────────────────────────────────────────
  RELATORIO_PARCELAS_ATM: {
    id:          'relatorio.parcelas_atm',
    nome:        'Relatório de Parcelas em Atraso — ATM',
    descricao:   'Acessa portal ATM e extrai parcelas em atraso por cliente',
    requer_ok:   false,   // só leitura
    timeout:     60000,
  },
  RELATORIO_PARCELAS_NDN: {
    id:          'relatorio.parcelas_ndn',
    nome:        'Relatório de Parcelas em Atraso — NDN',
    descricao:   'Acessa portal NDN e extrai parcelas em atraso por cliente',
    requer_ok:   false,
    timeout:     60000,
  },
  RELATORIO_PARCELAS_GERAL: {
    id:          'relatorio.parcelas_todas',
    nome:        'Relatório Consolidado de Parcelas em Atraso',
    descricao:   'Consolida ATM + NDN + outras seguradoras em um único relatório',
    requer_ok:   false,
    timeout:     180000,
  },

  // ── SAÚDE ──────────────────────────────────────────────────────────────────
  SAUDE_FATURA: {
    id:          'saude.fatura',
    nome:        'Fatura Departamento de Saúde',
    descricao:   'Emite/baixa fatura de plano de saúde via portal da operadora',
    requer_ok:   true,    // financeiro
    timeout:     90000,
  },
  SAUDE_RELATORIO: {
    id:          'saude.relatorio',
    nome:        'Relatório de Saúde',
    descricao:   'Extrai relatório de beneficiários, coparticipações e vidas ativas',
    requer_ok:   false,
    timeout:     60000,
  },

  // ── ORBE PET ───────────────────────────────────────────────────────────────
  ORBE_FATURA_APET: {
    id:          'orbe.fatura_apet',
    nome:        'Fatura Orbe Pet — APet/Angelus',
    descricao:   'Emite fatura mensal dos planos Orbe Pet no sistema APet',
    requer_ok:   true,
    timeout:     90000,
  },
};

// ─── ACIONAR AUTOMAÇÃO (POST para o Agente ARQUIVO) ──────────────────────────

/**
 * Dispara uma automação no Mac Mini Jarvis via API
 * Retorna task_id para acompanhar status
 *
 * REGRA: tarefas com requer_ok=true precisam de aprovação explícita
 */
export async function acionarAutomacao(tarefaId, params = {}, aprovado = false) {
  const tarefa = Object.values(TAREFAS).find(t => t.id === tarefaId);
  if (!tarefa) throw new Error(`Tarefa desconhecida: ${tarefaId}`);

  // Bloqueia se requer OK e não foi aprovado
  if (tarefa.requer_ok && !aprovado) {
    return {
      ok:       false,
      bloqueado: true,
      motivo:   `"${tarefa.nome}" envolve ação financeira. Confirme antes de executar.`,
      tarefa,
      como_aprovar: 'Chame novamente com aprovado=true após confirmação do Adriano',
    };
  }

  try {
    const res = await client().post('/api/tasks', {
      task_id:   tarefaId,
      params,
      origem:    'jarvis-os-v2',
      timestamp: new Date().toISOString(),
    });

    return {
      ok:      true,
      task_id: res.data?.task_id || res.data?.id,
      status:  res.data?.status  || 'queued',
      tarefa:  tarefa.nome,
      msg:     `Automação "${tarefa.nome}" disparada. Aguardando execução no Mac Mini Jarvis.`,
    };
  } catch (e) {
    // Fallback se API não estiver disponível: registra para execução manual
    return {
      ok:          false,
      offline:     true,
      tarefa:      tarefa.nome,
      params,
      msg:         `Agente ARQUIVO offline (${e.message}). Tarefa registrada para execução manual.`,
      instrucao:   `No Mac Mini Jarvis, execute: node tasks/${tarefaId.replace('.','/')}.js`,
    };
  }
}

/**
 * Verifica status de uma tarefa em execução
 */
export async function statusTarefa(taskId) {
  try {
    const res = await client().get(`/api/tasks/${taskId}`);
    return {
      ok:          true,
      task_id:     taskId,
      status:      res.data?.status,       // queued|running|done|error
      progresso:   res.data?.progress,
      resultado:   res.data?.result,
      screenshot:  res.data?.screenshot_url,
      erro:        res.data?.error,
      concluido:   res.data?.status === 'done',
    };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/**
 * Lista tarefas recentes executadas pelo Agente ARQUIVO
 */
export async function listarTarefasRecentes(limite = 20) {
  try {
    const res = await client().get('/api/tasks', { params: { limit: limite } });
    return {
      ok:     true,
      tarefas: res.data?.tasks || res.data || [],
    };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ─── LEITURA DE OUTPUTS (modo filesystem compartilhado) ──────────────────────

/**
 * Lê relatórios de parcelas em atraso gerados pelo Agente ARQUIVO
 * Funciona via pasta compartilhada entre os dois Mac Minis
 */
export async function lerRelatorioParcelasAtraso(seguradora = null) {
  if (!SHARED_DIR) {
    // Tenta via API
    return await client().get('/api/reports/parcelas-atraso',
      { params: { seguradora } }
    ).then(r => ({ ok: true, via: 'api', data: r.data }))
     .catch(e => ({ ok: false, erro: e.message, instrucao: 'Configurar ARQUIVO_SHARED_DIR no .env' }));
  }

  try {
    const dir = path.join(SHARED_DIR, 'parcelas');
    const files = await fs.readdir(dir).catch(() => []);
    const recentes = files
      .filter(f => f.endsWith('.md') || f.endsWith('.json'))
      .filter(f => !seguradora || f.toLowerCase().includes(seguradora.toLowerCase()))
      .sort().reverse().slice(0, 5);

    const relatorios = await Promise.all(
      recentes.map(async f => ({
        arquivo:  f,
        conteudo: await fs.readFile(path.join(dir, f), 'utf8').catch(() => 'Erro ao ler'),
      }))
    );

    return { ok: true, via: 'filesystem', relatorios };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/**
 * Lê faturas cadastradas no Quiver PRO
 */
export async function lerFaturasQuiver(filtro = {}) {
  if (!SHARED_DIR) {
    return await client().get('/api/reports/quiver', { params: filtro })
      .then(r => ({ ok: true, via: 'api', data: r.data }))
      .catch(e => ({ ok: false, erro: e.message }));
  }

  try {
    const dir = path.join(SHARED_DIR, 'quiver');
    const files = await fs.readdir(dir).catch(() => []);
    const recentes = files.sort().reverse().slice(0, 10);

    const faturas = await Promise.all(
      recentes.map(async f => ({
        arquivo:  f,
        conteudo: await fs.readFile(path.join(dir, f), 'utf8').catch(() => ''),
      }))
    );

    return { ok: true, via: 'filesystem', faturas };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/**
 * Lê Mission Control do Agente ARQUIVO
 * (~/clawd/site-mission-control/data/mission_control.json)
 */
export async function lerMissionControlArquivo() {
  // Tenta via API primeiro
  try {
    const res = await client().get('/api/mission-control');
    return { ok: true, via: 'api', data: res.data };
  } catch {}

  // Fallback: filesystem compartilhado
  if (SHARED_DIR) {
    try {
      const fp = path.join(SHARED_DIR, '../site-mission-control/data/mission_control.json');
      const raw = await fs.readFile(fp, 'utf8');
      return { ok: true, via: 'filesystem', data: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, erro: e.message };
    }
  }

  return { ok: false, erro: 'Agente ARQUIVO não acessível. Configurar ARQUIVO_URL ou ARQUIVO_SHARED_DIR.' };
}

// ─── STATUS GERAL DO AGENTE ARQUIVO ──────────────────────────────────────────

/**
 * Snapshot completo do Agente ARQUIVO para o Jarvis
 */
export async function statusAgenteArquivo() {
  const [api, mc, parcelas, faturas] = await Promise.allSettled([
    client().get('/api/health').then(r => ({ online: true, data: r.data })).catch(e => ({ online: false, erro: e.message })),
    lerMissionControlArquivo(),
    lerRelatorioParcelasAtraso(),
    lerFaturasQuiver(),
  ]);

  return {
    timestamp:   new Date().toISOString(),
    url:         ARQUIVO_URL,
    api:         api.value  || { online: false },
    mission_control: mc.value || {},
    parcelas:    parcelas.value || {},
    faturas:     faturas.value  || {},
    tarefas_disponiveis: Object.values(TAREFAS).map(t => ({
      id:        t.id,
      nome:      t.nome,
      requer_ok: t.requer_ok,
    })),
    configurado: !!ARQUIVO_TOKEN,
    como_configurar: !ARQUIVO_TOKEN ? [
      '1. No Mac Mini Jarvis, encontre a API key do projeto ferramentas',
      '2. Adicione ARQUIVO_TOKEN=... no .env do jarvis-claude',
      '3. Adicione ARQUIVO_URL=https://ferramentas.jacometo.com.br',
      '4. Opcional: montar pasta compartilhada e definir ARQUIVO_SHARED_DIR',
    ] : null,
  };
}

// ─── RELATÓRIO CONSOLIDADO (para o Gerente) ───────────────────────────────────

/**
 * Gera relatório consolidado do Agente ARQUIVO
 * Usado pelo Gerente Jacometo na análise de negócios
 */
export async function gerarRelatorioArquivo() {
  const status = await statusAgenteArquivo();
  const data   = hoje();

  const linhas = [
    `# Relatório Agente ARQUIVO — ${data}`,
    `URL: ${ARQUIVO_URL}`,
    `Status API: ${status.api.online ? '✅ Online' : '❌ Offline'}`,
    '',
    `## Tarefas Disponíveis`,
    Object.values(TAREFAS).map(t =>
      `- ${t.requer_ok ? '⚠️' : '✅'} **${t.nome}** (\`${t.id}\`)${t.requer_ok ? ' — requer OK' : ''}`
    ).join('\n'),
    '',
    `## Mission Control (Agente ARQUIVO)`,
    status.mission_control.ok
      ? JSON.stringify(status.mission_control.data, null, 2).slice(0, 500)
      : '❌ Não disponível — ' + (status.mission_control.erro || 'configurar acesso'),
    '',
    `## Parcelas em Atraso`,
    status.parcelas.ok
      ? `${status.parcelas.relatorios?.length || 0} relatórios disponíveis`
      : '❌ Não disponível',
    '',
    `## Configuração`,
    `- ARQUIVO_URL: ${ARQUIVO_URL}`,
    `- ARQUIVO_TOKEN: ${ARQUIVO_TOKEN ? '✅ configurado' : '❌ não configurado'}`,
    `- ARQUIVO_SHARED_DIR: ${SHARED_DIR || '❌ não configurado'}`,
  ];

  const content  = linhas.join('\n');
  const filepath = await salvar(`arquivo_${data}.md`, content);
  return { status, filepath, markdown: content };
}
