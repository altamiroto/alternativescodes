const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// DATE como texto 'AAAA-MM-DD' (evita deslocamento de fuso) e NUMERIC como número
types.setTypeParser(1082, v => v);
types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function iniciar() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

function query(texto, params) {
  return pool.query(texto, params);
}

async function auditar(quem, acao, notaId, detalhes) {
  try {
    await pool.query(
      'INSERT INTO auditoria (quem, acao, nota_id, detalhes) VALUES ($1, $2, $3, $4)',
      [quem, acao, notaId || null, detalhes ? JSON.stringify(detalhes) : null]
    );
  } catch (err) {
    console.warn('⚠️  Auditoria:', err.message);
  }
}

module.exports = { pool, query, iniciar, auditar };
