// src/jobs/unimed-grupos.js
// Recebe planilha Excel via upload, compara com lista anterior, envia email se mudou

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
      nome:  getVal('NOME'),
      cnpj:  getVal('CNPJ'),
      dia:   getVal('DIA'),
      venc:  getVal('VENCIMENTO'),
    })
  }
  return grupos
}

module.exports = async function routeUnimedGrupos(req, res) {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' })

  log.info(`Processando planilha Unimed Grupos: ${req.file.originalname}`)

  try {
    const novos    = parsearPlanilha(req.file.path)
    const anterior = lerCache()

    const antMap = new Map(anterior.map(g => [g.grupo, g]))
    const novMap = new Map(novos.map(g => [g.grupo, g]))

    const adicionados = novos.filter(g => !antMap.has(g.grupo))
    const removidos   = anterior.filter(g => !novMap.has(g.grupo))

    log.info(`Total: ${novos.length} | Adicionados: ${adicionados.length} | Removidos: ${removidos.length}`)

    let emailEnviado = false

    if (adicionados.length > 0 || removidos.length > 0) {
      const hoje = new Date().toLocaleDateString('pt-BR')
      const linhasAdd = adicionados.map(g => `  + Grupo ${g.grupo} — ${g.nome} (CNPJ: ${g.cnpj || 'n/d'}, Dia: ${g.dia || 'n/d'})`).join('\n')
      const linhasRem = removidos.map(g => `  - Grupo ${g.grupo} — ${g.nome}`).join('\n')

      const corpo = `Atualização na lista de grupos Unimed Vida\nData: ${hoje}\nTotal atual: ${novos.length} grupos\n\n${adicionados.length > 0 ? `Adicionados (${adicionados.length}):\n${linhasAdd}\n\n` : ''}${removidos.length > 0 ? `Removidos (${removidos.length}):\n${linhasRem}\n\n` : ''}Atenciosamente,\nSistema Jacometo Seguros`

      emailEnviado = await email.enviar({
        assunto: `Atualização lista Unimed Vida — ${hoje}`,
        corpo,
      })

      salvarCache(novos)
    }

    // Remove arquivo temporário
    try { fs.unlinkSync(req.file.path) } catch {}

    res.json({
      ok: true,
      total: novos.length,
      adicionados: adicionados.length,
      removidos: removidos.length,
      emailEnviado,
    })

  } catch (e) {
    log.error(`Erro unimed-grupos: ${e.message}`)
    res.status(500).json({ erro: e.message })
  }
}
