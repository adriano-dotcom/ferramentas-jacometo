# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Jarvis OS** — autonomous executive assistant for Jacometo Corretora de Seguros (transport insurance) and Orbe Pet (pet health plans). Telegram bot powered by Claude API with tool use, running on Mac Mini 2 (Node.js v22, ESM).

Bot: `@jarvisclaude` | Owner: Adriano Jacometo

## Commands

```bash
# Dev (auto-reload)
npm run dev

# Production
pm2 start src/index.js --name jarvis
pm2 logs jarvis

# Test individual tool
node -e "import('./src/skills.js').then(async({executeTool})=>console.log(JSON.stringify(await executeTool('TOOL_NAME',{param:'val'}),null,2)))"

# Test Playwright
npm run playwright:test

# Test memory
node -e "import('./src/memory.js').then(m=>{m.initMemory();console.log(m.getMemoryStats());})"

# Test web search
node -e "import('./src/search.js').then(async m=>console.log(await m.pesquisar('teste')))"

# Open dashboards
open dashboard-mission-control.html
open dashboard-gerentes.html      # Jacometo + Orbe dual view
open dashboard-gerente-loop.html  # Campaign → Sale loop
```

## Architecture

```
Telegram → index.js → claude.js (tool use loop) → skills.js (40+ tools)
                         ↓                            ↓
                    router.js                    External APIs:
                    (auto-selects model)         Pipedrive, Meta Ads,
                         ↓                      Google Ads, TikTok,
                    personality.js               Chatwoot (×2),
                    + memory.js                  ElevenLabs, Brave Search,
                    (system prompt              Playwright (Quiver/ATM/NDN),
                     with injected memory)       Agente ARQUIVO
```

### Request Flow
1. `index.js` receives Telegram message (text, voice, or command)
2. `router.js` auto-routes to Opus/Sonnet/Haiku based on keywords in the message
3. `claude.js` builds system prompt (personality + memory context), sends to Claude API with TOOLS array
4. Claude responds with `tool_use` blocks → `skills.js:executeTool()` dispatches to the right module
5. Tool results return to Claude for final response → sent back to Telegram

### Model Routing (`router.js`)
- **Opus** (`claude-opus-4-6`): strategy, claims analysis, complex decisions — keywords: `estratégia`, `sinistro`, `risco`, `apólice`
- **Sonnet** (`claude-sonnet-4-6`): reports, leads, campaigns — keywords: `leads`, `pipedrive`, `meta ads`, `briefing`, `relatório`
- **Haiku** (`claude-haiku-4-5-20251001`): quick checks, crons, greetings — keywords: `status`, `gasto hoje`, `oi`, `ok`

### Two Companies — Isolated Context (`empresas.js`)

**Jacometo Seguros** — transport insurance (RCTR-C, RC-DC)
- CRM: `crm.jacometo.com.br` (Chatwoot) → Pipedrive
- Ads: Meta Ads + Google Ads
- Webhook: `POST /webhook/jacometo` (port 3001)
- Labels: IDs 443-451 mapped to sales reps
- Cobranca activities: `user_id 15830108` (hardcoded, never change)

**Orbe Pet** — pet health plans (APet/Angelus)
- Plans: Essencial R$37.62 | Plus R$89.82 | Total R$107.82 | Galáxia R$138.32
- CRM: `crm.orbepet.com.br` (Chatwoot) → Pipedrive
- Ads: Meta + TikTok (main channel) + Google
- Webhook: `POST /webhook/orbe`

### Gerente Agent (the strategic brain)

