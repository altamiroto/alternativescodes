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

// Extrai o texto do PDF e, de cada página, os pedaços de texto com posição (x, y, largura).
// A posição é o que permite ler a tabela de produtos coluna por coluna.
async function extrairPDF(buffer) {
  const pdfjs = await carregarPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    standardFontDataUrl: FONTES_PDF,
    verbosity: 0,
  }).promise;
  let texto = '';
  const paginas = [];
  const total = Math.min(doc.numPages, 10);
  for (let i = 1; i <= total; i++) {
    const pagina = await doc.getPage(i);
    const conteudo = await pagina.getTextContent();
    texto += conteudo.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
    paginas.push(conteudo.items
      .filter(it => it.str && it.str.trim())
      .map(it => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 6 })));
  }
  await doc.destroy();
  return { texto, paginas };
}

function numeroBR(txt) {
  const n = Number(String(txt).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dataBR(txt) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ─── Produtos do DANFE (PDF) ─────────────────────────
// 1º caminho: tabela por colunas. Acha o cabeçalho da tabela de produtos (DESCRIÇÃO, NCM, CFOP,
// UN, QTD...) e usa a posição x de cada título para saber de que coluna é cada texto.
//   - layout clássico (MOC 7.0): cada produto começa na linha em que aparece o NCM (8 dígitos);
//   - layout novo (NT 2026.010, "CST / CFOP", "QTD / UN", NCM dentro da descrição): cada produto
//     começa na linha em que aparece o código.
// As linhas seguintes completam a descrição. 2º caminho (se o 1º não achar nada): uma linha de
// texto com o produto inteiro.
const NCM_RE = /^\d{4}\.?\d{2}\.?\d{2}$/;
// "Informações adicionais do produto" impressas embaixo da descrição (ex.: "FNSKU:X005B4",
// "pICMSUFDest=18,00%"): daí para baixo não é mais descrição
const INFO_ADICIONAL = /^[A-Za-z][A-Za-z0-9_]{1,24}[:=]\S/;
const NCM_NA_DESCRICAO = /\[?\s*NCM(?:\/SH)?[:\s]*(\d{4}\.?\d{2}\.?\d{2})\s*\]?/i;
const TITULO_FIM = /DADOS ADICIONAIS|C[ÁA]LCULO DO ISSQN|INFORMA[ÇC][ÕO]ES COMPLEMENTARES|RESERVADO AO FISCO/i;

// Nome da coluna pelo título (a ordem importa: "QTD / UN" é quantidade, "CST / CFOP" é CFOP)
function nomeDaColuna(titulo) {
  const t = titulo.trim();
  if (/DESCRI[ÇC][ÃA]O/i.test(t)) return 'descricao';
  if (/^NCM/i.test(t)) return 'ncm';
  if (/QU?A?N?T(IDADE)?\b|QTDE?\b|^QTD/i.test(t)) return 'qtd';
  if (/^UN(ID(ADE)?)?\.?(\s*(COM|TRIB)\.?)?$/i.test(t)) return 'un';
  if (/CFOP/i.test(t)) return 'cfop';
  if (/^(O\/)?CS(T|OSN)\b/i.test(t)) return 'cst';
  if (/^C[ÓO]D(IGO|\.)?/i.test(t)) return 'codigo';
  return null;
}

// Junta os pedaços que estão na mesma altura (mesma linha da página), da esquerda para a direita
function agruparLinhas(pedacos) {
  const linhas = [];
  for (const p of [...pedacos].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const linha = linhas.find(l => Math.abs(l.y - p.y) <= Math.max(1.5, p.h * 0.3));
    if (linha) linha.pedacos.push(p); else linhas.push({ y: p.y, pedacos: [p] });
  }
  for (const l of linhas) l.pedacos.sort((a, b) => a.x - b.x);
  return linhas.sort((a, b) => b.y - a.y);
}

const textoDaLinha = l => l.pedacos.map(p => p.s).join(' ');

// Títulos do cabeçalho: palavras coladas (PDFs que quebram por palavra) viram um título só
function colunasDoCabecalho(cab) {
  const titulos = [];
  for (const p of cab.pedacos) {
    const ultimo = titulos[titulos.length - 1];
    if (ultimo && p.x - (ultimo.x + ultimo.w) < 3) {
      ultimo.s += ` ${p.s}`;
      ultimo.w = p.x + p.w - ultimo.x;
    } else {
      titulos.push({ ...p });
    }
  }
  const cols = [];
  for (const t of titulos) {
    const nome = nomeDaColuna(t.s);
    cols.push({ nome: nome && !cols.some(c => c.nome === nome) ? nome : null, x: t.x, fim: t.x + t.w });
  }
  return cols.sort((a, b) => a.x - b.x);
}

function lerItensPorColunas(paginas) {
  const itens = [];
  for (const pedacos of paginas) {
    const linhas = agruparLinhas(pedacos);
    const cab = linhas.find(l => {
      const t = textoDaLinha(l);
      return /DESCRI[ÇC][ÃA]O/i.test(t) && /NCM|CFOP/i.test(t) && /QU?A?N?T|QTDE?|\bUN/i.test(t);
    });
    if (!cab) continue;
    const cols = colunasDoCabecalho(cab);
    if (!cols.some(c => c.nome === 'descricao')) continue;
    if (!cols.some(c => c.nome === 'codigo') && cols[0] && !cols[0].nome) cols[0].nome = 'codigo';
    const temNcm = cols.some(c => c.nome === 'ncm');
    if (!temNcm && !cols.some(c => c.nome === 'codigo')) continue;

    // Cada texto pertence à coluna cujo título começa logo antes dele. O conteúdo pode começar
    // um pouco à esquerda do título (texto centralizado, números alinhados à direita): margem de
    // até 12 pontos, sem passar de 30% da distância até o título anterior.
    // A descrição costuma ter o título centralizado numa coluna larga: começa logo depois do
    // fim do título anterior (ex.: "CÓDIGO PRODUTO").
    const inicioDe = cols.map((c, i) => {
      if (i === 0) return -Infinity;
      const pelaMargem = c.x - Math.min(12, (c.x - cols[i - 1].x) * 0.3);
      return c.nome === 'descricao' ? Math.min(pelaMargem, cols[i - 1].fim + 1) : pelaMargem;
    });
    const colunaDe = p => {
      let achada = null;
      cols.forEach((c, i) => { if (p.x >= inicioDe[i]) achada = c; });
      return achada ? achada.nome : null;
    };

    const fim = linhas.find(l => l.y < cab.y && TITULO_FIM.test(textoDaLinha(l)));
    let atual = null;
    for (const l of linhas) {
      if (l.y >= cab.y || (fim && l.y <= fim.y)) continue;
      const porColuna = {};
      for (const p of l.pedacos) {
        const c = colunaDe(p);
        if (c) (porColuna[c] ||= []).push(p.s);
      }
      const ncm = (porColuna.ncm || []).join('').replace(/\D/g, '');
      const codigo = (porColuna.codigo || []).join(' ').trim();
      // Com coluna NCM: o produto começa onde o NCM aparece (pode quebrar em 2 linhas em
      // fontes largas, então basta começar com 4+ dígitos ao lado de código ou descrição)
      const inicia = temNcm
        ? ncm.length >= 4 && !!(codigo || porColuna.descricao)
        : !!codigo && !!porColuna.descricao;
      if (inicia) {
        atual = { codigo: codigo || null, descricao: '', ncm: ncm || null, _qtd: [], _un: [] };
        itens.push(atual);
      } else if (atual && ncm && (atual.ncm || '').length < 8) {
        atual.ncm = `${atual.ncm || ''}${ncm}`; // resto do NCM na linha de baixo
      }
      if (!atual) continue;
      if (porColuna.descricao && !atual._fimDescricao) {
        const trecho = porColuna.descricao.join(' ');
        if (!inicia && (INFO_ADICIONAL.test(trecho))) atual._fimDescricao = true;
        else atual.descricao = `${atual.descricao} ${trecho}`.trim();
      }
      if (porColuna.qtd) atual._qtd.push(...porColuna.qtd.join(' ').split(/\s+/));
      if (porColuna.un) atual._un.push(...porColuna.un.join(' ').split(/\s+/));
    }
  }
  return itens.map(i => {
    // NCM escrito dentro da descrição (layout novo): vai para o campo NCM
    const m = NCM_NA_DESCRICAO.exec(i.descricao);
    const descricao = (m ? i.descricao.replace(m[0], ' ') : i.descricao).replace(/\s+/g, ' ').trim();
    const qtd = i._qtd.find(t => /^\d[\d.]*(,\d+)?$/.test(t));
    const unidade = i._un.find(t => /^[A-Za-zÀ-ú]/.test(t)) || i._qtd.find(t => /^[A-Za-zÀ-ú]{1,6}\d{0,2}$/.test(t)) || null;
    return {
      codigo: i.codigo,
      descricao,
      ncm: (i.ncm && i.ncm.slice(0, 8)) || (m ? m[1].replace(/\./g, '') : null),
      unidade,
      quantidade: qtd ? numeroBR(qtd) : null,
    };
  }).filter(i => i.descricao);
}

// Linha com o produto inteiro (DANFEs em que cada linha da tabela é um texto só)
const LINHA_ITEM = /^\s*(\S{1,30})\s+(.{2,160}?)\s+(\d{8}|\d{4}\.\d{2}\.\d{2})\s+(\d{3,4})\s+([1-7]\d{3})\s+([A-Za-zÀ-ú]{1,6}\d{0,2})\s+(\d{1,3}(?:\.\d{3})*(?:,\d{1,4})?)(?=\s|$)/;

function lerItensPorLinha(linhasTexto) {
  const itens = [];
  for (const linha of linhasTexto) {
    const m = LINHA_ITEM.exec(linha);
    if (!m) continue;
    itens.push({ codigo: m[1], descricao: m[2].trim(), ncm: m[3].replace(/\./g, ''), unidade: m[6], quantidade: numeroBR(m[7]) });
  }
  return itens;
}

// Melhor esforço: cada emissor monta o PDF de um jeito; se não reconhecer, devolve null
function lerItensDANFE(texto, paginas = []) {
  let itens = paginas.length ? lerItensPorColunas(paginas) : [];
  if (!itens.length) {
    const linhas = paginas.length
      ? paginas.flatMap(p => agruparLinhas(p).map(textoDaLinha))
      : String(texto || '').split('\n');
    itens = lerItensPorLinha(linhas);
  }
  return itens.length ? itens : null;
}

// Valor no quadro "Cálculo do imposto": o número logo abaixo do título "V(ALOR). TOTAL DA NOTA"
const TITULO_VALOR = /^V(?:ALOR|L?\.)?\s*TOTAL\s+DA\s+NOTA/i;
const VALOR_BR = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})$/;

