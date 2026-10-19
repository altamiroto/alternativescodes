// Etiquetas em A4 (preto e branco), 4 / 8 / 16 por folha, com linhas de corte
//
// Por padrão a etiqueta traz só a CHAVE DE ACESSO (código de barras + números), o QR pequeno
// do sistema e a frase de consulta. Os demais blocos são opcionais (escolhidos na impressão):
//   numero      → NF-e nº, série, emissão e UF
//   fornecedor  → emitente e CNPJ
//   destinatario→ destinatário e CNPJ
//   valor       → valor total da nota
//   protocolo   → protocolo de autorização
//   produtos    → lista de produtos (quantidade e descrição)
//   observacao  → comentário de quem registrou
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
const CAMPOS = ['numero', 'fornecedor', 'destinatario', 'valor', 'protocolo', 'produtos', 'observacao'];

// Medidas de cada tamanho de etiqueta (mm e pontos)
const ESTILO = {
  4: {
    margem: 5, folga: 2.5, qr: 24, modulo: 0.3,
    titulo: 12, normal: 8.5, rotulo: 5.5, chave: 9, item: 7.5, consulta: 6.5, reg: 5,
    barras: 20, barrasSozinha: 30, barrasMin: 12, linhaBorda: 0.5,
  },
  8: {
    margem: 3.5, folga: 2, qr: 18, modulo: 0.3,
    titulo: 10, normal: 7.5, rotulo: 5, chave: 8, item: 6.5, consulta: 5.5, reg: 5,
    barras: 10, barrasSozinha: 17, barrasMin: 8, linhaBorda: 0.4,
  },
  16: {
    margem: 2.5, folga: 1.8, qr: 14, modulo: 0.25,
    titulo: 8.5, normal: 6.5, rotulo: 4.5, chave: 6.3, item: 6, consulta: 0, reg: 5,
    barras: 7.5, barrasSozinha: 11, barrasMin: 6, linhaBorda: 0.35,
  },
};

