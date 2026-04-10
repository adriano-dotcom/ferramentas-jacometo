/**
 * Google Drive OAuth2 — Gera refresh token
 * ==========================================
 * Executar UMA VEZ: node src/tools/drive-auth.js
 * Abre o navegador, autoriza, salva token em token.json
 */

import { google } from 'googleapis';
import fs from 'fs';
import http from 'http';
import open from 'open';
import dotenv from 'dotenv';
dotenv.config();

const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
const TOKEN_PATH = './token.json';
const SCOPES = ['https://www.googleapis.com/auth/drive'];

async function authorize() {
  const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  const { installed } = JSON.parse(content);
  const { client_id, client_secret } = installed;

  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3333');

  // Checa se já tem token salvo
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2.setCredentials(token);
    console.log('✅ Token já existe em token.json');
    return;
  }

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('🔗 Abrindo navegador para autorização...\n');

  // Servidor temporário para capturar o callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:3333');
      const code = url.searchParams.get('code');
      if (code) {
        res.end('✅ Autorizado! Pode fechar esta aba.');
        server.close();
        resolve(code);
      } else {
        res.end('❌ Erro na autorização.');
        server.close();
        reject(new Error('No code'));
      }
    });

    server.listen(3333, () => {
      console.log(`Authorize URL:\n${authUrl}\n`);
      // Tenta abrir no navegador
      import('open').then(m => m.default(authUrl)).catch(() => {
        console.log('⚠️ Não consegui abrir o navegador. Copie a URL acima e cole no navegador.');
      });
    });
  });

  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\n✅ Token salvo em ${TOKEN_PATH}`);
  console.log(`   refresh_token: ${tokens.refresh_token ? 'sim' : 'NÃO (rode novamente)'}`);
}

authorize().catch(e => console.error('❌', e.message));
