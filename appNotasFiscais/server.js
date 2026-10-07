// =====================================================
// Notas Fiscais do Estoque — Servidor
// Node.js + Express + PostgreSQL
// =====================================================
require('./src/env');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const db = require('./src/db');
const auth = require('./src/auth');
const storage = require('./src/storage');
const parse = require('./src/parse');
const chave = require('./src/chave');
const etiquetas = require('./src/etiquetas');
const bwipjs = require('bwip-js');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 10;
const MAX_ANEXOS = 10;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1)); // nº de proxies na frente (Traefik do Easypanel = 1)
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

// ─── Utilitários ─────────────────────────────────────
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: sem I, L, O, U

function novoSlug() {
  return Array.from(crypto.randomBytes(10), b => ALFABETO[b & 31]).join('');
}

// Aceita o código digitado à mão: minúsculas, O→0, I/L→1
function normalizarSlug(s) {
  return String(s || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
}

function baseUrl(req) {
  const fixa = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return fixa || `${req.protocol}://${req.get('host')}`;
}

const linkNota = (req, slug) => `${baseUrl(req)}/n/${slug}`;

function erro(res, status, mensagem) {
  return res.status(status).json({ erro: mensagem });
}

// Encapsula rotas async para o erro cair no tratador central
const rota = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const limite = (max, minutos = 15) => rateLimit({
  windowMs: minutos * 60 * 1000,
  limit: max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
});

// ─── Upload ──────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: storage.TMP_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_ANEXOS + 2 },
});

const camposUpload = upload.fields([
  { name: 'nota', maxCount: 2 },       // PDF e/ou XML da nota
  { name: 'anexos', maxCount: MAX_ANEXOS },
]);

function arquivosDaRequisicao(req) {
  return [...(req.files?.nota || []), ...(req.files?.anexos || [])];
}

