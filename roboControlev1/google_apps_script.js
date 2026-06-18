// ============================================================
//  ROBO CONTROLE — Google Apps Script
//  Versão: 1.0.0
//  Descrição: Recebe dados do n8n via POST e registra nas
//             abas "PIX" e "CARTAO" da planilha.
//  Como usar:
//    1. Abra o Google Planilhas e crie as abas "PIX" e "CARTAO"
//    2. Abra o menu Extensões → Apps Script
//    3. Cole este código e salve
//    4. Publicar → Implantar como app da Web
//       - Executar como: Eu mesmo
//       - Quem tem acesso: Qualquer pessoa (inclusive anônimos)
//    5. Copie a URL gerada e use no n8n
// ============================================================

// ─────────────────────────────────────────────
//  CONFIGURAÇÕES DE TAXAS
//
//  DOIS TIPOS DE PIX — não confundir:
//  • PIX_TRANSFERENCIA → comprovante de transferência bancária (tipo PIX)
//  • BANDEIRA_PIX      → pagamento via PIX na maquininha (tipo CARTAO, parcela PIX)
//
//  Lookup de taxa para CARTAO:
//    1º tenta BANDEIRA_PARCELA na aba CONFIG (ex: VISA_PIX, ELO_6)
//    2º tenta DEFAULT_PARCELA na aba CONFIG  (ex: DEFAULT_PIX, DEFAULT_6)
//    3º cai nos valores abaixo como último fallback
//
//  Para adicionar nova bandeira: basta inserir linhas na aba CONFIG
//  com chave NOVABANDEIRA_PIX, NOVABANDEIRA_DEBITO, NOVABANDEIRA_1, etc.
// ─────────────────────────────────────────────

// Fallback hardcoded (usado só se a aba CONFIG não existir ou não tiver a chave)
const TAXAS = {
  // PIX Transferência bancária (comprovante de banco)
  "PIX_TRANSFERENCIA": 0.0,

  // Cartão — taxas padrão por parcela (DEFAULT)
  // Bandeiras individuais devem ser configuradas na aba CONFIG
  "DEFAULT_PIX":    1.5,   // PIX na maquininha
  "DEFAULT_DEBITO": 2.5,   // Débito
  "DEFAULT_AVISTA": 5.0,   // À vista / crédito 1x
  "DEFAULT_1":      5.0,
  "DEFAULT_2":      6.0,
  "DEFAULT_3":      7.0,
  "DEFAULT_4":      7.5,
  "DEFAULT_5":      8.0,
  "DEFAULT_6":      9.0,
  "DEFAULT_7":      9.5,
  "DEFAULT_8":     10.0,
  "DEFAULT_9":     10.5,
  "DEFAULT_10":    11.5,
  "DEFAULT_11":    12.0,
  "DEFAULT_12":    12.5,
  "DEFAULT_13":    13.5,
  "DEFAULT_14":    14.5,
  "DEFAULT_15":    15.0,
  "DEFAULT_16":    15.5,
  "DEFAULT_17":    16.0,
  "DEFAULT_18":    17.0,
};

// ─────────────────────────────────────────────
//  NOMES DAS ABAS
// ─────────────────────────────────────────────
const ABA_PIX    = "PIX";
const ABA_CARTAO = "CARTAO";
const ABA_CONFIG = "CONFIG";
const ABA_GRUPOS = "GRUPOS"; // mapeia cada grupo para um perfil de taxas
const ABA_CAIXA  = "CAIXA_MANUAL"; // Entradas e Retiradas manuais

// ─────────────────────────────────────────────
//  CABEÇALHOS
// ─────────────────────────────────────────────
const CABECALHO_PIX = [
  "ID",                          // UUID único por registro
  "Timestamp Registro",
  "Grupo",
  "ID Grupo",
  "Horário da Mensagem",
  "ID Remetente",
  "Tipo",
  "Banco de Origem",
  "Nome do Pagador",
  "Banco de Destino",
  "Nome do Recebedor",
  "Código de Identificação",
  "Data do Comprovante",
  "Hora do Comprovante",
  "Código de Autenticação",
  "Taxa (%)",
  "Valor Bruto (R$)",
  "Valor Taxa (R$)",
  "Valor Líquido (R$)",
  "Status"
];

const CABECALHO_CARTAO = [
  "ID",                          // UUID único por registro
  "Timestamp Registro",
  "Grupo",
  "ID Grupo",
  "Horário da Mensagem",
  "ID Remetente",
  "Tipo",
  "Banco",
  "Empresa da Maquininha",
  "Bandeira",
  "Parcelas",
  "Autenticação / NSU",
  "Data do Comprovante",
  "Hora do Comprovante",
  "Taxa (%)",
  "Valor Bruto (R$)",
  "Valor Taxa (R$)",
  "Valor Taxa (R$)",
  "Valor Líquido (R$)",
  "Status"
];

const CABECALHO_CAIXA = [
  "ID",
  "Timestamp Registro",
  "Grupo",
  "ID Grupo",
  "ID Remetente",
  "Tipo",              // ENTRADA ou RETIRADA
  "Valor (R$)",
  "Motivo",
  "Status"
];

