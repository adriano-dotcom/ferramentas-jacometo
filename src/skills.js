import axios from 'axios';
import dotenv from 'dotenv';
import {
  getDealsHoje, getDealsSemsAtividade, getFunilVendas,
  getAtividadePorVendedor, gerarRelatorioDiario, rodarConsistenciaCRM,
} from './pipedrive.js';
import {
  getInsightsConta, getCampanhas, getTopCampanhas,
  alertaGasto, gerarRelatorioDiarioMeta, calcularGapMetaCRM, verificarTokens,
} from './meta.js';
import {
  verificarStatus, getSnapshotCompleto, descobrirRotas,
  getCotacoes, getApolices, getClientes, getSinistros,
} from './ferramentas.js';
import {
  statusAgenteArquivo, acionarAutomacao, statusTarefa,
  listarTarefasRecentes, lerRelatorioParcelasAtraso,
  lerFaturasQuiver, lerMissionControlArquivo, TAREFAS,
} from './arquivo.js';
import {
  lembrarFato, lembrarFatoGlobal, recordarFato, listarFatos, esquecerFato,
  registrarEpisodio, getEpisodiosRecentes, salvarContexto, getContextosAtivos,
  getSoul, updateSoul, getMemoryStats, buildMemoryContext, clearHistory,
} from './memory.js';
import {
  cadastrarFaturaQuiver, relatorioFaturasQuiver,
  relatorioParcelasATM, relatorioParcelasNDN, relatorioParcelasConsolidado,
  relatorioSeguradora, emitirFaturaSaude, relatorioSaude,
  abrirSite, preencherFormulario,
} from './playwright/automacoes.js';
import { pesquisar, bravePesquisar, lerPagina } from './search.js';
import { textoParaAudio, transcreverAudio, listarVozes, statusElevenLabs } from './voz.js';
dotenv.config();

const {
  PIPEDRIVE_API_TOKEN, PIPEDRIVE_COMPANY_DOMAIN,
  META_ACCESS_TOKEN, META_AD_ACCOUNT_JACOMETO, META_AD_ACCOUNT_ORBE,
  GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID,
  TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID_ORBE,
  LOVABLE_API_URL, LOVABLE_API_KEY,
  APET_API_URL, APET_API_KEY
} = process.env;

// ─── PIPEDRIVE ────────────────────────────────────────────────────────────────

async function pipedriveGet(endpoint, params = {}) {
  const url = `https://${PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/api/v1${endpoint}`;
  const res = await axios.get(url, { params: { api_token: PIPEDRIVE_API_TOKEN, ...params } });
  return res.data;
}

async function getLeadsHoje() {
  const hoje = new Date().toISOString().split('T')[0];
  const data = await pipedriveGet('/deals', {
    status: 'open',
    start: 0,
    limit: 50,
    sort: 'add_time DESC'
  });
  const leads = (data.data || []).filter(d => d.add_time?.startsWith(hoje));
  return leads.map(d => ({
    nome: d.title,
    valor: d.value,
    responsavel: d.owner_name,
    pipeline: d.pipeline_id,
    criado: d.add_time
  }));
}

async function getAtividadePorVendedor() {
  const data = await pipedriveGet('/activities', {
    start: 0, limit: 100,
    done: 0
  });
  const por_vendedor = {};
  for (const a of (data.data || [])) {
    const v = a.owner_name || 'Sem dono';
    if (!por_vendedor[v]) por_vendedor[v] = 0;
    por_vendedor[v]++;
  }
  return por_vendedor;
}

async function getFunilVendas() {
  const data = await pipedriveGet('/deals', { status: 'open', limit: 200 });
  const estagios = {};
  for (const d of (data.data || [])) {
    const e = d.stage_id;
    if (!estagios[e]) estagios[e] = { count: 0, valor: 0 };
    estagios[e].count++;
    estagios[e].valor += d.value || 0;
  }
  return estagios;
}

// ─── META ADS ─────────────────────────────────────────────────────────────────

