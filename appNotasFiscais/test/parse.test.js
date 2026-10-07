const test = require('node:test');
const assert = require('node:assert');
const PDFDocument = require('pdfkit');
const parse = require('../src/parse');

const CHAVE = '35261012345678000190550010001234561000000016';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00">
<ide><mod>55</mod><serie>1</serie><nNF>123456</nNF><dhEmi>2026-10-05T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000190</CNPJ><xNome>FORNECEDOR XML S.A.</xNome></emit>
<dest><CNPJ>98765432000110</CNPJ><xNome>MINHA LOJA LTDA</xNome></dest>
<det nItem="1"><prod><cProd>PF-20</cProd><cEAN>7891234567895</cEAN><xProd>PARAFUSADEIRA ELÉTRICA 12V</xProd><uCom>UN</uCom><qCom>2.0000</qCom></prod></det>
<total><ICMSTot><vNF>4321.00</vNF></ICMSTot></total></infNFe></NFe>
<protNFe><infProt><chNFe>${CHAVE}</chNFe><dhRecbto>2026-10-05T10:01:22-03:00</dhRecbto><nProt>135261234567890</nProt></infProt></protNFe></nfeProc>`;

function danfePDF() {
  return new Promise(resolve => {
    const doc = new PDFDocument();
    const partes = [];
    doc.on('data', b => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.text('RECEBEMOS DE FORNECEDOR EXEMPLO LTDA OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL');
    doc.text('CHAVE DE ACESSO');
    doc.text('3526 1012 3456 7800 0190 5500 1000 1234 5610 0000 0016');
    doc.text('PROTOCOLO DE AUTORIZAÇÃO DE USO');
    doc.text('135261234567890 - 05/10/2026 10:01:22');
    doc.text('DATA DA EMISSÃO');
    doc.text('05/10/2026');
    doc.text('VALOR TOTAL DA NOTA');
    doc.text('1.234,56');
    doc.end();
  });
}

test('lê o XML da NF-e', async () => {
  const d = await parse.analisar({ xmlBuffer: Buffer.from(XML) });
  assert.strictEqual(d.chave, CHAVE);
  assert.strictEqual(d.emitente_nome, 'FORNECEDOR XML S.A.');
  assert.strictEqual(d.destinatario_cnpj, '98765432000110');
  assert.strictEqual(d.data_emissao, '2026-10-05');
  assert.strictEqual(d.valor_total, 4321);
  assert.strictEqual(d.protocolo, '135261234567890 - 05/10/2026 10:01:22');
  assert.strictEqual(d.parse_status, 'completo');
  assert.deepStrictEqual(d.itens.map(i => [i.descricao, i.quantidade, i.ean]), [['PARAFUSADEIRA ELÉTRICA 12V', 2, '7891234567895']]);
  assert.ok(d.texto_busca.includes('parafusadeira eletrica 12v pf-20 7891234567895'));
});

test('lê o texto do PDF do DANFE', async () => {
  const d = await parse.analisar({ pdfBuffer: await danfePDF() });
  assert.strictEqual(d.chave, CHAVE);
  assert.strictEqual(d.emitente_nome, 'FORNECEDOR EXEMPLO LTDA');
  assert.strictEqual(d.data_emissao, '2026-10-05');
  assert.strictEqual(d.protocolo, '135261234567890 - 05/10/2026 10:01:22');
  assert.strictEqual(d.numero, '123456');
  assert.ok(d.texto_busca.includes('recebemos de fornecedor exemplo ltda'));
  assert.strictEqual(d.parse_status, 'completo');
});

test('só a chave preenche o que dá', async () => {
  const d = await parse.analisar({ chaveDigitada: CHAVE });
  assert.strictEqual(d.origem_dados, 'chave');
  assert.strictEqual(d.emitente_cnpj, '12345678000190');
  assert.strictEqual(d.parse_status, 'so_chave');
});