function valorPorPosicao(paginas) {
  for (const pagina of paginas) {
    const linhas = agruparLinhas(pagina);
    for (const [n, linha] of linhas.entries()) {
      const ps = linha.pedacos;
      for (let i = 0; i < ps.length; i++) {
        let j = i, junto = ps[i].s;
        while (!TITULO_VALOR.test(junto) && j + 1 < ps.length && j - i < 5) junto += ' ' + ps[++j].s;
        if (!TITULO_VALOR.test(junto)) continue;
        // A célula vai do título até o próximo título da linha (o valor costuma vir alinhado à direita)
        const ini = ps[i].x - 5, fim = j + 1 < ps.length ? ps[j + 1].x : Infinity;
        // Mesmo pedaço com o valor colado ("V. TOTAL DA NOTA 3.644,00")
        const colado = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/.exec(junto.replace(TITULO_VALOR, ''));
        if (colado) return numeroBR(colado[1]);
        for (const abaixo of linhas.slice(n + 1)) {
          if (linha.y - abaixo.y > 40) break;
          const v = abaixo.pedacos.find(p => VALOR_BR.test(p.s) && p.x + p.w / 2 >= ini && p.x + p.w / 2 < fim);
          if (v) return numeroBR(VALOR_BR.exec(v.s)[1]);
        }
      }
    }
  }
  return null;
}

