# CLAUDE.md — Ferramentas Jacometo Seguros

Este arquivo instrui o Claude Code sobre a arquitetura, convenções e como trabalhar neste projeto.

## O que é este projeto

Hub interno de automações RPA da **Jacometo Corretora de Seguros**.
Acessa portais de seguradoras via Playwright (headless Chromium), extrai dados, gera CSVs e envia emails.
Roda em um **Mac Mini local (Jarvis)** exposto via Cloudflare Tunnel em `ferramentas.jacometo.com.br`.

## Estrutura

```
ferramentas-jacometo/
├── backend/                  # Node.js + Express + Playwright
│   ├── src/
│   │   ├── server.js         # Entry point — registra todas as rotas
│   │   ├── jobs/             # Um arquivo por automação
│   │   │   ├── config.js     # Painel de credenciais (AES-256, getCred())
│   │   │   ├── allianz-inadimplentes.js
│   │   │   ├── tokio-inadimplentes.js
│   │   │   └── ... (um por seguradora)
│   │   └── lib/
│   │       ├── browser.js    # Fábrica Playwright (headless, pt-BR, downloads)
│   │       ├── email.js      # Nodemailer Gmail
│   │       └── logger.js     # Log em arquivo + console
│   ├── config/               # credenciais.json gerado pelo painel (gitignored)
│   ├── downloads/            # CSVs e screenshots (gitignored)
│   ├── logs/                 # Logs diários (gitignored)
│   ├── credentials.json      # Google Service Account (gitignored — nunca commitar)
│   ├── .env                  # Variáveis de ambiente (gitignored)
│   └── package.json
│
├── frontend/                 # Next.js 14 App Router
│   ├── app/
│   │   ├── layout.tsx        # Root layout com CSS vars (dark mode incluso)
│   │   ├── globals.css       # Design tokens — var(--bg), var(--surface), etc.
│   │   ├── login/page.tsx    # Tela de login (senha única → cookie httpOnly)
│   │   ├── ferramentas/
│   │   │   ├── page.tsx      # Hub — grid de cards filtráveis por responsável
│   │   │   ├── configuracoes/page.tsx  # Painel de credenciais
│   │   │   └── [slug]/page.tsx         # Uma página por automação
│   │   └── api/auth/login/route.ts
│   ├── components/
│   │   └── JobStatus.tsx     # Componente reutilizável: polling + progresso + falhas
│   ├── middleware.ts          # Protege todas as rotas com cookie de auth
│   ├── next.config.js        # Proxy: /api/rpa/* → localhost:3001/api/*
│   └── package.json
│
├── instalar.sh               # Setup completo no Mac Mini (rodar uma vez)
├── atualizar.sh              # git pull + rebuild + pm2 restart
├── TUNNEL.md                 # Instruções Cloudflare Tunnel
└── CLAUDE.md                 # Este arquivo
```

## Padrão de um job (seguir sempre)

Cada arquivo em `backend/src/jobs/` exporta uma função handler Express e um `getJobStatus`:

```js
// 1. Imports obrigatórios
require('dotenv').config()
const { getCred } = require('./config')  // credenciais do painel

// 2. Store de jobs em memória (TTL 2h)
const JOBS = new Map()
function criarJob() { ... }
function atualizar(id, dados) { ... }
module.exports.getJobStatus = (req, res) => { ... }

// 3. Credenciais — lidas no topo do módulo (let para serem mutáveis)
const _cred = getCred('nome_seguradora')
let LOGIN_USER  = _cred.usuario || ''
let LOGIN_SENHA = _cred.senha   || ''
let PORTAL_URL  = _cred.url     || ''

// 4. Handler — responde imediatamente com jobId, processa em setImmediate
module.exports = async function routeXxx(req, res) {
  const jobId = criarJob()
  res.json({ ok: true, jobId })

  setImmediate(async () => {
    // SEMPRE recarrega credenciais aqui (pega atualizações do painel em tempo real)
    const _creds = getCred('nome_seguradora')
    LOGIN_USER  = _creds.usuario || LOGIN_USER
    LOGIN_SENHA = _creds.senha   || LOGIN_SENHA
    PORTAL_URL  = _creds.url     || PORTAL_URL

    const { browser, page } = await abrirBrowser()
    try {
      atualizar(jobId, { progresso: 0 })
      // ... lógica de automação ...
      atualizar(jobId, { status: 'concluido', progresso: N, resultados: [...] })
    } catch (e) {
      atualizar(jobId, { status: 'erro_critico', ... })
    } finally {
      await fecharBrowser(browser)
    }
  })
}
```

## Estrutura do objeto `resultados` (para o JobStatus do frontend)

```js
{
  nome: 'Nome do segurado ou item',
  sub:  'Detalhe — apólice, valor, vencimento',
  status: 'OK' | 'FALHA' | 'AVISO',
  label: 'Descrição do erro (null se OK)',
  orientacao: 'O que fazer (null se OK)',
  erro: 'Mensagem técnica (null se OK)',
  tipo: 'LOGIN_FALHOU' | 'TIMEOUT' | 'NAVEGACAO' | 'DOWNLOAD_FALHOU' | null,
  screenshotPath: '/caminho/para/screenshot.png' // opcional
}
```

