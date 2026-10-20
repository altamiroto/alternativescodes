// Cliente da API Meu Danfe (https://meudanfe.com.br — documentação em /documentacao.php)
//
//   PUT  /fd/add/{chave}          busca a NF-e pela chave na SEFAZ (R$ 0,03 por nota; repetir a mesma
//                                 chave depois de encontrada é grátis e serve para ver o status)
//   GET  /fd/get/xml/{chave}      XML da nota já buscada (grátis)
//   GET  /fd/get/da/{chave}       DANFE em PDF (base64) da nota já buscada (grátis)
//   POST /fd/convert/xml-to-da    DANFE em PDF a partir do XML enviado (grátis)
//
// Regras da API que este cliente respeita: no máximo ~2 requisições por segundo, pelo menos 1 s entre
// consultas de status da mesma chave e não insistir numa chave que falhou (bloqueia a conta).
//
// Variáveis de ambiente:
//   MEUDANFE_API_KEY=...        Api-Key da Área do Cliente (sem ela a integração fica desligada)
//   MEUDANFE_URL=...            outro endereço (padrão https://api.meudanfe.com.br/v2)
//   MEUDANFE_ESPERA=30          segundos que a busca pela chave pode levar antes de desistir

const BASE = (process.env.MEUDANFE_URL || 'https://api.meudanfe.com.br/v2').replace(/\/+$/, '');
const ESPERA_MAX = (Number(process.env.MEUDANFE_ESPERA) || 30) * 1000;
const TIMEOUT = 20 * 1000;
const INTERVALO = 500;          // entre duas requisições quaisquer
const INTERVALO_STATUS = 2000;  // entre duas consultas de status da mesma chave
const BLOQUEIO_FALHA = 10 * 60 * 1000; // não repete uma chave que falhou por 10 min

const chaveApi = () => (process.env.MEUDANFE_API_KEY || '').trim();
const ativa = () => chaveApi() !== '';

class ErroMeuDanfe extends Error {
  constructor(codigo, mensagem, status) {
    super(mensagem || MENSAGENS[codigo] || codigo);
    this.codigo = codigo;
    this.status = status;
  }
}

// Mensagens para quem usa o app
const MENSAGENS = {
  nao_encontrada: 'A SEFAZ não encontrou essa nota pela chave.',
  erro_busca: 'A SEFAZ não respondeu a busca dessa nota.',
  demorou: 'A busca da nota demorou demais.',
  repetida: 'Essa chave falhou há pouco. Espere alguns minutos antes de tentar de novo.',
  chave_invalida: 'A chave de acesso não foi aceita.',
  xml_invalido: 'O XML enviado não foi aceito para gerar o DANFE.',
  api_key: 'A chave da API Meu Danfe é inválida ou foi trocada (avise o administrador).',
  saldo: 'Sem saldo na conta Meu Danfe (avise o administrador).',
  indisponivel: 'O serviço Meu Danfe está com problema no momento.',
  rede: 'Não foi possível falar com o serviço Meu Danfe.',
};

const esperar = ms => new Promise(r => setTimeout(r, ms));

// Uma requisição por vez, espaçadas
let fila = Promise.resolve();
let ultimaEm = 0;
function naFila(tarefa) {
  const vez = fila.then(async () => {
    const espera = ultimaEm + INTERVALO - Date.now();
    if (espera > 0) await esperar(espera);
    try { return await tarefa(); } finally { ultimaEm = Date.now(); }
  });
  fila = vez.catch(() => {});
  return vez;
}

function codigoDoStatus(status, paraXml) {
  if (status === 400) return paraXml ? 'xml_invalido' : 'chave_invalida';
  if (status === 401 || status === 403) return 'api_key';
  if (status === 402) return 'saldo';
  if (status === 404) return 'nao_encontrada';
  return 'indisponivel';
}

function requisitar(metodo, caminho, { corpo, paraXml } = {}) {
  return naFila(async () => {
    let resp;
    try {
      resp = await fetch(`${BASE}${caminho}`, {
        method: metodo,
        headers: { 'Api-Key': chaveApi(), Accept: 'application/json', ...(corpo ? { 'Content-Type': 'text/plain' } : {}) },
        body: corpo,
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (err) {
      console.warn(`⚠️  Meu Danfe ${metodo} ${caminho}: sem resposta (${err.cause?.code || err.name})`);
      throw new ErroMeuDanfe('rede', null, 0);
    }
    if (resp.ok) return resp.json();
    const texto = await resp.text().catch(() => '');
    console.warn(`⚠️  Meu Danfe ${metodo} ${caminho}: HTTP ${resp.status} ${texto.slice(0, 160)}`);
    throw new ErroMeuDanfe(codigoDoStatus(resp.status, paraXml), null, resp.status);
  });
}

const ePDF = buf => buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-';

const falhasRecentes = new Map(); // chave → quando falhou

// Busca a nota pela chave e devolve { xml: Buffer, pdf: Buffer|null }
async function buscarNota(chave) {
  const falhou = falhasRecentes.get(chave);
  if (falhou && Date.now() - falhou < BLOQUEIO_FALHA) throw new ErroMeuDanfe('repetida');
  const marcarFalha = err => {
    if (['nao_encontrada', 'erro_busca'].includes(err.codigo)) falhasRecentes.set(chave, Date.now());
    throw err;
  };

  const limite = Date.now() + ESPERA_MAX;
  for (;;) {
    const r = await requisitar('PUT', `/fd/add/${chave}`).catch(marcarFalha);
    if (r.status === 'OK') break;
    if (r.status === 'NOT_FOUND') marcarFalha(new ErroMeuDanfe('nao_encontrada'));
    if (r.status === 'ERROR') marcarFalha(new ErroMeuDanfe('erro_busca'));
    // WAITING / SEARCHING: a SEFAZ ainda está respondendo
    if (Date.now() + INTERVALO_STATUS > limite) throw new ErroMeuDanfe('demorou');
    await esperar(INTERVALO_STATUS);
  }
  falhasRecentes.delete(chave);

  const xml = await requisitar('GET', `/fd/get/xml/${chave}`);
  if (!xml?.data) throw new ErroMeuDanfe('indisponivel');
  let pdf = null;
  try {
    const da = await requisitar('GET', `/fd/get/da/${chave}`);
    pdf = da?.data ? Buffer.from(da.data, 'base64') : null;
  } catch { /* sem o PDF, a nota fica com o XML (o PDF pode ser gerado depois) */ }
  return { xml: Buffer.from(xml.data, 'utf8'), pdf: pdf && ePDF(pdf) ? pdf : null };
}

// DANFE em PDF a partir do XML (grátis)
async function gerarDanfe(xmlBuffer) {
  const r = await requisitar('POST', '/fd/convert/xml-to-da', { corpo: xmlBuffer.toString('utf8'), paraXml: true });
  const pdf = r?.data ? Buffer.from(r.data, 'base64') : null;
  if (!pdf || !ePDF(pdf)) throw new ErroMeuDanfe('indisponivel');
  return pdf;
}

// Só NF-e (modelo 55) é buscada pela chave
const podeBuscar = chave => ativa() && /^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/.test(chave || '') && chave.slice(20, 22) === '55';

module.exports = { buscarNota, gerarDanfe, podeBuscar, ativa, ErroMeuDanfe, MENSAGENS };