`gerente.js` closes the full loop: Campaign → Chatwoot lead → Pipedrive deal → Won/Lost. It cross-references data from Meta/Google/TikTok spend with CRM pipeline to calculate CPL, conversion rates, and generate alerts + recommendations (always 2 options + Jarvis recommendation, awaiting Adriano's OK).

`gerente-orbe.js` — same pattern but Orbe-specific: tracks MRR, churn, plan activations, TikTok as primary channel.

Dashboard at `https://jarvis.jacometo.com.br/gerentes` visualizes both gerentes.

### Memory System (`memory.js`) — 5 Layers in SQLite

1. **History** — last 20 messages per user
2. **Facts** — semantic key-value pairs per user/global (`lembrarFato`/`recordarFato`)
3. **Project context** — active project state (`salvarContexto`/`getContextosAtivos`)
4. **Episodes** — important events (decisions, approvals, milestones)
5. **SOUL** — identity and rules (immutable personality core)

Memory is injected into the system prompt via `buildMemoryContext(userId)` in `personality.js`.

### Webhook Server (`webhook-server.js`)

Express on port 3001. Receives Chatwoot events for both companies, verifies HMAC signatures, dispatches to `processarWebhookChatwoot()`, and notifies Telegram on new leads/deals.

### Cron Jobs (`crons.js`) — Brasilia Time

Weekdays: 08:00 briefing, 09:00/14:00 Meta Ads alerts, 12:00 lead check, 17:30 daily summary. Daily: 07:00 stale leads, 07:30 ARQUIVO agent health, 20:00 Orbe Pet summary. All crons use `askJarvisWithModel()` with the appropriate model tier.

### Playwright Automations (`src/playwright/`)

Browser automation for insurance systems: Quiver PRO (transport invoices), ATM/NDN (overdue installments), insurance company portals (Tokio, Sompo, Allianz), health department. Sessions persist in `~/.jarvis/sessions/`.

### Agente ARQUIVO (remote Mac Mini)

Communicates via HTTP to `ferramentas.jacometo.com.br`. Runs Playwright automations on the other Mac Mini. Status checked via `statusAgenteArquivo()`. Shared output at `/Volumes/JarvisShared/clawd/out/`.

## Key Modules

| Module | Purpose |
|--------|---------|
| `skills.js` | TOOLS array definition + `executeTool()` switch — **the central dispatcher** |
| `claude.js` | Claude API wrapper, tool use loop, cost tracking |
| `router.js` | Auto model selection + cost estimation |
| `personality.js` | System prompt builder (SOUL + memory injection) |
| `memory.js` | SQLite-backed 5-layer memory |
| `meta.js` | Meta Marketing API (Graph v21.0) — insights, campaigns, alerts, GAP analysis |
| `pipedrive.js` | Pipedrive API v2 — deals, activities, funnel, consistency checks |
| `gerente.js` | Gerente Jacometo — full loop analysis, Chatwoot integration |
| `gerente-orbe.js` | Gerente Orbe Pet — MRR, churn, multi-channel (Meta+TikTok+Google) |
| `empresas.js` | Multi-company config (Chatwoot, Pipedrive, Meta, TikTok, Google per company) |
| `webhook-server.js` | Express webhooks for both Chatwoot instances |
| `crons.js` | 7+ scheduled jobs (briefing, alerts, summaries) |
| `search.js` | Brave Search web search + page reader |
| `voz.js` | ElevenLabs TTS + STT (multilingual_v2) |
| `ferramentas.js` | Generic connector to ferramentas.jacometo.com.br |
| `arquivo.js` | Remote ARQUIVO agent integration |

## How to Add Things

### New tool
1. Implement function in existing or new `src/module.js`
2. Import in `src/skills.js`
3. Add to `TOOLS` array with `name`, `description`, `input_schema`
4. Add `case 'tool_name':` in `executeTool()`

### New Playwright site
1. Add entry in `src/playwright/sites.js` → `SITES`
2. Add credentials in `.env`
3. Create automation functions in `src/playwright/automacoes.js`
4. Expose as tool in `skills.js`

### New cron job
1. Create `async function cronName()` in `src/crons.js`
2. Add `if (timeMatch(H, M)) await cronName();` in `checkSchedule()`

## SOUL Rules (NEVER violate)

```
NEVER execute financial actions without explicit OK from Adriano
NEVER delete CRM/Pipedrive/any system data
NEVER expose tokens/passwords/keys in chat or logs
ALWAYS point assertions to output files or verifiable links
ALWAYS require OK for external actions (messages, campaigns, deploys)
Pipedrive labels are ENUM → always use numeric ID (443-451)
Cobranca activities → user_id 15830108 (never change)
```

## Known Issues / Duplicates

- `skills.js` has TWO `executeTool()` definitions (lines ~699 and ~858) — the second is a legacy duplicate with different tools. Should be consolidated.
- `index.js` registers voice/audio handlers twice (once via `voice.js` imports, once via `voz.js` dynamic imports) — potential double-processing.
- `voz.js` and `voice.js` coexist — `voz.js` is the main module used by skills/commands, `voice.js` is imported in `index.js` for TTS/STT.

## Env Vars (critical ones)

```
TELEGRAM_TOKEN, ALLOWED_USER_IDS, ANTHROPIC_API_KEY
PIPEDRIVE_TOKEN_JACOMETO, PIPEDRIVE_DOMAIN_JACOMETO
CHATWOOT_TOKEN_JACOMETO, CHATWOOT_TOKEN_ORBE, CHATWOOT_SECRET_*
META_APP_TOKEN_JACOMETO, META_APP_TOKEN_ORBE, META_AD_ACCOUNT_*
GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_*
TIKTOK_ACCESS_TOKEN, TIKTOK_REFRESH_TOKEN, TIKTOK_ADVERTISER_ORBE
ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
BRAVE_SEARCH_API_KEY
QUIVER_USER/PASS, ATM_USER/PASS, NDN_USER/PASS
ARQUIVO_URL, ARQUIVO_TOKEN
```
