// Chave a partir do texto lido pela câmera (OCR) — código do navegador (public/js/comum.js)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'comum.js'), 'utf8');
const Chave = new Function(`${fonte.slice(fonte.indexOf('const Chave = {'), fonte.indexOf('function aviso('))}; return Chave;`)();
const K = '31261011389858000106550020008256691731115809';

test('acha a chave no texto lido, com espaços, quebras e letras no lugar de números', () => {
  assert.strictEqual(Chave.doTexto('3126 1011 3898 5800 0106 5500 2000 8256 6917 3111 5809'), K);
  assert.strictEqual(Chave.doTexto(`CHAVE DE ACESSO\n${K}\nCONSULTA`), K);
  assert.strictEqual(Chave.doTexto('3126 1011 3898 5800 0106\n5500 2000 8256 6917 3111 5809'), K);
  assert.strictEqual(Chave.doTexto('3126 1O11 3B98 58OO 0106 55OO 2OOO 8256 6917 3111 58O9'), K);
});

test('recusa leitura com número errado ou faltando', () => {
  assert.strictEqual(Chave.doTexto('3126 1011 3898 5800 0106 5500 2000 8256 6917 3111 5808'), null);
  assert.strictEqual(Chave.doTexto('4126 1011 3898 5800 0106 5500 2000 8256 6917 3111 5809'), null);
  assert.strictEqual(Chave.doTexto('3126 1011 3898 5800 0106 5500 2000 8256 6917 3111 580'), null);
});

test('aceita CNPJ com letras nas posições do CNPJ', () => {
  const base = '352610' + '12ABC34501DE35' + '55001000123456100000001'; // CNPJ de exemplo da Receita
  const c = base + Chave.dv(base);
  assert.strictEqual(Chave.doTexto(c.replace(/(.{4})/g, '$1 ')), c);
});

test('não monta chave com pedaços de linhas diferentes nem com CNPJ inválido', () => {
  // leitura de página inteira que já gerou uma "chave" falsa (CNPJ com letras inválido)
  assert.strictEqual(Chave.doTexto('326702508E11MM6FFNC0658711853126061543694000'), null);
  assert.strictEqual(Chave.doTexto('PROTOCOLO 131267633203687\nX\nY\n3126 0615 4369 4000 0952 5500\nZ\n1065 8711 8511 3739 0203'), null);
  assert.strictEqual(Chave.cnpjValido('11389858000106'), true);
  assert.strictEqual(Chave.cnpjValido('11389858000107'), false);
  assert.strictEqual(Chave.cpfValido('60926317687'), true);
});
