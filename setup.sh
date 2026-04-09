#!/bin/bash
# ─── Setup Jarvis Claude no Mac Mini ─────────────────────────────────────────
echo "🤖 Instalando Jarvis Claude..."

# Verifica Node
NODE_VERSION=$(node --version 2>/dev/null)
if [ -z "$NODE_VERSION" ]; then
  echo "❌ Node.js não encontrado. Instale via nvm: nvm install 22"
  exit 1
fi
echo "✅ Node: $NODE_VERSION"

# Instala dependências
npm install

# Cria pasta de memória
mkdir -p memory

# Verifica .env
if grep -q "SEU_TOKEN_AQUI" .env; then
  echo ""
  echo "⚠️  Configure o .env antes de iniciar:"
  echo "   nano .env"
  echo ""
  echo "Mínimo necessário:"
  echo "   TELEGRAM_TOKEN=..."
  echo "   ANTHROPIC_API_KEY=..."
  echo "   PIPEDRIVE_API_TOKEN=..."
  echo ""
else
  echo "✅ .env configurado"
fi

# Instala pm2 se não tiver
if ! command -v pm2 &> /dev/null; then
  echo "📦 Instalando pm2..."
  npm install -g pm2
fi

echo ""
echo "✅ Jarvis pronto!"
echo ""
echo "Para iniciar:"
echo "  node src/index.js          # desenvolvimento"
echo "  pm2 start src/index.js --name jarvis-claude   # produção"
echo "  pm2 save && pm2 startup    # iniciar no boot"
