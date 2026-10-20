// Cliente do Meu Danfe contra um servidor local que imita a API (sem rede)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const PDF = Buffer.from('%PDF-1.3\n% teste\n');
const XML = '<?xml version="1.0"?><nfeProc><NFe/></nfeProc>';
const ENCONTRADA = '35261012345678000190550010001234561000000016';
const NAO_EXISTE = '35261012345678000190550010001234561000000024';
const SEM_SALDO = '35261012345678000190550010001234561000000032';
const chamadas = [];
let consultasStatus = 0;

const servidor = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', c => { corpo += c; });
  req.on('end', () => {
    chamadas.push(`${req.method} ${req.url}`);
    const json = (status, dados) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(dados)); };
    if (req.headers['api-key'] !== 'chave-teste') return json(401, { status: 401, error: 'Unauthorized' });
    const alvo = req.url.split('/').pop(); // /fd/add/{chave}
    if (req.method === 'PUT' && req.url.startsWith('/fd/add/')) {
      if (alvo === SEM_SALDO) return json(402, {});
      if (alvo === NAO_EXISTE) return json(200, { value: alvo, type: 'NFE', status: 'NOT_FOUND', statusMessage: 'Não encontrada' });
      // primeira consulta ainda "buscando", a segunda já OK
      return json(200, { value: alvo, type: 'NFE', status: consultasStatus++ === 0 ? 'SEARCHING' : 'OK', statusMessage: '' });
    }
    if (req.url === `/fd/get/xml/${ENCONTRADA}`) return json(200, { name: 'n.xml', type: 'NFE', format: 'XML', data: XML });
    if (req.url === `/fd/get/da/${ENCONTRADA}`) return json(200, { name: 'n.pdf', type: 'NFE', format: 'BASE64', data: PDF.toString('base64') });
    if (req.method === 'POST' && req.url === '/fd/convert/xml-to-da') {
      assert.strictEqual(req.headers['content-type'], 'text/plain');
      assert.match(corpo, /nfeProc/);
      return json(200, { name: 'n.pdf', type: 'NFE', format: 'BASE64', data: PDF.toString('base64') });
    }
    json(404, {});
  });
});

test('Meu Danfe: busca pela chave (com espera de status), não encontrada, sem saldo e DANFE pelo XML', async t => {
  await new Promise(r => servidor.listen(0, r));
  t.after(() => servidor.close());
  process.env.MEUDANFE_URL = `http://127.0.0.1:${servidor.address().port}`;
  process.env.MEUDANFE_API_KEY = 'chave-teste';
  delete require.cache[require.resolve('../src/meuDanfe')];
  const md = require('../src/meuDanfe');

  assert.ok(md.podeBuscar(ENCONTRADA));
  assert.ok(!md.podeBuscar('35261012345678000190650010001234561000000016')); // NFC-e

  const r = await md.buscarNota(ENCONTRADA);
  assert.strictEqual(r.xml.toString(), XML);
  assert.strictEqual(r.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.strictEqual(chamadas.filter(c => c.startsWith('PUT')).length, 2); // SEARCHING → OK

  await assert.rejects(md.buscarNota(NAO_EXISTE), e => e.codigo === 'nao_encontrada');
  // não insiste na chave que falhou (a API bloqueia a conta)
  const antes = chamadas.length;
  await assert.rejects(md.buscarNota(NAO_EXISTE), e => e.codigo === 'repetida');
  assert.strictEqual(chamadas.length, antes);

  await assert.rejects(md.buscarNota(SEM_SALDO), e => e.codigo === 'saldo');

  const pdf = await md.gerarDanfe(Buffer.from(XML));
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');

  process.env.MEUDANFE_API_KEY = 'errada';
  await assert.rejects(md.gerarDanfe(Buffer.from(XML)), e => e.codigo === 'api_key');
  process.env.MEUDANFE_API_KEY = '';
  assert.ok(!md.ativa());
});
