// src/jobs/unimed-boletos.js
// Login portal.segurosunimed.com.br → Vida → Consultas e Serviços → 2ª Via de Boleto
// Pesquisa grupo por grupo, baixa PDF, envia tudo por email
require('dotenv').config()
const { getCred } = require('./config')
const db          = require('../lib/database')

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const log    = require('../lib/logger')
const email  = require('../lib/email')
const { abrirBrowser, fecharBrowser } = require('../lib/browser')

// ── Credenciais ──────────────────────────────────────────────────────────────
const _cred = getCred('unimed_boletos')
let LOGIN_CPF  = _cred.cpf   || ''
let LOGIN_SENHA = _cred.senha || ''
let PORTAL_URL  = _cred.url   || 'https://portal.segurosunimed.com.br'

// ── Job store em memória (TTL 2h) ───────────────────────────────────────────
const JOBS = new Map()
function criarJob(total) {
  const id = crypto.randomUUID()
  JOBS.set(id, { id, status: 'executando', progresso: 0, total: total || 5, resultados: [], erro: null, criadoEm: Date.now() })
  for (const [k, v] of JOBS) { if (Date.now() - v.criadoEm > 7200000) JOBS.delete(k) }
  return id
}
function atualizar(id, dados) { const j = JOBS.get(id); if (j) JOBS.set(id, { ...j, ...dados }) }
function getJobStatus(req, res) {
  const job = JOBS.get(req.params.jobId)
  if (!job) return res.status(404).json({ erro: 'Job não encontrado.' })
  res.json(job)
}

const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || './downloads')
const SCREENSHOTS  = path.resolve('./downloads/screenshots')
const GRUPOS_CACHE = path.resolve('./downloads/grupos-cache.json')

async function ss(page, nome) {
  try {
    fs.mkdirSync(SCREENSHOTS, { recursive: true })
    const p = path.join(SCREENSHOTS, nome)
    await page.screenshot({ path: p })
    return p
  } catch { return null }
}

function classErr(msg) {
  if (!msg) return { tipo: 'DESCONHECIDO', label: 'Erro desconhecido', orientacao: 'Tente novamente.' }
  const u = msg.toUpperCase()
  if (u.includes('LOGIN') || u.includes('SENHA') || u.includes('CPF'))
    return { tipo: 'LOGIN_FALHOU', label: 'Login falhou no portal Unimed', orientacao: 'Verifique CPF e senha em portal.segurosunimed.com.br.' }
  if (u.includes('CORRETOR') || u.includes('JACOMETO') || u.includes('PERFIL'))
    return { tipo: 'NAVEGACAO', label: 'Erro ao selecionar perfil Corretor', orientacao: 'Verifique se JACOMETO CORRETORA aparece na lista de acessos.' }
  if (u.includes('VIDA') || u.includes('SEGMENTO') || u.includes('BOLETO') || u.includes('MENU'))
    return { tipo: 'NAVEGACAO', label: 'Erro ao navegar no portal Unimed', orientacao: 'Caminho: Vida → Consultas e Serviços → 2ª Via de Boleto.' }
  if (u.includes('TIMEOUT') || u.includes('EXCEEDED'))
    return { tipo: 'TIMEOUT', label: 'Portal Unimed demorou para responder', orientacao: 'Instabilidade do portal. Tente novamente.' }
  if (u.includes('DOWNLOAD'))
    return { tipo: 'DOWNLOAD_FALHOU', label: 'Falha no download do boleto', orientacao: 'PDF pode não estar disponível. Verifique no portal manualmente.' }
  return { tipo: 'OUTRO', label: msg.substring(0, 80), orientacao: 'Verifique o log e tente novamente.' }
}

// ── Ler lista de grupos ──────────────────────────────────────────────────────
function lerGrupos(diaFiltro) {
  if (!fs.existsSync(GRUPOS_CACHE)) return []
  const todos = JSON.parse(fs.readFileSync(GRUPOS_CACHE, 'utf8'))
  if (!diaFiltro) return todos
  // Se nenhum grupo tem dia preenchido, retorna todos (planilha simplificada)
  const comDia = todos.filter(g => String(g.dia).trim())
  if (comDia.length === 0) {
    log.info('[unimed-boletos] Nenhum grupo tem dia preenchido — processando todos')
    return todos
  }
  return todos.filter(g => String(g.dia).trim() === String(diaFiltro).trim())
}

