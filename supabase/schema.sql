-- ══════════════════════════════════════════════════════════════════
--  Ferramentas Jacometo — Schema Supabase
--  Colar inteiro no SQL Editor do Supabase e executar (Run)
--  supabase.com → projeto → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

-- ── Extensões ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── jobs_history ─────────────────────────────────────────────────
-- Histórico de todas as execuções de automações
CREATE TABLE IF NOT EXISTS jobs_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          TEXT NOT NULL,                    -- ID gerado pelo backend
  seguradora      TEXT NOT NULL,                    -- ex: 'allianz', 'tokio'
  seguradora_nome TEXT NOT NULL,                    -- ex: 'Allianz', 'Tokio Marine'
  responsavel     TEXT NOT NULL,                    -- 'João', 'Giovana', 'Bárbara'
  status          TEXT NOT NULL                     -- 'concluido', 'erro_critico'
                  CHECK (status IN ('concluido', 'erro_critico', 'executando')),
  total_itens     INTEGER DEFAULT 0,                -- total de parcelas/clientes
  total_erros     INTEGER DEFAULT 0,
  valor_total     NUMERIC(12,2) DEFAULT 0,          -- valor total em R$
  csv_path        TEXT,                             -- caminho do CSV gerado
  erro_msg        TEXT,                             -- mensagem se erro_critico
  iniciado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_em    TIMESTAMPTZ,
  duracao_seg     INTEGER,                          -- segundos de execução
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── job_results ──────────────────────────────────────────────────
-- Resultados individuais por item (segurado, cliente, etc.)
CREATE TABLE IF NOT EXISTS job_results (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id      TEXT NOT NULL REFERENCES jobs_history(job_id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,          -- nome do segurado/cliente
  sub         TEXT,                   -- detalhe (apólice, valor, vencimento)
  status      TEXT NOT NULL           -- 'OK', 'FALHA', 'AVISO'
              CHECK (status IN ('OK', 'FALHA', 'AVISO')),
  tipo_erro   TEXT,                   -- 'LOGIN_FALHOU', 'TIMEOUT', etc.
  label_erro  TEXT,                   -- descrição amigável do erro
  orientacao  TEXT,                   -- o que fazer para resolver
  erro_tecnico TEXT,                  -- mensagem técnica
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── clientes_plano_hospitalar ─────────────────────────────────────
-- Lista de clientes gerenciada pela Bárbara via interface web
CREATE TABLE IF NOT EXISTS clientes_plano_hospitalar (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome        TEXT NOT NULL,
  cnpj        TEXT NOT NULL,
  login       TEXT NOT NULL,          -- CNPJ sem formatação
  senha       TEXT NOT NULL,          -- geralmente CNPJ + **@*
  vencimento  INTEGER NOT NULL        -- dia do vencimento: 5, 10, 13, 15, 20, 25, 30
              CHECK (vencimento IN (5, 10, 13, 15, 20, 25, 30)),
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  observacao  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── job_screenshots ───────────────────────────────────────────────
-- Metadados de screenshots de erro (arquivo fica no Mac Mini)
CREATE TABLE IF NOT EXISTS job_screenshots (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id      TEXT NOT NULL,
  filename    TEXT NOT NULL,
  caminho     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Índices para performance ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jobs_history_seguradora   ON jobs_history(seguradora);
CREATE INDEX IF NOT EXISTS idx_jobs_history_responsavel  ON jobs_history(responsavel);
CREATE INDEX IF NOT EXISTS idx_jobs_history_status       ON jobs_history(status);
CREATE INDEX IF NOT EXISTS idx_jobs_history_iniciado_em  ON jobs_history(iniciado_em DESC);
CREATE INDEX IF NOT EXISTS idx_job_results_job_id        ON job_results(job_id);
CREATE INDEX IF NOT EXISTS idx_job_results_status        ON job_results(status);
CREATE INDEX IF NOT EXISTS idx_clientes_vencimento       ON clientes_plano_hospitalar(vencimento);
CREATE INDEX IF NOT EXISTS idx_clientes_ativo            ON clientes_plano_hospitalar(ativo);

-- ── Trigger: updated_at automático ───────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clientes_updated_at
  BEFORE UPDATE ON clientes_plano_hospitalar
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row Level Security (RLS) ──────────────────────────────────────
-- Backend usa service_role key (ignora RLS)
-- Frontend usa anon key — só leitura no histórico, CRUD nos clientes
ALTER TABLE jobs_history            ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_results             ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes_plano_hospitalar ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_screenshots         ENABLE ROW LEVEL SECURITY;

-- Leitura pública (autenticada via anon key do frontend)
CREATE POLICY "leitura_jobs_history"
  ON jobs_history FOR SELECT USING (true);

CREATE POLICY "leitura_job_results"
  ON job_results FOR SELECT USING (true);

CREATE POLICY "leitura_clientes"
  ON clientes_plano_hospitalar FOR SELECT USING (true);

-- Escrita apenas via service_role (backend — não exposta ao frontend)
CREATE POLICY "escrita_jobs_history"
  ON jobs_history FOR INSERT WITH CHECK (true);

CREATE POLICY "update_jobs_history"
  ON jobs_history FOR UPDATE USING (true);

CREATE POLICY "escrita_job_results"
  ON job_results FOR INSERT WITH CHECK (true);

-- CRUD de clientes via service_role (Bárbara usa o frontend com a anon key)
-- Para permitir INSERT/UPDATE/DELETE pelo frontend, ative abaixo:
CREATE POLICY "crud_clientes"
  ON clientes_plano_hospitalar FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "escrita_screenshots"
  ON job_screenshots FOR INSERT WITH CHECK (true);

CREATE POLICY "leitura_screenshots"
  ON job_screenshots FOR SELECT USING (true);

-- ── View: resumo últimos 30 dias ──────────────────────────────────
CREATE OR REPLACE VIEW v_resumo_30dias AS
SELECT
  seguradora,
  seguradora_nome,
  responsavel,
  COUNT(*)                                          AS total_execucoes,
  COUNT(*) FILTER (WHERE status = 'concluido')      AS execucoes_ok,
  COUNT(*) FILTER (WHERE status = 'erro_critico')   AS execucoes_erro,
  SUM(total_itens)                                  AS total_itens,
  SUM(total_erros)                                  AS total_erros,
  SUM(valor_total)                                  AS valor_total,
  MAX(iniciado_em)                                  AS ultima_execucao
FROM jobs_history
WHERE iniciado_em >= NOW() - INTERVAL '30 days'
GROUP BY seguradora, seguradora_nome, responsavel
ORDER BY ultima_execucao DESC;

-- ── Dados iniciais: clientes Plano Hospitalar ─────────────────────
-- Adicione aqui os clientes reais quando quiser importar em lote
-- INSERT INTO clientes_plano_hospitalar (nome, cnpj, login, senha, vencimento)
-- VALUES ('NOME EMPRESA', '00.000.000/0001-00', '00000000000100', '00000000000100**@*', 5);

-- ── Verificação ───────────────────────────────────────────────────
SELECT 'Schema criado com sucesso!' AS resultado;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
