// Cliente da API gratuita Consulta DANFE (https://consultadanfe.com)
//
//   POST /api/v1/consulta  { chave }  → XML autorizado + DANFE em PDF (só NF-e modelo 55, mês corrente
//                                       e mês anterior até o dia 15; 60 req/min)
//   POST /api/v1/danfe     xml=@...   → DANFE em PDF a partir do XML (sem janela de datas; 500 req/min)
//
// Variáveis de ambiente:
//   CONSULTA_DANFE=false        desliga a integração
//   CONSULTA_DANFE_URL=...      outro endereço (padrão https://consultadanfe.com)
//   CONSULTA_DANFE_TIMEOUT=30   segundos por requisição
//   CONSULTA_DANFE_IPV4=false   deixa o sistema escolher IPv6 (padrão: sai por IPv4)
//
// Por que IPv4: o limite da API é por IP e, em IPv6, conta a faixa inteira (/56). Em VPS essa faixa
// costuma ser dividida com outros servidores, e a consulta já chega "estourada" (HTTP 429).

const dns = require('dns');
const net = require('net');
const https = require('https');
const http = require('http');

if (process.env.CONSULTA_DANFE_IPV4 !== 'false') {
  dns.setDefaultResultOrder('ipv4first');
  net.setDefaultAutoSelectFamily(false); // usa só o primeiro endereço (o IPv4)
}

const BASE = (process.env.CONSULTA_DANFE_URL || 'https://consultadanfe.com').replace(/\/+$/, '');
const TIMEOUT = (Number(process.env.CONSULTA_DANFE_TIMEOUT) || 30) * 1000;

const ativa = () => process.env.CONSULTA_DANFE !== 'false';

class ErroConsulta extends Error {
  constructor(codigo, mensagem, status, esperarSegundos = null) {
    super(mensagem || codigo);
    this.codigo = codigo;
    this.status = status;
    this.esperarSegundos = esperarSegundos; // quanto falta para a API aceitar de novo (quando informado)
  }
}

// Falhas passageiras: vale tentar de novo mais tarde, sozinho
const PASSAGEIRAS = new Set(['limite', 'servico_indisponivel', 'rede', 'pendente', 'erro_interno']);
const ePassageira = codigo => PASSAGEIRAS.has(codigo) || /^http_5\d\d$/.test(codigo || '');

// Mensagens para quem usa o app (os códigos vêm do header X-Error-Code, que é o contrato estável)
const MENSAGENS = {
  data_fora_da_janela: 'A consulta automática só busca notas deste mês (ou do mês passado, até o dia 15).',
  nao_encontrada: 'A SEFAZ não encontrou essa nota pela chave.',
  pendente: 'A nota ainda não foi autorizada na SEFAZ (contingência). Tente mais tarde.',
  tipo_nao_suportado: 'A consulta automática só funciona para NF-e (modelo 55).',
  servico_indisponivel: 'O serviço de consulta está fora do ar no momento.',
  limite: 'Muitas consultas seguidas. Tente de novo em instantes.',
  rede: 'Não foi possível falar com o serviço de consulta.',
};

const esperar = ms => new Promise(r => setTimeout(r, ms));
const INTERVALO = 1100; // no máximo ~1 requisição por segundo (limite da API: 60/min)

// Uma requisição por vez, espaçadas; depois de um 429, ninguém chama até passar o Retry-After
let fila = Promise.resolve();
let ultimaEm = 0;
let pausaAte = 0;

const segundosParaLiberar = () => Math.max(0, Math.ceil((pausaAte - Date.now()) / 1000));

function naFila(tarefa) {
  const vez = fila.then(async () => {
    if (Date.now() < pausaAte) {
      throw new ErroConsulta('limite', MENSAGENS.limite, 429, segundosParaLiberar());
    }
    const espera = ultimaEm + INTERVALO - Date.now();
    if (espera > 0) await esperar(espera);
    try { return await tarefa(); } finally { ultimaEm = Date.now(); }
  });
  fila = vez.catch(() => {});
  return vez;
}