// ─────────────────────────────────────────────
//  ENTRY POINT — GET (health check)
// ─────────────────────────────────────────────
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", message: "RoboControle API ativa" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────
//  ENTRY POINT — POST (recebe dados do n8n)
// ─────────────────────────────────────────────
function doPost(e) {
  // Inicializa a Catraca (Lock) do Google Scripts
  const lock = LockService.getScriptLock();
  
  // Espera até 30 segundos (30000 ms) para que outras execuções terminem.
  // Se demorar mais que 30s na fila (quase impossível), ele aborta.
  if (!lock.tryLock(30000)) {
    return responder(false, null, "O sistema está recebendo muitas requisições simultâneas. Tente novamente em instantes.");
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    const action  = payload.action || "";
    
    if (action === "fechamento") {
      return gerarFechamento();
    }
    
    if (action === "comando_admin") {
      return processarComandoAdmin(payload);
    }
    
    const tipo = (payload.tipo || "").toUpperCase().trim();

    if (tipo === "PIX") {
      return registrarPIX(payload);
    } else if (tipo === "CARTAO" || tipo === "CARTÃO" || tipo === "VENDA CARTAO" || tipo === "VENDA CARTÃO") {
      return registrarCartao(payload);
    } else {
      return responder(false, null, "Tipo desconhecido: " + tipo);
    }

  } catch (err) {
    return responder(false, null, "Erro interno no script: " + err.message);
  } finally {
    // É obrigatório liberar a catraca no final, mesmo se der erro no meio do caminho
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────
//  FECHAMENTO DO DIA
// ─────────────────────────────────────────────
function gerarFechamento() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaPix = ss.getSheetByName(ABA_PIX);
  const abaCartao = ss.getSheetByName(ABA_CARTAO);
  const abaCaixa = ss.getSheetByName(ABA_CAIXA);
  
  const hoje = new Date();
  const hojeStr = Utilities.formatDate(hoje, "America/Sao_Paulo", "dd/MM/yyyy");
  
  const grupos = {}; 
  
  function processarAba(aba, colGrupo, colBruto, colTaxa, colLiq, colNomeGrupo) {
    if (!aba) return;
    const dados = aba.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      const linha = dados[i];
      const dataReg = linha[1]; // Timestamp Registro
      const status = (linha[linha.length - 1] || "").toString().toUpperCase();
      
      if (status.includes("CANCELADO") || status.includes("ESTORNADO")) continue;
      
      let dataStr = "";
      
      if (dataReg instanceof Date) {
        dataStr = Utilities.formatDate(dataReg, "America/Sao_Paulo", "dd/MM/yyyy");
      } else if (typeof dataReg === "string" && dataReg.length >= 10) {
        dataStr = dataReg.substring(0, 10);
      }
      
      if (dataStr === hojeStr) {
        const grupoId = linha[colGrupo];
        const grupoNome = linha[colNomeGrupo];
        if (!grupoId) continue;
        
        if (!grupos[grupoId]) {
          grupos[grupoId] = { recebido: 0, pago: 0, taxas: 0, liquido: 0, transacoes: 0, grupoNome: grupoNome, grupoId: grupoId };
        }
        grupos[grupoId].recebido += parseFloat(linha[colBruto] || 0);
        grupos[grupoId].taxas += parseFloat(linha[colTaxa] || 0);
        grupos[grupoId].liquido += parseFloat(linha[colLiq] || 0);
        grupos[grupoId].transacoes++;
      }
    }
  }
  
  // As colunas são baseadas nos arrays CABECALHO_PIX, CARTAO e CAIXA
  // Índices (começam do zero):
  // PIX: ID Grupo(3), Nome(2), Bruto(16), Taxa(17), Liq(18)
  processarAba(abaPix, 3, 16, 17, 18, 2);
  // CARTÃO: ID Grupo(3), Nome(2), Bruto(15), Taxa(16), Liq(17)
  processarAba(abaCartao, 3, 15, 16, 17, 2);
  
  // CAIXA MANUAL: ID Grupo(3), Nome(2), Tipo(5), Valor(6)
  if (abaCaixa) {
    const dadosCaixa = abaCaixa.getDataRange().getValues();
    for (let i = 1; i < dadosCaixa.length; i++) {
      const linha = dadosCaixa[i];
      const status = (linha[8] || "").toString().toUpperCase();
      if (status.includes("CANCELADO") || status.includes("ESTORNADO")) continue;
      
      const dataReg = linha[1];
      let dataStr = "";
      if (dataReg instanceof Date) {
        dataStr = Utilities.formatDate(dataReg, "America/Sao_Paulo", "dd/MM/yyyy");
      } else if (typeof dataReg === "string" && dataReg.length >= 10) {
        dataStr = dataReg.substring(0, 10);
      }
      
      if (dataStr === hojeStr) {
        const grupoId = linha[3];
        const grupoNome = linha[2];
        if (!grupoId) continue;
        if (!grupos[grupoId]) grupos[grupoId] = { recebido: 0, pago: 0, taxas: 0, liquido: 0, transacoes: 0, grupoNome: grupoNome, grupoId: grupoId };
        
        const tipo = (linha[5] || "").toString().toUpperCase();
        const valor = parseFloat(linha[6] || 0);
        
        if (tipo === "ENTRADA") {
          grupos[grupoId].recebido += valor;
          grupos[grupoId].liquido += valor;
          grupos[grupoId].transacoes++;
        } else if (tipo === "RETIRADA") {
          grupos[grupoId].pago += valor;
          grupos[grupoId].liquido -= valor;
          grupos[grupoId].transacoes++;
        }
      }
    }
  }
  
  const relatorios = Object.values(grupos).map(g => ({
    hoje: hojeStr,
    grupoId: g.grupoId,
    grupoNome: g.grupoNome,
    recebido: g.recebido,
    pago: g.pago,
    taxas: g.taxas,
    transacoes: g.transacoes,
    saldoFinal: g.liquido
  }));
  
  return responder(true, { relatorios }, null);
}

