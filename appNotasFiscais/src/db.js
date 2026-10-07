// Conexão com o PostgreSQL e criação automática das tabelas.
//
// O app pode usar um banco já existente e compartilhado com outros sistemas:
// tudo fica num schema próprio (DB_SCHEMA, padrão "notas_fiscais"), então as
// tabelas daqui (usuarios, notas, ...) nunca se misturam com as de outros apps.
const fs = require('fs');
const path = require('path');
const { Pool, Client, types } = require('pg');

// DATE como texto 'AAAA-MM-DD' (evita deslocamento de fuso) e NUMERIC como número
types.setTypeParser(1082, v => v);
types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));

const SCHEMA = (process.env.DB_SCHEMA || 'notas_fiscais').trim().toLowerCase();
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  throw new Error(`DB_SCHEMA inválido: "${SCHEMA}". Use só letras minúsculas, números e _.`);
}

// Aceita DATABASE_URL ou as variáveis separadas (como o Easypanel mostra)
function configConexao(banco) {
  const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;
  if (process.env.DATABASE_URL) {
    if (!banco) return { connectionString: process.env.DATABASE_URL, ssl };
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${banco}`;
    return { connectionString: url.toString(), ssl };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: banco || process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD ?? process.env.DB_PASS,
    ssl,
  };
}

function nomeDoBanco() {
  if (process.env.DATABASE_URL) return decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) || 'postgres';
  return process.env.DB_NAME || 'postgres';
}

const pool = new Pool(configConexao());
// Toda conexão nova enxerga só o schema do app
pool.on('connect', cliente => cliente.query(`SET search_path TO "${SCHEMA}"`));
pool.on('error', err => console.error('❌ PostgreSQL:', err.message));

// Se o banco indicado não existir, cria (conectando no banco "postgres" de manutenção)
async function garantirBanco() {
  const teste = new Client(configConexao());
  try {
    await teste.connect();
    return;
  } catch (err) {
    if (err.code !== '3D000') throw err; // 3D000 = banco não existe
  } finally {
    await teste.end().catch(() => {});
  }
  const banco = nomeDoBanco();
  console.log(`ℹ️  Banco "${banco}" não existe. Criando...`);
  const manutencao = new Client(configConexao('postgres'));
  await manutencao.connect();
  try {
    await manutencao.query(`CREATE DATABASE "${banco.replace(/"/g, '""')}"`);
  } finally {
    await manutencao.end();
  }
}

async function iniciar() {
  await garantirBanco();
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const cliente = await pool.connect();
  try {
    // Trava para duas instâncias não criarem as tabelas ao mesmo tempo
    await cliente.query('SELECT pg_advisory_lock(hashtext($1))', [`schema:${SCHEMA}`]);
    await cliente.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await cliente.query(`SET search_path TO "${SCHEMA}"`);
    await cliente.query(sql);
  } finally {
    await cliente.query('SELECT pg_advisory_unlock(hashtext($1))', [`schema:${SCHEMA}`]).catch(() => {});
    cliente.release();
  }
  return { banco: nomeDoBanco(), schema: SCHEMA };
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

module.exports = { pool, query, iniciar, auditar, SCHEMA };
