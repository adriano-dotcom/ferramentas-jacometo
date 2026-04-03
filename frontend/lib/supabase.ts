// frontend/lib/supabase.ts
// Cliente Supabase para o frontend (anon key — leitura pública + CRUD clientes)
import { createClient } from '@supabase/supabase-js'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(url, key)

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface JobHistory {
  id:              string
  job_id:          string
  seguradora:      string
  seguradora_nome: string
  responsavel:     string
  status:          'concluido' | 'erro_critico' | 'executando'
  total_itens:     number
  total_erros:     number
  valor_total:     number
  csv_path:        string | null
  erro_msg:        string | null
  iniciado_em:     string
  concluido_em:    string | null
  duracao_seg:     number | null
}

export interface JobResult {
  id:           string
  job_id:       string
  nome:         string
  sub:          string | null
  status:       'OK' | 'FALHA' | 'AVISO'
  tipo_erro:    string | null
  label_erro:   string | null
  orientacao:   string | null
  erro_tecnico: string | null
}

export interface ClientePlanoHospitalar {
  id:         string
  nome:       string
  cnpj:       string
  login:      string
  senha:      string
  vencimento: number
  ativo:      boolean
  observacao: string | null
  created_at: string
  updated_at: string
}
