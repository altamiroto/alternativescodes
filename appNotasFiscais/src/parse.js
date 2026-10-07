// Leitura de dados da nota: XML (exato) → texto do PDF (melhor esforço) → só a chave
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const chave = require('./chave');

// Texto para busca: minúsculo, sem acentos, espaços simples
function textoBusca(...partes) {
  return partes.flat(Infinity).filter(Boolean).join(' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\s+/g, ' ').trim().slice(0, 100000) || null;
}

const lista = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

// ─── XML da NF-e ─────────────────────────────────────
function lerXML(buffer) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true });
  const xml = parser.parse(buffer.toString('utf8'));
  const nfe = xml?.nfeProc?.NFe || xml?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) return null;

  const idChave = String(inf['@Id'] || '').replace(/^NFe/, '') || xml?.nfeProc?.protNFe?.infProt?.chNFe;
  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const dest = inf.dest || {};
  const total = inf.total?.ICMSTot || {};
  const dataEmissao = String(ide.dhEmi || ide.dEmi || '').slice(0, 10) || null;
  const itens = lista(inf.det).map(d => d.prod || {}).map(p => ({
    codigo: p.cProd != null ? String(p.cProd) : null,
    descricao: p.xProd != null ? String(p.xProd) : null,
    ean: p.cEAN && p.cEAN !== 'SEM GTIN' ? String(p.cEAN) : null,
    ncm: p.NCM != null ? String(p.NCM) : null,
    quantidade: p.qCom != null ? Number(p.qCom) : null,
    unidade: p.uCom != null ? String(p.uCom) : null,
  })).filter(i => i.descricao);
  const prot = xml?.nfeProc?.protNFe?.infProt;
  const dataProt = prot?.dhRecbto ? String(prot.dhRecbto).slice(0, 19).replace(/^(\d{4})-(\d{2})-(\d{2})T/, '$3/$2/$1 ') : '';

  return {
    chave: chave.validar(idChave) ? chave.normalizar(idChave) : null,
    modelo: ide.mod != null ? String(ide.mod) : null,
    serie: ide.serie != null ? String(ide.serie) : null,
    numero: ide.nNF != null ? String(ide.nNF) : null,
    emitente_cnpj: String(emit.CNPJ || emit.CPF || '') || null,
    emitente_nome: emit.xNome ? String(emit.xNome) : null,
    destinatario_cnpj: String(dest.CNPJ || dest.CPF || '') || null,
    destinatario_nome: dest.xNome ? String(dest.xNome) : null,
    data_emissao: /^\d{4}-\d{2}-\d{2}$/.test(dataEmissao) ? dataEmissao : null,
    valor_total: total.vNF != null ? Number(total.vNF) : null,
    protocolo: prot?.nProt ? `${prot.nProt}${dataProt ? ` - ${dataProt}` : ''}` : null,
    itens: itens.length ? itens : null,
    texto_busca: textoBusca(itens.map(i => [i.descricao, i.codigo, i.ean]), emit.xNome, emit.xFant),
    origem_dados: 'xml',
  };
}

// ─── Texto do PDF ────────────────────────────────────
let pdfjsPromise = null;
function carregarPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  return pdfjsPromise;
}
const FONTES_PDF = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;

async function extrairTextoPDF(buffer) {
  const pdfjs = await carregarPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    standardFontDataUrl: FONTES_PDF,
    verbosity: 0,
  }).promise;
  let texto = '';
  const paginas = Math.min(doc.numPages, 5); // DANFE: dados principais estão na 1ª página
  for (let i = 1; i <= paginas; i++) {
    const pagina = await doc.getPage(i);
    const conteudo = await pagina.getTextContent();
    texto += conteudo.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  await doc.destroy();
  return texto;
}

function numeroBR(txt) {
  const n = Number(String(txt).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dataBR(txt) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function lerTextoDANFE(texto) {
  const t = texto.replace(/[ \t ]+/g, ' ');
  const dados = { chave: chave.encontrarNoTexto(t) };

  const emitente = /RECEBEMOS DE\s+(.{3,120}?)\s+OS PRODUTOS/i.exec(t);
  if (emitente) dados.emitente_nome = emitente[1].trim();

  const valor = /VALOR TOTAL DA NOTA[^\d]{0,60}?([\d.]+,\d{2})/i.exec(t);
  if (valor) dados.valor_total = numeroBR(valor[1]);

  const protocolo = /PROTOCOLO DE AUTORIZA[ÇC][ÃA]O(?: DE USO)?[^\d]{0,60}?(\d{15})(?:[\s-]+(\d{2}\/\d{2}\/\d{4}(?: \d{2}:\d{2}(?::\d{2})?)?))?/i.exec(t);
  if (protocolo) dados.protocolo = protocolo[2] ? `${protocolo[1]} - ${protocolo[2]}` : protocolo[1];

  const emissao = /DATA DA EMISS[ÃA]O[^\d]{0,60}?(\d{2}\/\d{2}\/\d{4})/i.exec(t);
  if (emissao) dados.data_emissao = dataBR(emissao[1]);

  return dados;
}

async function lerPDF(buffer) {
  try {
    const texto = await extrairTextoPDF(buffer);
    if (texto.replace(/\s/g, '').length < 20) return { origem_dados: 'pdf_sem_texto' };
    return { ...lerTextoDANFE(texto), texto_busca: textoBusca(texto), origem_dados: 'pdf_texto' };
  } catch (err) {
    console.warn('⚠️  Falha ao ler PDF:', err.message);
    return { origem_dados: 'pdf_erro' };
  }
}

// ─── Junta tudo ──────────────────────────────────────
// Recebe o que o usuário mandou e devolve os campos da nota + status da leitura
async function analisar({ xmlBuffer, pdfBuffer, chaveDigitada }) {
  let dados = {};
  if (xmlBuffer) dados = lerXML(xmlBuffer) || {};
  if (!dados.chave && pdfBuffer) {
    const doPdf = await lerPDF(pdfBuffer);
    dados = { ...doPdf, ...dados, chave: dados.chave || doPdf.chave };
  }

  const digitada = chave.validar(chaveDigitada) ? chave.normalizar(chaveDigitada) : null;
  if (!dados.chave && digitada) dados.chave = digitada;
  if (!dados.origem_dados) dados.origem_dados = digitada ? 'chave' : 'manual';

  // Completa com o que a chave informa (sem sobrescrever o que veio do XML/PDF)
  const daChave = dados.chave ? chave.decompor(dados.chave) : null;
  if (daChave) {
    for (const campo of ['modelo', 'serie', 'numero', 'emitente_cnpj']) {
      if (!dados[campo]) dados[campo] = daChave[campo];
    }
    dados.uf = daChave.uf;
  }

  const temBasico = dados.chave && dados.emitente_nome && dados.data_emissao;
  dados.parse_status = dados.origem_dados === 'xml' || temBasico ? 'completo' : dados.chave ? (dados.emitente_nome || dados.data_emissao ? 'parcial' : 'so_chave') : 'sem_chave';
  return dados;
}

module.exports = { analisar, lerXML, lerPDF, lerTextoDANFE, textoBusca };