// ── Handler principal ────────────────────────────────────────────────────────
module.exports = async function routeUnimedBoletos(req, res) {
  const { dia } = req.body || {}

  // Ler grupos e filtrar
  const grupos = lerGrupos(dia)
  if (grupos.length === 0) {
    return res.status(400).json({
      erro: dia
        ? `Nenhum grupo encontrado para dia ${dia}. Faça upload da planilha de grupos primeiro.`
        : 'Nenhum grupo na lista. Faça upload da planilha de grupos primeiro.',
    })
  }

  // total = 2 (login + navegar) + N grupos + 1 (email)
  const totalPassos = 2 + grupos.length + 1
  const jobId = criarJob(totalPassos)
  log.info(`[unimed-boletos] Job ${jobId} — dia ${dia || 'todos'} — ${grupos.length} grupo(s)`)
  res.json({ ok: true, jobId })

  setImmediate(async () => {
    // Recarregar credenciais (pode ter sido atualizado no painel)
    const _creds = getCred('unimed_boletos')
    LOGIN_CPF   = _creds.cpf   || LOGIN_CPF
    LOGIN_SENHA = _creds.senha || LOGIN_SENHA
    PORTAL_URL  = _creds.url   || PORTAL_URL

    const _inicio = new Date()
    await db.jobIniciado(jobId, 'unimed_boletos')

    let browser
    try {
      // ── Passo 1: Abrir browser e fazer login ──────────────────────────
      atualizar(jobId, { progresso: 0 })
      log.info('[unimed-boletos] Abrindo browser...')

      const result = await abrirBrowser()
      browser = result.browser
      const page = result.page

      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })

      // Ir ao portal
      log.info(`[unimed-boletos] Acessando ${PORTAL_URL}...`)
      await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 60000 })
      await page.waitForTimeout(2000)

      // Verificar se já está logado ou precisa fazer login
      const urlAtual = page.url()
      log.info(`[unimed-boletos] URL atual: ${urlAtual}`)

      if (urlAtual.includes('sso') || urlAtual.includes('login') || urlAtual.includes('Login')) {
        log.info('[unimed-boletos] Tela de login detectada — preenchendo...')

        // Preencher CPF
        const campoCpf = await page.$('input[name="username"], input[id*="cpf"], input[id*="user"], input[type="text"]')
        if (!campoCpf) throw new Error('Campo CPF não encontrado na tela de login')
        await campoCpf.fill(LOGIN_CPF)
        await page.waitForTimeout(500)

        // Preencher senha
        const campoSenha = await page.$('input[type="password"]')
        if (!campoSenha) throw new Error('Campo senha não encontrado na tela de login')
        await campoSenha.fill(LOGIN_SENHA)
        await page.waitForTimeout(500)

        // Submeter login via Enter (botão submit fica desabilitado no Keycloak)
        log.info('[unimed-boletos] Submetendo login (Enter)...')
        await page.keyboard.press('Enter')

        await page.waitForTimeout(8000)

        // Verificar erro de login
        const erroLogin = await page.$('.alert-danger, .error-message, .kc-feedback-text')
        if (erroLogin) {
          const textoErro = await erroLogin.textContent()
          throw new Error(`Login falhou: ${textoErro?.trim() || 'credenciais inválidas'}`)
        }
      }

      await ss(page, 'unimed-boletos-pos-login.png')
      log.ok('[unimed-boletos] Login OK — URL: ' + page.url())
      atualizar(jobId, { progresso: 1 })

      // ── Passo 2: Selecionar perfil Corretor e navegar ────────────────
      await page.waitForTimeout(2000)

      // Se estiver na tela de seleção de perfil (não em /corretor ainda)
      if (!page.url().includes('/corretor')) {
        log.info('[unimed-boletos] Selecionando perfil Corretor...')
        // O link pode ser <a> ou outro elemento — usar text= que é mais flexível
        await page.click('text=Corretor', { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(5000)
        log.ok('[unimed-boletos] Perfil selecionado — URL: ' + page.url())
      }

      await ss(page, 'unimed-boletos-painel.png')

      // ── Navegar para Vida → 2ª Via de Boleto ──────────────────────────
      log.info('[unimed-boletos] Navegando para segmento Vida...')

      // Card Vida é um <button class="btn btn-quick-access">
      const cardVida = await page.$('button:has-text("Vida")')
      if (cardVida) {
        await cardVida.click()
        await page.waitForTimeout(4000)
        log.ok('[unimed-boletos] Segmento Vida aberto — URL: ' + page.url())
      } else {
        log.warn('[unimed-boletos] Botão Vida não encontrado, tentando por texto...')
        await page.click('text=Vida', { timeout: 10000 })
        await page.waitForTimeout(4000)
      }

      await ss(page, 'unimed-boletos-vida.png')

      // Clicar em "Consultas e Serviços" para expandir submenu
      log.info('[unimed-boletos] Abrindo menu Consultas e Serviços...')
      const menuConsultas = await page.$('a:has-text("Consultas e Serviços"), span:has-text("Consultas e Serviços"), button:has-text("Consultas e Serviços")')
      if (menuConsultas) {
        await menuConsultas.click()
        await page.waitForTimeout(2000)
      } else {
        // Tentar por texto
        await page.click('text=Consultas e Serviços', { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(2000)
      }

      // Clicar em "2ª Via de Boleto"
      log.info('[unimed-boletos] Clicando 2ª Via de Boleto...')
      const link2Via = await page.$('a:has-text("2ª Via de Boleto"), span:has-text("2ª Via de Boleto")')
      if (!link2Via) {
        // Fallback: tentar por texto direto
        await page.click('text=2ª Via de Boleto', { timeout: 10000 })
      } else {
        await link2Via.click()
      }
      await page.waitForTimeout(4000)

      await ss(page, 'unimed-boletos-pagina-boleto.png')
      log.ok('[unimed-boletos] Página 2ª Via de Boleto carregada')
      atualizar(jobId, { progresso: 2 })

      // ── Processar cada grupo ───────────────────────────────────────────
      const resultados = []
      const pdfsParaAnexar = []

      for (let i = 0; i < grupos.length; i++) {
        const grupo = grupos[i]
        const numGrupo = String(grupo.grupo).trim()
        log.info(`[unimed-boletos] [${i + 1}/${grupos.length}] Processando grupo ${numGrupo} — ${grupo.nome}`)

        try {
          // Selecionar "Grupo" no dropdown (id=pesquisaPorSelect, value="2: CONTRATO/GRUPO")
          const selectPesquisar = await page.$('#pesquisaPorSelect, select')
          if (selectPesquisar) {
            await selectPesquisar.selectOption({ label: 'Grupo' })
            await page.waitForTimeout(1000)
          }

          // Preencher número do grupo — campo aparece após selecionar tipo
          // Buscar input visível que não seja de data (vencimentoDe/Ate)
          let campoGrupo = null
          const todosInputs = await page.$$('input')
          for (const inp of todosInputs) {
            const vis = await inp.isVisible()
            const id = await inp.getAttribute('id') || ''
            const tipo = await inp.getAttribute('type') || ''
            // Pular inputs de data (vencimento) e hidden
            if (vis && tipo !== 'hidden' && !id.includes('vencimento')) {
              campoGrupo = inp
              break
            }
          }
          if (!campoGrupo) throw new Error('Campo de número do grupo não encontrado')
          await campoGrupo.click({ clickCount: 3 })
          await campoGrupo.fill(numGrupo)
          await page.waitForTimeout(500)

          // Clicar Buscar
          await page.click('button:has-text("Buscar")', { timeout: 10000 })

          // Aguardar resultados (pode demorar)
          log.info(`[unimed-boletos] Aguardando resultados do grupo ${numGrupo}...`)
          await page.waitForTimeout(5000)

          // Verificar se tem tabela de resultados
          const linhasTabela = await page.$$('table tbody tr')

          if (linhasTabela.length === 0) {
            // Portal mostra "Não foi possível encontrar dados para o filtro selecionado"
            log.warn(`[unimed-boletos] Grupo ${numGrupo} — sem boletos`)
            resultados.push({
              nome: grupo.nome || `Grupo ${numGrupo}`,
              sub: `Grupo ${numGrupo} · ${grupo.cnpj || 'sem CNPJ'}`,
              status: 'AVISO',
              label: 'Sem boletos encontrados',
              orientacao: null,
              erro: null,
              tipo: null,
            })
          } else {
            log.info(`[unimed-boletos] Grupo ${numGrupo} — ${linhasTabela.length} boleto(s) encontrado(s)`)

            // Extrair dados da tabela e baixar cada boleto
            for (let j = 0; j < linhasTabela.length; j++) {
              try {
                const row = linhasTabela[j]
                const cells = await row.$$('td')
                const textos = await Promise.all(cells.map(c => c.textContent()))

                // Extrair dados: GRUPO, TÍTULO, PARCELA, VALOR, VENCIMENTO
                const titulo   = textos[1]?.trim() || ''
                const parcela  = textos[2]?.trim() || ''
                const valor    = textos[3]?.trim() || ''
                const vencto   = textos[4]?.trim() || ''

                // Clicar no ícone de download (último botão/link da linha)
                const btnDown = await row.$('a[title*="ownload"], button[title*="ownload"], a:last-child, button:last-child, [class*="download"], svg')
                if (btnDown) {
                  // Configurar para capturar download
                  const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
                    btnDown.click(),
                  ])

                  if (download) {
                    const nomeArquivo = `boleto_vida_grupo${numGrupo}_${j + 1}.pdf`
                    const caminhoLocal = path.join(DOWNLOAD_DIR, nomeArquivo)
                    await download.saveAs(caminhoLocal)
                    pdfsParaAnexar.push(caminhoLocal)
                    log.ok(`[unimed-boletos] Download OK: ${nomeArquivo}`)

                    resultados.push({
                      nome: grupo.nome || `Grupo ${numGrupo}`,
                      sub: `Grupo ${numGrupo} · Título ${titulo} · Parcela ${parcela} · R$ ${valor} · Venc: ${vencto}`,
                      status: 'OK',
                      label: null,
                      orientacao: null,
                      erro: null,
                      tipo: null,
                    })
                  } else {
                    throw new Error('Download não iniciou em 15s')
                  }
                } else {
                  throw new Error('Ícone de download não encontrado na linha')
                }
              } catch (errBoleto) {
                log.warn(`[unimed-boletos] Erro no boleto ${j + 1} do grupo ${numGrupo}: ${errBoleto.message}`)
                resultados.push({
                  nome: grupo.nome || `Grupo ${numGrupo}`,
                  sub: `Grupo ${numGrupo} · Boleto ${j + 1}`,
                  status: 'FALHA',
                  label: 'Falha no download do boleto',
                  orientacao: 'Baixe manualmente no portal.',
                  erro: errBoleto.message,
                  tipo: 'DOWNLOAD_FALHOU',
                })
              }
            }
          }

          // Limpar filtros para próximo grupo
          await page.click('button:has-text("Limpar Filtros")', { timeout: 5000 }).catch(() => {})
          await page.waitForTimeout(1500)

        } catch (errGrupo) {
          log.error(`[unimed-boletos] Erro no grupo ${numGrupo}: ${errGrupo.message}`)
          await ss(page, `unimed-boletos-erro-grupo-${numGrupo}.png`)
          resultados.push({
            nome: grupo.nome || `Grupo ${numGrupo}`,
            sub: `Grupo ${numGrupo}`,
            status: 'FALHA',
            ...classErr(errGrupo.message),
            erro: errGrupo.message,
          })
        }

        atualizar(jobId, { progresso: 2 + i + 1, resultados })
      }

      // ── Passo final: Enviar email ──────────────────────────────────────
      log.info(`[unimed-boletos] Enviando email com ${pdfsParaAnexar.length} PDF(s)...`)

      const hoje = new Date().toLocaleDateString('pt-BR')
      const totalOK    = resultados.filter(r => r.status === 'OK').length
      const totalFalha = resultados.filter(r => r.status === 'FALHA').length
      const totalAviso = resultados.filter(r => r.status === 'AVISO').length

      const corpo = [
        `Unimed Boletos Vida — ${hoje}`,
        `Dia: ${dia || 'todos'}`,
        '',
        `Grupos consultados: ${grupos.length}`,
        `Boletos baixados: ${totalOK}`,
        totalFalha > 0 ? `Falhas: ${totalFalha}` : '',
        totalAviso > 0 ? `Sem boletos: ${totalAviso}` : '',
        '',
        'Detalhamento:',
        ...resultados.map(r => `  ${r.status === 'OK' ? '✓' : r.status === 'AVISO' ? '—' : '✗'} ${r.nome} · ${r.sub}`),
        '',
        'Atenciosamente,',
        'Sistema Jacometo Seguros',
      ].filter(l => l !== undefined).join('\n')

      const emailOk = await email.enviar({
        assunto: `Unimed Boletos Vida — ${hoje}${dia ? ` — Dia ${dia}` : ''}`,
        corpo,
        anexo: pdfsParaAnexar.length > 0 ? pdfsParaAnexar : undefined,
        para: 'jacometo@jacometo.com.br,giovana@jacometo.com.br',
      })

      if (emailOk) {
        log.ok(`[unimed-boletos] Email enviado com ${pdfsParaAnexar.length} anexo(s)`)
      } else {
        log.warn('[unimed-boletos] Falha ao enviar email')
      }

      // Limpar PDFs temporários
      for (const pdf of pdfsParaAnexar) {
        try { fs.unlinkSync(pdf) } catch {}
      }

      atualizar(jobId, {
        status: 'concluido',
        progresso: totalPassos,
        resultados,
      })

      await db.jobConcluido(jobId, 'unimed_boletos', { resultados, emailEnviado: !!emailOk }, _inicio)
      log.ok(`[unimed-boletos] Job ${jobId} concluído — ${totalOK} boleto(s), ${totalFalha} falha(s)`)

    } catch (err) {
      log.error(`[unimed-boletos] Erro crítico: ${err.message}`)
      await db.jobErro(jobId, 'unimed_boletos', err.message, _inicio)
      const cl = classErr(err.message)
      atualizar(jobId, {
        status: 'erro_critico',
        erro: err.message,
        resultados: [{
          nome: 'Unimed Seguros',
          sub: 'Erro durante execução',
          status: 'FALHA',
          ...cl,
          erro: err.message,
        }],
      })
    } finally {
      if (browser) await fecharBrowser(browser)
    }
  })
}

module.exports.getJobStatus = getJobStatus
