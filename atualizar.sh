#!/bin/bash
# atualizar.sh — Puxa arquivos novos e reinicia os serviços
# Uso: bash ~/ferramentas-jacometo/atualizar.sh

set -e
cd ~/ferramentas-jacometo

echo "→ Puxando alterações do Git..."
git pull

echo "→ Reinstalando dependências do backend (se mudou package.json)..."
cd backend && npm install --silent && cd ..

echo "→ Rebuilding frontend..."
cd frontend && npm install --silent && npm run build && cd ..

echo "→ Reiniciando PM2..."
pm2 restart ferramentas-backend
pm2 restart ferramentas-frontend

echo ""
pm2 list
echo ""
echo "✓ Atualização concluída."
