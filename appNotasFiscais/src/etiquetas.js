// Etiquetas em A4 (preto e branco), 4 / 8 / 16 por folha, com linhas de corte
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const { formatarChave, formatarCNPJ } = require('./chave');

const MM = 72 / 25.4;
const A4 = { w: 210, h: 297 };
const LAYOUTS = {
  4: { cols: 2, rows: 2 },
  8: { cols: 2, rows: 4 },
  16: { cols: 2, rows: 8 },
};
const MODULO_BARRAS_MM = 0.3; // largura de cada barra fina do Code 128 impresso (padrão)

// ─── Formatação ──────────────────────────────────────
const dataBR = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const registro = id => `#${String(id).padStart(4, '0')}`;

function urlSemProtocolo(url) {
  return url.replace(/^https?:\/\//, '');
}

// ─── Imagens (QR e código de barras) ─────────────────
async function gerarQR(texto) {
  return bwipjs.toBuffer({ bcid: 'qrcode', text: texto, eclevel: 'M', scale: 8 });
}

async function gerarBarras(chave) {
  const escala = 3;
  const png = await bwipjs.toBuffer({ bcid: 'code128', text: chave, scale: escala, height: 10, includetext: false });
  const largura = png.readUInt32BE(16); // cabeçalho IHDR do PNG
  return { png, modulos: largura / escala };
}

// ─── Desenho ─────────────────────────────────────────
// Estilo etiqueta de transportadora: dados da NF-e em destaque, em caixas (sem o valor:
// quem precisar abre o PDF ou consulta pela chave);
// o QR do sistema fica pequeno, no canto, sem chamar atenção.
function texto(doc, str, x, y, largura, { tamanho = 9, fonte = 'Helvetica', alinhar = 'left' } = {}) {
  doc.font(fonte).fontSize(tamanho / MM); // tamanho em pontos; o documento está em mm
  let s = String(str || '');
  if (doc.widthOfString(s) > largura) {
    while (s.length > 1 && doc.widthOfString(s + '…') > largura) s = s.slice(0, -1);
    s = s.trimEnd() + '…';
  }
  doc.text(s, x, y, { width: largura, align: alinhar, lineBreak: false });
}

// Texto em várias linhas, cortado com "…" se passar da altura
function paragrafo(doc, str, x, y, largura, altura, tamanho, fonte = 'Helvetica') {
  if (!str) return;
  doc.font(fonte).fontSize(tamanho / MM);
  doc.text(String(str).replace(/\s+/g, ' ').trim(), x, y, { width: largura, height: altura, ellipsis: true });
}

const rotulo = (doc, str, x, y, largura) => texto(doc, str.toUpperCase(), x, y, largura, { tamanho: 5.5, fonte: 'Helvetica-Bold' });
const linhaH = (doc, x, y, w) => doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.25).stroke('#000');

function desenharBarras(doc, barras, x, y, larguraMax, altura, modulo = MODULO_BARRAS_MM) {
  const largura = Math.min(barras.modulos * modulo, larguraMax);
  doc.image(barras.png, x + (larguraMax - largura) / 2, y, { width: largura, height: altura });
}