// ─── Formatação ──────────────────────────────────────
const dataBR = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const registro = id => `#${String(id).padStart(4, '0')}`;
const urlSemProtocolo = url => url.replace(/^https?:\/\//, '');
const moeda = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const tipoDoc = n => (n.modelo === '65' ? 'NFC-e' : n.chave ? 'NF-e' : 'NF');
const numeroSerie = n => (n.numero ? `${tipoDoc(n)} Nº ${String(n.numero).padStart(9, '0').replace(/(\d{3})(?=\d)/g, '$1.')}` : 'Nota fiscal');
const docPessoa = d => (d && d.length === 14 ? `CNPJ ${formatarCNPJ(d)}` : d && d.length === 11 ? `CPF ${d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}` : d || '');
const qtdBR = q => (q == null ? '' : Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const linhaItem = i => `${[qtdBR(i.quantidade), i.unidade].filter(Boolean).join(' ')}  ${i.descricao || ''}`.trim();
const itensDe = n => (Array.isArray(n.itens) ? n.itens.filter(i => i && i.descricao) : []);
const CONSULTA = 'Consulte a autenticidade em www.nfe.fazenda.gov.br/portal com a chave de acesso.';

// Aceita "numero,produtos" ou ['numero', 'produtos']; ignora o que não existe
function lerCampos(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return new Set(lista.map(c => String(c).trim()).filter(c => CAMPOS.includes(c)));
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

// ─── Primitivas de desenho (documento em mm, fontes em pontos) ─
function texto(doc, str, x, y, largura, { tamanho = 9, fonte = 'Helvetica', alinhar = 'left' } = {}) {
  doc.font(fonte).fontSize(tamanho / MM);
  let s = String(str || '');
  if (doc.widthOfString(s) > largura) {
    while (s.length > 1 && doc.widthOfString(s + '…') > largura) s = s.slice(0, -1);
    s = s.trimEnd() + '…';
  }
  doc.text(s, x, y, { width: largura, align: alinhar, lineBreak: false });
}

// Texto em várias linhas, cortado com "…" se passar da altura; devolve a altura usada
function paragrafo(doc, str, x, y, largura, altura, tamanho, fonte = 'Helvetica') {
  if (!str || altura <= 0) return 0;
  const s = String(str).replace(/\s+/g, ' ').trim();
  doc.font(fonte).fontSize(tamanho / MM);
  const usada = Math.min(altura, doc.heightOfString(s, { width: largura }));
  doc.text(s, x, y, { width: largura, height: altura, ellipsis: true });
  return usada;
}

const alturaLinha = pt => pt * 0.42; // mm por linha de texto
const linhaH = (doc, x, y, w) => doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.25).stroke('#000');

function desenharBarras(doc, barras, x, y, larguraMax, altura, modulo) {
  const largura = Math.min(barras.modulos * modulo, larguraMax);
  doc.image(barras.png, x + (larguraMax - largura) / 2, y, { width: largura, height: altura });
}

// ─── Etiqueta ────────────────────────────────────────
// Os blocos são desenhados de cima para baixo; um bloco que não cabe é deixado de fora.
// Embaixo à direita fica o QR do sistema; o conteúdo que desce até a altura do QR estreita.
function desenharEtiqueta(doc, n, img, x, y, w, h, tamanho, campos) {
  const e = ESTILO[tamanho];
  const X = x + e.margem, L = w - 2 * e.margem;
  const I = X + e.folga, IL = L - 2 * e.folga;
  const topo = y + e.margem;
  const base = y + h - e.margem - e.folga;          // limite de baixo do conteúdo
  const inicioQR = base - e.qr;
  const rodapeTexto = e.consulta ? 7.5 : 2.6;       // consulta + nº do registro, à esquerda do QR
  const limite = base - rodapeTexto - 0.5;           // conteúdo não passa daqui
  const largura = (yTopo, altura) => (yTopo + altura > inicioQR - 0.8 ? IL - e.qr - 2.5 : IL);
  let Y = topo + e.folga;

  // A chave é obrigatória: os blocos de cima só entram se ainda sobrar espaço para ela
  const reservaChave = n.chave
    ? alturaLinha(e.rotulo) + 0.6 + e.barrasMin + 1 + 2 * alturaLinha(e.chave) + 1
    : alturaLinha(e.rotulo) + alturaLinha(e.normal) + 1.5;
  const cabeAntes = altura => Y + altura + reservaChave <= limite;
  const cabe = altura => Y + altura <= limite;
  const separador = () => { linhaH(doc, X, Y, L); Y += 1.6; };
  const rot = str => { texto(doc, str.toUpperCase(), I, Y, largura(Y, 2.4), { tamanho: e.rotulo, fonte: 'Helvetica-Bold' }); Y += alturaLinha(e.rotulo) + 0.6; };

  // 1) Nº, série e emissão
  if (campos.has('numero') && cabeAntes(alturaLinha(e.titulo) + alturaLinha(e.normal) + 2)) {
    const lin = largura(Y, 6);
    texto(doc, numeroSerie(n), I, Y, lin * 0.64, { tamanho: e.titulo, fonte: 'Helvetica-Bold' });
    texto(doc, n.serie ? `Série ${n.serie}` : '', I + lin * 0.64, Y + 0.4, lin * 0.36, { tamanho: e.titulo - 2, fonte: 'Helvetica-Bold', alinhar: 'right' });
    Y += alturaLinha(e.titulo) + 0.8;
    const sub = [n.data_emissao ? `Emissão ${dataBR(n.data_emissao)}` : '', n.uf ? `UF ${n.uf}` : ''].filter(Boolean).join('   ');
    if (sub) { texto(doc, sub, I, Y, largura(Y, 3), { tamanho: e.normal }); Y += alturaLinha(e.normal) + 0.6; }
    separador();
  }

  // 2) Fornecedor
  if (campos.has('fornecedor') && (n.emitente_nome || n.emitente_cnpj) && cabeAntes(alturaLinha(e.rotulo) + 2 * alturaLinha(e.normal) + 3)) {
    rot('Emitente');
    if (n.emitente_nome) {
      const usada = paragrafo(doc, n.emitente_nome, I, Y, largura(Y, 8), Math.min(alturaLinha(e.normal + 1) * 2 + 0.3, limite - Y), e.normal + 1, 'Helvetica-Bold');
      Y += usada + 0.3;
    }
    if (n.emitente_cnpj) { texto(doc, docPessoa(n.emitente_cnpj), I, Y, largura(Y, 3), { tamanho: e.normal }); Y += alturaLinha(e.normal) + 0.6; }
    separador();
  }

  // 3) Destinatário
  if (campos.has('destinatario') && (n.destinatario_nome || n.destinatario_cnpj) && cabeAntes(alturaLinha(e.rotulo) + 2 * alturaLinha(e.normal) + 3)) {
    rot('Destinatário');
    if (n.destinatario_nome) { texto(doc, n.destinatario_nome, I, Y, largura(Y, 3), { tamanho: e.normal, fonte: 'Helvetica-Bold' }); Y += alturaLinha(e.normal) + 0.4; }
    if (n.destinatario_cnpj) { texto(doc, docPessoa(n.destinatario_cnpj), I, Y, largura(Y, 3), { tamanho: e.normal }); Y += alturaLinha(e.normal) + 0.6; }
    separador();
  }

  // 4) Valor
  if (campos.has('valor') && n.valor_total != null && cabeAntes(alturaLinha(e.titulo) + 2.5)) {
    const lin = largura(Y, 5);
    texto(doc, 'VALOR TOTAL DA NOTA', I, Y + 1, lin / 2, { tamanho: e.rotulo, fonte: 'Helvetica-Bold' });
    texto(doc, moeda(n.valor_total), I + lin / 2, Y, lin / 2, { tamanho: e.titulo, fonte: 'Helvetica-Bold', alinhar: 'right' });
    Y += alturaLinha(e.titulo) + 1;
    separador();
  }

  // 5) Chave de acesso (sempre). Sozinha, fica maior.
  const extras = [...campos].some(c => c !== 'observacao' || n.comentario);
  if (n.chave) {
    const espacoChave = alturaLinha(e.chave) + 1;
    const disponivel = limite - Y - alturaLinha(e.rotulo) - 0.6 - espacoChave - 1;
    const alturaBarras = Math.max(5, Math.min(extras ? e.barras : e.barrasSozinha, disponivel));
    rot('Chave de acesso');
    const larguraBarras = largura(Y, alturaBarras + espacoChave);
    desenharBarras(doc, img.barras, I, Y, larguraBarras, alturaBarras, e.modulo);
    Y += alturaBarras + 1;
    const grupos = formatarChave(n.chave);
    doc.font('Helvetica-Bold').fontSize(e.chave / MM);
    if (doc.widthOfString(grupos) <= larguraBarras) {
      texto(doc, grupos, I, Y, larguraBarras, { tamanho: e.chave, fonte: 'Helvetica-Bold', alinhar: 'center' });
      Y += espacoChave;
    } else { // não cabe numa linha: quebra em duas (6 + 5 grupos)
      const g = grupos.split(' ');
      texto(doc, g.slice(0, 6).join(' '), I, Y, larguraBarras, { tamanho: e.chave, fonte: 'Helvetica-Bold', alinhar: 'center' });
      texto(doc, g.slice(6).join(' '), I, Y + alturaLinha(e.chave), larguraBarras, { tamanho: e.chave, fonte: 'Helvetica-Bold', alinhar: 'center' });
      Y += espacoChave + alturaLinha(e.chave);
    }
  } else {
    rot('Chave de acesso');
    texto(doc, 'Não informada', I, Y, largura(Y, 3), { tamanho: e.normal }); Y += alturaLinha(e.normal) + 0.8;
  }

  // 6) Protocolo
  if (campos.has('protocolo') && n.protocolo && cabe(alturaLinha(e.normal) + 1)) {
    texto(doc, `Protocolo: ${n.protocolo}`, I, Y, largura(Y, 3), { tamanho: e.normal - 1 }); Y += alturaLinha(e.normal - 1) + 0.6;
  }

  // 7) Produtos (ocupa o espaço que sobrar, guardando um pouco para a observação)
  const itens = itensDe(n);
  if (campos.has('produtos') && itens.length && cabe(alturaLinha(e.item) * 2 + 3)) {
    separador();
    rot(`Produtos (${itens.length})`);
    const reserva = campos.has('observacao') && n.comentario ? alturaLinha(e.item) * 2 + 2 : 0;
    const passo = alturaLinha(e.item);
    const cabem = Math.max(1, Math.floor((limite - Y - reserva) / passo));
    const mostrar = itens.length > cabem ? itens.slice(0, cabem - 1) : itens;
    for (const i of mostrar) { texto(doc, linhaItem(i), I, Y, largura(Y, passo), { tamanho: e.item }); Y += passo; }
    if (mostrar.length < itens.length) {
      const resto = itens.length - mostrar.length;
      texto(doc, `+ ${resto} ${resto > 1 ? 'itens' : 'item'} (ver nota completa pelo QR)`, I, Y, largura(Y, passo), { tamanho: e.item, fonte: 'Helvetica-Oblique' });
      Y += passo;
    }
    Y += 0.6;
  }

  // 8) Observação
  if (campos.has('observacao') && n.comentario && cabe(alturaLinha(e.item) + 1)) {
    Y += 0.6;
    Y += paragrafo(doc, `Obs.: ${n.comentario}`, I, Y, largura(Y, limite - Y), limite - Y, e.item);
  }

  // Rodapé: consulta + nº do registro à esquerda, QR do sistema à direita (discreto)
  if (e.consulta && n.chave) paragrafo(doc, CONSULTA, I, base - 7, IL - e.qr - 3, 4.5, e.consulta);
  texto(doc, `Reg. ${registro(n.id)} · ${urlSemProtocolo(n.url)}`, I, base - 2.2, IL - e.qr - 2.5, { tamanho: e.reg });
  doc.image(img.qr, I + IL - e.qr, inicioQR, { width: e.qr, height: e.qr });
  doc.rect(X, topo, L, h - 2 * e.margem).lineWidth(e.linhaBorda).stroke('#000');
}

function linhasDeCorte(doc, { cols, rows }) {
  const w = A4.w / cols, h = A4.h / rows;
  doc.save().lineWidth(0.3).dash(2, { space: 2 }).strokeColor('#000');
  for (let c = 1; c < cols; c++) doc.moveTo(c * w, 0).lineTo(c * w, A4.h).stroke();
  for (let r = 1; r < rows; r++) doc.moveTo(0, r * h).lineTo(A4.w, r * h).stroke();
  doc.restore();
}

// notas: [{ id, url, chave, numero, serie, modelo, uf, emitente_nome, emitente_cnpj, destinatario_nome,
//           destinatario_cnpj, data_emissao, valor_total, protocolo, itens, comentario }]
// campos: quais blocos opcionais entram (ver topo do arquivo). Vazio = só a chave.
async function gerarPDF(notas, quantidadePorFolha = 4, campos = []) {
  const tamanho = LAYOUTS[quantidadePorFolha] ? Number(quantidadePorFolha) : 4;
  const layout = LAYOUTS[tamanho];
  const porFolha = layout.cols * layout.rows;
  const w = A4.w / layout.cols, h = A4.h / layout.rows;
  const selecionados = lerCampos(campos);

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
    desenharEtiqueta(doc, n, imagens[i], col * w, row * h, w, h, tamanho, selecionados);
    doc.restore();
  });

  doc.end();
  await fim;
  return Buffer.concat(partes);
}

module.exports = { gerarPDF, LAYOUTS, CAMPOS, lerCampos };
