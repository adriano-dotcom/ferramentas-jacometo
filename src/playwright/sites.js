/**
 * JARVIS — Sites Mapeados para Automação
 * =======================================
 * Cada site tem: URL, siteId (para sessão), seletor de login,
 * e funções específicas de automação.
 *
 * Credenciais vêm SEMPRE do .env — nunca hardcoded.
 * Sessões salvas em ~/.jarvis/sessions/
 */

import { executar, screenshot, salvarSessao, temSessao } from './engine.js';
import dotenv from 'dotenv';
dotenv.config();

// ─── MAPA DE SITES ────────────────────────────────────────────────────────────

export const SITES = {

  quiver: {
    id:    'quiver',
    nome:  'Quiver PRO',
    url:   'https://quiver.com.br',
    login: {
      url:        'https://quiver.com.br/login',
      campo_user: '#email, input[name="email"]',
      campo_pass: '#password, input[name="password"]',
      botao:      'button[type="submit"], .btn-login',
      confirma:   '.dashboard, .home, nav.main-nav', // seletor pós-login
    },
    credenciais: {
      usuario: process.env.QUIVER_USER,
      senha:   process.env.QUIVER_PASS,
    },
  },

  atm: {
    id:    'atm',
    nome:  'ATM Seguros',
    url:   process.env.ATM_URL || 'https://www.atmseguros.com.br',
    login: {
      url:        process.env.ATM_LOGIN_URL || 'https://www.atmseguros.com.br/login',
      campo_user: process.env.ATM_SELECTOR_USER || '#username, input[name="login"]',
      campo_pass: process.env.ATM_SELECTOR_PASS || '#password, input[name="senha"]',
      botao:      'button[type="submit"], input[type="submit"]',
      confirma:   '.dashboard, .area-restrita, #menu-principal',
    },
    credenciais: {
      usuario: process.env.ATM_USER,
      senha:   process.env.ATM_PASS,
    },
  },

  ndn: {
    id:    'ndn',
    nome:  'NDN Seguros',
    url:   process.env.NDN_URL || 'https://www.ndnseguros.com.br',
    login: {
      url:        process.env.NDN_LOGIN_URL || 'https://www.ndnseguros.com.br/acesso',
      campo_user: process.env.NDN_SELECTOR_USER || 'input[name="usuario"], #login',
      campo_pass: process.env.NDN_SELECTOR_PASS || 'input[name="senha"], #senha',
      botao:      'button[type="submit"], .btn-entrar',
      confirma:   '.painel, .dashboard, .menu-corretor',
    },
    credenciais: {
      usuario: process.env.NDN_USER,
      senha:   process.env.NDN_PASS,
    },
  },

  tokio: {
    id:    'tokio',
    nome:  'Tokio Marine',
    url:   process.env.TOKIO_URL || 'https://corretor.tokiomarine.com.br',
    login: {
      url:        process.env.TOKIO_LOGIN_URL || 'https://corretor.tokiomarine.com.br/login',
      campo_user: 'input[name="cpf"], input[name="login"], #cpf',
      campo_pass: 'input[name="senha"], input[type="password"]',
      botao:      'button[type="submit"]',
      confirma:   '.menu-corretor, .dashboard, nav',
    },
    credenciais: {
      usuario: process.env.TOKIO_USER,
      senha:   process.env.TOKIO_PASS,
    },
  },

  sompo: {
    id:    'sompo',
    nome:  'Sompo Seguros',
    url:   process.env.SOMPO_URL || 'https://corretor.sompo.com.br',
    login: {
      url:        process.env.SOMPO_LOGIN_URL || 'https://corretor.sompo.com.br',
      campo_user: 'input[name="login"], #login, input[type="email"]',
      campo_pass: 'input[name="senha"], input[type="password"]',
      botao:      'button[type="submit"], .entrar',
      confirma:   '.logado, .corretor, nav.menu',
    },
    credenciais: {
      usuario: process.env.SOMPO_USER,
      senha:   process.env.SOMPO_PASS,
    },
  },

  allianz: {
    id:    'allianz',
    nome:  'Allianz',
    url:   process.env.ALLIANZ_URL || 'https://www.allianz.com.br/corretor',
    login: {
      url:        process.env.ALLIANZ_LOGIN_URL || 'https://www.allianz.com.br/corretor/login',
      campo_user: 'input[name="usuario"], input[type="email"]',
      campo_pass: 'input[name="senha"], input[type="password"]',
      botao:      'button[type="submit"]',
      confirma:   '.portal-corretor, .home-logado',
    },
    credenciais: {
      usuario: process.env.ALLIANZ_USER,
      senha:   process.env.ALLIANZ_PASS,
    },
  },

  saude_operadora: {
    id:    'saude',
    nome:  'Operadora de Saúde',
    url:   process.env.SAUDE_URL,
    login: {
      url:        process.env.SAUDE_LOGIN_URL,
      campo_user: process.env.SAUDE_SELECTOR_USER || 'input[name="login"]',
      campo_pass: process.env.SAUDE_SELECTOR_PASS || 'input[name="senha"]',
      botao:      'button[type="submit"]',
      confirma:   '.area-restrita, .painel',
    },
    credenciais: {
      usuario: process.env.SAUDE_USER,
      senha:   process.env.SAUDE_PASS,
    },
  },
};

// ─── LOGIN GENÉRICO ───────────────────────────────────────────────────────────

/**
 * Faz login em um site e salva a sessão para uso futuro.
 * Verifica se já tem sessão válida antes de logar.
 */
export async function login(siteId, forcar = false) {
  const site = SITES[siteId];
  if (!site) return { ok: false, erro: `Site desconhecido: ${siteId}` };

  if (!site.credenciais.usuario || !site.credenciais.senha) {
    return {
      ok:    false,
      erro:  `Credenciais de ${site.nome} não configuradas no .env`,
      vars:  [`${siteId.toUpperCase()}_USER`, `${siteId.toUpperCase()}_PASS`],
    };
  }

  // Se já tem sessão válida e não forçar, retorna ok
  if (!forcar && await temSessao(siteId)) {
    return { ok: true, msg: `Sessão ${site.nome} já ativa — reutilizando`, sessao_existente: true };
  }

  return executar(siteId, async (page, context) => {
    await page.goto(site.login.url, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshot(page, `${siteId}_pre_login`);

    // Preenche usuário
    await page.fill(site.login.campo_user, site.credenciais.usuario);

    // Preenche senha
    await page.fill(site.login.campo_pass, site.credenciais.senha);

    // Clica no botão
    await page.click(site.login.botao);

    // Aguarda confirmação de login
    await page.waitForSelector(site.login.confirma, { timeout: 15000 });
    await screenshot(page, `${siteId}_pos_login`);

    // Salva sessão para próximas execuções
    await salvarSessao(context, siteId);

    return { msg: `Login ${site.nome} realizado com sucesso. Sessão salva.` };
  });
}

/**
 * Verifica quais sites têm sessão ativa
 */
export async function statusSessoes() {
  const status = {};
  for (const [id, site] of Object.entries(SITES)) {
    const configurado = !!(site.credenciais.usuario && site.credenciais.senha);
    const sessao      = configurado ? await temSessao(id) : false;
    status[id] = {
      nome:        site.nome,
      configurado,
      sessao_ativa: sessao,
      vars_faltando: !configurado
        ? [`${id.toUpperCase()}_USER`, `${id.toUpperCase()}_PASS`]
        : [],
    };
  }
  return status;
}