async function getMetaInsights(adAccountId, datePreset = 'today') {
  const url = `https://graph.facebook.com/v19.0/${adAccountId}/insights`;
  const res = await axios.get(url, {
    params: {
      access_token: META_ACCESS_TOKEN,
      date_preset: datePreset,
      fields: 'spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type'
    }
  });
  return res.data?.data?.[0] || {};
}

async function getMetaJacometo(datePreset = 'today') {
  return getMetaInsights(META_AD_ACCOUNT_JACOMETO, datePreset);
}

async function getMetaOrbe(datePreset = 'today') {
  return getMetaInsights(META_AD_ACCOUNT_ORBE, datePreset);
}

// ─── GOOGLE ADS ───────────────────────────────────────────────────────────────

async function getGoogleAdsResumo() {
  // Integração via Google Ads API v17
  // Requer OAuth2 configurado no .env
  try {
    const { GoogleAdsApi } = await import('google-ads-api');
    const client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      developer_token: GOOGLE_ADS_DEVELOPER_TOKEN,
    });
    const customer = client.Customer({
      customer_id: GOOGLE_ADS_CUSTOMER_ID,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });
    const res = await customer.query(`
      SELECT campaign.name, metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM campaign
      WHERE segments.date DURING TODAY
    `);
    return res.map(r => ({
      campanha: r.campaign.name,
      gasto: (r.metrics.cost_micros / 1e6).toFixed(2),
      cliques: r.metrics.clicks,
      conversoes: r.metrics.conversions
    }));
  } catch (e) {
    return { erro: 'Google Ads não configurado ainda: ' + e.message };
  }
}

// ─── TIKTOK ADS ───────────────────────────────────────────────────────────────

async function getTikTokInsights() {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const url = 'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/';
    const res = await axios.get(url, {
      headers: { 'Access-Token': TIKTOK_ACCESS_TOKEN },
      params: {
        advertiser_id: TIKTOK_ADVERTISER_ID_ORBE,
        report_type: 'BASIC',
        data_level: 'AUCTION_ADVERTISER',
        dimensions: JSON.stringify(['stat_time_day']),
        metrics: JSON.stringify(['spend', 'clicks', 'impressions', 'ctr', 'cost_per_conversion']),
        start_date: hoje,
        end_date: hoje,
        page_size: 10
      }
    });
    return res.data?.data?.list?.[0] || {};
  } catch (e) {
    return { erro: 'TikTok Ads não configurado ainda: ' + e.message };
  }
}

// ─── LOVABLE / ATENDIMENTO ────────────────────────────────────────────────────