function lerTextoDANFE(texto, paginas = []) {
  const t = texto.replace(/[ \t ]+/g, ' ');
  const dados = { chave: chave.encontrarNoTexto(t), itens: lerItensDANFE(t, paginas) };

  const emitente = /RECEBEMOS DE\s+(.{3,120}?)\s+OS PRODUTOS/i.exec(t);
  if (emitente) dados.emitente_nome = emitente[1].trim();

  // 1º pela posição no quadro de impostos; senão pelo texto; por fim o canhoto ("VALOR TOTAL: R$ 3.644,00")
  let valor = paginas.length ? valorPorPosicao(paginas) : null;
  if (valor == null) {
    const m = /V(?:ALOR|\.)\s*TOTAL DA NOTA[^\d]{0,60}?([\d.]+,\d{2})/i.exec(t)
      || /VALOR TOTAL:?\s*R\$\s*([\d.]+,\d{2})/i.exec(t);
    if (m) valor = numeroBR(m[1]);
  }
  if (valor != null) dados.valor_total = valor;

  const protocolo = /PROTOCOLO DE AUTORIZA[ÇC][ÃA]O(?: DE USO)?[^\d]{0,60}?(\d{15})(?:[\s-]+(\d{2}\/\d{2}\/\d{4}(?: \d{2}:\d{2}(?::\d{2})?)?))?/i.exec(t);
  if (protocolo) dados.protocolo = protocolo[2] ? `${protocolo[1]} - ${protocolo[2]}` : protocolo[1];

  const emissao = /DATA DA EMISS[ÃA]O[^\d]{0,60}?(\d{2}\/\d{2}\/\d{4})/i.exec(t);
  if (emissao) dados.data_emissao = dataBR(emissao[1]);

  return dados;
}