// ─────────────────────────────────────────────
//  REGISTRAR PIX
// ─────────────────────────────────────────────
function registrarPIX(d) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const aba = garantirAba(ss, ABA_PIX, CABECALHO_PIX);

  const perfil     = obterPerfilGrupo(d.grupoId);
  const taxa       = obterTaxa("PIX", null, null, perfil);
  const valorBruto = converterValorBR(d.valor);
  const valorTaxa  = parseFloat((valorBruto * taxa / 100).toFixed(2));
  const valorLiq   = parseFloat((valorBruto - valorTaxa).toFixed(2));

  const id = gerarIdCurto(); // ID curto de 5 dígitos

  // ── Verificar Duplicidade ──
  const dupCheck = verificarDuplicidade(aba, 15, d.codigoAutenticacao);
  if (dupCheck.encontrado) {
    const dataReg = dupCheck.linha[1] ? Utilities.formatDate(new Date(dupCheck.linha[1]), "America/Sao_Paulo", "dd/MM/yyyy HH:mm") : "N/D";
    const bruto = dupCheck.linha[16];
    return responder(false, { duplicadoBruto: bruto, duplicadoData: dataReg }, "COMPROVANTE_DUPLICADO");
  }

  const linha = [
    id,                              // ID
    new Date(),                      // Timestamp Registro
    d.grupoNome  || "",              // Grupo
    d.grupoId    || "",              // ID Grupo
    d.msgTimestamp || "",            // Horário da Mensagem
    d.remetenteId || "",             // ID Remetente
    "PIX",                           // Tipo
    d.bancoOrigem     || "",         // Banco de Origem
    d.nomePagador     || "",         // Nome do Pagador
    d.bancoDestino    || "",         // Banco de Destino
    d.nomeRecebedor   || "",         // Nome do Recebedor
    d.codigoIdentificacao || "",     // Código de Identificação
    d.data  || "",                   // Data do Comprovante
    d.hora  || "",                   // Hora do Comprovante
    d.codigoAutenticacao || "",      // Código de Autenticação
    taxa,                            // Taxa (%)
    valorBruto,                      // Valor Bruto
    valorTaxa,                       // Valor Taxa
    valorLiq,                        // Valor Líquido
    "OK"                             // Status
  ];

  aba.appendRow(linha);
  SpreadsheetApp.flush();

  // Verificar gravação — checa coluna ID (col 1)
  const ultimaLinha = aba.getLastRow();
  const celVerif    = aba.getRange(ultimaLinha, 1).getValue();
  if (!celVerif) {
    return responder(false, null, "Falha na verificação de gravação PIX");
  }

  // Calcular saldo atual do grupo
  const abaCartao = ss.getSheetByName(ABA_CARTAO);
  const saldoPix    = calcularSaldoGrupo(aba, d.grupoId, 4, 19);
  const saldoCartao = calcularSaldoGrupo(abaCartao, d.grupoId, 4, 18);
  const saldoTotal  = saldoPix + saldoCartao;

  return responder(true, {
    id:         id,
    tipo:       "PIX",
    taxa:       taxa,
    valorBruto: valorBruto,
    valorTaxa:  valorTaxa,
    valorLiq:   valorLiq,
    saldoPix:   saldoPix,
    saldoCartao: saldoCartao,
    saldoTotal: saldoTotal,
    bancoOrigem:    d.bancoOrigem    || "",
    nomePagador:    d.nomePagador    || "",
    bancoDestino:   d.bancoDestino   || "",
    nomeRecebedor:  d.nomeRecebedor  || "",
    data:           d.data           || "",
    hora:           d.hora           || "",
    codigoAutenticacao: d.codigoAutenticacao || "",
    grupoNome:    d.grupoNome || "",
    grupoId:      d.grupoId   || ""
  }, null);
}

// ─────────────────────────────────────────────
//  REGISTRAR CARTÃO
// ─────────────────────────────────────────────
function registrarCartao(d) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const aba = garantirAba(ss, ABA_CARTAO, CABECALHO_CARTAO);

  // ── Bandeira é obrigatória ──
  const bandeiraBruta = (d.bandeira || "").toString().trim();
  if (!bandeiraBruta) {
    return responder(false, null, "BANDEIRA_NAO_IDENTIFICADA");
  }

  const bandeira = bandeiraBruta.toUpperCase().replace(/\s/g, "");
  const parcela  = normalizarParcela(d.parcelas);
  const perfil   = obterPerfilGrupo(d.grupoId);
  const taxa     = obterTaxa("CARTAO", bandeira, parcela, perfil);

  const valorBruto = converterValorBR(d.valor);
  const valorTaxa  = parseFloat((valorBruto * taxa / 100).toFixed(2));
  const valorLiq   = parseFloat((valorBruto - valorTaxa).toFixed(2));

  const id = gerarIdCurto(); // ID curto de 5 dígitos

  // ── Verificar Duplicidade ──
  // A IA pode confundir e enviar codigoAutenticacao ao invés de autenticacao
  const authCode = d.autenticacao || d.codigoAutenticacao || "";
  const dupCheck = verificarDuplicidade(aba, 12, authCode);
  if (dupCheck.encontrado) {
    const dataReg = dupCheck.linha[1] ? Utilities.formatDate(new Date(dupCheck.linha[1]), "America/Sao_Paulo", "dd/MM/yyyy HH:mm") : "N/D";
    const bruto = dupCheck.linha[15];
    return responder(false, { duplicadoBruto: bruto, duplicadoData: dataReg }, "COMPROVANTE_DUPLICADO");
  }

  const linha = [
    id,                               // ID
    new Date(),                       // Timestamp Registro
    d.grupoNome  || "",               // Grupo
    d.grupoId    || "",               // ID Grupo
    d.msgTimestamp || "",             // Horário da Mensagem
    d.remetenteId || "",              // ID Remetente
    "Venda Cartão",                   // Tipo
    d.banco      || "",               // Banco
    d.empresaMaquininha || "",        // Empresa da Maquininha
    d.bandeira   || "",               // Bandeira
    d.parcelas   || "",               // Parcelas
    authCode,                         // Autenticação / NSU
    d.data       || "",               // Data do Comprovante
    d.hora       || "",               // Hora do Comprovante
    taxa,                             // Taxa (%)
    valorBruto,                       // Valor Bruto
    valorTaxa,                        // Valor Taxa
    valorLiq,                         // Valor Líquido
    "OK"                              // Status
  ];

  aba.appendRow(linha);
  SpreadsheetApp.flush();

  // Verificar gravação — checa coluna ID (col 1)
  const ultimaLinha = aba.getLastRow();
  const celVerif    = aba.getRange(ultimaLinha, 1).getValue();
  if (!celVerif) {
    return responder(false, null, "Falha na verificação de gravação CARTAO");
  }

  // Calcular saldo atual do grupo
  const abaPix = ss.getSheetByName(ABA_PIX);
  const saldoCartao = calcularSaldoGrupo(aba, d.grupoId, 4, 18);
  const saldoPix    = calcularSaldoGrupo(abaPix, d.grupoId, 4, 19);
  const saldoTotal  = saldoPix + saldoCartao;

  return responder(true, {
    id:         id,
    tipo:       "CARTAO",
    taxa:       taxa,
    valorBruto: valorBruto,
    valorTaxa:  valorTaxa,
    valorLiq:   valorLiq,
    saldoPix:   saldoPix,
    saldoCartao: saldoCartao,
    saldoTotal: saldoTotal,
    banco:      d.banco   || "",
    empresaMaquininha: d.empresaMaquininha || "",
    bandeira:   d.bandeira   || "",
    parcelas:   d.parcelas   || "",
    autenticacao: d.autenticacao || "",
    data:       d.data       || "",
    hora:       d.hora       || "",
    grupoNome:  d.grupoNome  || "",
    grupoId:    d.grupoId    || ""
  }, null);
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