// Grava os arquivos da requisição na pasta da nota e registra no banco
async function salvarArquivos(cliente, notaId, arquivos, enviadoPor) {
  for (const { arquivo, tipoDetectado, papel } of arquivos) {
    const rel = storage.guardar(arquivo.path, notaId, tipoDetectado.ext);
    const abs = storage.caminhoAbsoluto(rel);
    await cliente.query(
      `INSERT INTO arquivos (nota_id, tipo, nome_original, caminho, mime, tamanho, sha256, enviado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [notaId, papel, Buffer.from(arquivo.originalname, 'latin1').toString('utf8').slice(0, 200), rel,
        tipoDetectado.mime, arquivo.size, storage.hashArquivo(abs), enviadoPor]
    );
  }
}

// Classifica os arquivos enviados: a nota (PDF/XML) e os anexos
function classificar(req) {
  const notaArquivos = (req.files?.nota || []).map(arquivo => ({
    arquivo, tipoDetectado: storage.detectarTipo(storage.lerCabecalho(arquivo.path), arquivo.originalname),
  }));
  for (const n of notaArquivos) {
    if (!['pdf', 'xml'].includes(n.tipoDetectado.ext)) {
      throw Object.assign(new Error('O arquivo da nota precisa ser PDF ou XML.'), { status: 400 });
    }
    n.papel = n.tipoDetectado.ext === 'pdf' ? 'nota_pdf' : 'nota_xml';
  }
  const anexos = (req.files?.anexos || []).map(arquivo => ({
    arquivo, papel: 'anexo', tipoDetectado: storage.detectarTipo(storage.lerCabecalho(arquivo.path), arquivo.originalname),
  }));
  return { notaArquivos, anexos };
}

const CAMPOS_NOTA = ['chave', 'modelo', 'serie', 'numero', 'uf', 'emitente_cnpj', 'emitente_nome',
  'destinatario_cnpj', 'destinatario_nome', 'data_emissao', 'valor_total', 'protocolo', 'itens', 'texto_busca', 'origem_dados', 'parse_status'];

// JSONB precisa ir como texto JSON (o driver mandaria arrays como array do Postgres)
const valorBanco = (campo, v) => (campo === 'itens' && v != null ? JSON.stringify(v) : v ?? null);

// =====================================================
// PÁGINAS
// =====================================================
const pagina = arquivo => (req, res) => res.sendFile(path.join(PUBLIC_DIR, arquivo));
app.get('/', pagina('enviar.html'));
app.get('/n/:slug', pagina('nota.html'));
app.get('/admin', pagina('admin.html'));
app.get('/instalar', pagina('instalar.html'));
// Share Target do Android sem o service worker ativo: só volta para o início
app.post('/compartilhar', (req, res) => res.redirect(303, '/'));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
app.get('/sw.js', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC_DIR, 'sw.js')));
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

// =====================================================
// API — GERAL
// =====================================================
app.get('/api/health', rota(async (req, res) => {
  await db.query('SELECT 1');
  res.json({ status: 'ok', ts: new Date().toISOString() });
}));

app.get('/api/config', (req, res) => {
  res.json({ baseUrl: baseUrl(req), maxFileMb: MAX_FILE_MB, maxAnexos: MAX_ANEXOS });
});

// ─── Cadastro de quem envia (nome + e-mail, fica salvo no aparelho) ───
async function usuarioAtual(req) {
  const id = auth.usuarioId(req);
  if (!id) return null;
  const { rows } = await db.query('SELECT id, nome, email, bloqueado FROM usuarios WHERE id = $1', [id]);
  return rows[0] || null;
}

app.get('/api/eu', rota(async (req, res) => {
  const u = await usuarioAtual(req);
  res.json({ usuario: u && !u.bloqueado ? { nome: u.nome, email: u.email } : null });
}));

app.post('/api/cadastro', limite(30), rota(async (req, res) => {
  const nome = String(req.body?.nome || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
  if (nome.length < 2) return erro(res, 400, 'Digite seu nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro(res, 400, 'Digite um e-mail válido.');

  const { rows } = await db.query(
    `INSERT INTO usuarios (nome, email) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id, nome, email, bloqueado`,
    [nome, email]
  );
  const u = rows[0];
  if (u.bloqueado) return erro(res, 403, 'Seu acesso foi bloqueado. Fale com o administrador.');
  auth.entrarUsuario(req, res, u.id);
  res.json({ usuario: { nome: u.nome, email: u.email } });
}));

// Avisa se a chave já foi registrada antes (não impede: pode ser um novo envio corrigido)
app.get('/api/chave/:chave', rota(async (req, res) => {
  if (!auth.usuarioId(req)) return erro(res, 401, 'Faça seu cadastro antes de enviar.');
  const c = chave.normalizar(req.params.chave);
  if (!chave.validar(c)) return res.json({ valida: false });
  const { rows } = await db.query(
    `SELECT n.id, n.created_at, u.nome AS criado_por_nome FROM notas n
     LEFT JOIN usuarios u ON u.id = n.criado_por
     WHERE n.chave = $1 AND n.deleted_at IS NULL ORDER BY n.created_at DESC LIMIT 5`,
    [c]
  );
  res.json({ valida: true, dados: chave.decompor(c), registros_anteriores: rows });
}));

// ─── Envio de nota ───────────────────────────────────
app.post('/api/notas', limite(60), camposUpload, rota(async (req, res) => {
  const enviados = arquivosDaRequisicao(req);
  try {
    const usuario = await usuarioAtual(req);
    if (!usuario || usuario.bloqueado) return erro(res, 401, 'Faça seu cadastro antes de enviar.');

    const { notaArquivos, anexos } = classificar(req);
    const chaveDigitada = String(req.body.chave || '');
    const comentario = String(req.body.comentario || '').trim().slice(0, 2000) || null;

    if (chaveDigitada && !chave.validar(chaveDigitada)) {
      return erro(res, 400, 'A chave de acesso não confere. Verifique os números.');
    }
    if (!notaArquivos.length && !chaveDigitada) {
      return erro(res, 400, 'Envie o PDF da nota ou informe a chave de acesso.');
    }

    const xml = notaArquivos.find(n => n.papel === 'nota_xml');
    const pdf = notaArquivos.find(n => n.papel === 'nota_pdf');
    const dados = await parse.analisar({
      xmlBuffer: xml ? fs.readFileSync(xml.arquivo.path) : null,
      pdfBuffer: pdf ? fs.readFileSync(pdf.arquivo.path) : null,
      chaveDigitada,
    });

    const cliente = await db.pool.connect();
    let nota;
    try {
      await cliente.query('BEGIN');
      const valores = CAMPOS_NOTA.map(c => valorBanco(c, dados[c]));
      for (let tentativa = 0; !nota; tentativa++) {
        try {
          await cliente.query('SAVEPOINT slug');
          const { rows } = await cliente.query(
            `INSERT INTO notas (slug, ${CAMPOS_NOTA.join(', ')}, comentario, criado_por)
             VALUES ($1, ${CAMPOS_NOTA.map((_, i) => `$${i + 2}`).join(', ')}, $${CAMPOS_NOTA.length + 2}, $${CAMPOS_NOTA.length + 3})
             RETURNING *`,
            [novoSlug(), ...valores, comentario, usuario.id]
          );
          nota = rows[0];
        } catch (e) {
          if (e.code !== '23505' || tentativa > 5) throw e; // slug repetido: tenta outro
          await cliente.query('ROLLBACK TO SAVEPOINT slug');
        }
      }
      await salvarArquivos(cliente, nota.id, [...notaArquivos, ...anexos], usuario.id);
      await cliente.query('COMMIT');
    } catch (e) {
      await cliente.query('ROLLBACK');
      throw e;
    } finally {
      cliente.release();
    }

    let anteriores = [];
    if (nota.chave) {
      ({ rows: anteriores } = await db.query(
        'SELECT id, created_at FROM notas WHERE chave = $1 AND id <> $2 AND deleted_at IS NULL ORDER BY id',
        [nota.chave, nota.id]
      ));
    }
    await db.auditar(usuario.nome, 'criou', nota.id, { origem: nota.origem_dados, arquivos: notaArquivos.length + anexos.length });

    res.status(201).json({
      id: nota.id,
      slug: nota.slug,
      url: linkNota(req, nota.slug),
      nota: resumoPublico(nota),
      registros_anteriores: anteriores,
    });
  } finally {
    storage.removerTmp(enviados); // o que não foi movido (erro) é apagado
  }
}));

// =====================================================
// API — PÚBLICA (quem tem o link)
// =====================================================
function resumoPublico(n) {
  return {
    id: n.id,
    slug: n.slug,
    chave: n.chave,
    modelo: n.modelo,
    serie: n.serie,
    numero: n.numero,
    uf: n.uf,
    emitente_cnpj: n.emitente_cnpj,
    emitente_nome: n.emitente_nome,
    destinatario_cnpj: n.destinatario_cnpj,
    destinatario_nome: n.destinatario_nome,
    data_emissao: n.data_emissao,
    protocolo: n.protocolo, // sem valor_total de propósito: o valor só aparece no painel do admin
    comentario: n.comentario,
    parse_status: n.parse_status,
    created_at: n.created_at,
    criado_por_nome: n.criado_por_nome,
  };
}

async function buscarNotaPublica(req) {
  const { rows } = await db.query(
    `SELECT n.*, u.nome AS criado_por_nome FROM notas n
     LEFT JOIN usuarios u ON u.id = n.criado_por WHERE n.slug = $1`,
    [normalizarSlug(req.params.slug)]
  );
  const n = rows[0];
  if (!n) return null;
  if ((n.deleted_at || !n.publico_ativo) && !auth.ehAdmin(req)) return null;
  return n;
}

app.get('/api/public/:slug', rota(async (req, res) => {
  const n = await buscarNotaPublica(req);
  if (!n) return erro(res, 404, 'Registro não encontrado.');
  const { rows: arquivos } = await db.query(
    `SELECT id, tipo, nome_original, mime, tamanho, created_at FROM arquivos
     WHERE nota_id = $1 AND deleted_at IS NULL ORDER BY tipo DESC, id`,
    [n.id]
  );
  res.json({ nota: resumoPublico(n), arquivos, url: linkNota(req, n.slug) });
}));

app.get('/f/:slug/:arquivoId', rota(async (req, res) => {
  const n = await buscarNotaPublica(req);
  if (!n) return res.status(404).send('Arquivo não encontrado.');
  const { rows } = await db.query(
    'SELECT * FROM arquivos WHERE id = $1 AND nota_id = $2 AND deleted_at IS NULL',
    [Number(req.params.arquivoId) || 0, n.id]
  );
  const a = rows[0];
  if (!a) return res.status(404).send('Arquivo não encontrado.');
  const inline = /^(application\/pdf|image\/(jpeg|png|gif|webp|avif)|video\/)/.test(a.mime);
  const nome = a.nome_original || `arquivo-${a.id}`;
  if (a.mime !== 'application/pdf') res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  res.attachment(nome);
  if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
  res.sendFile(storage.caminhoAbsoluto(a.caminho), { maxAge: '7d', headers: { 'Content-Type': a.mime } });
}));

// Imagens para a página pública e para a tela de sucesso
app.get('/api/public/:slug/barras.png', rota(async (req, res) => {
  const n = await buscarNotaPublica(req);
  if (!n?.chave) return res.status(404).end();
  const png = await bwipjs.toBuffer({
    bcid: 'code128', text: n.chave, scale: 3, height: 12, includetext: false,
    paddingwidth: 12, paddingheight: 3, backgroundcolor: 'FFFFFF', // margem branca para leitores
  });
  res.type('png').set('Cache-Control', 'public, max-age=86400').send(png);
}));

app.get('/api/public/:slug/qr.png', rota(async (req, res) => {
  const n = await buscarNotaPublica(req);
  if (!n) return res.status(404).end();
  const png = await bwipjs.toBuffer({
    bcid: 'qrcode', text: linkNota(req, n.slug), eclevel: 'M', scale: 6, paddingwidth: 4, paddingheight: 4, backgroundcolor: 'FFFFFF',
  });
  res.type('png').set('Cache-Control', 'public, max-age=86400').send(png);
}));

// =====================================================
// API — ADMIN
// =====================================================
app.post('/api/admin/login', limite(10), (req, res) => {
  if (!auth.senhaConfere(String(req.body?.usuario || ''), String(req.body?.senha || ''))) {
    return erro(res, 401, 'Usuário ou senha incorretos.');
  }
  auth.entrarAdmin(req, res);
  db.auditar(`admin:${req.body.usuario}`, 'login');
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  auth.sairAdmin(req, res);
  res.json({ ok: true });
});

app.get('/api/admin/eu', (req, res) => res.json({ admin: auth.ehAdmin(req) }));

app.use('/api/admin', auth.exigirAdmin);
const ADMIN = 'admin';

const FILTROS = {
  todas: 'n.deleted_at IS NULL',
  nao_impressas: 'n.deleted_at IS NULL AND n.etiqueta_impressa_em IS NULL',
  sem_chave: 'n.deleted_at IS NULL AND n.chave IS NULL',
  incompletas: "n.deleted_at IS NULL AND n.parse_status <> 'completo'",
  suspensas: 'n.deleted_at IS NULL AND NOT n.publico_ativo',
  lixeira: 'n.deleted_at IS NOT NULL',
};

app.get('/api/admin/notas', rota(async (req, res) => {
  const filtro = FILTROS[req.query.filtro] || FILTROS.todas;
  const params = [];
  const where = [filtro];
  const q = String(req.query.q || '').trim();
  let trecho = 'NULL';
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    params.push(parse.textoBusca(q) || '');
    const pt = `$${params.length}`;
    // trecho do texto da nota onde o termo apareceu (para mostrar na lista)
    trecho = `CASE WHEN length(${pt}) > 1 AND position(${pt} IN n.texto_busca) > 0
      THEN substring(n.texto_busca FROM greatest(position(${pt} IN n.texto_busca) - 40, 1) FOR 110) END`;
    const qChave = chave.normalizar(q);
    params.push(qChave ? `%${qChave}%` : '%%');
    const pc = `$${params.length}`;
    const numRegistro = /^#?\d{1,9}$/.test(q) ? Number(q.replace('#', '')) : -1; // EAN/chave longos não são nº de registro
    params.push(numRegistro);
    where.push(`(n.emitente_nome ILIKE ${p} OR n.comentario ILIKE ${p} OR u.nome ILIKE ${p} OR n.numero ILIKE ${p}
      OR (length(${pt}) > 1 AND n.texto_busca LIKE '%' || ${pt} || '%')
      OR n.slug ILIKE ${p} OR (length(${pc}) > 3 AND (n.chave ILIKE ${pc} OR n.emitente_cnpj ILIKE ${pc}))
      OR n.id = $${params.length})`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.de || '')) { params.push(req.query.de); where.push(`n.created_at >= $${params.length}::date`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.ate || '')) { params.push(req.query.ate); where.push(`n.created_at < $${params.length}::date + 1`); }

  const porPagina = 50;
  const paginaAtual = Math.max(1, Number(req.query.pagina) || 1);
  const { rows } = await db.query(
    `SELECT n.id, n.slug, n.chave, n.numero, n.serie, n.modelo, n.emitente_nome, n.emitente_cnpj, n.data_emissao,
            n.valor_total, n.comentario, n.parse_status, n.publico_ativo, n.etiqueta_impressa_em, n.created_at,
            n.deleted_at, u.nome AS criado_por_nome, ${trecho} AS trecho,
            (SELECT count(*)::int FROM arquivos a WHERE a.nota_id = n.id AND a.deleted_at IS NULL) AS qtd_arquivos,
            count(*) OVER()::int AS total
     FROM notas n LEFT JOIN usuarios u ON u.id = n.criado_por
     WHERE ${where.join(' AND ')}
     ORDER BY n.id DESC LIMIT ${porPagina} OFFSET ${(paginaAtual - 1) * porPagina}`,
    params
  );
  res.json({ notas: rows, total: rows[0]?.total || 0, pagina: paginaAtual, porPagina, baseUrl: baseUrl(req) });
}));

app.get('/api/admin/notas/:id', rota(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const { rows } = await db.query(
    `SELECT n.*, u.nome AS criado_por_nome, u.email AS criado_por_email FROM notas n
     LEFT JOIN usuarios u ON u.id = n.criado_por WHERE n.id = $1`, [id]);
  if (!rows[0]) return erro(res, 404, 'Nota não encontrada.');
  delete rows[0].texto_busca;
  const [{ rows: arquivos }, { rows: historico }] = await Promise.all([
    db.query('SELECT id, tipo, nome_original, mime, tamanho, created_at, deleted_at FROM arquivos WHERE nota_id = $1 ORDER BY id', [id]),
    db.query('SELECT quem, acao, detalhes, created_at FROM auditoria WHERE nota_id = $1 ORDER BY id DESC LIMIT 50', [id]),
  ]);
  res.json({ nota: rows[0], arquivos, historico, url: linkNota(req, rows[0].slug) });
}));

const EDITAVEIS = ['chave', 'modelo', 'serie', 'numero', 'uf', 'emitente_cnpj', 'emitente_nome', 'destinatario_cnpj',
  'destinatario_nome', 'data_emissao', 'valor_total', 'protocolo', 'comentario', 'publico_ativo'];

app.patch('/api/admin/notas/:id', rota(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const mudancas = {};
  for (const campo of EDITAVEIS) {
    if (!(campo in (req.body || {}))) continue;
    let v = req.body[campo];
    if (campo === 'publico_ativo') v = !!v;
    else if (v === '' || v == null) v = null;
    else if (campo === 'valor_total') {
      v = typeof v === 'number' ? v : Number(String(v).includes(',') ? String(v).replace(/\./g, '').replace(',', '.') : v);
      if (!Number.isFinite(v)) return erro(res, 400, 'Valor inválido.');
    }
    else v = String(v).trim();
    mudancas[campo] = v;
  }
  if ('chave' in mudancas && mudancas.chave) {
    if (!chave.validar(mudancas.chave)) return erro(res, 400, 'Chave de acesso inválida.');
    mudancas.chave = chave.normalizar(mudancas.chave);
  }
  if (mudancas.data_emissao && !/^\d{4}-\d{2}-\d{2}$/.test(mudancas.data_emissao)) return erro(res, 400, 'Data inválida.');
  const campos = Object.keys(mudancas);
  if (!campos.length) return erro(res, 400, 'Nada para alterar.');

  const { rows } = await db.query(
    `UPDATE notas SET ${campos.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, ...campos.map(c => mudancas[c])]
  );
  if (!rows[0]) return erro(res, 404, 'Nota não encontrada.');
  // Completou os dados à mão? Deixa de aparecer em "incompletas"
  await db.query(
    `UPDATE notas SET parse_status = 'completo' WHERE id = $1 AND chave IS NOT NULL AND emitente_nome IS NOT NULL
     AND data_emissao IS NOT NULL`, [id]);
  await db.auditar(ADMIN, 'editou', id, mudancas);
  res.json({ nota: rows[0] });
}));