## Credenciais — sistema de configuração

As credenciais **não ficam no .env**. Ficam no painel `/ferramentas/configuracoes`.

- `backend/src/jobs/config.js` — define os portais e campos, lê/salva `config/credenciais.json` com AES-256
- `getCred('nome_seguradora')` — retorna `{ url, usuario, senha, ... }` descriptografado
- Chaves de seguradora disponíveis: `allianz`, `tokio`, `axa`, `chubb`, `sompo`, `akad`, `yelum`, `mitsui`, `essor`, `metlife`, `unimed_seguros`, `unimed_boletos`, `quiver`, `plano_hospitalar`

## Registrar nova rota no server.js

```js
// 1. Import no topo
const routeNovaSeguradora = require('./jobs/nova-seguradora')
const { getJobStatus: statusNova } = routeNovaSeguradora

// 2. Rotas
app.post('/api/nova-seguradora/executar',       routeNovaSeguradora)
app.get('/api/nova-seguradora/status/:jobId',  statusNova)
```

## Adicionar nova seguradora ao painel de configurações

Em `backend/src/jobs/config.js`, no objeto `PADRAO`:

```js
nova_seguradora: {
  label:  'Nome Exibido',
  url:    'https://portal.seguradora.com.br',
  campos: { usuario: 'user_padrao', senha: '' },
},
```

## Variáveis de ambiente necessárias (.env)

```
PORT=3001
FRONTEND_URL=https://ferramentas.jacometo.com.br
HEADLESS=true
DOWNLOAD_DIR=./downloads
SMTP_USER=automacao@jacometo.com.br
SMTP_PASS=xxxx xxxx xxxx xxxx
EMAIL_EQUIPE=adriano@jacometo.com.br,...
GOOGLE_CREDENTIALS_PATH=./credentials.json
GOOGLE_DRIVE_FOLDER_BOLETOS=...
GOOGLE_SHEETS_GRUPOS_ID=...
CONFIG_ENCRYPT_KEY=32-chars-aleatorios
```

## Frontend — convenções

- **Sem bibliotecas de UI** — CSS inline com variáveis CSS (`var(--bg)`, `var(--surface)`, etc.)
- **Dark mode automático** — via `@media (prefers-color-scheme: dark)` no globals.css
- **JobStatus.tsx** — usar em TODAS as páginas de automação (polling a cada 2s, progresso, erros)
- **Proxy** — frontend chama `/api/rpa/[rota]` → Next.js redireciona para `localhost:3001/api/[rota]`
- **Auth** — middleware.ts verifica cookie `hub_auth` em todas as rotas exceto `/login` e `/api/auth`

## Comandos úteis no Mac Mini

```bash
pm2 list                          # Status dos processos
pm2 logs ferramentas-backend      # Logs do backend em tempo real
pm2 restart ferramentas-backend   # Reinicia backend (após editar jobs)
pm2 restart ferramentas-frontend  # Reinicia frontend

# Rebuild do frontend após mudanças
cd ~/ferramentas-jacometo/frontend && npm run build && pm2 restart ferramentas-frontend

# Ver logs de hoje
tail -f ~/ferramentas-jacometo/backend/logs/rpa-$(date +%Y-%m-%d).log
```

## Supabase — banco de dados

**Schema**: `supabase/schema.sql` — colar no SQL Editor do Supabase e executar.

**Tabelas:**
| Tabela | O que guarda |
|--------|-------------|
| `jobs_history` | Uma linha por execução de automação |
| `job_results` | Um item por segurado/cliente dentro de cada job |
| `clientes_plano_hospitalar` | Lista de clientes da Bárbara (editável pelo frontend) |
| `job_screenshots` | Metadados de screenshots de erro |

**Backend** (`lib/database.js`) — chamar em cada job:
```js
const db = require('../lib/database')

// No início do setImmediate (já feito em todos os jobs)
const _inicio = new Date()
await db.jobIniciado(jobId, 'allianz')

// Ao concluir com sucesso
await db.jobConcluido(jobId, 'allianz', { resultados, csvPath }, _inicio)

// Em caso de erro
await db.jobErro(jobId, 'allianz', e.message, _inicio)
```

**Frontend** (`lib/supabase.ts`) — acessa diretamente com anon key:
```js
import { supabase } from '../../../lib/supabase'
const { data } = await supabase.from('jobs_history').select('*')
```

**Variáveis necessárias:**
```
# Backend .env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   ← service_role key (nunca expor no frontend)

# Frontend .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   ← anon key (pública, só leitura + CRUD clientes)
```

**Modo sem Supabase:** Se `SUPABASE_URL` não estiver no `.env`, o `database.js` opera silenciosamente sem erro — o sistema funciona normalmente, apenas sem histórico persistente.

## O que NÃO fazer

- ❌ Nunca commitar `credentials.json`, `.env`, `config/credenciais.json`
- ❌ Nunca hardcodar senhas nos jobs — usar sempre `getCred()`
- ❌ Nunca usar `export` CSV no Yelum — causa logout da sessão
- ❌ Nunca acessar `brportal.chubb.com` para financeiro — usar sempre `sso.chubbnet.com`
- ❌ Nunca fazer login na Tokio com código do corretor — usar CPF (85721611987)
