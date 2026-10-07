-- =====================================================
-- Notas Fiscais do Estoque — Schema PostgreSQL
-- Executado automaticamente quando o servidor inicia, dentro do schema
-- definido em DB_SCHEMA (padrão: notas_fiscais). Não mexe em outras tabelas do banco.
-- =====================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,          -- sempre minúsculo
  bloqueado   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notas (
  id                   SERIAL PRIMARY KEY,    -- nº do registro (#0042)
  slug                 TEXT NOT NULL UNIQUE,  -- código do link público: NUNCA muda
  chave                TEXT,                  -- 44 caracteres; pode repetir (novo registro se errou)
  modelo               TEXT,
  serie                TEXT,
  numero               TEXT,
  uf                   TEXT,
  emitente_cnpj        TEXT,
  emitente_nome        TEXT,
  destinatario_cnpj    TEXT,
  destinatario_nome    TEXT,
  data_emissao         DATE,
  valor_total          NUMERIC(14,2),
  comentario           TEXT,
  origem_dados         TEXT,                  -- xml | pdf_texto | pdf_sem_texto | chave | manual
  parse_status         TEXT,                  -- completo | parcial | so_chave | sem_chave
  publico_ativo        BOOLEAN NOT NULL DEFAULT TRUE,
  etiqueta_impressa_em TIMESTAMPTZ,
  criado_por           INT REFERENCES usuarios(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ            -- lixeira
);

CREATE INDEX IF NOT EXISTS idx_notas_chave   ON notas(chave);
CREATE INDEX IF NOT EXISTS idx_notas_created ON notas(created_at DESC);

CREATE TABLE IF NOT EXISTS arquivos (
  id             SERIAL PRIMARY KEY,
  nota_id        INT NOT NULL REFERENCES notas(id),
  tipo           TEXT NOT NULL,               -- nota_pdf | nota_xml | anexo
  nome_original  TEXT,
  caminho        TEXT NOT NULL,               -- relativo a DATA_DIR/uploads
  mime           TEXT NOT NULL,
  tamanho        BIGINT NOT NULL DEFAULT 0,
  sha256         TEXT,
  enviado_por    INT REFERENCES usuarios(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_arquivos_nota ON arquivos(nota_id);

CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGSERIAL PRIMARY KEY,
  quem        TEXT,
  acao        TEXT NOT NULL,
  nota_id     INT,
  detalhes    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_nota ON auditoria(nota_id);

-- v1.1: protocolo de autorização da SEFAZ (vem do XML ou do PDF)
ALTER TABLE notas ADD COLUMN IF NOT EXISTS protocolo TEXT;

-- v1.2: busca por produtos (itens do XML + texto do PDF, sem acentos e em minúsculas)
ALTER TABLE notas ADD COLUMN IF NOT EXISTS itens JSONB;
ALTER TABLE notas ADD COLUMN IF NOT EXISTS texto_busca TEXT;

-- v1.3: lista "Para imprimir agora" guardada na conta da pessoa (vale em qualquer aparelho)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS lote_ids INT[] NOT NULL DEFAULT '{}';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS lote_impresso BOOLEAN NOT NULL DEFAULT FALSE;