/**
 * Garante que a aba existe e tem cabeçalho.
 */
function garantirAba(ss, nomeAba, cabecalho) {
  let aba = ss.getSheetByName(nomeAba);
  if (!aba) {
    aba = ss.insertSheet(nomeAba);
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
    aba.getRange(1, 1, 1, cabecalho.length)
      .setFontWeight("bold")
      .setBackground("#1a73e8")
      .setFontColor("#ffffff");
    aba.setFrozenRows(1);
  }
  // Garante cabeçalho se aba vazia
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }
  return aba;
}

/**
 * obterPerfilGrupo(grupoId)
 * Consulta a aba GRUPOS e retorna o Perfil de Taxa do grupo.
 * Se o grupo não estiver na aba, retorna null (usa taxas globais).
 */
function obterPerfilGrupo(grupoId) {
  if (!grupoId) return null;
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA_GRUPOS);
    if (!aba || aba.getLastRow() < 2) return null;
    const dados = aba.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      const gid = (dados[i][0] || "").toString().trim();
      if (gid === grupoId.toString().trim()) {
        const perfil = (dados[i][2] || "").toString().trim().toUpperCase();
        return perfil || null;
      }
    }
  } catch(_) {}
  return null;
}

/**
 * obterTaxa(tipo, bandeira, parcela, perfil)
 * - tipo   : "PIX" (transferência) ou "CARTAO"
 * - bandeira: ex "VISA", "ELO" (cartão)
 * - parcela : ex "PIX", "DEBITO", "1", "6"
 * - perfil  : ex "PERFIL_A" ou null (sem perfil = taxas globais)
 *
 * Prioridade de lookup (CARTAO com perfil):
 *   1. CONFIG[PERFIL_BANDEIRA_PARCELA]  ex: PERFIL_A_VISA_6
 *   2. CONFIG[PERFIL_DEFAULT_PARCELA]   ex: PERFIL_A_DEFAULT_6
 *   3. CONFIG[BANDEIRA_PARCELA]         ex: VISA_6
 *   4. CONFIG[DEFAULT_PARCELA]          ex: DEFAULT_6
 *   5. TAXAS[DEFAULT_PARCELA]           fallback hardcoded
 *
 * Prioridade de lookup (PIX com perfil):
 *   1. CONFIG[PERFIL_PIX_TRANSFERENCIA] ex: PERFIL_A_PIX_TRANSFERENCIA
 *   2. CONFIG[PIX_TRANSFERENCIA]        global
 *   3. TAXAS[PIX_TRANSFERENCIA]         fallback hardcoded
 */
function obterTaxa(tipo, bandeira, parcela, perfil) {
  // ── PIX Transferência bancária ──
  if (tipo === "PIX") {
    if (perfil) {
      const cfgPerfil = lerConfigTaxa(perfil + "_PIX_TRANSFERENCIA");
      if (cfgPerfil !== null) return cfgPerfil;
    }
    const cfg = lerConfigTaxa("PIX_TRANSFERENCIA");
    return cfg !== null ? cfg : (TAXAS["PIX_TRANSFERENCIA"] || 0);
  }

  // ── CARTAO ──
  const b = bandeira || "DEFAULT";
  const p = parcela  || "AVISTA";

  if (perfil) {
    // 1. Perfil + bandeira específica
    const c1 = lerConfigTaxa(perfil + "_" + b + "_" + p);
    if (c1 !== null) return c1;
    // 2. Perfil + DEFAULT
    const c2 = lerConfigTaxa(perfil + "_DEFAULT_" + p);
    if (c2 !== null) return c2;
  }

  // 3. Bandeira específica global
  const c3 = lerConfigTaxa(b + "_" + p);
  if (c3 !== null) return c3;

  // 4. DEFAULT global
  const chaveDefault = "DEFAULT_" + p;
  const c4 = lerConfigTaxa(chaveDefault);
  if (c4 !== null) return c4;

  // 5. Fallback hardcoded
  return TAXAS[chaveDefault] || TAXAS["DEFAULT_AVISTA"] || 0;
}

/** Lê uma chave da aba CONFIG. Retorna null se não encontrar. */
function lerConfigTaxa(chave) {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const cfg = ss.getSheetByName(ABA_CONFIG);
    if (!cfg || cfg.getLastRow() < 2) return null;
    const dados = cfg.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      if ((dados[i][0] || "").toString().toUpperCase() === chave.toUpperCase()) {
        const t = parseFloat(dados[i][1]);
        return isNaN(t) ? null : t;
      }
    }
  } catch(_) {}
  return null;
}

/**
 * Normaliza a parcela para chave de taxa.
 */
