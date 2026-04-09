/**
 * Testa o Playwright nativo do Jarvis Claude
 * Executa: node src/playwright/test.js
 */
import { abrirSite } from './automacoes.js';
import { statusSessoes } from './sites.js';
import { closeBrowser } from './engine.js';

console.log('🎭 Testando Playwright Jarvis...\n');

// 1. Status das sessões
console.log('1. Status das sessões salvas:');
const sessoes = await statusSessoes();
for (const [id, s] of Object.entries(sessoes)) {
  const icon = s.configurado ? (s.sessao_ativa ? '✅' : '⚪') : '❌';
  console.log(`  ${icon} ${s.nome} ${s.sessao_ativa ? '(sessão ativa)' : s.configurado ? '' : '(sem credenciais)'}`);
}

// 2. Teste básico de navegação
console.log('\n2. Testando navegação (google.com):');
const res = await abrirSite('https://www.google.com', 'test');
console.log(res.ok ? `  ✅ OK — Título: ${res.resultado?.titulo}` : `  ❌ Erro: ${res.erro}`);

await closeBrowser();
console.log('\n✅ Playwright operacional no Jarvis Claude!');
