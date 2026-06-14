-- =====================================================
-- Planilha Offline v4 — Schema PostgreSQL
-- Execute como: psql -U seu_usuario -d seu_banco -f schema.sql
-- =====================================================

-- Extensão para UUID (opcional, usamos TEXT IDs do client)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────
-- TABELA: sheets (planilhas)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheets (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT 'Planilha',
  columns      JSONB NOT NULL DEFAULT '[]',
  col_types    JSONB NOT NULL DEFAULT '[]',  -- tipos: text|number|date|photo|file
  rows         JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para busca rápida por data de atualização
CREATE INDEX IF NOT EXISTS idx_sheets_updated ON sheets(updated_at DESC);

-- ─────────────────────────────────────────────────────
-- TABELA: files (referências de arquivos/fotos)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,          -- ID gerado no cliente
  sheet_id      TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  row_id        TEXT NOT NULL,             -- ID único da linha no JSONB
  col_idx       INTEGER NOT NULL,          -- Índice da coluna
  filename      TEXT NOT NULL,             -- Nome no servidor: {id}.ext
  original_name TEXT,                      -- Nome original do arquivo
  mime_type     TEXT,
  size_bytes    BIGINT DEFAULT 0,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_sheet ON files(sheet_id);
CREATE INDEX IF NOT EXISTS idx_files_row ON files(sheet_id, row_id);

-- ─────────────────────────────────────────────────────
-- TABELA: sync_log (auditoria — opcional)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  id         SERIAL PRIMARY KEY,
  sheet_id   TEXT,
  action     TEXT,          -- 'push' | 'pull' | 'upload'
  device_id  TEXT,
  rows_count INTEGER,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────
-- FUNÇÃO: atualiza updated_at automaticamente
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sheets_updated_at
  BEFORE UPDATE ON sheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────
-- Dados iniciais de exemplo (remova se não quiser)
-- ─────────────────────────────────────────────────────
-- INSERT INTO sheets (id, name, columns, col_types, rows) VALUES
--   ('sh_example', 'Exemplo', '["Nome","Telefone","Foto"]', '["text","text","photo"]', '[]');
