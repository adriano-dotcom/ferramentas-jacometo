#!/bin/bash
# ─── Instala Playwright + Chromium no Mac Mini 2 ─────────────────────────────
echo "🎭 Instalando Playwright..."

npm install
echo "📦 Instalando Chromium (headless)..."
npx playwright install chromium

mkdir -p ~/.jarvis/sessions
mkdir -p out/{screenshots,downloads,quiver,parcelas,saude,arquivo,gerente,jacometo,orbe}

echo ""
echo "✅ Playwright pronto!"
echo ""
echo "Próximos passos:"
echo "  1. Preencher credenciais no .env"
echo "  2. node src/playwright/test.js"
