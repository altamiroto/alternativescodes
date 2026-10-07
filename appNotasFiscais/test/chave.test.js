const test = require('node:test');
const assert = require('node:assert');
const chave = require('../src/chave');

const VALIDA = '35261012345678000190550010001234561000000016';

test('valida o dígito verificador', () => {
  assert.ok(chave.validar(VALIDA));
  assert.ok(chave.validar('3526 1012 3456 7800 0190 5500 1000 1234 5610 0000 0016'));
  assert.ok(!chave.validar(VALIDA.slice(0, 43) + '7'));
  assert.ok(!chave.validar(VALIDA.slice(0, 43)));
  assert.ok(!chave.validar('99' + VALIDA.slice(2))); // UF inexistente
});

test('aceita CNPJ alfanumérico nas posições do CNPJ', () => {
  const base = '352610' + '12ABC34500DE19' + '55001000123456100000001';
  const c = base + chave.calcularDV(base);
  assert.ok(chave.validar(c));
  assert.ok(!chave.validar('35261A' + c.slice(6))); // letra fora do CNPJ
});

test('decompõe a chave', () => {
  const d = chave.decompor(VALIDA);
  assert.deepStrictEqual(
    { uf: d.uf, ano_mes: d.ano_mes, cnpj: d.emitente_cnpj, modelo: d.modelo, serie: d.serie, numero: d.numero },
    { uf: 'SP', ano_mes: '2026-10', cnpj: '12345678000190', modelo: '55', serie: '1', numero: '123456' }
  );
});

test('encontra a chave no texto do DANFE', () => {
  assert.strictEqual(chave.encontrarNoTexto('CHAVE DE ACESSO 3526 1012 3456 7800 0190 5500 1000 1234 5610 0000 0016 Consulta'), VALIDA);
  assert.strictEqual(chave.encontrarNoTexto(`ACESSO\n${VALIDA}\n`), VALIDA);
  assert.strictEqual(chave.encontrarNoTexto('CNPJ 12.345.678/0001-90 Fone 11 1234-5678'), null);
});
