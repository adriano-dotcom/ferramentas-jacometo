// src/jobs/config.js
// Lê e salva credenciais das seguradoras em config.json (criptografado em memória, salvo em disco)
// Expõe GET /api/config e POST /api/config

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const log    = require('../lib/logger')

const CONFIG_PATH  = path.resolve('./config/credenciais.json')
const ENCRYPT_KEY  = (process.env.CONFIG_ENCRYPT_KEY || 'jacometo-ferramentas-2024-chave').substring(0, 32).padEnd(32, '0')
const IV_LENGTH    = 16

// ── Criptografia simples (AES-256-CBC) ────────────────────────────────────────

function criptografar(texto) {
  const iv  = crypto.randomBytes(IV_LENGTH)
  const c   = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPT_KEY), iv)
  const enc = Buffer.concat([c.update(texto), c.final()])
  return iv.toString('hex') + ':' + enc.toString('hex')
}

function descriptografar(texto) {
  try {
    const [ivHex, encHex] = texto.split(':')
    const iv  = Buffer.from(ivHex, 'hex')
    const enc = Buffer.from(encHex, 'hex')
    const d   = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPT_KEY), iv)
    return Buffer.concat([d.update(enc), d.final()]).toString()
  } catch { return '' }
}

// ── Configuração padrão (todos os portais) ────────────────────────────────────

