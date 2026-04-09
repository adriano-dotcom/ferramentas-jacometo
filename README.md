# 🤖 JARVIS OS — Guia de Instalação
**Jacometo Seguros & Orbe Pet · Build: 05/04/2026 · Versão FINAL**

---

## 📦 O que tem neste pacote

```
jarvis-claude-FINAL.zip          ← este projeto (código completo)
├── setup-manager.html           ← configurador visual de API Keys
├── CLAUDE.md                    ← contexto completo para Claude Code
├── ONBOARDING_PROMPT.md         ← prompt para colar no Claude Code
├── dashboard-mission-control.html
├── dashboard-gerentes.html
├── dashboard-kanban.html
├── dashboard-gerente-loop.html
├── setup.sh                     ← instala dependências
├── setup-playwright.sh          ← instala Playwright + Chromium
└── src/                         ← código do Jarvis (23 módulos)
```

---

## ✅ CHECKLIST — Do zero ao Jarvis online

### 1 · Verificar Node.js no Mac Mini 2
```bash
node --version    # precisa ser v22+
# Se não for: nvm install 22 && nvm use 22 && nvm alias default 22
```

### 2 · Descompactar
```bash
cd ~
unzip jarvis-claude-FINAL.zip -d jarvis-claude
cd jarvis-claude
```

### 3 · Configurar API Keys (Setup Manager)
```bash
open ~/jarvis-claude/setup-manager.html
```
Preencher todas as seções → **Gerar .env** → **Copiar** → no terminal:
```bash
pbpaste > ~/jarvis-claude/.env
```

**Keys já confirmadas ✅**
- Brave Search API Key
- ElevenLabs API Key

**Keys pendentes ⭕**
- `TELEGRAM_TOKEN` → criar bot no @BotFather
- `ANTHROPIC_API_KEY` → console.anthropic.com
- `PIPEDRIVE_TOKEN_JACOMETO` → Pipedrive → Settings → API
- `CHATWOOT_TOKEN_JACOMETO` → crm.jacometo.com.br → Profile → Access Token
- `CHATWOOT_SECRET_JACOMETO` → Chatwoot → Settings → Webhooks → Secret
- `CHATWOOT_TOKEN_ORBE` → crm.orbepet.com.br → Profile → Access Token
- `CHATWOOT_SECRET_ORBE` → Chatwoot Orbe → Settings → Webhooks → Secret
- `META_APP_TOKEN_JACOMETO` → Meta Developers → App Jacometo
- `META_APP_TOKEN_ORBE` → Meta Developers → App Orbe
- `TIKTOK_ACCESS_TOKEN` + `TIKTOK_REFRESH_TOKEN` → TikTok Business
- `ELEVENLABS_VOICE_JARVIS` → escolher voz (passo 7)
- `QUIVER_USER` + `QUIVER_PASS` → credenciais Quiver PRO
- `ATM_USER` + `ATM_PASS` → credenciais ATM
- `NDN_USER` + `NDN_PASS` → credenciais NDN

### 4 · Instalar dependências
```bash
cd ~/jarvis-claude
npm install
```

### 5 · Instalar Playwright + Chromium
```bash
chmod +x setup-playwright.sh && ./setup-playwright.sh
```

### 6 · Criar bot Telegram
1. Telegram → @BotFather → `/newbot`
2. Nome: `Jarvis Jacometo` | Username: `@jarvisclaude`
3. Copiar token → `TELEGRAM_TOKEN` no .env

**Descobrir seu Telegram ID:**
- Falar com `@userinfobot` → copiar ID → `ALLOWED_USER_IDS` no .env

### 7 · Escolher voz ElevenLabs
```bash
node -e "
import('./src/voice.js').then(async m => {
  const vozes = await m.listarVozes();
  vozes.forEach((v,i) => console.log(i+1+'.', v.nome.padEnd(22), '| ID:', v.id, '\n   ', v.preview||''));
});
"
```
Abrir os links de preview no browser → escolher → atualizar no .env:
```
ELEVENLABS_VOICE_JARVIS=ID_DA_VOZ_ESCOLHIDA
```

