/**
 * JARVIS — Memória Avançada (Supabase)
 * ======================================
 * Sistema de memória multicamada:
 *   Camada 1 — Conversa:  histórico recente (100 msgs/usuário)
 *   Camada 2 — Fatos:     o que Jarvis aprendeu (semântica)
 *   Camada 3 — Contexto:  projetos e tarefas em andamento
 *   Camada 4 — Episódica: eventos importantes com timestamp
 *   Camada 5 — SOUL:      valores, regras e identidade do Jarvis
 *
 * Migrado de better-sqlite3 → Supabase (mesma interface pública, tudo async)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_KEY são obrigatórios no .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export function initMemory() {
  console.log('✅ Memória avançada: Supabase', SUPABASE_URL);
}

// ── SOUL ──────────────────────────────────────────────────────────────────────

export async function getSoul() {
  const { data, error } = await supabase.from('soul').select('chave, valor, categoria');
  if (error) { console.error('getSoul error:', error.message); return {}; }
  const soul = {};
  for (const r of data) {
    if (!soul[r.categoria]) soul[r.categoria] = {};
    soul[r.categoria][r.chave] = r.valor;
  }
  return soul;
}

export async function updateSoul(chave, valor, categoria = 'preferencia') {
  const { error } = await supabase.from('soul')
    .upsert({ chave, valor, categoria, updated_at: new Date().toISOString() }, { onConflict: 'chave' });
  if (error) console.error('updateSoul error:', error.message);
}

// ── HISTÓRICO ─────────────────────────────────────────────────────────────────

export async function getHistory(userId, limit = 20) {
  const { data, error } = await supabase
    .from('historico')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('getHistory error:', error.message); return []; }
  return data.reverse();
}

export async function saveMessage(userId, role, content, { model, tokens, sessionId } = {}) {
  const { error } = await supabase.from('historico')
    .insert({ user_id: userId, role, content });
  if (error) console.error('saveMessage error:', error.message);

  // Incrementa contador do usuário
  await supabase.rpc('increment_user_messages', { uid: userId }).catch(() => {
    // Se a RPC não existir, faz update direto
    supabase.from('users')
      .update({ total_mensagens: supabase.rpc ? undefined : 0, ultimo_acesso: new Date().toISOString() })
      .eq('user_id', userId)
      .then(() => {});
  });

  // Limpa histórico antigo (mantém 100)
  const { data: old } = await supabase
    .from('historico')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(100, 9999);
  if (old && old.length > 0) {
    await supabase.from('historico').delete().in('id', old.map(r => r.id));
  }
}

export async function clearHistory(userId) {
  const { error } = await supabase.from('historico').delete().eq('user_id', userId);
  if (error) console.error('clearHistory error:', error.message);
}

// ── USUÁRIOS ──────────────────────────────────────────────────────────────────

export async function upsertUser(userId, { nome, cargo, empresa, username } = {}) {
  const { error } = await supabase.from('users').upsert({
    user_id: userId,
    nome: nome || null,
    cargo: cargo || null,
    empresa: empresa || null,
    telegram_username: username || null,
    ultimo_acesso: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) console.error('upsertUser error:', error.message);
}

export async function getUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return data;
}

// ── FATOS (memória semântica) ─────────────────────────────────────────────────

export async function lembrarFato(userId, categoria, chave, valor, fonte = 'sistema') {
  // Supabase upsert precisa de constraint — usamos select+insert/update
  const valorStr = JSON.stringify(valor);
  const { data: existing } = await supabase
    .from('fatos')
    .select('id')
    .eq('user_id', userId || '')
    .eq('categoria', categoria)
    .eq('chave', chave)
    .maybeSingle();

  if (existing) {
    await supabase.from('fatos')
      .update({ valor: valorStr, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase.from('fatos')
      .insert({ user_id: userId || '', categoria, chave, valor: valorStr, updated_at: new Date().toISOString() });
  }
}

export async function lembrarFatoGlobal(categoria, chave, valor, fonte = 'sistema') {
  return lembrarFato('', categoria, chave, valor, fonte);
}

export async function recordarFato(userId, categoria, chave) {
  // Busca fato do usuário ou global (prioriza usuário)
  const { data } = await supabase
    .from('fatos')
    .select('valor, user_id')
    .in('user_id', [userId || '', ''])
    .eq('categoria', categoria)
    .eq('chave', chave)
    .order('user_id', { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return null;
  try { return JSON.parse(data[0].valor); } catch { return data[0].valor; }
}

export async function listarFatos(userId, categoria = null) {
  let query = supabase
    .from('fatos')
    .select('*')
    .in('user_id', [userId || '', ''])
    .order('updated_at', { ascending: false });
  if (categoria) query = query.eq('categoria', categoria);
  const { data, error } = await query;
  if (error) { console.error('listarFatos error:', error.message); return []; }
  return data.map(r => {
    try { r.valor = JSON.parse(r.valor); } catch {}
    return r;
  });
}

export async function esquecerFato(userId, categoria, chave) {
  await supabase.from('fatos')
    .delete()
    .eq('user_id', userId || '')
    .eq('categoria', categoria)
    .eq('chave', chave);
}

// ── EPISÓDIOS ─────────────────────────────────────────────────────────────────

export async function registrarEpisodio(userId, tipo, titulo, { descricao, dados, importancia } = {}) {
  await supabase.from('episodios').insert({
    user_id: userId || '',
    tipo,
    titulo,
    descricao: descricao || null,
    dados: dados || {},
  });
}

export async function getEpisodiosRecentes(userId, limite = 10, tipo = null) {
  let query = supabase
    .from('episodios')
    .select('*')
    .in('user_id', [userId || '', ''])
    .order('created_at', { ascending: false })
    .limit(limite);
  if (tipo) query = query.eq('tipo', tipo);
  const { data, error } = await query;
  if (error) { console.error('getEpisodios error:', error.message); return []; }
  return data;
}

// ── CONTEXTO ──────────────────────────────────────────────────────────────────

export async function salvarContexto(userId, projeto, { resumo, dados, status } = {}) {
  const ativo = status ? status === 'ativo' : true;
  const { data: existing } = await supabase
    .from('contextos')
    .select('id')
    .eq('user_id', userId || '')
    .eq('projeto', projeto)
    .maybeSingle();

  if (existing) {
    const upd = { updated_at: new Date().toISOString() };
    if (resumo !== undefined) upd.resumo = resumo;
    if (dados !== undefined) upd.dados = dados;
    if (status !== undefined) upd.ativo = ativo;
    await supabase.from('contextos').update(upd).eq('id', existing.id);
  } else {
    await supabase.from('contextos').insert({
      user_id: userId || '', projeto, resumo: resumo || null, dados: dados || {}, ativo,
    });
  }
}

export async function getContextosAtivos(userId) {
  const { data, error } = await supabase
    .from('contextos')
    .select('*')
    .eq('user_id', userId || '')
    .eq('ativo', true)
    .order('updated_at', { ascending: false });
  if (error) { console.error('getContextos error:', error.message); return []; }
  return data;
}

// ── SNAPSHOT PARA SYSTEM PROMPT (coração do sistema) ─────────────────────────

export async function buildMemoryContext(userId) {
  const [user, fatos, episodios, contextos] = await Promise.all([
    getUser(userId),
    listarFatos(userId),
    getEpisodiosRecentes(userId, 5),
    getContextosAtivos(userId),
  ]);

  const lines = [];

  if (user) {
    lines.push(`## Você está falando com`);
    lines.push(`Nome: ${user.nome || '?'} | Cargo: ${user.cargo || '?'} | Empresa: ${user.empresa || '?'}`);
    lines.push(`Interações anteriores: ${user.total_mensagens || 0}`);
    lines.push('');
  }

  if (fatos.length > 0) {
    const grupos = {};
    for (const f of fatos) {
      if (!grupos[f.categoria]) grupos[f.categoria] = [];
      grupos[f.categoria].push(`${f.chave}: ${typeof f.valor === 'object' ? JSON.stringify(f.valor) : f.valor}`);
    }
    lines.push(`## O que lembro sobre você e a empresa`);
    for (const [cat, itens] of Object.entries(grupos)) {
      lines.push(`[${cat}] ${itens.join(' | ')}`);
    }
    lines.push('');
  }

  if (contextos.length > 0) {
    lines.push(`## Projetos em andamento`);
    for (const c of contextos) lines.push(`- ${c.projeto}: ${c.resumo || ''}`);
    lines.push('');
  }

  if (episodios.length > 0) {
    lines.push(`## Eventos recentes`);
    for (const e of episodios) {
      const d = new Date(e.created_at).toLocaleDateString('pt-BR');
      lines.push(`- [${d}] ${e.titulo}`);
    }
  }

  return lines.join('\n');
}

// ── STATS ─────────────────────────────────────────────────────────────────────

export async function getMemoryStats() {
  const [h, f, c, e, s] = await Promise.all([
    supabase.from('historico').select('id', { count: 'exact', head: true }),
    supabase.from('fatos').select('id', { count: 'exact', head: true }),
    supabase.from('contextos').select('id', { count: 'exact', head: true }),
    supabase.from('episodios').select('id', { count: 'exact', head: true }),
    supabase.from('soul').select('id', { count: 'exact', head: true }),
  ]);
  return {
    historico:  h.count || 0,
    fatos:      f.count || 0,
    contextos:  c.count || 0,
    episodios:  e.count || 0,
    soul:       s.count || 0,
  };
}

// ── COMPAT LEGADO ─────────────────────────────────────────────────────────────
export const getUserContext    = getUser;
export const upsertUserContext = (id, nome, role) => upsertUser(id, { nome, cargo: role });
export const rememberFact      = (k, v) => lembrarFatoGlobal('geral', k, v);
export const recallFact        = (k)    => recordarFato(null, 'geral', k);
