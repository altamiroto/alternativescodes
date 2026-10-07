// Sessões por cookie assinado (HMAC). Sem estado no servidor.
//   nf_usuario → quem está enviando (cadastro com nome + e-mail, vale 2 anos)
//   nf_admin   → sessão do administrador (vale 7 dias)
const crypto = require('crypto');

let SEGREDO = process.env.SESSION_SECRET;
if (!SEGREDO) {
  SEGREDO = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  SESSION_SECRET não definido: sessões serão perdidas a cada reinício.');
}

const DOIS_ANOS = 2 * 365 * 24 * 3600 * 1000;
const SETE_DIAS = 7 * 24 * 3600 * 1000;

function assinar(valor) {
  const sig = crypto.createHmac('sha256', SEGREDO).update(valor).digest('base64url');
  return `${valor}.${sig}`;
}

function verificar(assinado) {
  if (!assinado) return null;
  const i = assinado.lastIndexOf('.');
  if (i < 1) return null;
  const valor = assinado.slice(0, i);
  const esperado = Buffer.from(assinar(valor));
  const recebido = Buffer.from(assinado);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  return valor;
}

function lerCookies(req) {
  const saida = {};
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) saida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return saida;
}

function definirCookie(req, res, nome, valor, maxAge) {
  res.cookie(nome, valor, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge,
    path: '/',
  });
}

// ─── Usuário (quem envia) ────────────────────────────
function entrarUsuario(req, res, usuarioId) {
  definirCookie(req, res, 'nf_usuario', assinar(`u${usuarioId}`), DOIS_ANOS);
}

function usuarioId(req) {
  const v = verificar(lerCookies(req).nf_usuario);
  return v && /^u\d+$/.test(v) ? Number(v.slice(1)) : null;
}

// ─── Admin ───────────────────────────────────────────
function senhaConfere(usuario, senha) {
  const u = process.env.ADMIN_USER || 'admin';
  const s = process.env.ADMIN_PASSWORD;
  if (!s) return false;
  const a = crypto.createHash('sha256').update(`${usuario}\n${senha}`).digest();
  const b = crypto.createHash('sha256').update(`${u}\n${s}`).digest();
  return crypto.timingSafeEqual(a, b);
}

function entrarAdmin(req, res) {
  definirCookie(req, res, 'nf_admin', assinar(`a${Date.now() + SETE_DIAS}`), SETE_DIAS);
}

function sairAdmin(req, res) {
  res.clearCookie('nf_admin', { path: '/' });
}

function ehAdmin(req) {
  const v = verificar(lerCookies(req).nf_admin);
  return !!v && /^a\d+$/.test(v) && Number(v.slice(1)) > Date.now();
}

function exigirAdmin(req, res, next) {
  if (!ehAdmin(req)) return res.status(401).json({ erro: 'Faça login como administrador.' });
  next();
}

module.exports = { entrarUsuario, usuarioId, senhaConfere, entrarAdmin, sairAdmin, ehAdmin, exigirAdmin };
