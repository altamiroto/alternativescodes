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
