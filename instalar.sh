#!/bin/bash
# ══════════════════════════════════════════════════════════════════
#  instalar.sh — Ferramentas Jacometo
#  Rodar UMA VEZ no Mac Mini Jarvis após clonar o repositório
#  Uso: cd ~/ferramentas-jacometo && bash instalar.sh
# ══════════════════════════════════════════════════════════════════

set -e
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

ok()   { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}→${NC} $1"; }
erro() { echo -e "${RED}✗ ERRO:${NC} $1"; exit 1; }
titulo() { echo -e "\n${BOLD}$1${NC}"; echo "─────────────────────────────────────────"; }

# ── 0. Pré-requisitos ─────────────────────────────────────────────────────────
titulo "0. Verificando pré-requisitos"

command -v node  >/dev/null 2>&1 || erro "Node.js não encontrado. Instale em nodejs.org (mínimo v18)"
command -v npm   >/dev/null 2>&1 || erro "npm não encontrado"
command -v pm2   >/dev/null 2>&1 || { info "Instalando PM2 globalmente..."; npm install -g pm2; }

NODE_VER=$(node -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>/dev/null && echo "ok" || echo "baixo")
[ "$NODE_VER" = "baixo" ] && erro "Node.js v18+ é necessário. Versão atual: $(node -v)"

ok "Node $(node -v) | npm $(npm -v) | PM2 $(pm2 -v)"

# ── 1. Backend ────────────────────────────────────────────────────────────────
titulo "1. Instalando dependências do backend"

cd "$(dirname "$0")/backend"

npm install
ok "npm install backend concluído"

info "Instalando Chromium para Playwright..."
npx playwright install chromium
ok "Chromium instalado"

# ── 2. Configuração do .env ───────────────────────────────────────────────────
titulo "2. Configuração do .env"

if [ ! -f .env ]; then
  cp .env.example .env
  info "Arquivo .env criado a partir do .env.example"
  echo ""
  echo -e "${YELLOW}  ┌─ AÇÃO NECESSÁRIA ─────────────────────────────────────────┐${NC}"
  echo -e "${YELLOW}  │ Edite o arquivo:  ~/ferramentas-jacometo/backend/.env      │${NC}"
  echo -e "${YELLOW}  │                                                             │${NC}"
  echo -e "${YELLOW}  │  SMTP_PASS          → App Password do Gmail                │${NC}"
  echo -e "${YELLOW}  │  CONFIG_ENCRYPT_KEY → 32 chars aleatórios (ver abaixo)    │${NC}"
  echo -e "${YELLOW}  └────────────────────────────────────────────────────────────┘${NC}"
  echo ""
  echo -e "  Gerar CONFIG_ENCRYPT_KEY:"
  echo -e "  ${BOLD}node -e \"console.log(require('crypto').randomBytes(16).toString('hex'))\"${NC}"
  echo ""
  read -p "  Pressione ENTER depois de editar o .env para continuar..." _
else
  ok ".env já existe — mantido"
fi

# Verifica campos obrigatórios
source .env 2>/dev/null || true
[ -z "$SMTP_PASS"         ] && echo -e "${YELLOW}  ⚠  SMTP_PASS não configurado${NC}"
[ -z "$CONFIG_ENCRYPT_KEY" ] && echo -e "${YELLOW}  ⚠  CONFIG_ENCRYPT_KEY não configurado${NC}"
[ "$CONFIG_ENCRYPT_KEY" = "mude-isso-para-32-chars-aleatorios" ] && \
  echo -e "${RED}  ✗  CONFIG_ENCRYPT_KEY ainda é o valor padrão — altere antes de continuar${NC}"

# ── 3. Google Service Account ─────────────────────────────────────────────────
titulo "3. Google Service Account"

cd "$(dirname "$0")/backend"

if [ ! -f credentials.json ]; then
  echo -e "${YELLOW}  ┌─ AÇÃO NECESSÁRIA ─────────────────────────────────────────────┐${NC}"
  echo -e "${YELLOW}  │ Coloque o arquivo credentials.json do Google Cloud aqui:       │${NC}"
  echo -e "${YELLOW}  │   ~/ferramentas-jacometo/backend/credentials.json              │${NC}"
  echo -e "${YELLOW}  │                                                                 │${NC}"
  echo -e "${YELLOW}  │ Como gerar:                                                     │${NC}"
  echo -e "${YELLOW}  │  1. console.cloud.google.com > APIs > Credenciais              │${NC}"
  echo -e "${YELLOW}  │  2. Criar Service Account > JSON                               │${NC}"
  echo -e "${YELLOW}  │  3. Compartilhar a pasta do Drive com o email da service acct  │${NC}"
  echo -e "${YELLOW}  └─────────────────────────────────────────────────────────────────┘${NC}"
  echo ""
  read -p "  Pressione ENTER depois de colocar o credentials.json..." _