function normalizarParcela(parcela) {
  if (!parcela) return "AVISTA";
  const p = parcela.toString().toUpperCase().replace(/\s/g, "");
  if (p === "AVISTA" || p === "ÀVISTA" || p === "CREDITO" || p === "CRÉDITO") return "AVISTA";
  if (p === "DEBITO" || p === "DÉBITO") return "DEBITO";
  if (p === "PIX") return "PIX"; // PIX na maquininha — categoria própria, taxa separada do PIX transferência
  const num = parseInt(p.replace(/\D/g, ""), 10);
  if (!isNaN(num) && num >= 1) return num.toString();
  return "AVISTA";
}

/**
 * Soma os valores líquidos do grupo na coluna especificada.
 */
function calcularSaldoGrupo(aba, grupoId, colunaGrupoId, colunaValorLiq) {
  if (!grupoId || aba.getLastRow() < 2) return 0;
  const dados = aba.getDataRange().getValues();
  let saldo = 0;
  for (let i = 1; i < dados.length; i++) {
    const gid = (dados[i][colunaGrupoId - 1] || "").toString().trim();
    const val = parseFloat(dados[i][colunaValorLiq - 1]) || 0;
    const status = (dados[i][dados[i].length - 1] || "").toString().toUpperCase();
    
    if (gid === grupoId.toString().trim() && !status.includes("CANCELADO") && !status.includes("ESTORNADO")) {
      saldo += val;
    }
  }
  
  // Adiciona Caixa Manual se existir
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaCaixa = ss.getSheetByName(ABA_CAIXA);
  if (abaCaixa && abaCaixa.getLastRow() >= 2) {
    const dadosCaixa = abaCaixa.getDataRange().getValues();
    for (let i = 1; i < dadosCaixa.length; i++) {
      const gid = (dadosCaixa[i][3] || "").toString().trim();
      const tipo = (dadosCaixa[i][5] || "").toString().toUpperCase();
      const val = parseFloat(dadosCaixa[i][6]) || 0;
      const status = (dadosCaixa[i][8] || "").toString().toUpperCase();
      
      if (gid === grupoId.toString().trim() && !status.includes("CANCELADO") && !status.includes("ESTORNADO")) {
        // Se a aba for CARTAO, a aba Caixa não entra no saldo de Cartão (entra no Pix/Geral)
        // Mas a função não sabe qual é a aba, então vamos somar apenas na aba PIX (caixa geral)
        if (aba.getName() === ABA_PIX) {
          if (tipo === "ENTRADA") saldo += val;
          if (tipo === "RETIRADA") saldo -= val;
        }
      }
    }
  }
  
  return parseFloat(saldo.toFixed(2));
}

/**
 * Verifica se já existe um comprovante com a mesma autenticação.
 * Ignora linhas marcadas como "CANCELADO" ou "ESTORNADO" na coluna Status.
 */
function verificarDuplicidade(aba, colunaAutenticacao, codigoAutenticacao) {
  if (!codigoAutenticacao) return false;
  
  // Remove zeros à esquerda (apenas se for seguido de outro número) para evitar que o Google Sheets desconfigure
  let codigoLimpo = codigoAutenticacao.toString().trim().toUpperCase();
  codigoLimpo = codigoLimpo.replace(/^0+(?=\d)/, '');
  
  if (codigoLimpo === "" || codigoLimpo === "N/D" || codigoLimpo === "NULL") return false;
  
  if (aba.getLastRow() < 2) return false;
  const dados = aba.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    // Busca em TODAS as colunas da linha para evitar erros de desalinhamento na planilha
    let encontrouCodigo = false;
    for (let c = 0; c < dados[i].length; c++) {
      let celula = (dados[i][c] || "").toString().trim().toUpperCase();
      celula = celula.replace(/^0+(?=\d)/, '');
      
      if (celula === codigoLimpo) {
        encontrouCodigo = true;
        break;
      }
    }

    if (encontrouCodigo) {
      // Verifica o status da mesma linha (sempre a última coluna)
      const status = (dados[i][dados[i].length - 1] || "").toString().toUpperCase();
      if (status !== "CANCELADO" && status !== "ESTORNADO") {
        return { encontrado: true, linha: dados[i] };
      }
    }
  }
  return { encontrado: false };
}

/**
 * Formata resposta padrão JSON.
 */
