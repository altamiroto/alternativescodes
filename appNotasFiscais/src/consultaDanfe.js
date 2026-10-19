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

const BASE = (process.env.CONSULTA_DANFE_URL || 'https://consultadanfe.com').replace(/\/+$/, '');
const TIMEOUT = (Number(process.env.CONSULTA_DANFE_TIMEOUT) || 30) * 1000;

const ativa = () => process.env.CONSULTA_DANFE !== 'false';

class ErroConsulta extends Error {
  constructor(codigo, mensagem, status) {
    super(mensagem || codigo);
    this.codigo = codigo;
    this.status = status;
  }
}

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

// Faz a requisição com 1 nova tentativa em 429/503 (respeitando Retry-After, até 5 s)
async function requisitar(caminho, opcoes) {
  for (let tentativa = 0; ; tentativa++) {
    let resp;
    try {
      resp = await fetch(`${BASE}${caminho}`, { ...opcoes, signal: AbortSignal.timeout(TIMEOUT) });
    } catch (err) {
      throw new ErroConsulta('rede', MENSAGENS.rede, 0);
    }
    if ((resp.status === 429 || resp.status === 503) && tentativa === 0) {
      const espera = Math.min(5, Number(resp.headers.get('retry-after')) || 1);
      await esperar(espera * 1000);
      continue;
    }
    if (resp.ok && resp.status !== 202) return resp;

    const codigo = resp.headers.get('x-error-code') || (resp.status === 429 ? 'limite' : resp.status === 202 ? 'pendente' : `http_${resp.status}`);
    let mensagem = MENSAGENS[codigo];
    if (!mensagem) {
      try { mensagem = (await resp.json()).message; } catch { /* corpo não é JSON */ }
    }
    throw new ErroConsulta(codigo, mensagem || 'Falha na consulta da nota.', resp.status);
  }
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

module.exports = { consultarChave, gerarDanfe, podeConsultar, eChaveNFe, dentroDaJanela, ativa, ErroConsulta, MENSAGENS };