fi

[ -f credentials.json ] && ok "credentials.json encontrado" || \
  echo -e "${YELLOW}  ⚠  credentials.json ausente — funções Drive/Sheets não vão funcionar${NC}"

# ── 4. Frontend ───────────────────────────────────────────────────────────────
titulo "4. Instalando e buildando frontend (Next.js)"

cd "$(dirname "$0")/frontend"

npm install
ok "npm install frontend concluído"

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  info ".env.local criado — verifique NEXT_PUBLIC_API_URL e AUTH_PASSWORD_HASH"
else
  ok ".env.local já existe — mantido"
fi

info "Buildando Next.js (pode demorar 1-2 minutos)..."
npm run build
ok "Build do frontend concluído"

# ── 5. PM2 — inicia os processos ─────────────────────────────────────────────
titulo "5. Configurando PM2"

cd "$(dirname "$0")"

# Para processos anteriores se existirem
pm2 delete ferramentas-backend  2>/dev/null || true
pm2 delete ferramentas-frontend 2>/dev/null || true

# Backend
pm2 start backend/src/server.js \
  --name ferramentas-backend \
  --cwd backend \
  --log logs/backend.log \
  --error logs/backend-error.log \
  --time

# Frontend Next.js
pm2 start "npm run start -- -p 3000" \
  --name ferramentas-frontend \
  --cwd frontend \
  --log logs/frontend.log \
  --error logs/frontend-error.log \
  --time

# Salva configuração do PM2 para reiniciar após reboot
pm2 save

# Configura PM2 para iniciar com o sistema (macOS)
pm2 startup | tail -1 | bash 2>/dev/null || \
  echo -e "${YELLOW}  ⚠  Configure manualmente: pm2 startup | tail -1 | bash${NC}"

ok "PM2 configurado"

# ── 6. Status final ───────────────────────────────────────────────────────────
titulo "6. Status"

sleep 2
pm2 list

echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Hub Ferramentas Jacometo — instalado!${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
echo ""
echo -e "  Backend:   http://localhost:3001/api/health"
echo -e "  Frontend:  http://localhost:3000"
echo ""
echo -e "  Próximo passo: configurar Cloudflare Tunnel"
echo -e "  Ver: ~/ferramentas-jacometo/TUNNEL.md"
echo ""
echo -e "  Logs em tempo real:"
echo -e "    ${BOLD}pm2 logs ferramentas-backend${NC}"
echo -e "    ${BOLD}pm2 logs ferramentas-frontend${NC}"
echo ""

# ── 7. Supabase ───────────────────────────────────────────────────────────────
titulo "7. Configuração do Supabase"

echo -e "${YELLOW}  ┌─ SUPABASE — fazer uma vez ──────────────────────────────────────┐${NC}"
echo -e "${YELLOW}  │ 1. Acesse supabase.com e crie um projeto gratuito              │${NC}"
echo -e "${YELLOW}  │ 2. SQL Editor > New Query > cole o conteúdo de supabase/schema.sql │${NC}"
echo -e "${YELLOW}  │ 3. Clique Run                                                   │${NC}"
echo -e "${YELLOW}  │ 4. Settings > API > copie URL e service_role key               │${NC}"
echo -e "${YELLOW}  │ 5. Cole no backend/.env:                                        │${NC}"
echo -e "${YELLOW}  │      SUPABASE_URL=https://xxx.supabase.co                      │${NC}"
echo -e "${YELLOW}  │      SUPABASE_SERVICE_KEY=eyJ...                               │${NC}"
echo -e "${YELLOW}  │ 6. Cole no frontend/.env.local:                                │${NC}"
echo -e "${YELLOW}  │      NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co          │${NC}"
echo -e "${YELLOW}  │      NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...                      │${NC}"
echo -e "${YELLOW}  └─────────────────────────────────────────────────────────────────┘${NC}"
echo ""
read -p "  Pressione ENTER depois de configurar o Supabase (ou pule por agora)..." _

pm2 restart ferramentas-backend 2>/dev/null || true
ok "Backend reiniciado com configurações do Supabase"