function responder(sucesso, dados, erro) {
  const r = { sucesso: sucesso };
  if (dados) r.dados  = dados;
  if (erro)  r.erro   = erro;
  return ContentService
    .createTextOutput(JSON.stringify(r))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────
//  PROCESSAR COMANDOS ADMIN
// ─────────────────────────────────────────────
function processarComandoAdmin(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const comando = (d.comando || "").toLowerCase().trim(); // "cancelar", "entrada", "retirada"
  const idAlvo = (d.idAlvo || "").toString().trim().toUpperCase();
  const valor = converterValorBR(d.valor);
  const motivo = (d.motivo || "").toString().trim();
  const remetenteId = d.remetenteId || "Admin";

  if (comando === "cancelar") {
    if (!idAlvo) return responder(false, null, "Para cancelar, você precisa informar o ID. Exemplo: /cancelar X7K2A Motivo do erro");
    if (!motivo) return responder(false, null, "Para cancelar, você precisa justificar. Exemplo: /cancelar X7K2A Cliente pediu estorno");
    let encontrado = false;
    let valorCancelado = 0;
    
    // Procura nas 3 abas
    [ABA_PIX, ABA_CARTAO, ABA_CAIXA].forEach(nomeAba => {
      const aba = ss.getSheetByName(nomeAba);
      if (!aba || encontrado) return;
      
      const dados = aba.getDataRange().getValues();
      for (let i = 1; i < dados.length; i++) {
        if ((dados[i][0] || "").toString().trim().toUpperCase() === idAlvo) {
          const statusAtual = (dados[i][dados[i].length - 1] || "").toString().toUpperCase();
          if (statusAtual.includes("CANCELADO") || statusAtual.includes("ESTORNADO")) {
            encontrado = "ja_cancelado";
            break;
          }
          
          if (nomeAba === ABA_PIX) {
            valorCancelado = parseFloat(dados[i][18]) || 0;
          } else if (nomeAba === ABA_CARTAO) {
            valorCancelado = parseFloat(dados[i][17]) || 0;
          } else if (nomeAba === ABA_CAIXA) {
            valorCancelado = parseFloat(dados[i][6]) || 0;
            if ((dados[i][5] || "").toString().toUpperCase() === "RETIRADA") {
              valorCancelado = -valorCancelado;
            }
          }
          
          const dataAtual = Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy HH:mm");
          aba.getRange(i + 1, dados[i].length).setValue(`CANCELADO em ${dataAtual}: ${motivo} (Por: ${remetenteId})`);
          encontrado = true;
          break;
        }
      }
    });

    if (encontrado === "ja_cancelado") {
      return responder(false, null, `O lançamento ${idAlvo} já estava cancelado anteriormente.`);
    } else if (encontrado === true) {
      // Calcular novo saldo geral para responder
      const abaPix = ss.getSheetByName(ABA_PIX);
      const abaCartao = ss.getSheetByName(ABA_CARTAO);
      const saldoCartao = abaCartao ? calcularSaldoGrupo(abaCartao, d.grupoId, 4, 18) : 0;
      const saldoPix = abaPix ? calcularSaldoGrupo(abaPix, d.grupoId, 4, 19) : 0;
      const saldoTotal = saldoPix + saldoCartao;
      const saldoAnterior = saldoTotal + valorCancelado;
      
      return responder(true, { 
        saldoTotal: saldoTotal,
        saldoPix: saldoPix,
        saldoCartao: saldoCartao,
        saldoAnterior: saldoAnterior,
        valorOperacao: Math.abs(valorCancelado),
        msg: `✅ Lançamento *${idAlvo}* CANCELADO com sucesso.` 
      }, null);
    } else {
      return responder(false, null, `Lançamento ${idAlvo} não encontrado.`);
    }
  } 
  
  else if (comando === "entrada" || comando === "retirada") {
    if (valor <= 0) {
      return responder(false, null, `Erro de formatação. O formato correto é: /${comando} 150,00 Pagamento fornecedor`);
    }
    if (!motivo) {
      return responder(false, null, `Você precisa informar o motivo. Exemplo: /${comando} 150,00 Compra de material`);
    }

    const aba = garantirAba(ss, ABA_CAIXA, CABECALHO_CAIXA);
    const id = gerarIdCurto();
    const linha = [
      id,
      new Date(),
      d.grupoNome || "",
      d.grupoId || "",
      remetenteId,
      comando.toUpperCase(),
      valor,
      motivo,
      "OK"
    ];
    aba.appendRow(linha);
    SpreadsheetApp.flush();
    
    // Calcular novo saldo geral para responder
    const abaPix = ss.getSheetByName(ABA_PIX);
    const abaCartao = ss.getSheetByName(ABA_CARTAO);
    const saldoCartao = abaCartao ? calcularSaldoGrupo(abaCartao, d.grupoId, 4, 18) : 0;
    const saldoPix = abaPix ? calcularSaldoGrupo(abaPix, d.grupoId, 4, 19) : 0;
    const saldoTotal = saldoPix + saldoCartao;
    
    let saldoAnterior = 0;
    if (comando === "entrada") {
      saldoAnterior = saldoTotal - valor;
    } else {
      saldoAnterior = saldoTotal + valor;
    }
    
    return responder(true, { 
      id: id,
      tipo: comando.toUpperCase(),
      valorOperacao: valor,
      saldoTotal: saldoTotal,
      saldoPix: saldoPix,
      saldoCartao: saldoCartao,
      saldoAnterior: saldoAnterior,
      msg: `✅ *${comando.toUpperCase()}* registrada com sucesso!` 
    }, null);
  }

  return responder(false, null, "Comando desconhecido.");
}

// ─────────────────────────────────────────────
//  ABA CONFIG — criada automaticamente se não existir
//  Colunas: Chave | Taxa (%)
//  Exemplo: PIX | 0
//           VISA_1 | 1.99
// ─────────────────────────────────────────────
function criarAbaConfig() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let cfg   = ss.getSheetByName(ABA_CONFIG);
  if (!cfg) {
    cfg = ss.insertSheet(ABA_CONFIG);
  }
  cfg.clearContents();

  // ══════════════════════════════════════════════════════════════════
  //  COMO USAR ESTA ABA:
  //  • Coluna A = Chave (não altere o formato)
  //  • Coluna B = Taxa em % (ex: 1.5 = 1,5%)
  //  • Coluna C = Descrição (apenas informativa)
  //
  //  Para adicionar nova bandeira (ex: NOVA):
  //    Adicione linhas: NOVA_PIX, NOVA_DEBITO, NOVA_AVISTA, NOVA_1 ... NOVA_18
  //
  //  PIX_TRANSFERENCIA = taxa do comprovante bancário PIX (tipo PIX)
  //  BANDEIRA_PIX      = taxa quando a maquininha cobra via PIX
  // ══════════════════════════════════════════════════════════════════
  const entradas = [
    // ── PIX Transferência Bancária (comprovante de banco) ──────────
    ["PIX_TRANSFERENCIA", 0.0,  "PIX - Transferência bancária (padrão 0%)"],

    // ── VISA ────────────────────────────────────────────────────────
    ["VISA_PIX",    1.5,  "Visa - PIX na maquininha"],
    ["VISA_DEBITO", 2.5,  "Visa - Débito"],
    ["VISA_AVISTA", 5.0,  "Visa - À vista / crédito 1x"],
    ["VISA_1",      5.0,  "Visa - 1x"],
    ["VISA_2",      6.0,  "Visa - 2x"],
    ["VISA_3",      7.0,  "Visa - 3x"],
    ["VISA_4",      7.5,  "Visa - 4x"],
    ["VISA_5",      8.0,  "Visa - 5x"],
    ["VISA_6",      9.0,  "Visa - 6x"],
    ["VISA_7",      9.5,  "Visa - 7x"],
    ["VISA_8",     10.0,  "Visa - 8x"],
    ["VISA_9",     10.5,  "Visa - 9x"],
    ["VISA_10",    11.5,  "Visa - 10x"],
    ["VISA_11",    12.0,  "Visa - 11x"],
    ["VISA_12",    12.5,  "Visa - 12x"],
    ["VISA_13",    13.5,  "Visa - 13x"],
    ["VISA_14",    14.5,  "Visa - 14x"],
    ["VISA_15",    15.0,  "Visa - 15x"],
    ["VISA_16",    15.5,  "Visa - 16x"],
    ["VISA_17",    16.0,  "Visa - 17x"],
    ["VISA_18",    17.0,  "Visa - 18x"],

    // ── MASTERCARD ──────────────────────────────────────────────────
    ["MASTER_PIX",    1.5,  "Master - PIX na maquininha"],
    ["MASTER_DEBITO", 2.5,  "Master - Débito"],
    ["MASTER_AVISTA", 5.0,  "Master - À vista / crédito 1x"],
    ["MASTER_1",      5.0,  "Master - 1x"],
    ["MASTER_2",      6.0,  "Master - 2x"],
    ["MASTER_3",      7.0,  "Master - 3x"],
    ["MASTER_4",      7.5,  "Master - 4x"],
    ["MASTER_5",      8.0,  "Master - 5x"],
    ["MASTER_6",      9.0,  "Master - 6x"],
    ["MASTER_7",      9.5,  "Master - 7x"],
    ["MASTER_8",     10.0,  "Master - 8x"],
    ["MASTER_9",     10.5,  "Master - 9x"],
    ["MASTER_10",    11.5,  "Master - 10x"],
    ["MASTER_11",    12.0,  "Master - 11x"],
    ["MASTER_12",    12.5,  "Master - 12x"],
    ["MASTER_13",    13.5,  "Master - 13x"],
    ["MASTER_14",    14.5,  "Master - 14x"],
    ["MASTER_15",    15.0,  "Master - 15x"],
    ["MASTER_16",    15.5,  "Master - 16x"],
    ["MASTER_17",    16.0,  "Master - 17x"],
    ["MASTER_18",    17.0,  "Master - 18x"],

    // ── ELO ─────────────────────────────────────────────────────────
    ["ELO_PIX",    3.5,  "Elo - PIX na maquininha (+2%)"],
    ["ELO_DEBITO", 4.5,  "Elo - Débito (+2%)"],
    ["ELO_AVISTA", 7.0,  "Elo - À vista (+2%)"],
    ["ELO_1",      7.0,  "Elo - 1x"],
    ["ELO_2",      8.0,  "Elo - 2x"],
    ["ELO_3",      9.0,  "Elo - 3x"],
    ["ELO_4",      9.5,  "Elo - 4x"],
    ["ELO_5",     10.0,  "Elo - 5x"],
    ["ELO_6",     11.0,  "Elo - 6x"],
    ["ELO_7",     11.5,  "Elo - 7x"],
    ["ELO_8",     12.0,  "Elo - 8x"],
    ["ELO_9",     12.5,  "Elo - 9x"],
    ["ELO_10",    13.5,  "Elo - 10x"],
    ["ELO_11",    14.0,  "Elo - 11x"],
    ["ELO_12",    14.5,  "Elo - 12x"],
    ["ELO_13",    15.5,  "Elo - 13x"],
    ["ELO_14",    16.5,  "Elo - 14x"],
    ["ELO_15",    17.0,  "Elo - 15x"],
    ["ELO_16",    17.5,  "Elo - 16x"],
    ["ELO_17",    18.0,  "Elo - 17x"],
    ["ELO_18",    19.0,  "Elo - 18x"],

    // ── AMEX ────────────────────────────────────────────────────────
    ["AMEX_PIX",    3.5,  "Amex - PIX na maquininha (+2%)"],
    ["AMEX_DEBITO", 4.5,  "Amex - Débito (+2%)"],
    ["AMEX_AVISTA", 7.0,  "Amex - À vista (+2%)"],
    ["AMEX_1",      7.0,  "Amex - 1x"],
    ["AMEX_2",      8.0,  "Amex - 2x"],
    ["AMEX_3",      9.0,  "Amex - 3x"],
    ["AMEX_4",      9.5,  "Amex - 4x"],
    ["AMEX_5",     10.0,  "Amex - 5x"],
    ["AMEX_6",     11.0,  "Amex - 6x"],
    ["AMEX_7",     11.5,  "Amex - 7x"],
    ["AMEX_8",     12.0,  "Amex - 8x"],
    ["AMEX_9",     12.5,  "Amex - 9x"],
    ["AMEX_10",    13.5,  "Amex - 10x"],
    ["AMEX_11",    14.0,  "Amex - 11x"],
    ["AMEX_12",    14.5,  "Amex - 12x"],

    // ── CABAL ───────────────────────────────────────────────────────
    ["CABAL_PIX",    3.5,  "Cabal - PIX na maquininha (+2%)"],
    ["CABAL_DEBITO", 4.5,  "Cabal - Débito (+2%)"],
    ["CABAL_AVISTA", 7.0,  "Cabal - À vista (+2%)"],
    ["CABAL_1",      7.0,  "Cabal - 1x"],
    ["CABAL_2",      8.0,  "Cabal - 2x"],
    ["CABAL_3",      9.0,  "Cabal - 3x"],
    ["CABAL_6",     11.0,  "Cabal - 6x"],
    ["CABAL_12",    14.5,  "Cabal - 12x"],

    // ── HIPERCARD ───────────────────────────────────────────────────
    ["HIPERCARD_PIX",    3.5,  "Hipercard - PIX na maquininha (+2%)"],
    ["HIPERCARD_DEBITO", 4.5,  "Hipercard - Débito (+2%)"],
    ["HIPERCARD_AVISTA", 7.0,  "Hipercard - À vista (+2%)"],
    ["HIPERCARD_1",      7.0,  "Hipercard - 1x"],
    ["HIPERCARD_2",      8.0,  "Hipercard - 2x"],
    ["HIPERCARD_3",      9.0,  "Hipercard - 3x"],
    ["HIPERCARD_6",     11.0,  "Hipercard - 6x"],
    ["HIPERCARD_12",    14.5,  "Hipercard - 12x"],

    // ── PADRÃO (fallback para bandeiras não listadas) ────────────────
    ["DEFAULT_PIX",    1.5,  "Padrão - PIX na maquininha"],
    ["DEFAULT_DEBITO", 2.5,  "Padrão - Débito"],
    ["DEFAULT_AVISTA", 5.0,  "Padrão - À vista / crédito 1x"],
    ["DEFAULT_1",      5.0,  "Padrão - 1x"],
    ["DEFAULT_2",      6.0,  "Padrão - 2x"],
    ["DEFAULT_3",      7.0,  "Padrão - 3x"],
    ["DEFAULT_4",      7.5,  "Padrão - 4x"],
    ["DEFAULT_5",      8.0,  "Padrão - 5x"],
    ["DEFAULT_6",      9.0,  "Padrão - 6x"],
    ["DEFAULT_7",      9.5,  "Padrão - 7x"],
    ["DEFAULT_8",     10.0,  "Padrão - 8x"],
    ["DEFAULT_9",     10.5,  "Padrão - 9x"],
    ["DEFAULT_10",    11.5,  "Padrão - 10x"],
    ["DEFAULT_11",    12.0,  "Padrão - 11x"],
    ["DEFAULT_12",    12.5,  "Padrão - 12x"],
    ["DEFAULT_13",    13.5,  "Padrão - 13x"],
    ["DEFAULT_14",    14.5,  "Padrão - 14x"],
    ["DEFAULT_15",    15.0,  "Padrão - 15x"],
    ["DEFAULT_16",    15.5,  "Padrão - 16x"],
    ["DEFAULT_17",    16.0,  "Padrão - 17x"],
    ["DEFAULT_18",    17.0,  "Padrão - 18x"],
  ];

  const cabecalho = [["Chave", "Taxa (%)", "Descrição"]];
  const tudo = cabecalho.concat(entradas);
  cfg.getRange(1, 1, tudo.length, 3).setValues(tudo);
  cfg.getRange(1, 1, 1, 3)
    .setFontWeight("bold")
    .setBackground("#34a853")
    .setFontColor("#ffffff");
  cfg.setFrozenRows(1);
  cfg.autoResizeColumns(1, 3);
  SpreadsheetApp.flush();
  return "Aba CONFIG criada/atualizada com sucesso! " + entradas.length + " taxas configuradas.";
}

