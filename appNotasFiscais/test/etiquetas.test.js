const test = require('node:test');
const assert = require('node:assert');
const { gerarPDF } = require('../src/etiquetas');

const nota = {
  id: 42, slug: '7KQ2M9XAB3', url: 'https://exemplo.duckdns.org/n/7KQ2M9XAB3', created_at: new Date(),
  chave: '35261012345678000190550010001234561000000016', numero: '123456', serie: '1', modelo: '55',
  emitente_nome: 'FORNECEDOR', emitente_cnpj: '12345678000190', data_emissao: '2026-10-05', valor_total: 1234.56,
};

for (const layout of [4, 8, 16]) {
  test(`gera PDF com ${layout} etiquetas por folha`, async () => {
    const notas = Array.from({ length: layout + 1 }, (_, i) => ({ ...nota, id: i + 1, chave: i % 3 ? nota.chave : null }));
    const pdf = await gerarPDF(notas, layout);
    assert.strictEqual(pdf.subarray(0, 4).toString(), '%PDF');
    assert.strictEqual((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2); // passou para a 2ª folha
  });
}
