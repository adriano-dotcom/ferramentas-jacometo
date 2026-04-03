# Cloudflare Tunnel — ferramentas.jacometo.com.br

## O que é
O Cloudflare Tunnel expõe o Mac Mini para a internet sem abrir portas no roteador.
O frontend (Next.js, porta 3000) fica acessível em `ferramentas.jacometo.com.br`.

## Instalação (fazer uma vez)

```bash
# 1. Instala cloudflared
brew install cloudflare/cloudflare/cloudflared

# 2. Autentica com a conta Cloudflare
cloudflared tunnel login

# 3. Cria o tunnel
cloudflared tunnel create ferramentas-jacometo

# 4. Anota o Tunnel ID que apareceu (ex: abc12345-...)
```

## Configuração

Cria o arquivo `~/.cloudflared/config.yml`:

```yaml
tunnel: SEU-TUNNEL-ID-AQUI
credentials-file: /Users/SEU-USUARIO/.cloudflared/SEU-TUNNEL-ID.json

ingress:
  # Frontend Next.js
  - hostname: ferramentas.jacometo.com.br
    service: http://localhost:3000

  # Backend API (acessível pelo frontend via proxy Next.js)
  - hostname: api-ferramentas.jacometo.com.br
    service: http://localhost:3001

  # Catch-all obrigatório
  - service: http_status:404
```

## DNS no Cloudflare

No painel Cloudflare, em DNS do domínio jacometo.com.br:

```bash
# Cria automaticamente os registros CNAME
cloudflared tunnel route dns ferramentas-jacometo ferramentas.jacometo.com.br
cloudflared tunnel route dns ferramentas-jacometo api-ferramentas.jacometo.com.br
```

## Iniciar com PM2

```bash
# Adiciona o tunnel ao PM2 (roda junto com backend e frontend)
pm2 start "cloudflared tunnel run ferramentas-jacometo" \
  --name cloudflare-tunnel \
  --log ~/ferramentas-jacometo/logs/tunnel.log

pm2 save
```

## Proxy do Next.js → Backend

Para que o frontend chame `/api/rpa/...` e chegue no backend em `localhost:3001`,
adicione o `rewrites` no `next.config.js`:

```js
// frontend/next.config.js
module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/rpa/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ]
  },
}
```

## Testar

```bash
# Verifica se o tunnel está ativo
cloudflared tunnel info ferramentas-jacometo

# Testa o backend direto
curl http://localhost:3001/api/health

# Testa via domínio
curl https://ferramentas.jacometo.com.br/api/rpa/health
```

## Comandos úteis

```bash
pm2 logs cloudflare-tunnel   # Ver logs do tunnel
pm2 restart cloudflare-tunnel
cloudflared tunnel list
```
