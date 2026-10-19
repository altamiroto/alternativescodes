// Cliente da Consulta DANFE contra um servidor local que imita a API (sem rede)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const PDF = Buffer.from('%PDF-1.3\n% teste\n');
const XML = Buffer.from('<nfeProc><NFe/></nfeProc>');
let tentativas503 = 0;

const servidor = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', c => { corpo += c; });
  req.on('end', () => {
    if (req.url === '/api/v1/consulta') {
      const { chave } = JSON.parse(corpo || '{}');
      if (chave.endsWith('0')) {
        res.writeHead(400, { 'X-Error-Code': 'data_fora_da_janela', 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'data_fora_da_janela', message: 'fora' }));
      }
      if (chave.endsWith('9') && tentativas503++ === 0) { res.writeHead(503, { 'Retry-After': '0' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', chave, tipo: 'nfe', pdf_base64: PDF.toString('base64'), xml_base64: XML.toString('base64') }));
    }
    if (req.url === '/api/v1/danfe') {
      assert.match(corpo, /name="xml"/);
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      return res.end(PDF);
    }
    res.writeHead(404); res.end();
  });
});

test('consulta DANFE: sucesso, erro com X-Error-Code, nova tentativa em 503 e DANFE pelo XML', async t => {
  await new Promise(r => servidor.listen(0, r));
  t.after(() => servidor.close());
  process.env.CONSULTA_DANFE_URL = `http://127.0.0.1:${servidor.address().port}`;
  delete require.cache[require.resolve('../src/consultaDanfe')];
  const c = require('../src/consultaDanfe');

  const ok = await c.consultarChave('35261012345678000190550010001234561000000016');
  assert.deepStrictEqual([ok.xml.toString(), ok.pdf.toString()], [XML.toString(), PDF.toString()]);

  await assert.rejects(c.consultarChave('35261012345678000190550010001234561000000010'),
    e => e.codigo === 'data_fora_da_janela' && /deste mês/.test(e.message));

  const depoisDe503 = await c.consultarChave('35261012345678000190550010001234561000000019');
  assert.ok(depoisDe503.pdf);

  const pdf = await c.gerarDanfe(XML);
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');

  const outubro = new Date('2026-10-20T12:00:00-03:00');
  assert.strictEqual(c.podeConsultar('35261012345678000190550010001234561000000016', outubro), true);
  assert.strictEqual(c.podeConsultar('35261012345678000190650010001234561000000016', outubro), false); // NFC-e
});

test('janela de datas da consulta pela chave (AAMM da chave)', () => {
  const c = require('../src/consultaDanfe');
  const chave = aamm => `35${aamm}12345678000190550010001234561000000016`;
  const dia = (d) => new Date(`${d}T12:00:00-03:00`);
  assert.strictEqual(c.dentroDaJanela(chave('2610'), dia('2026-10-19')), true);   // mês corrente
  assert.strictEqual(c.dentroDaJanela(chave('2609'), dia('2026-10-10')), true);   // mês anterior até o dia 15
  assert.strictEqual(c.dentroDaJanela(chave('2609'), dia('2026-10-19')), false);  // depois do dia 15
  assert.strictEqual(c.dentroDaJanela(chave('2607'), dia('2026-10-19')), false);  // antiga
  assert.strictEqual(c.dentroDaJanela(chave('2612'), dia('2027-01-05')), true);   // virada do ano
  // meia-noite UTC ainda é o dia anterior em Brasília
  assert.strictEqual(c.dentroDaJanela(chave('2610'), new Date('2026-11-01T02:00:00Z')), true);
});