const PADRAO = {
  allianz: {
    label:  'Allianz — AllianzNet',
    url:    'https://www.allianznet.com.br/ngx-epac/public/home',
    campos: { usuario:'BA022460', senha:'J@co9000Jacome', cron:'' },
  },
  tokio: {
    label:  'Tokio Marine',
    url:    'https://ssoportais3.tokiomarine.com.br/openam/XUI/?realm=TOKIOLFR',
    campos: { cpf:'85721611987', senha:'Jacometo9@12', cron:'' },
  },
  axa: {
    label:  'AXA',
    url:    'https://e-solutions.axa.com.br',
    campos: { email:'jacometo@jacometoseguros.com.br', senha:'Jacometo@8JACO@@6', cron:'' },
  },
  chubb: {
    label:  'Chubb — ChubbNet',
    url:    'https://sso.chubbnet.com',
    campos: { email:'jacometo@jacometo.com.br', senha:'Jaco9000!', cron:'' },
  },
  sompo: {
    label:  'Sompo',
    url:    'https://corretor.sompo.com.br/PortalCorretor_Th/Login.aspx',
    campos: { usuario:'030322100000', senha:'Jaco7000', cron:'' },
  },
  akad: {
    label:  'AKAD Digital',
    url:    'https://digital.akadseguros.com.br',
    campos: { cpf:'85721611987', senha:'@Jaco9003#', cron:'' },
  },
  yelum: {
    label:  'Yelum Seguros',
    url:    'https://auth-broker.yelumseguros.com.br/login',
    campos: {
      cpf:        '85721611987',
      senha:      'Wazoptliksthrk1236',
      portal_url: 'https://novomeuespacocorretor.yelumseguros.com.br/lp/payment-management',
      cron:       '',
    },
  },
  mitsui: {
    label:  'Mitsui (MSIG)',
    url:    'https://www4.msig.com.br/kitonline/',
    campos: { usuario:'0118422b', senha:'Jaco9000@', cron:'' },
  },
  essor: {
    label:  'Essor',
    url:    'https://portal.essor.com.br',
    campos: { cnpj:'16959586000156', senha:'@Jaco900232', cron:'' },
  },
  metlife: {
    label:  'MetLife',
    url:    'https://login.metlife.com.br/login/dynamic/Login.action',
    campos: { usuario:'202053374', senha:'@Jaco9001', cron:'' },
  },
  unimed_seguros: {
    label:  'Unimed Seguros',
    url:    'https://portal.segurosunimed.com.br',
    campos: { cpf:'85721611987', senha:'@Jaco9001', cron:'' },
  },
  unimed_boletos: {
    label:  'Unimed — Boletos Vida',
    url:    'https://portal.segurosunimed.com.br',
    campos: { cpf:'85721611987', senha:'@Jaco9001', cron:'' },
  },
  quiver: {
    label:  'Quiver PRO',
    url:    'https://jacometo.corretor-online.com.br/fastBoot/menuFast.Aspx',
    campos: { corretor:'JACOMETO', usuario:'Adriano.jacometo', senha:'Qui@v/#r1512!Ad' },
  },
  plano_hospitalar: {
    label:  'Plano Hospitalar (SolusWeb)',
    url:    'https://servico.planohospitalar.org.br/solusweb/empresa',
    campos: {
      observacao:   'Cada cliente tem login próprio (CNPJ + **@*)',
      drive_folder: '1fghBuGnZSp3SzcVwSveoB7HYFEPVp6yz',
    },
  },

  porto_seguro: {
    label:  'Porto Seguro',
    url:    'https://corretor.portoseguro.com.br/corretoronline/',
    campos: { usuario: '', senha: '', susep: '', cron: '' },
  },

  // ══════════════════════════════════════════════════════════════════════
  // GIACOMET — mesmas seguradoras, credenciais diferentes
  // ══════════════════════════════════════════════════════════════════════
  giacomet_yelum: {
    label:  'Giacomet — Yelum',
    url:    'https://auth-broker.yelumseguros.com.br/login',
    campos: {
      cpf:        '02057398900',
      senha:      '@Giacomet123',
      portal_url: 'https://novomeuespacocorretor.yelumseguros.com.br/lp/payment-management',
    },
  },
  giacomet_mitsui: {
    label:  'Giacomet — Mitsui',
    url:    'https://www4.msig.com.br/kitonline/',
    campos: { usuario:'2144336b', senha:'@Jaco9001' },
  },
  giacomet_allianz: {
    label:  'Giacomet — Allianz',
    url:    'https://www.allianznet.com.br/ngx-epac/public/home',
    campos: { usuario:'BA253874', senha:'@Giacomet123@4' },
  },
  giacomet_unimed: {
    label:  'Giacomet — Unimed',
    url:    'https://portal.segurosunimed.com.br',
    campos: { cpf:'02057398900', senha:'@Giacomet123' },
  },
  giacomet_akad: {
    label:  'Giacomet — AKAD',
    url:    'https://digital.akadseguros.com.br',
    campos: { cpf:'020.573.989-00', senha:'Giaco9000@j2j@' },
  },
  giacomet_aig: {
    label:  'Giacomet — AIG',
    url:    '',
    campos: { email:'contato@giacometseguros.com', senha:'HBuj+%76' },
  },
  giacomet_berkley: {
    label:  'Giacomet — Berkley',
    url:    '',
    campos: { email:'contato@giacometseguros.com -232144336', senha:'@Jaco9001' },
  },
  giacomet_metlife: {
    label:  'Giacomet — MetLife Vida e Prev',
    url:    'https://login.metlife.com.br/login/dynamic/Login.action',
    campos: { usuario:'000232144336', senha:'@Giacomet2023b' },
  },
  giacomet_tokio: {
    label:  'Giacomet — Tokio Marine',
    url:    'https://ssoportais3.tokiomarine.com.br/openam/XUI/?realm=TOKIOLFR',
    campos: { cpf:'', senha:'' },
  },
  giacomet_axa: {
    label:  'Giacomet — AXA',
    url:    'https://e-solutions.axa.com.br',
    campos: { email:'', senha:'' },
  },
  giacomet_chubb: {
    label:  'Giacomet — Chubb',
    url:    'https://sso.chubbnet.com',
    campos: { email:'', senha:'' },
  },
  giacomet_sompo: {
    label:  'Giacomet — Sompo',
    url:    'https://corretor.sompo.com.br/PortalCorretor_Th/Login.aspx',
    campos: { usuario:'', senha:'' },
  },
  giacomet_essor: {
    label:  'Giacomet — Essor',
    url:    'https://portal.essor.com.br',
    campos: { cnpj:'', senha:'' },
  },
  giacomet_porto_seguro: {
    label:  'Giacomet — Porto Seguro',
    url:    'https://corretor.portoseguro.com.br/corretoronline/',
    campos: { usuario:'', senha:'', susep:'' },
  },

  // ══════════════════════════════════════════════════════════════════════
  // PIPEDRIVE — integracao webhook → monitor de averbacao
  // ══════════════════════════════════════════════════════════════════════
  pipedrive: {
    label:  'Pipedrive — Integracao',
    url:    'https://jacometo.pipedrive.com',
    campos: { api_token: '', pipeline_ids: '', campo_averbacao: '', campo_cnpj: '', email_geral: 'jacometo@jacometo.com.br' },
  },

  // ══════════════════════════════════════════════════════════════════════
  // MONITOR DE AVERBACAO — portais ATM Tec e NDD Averba
  // ══════════════════════════════════════════════════════════════════════
  atm_averba: {
    label:  'ATM Tec — Monitor Averbacao',
    url:    'https://portal.atmtec.com.br',
    campos: { usuario: '', senha: '' },
  },
  ndd_averba: {
    label:  'NDD Averba — Monitor Averbacao',
    url:    'https://broker.nddaverba.com.br',
    campos: { usuario: '', senha: '' },
  },
}