// ─────────────────────────────────────────────
//  ABA GRUPOS — criada automaticamente
//  Colunas: ID do Grupo | Nome do Grupo | Perfil de Taxa
//
//  O "Perfil de Taxa" é um prefixo usado na aba CONFIG.
//  Exemplo: perfil "PERFIL_A" ativa as chaves PERFIL_A_VISA_6, etc.
//  Grupos sem perfil cadastrado usam as taxas globais (VISA_6, DEFAULT_6).
// ─────────────────────────────────────────────
function criarAbaGrupos() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let aba   = ss.getSheetByName(ABA_GRUPOS);
  if (!aba) {
    aba = ss.insertSheet(ABA_GRUPOS);
  }
  // Não limpa conteúdo — preserva grupos já cadastrados
  if (aba.getLastRow() < 1) {
    // Só escreve cabeçalho + exemplos se a aba estiver vazia
    const dados = [
      ["ID do Grupo",                       "Nome do Grupo",   "Perfil de Taxa"],
      ["120363428466235627@g.us",            "Exemplo Grupo 1", "PERFIL_A"],
      ["557385939392@g.us",                 "Exemplo Grupo 2", "PERFIL_B"],
    ];
    aba.getRange(1, 1, dados.length, 3).setValues(dados);
    aba.getRange(1, 1, 1, 3)
      .setFontWeight("bold")
      .setBackground("#4285f4")
      .setFontColor("#ffffff");
    aba.setFrozenRows(1);
    aba.autoResizeColumns(1, 3);
    SpreadsheetApp.flush();
  }
  return [
    "Aba GRUPOS pronta!",
    "",
    "COMO USAR:",
    "1. Substitua os IDs de exemplo pelo ID real do grupo do WhatsApp",
    "   (o ID aparece nas mensagens do n8n, formato: XXXXXXXXX@g.us)",
    "2. Dê um nome amigável na coluna B",
    "3. Escolha um nome de perfil na coluna C (ex: PERFIL_A, LOJA_SUL, VIP)",
    "4. Na aba CONFIG, adicione taxas com o prefixo do perfil:",
    "   PERFIL_A_VISA_6  | 8.0  | Visa 6x para Perfil A",
    "   PERFIL_A_DEFAULT_PIX | 1.0 | PIX para todos do Perfil A",
    "",
    "Grupos NÃO listados aqui usam as taxas globais (sem prefixo)."
  ].join("\n");
}

/**
 * Gera um ID curto de 5 caracteres alfanuméricos
 * Ideal para humanos lerem e cancelarem lançamentos
 */
function gerarIdCurto() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Converte qualquer string de valor BR para float válido
 * Ex: "1.000,55" -> 1000.55 | "150.11" -> 150.11 | "150,1" -> 150.1
 */
function converterValorBR(str) {
  if (!str) return 0;
  let s = str.toString().replace(/[^\d,.-]/g, ''); // limpa lixo
  if (s.includes(',')) {
    // Se tiver vírgula, removemos todos os pontos e trocamos a vírgula por ponto
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const val = parseFloat(s);
  return isNaN(val) ? 0 : parseFloat(val.toFixed(2));
}
