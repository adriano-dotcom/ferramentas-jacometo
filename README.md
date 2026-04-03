# Ferramentas Jacometo Seguros

Hub interno de automações RPA para a Jacometo Corretora de Seguros.
Playwright acessa portais de 11 seguradoras, extrai inadimplentes, gera CSVs e envia relatórios por email.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js + Express + Playwright |
| Frontend | Next.js 14 (App Router) |
| Browser | Chromium headless |
| Email | Nodemailer + Gmail |
| Storage | Google Drive API |
| Deploy | Mac Mini local + Cloudflare Tunnel + PM2 |

## Automações

**João — Inadimplentes:** Allianz · Tokio Marine · AXA · Chubb · Sompo · AKAD · Yelum · Mitsui · Essor · MetLife · Unimed Seguros

**Giovana — Operações:** Unimed Grupos · Unimed Boletos · Quiver Faturas · Quiver Faturas Transporte

**Bárbara — Saúde:** Plano Hospitalar (30+ clientes SolusWeb → Drive)

## Instalação (Mac Mini)

```bash
git clone https://github.com/jacometo/ferramentas-jacometo.git ~/ferramentas-jacometo
cd ~/ferramentas-jacometo
bash instalar.sh
```

Ver [TUNNEL.md](TUNNEL.md) para configurar `ferramentas.jacometo.com.br`.

## Credenciais

Gerenciadas pelo painel web em `/ferramentas/configuracoes` — sem senhas no código.
O `.env` só precisa de infraestrutura: SMTP, Google API, chave de criptografia.

## Claude Code

```bash
cd ~/ferramentas-jacometo
claude
```

O `CLAUDE.md` na raiz documenta a arquitetura completa para o Claude Code.

## Atualizar

```bash
bash atualizar.sh
```