async function getAtendimentoResumo() {
  try {
    const res = await axios.get(`${LOVABLE_API_URL}/tickets/summary`, {
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` }
    });
    return res.data;
  } catch (e) {
    return { erro: 'Lovable não configurado ainda: ' + e.message };
  }
}

// ─── ORBE PET / APET ──────────────────────────────────────────────────────────

async function getOrbePetResumo() {
  try {
    const res = await axios.get(`${APET_API_URL}/dashboard/summary`, {
      headers: { Authorization: `Bearer ${APET_API_KEY}` }
    });
    return res.data;
  } catch (e) {
    return { erro: 'APet/Orbe Pet não configurado ainda: ' + e.message };
  }
}

// ─── MAPEAMENTO DE TOOLS PARA O CLAUDE ───────────────────────────────────────

export const TOOLS = [
  {
    name: 'get_leads_hoje',
    description: 'Busca os deals/leads criados hoje no Pipedrive com valor, responsável e link',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_atividade_vendedores',
    description: 'Retorna resumo de deals ativos por vendedor: quantidade, valor total e sem atividade',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_funil_vendas',
    description: 'Retorna o funil de vendas atual do Pipedrive agrupado por estágio',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_deals_sem_atividade',
    description: 'Lista deals sem atividade há mais de N horas. Padrão: 48h',
    input_schema: {
      type: 'object',
      properties: {
        horas: { type: 'number', description: 'Horas sem atividade (padrão 48)' }
      }
    }
  },
  {
    name: 'get_inconsistencias_crm',
    description: 'Verifica inconsistências no CRM: deals com valor=0 em etapa avançada e sem label',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'relatorio_pipedrive',
    description: 'Gera relatório diário completo do Pipedrive e salva em out/pipedrive/',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_meta_jacometo',
    description: 'Insights Meta Ads da Jacometo Seguros: gasto, leads, CPL, CTR, alcance',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: ['today','yesterday','last_7d','last_14d','last_30d'], description: 'Período' }
      }
    }
  },
  {
    name: 'get_meta_orbe',
    description: 'Insights Meta Ads da Orbe Pet: gasto, leads, CPL, CTR, alcance',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: ['today','yesterday','last_7d','last_14d','last_30d'] }
      }
    }
  },
  {
    name: 'get_campanhas_meta',
    description: 'Lista campanhas ativas com performance de uma conta Meta (jacometo ou orbe)',
    input_schema: {
      type: 'object',
      properties: {
        conta:   { type: 'string', enum: ['jacometo','orbe'] },
        periodo: { type: 'string', enum: ['today','last_7d','last_14d','last_30d'] }
      },
      required: ['conta']
    }
  },
  {
    name: 'get_top_campanhas',
    description: 'Melhores e piores campanhas por CPL de uma conta Meta',
    input_schema: {
      type: 'object',
      properties: {
        conta:   { type: 'string', enum: ['jacometo','orbe'] },
        periodo: { type: 'string', enum: ['last_7d','last_14d','last_30d'] }
      },
      required: ['conta']
    }
  },
  {
    name: 'alerta_gasto_meta',
    description: 'Verifica se gasto Meta de hoje está acima do limite (padrão 80% do orçamento)',
    input_schema: {
      type: 'object',
      properties: {
        conta:           { type: 'string', enum: ['jacometo','orbe'] },
        limite_percent:  { type: 'number', description: 'Percentual limite (padrão 80)' }
      },
      required: ['conta']
    }
  },
  {
    name: 'relatorio_meta',
    description: 'Gera relatório completo Meta Ads das duas contas (14 dias) e salva em out/meta/',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'verificar_tokens_meta',
    description: 'Verifica se os tokens dos dois apps Meta (Jacometo e Orbe) estão válidos',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_google_ads',
    description: 'Retorna performance das campanhas Google Ads da Orbe Pet',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_tiktok_ads',
    description: 'Retorna insights das campanhas TikTok Ads da Orbe Pet',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_atendimento',
    description: 'Retorna resumo do atendimento via Lovable (tickets, tempo de resposta)',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  // ── MEMÓRIA AVANÇADA ─────────────────────────────────────────────────────
  {
    name: 'memoria_lembrar',
    description: 'Salva um fato importante na memória persistente do Jarvis sobre o usuário ou empresa',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', description: 'Categoria: preferencia|tarefa|negocio|pessoa|sistema' },
        chave:     { type: 'string', description: 'Nome do fato (ex: tom_preferido, ticket_medio)' },
        valor:     { description: 'Valor a salvar' },
        global:    { type: 'boolean', description: 'true = fato global da empresa, false = do usuário atual' }
      },
      required: ['categoria', 'chave', 'valor']
    }
  },
  {
    name: 'memoria_recordar',
    description: 'Busca um fato salvo na memória do Jarvis',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string' },
        chave:     { type: 'string' }
      },
      required: ['categoria', 'chave']
    }
  },
  {
    name: 'memoria_listar',
    description: 'Lista todos os fatos que o Jarvis lembra — sobre o usuário e a empresa',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', description: 'Filtrar por categoria (opcional)' }
      }
    }
  },
  {
    name: 'memoria_esquecer',
    description: 'Remove um fato da memória do Jarvis',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string' },
        chave:     { type: 'string' }
      },
      required: ['categoria', 'chave']
    }
  },
  {
    name: 'memoria_episodio',
    description: 'Registra um evento importante na memória episódica do Jarvis (decisão, aprovação, milestone)',
    input_schema: {
      type: 'object',
      properties: {
        tipo:      { type: 'string', enum: ['decisao','aprovacao','alerta','milestone','erro'] },
        titulo:    { type: 'string' },
        descricao: { type: 'string' },
        importancia: { type: 'number', description: '1-10' }
      },
      required: ['tipo', 'titulo']
    }
  },
  {
    name: 'memoria_contexto',
    description: 'Salva contexto de um projeto em andamento para o Jarvis retomar depois',
    input_schema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Nome do projeto/contexto' },
        resumo:  { type: 'string' },
        status:  { type: 'string', enum: ['ativo','pausado','concluido'] }
      },
      required: ['projeto', 'resumo']
    }
  },
  {
    name: 'memoria_stats',
    description: 'Mostra estatísticas da memória do Jarvis (fatos, episódios, histórico)',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'memoria_limpar_historico',
    description: 'Limpa o histórico de conversa do usuário atual (mantém fatos e episódios)',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'web_search',
    description: 'Pesquisa na internet. Usar quando precisar de informações atuais, preços, notícias, dados que podem ter mudado.',
    input_schema: {
      type: 'object',
      properties: {
        query:    { type: 'string', description: 'O que pesquisar' },
        count:    { type: 'number', description: 'Quantidade de resultados (padrão 5)' },
        provedor: { type: 'string', enum: ['auto','brave','tavily','serp','ddg'], description: 'Provedor de busca (padrão: auto)' }
      },
      required: ['query']
    }
  },
  {
    name: 'web_search_status',
    description: 'Verifica quais provedores de busca estão configurados (Brave, Tavily, Google)',
    input_schema: { type: 'object', properties: {}, required: [] }
  },

  // ── ELEVENLABS — VOZ ─────────────────────────────────────────────────────
  {
    name: 'elevenlab_falar',
    description: 'Gera áudio MP3 com voz natural via ElevenLabs a partir de um texto',
    input_schema: {
      type: 'object',
      properties: {
        texto:  { type: 'string', description: 'Texto para converter em voz' },
        voz_id: { type: 'string', description: 'ID da voz ElevenLabs (opcional, usa padrão do Jarvis)' }
      },
      required: ['texto']
    }
  },
  {
    name: 'elevenlab_listar_vozes',
    description: 'Lista vozes disponíveis na conta ElevenLabs',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'elevenlab_status',
    description: 'Verifica créditos e status da conta ElevenLabs',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'playwright_status_sessoes',
    description: 'Verifica quais sites têm sessão de login ativa (Quiver, ATM, NDN, seguradoras, saúde)',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'playwright_login',
    description: 'Faz login em um site e salva a sessão para uso futuro',
    input_schema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: ['quiver','atm','ndn','tokio','sompo','allianz','saude_operadora'], description: 'Site para fazer login' },
        forcar: { type: 'boolean', description: 'Forçar novo login mesmo com sessão ativa' }
      },
      required: ['site']
    }
  },
  {
    name: 'playwright_abrir_site',
    description: 'Abre qualquer URL no browser e retorna o conteúdo + screenshot. Usa sessão salva do site se disponível.',
    input_schema: {
      type: 'object',
      properties: {
        url:    { type: 'string', description: 'URL completa para abrir' },
        site_id:{ type: 'string', description: 'ID do site para reutilizar sessão (ex: quiver, atm, ndn)' }
      },
      required: ['url']
    }
  },
  {
    name: 'quiver_cadastrar_fatura',
    description: 'Cadastra fatura de seguro de transporte no Quiver PRO via Playwright. REQUER OK — ação financeira.',
    input_schema: {
      type: 'object',
      properties: {
        seguradora:      { type: 'string', enum: ['Tokio Marine','Sompo','AKAD','AXA','Chubb','Allianz'] },
        numero_apolice:  { type: 'string' },
        numero_endosso:  { type: 'string' },
        competencia:     { type: 'string', description: 'Mês/ano ex: 04/2026' },
        valor_premio:    { type: 'number' },
        data_vencimento: { type: 'string' },
        aprovado:        { type: 'boolean', description: 'true = Adriano aprovou explicitamente' }
      },
      required: ['seguradora', 'aprovado']
    }
  },
  {
    name: 'quiver_relatorio_faturas',
    description: 'Extrai relatório de faturas cadastradas no Quiver PRO',
    input_schema: {
      type: 'object',
      properties: {
        mes:        { type: 'string', description: 'Mês filtro (ex: 04/2026)' },
        seguradora: { type: 'string', description: 'Filtrar por seguradora' }
      }
    }
  },
  {
    name: 'parcelas_atm',
    description: 'Acessa portal ATM via Playwright e extrai relatório de parcelas em atraso',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'parcelas_ndn',
    description: 'Acessa portal NDN via Playwright e extrai relatório de parcelas em atraso',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'parcelas_consolidado',
    description: 'Gera relatório consolidado de parcelas em atraso de todas as seguradoras (ATM + NDN)',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'saude_emitir_fatura',
    description: 'Emite fatura do departamento de saúde no portal da operadora. REQUER OK — ação financeira.',
    input_schema: {
      type: 'object',
      properties: {
        operadora: { type: 'string' },
        mes:       { type: 'string', description: 'Competência ex: 04/2026' },
        aprovado:  { type: 'boolean' }
      },
      required: ['aprovado']
    }
  },
  {
    name: 'saude_relatorio',
    description: 'Extrai relatório do portal de saúde (beneficiários, coparticipações, vidas ativas)',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'playwright_preencher_formulario',
    description: 'Preenche formulário em qualquer site via Playwright. Ações destrutivas requerem aprovado=true.',
    input_schema: {
      type: 'object',
      properties: {
        url:     { type: 'string' },
        campos:  { type: 'object', description: 'Mapa seletor → valor ex: {"#nome": "João"}' },
        site_id: { type: 'string' },
        submit:  { type: 'boolean', description: 'Se deve submeter o formulário' },
        aprovado:{ type: 'boolean' }
      },
      required: ['url', 'campos']
    }
  },
  {
    name: 'status_agente_arquivo',
    description: 'Verifica status do Agente ARQUIVO em ferramentas.jacometo.com.br — online, tarefas disponíveis, Mission Control',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'listar_tarefas_arquivo',
    description: 'Lista tarefas recentes executadas pelo Agente ARQUIVO (Playwright no Mac Mini Jarvis)',
    input_schema: {
      type: 'object',
      properties: {
        limite: { type: 'number', description: 'Quantidade de tarefas a listar (padrão 20)' }
      }
    }
  },
  {
    name: 'acionar_quiver_fatura',
    description: 'Aciona cadastro de fatura de seguro transporte no Quiver PRO via Agente ARQUIVO. REQUER OK DO ADRIANO — ação financeira.',
    input_schema: {
      type: 'object',
      properties: {
        seguradora:   { type: 'string', enum: ['Tokio Marine','Sompo','AKAD','AXA','Chubb','Allianz'], description: 'Seguradora da fatura' },
        mes_referencia: { type: 'string', description: 'Mês/ano da fatura (ex: 04/2026)' },
        aprovado:     { type: 'boolean', description: 'true = Adriano aprovou explicitamente' }
      },
      required: ['seguradora', 'aprovado']
    }
  },
  {
    name: 'relatorio_parcelas_atraso',
    description: 'Busca relatório de parcelas em atraso nas seguradoras (ATM, NDN e outras) gerado pelo Agente ARQUIVO',
    input_schema: {
      type: 'object',
      properties: {
        seguradora: { type: 'string', description: 'Filtrar por seguradora (opcional): ATM, NDN, etc.' }
      }
    }
  },
  {
    name: 'acionar_relatorio_parcelas',
    description: 'Dispara automação Playwright para gerar relatório de parcelas em atraso nas seguradoras',
    input_schema: {
      type: 'object',
      properties: {
        seguradora: { type: 'string', enum: ['ATM','NDN','todas'], description: 'Qual seguradora verificar' }
      }
    }
  },
  {
    name: 'acionar_fatura_saude',
    description: 'Aciona emissão de fatura do departamento de saúde via Agente ARQUIVO. REQUER OK — ação financeira.',
    input_schema: {
      type: 'object',
      properties: {
        operadora:  { type: 'string', description: 'Nome da operadora de saúde' },
        mes:        { type: 'string', description: 'Mês referência (ex: 04/2026)' },
        aprovado:   { type: 'boolean' }
      },
      required: ['aprovado']
    }
  },
  {
    name: 'faturas_quiver',
    description: 'Lê faturas de transporte já cadastradas no Quiver PRO pelo Agente ARQUIVO',
    input_schema: {
      type: 'object',
      properties: {
        seguradora: { type: 'string', description: 'Filtrar por seguradora (opcional)' },
        mes:        { type: 'string', description: 'Filtrar por mês (opcional)' }
      }
    }
  },
  {
    name: 'mission_control_arquivo',
    description: 'Lê o Mission Control do Agente ARQUIVO — status de crons, erros, saúde do sistema no Mac Mini Jarvis',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'status_tarefa_arquivo',
    description: 'Verifica status de uma tarefa Playwright em execução no Agente ARQUIVO',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID da tarefa retornado ao disparar automação' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'verificar_ferramentas',
    description: 'Verifica se ferramentas.jacometo.com.br está online e acessível',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'descobrir_rotas_ferramentas',
    description: 'Descobre quais endpoints/rotas estão disponíveis na plataforma de ferramentas',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_cotacoes_ferramentas',
    description: 'Busca cotações/propostas geradas na plataforma ferramentas.jacometo.com.br',
    input_schema: {
      type: 'object',
      properties: {
        filtros: { type: 'object', description: 'Filtros opcionais (data, cliente, ramo, status)' }
      }
    }
  },
  {
    name: 'get_apolices_ferramentas',
    description: 'Busca apólices gerenciadas na plataforma de ferramentas Jacometo',
    input_schema: {
      type: 'object',
      properties: {
        filtros: { type: 'object', description: 'Filtros opcionais (cliente, ramo, status, vigencia)' }
      }
    }
  },
  {
    name: 'get_clientes_ferramentas',
    description: 'Busca clientes/transportadoras cadastrados na plataforma de ferramentas',
    input_schema: {
      type: 'object',
      properties: {
        filtros: { type: 'object' }
      }
    }
  },
  {
    name: 'get_sinistros_ferramentas',
    description: 'Busca sinistros registrados na plataforma de ferramentas Jacometo',
    input_schema: {
      type: 'object',
      properties: {
        filtros: { type: 'object' }
      }
    }
  },
  {
    name: 'snapshot_ferramentas',
    description: 'Snapshot completo da plataforma ferramentas.jacometo.com.br — todos os dados disponíveis de uma vez',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
];

// Executa a tool pelo nome — recebe context com userId para memória
export async function executeTool(name, input = {}, context = {}) {
  console.log(`🔧 Executando tool: ${name}`, input);
  switch (name) {
    case 'get_leads_hoje':           return await getDealsHoje();
    case 'get_atividade_vendedores': return await getAtividadePorVendedor();
    case 'get_funil_vendas':         return await getFunilVendas();
    case 'get_deals_sem_atividade':  return await getDealsSemsAtividade(input.horas || 48);
    case 'get_inconsistencias_crm':  return await rodarConsistenciaCRM({ criarNotas: false });
    case 'relatorio_pipedrive':      return await gerarRelatorioDiario();
    case 'get_meta_jacometo':    return await getInsightsConta('jacometo', input.periodo || 'today');
    case 'get_meta_orbe':        return await getInsightsConta('orbe', input.periodo || 'today');
    case 'get_campanhas_meta':   return await getCampanhas(input.conta, input.periodo || 'last_7d');
    case 'get_top_campanhas':    return await getTopCampanhas(input.conta, input.periodo || 'last_14d');
    case 'alerta_gasto_meta':    return await alertaGasto(input.conta, input.limite_percent || 80);
    case 'relatorio_meta':       return await gerarRelatorioDiarioMeta();
    case 'verificar_tokens_meta':return await verificarTokens();
    case 'get_google_ads':         return await getGoogleAdsResumo();
    case 'get_tiktok_ads':         return await getTikTokInsights();
    case 'get_atendimento':        return await getAtendimentoResumo();
    case 'get_orbe_pet':           return await getOrbePetResumo();
    // ── Memória Avançada ────────────────────────────────────────────────────
    case 'memoria_lembrar':
      if (input.global) await lembrarFatoGlobal(input.categoria, input.chave, input.valor, 'usuario');
      else await lembrarFato(context?.userId || 'global', input.categoria, input.chave, input.valor, 'usuario');
      return { ok: true, msg: `Lembrado: [${input.categoria}] ${input.chave} = ${JSON.stringify(input.valor)}` };
    case 'memoria_recordar':
      return { valor: await recordarFato(context?.userId || 'global', input.categoria, input.chave) };
    case 'memoria_listar':
      return await listarFatos(context?.userId || 'global', input.categoria);
    case 'memoria_esquecer':
      await esquecerFato(context?.userId || 'global', input.categoria, input.chave);
      return { ok: true, msg: `Esquecido: [${input.categoria}] ${input.chave}` };
    case 'memoria_episodio':
      await registrarEpisodio(context?.userId || 'global', input.tipo, input.titulo, { descricao: input.descricao, importancia: input.importancia });
      return { ok: true, msg: `Episódio registrado: ${input.titulo}` };
    case 'memoria_contexto':
      await salvarContexto(context?.userId || 'global', input.projeto, { resumo: input.resumo, status: input.status });
      return { ok: true, msg: `Contexto salvo: ${input.projeto}` };
    case 'memoria_stats':      return await getMemoryStats();
    case 'memoria_limpar_historico':
      await clearHistory(context?.userId || 'global');
      return { ok: true, msg: 'Histórico de conversa limpo. Fatos e episódios mantidos.' };

    // ── Web Search ──────────────────────────────────────────────────────────
    case 'web_search':       return await pesquisarEResumir(input.query, { count: input.count, provedor: input.provedor });
    case 'web_search_status':return statusWebSearch();

    // ── ElevenLabs Voz ──────────────────────────────────────────────────────
    case 'elevenlab_falar':        return await textoParaAudio(input.texto, input.voz_id);
    case 'elevenlab_listar_vozes': return await listarVozes();
    case 'elevenlab_status':       return await statusElevenLabs();

    // ── Playwright Nativo ───────────────────────────────────────────────────
    case 'playwright_status_sessoes':    return await statusSessoes();
    case 'playwright_login':             return await login(input.site, input.forcar || false);
    case 'playwright_abrir_site':        return await abrirSite(input.url, input.site_id || 'generic');
    case 'quiver_cadastrar_fatura':      return await cadastrarFaturaQuiver({ ...input });
    case 'quiver_relatorio_faturas':     return await relatorioFaturasQuiver(input);
    case 'parcelas_atm':                 return await relatorioParcelasATM();
    case 'parcelas_ndn':                 return await relatorioParcelasNDN();
    case 'parcelas_consolidado':         return await relatorioParcelasConsolidado();
    case 'saude_emitir_fatura':          return await emitirFaturaSaude(input);
    case 'saude_relatorio':              return await relatorioSaude();
    case 'playwright_preencher_formulario': return await preencherFormulario(
        input.url, input.campos,
        { siteId: input.site_id, submit: input.submit, aprovado: input.aprovado }
      );

    // ── Agente ARQUIVO ──────────────────────────────────────────────────────
    case 'status_agente_arquivo':    return await statusAgenteArquivo();
    case 'listar_tarefas_arquivo':   return await listarTarefasRecentes(input.limite || 20);
    case 'mission_control_arquivo':  return await lerMissionControlArquivo();
    case 'faturas_quiver':           return await lerFaturasQuiver({ seguradora: input.seguradora, mes: input.mes });
    case 'relatorio_parcelas_atraso':return await lerRelatorioParcelasAtraso(input.seguradora);
    case 'status_tarefa_arquivo':    return await statusTarefa(input.task_id);

    case 'acionar_quiver_fatura':
      return await acionarAutomacao('quiver.cadastro_fatura', {
        seguradora:      input.seguradora,
        mes_referencia:  input.mes_referencia,
      }, input.aprovado === true);

    case 'acionar_relatorio_parcelas':
      return await acionarAutomacao(
        input.seguradora === 'NDN' ? 'relatorio.parcelas_ndn'
          : input.seguradora === 'ATM' ? 'relatorio.parcelas_atm'
          : 'relatorio.parcelas_todas',
        {}, true // relatório é só leitura, não precisa de OK
      );

    case 'acionar_fatura_saude':
      return await acionarAutomacao('saude.fatura', {
        operadora: input.operadora,
        mes:       input.mes,
      }, input.aprovado === true);

    case 'verificar_ferramentas':       return await verificarStatus();
    case 'descobrir_rotas_ferramentas': return await descobrirRotas();
    case 'get_cotacoes_ferramentas':    return await getCotacoes(input.filtros || {});
    case 'get_apolices_ferramentas':    return await getApolices(input.filtros || {});
    case 'get_clientes_ferramentas':    return await getClientes(input.filtros || {});
    case 'get_sinistros_ferramentas':   return await getSinistros(input.filtros || {});
    case 'snapshot_ferramentas':        return await getSnapshotCompleto();
    default: return { erro: `Tool desconhecida: ${name}` };
  }
}

// Exporta tools extras de voz e busca para serem incluídas no TOOLS array
export const EXTRA_TOOLS = [
  {
    name: 'pesquisar_internet',
    description: 'Pesquisa informações na internet em tempo real. Usar quando precisar de dados atuais, preços, notícias, regulamentações, ou qualquer info além do conhecimento do Claude.',
    input_schema: {
      type: 'object',
      properties: {
        query:   { type: 'string', description: 'Termo de busca ou URL completa para ler' },
        tipo:    { type: 'string', enum: ['web','noticias','pagina'], description: 'Tipo de busca' },
        idioma:  { type: 'string', description: 'Idioma preferido (padrão: pt-BR)' }
      },
      required: ['query']
    }
  },
  {
    name: 'ler_url',
    description: 'Lê o conteúdo de uma URL específica e retorna o texto da página',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL completa para ler' }
      },
      required: ['url']
    }
  },
  {
    name: 'elevenlabs_status',
    description: 'Verifica status da integração ElevenLabs (plano, caracteres usados, vozes)',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'elevenlabs_vozes',
    description: 'Lista vozes disponíveis no ElevenLabs para o Jarvis usar',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'gerar_audio',
    description: 'Gera arquivo de áudio MP3 a partir de um texto usando ElevenLabs TTS',
    input_schema: {
      type: 'object',
      properties: {
        texto:    { type: 'string', description: 'Texto para converter em áudio' },
        voice_id: { type: 'string', description: 'ID da voz ElevenLabs (opcional)' }
      },
      required: ['texto']
    }
  },
];

// Adiciona execução no executeTool
const _executeToolOriginal = executeTool;
export async function executeTool(name, input = {}) {
  console.log(`🔧 Tool: ${name}`, input);
  switch (name) {
    case 'pesquisar_internet': return await pesquisar(input.query, { lang: input.idioma });
    case 'ler_url':            return await lerPagina(input.url);
    case 'elevenlabs_status':  return await statusElevenLabs();
    case 'elevenlabs_vozes':   return await listarVozes();
    case 'gerar_audio':        return await textoParaAudio(input.texto, { voiceId: input.voice_id });
    default:                   return await _executeToolOriginal(name, input);
  }
}
