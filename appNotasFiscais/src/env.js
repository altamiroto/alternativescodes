// Carrega variáveis de um arquivo .env (só para rodar localmente; no Easypanel use a aba Environment)
const fs = require('fs');
const path = require('path');

const arquivo = path.join(__dirname, '..', '.env');
if (fs.existsSync(arquivo)) {
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
