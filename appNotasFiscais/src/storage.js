// Arquivos enviados: ficam em DATA_DIR/uploads/AAAA/MM/<nota_id>/<aleatorio>.<ext>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Identifica o tipo real pelo conteúdo (não confia na extensão enviada)
function detectarTipo(cabecalho, nomeOriginal) {
  const b = cabecalho;
  const ascii = (ini, fim) => b.slice(ini, fim).toString('latin1');
  if (ascii(0, 4) === '%PDF') return { ext: 'pdf', mime: 'application/pdf', inline: true };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg', inline: true };
  if (ascii(1, 4) === 'PNG') return { ext: 'png', mime: 'image/png', inline: true };
  if (ascii(0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif', inline: true };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp', inline: true };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', mime: 'video/webm', inline: true };
  if (ascii(4, 8) === 'ftyp') {
    const marca = ascii(8, 12);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(marca)) return { ext: 'heic', mime: 'image/heic', inline: false };
    if (marca === 'avif') return { ext: 'avif', mime: 'image/avif', inline: true };
    if (marca === 'qt  ') return { ext: 'mov', mime: 'video/quicktime', inline: true };
    if (marca.startsWith('3gp')) return { ext: '3gp', mime: 'video/3gpp', inline: true };
    return { ext: 'mp4', mime: 'video/mp4', inline: true };
  }
  const texto = b.toString('utf8').replace(/^﻿/, '').trimStart();
  if (texto.startsWith('<') && /nfeProc|<NFe|infNFe|<\?xml/i.test(texto)) return { ext: 'xml', mime: 'application/xml', inline: false };
  // Outros tipos: guardados como download
  const ext = (path.extname(nomeOriginal || '').slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin').slice(0, 8);
  return { ext, mime: 'application/octet-stream', inline: false };
}

function lerCabecalho(arquivoTmp) {
  const fd = fs.openSync(arquivoTmp, 'r');
  try {
    const buf = Buffer.alloc(512);
    const n = fs.readSync(fd, buf, 0, 512, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function hashArquivo(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
}

// Move o arquivo temporário do multer para a pasta definitiva da nota
function guardar(arquivoTmp, notaId, ext) {
  const agora = new Date();
  const relDir = path.join(String(agora.getFullYear()), String(agora.getMonth() + 1).padStart(2, '0'), String(notaId));
  fs.mkdirSync(path.join(UPLOADS_DIR, relDir), { recursive: true });
  const rel = path.join(relDir, `${crypto.randomUUID()}.${ext}`);
  try {
    fs.renameSync(arquivoTmp, path.join(UPLOADS_DIR, rel));
  } catch {
    fs.copyFileSync(arquivoTmp, path.join(UPLOADS_DIR, rel));
    fs.unlinkSync(arquivoTmp);
  }
  return rel;
}

function caminhoAbsoluto(rel) {
  const abs = path.resolve(UPLOADS_DIR, rel);
  if (!abs.startsWith(UPLOADS_DIR + path.sep)) throw new Error('Caminho inválido');
  return abs;
}

function removerTmp(arquivos) {
  for (const f of arquivos || []) fs.rm(f.path, { force: true }, () => {});
}

module.exports = { DATA_DIR, UPLOADS_DIR, TMP_DIR, detectarTipo, lerCabecalho, hashArquivo, guardar, caminhoAbsoluto, removerTmp };
