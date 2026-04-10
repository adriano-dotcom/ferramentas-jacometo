// src/jobs/unimed-grupos.js
// Recebe planilha Excel via upload, salva lista de grupos, compara com anterior, notifica se mudou

const XLSX  = require('xlsx')
const fs    = require('fs')
const path  = require('path')
const log   = require('../lib/logger')
const email = require('../lib/email')

const CACHE_PATH = path.resolve('./downloads/grupos-cache.json')

function lerCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) } catch { return [] }
}
function salvarCache(lista) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
  fs.writeFileSync(CACHE_PATH, JSON.stringify(lista, null, 2))
}

function parsearPlanilha(filePath) {
  const wb   = XLSX.readFile(filePath)
  const wsName = wb.SheetNames.find(n => n.toUpperCase().includes('SEGURO')) || wb.SheetNames[0]
  const ws   = wb.Sheets[wsName]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

  if (rows.length === 0) return []

  // Detectar colunas disponíveis
  const headers = Object.keys(rows[0])
  log.info(`[unimed-grupos] Colunas detectadas: ${headers.join(', ')}`)

  const grupos = []
  const vistos = new Set()

  for (const row of rows) {
    const getVal = (search) => {
      const key = Object.keys(row).find(k => k.toUpperCase().includes(search))
      return key ? String(row[key]).trim() : ''
    }
    const grupo = getVal('GRUPO')
    if (!grupo || vistos.has(grupo)) continue
    vistos.add(grupo)
    grupos.push({
      grupo,
      nome: getVal('NOME') || getVal('SEGURADO') || '',
      cnpj: getVal('CNPJ') || '',
      dia:  getVal('DIA') || getVal('FATURA') || '',
      venc: getVal('VENCIMENTO') || getVal('VENC') || '',
    })
  }
  return grupos
}

module.exports = async function routeUnimedGrupos(req, res) {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' })

  log.info(`[unimed-grupos] Processando planilha: ${req.file.originalname}`)

  try {
    const novos    = parsearPlanilha(req.file.path)
    const anterior = lerCache()

    if (novos.length === 0) {
      try { fs.unlinkSync(req.file.path) } catch {}
      return res.status(400).json({ erro: 'Nenhum grupo encontrado na planilha. Verifique se tem coluna "Nº GRUPO".' })
    }

    const antMap = new Map(anterior.map(g => [g.grupo, g]))
    const novMap = new Map(novos.map(g => [g.grupo, g]))

    const adicionados = novos.filter(g => !antMap.has(g.grupo))
    const removidos   = anterior.filter(g => !novMap.has(g.grupo))

    // Mesclar dados: se a planilha nova não tem nome/cnpj mas o cache tem, preserva
    const mesclados = novos.map(g => {
      const antigo = antMap.get(g.grupo)
      if (!antigo) return g
      return {
        grupo: g.grupo,
        nome:  g.nome || antigo.nome || '',
        cnpj:  g.cnpj || antigo.cnpj || '',
        dia:   g.dia  || antigo.dia  || '',
        venc:  g.venc || antigo.venc || '',
      }
    })

    log.info(`[unimed-grupos] Total: ${mesclados.length} | Adicionados: ${adicionados.length} | Removidos: ${removidos.length}`)

    // SEMPRE salvar cache (independente de email)
    salvarCache(mesclados)
    log.ok(`[unimed-grupos] Cache salvo: ${mesclados.length} grupos`)

    // Enviar email se houve mudanças
    let emailEnviado = false
    if (adicionados.length > 0 || removidos.length > 0) {
      const hoje = new Date().toLocaleDateString('pt-BR')
      const linhasAdd = adicionados.map(g => `  + Grupo ${g.grupo} — ${g.nome || 'sem nome'} (CNPJ: ${g.cnpj || 'n/d'}, Dia: ${g.dia || 'n/d'})`).join('\n')
      const linhasRem = removidos.map(g => `  - Grupo ${g.grupo} — ${g.nome || 'sem nome'}`).join('\n')

      const corpo = [
        `Atualização na lista de grupos Unimed Vida`,
        `Data: ${hoje}`,
        `Total atual: ${mesclados.length} grupos`,
        '',
        adicionados.length > 0 ? `Adicionados (${adicionados.length}):\n${linhasAdd}\n` : '',
        removidos.length > 0 ? `Removidos (${removidos.length}):\n${linhasRem}\n` : '',
        'Atenciosamente,',
        'Sistema Jacometo Seguros',
      ].filter(Boolean).join('\n')

      emailEnviado = await email.enviar({
        assunto: `Atualização lista Unimed Vida — ${hoje}`,
        corpo,
      })
    }

    // Remove arquivo temporário
    try { fs.unlinkSync(req.file.path) } catch {}

    res.json({
      ok: true,
      total: mesclados.length,
      adicionados: adicionados.length,
      removidos: removidos.length,
      emailEnviado,
      semDia: mesclados.filter(g => !g.dia).length,
    })

  } catch (e) {
    log.error(`[unimed-grupos] Erro: ${e.message}`)
    res.status(500).json({ erro: e.message })
  }
}