// ── Helpers de arquivo ────────────────────────────────────────────────────────

function lerConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return PADRAO
    const raw  = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    // Descriptografa senhas
    const conf = {}
    for (const [key, seg] of Object.entries(raw)) {
      conf[key] = {
        ...seg,
        campos: Object.fromEntries(
          Object.entries(seg.campos || {}).map(([k, v]) => {
            // Campos sensíveis são descriptografados
            const sensivel = k === 'senha' || k === 'password'
            return [k, sensivel ? descriptografar(v) : v]
          })
        ),
      }
    }
    // Merge: adiciona entradas do PADRAO que não existem no arquivo salvo
    for (const [key, seg] of Object.entries(PADRAO)) {
      if (!conf[key]) conf[key] = seg
    }
    return conf
  } catch (e) {
    log.error(`Erro ao ler config: ${e.message}`)
    return PADRAO
  }
}

function salvarConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  // Criptografa senhas antes de salvar
  const seguro = {}
  for (const [key, seg] of Object.entries(config)) {
    seguro[key] = {
      ...seg,
      campos: Object.fromEntries(
        Object.entries(seg.campos || {}).map(([k, v]) => {
          const sensivel = k === 'senha' || k === 'password'
          return [k, sensivel && v ? criptografar(v) : v]
        })
      ),
    }
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(seguro, null, 2))
}

// ── API de credencial para os jobs ────────────────────────────────────────────
// Os jobs chamam isso para pegar as credenciais atualizadas

function getCred(seguradora) {
  const config = lerConfig()
  const seg = config[seguradora]
  if (!seg) return {}
  return { url: seg.url || '', ...seg.campos }
}

module.exports.getCred = getCred

// ── Rotas Express ─────────────────────────────────────────────────────────────

module.exports.routeGetConfig = (req, res) => {
  try {
    const config = lerConfig()
    // Mascara senhas para o frontend (mostra apenas *** mas preserva para edição)
    const publico = {}
    for (const [key, seg] of Object.entries(config)) {
      publico[key] = {
        ...seg,
        campos: Object.fromEntries(
          Object.entries(seg.campos || {}).map(([k, v]) => [k, v])
        ),
      }
    }
    res.json({ ok: true, config: publico, padrao: PADRAO })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
}

module.exports.routePostConfig = (req, res) => {
  try {
    const { seguradora, campo, valor, url } = req.body

    if (!seguradora) return res.status(400).json({ erro: 'seguradora é obrigatório' })

    const config = lerConfig()
    if (!config[seguradora]) config[seguradora] = { ...PADRAO[seguradora] }

    if (url !== undefined)    config[seguradora].url = url
    if (campo && valor !== undefined) {
      config[seguradora].campos = config[seguradora].campos || {}
      config[seguradora].campos[campo] = valor
    }

    salvarConfig(config)
    log.ok(`Config atualizada: ${seguradora}.${campo || 'url'} = ***`)
    res.json({ ok: true, mensagem: `Credencial de ${config[seguradora]?.label || seguradora} atualizada.` })
  } catch (e) {
    log.error(`Erro ao salvar config: ${e.message}`)
    res.status(500).json({ erro: e.message })
  }
}

module.exports.routeTestConfig = async (req, res) => {
  // Testa se o portal está acessível (ping rápido)
  const { seguradora } = req.body
  const config = lerConfig()
  const seg    = config[seguradora]
  if (!seg?.url) return res.status(404).json({ erro: 'Seguradora não encontrada' })

  try {
    const resp = await fetch(seg.url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    res.json({ ok: true, status: resp.status, acessivel: resp.ok || resp.status < 500 })
  } catch (e) {
    res.json({ ok: false, acessivel: false, erro: e.message })
  }
}
