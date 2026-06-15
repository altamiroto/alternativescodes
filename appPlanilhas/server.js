// =====================================================
// Planilha Offline v4 — Servidor VPS
// Node.js + Express + PostgreSQL + Multer (uploads)
//
// Instalação:
//   npm install express pg multer cors dotenv
//   node server.js
// =====================================================

require('dotenv').config();
const express  = require('express');
const { Pool } = require('pg');
const multer   = require('multer');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3737;

// ─── Pasta de uploads ────────────────────────────────
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── Banco de dados ──────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Ou use variáveis individuais:
  // host: process.env.DB_HOST || 'localhost',
  // port: process.env.DB_PORT || 5432,
  // database: process.env.DB_NAME,
  // user: process.env.DB_USER,
  // password: process.env.DB_PASS,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.connect()
  .then(() => console.log('✅ PostgreSQL conectado'))
  .catch(err => console.error('❌ Erro PostgreSQL:', err.message));

// ─── Middleware ──────────────────────────────────────
app.use(cors({
  origin: '*', // Em produção, restrinja ao domínio do app
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Auth-Token'],
}));
app.use(express.json({ limit: '10mb' }));

// ─── Autenticação simples por token ─────────────────
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'meu-token-secreto-123';

function auth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }
  next();
}

// ─── Upload (Multer) ─────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const fileId = req.body.fileId || ('f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    const ext    = path.extname(file.originalname) || '.bin';
    cb(null, fileId + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB por arquivo
});

// ─── Servir arquivos estáticos ───────────────────────
app.use('/files', auth, express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));


// =====================================================
// ROTAS
// =====================================================

// ── Health check ─────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Listar planilhas ──────────────────────────────────
app.get('/api/sheets', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, col_types, columns, updated_at, jsonb_array_length(rows) AS row_count FROM sheets ORDER BY updated_at DESC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Pull: baixar planilha completa ───────────────────
app.get('/api/sync/:sheetId', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sheets WHERE id = $1',
      [req.params.sheetId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Planilha não encontrada' });

    // Incluir lista de arquivos da planilha
    const { rows: files } = await pool.query(
      'SELECT * FROM files WHERE sheet_id = $1 ORDER BY uploaded_at',
      [req.params.sheetId]
    );

    res.json({ ...rows[0], files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Push: enviar planilha (upsert) ───────────────────
app.post('/api/sync', auth, async (req, res) => {
  const { id, name, columns, col_types, rows: sheetRows, updated_at, device_id } = req.body;

  if (!id || !name) return res.status(400).json({ error: 'id e name são obrigatórios' });

  try {
    // Verifica se existe versão mais nova no servidor (evita overwrite acidental)
    const existing = await pool.query('SELECT updated_at FROM sheets WHERE id = $1', [id]);
    if (existing.rows.length) {
      const serverTs = new Date(existing.rows[0].updated_at).getTime();
      const clientTs = updated_at ? new Date(updated_at).getTime() : 0;
      if (serverTs > clientTs + 1000) { // +1s de tolerância
        return res.status(409).json({
          error: 'conflict',
          message: 'Servidor tem versão mais recente. Faça pull primeiro.',
          server_updated_at: existing.rows[0].updated_at,
        });
      }
    }

    await pool.query(`
      INSERT INTO sheets (id, name, columns, col_types, rows, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name       = EXCLUDED.name,
        columns    = EXCLUDED.columns,
        col_types  = EXCLUDED.col_types,
        rows       = EXCLUDED.rows,
        updated_at = NOW()
    `, [id, name, JSON.stringify(columns), JSON.stringify(col_types || []), JSON.stringify(sheetRows || [])]);

    // Log
    await pool.query(
      'INSERT INTO sync_log (sheet_id, action, device_id, rows_count) VALUES ($1,$2,$3,$4)',
      [id, 'push', device_id || 'unknown', (sheetRows || []).length]
    ).catch(() => {}); // não falhar por causa do log

    const updated = await pool.query('SELECT updated_at FROM sheets WHERE id = $1', [id]);
    res.json({ ok: true, updated_at: updated.rows[0]?.updated_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Upload de arquivo/foto ───────────────────────────
app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const { fileId, sheetId, rowId, colIdx } = req.body;
  const fId = fileId || path.basename(req.file.filename, path.extname(req.file.filename));

  try {
    await pool.query(`
      INSERT INTO files (id, sheet_id, row_id, col_idx, filename, original_name, mime_type, size_bytes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        filename = EXCLUDED.filename,
        size_bytes = EXCLUDED.size_bytes
    `, [fId, sheetId, rowId, parseInt(colIdx) || 0,
        req.file.filename, req.file.originalname,
        req.file.mimetype, req.file.size]);

    res.json({
      ok: true,
      fileId: fId,
      filename: req.file.filename,
      url: `/files/${req.file.filename}`,
    });
  } catch (e) {
    // Deleta arquivo físico se falhou no banco
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: e.message });
  }
});

// ── Deletar arquivo ───────────────────────────────────
app.delete('/api/files/:fileId', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT filename FROM files WHERE id = $1', [req.params.fileId]);
    if (!rows.length) return res.status(404).json({ error: 'Arquivo não encontrado' });

    const filePath = path.join(UPLOADS_DIR, rows[0].filename);
    await pool.query('DELETE FROM files WHERE id = $1', [req.params.fileId]);

    fs.unlink(filePath, () => {}); // não falha se arquivo já não existe
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Deletar planilha ──────────────────────────────────
app.delete('/api/sheets/:sheetId', auth, async (req, res) => {
  try {
    // Deleta arquivos físicos
    const { rows: files } = await pool.query('SELECT filename FROM files WHERE sheet_id = $1', [req.params.sheetId]);
    for (const f of files) {
      fs.unlink(path.join(UPLOADS_DIR, f.filename), () => {});
    }
    await pool.query('DELETE FROM sheets WHERE id = $1', [req.params.sheetId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Download CSV ──────────────────────────────────────
app.get('/api/export/:sheetId', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM sheets WHERE id = $1', [req.params.sheetId]);
    if (!rows.length) return res.status(404).json({ error: 'Planilha não encontrada' });

    const sheet = rows[0];
    const csvRows = [sheet.columns, ...sheet.rows];
    const csv = '\uFEFF' + csvRows.map(r =>
      r.map(c => `"${(c || '').toString().replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${sheet.name.replace(/\s+/g, '_')}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Versão do sistema ───────────────────────────────────
app.get('/api/version', (req, res) => {
  try {
    const cp = require('child_process');
    const hash = cp.execSync('git rev-parse --short HEAD').toString().trim();
    res.json({ version: hash });
  } catch (e) {
    res.json({ version: process.env.SOURCE_VERSION || process.env.COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'unknown' });
  }
});

// ─── Start ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📁 Uploads em: ${UPLOADS_DIR}`);
  console.log(`🔑 Token: ${AUTH_TOKEN}`);
});
