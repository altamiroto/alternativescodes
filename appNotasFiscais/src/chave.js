// Chave de acesso da NF-e / NFC-e (44 caracteres)
//
//  cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) DV(1)
//
// O CNPJ pode ser alfanumérico (a partir de 2026), por isso as posições do CNPJ
// aceitam [0-9A-Z]. No cálculo do DV cada caractere vale (código ASCII - 48).

const UFS = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

const FORMATO = /^[0-9]{6}[0-9A-Z]{14}[0-9]{24}$/;

function normalizar(texto) {
  return String(texto || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function calcularDV(c43) {
  let soma = 0;
  let peso = 2;
  for (let i = c43.length - 1; i >= 0; i--) {
    soma += (c43.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function validar(texto) {
  const c = normalizar(texto);
  if (c.length !== 44 || !FORMATO.test(c)) return false;
  if (!UFS[Number(c.slice(0, 2))]) return false;
  return calcularDV(c.slice(0, 43)) === Number(c[43]);
}

function formatarCNPJ(cnpj) {
  if (!cnpj || cnpj.length !== 14) return cnpj || '';
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

function formatarChave(chave) {
  return normalizar(chave).replace(/(.{4})/g, '$1 ').trim();
}

// Dados que a própria chave já informa
function decompor(texto) {
  const c = normalizar(texto);
  if (!validar(c)) return null;
  const aa = c.slice(2, 4);
  const mm = c.slice(4, 6);
  const cnpj = c.slice(6, 20);
  return {
    chave: c,
    uf: UFS[Number(c.slice(0, 2))],
    ano_mes: `20${aa}-${mm}`,
    emitente_cnpj: cnpj,
    modelo: c.slice(20, 22),
    serie: String(Number(c.slice(22, 25))),
    numero: String(Number(c.slice(25, 34))),
    tipo_emissao: c[34],
  };
}

// Procura uma chave válida dentro de um texto qualquer (ex.: texto extraído do PDF)
function encontrarNoTexto(texto) {
  const t = String(texto || '').toUpperCase();
  // 1) grupos de 4 separados por espaço (formato impresso no DANFE),
  //    testando cada início de "palavra" que comece com dígito
  const agrupada = /(?:[0-9A-Z]{4}[ . ]?){10}[0-9]{4}/y;
  for (let i = 0; i < t.length; i++) {
    if (!/[0-9]/.test(t[i]) || (i > 0 && /[0-9A-Z]/.test(t[i - 1]))) continue;
    agrupada.lastIndex = i;
    const m = agrupada.exec(t);
    if (m && validar(m[0])) return normalizar(m[0]);
  }
  // 2) bloco só de dígitos que some exatamente 44, com espaços em qualquer lugar
  for (const m of t.matchAll(/[0-9][0-9 . ]{42,}[0-9]/g)) {
    const c = normalizar(m[0]);
    if (c.length === 44 && validar(c)) return c;
  }
  return null;
}

module.exports = { normalizar, validar, calcularDV, decompor, encontrarNoTexto, formatarChave, formatarCNPJ, UFS };
