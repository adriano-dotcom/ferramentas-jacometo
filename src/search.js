/**
 * JARVIS — Web Search
 * Brave Search API + DuckDuckGo fallback + leitura de página
 */

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;

export async function pesquisar(query, opcoes = {}) {
  if (query.startsWith('http')) return lerPagina(query, opcoes);
  if (BRAVE_KEY) return bravePesquisar(query, opcoes);
  return duckduckgoPesquisar(query);
}

export async function bravePesquisar(query, opcoes = {}) {
  if (!BRAVE_KEY) return duckduckgoPesquisar(query);
  try {
    const res = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
      params: { q: query, count: opcoes.count || 5, lang: 'pt-BR' },
      timeout: 10000,
    });
    const web   = res.data?.web?.results   || [];
    const news  = res.data?.news?.results  || [];
    return {
      ok: true, fonte: 'brave', query,
      web:      web.map(r => ({ titulo: r.title, url: r.url, descricao: r.description, data: r.age })),
      noticias: news.map(n => ({ titulo: n.title, url: n.url, descricao: n.description, data: n.age })),
      total: web.length + news.length,
    };
  } catch (e) { return duckduckgoPesquisar(query); }
}

export async function duckduckgoPesquisar(query) {
  try {
    const res = await axios.get('https://api.duckduckgo.com/', {
      params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
      timeout: 8000,
    });
    const d = res.data;
    const resultados = [];
    if (d.AbstractText) resultados.push({ titulo: d.Heading || query, url: d.AbstractURL, descricao: d.AbstractText });
    (d.RelatedTopics || []).slice(0, 4).forEach(t => {
      if (t.Text && t.FirstURL) resultados.push({ titulo: t.Text.slice(0, 80), url: t.FirstURL, descricao: t.Text });
    });
    return { ok: true, fonte: 'duckduckgo', query, web: resultados, noticias: [], total: resultados.length };
  } catch (e) { return { ok: false, erro: e.message, query }; }
}

export async function lerPagina(url, opcoes = {}) {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      timeout: 15000, responseType: 'text',
    });
    // Extração simples sem JSDOM (não instalar dep extra)
    const texto = res.data
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .slice(0, opcoes.maxChars || 4000);
    const titulo = (res.data.match(/<title[^>]*>(.*?)<\/title>/i) || [])[1] || '';
    return { ok: true, url, titulo, texto };
  } catch (e) { return { ok: false, url, erro: e.message }; }
}