const tipoDoc = n => (n.modelo === '65' ? 'NFC-e' : n.chave ? 'NF-e' : 'NF');
const numeroSerie = n => (n.numero ? `${tipoDoc(n)} Nº ${String(n.numero).padStart(9, '0').replace(/(\d{3})(?=\d)/g, '$1.')}` : 'Nota fiscal');
const docPessoa = d => (d && d.length === 14 ? `CNPJ ${formatarCNPJ(d)}` : d && d.length === 11 ? `CPF ${d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}` : d || '');
// "2 UN  PARAFUSADEIRA ELÉTRICA 12V" (sem valores, de propósito)
const qtdBR = q => (q == null ? '' : Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const linhaItem = i => `${[qtdBR(i.quantidade), i.unidade].filter(Boolean).join(' ')}  ${i.descricao || ''}`.trim();
const itensDe = n => (Array.isArray(n.itens) ? n.itens.filter(i => i && i.descricao) : []);

// Lista de produtos em linhas, até caber; o que sobrar vira "+ N itens"
function listaItens(doc, itens, x, y, largura, alturaMax, tamanho) {
  const passo = tamanho * 0.42; // altura da linha em mm
  const cabem = Math.max(1, Math.floor(alturaMax / passo));
  const mostrar = itens.length > cabem ? itens.slice(0, cabem - 1) : itens;
  mostrar.forEach((i, k) => texto(doc, linhaItem(i), x, y + k * passo, largura, { tamanho }));
  if (mostrar.length < itens.length) {
    texto(doc, `+ ${itens.length - mostrar.length} ${itens.length - mostrar.length > 1 ? 'itens' : 'item'} (ver nota completa pelo QR)`,
      x, y + mostrar.length * passo, largura, { tamanho, fonte: 'Helvetica-Oblique' });
    return (mostrar.length + 1) * passo;
  }
  return mostrar.length * passo;
}

const CONSULTA = 'Consulte a autenticidade em www.nfe.fazenda.gov.br/portal com a chave de acesso.';

// Rodapé discreto do sistema: QR pequeno + nº do registro + link em letra miúda
function marcaSistema(doc, n, img, x, y, w, h, qr) {
  doc.image(img.qr, x + w - qr, y + h - qr, { width: qr, height: qr });
  texto(doc, `Reg. ${registro(n.id)} · ${urlSemProtocolo(n.url)}`, x, y + h - 2.2, w - qr - 2, { tamanho: 5 });
}

// Etiqueta grande: 105 × 148,5 mm
function etiqueta4(doc, n, img, x, y, w, h) {
  const m = 5, X = x + m, L = w - 2 * m, p = 2.5, I = X + p, IL = L - 2 * p;
  const topo = y + m;
  let Y = topo + p;

  texto(doc, numeroSerie(n), I, Y, IL * 0.62, { tamanho: 12, fonte: 'Helvetica-Bold' });
  texto(doc, n.serie ? `Série ${n.serie}` : '', I + IL * 0.62, Y + 0.6, IL * 0.38, { tamanho: 10, fonte: 'Helvetica-Bold', alinhar: 'right' });
  Y += 5.5;
  texto(doc, [n.data_emissao ? `Emissão ${dataBR(n.data_emissao)}` : '', n.uf ? `UF ${n.uf}` : ''].filter(Boolean).join('   '), I, Y, IL, { tamanho: 8 });
  Y += 4.5; linhaH(doc, X, Y, L); Y += 1.8;

  rotulo(doc, 'Emitente', I, Y, IL); Y += 2.6;
  paragrafo(doc, n.emitente_nome || 'Não identificado', I, Y, IL, 8, 9.5, 'Helvetica-Bold');
  Y += doc.heightOfString(String(n.emitente_nome || 'x'), { width: IL }) > 4.5 ? 8 : 4.2;
  texto(doc, docPessoa(n.emitente_cnpj), I, Y, IL, { tamanho: 8.5 });
  Y += 4.5; linhaH(doc, X, Y, L); Y += 1.8;

  if (n.destinatario_nome || n.destinatario_cnpj) {
    rotulo(doc, 'Destinatário', I, Y, IL); Y += 2.6;
    texto(doc, n.destinatario_nome, I, Y, IL, { tamanho: 8.5, fonte: 'Helvetica-Bold' }); Y += 3.8;
    texto(doc, docPessoa(n.destinatario_cnpj), I, Y, IL, { tamanho: 8 });
    Y += 4.3; linhaH(doc, X, Y, L); Y += 1.8;
  }

  const itens = itensDe(n);
  rotulo(doc, 'Chave de acesso', I, Y, IL); Y += 3;
  if (n.chave) {
    const alturaBarras = itens.length ? 13 : 20; // com produtos, cede espaço para a lista
    desenharBarras(doc, img.barras, I, Y, IL, alturaBarras);
    Y += alturaBarras + 1.5;
    texto(doc, formatarChave(n.chave), I, Y, IL, { tamanho: 9, fonte: 'Helvetica-Bold', alinhar: 'center' });
    Y += 4.5;
  } else {
    texto(doc, 'Não informada', I, Y, IL, { tamanho: 9 });
    Y += 4.5;
  }
  if (n.protocolo) {
    rotulo(doc, 'Protocolo de autorização de uso', I, Y, IL); Y += 2.6;
    texto(doc, n.protocolo, I, Y, IL, { tamanho: 8.5 }); Y += 4.2;
  }
  linhaH(doc, X, Y, L); Y += 1.8;

  const qr = 24; // médio: legível numa foto, sem dominar a etiqueta
  const fimConteudo = y + h - m - p - qr - 1;
  if (itens.length && Y < fimConteudo - 6) {
    const reservaObs = n.comentario ? 9 : 0;
    rotulo(doc, `Produtos (${itens.length})`, I, Y, IL); Y += 2.8;
    Y += listaItens(doc, itens, I, Y, IL, fimConteudo - Y - reservaObs, 7.5) + 1;
    linhaH(doc, X, Y, L); Y += 1.8;
  }
  if (n.comentario && Y < fimConteudo - 4) {
    rotulo(doc, 'Observação', I, Y, IL); Y += 2.6;
    paragrafo(doc, n.comentario, I, Y, IL, fimConteudo - Y, 8);
  }
  const base = y + h - m - p;
  if (n.chave) paragrafo(doc, CONSULTA, I, base - qr, IL - qr - 4, 8, 6.5);
  marcaSistema(doc, n, img, I, base - qr, IL, qr, qr);
  doc.rect(X, topo, L, h - 2 * m).lineWidth(0.5).stroke('#000');
}

// Etiqueta média: 105 × 74,25 mm
function etiqueta8(doc, n, img, x, y, w, h) {
  const m = 3.5, X = x + m, L = w - 2 * m, p = 2, I = X + p, IL = L - 2 * p;
  const topo = y + m;
  let Y = topo + p;

  texto(doc, `${numeroSerie(n)}${n.serie ? ` · Série ${n.serie}` : ''}`, I, Y, IL * 0.66, { tamanho: 10, fonte: 'Helvetica-Bold' });
  texto(doc, n.data_emissao ? `Emissão ${dataBR(n.data_emissao)}` : '', I + IL * 0.66, Y + 0.6, IL * 0.34, { tamanho: 7.5, alinhar: 'right' });
  Y += 4.8; linhaH(doc, X, Y, L); Y += 1.3;

  rotulo(doc, 'Emitente', I, Y, IL);
  Y += 2.3;
  texto(doc, n.emitente_nome || 'Não identificado', I, Y, IL, { tamanho: 8.5, fonte: 'Helvetica-Bold' });
  Y += 3.6;
  texto(doc, docPessoa(n.emitente_cnpj), I, Y, IL, { tamanho: 7.5 });
  Y += 3.6;
  if (n.destinatario_nome) {
    texto(doc, `Dest.: ${n.destinatario_nome}`, I, Y, IL, { tamanho: 7 });
    Y += 3.3;
  }
  linhaH(doc, X, Y, L); Y += 1.3;

  rotulo(doc, 'Chave de acesso', I, Y, IL); Y += 2.4;
  if (n.chave) {
    desenharBarras(doc, img.barras, I, Y, IL, 10);
    Y += 11;
    texto(doc, formatarChave(n.chave), I, Y, IL, { tamanho: 8, fonte: 'Helvetica-Bold', alinhar: 'center' });
    Y += 3.8;
  } else {
    texto(doc, 'Não informada', I, Y, IL, { tamanho: 8 });
    Y += 3.8;
  }
  if (n.protocolo) { texto(doc, `Protocolo: ${n.protocolo}`, I, Y, IL, { tamanho: 6.5 }); Y += 3; }

  const base = y + h - m - p;
  const qr = 18;
  const itens = itensDe(n);
  if (itens.length && base - 8 - Y > 3) {
    const resumo = `Produtos: ${itens.map(linhaItem).join(' · ')}`;
    const altura = Math.min(n.comentario ? 5.6 : 8.4, base - 8 - Y);
    paragrafo(doc, resumo, I, Y + 0.5, IL - qr - 3, altura, 6.5);
    Y += Math.min(altura, doc.heightOfString(resumo, { width: IL - qr - 3 })) + 0.8;
  }
  if (n.comentario && base - 8 - Y > 3) paragrafo(doc, `Obs.: ${n.comentario}`, I, Y + 0.5, IL - qr - 3, base - 8 - Y, 6.5);
  if (n.chave) paragrafo(doc, CONSULTA, I, base - 7, IL - qr - 3, 4, 5.5);
  marcaSistema(doc, n, img, I, base - qr, IL, qr, qr);
  doc.rect(X, topo, L, h - 2 * m).lineWidth(0.4).stroke('#000');
}

// Etiqueta pequena: 105 × 37,1 mm (barras mais finas, 0,25 mm)
function etiqueta16(doc, n, img, x, y, w, h) {
  const m = 2.5, X = x + m, L = w - 2 * m, p = 1.8, I = X + p, IL = L - 2 * p;
  const topo = y + m;
  const qr = 14;
  let Y = topo + p;

  texto(doc, `${numeroSerie(n)}${n.serie ? ` · Série ${n.serie}` : ''}`, I, Y, IL * 0.62, { tamanho: 8.5, fonte: 'Helvetica-Bold' });
  texto(doc, n.data_emissao ? `Emissão ${dataBR(n.data_emissao)}` : '', I + IL * 0.62, Y + 0.4, IL * 0.38, { tamanho: 7, alinhar: 'right' });
  Y += 3.6;
  texto(doc, n.emitente_nome || 'Emitente não identificado', I, Y, IL, { tamanho: 7, fonte: 'Helvetica-Bold' });
  Y += 3;
  texto(doc, docPessoa(n.emitente_cnpj), I, Y, IL, { tamanho: 6.5 });
  Y += 3;
  if (n.chave) {
    desenharBarras(doc, img.barras, I, Y, IL - qr - 2, 7.5, 0.25);
    Y += 8.2;
    texto(doc, formatarChave(n.chave), I, Y, IL - qr - 2, { tamanho: 6.3, fonte: 'Helvetica-Bold', alinhar: 'center' });
  } else {
    texto(doc, 'Chave de acesso não informada', I, Y + 2, IL - qr - 2, { tamanho: 7 });
  }
  doc.image(img.qr, I + IL - qr, topo + h - 2 * m - p - qr, { width: qr, height: qr });
  texto(doc, registro(n.id), I + IL - qr - 10, topo + h - 2 * m - p - 2, 8.5, { tamanho: 5, alinhar: 'right' });
  doc.rect(X, topo, L, h - 2 * m).lineWidth(0.35).stroke('#000');
}

const DESENHAR = { 4: etiqueta4, 8: etiqueta8, 16: etiqueta16 };

function linhasDeCorte(doc, { cols, rows }) {
  const w = A4.w / cols, h = A4.h / rows;
  doc.save().lineWidth(0.3).dash(2, { space: 2 }).strokeColor('#000');
  for (let c = 1; c < cols; c++) doc.moveTo(c * w, 0).lineTo(c * w, A4.h).stroke();
  for (let r = 1; r < rows; r++) doc.moveTo(0, r * h).lineTo(A4.w, r * h).stroke();
  doc.restore();
}

// notas: [{ id, slug, url, chave, numero, serie, modelo, emitente_nome, emitente_cnpj,
//           data_emissao, protocolo, comentario, created_at }]
async function gerarPDF(notas, quantidadePorFolha = 4) {
  const layout = LAYOUTS[quantidadePorFolha] || LAYOUTS[4];
  const porFolha = layout.cols * layout.rows;
  const desenhar = DESENHAR[porFolha];
  const w = A4.w / layout.cols, h = A4.h / layout.rows;

  const imagens = await Promise.all(notas.map(async n => ({
    qr: await gerarQR(n.url),
    barras: n.chave ? await gerarBarras(n.chave) : null,
  })));

  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'Etiquetas de notas fiscais' } });
  const partes = [];
  doc.on('data', b => partes.push(b));
  const fim = new Promise(resolve => doc.on('end', resolve));

  notas.forEach((n, i) => {
    const pos = i % porFolha;
    if (pos === 0) {
      doc.addPage();
      doc.scale(MM); // daqui em diante tudo em milímetros
      linhasDeCorte(doc, layout);
    }
    const col = pos % layout.cols, row = Math.floor(pos / layout.cols);
    doc.save();
    desenhar(doc, n, imagens[i], col * w, row * h, w, h);
    doc.restore();
  });

  doc.end();
  await fim;
  return Buffer.concat(partes);
}

module.exports = { gerarPDF, LAYOUTS };
