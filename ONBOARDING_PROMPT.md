# PROMPT DE ONBOARDING — JARVIS OS
# Cole este prompt no Claude Code ao abrir o projeto pela primeira vez

---

Você está trabalhando no projeto **JARVIS OS** — assistente executivo autônomo da Jacometo Corretora de Seguros e Orbe Pet.

## Contexto do projeto

Este é um bot Telegram com Claude API nativo, rodando no Mac Mini 2 (jarvisjacometo).
O projeto está em `~/jarvis-claude/` e tem um `CLAUDE.md` na raiz com toda a documentação.

**Leia o CLAUDE.md agora antes de qualquer coisa:**
```
cat ~/jarvis-claude/CLAUDE.md
```

## Setup inicial (se ainda não foi feito)

```bash
cd ~/jarvis-claude

# 1. Verificar Node.js
node --version   # deve ser v22+

# 2. Instalar dependências
npm install

# 3. Instalar Playwright
./setup-playwright.sh

# 4. Verificar .env
cat .env | head -20

# 5. Criar diretórios de output
mkdir -p out/{meta,pipedrive,gerente,orbe,parcelas,quiver,screenshots,downloads,audio}
mkdir -p memory
mkdir -p ~/.jarvis/sessions
```

## Verificação rápida do sistema

```bash
# Testar se tudo está ok
node -e "
import('./src/memory.js').then(m => {
  m.initMemory();
  console.log('✅ Memória:', m.getMemoryStats());
});
"

node -e "
import('./src/search.js').then(async m => {
  const s = m.statusWebSearch();
  console.log('🔍 Web Search:', s.provedor_ativo, s[s.provedor_ativo].configurado ? '✅' : '❌');
});
"

node -e "
import('./src/voice.js').then(async m => {
  const s = await m.statusElevenLabs();
  console.log('🎙️ ElevenLabs:', s.ok ? '✅ ' + s.plano : '❌ ' + s.erro);
});
"
```

## Tarefas de hoje

Com base no backlog do CLAUDE.md, as prioridades são:

1. **Configurar tokens pendentes no .env** — usar o Setup Manager (jarvis-setup-manager.html)
2. **Testar bot Telegram** — `node src/index.js` e enviar `/start` no Telegram
3. **Configurar webhooks Chatwoot** — apontar para `http://SEU_IP:3001/webhook/jacometo`
4. **Testar Playwright** — `node src/playwright/test.js`

## Como trabalhar neste projeto

- **Stack**: Node.js ESM, use `import/export` (não `require`)
- **Sempre testar** antes de modificar arquivos críticos (skills.js, claude.js, memory.js)
- **SOUL.md**: nunca implementar ações destrutivas sem verificar `aprovado === true`
- **Outputs**: toda automação salva resultado em `out/subdir/YYYY-MM-DD.md`
- **Debug de tool**: `node -e "import('./src/skills.js').then(async ({executeTool}) => console.log(await executeTool('nome', {})))"`

Qual tarefa quer começar?