function registrarFalha(caminho, resp, corpo) {
  const h = n => resp.headers.get(n);
  console.warn(`⚠️  Consulta DANFE ${caminho}: HTTP ${resp.status}`
    + ` código=${h('x-error-code') || '-'} ratelimit=${h('ratelimit') || h('x-ratelimit-remaining') || '-'}`
    + ` retry-after=${h('retry-after') || '-'} server=${h('server') || '-'} cf-ray=${h('cf-ray') || '-'}`
    + (corpo ? ` corpo=${JSON.stringify(corpo.slice(0, 160))}` : ''));
}

// Faz a requisição. Em 429/503 com Retry-After curto (até 5 s) tenta mais 1 vez; com espera longa,
// pausa todas as consultas até liberar (re-tentar antes disso é o que faz a API banir o IP).
function requisitar(caminho, opcoes) {
  return naFila(async () => {
    for (let tentativa = 0; ; tentativa++) {
      let resp;
      try {
        resp = await fetch(`${BASE}${caminho}`, {
          ...opcoes,
          headers: { 'User-Agent': 'NotasDoEstoque/1.0 (+consulta DANFE)', ...opcoes.headers },
          signal: AbortSignal.timeout(TIMEOUT),
        });
      } catch (err) {
        console.warn(`⚠️  Consulta DANFE ${caminho}: sem resposta (${err.cause?.code || err.name}: ${err.cause?.message || err.message})`);
        throw new ErroConsulta('rede', MENSAGENS.rede, 0);
      }
      if (resp.ok && resp.status !== 202) return resp;

      const corpo = await resp.text().catch(() => '');
      registrarFalha(caminho, resp, corpo);
      const ra = resp.headers.get('retry-after');
      const retryAfter = ra != null && ra.trim() !== '' ? Number(ra) : NaN;
      if (resp.status === 429 || resp.status === 503) {
        const espera = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : resp.status === 429 ? 60 : 5;
        if (tentativa === 0 && espera <= 5) { await esperar(espera * 1000); continue; }
        if (resp.status === 429) pausaAte = Date.now() + espera * 1000;
      }

      const codigo = resp.headers.get('x-error-code') || (resp.status === 429 ? 'limite' : resp.status === 202 ? 'pendente' : `http_${resp.status}`);
      let mensagem = MENSAGENS[codigo];
      if (!mensagem) {
        try { mensagem = JSON.parse(corpo).message; } catch { /* corpo não é JSON */ }
      }
      throw new ErroConsulta(codigo, mensagem || 'Falha na consulta da nota.', resp.status,
        resp.status === 429 ? segundosParaLiberar() : (Number.isFinite(retryAfter) ? retryAfter : null));
    }
  });
}

const ePDF = buf => buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-';

// Consulta pela chave: devolve { xml: Buffer, pdf: Buffer }
async function consultarChave(chave) {
  const resp = await requisitar('/api/v1/consulta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ chave, format: 'json' }),
  });
  const dados = await resp.json();
  if (dados.status !== 'ok') throw new ErroConsulta(dados.status || 'resposta_inesperada', 'Resposta inesperada da consulta.', resp.status);
  const xml = dados.xml_base64 ? Buffer.from(dados.xml_base64, 'base64') : dados.xml ? Buffer.from(dados.xml, 'utf8') : null;
  const pdf = dados.pdf_base64 ? Buffer.from(dados.pdf_base64, 'base64') : null;
  if (!xml && !pdf) throw new ErroConsulta('resposta_vazia', 'A consulta não trouxe a nota.', resp.status);
  return { xml, pdf: pdf && ePDF(pdf) ? pdf : null };
}