### 8 · Verificar sistema
```bash
# Memória
node -e "import('./src/memory.js').then(m=>{m.initMemory();console.log('✅ Memória:',m.getMemoryStats());})"

# Brave Search
node -e "import('./src/search.js').then(async m=>{const r=await m.pesquisar('teste');console.log(r.ok?'✅ Brave OK — '+r.resultados.length+' resultados':'❌ '+r.erro);})"

# ElevenLabs
node -e "import('./src/voice.js').then(async m=>{const s=await m.statusElevenLabs();console.log(s.ok?'✅ ElevenLabs:'+s.plano:'❌ '+s.erro);})"

# Playwright
node src/playwright/test.js
```

### 9 · Iniciar Jarvis
```bash
node src/index.js
# 🤖 Jarvis online — aguardando mensagens...
# 🌐 Webhook Server — porta 3001
# ⏰ Crons iniciados
```
No Telegram: enviar `/start` → deve responder ✅

### 10 · Rodar em background (produção)
```bash
npm install -g pm2
pm2 start src/index.js --name jarvis
pm2 save && pm2 startup   # iniciar no boot
pm2 logs jarvis            # monitorar
```

---

## 🎭 Usar com Claude Code

```bash
cd ~/jarvis-claude
claude    # já lê o CLAUDE.md automaticamente
```

**Colar este prompt na primeira abertura:**
> _(conteúdo completo em `ONBOARDING_PROMPT.md`)_

```
Estou iniciando o projeto JARVIS OS. Leia o CLAUDE.md e me dê:
1. Resumo do que está implementado
2. O que está pendente de configuração
3. Próxima tarefa mais importante

Depois me ajude a executar o setup e testar o sistema.
```

---

## 📊 Abrir Dashboards

```bash
open ~/jarvis-claude/dashboard-mission-control.html   # status geral
open ~/jarvis-claude/dashboard-gerentes.html          # Jacometo + Orbe dual
open ~/jarvis-claude/dashboard-kanban.html            # kanban dos agentes
open ~/jarvis-claude/dashboard-gerente-loop.html      # loop Campanha→Venda
```

---

## 🔗 Configurar Webhooks Chatwoot

Após Jarvis online, descobrir IP:
```bash
ipconfig getifaddr en0
```

**crm.jacometo.com.br** → Settings → Webhooks → Add:
- URL: `http://SEU_IP:3001/webhook/jacometo`
- Eventos: `conversation_created`, `conversation_updated`, `message_created`

**crm.orbepet.com.br** → Settings → Webhooks → Add:
- URL: `http://SEU_IP:3001/webhook/orbe`
- Mesmos eventos

---

## 🛠️ Comandos úteis

```bash
# Reiniciar após mudanças
pm2 restart jarvis

# Testar uma tool do Claude
node -e "import('./src/skills.js').then(async({executeTool})=>console.log(JSON.stringify(await executeTool('web_search',{query:'teste'}),null,2)))"

# Ver memória e SOUL
node -e "import('./src/memory.js').then(m=>{m.initMemory();console.log(m.getSoul());})"

# Status sessões Playwright
node -e "import('./src/playwright/sites.js').then(async m=>console.log(await m.statusSessoes()))"

# Status Agente ARQUIVO
node -e "import('./src/arquivo.js').then(async m=>console.log(await m.statusAgenteArquivo()))"
```

---

## 🗺️ Arquitetura resumida

```
Telegram @jarvisclaude
        ↓
   Jarvis OS — Mac Mini 2 — Node.js v22
        ↓ roteamento automático por mensagem
   Opus (estratégia) · Sonnet (geral) · Haiku (rápido)
        ↓ 40+ tools
   Pipedrive · Meta Ads · TikTok · Google Ads
   Chatwoot Jacometo · Chatwoot Orbe
   ElevenLabs TTS+STT · Brave Search
   Playwright nativo (Quiver, ATM, NDN, Saúde)
   Agente ARQUIVO ← Mac Mini Jarvis
        ↓
   Memória SQLite (5 camadas)
   13 cron jobs automáticos (07h–20h Brasília)
```

---

## ⚠️ Regras SOUL — nunca violar

```
🚫 NUNCA ação financeira sem OK explícito do Adriano
🚫 NUNCA deletar dados de CRM ou sistemas
🚫 NUNCA expor tokens/senhas no chat
✅ Label Pipedrive = ID numérico (443-451)
✅ Activity cobrança → user_id 15830108
✅ Toda afirmação → arquivo de output ou link
```

---

**Bom trabalho amanhã! 🚀**