app.post('/api/admin/notas/:id/excluir', rota(async (req, res) => {
  await db.query('UPDATE notas SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [Number(req.params.id) || 0]);
  await db.auditar(ADMIN, 'excluiu', Number(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/admin/notas/:id/restaurar', rota(async (req, res) => {
  await db.query('UPDATE notas SET deleted_at = NULL WHERE id = $1', [Number(req.params.id) || 0]);
  await db.auditar(ADMIN, 'restaurou', Number(req.params.id));
  res.json({ ok: true });
}));

// Lê de novo o PDF/XML guardado e preenche só os campos que estiverem vazios
app.post('/api/admin/notas/:id/reprocessar', rota(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const { rows: [nota] } = await db.query('SELECT * FROM notas WHERE id = $1', [id]);
  if (!nota) return erro(res, 404, 'Nota não encontrada.');
  const { rows: arquivos } = await db.query(
    "SELECT tipo, caminho FROM arquivos WHERE nota_id = $1 AND deleted_at IS NULL AND tipo IN ('nota_pdf','nota_xml') ORDER BY id", [id]);
  const ler = tipo => {
    const a = arquivos.find(x => x.tipo === tipo);
    return a ? fs.readFileSync(storage.caminhoAbsoluto(a.caminho)) : null;
  };
  const dados = await parse.analisar({ xmlBuffer: ler('nota_xml'), pdfBuffer: ler('nota_pdf'), chaveDigitada: nota.chave });
  const preencher = CAMPOS_NOTA.filter(c => !['origem_dados', 'parse_status'].includes(c) && nota[c] == null && dados[c] != null);
  const campos = [...preencher, 'origem_dados', 'parse_status'];
  const { rows } = await db.query(
    `UPDATE notas SET ${campos.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, ...campos.map(c => valorBanco(c, dados[c]))]
  );
  await db.auditar(ADMIN, 'reprocessou', id, { preenchidos: preencher });
  res.json({ nota: rows[0], preenchidos: preencher });
}));

app.post('/api/admin/notas/:id/arquivos', camposUpload, rota(async (req, res) => {
  const enviados = arquivosDaRequisicao(req);
  try {
    const id = Number(req.params.id) || 0;
    const { rows } = await db.query('SELECT id FROM notas WHERE id = $1', [id]);
    if (!rows[0]) return erro(res, 404, 'Nota não encontrada.');
    const { notaArquivos, anexos } = classificar(req);
    const cliente = await db.pool.connect();
    try {
      await salvarArquivos(cliente, id, [...notaArquivos, ...anexos], null);
    } finally {
      cliente.release();
    }
    await db.auditar(ADMIN, 'anexou', id, { arquivos: enviados.map(f => f.originalname) });
    res.json({ ok: true });
  } finally {
    storage.removerTmp(enviados);
  }
}));

app.delete('/api/admin/arquivos/:id', rota(async (req, res) => {
  const { rows } = await db.query(
    'UPDATE arquivos SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING nota_id, nome_original',
    [Number(req.params.id) || 0]);
  if (rows[0]) await db.auditar(ADMIN, 'removeu arquivo', rows[0].nota_id, { arquivo: rows[0].nome_original });
  res.json({ ok: true });
}));

app.post('/api/admin/arquivos/:id/restaurar', rota(async (req, res) => {
  const { rows } = await db.query('UPDATE arquivos SET deleted_at = NULL WHERE id = $1 RETURNING nota_id', [Number(req.params.id) || 0]);
  if (rows[0]) await db.auditar(ADMIN, 'restaurou arquivo', rows[0].nota_id);
  res.json({ ok: true });
}));

// ─── Etiquetas ───────────────────────────────────────
// GET para o navegador abrir o PDF direto numa aba (funciona também no iPhone)
//   /api/admin/etiquetas.pdf?ids=1,2,3&layout=4&marcar=1
app.get('/api/admin/etiquetas.pdf', rota(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 500);
  const layout = [4, 8, 16].includes(Number(req.query.layout)) ? Number(req.query.layout) : 4;
  if (!ids.length) return erro(res, 400, 'Selecione ao menos uma nota.');
  const { rows } = await db.query(
    `SELECT n.*, u.nome AS criado_por_nome FROM notas n LEFT JOIN usuarios u ON u.id = n.criado_por
     WHERE n.id = ANY($1::int[]) ORDER BY n.id`, [ids]);
  const pdf = await etiquetas.gerarPDF(rows.map(n => ({ ...n, url: linkNota(req, n.slug) })), layout);
  if (req.query.marcar === '1') {
    await db.query('UPDATE notas SET etiqueta_impressa_em = NOW() WHERE id = ANY($1::int[])', [ids]);
  }
  await db.auditar(ADMIN, 'gerou etiquetas', null, { ids, layout });
  res.type('application/pdf').set('Content-Disposition', `inline; filename="etiquetas-${layout}-por-folha.pdf"`).send(pdf);
}));

// ─── Exportação ──────────────────────────────────────
app.get('/api/admin/export.csv', rota(async (req, res) => {
  const { rows } = await db.query(
    `SELECT n.id, n.chave, n.numero, n.serie, n.emitente_nome, n.emitente_cnpj, n.data_emissao, n.valor_total,
            n.comentario, u.nome AS enviado_por, n.created_at, n.etiqueta_impressa_em, n.slug
     FROM notas n LEFT JOIN usuarios u ON u.id = n.criado_por WHERE n.deleted_at IS NULL ORDER BY n.id`);
  const cel = v => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cab = ['registro', 'chave', 'numero', 'serie', 'emitente', 'cnpj', 'emissao', 'valor', 'comentario', 'enviado_por', 'registrado_em', 'etiqueta_impressa_em', 'link'];
  const linhas = rows.map(r => [r.id, r.chave ? `'${r.chave}` : '', r.numero, r.serie, r.emitente_nome, r.emitente_cnpj,
    r.data_emissao, r.valor_total == null ? '' : String(r.valor_total).replace('.', ','), r.comentario, r.enviado_por,
    r.created_at, r.etiqueta_impressa_em, linkNota(req, r.slug)].map(cel).join(';'));
  res.type('text/csv; charset=utf-8').attachment('notas-fiscais.csv').send('﻿' + [cab.join(';'), ...linhas].join('\r\n'));
}));

// ─── Usuários (quem envia) ───────────────────────────
app.get('/api/admin/usuarios', rota(async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.*, (SELECT count(*)::int FROM notas n WHERE n.criado_por = u.id AND n.deleted_at IS NULL) AS qtd_notas
     FROM usuarios u ORDER BY u.nome`);
  res.json({ usuarios: rows });
}));

app.patch('/api/admin/usuarios/:id', rota(async (req, res) => {
  const bloqueado = !!req.body?.bloqueado;
  const { rows } = await db.query('UPDATE usuarios SET bloqueado = $2 WHERE id = $1 RETURNING nome', [Number(req.params.id) || 0, bloqueado]);
  if (rows[0]) await db.auditar(ADMIN, bloqueado ? 'bloqueou usuário' : 'desbloqueou usuário', null, { usuario: rows[0].nome });
  res.json({ ok: true });
}));

// =====================================================
// ERROS
// =====================================================
app.use('/api', (req, res) => erro(res, 404, 'Rota não encontrada.'));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Arquivo grande demais. O limite é ${MAX_FILE_MB} MB por arquivo.`
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Máximo de ${MAX_ANEXOS} fotos/vídeos por envio.`
      : 'Não foi possível receber o arquivo.';
    storage.removerTmp(arquivosDaRequisicao(req));
    return erro(res, 413, msg);
  }
  if (err.status && err.status < 500) return erro(res, err.status, err.message);
  console.error('❌', err);
  erro(res, 500, 'Erro no servidor. Tente de novo em instantes.');
});

// =====================================================
// INÍCIO
// =====================================================
async function iniciar() {
  const { banco, schema } = await db.iniciar();
  console.log(`✅ Banco pronto: "${banco}", tabelas no schema "${schema}"`);
  if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD não definido: o painel /admin ficará inacessível.');
  if (!process.env.PUBLIC_BASE_URL) console.warn('⚠️  PUBLIC_BASE_URL não definido: os links usarão o endereço de cada acesso.');
  app.listen(PORT, () => console.log(`🚀 Servidor na porta ${PORT}`));
}

if (require.main === module) {
  iniciar().catch(err => {
    console.error('❌ Falha ao iniciar:', err.message);
    process.exit(1);
  });
}

module.exports = { app, iniciar, normalizarSlug };