// DANFE em PDF a partir do XML (qualquer data)
async function gerarDanfe(xmlBuffer) {
  const form = new FormData();
  form.append('xml', new Blob([xmlBuffer], { type: 'application/xml' }), 'nota.xml');
  form.append('format', 'pdf');
  const resp = await requisitar('/api/v1/danfe', { method: 'POST', body: form, headers: { Accept: 'application/pdf' } });
  const pdf = Buffer.from(await resp.arrayBuffer());
  if (!ePDF(pdf)) throw new ErroConsulta('pdf_corrompido', 'O serviço devolveu um PDF inválido.', resp.status);
  return pdf;
}

// Ano/mês de hoje no fuso de Brasília
function hojeBrasil(agora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora).map(x => [x.type, x.value]));
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day) };
}

// A consulta pela chave só busca notas emitidas no mês corrente, ou no mês anterior até o dia 15.
// Conferimos aqui (a chave traz AAMM da emissão) para não gastar requisições que vão falhar.
function dentroDaJanela(chave, agora = new Date()) {
  const aamm = /^\d{2}(\d{2})(\d{2})/.exec(chave || '');
  if (!aamm) return false;
  const emissao = 2000 + Number(aamm[1]), mesEmissao = Number(aamm[2]);
  const { ano, mes, dia } = hojeBrasil(agora);
  if (emissao === ano && mesEmissao === mes) return true;
  const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  return dia <= 15 && emissao === anterior.ano && mesEmissao === anterior.mes;
}

// Só NF-e (modelo 55) pode ser consultada pela chave
const eChaveNFe = chave => /^[0-9A-Z]{44}$/.test(chave || '') && chave.slice(20, 22) === '55';
const podeConsultar = (chave, agora) => ativa() && eChaveNFe(chave) && dentroDaJanela(chave, agora);

// Diagnóstico (painel do admin): uma requisição por IPv4 e outra por IPv6, com uma chave de DV
// inválido (a API responde na hora, sem ir à SEFAZ), mostrando o que cada caminho recebe.
function testarFamilia(familia) {
  return new Promise(resolve => {
    const url = new URL(`${BASE}/api/v1/consulta`);
    const corpo = JSON.stringify({ chave: '35261012345678000190550010001234561000000010' });
    const cliente = url.protocol === 'http:' ? http : https;
    const inicio = Date.now();
    const req = cliente.request(url, {
      method: 'POST', family: familia, timeout: 15000, autoSelectFamily: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo), 'User-Agent': 'NotasDoEstoque/1.0 (+diagnostico)' },
    }, resp => {
      let texto = '';
      resp.setEncoding('utf8');
      resp.on('data', d => { if (texto.length < 300) texto += d; });
      resp.on('end', () => {
        const h = resp.headers;
        const status = resp.statusCode;
        resolve({
          familia: `IPv${familia}`, ip: req.socket?.remoteAddress || null, status, ms: Date.now() - inicio,
          // 400 com código de validação = a API respondeu normalmente (não está limitando)
          ok: status !== 429 && status !== 403 && status < 500,
          codigo: h['x-error-code'] || null,
          ratelimit: h.ratelimit || h['x-ratelimit-remaining'] || null,
          retry_after: h['retry-after'] || null,
          servidor: h.server || null,
          corpo: texto.slice(0, 200),
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', err => resolve({ familia: `IPv${familia}`, ok: false, erro: `${err.code || ''} ${err.message}`.trim(), ms: Date.now() - inicio }));
    req.end(corpo);
  });
}

async function diagnosticar() {
  const ipv4 = await testarFamilia(4);
  const ipv6 = await testarFamilia(6);
  return {
    url: BASE, ativa: ativa(), forcar_ipv4: process.env.CONSULTA_DANFE_IPV4 !== 'false',
    pausada_por_segundos: segundosParaLiberar(), ipv4, ipv6,
  };
}

module.exports = {
  consultarChave, gerarDanfe, podeConsultar, eChaveNFe, dentroDaJanela, ativa, ErroConsulta, MENSAGENS,
  ePassageira, diagnosticar, segundosParaLiberar,
};
