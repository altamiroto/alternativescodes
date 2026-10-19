const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const parse = require('../src/parse');

const pasta = path.join(__dirname, 'fixtures');
const casos = [
  ['danfe-9-itens-moc.pdf', 'danfe-9-itens.xml'],
  ['danfe-9-itens-courier.pdf', 'danfe-9-itens.xml'],
  ['danfe-9-itens-nt2026.pdf', 'danfe-9-itens.xml'],
  ['danfe-70-itens-2-paginas.pdf', 'danfe-70-itens.xml'],
];

for (const [pdf, xml] of casos) {
  test(`produtos do PDF batem com o XML: ${pdf}`, async () => {
    const esperado = parse.lerXML(fs.readFileSync(path.join(pasta, xml)));
    const lido = await parse.lerPDF(fs.readFileSync(path.join(pasta, pdf)));
    assert.strictEqual(lido.chave, esperado.chave);
    assert.strictEqual(lido.emitente_nome, esperado.emitente_nome);
    assert.strictEqual(lido.data_emissao, esperado.data_emissao);
    assert.strictEqual(lido.itens.length, esperado.itens.length);
    lido.itens.forEach((item, i) => {
      const e = esperado.itens[i];
      assert.deepStrictEqual(
        [item.codigo, item.descricao, item.ncm, item.unidade, item.quantidade],
        [e.codigo, e.descricao, e.ncm, e.unidade, e.quantidade],
        `item ${i + 1}`);
    });
  });
}

test('valor total do PDF bate com o XML', async () => {
  for (const [pdf, xml] of casos) {
    const esperado = parse.lerXML(fs.readFileSync(path.join(pasta, xml)));
    const lido = await parse.lerPDF(fs.readFileSync(path.join(pasta, pdf)));
    assert.strictEqual(lido.valor_total, esperado.valor_total, pdf);
  }
});

// Layout de marketplace: "V. TOTAL DA NOTA" é o último título do quadro e o valor fica na linha de baixo,
// depois dos valores das outras colunas
function pdfQuadroImpostos(comQuadro) {
  const PDFDocument = require('pdfkit');
  return new Promise(resolve => {
    const doc = new PDFDocument({ size: 'A4', margin: 20 });
    const partes = [];
    doc.on('data', p => partes.push(p)).on('end', () => resolve(Buffer.concat(partes)));
    doc.font('Helvetica').fontSize(7);
    doc.text('RECEBEMOS DE LOJA EXEMPLO LTDA OS PRODUTOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA ABAIXO. EMISSÃO: 14/06/2026'
      + (comQuadro ? '' : ' VALOR TOTAL: R$ 3.644,00'), 20, 30, { width: 550 });
    if (comQuadro) {
      const titulos = ['VALOR DO FRETE', 'VALOR DO SEGURO', 'DESCONTO', 'OUTRAS DESPESAS', 'VALOR TOTAL IPI', 'V. ICMS UF DEST.', 'V. TOT. TRIB.', 'V. TOTAL DA NOTA'];
      const valores = ['0,00', '0,00', '904,89', '0,00', '0,00', '0,00', '1.551,62', '3.644,00'];
      titulos.forEach((t, i) => {
        doc.text(t, 20 + i * 70, 200, { lineBreak: false });
        doc.text(valores[i], 20 + i * 70, 212, { width: 66, align: 'right', lineBreak: false });
      });
    }
    doc.end();
  });
}

test('valor total na linha de baixo do título "V. TOTAL DA NOTA"', async () => {
  const lido = await parse.lerPDF(await pdfQuadroImpostos(true));
  assert.strictEqual(lido.valor_total, 3644);
});

test('valor total pelo canhoto quando não há quadro de impostos', async () => {
  const lido = await parse.lerPDF(await pdfQuadroImpostos(false));
  assert.strictEqual(lido.valor_total, 3644);
});