async function lerPDF(buffer) {
  try {
    const { texto, paginas } = await extrairPDF(buffer);
    if (texto.replace(/\s/g, '').length < 20) return { origem_dados: 'pdf_sem_texto' };
    return { ...lerTextoDANFE(texto, paginas), texto_busca: textoBusca(texto), origem_dados: 'pdf_texto' };
  } catch (err) {
    console.warn('⚠️  Falha ao ler PDF:', err.message);
    return { origem_dados: 'pdf_erro' };
  }
}

// ─── Junta tudo ──────────────────────────────────────
// Recebe o que o usuário mandou e devolve os campos da nota + status da leitura
async function analisar({ xmlBuffer, pdfBuffer, chaveDigitada, nomesArquivos = [] }) {
  let dados = {};
  if (xmlBuffer) dados = lerXML(xmlBuffer) || {};
  if (!dados.chave && pdfBuffer) {
    const doPdf = await lerPDF(pdfBuffer);
    dados = { ...doPdf, ...dados, chave: dados.chave || doPdf.chave };
  }

  const digitada = chave.validar(chaveDigitada) ? chave.normalizar(chaveDigitada) : null;
  if (!dados.chave && digitada) dados.chave = digitada;
  // Muitos sistemas salvam o arquivo com a chave no nome (ex.: NFE-3126...1678.pdf)
  if (!dados.chave && nomesArquivos.length) dados.chave = chave.encontrarNoTexto(nomesArquivos.join(' ')) || null;
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

module.exports = { analisar, lerXML, lerPDF, lerTextoDANFE, lerItensDANFE, textoBusca };
// uso interno (testes e diagnóstico)
module.exports._interno = { extrairPDF, agruparLinhas, colunasDoCabecalho, textoDaLinha };
