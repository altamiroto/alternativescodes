// Funções compartilhadas pelas páginas
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

async function api(url, opcoes = {}) {
  const init = { credentials: 'same-origin', ...opcoes };
  if (opcoes.json !== undefined) {
    init.method = init.method || 'POST';
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(opcoes.json);
  }
  const resp = await fetch(url, init);
  const tipo = resp.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resp.json() : null;
  if (!resp.ok) throw Object.assign(new Error(dados?.erro || 'Não foi possível concluir. Verifique a internet.'), { status: resp.status });
  return dados;
}

function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const fmt = {
  data: iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : ''),
  dataHora: iso => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''),
  moeda: v => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })),
  numero: n => (n ? Number(n).toLocaleString('pt-BR') : ''),
  registro: id => `#${String(id).padStart(4, '0')}`,
  tamanho: b => {
    b = Number(b) || 0;
    if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
    return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  },
  chave: c => String(c || '').replace(/(.{4})/g, '$1 ').trim(),
  cnpj: c => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c || ''),
  tituloNota: n => {
    if (!n.numero) return 'Nota sem chave';
    const tipo = n.modelo === '65' ? 'NFC-e' : n.chave ? 'NF-e' : 'NF';
    return `${tipo} ${fmt.numero(n.numero)}${n.serie ? ` · Série ${n.serie}` : ''}`;
  },
};

// ─── Chave de acesso (mesma regra do servidor) ───────
const Chave = {
  normalizar: t => String(t || '').toUpperCase().replace(/[^0-9A-Z]/g, ''),
  dv(c43) {
    let soma = 0, peso = 2;
    for (let i = c43.length - 1; i >= 0; i--) {
      soma += (c43.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  },
  validar(t) {
    const c = Chave.normalizar(t);
    return c.length === 44 && /^[0-9]{6}[0-9A-Z]{14}[0-9]{24}$/.test(c) && Chave.dv(c.slice(0, 43)) === Number(c[43]);
  },
  // Lê a chave de um código lido: código de barras do DANFE (44 dígitos) ou QR da NFC-e (?p=CHAVE|...)
  doCodigo(texto) {
    const t = String(texto || '');
    const qr = /[?&]p=([0-9A-Z]{44})/i.exec(t);
    if (qr && Chave.validar(qr[1])) return Chave.normalizar(qr[1]);
    const c = Chave.normalizar(t);
    return Chave.validar(c) ? c : null;
  },
  // Dígitos verificadores do CNPJ (aceita o CNPJ com letras: valor = código do caractere − 48)
  cnpjValido(c) {
    if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1+$/.test(c)) return false;
    const dv = (base, pesos) => {
      const resto = [...base].reduce((s, ch, i) => s + (ch.charCodeAt(0) - 48) * pesos[i], 0) % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [6, ...p1];
    const d1 = dv(c.slice(0, 12), p1);
    return d1 === Number(c[12]) && dv(c.slice(0, 12) + d1, p2) === Number(c[13]);
  },
  cpfValido(c) {
    if (!/^[0-9]{11}$/.test(c) || /^(.)\1+$/.test(c)) return false;
    const dv = n => { const r = [...c.slice(0, n)].reduce((s, d, i) => s + Number(d) * (n + 1 - i), 0) * 10 % 11; return r === 10 ? 0 : r; };
    return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
  },
  // UF (código IBGE), mês, modelo e CNPJ/CPF do emitente coerentes: filtra leituras erradas que por
  // acaso fecham o dígito verificador da chave
  plausivel(c) {
    const UFS = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 35, 41, 42, 43, 50, 51, 52, 53];
    const mes = Number(c.slice(4, 6));
    const doc = c.slice(6, 20);
    return UFS.includes(Number(c.slice(0, 2))) && mes >= 1 && mes <= 12 && ['55', '57', '58', '65', '67'].includes(c.slice(20, 22))
      && (Chave.cnpjValido(doc) || (doc.startsWith('000') && Chave.cpfValido(doc.slice(3))));
  },
  // Procura a chave no texto lido da foto (OCR): 44 caracteres seguidos, em grupos ou não. Letras
  // fora do CNPJ (posições 7 a 20) só podem ser números lidos errado (O→0, I→1, S→5, B→8...).
  doTexto(texto) {
    const MAPA = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', T: '1', J: '1', Z: '2', A: '4', S: '5', G: '6', B: '8' };
    const paraNumero = t => t.replace(/[A-Z]/g, l => MAPA[l] || l);
    // a chave fica numa linha só (ou quebrada em duas seguidas); juntar o texto todo criaria
    // "chaves" com pedaços de linhas diferentes
    const linhas = String(texto || '').toUpperCase().split('\n').filter(l => l.trim());
    for (const trecho of [...linhas, ...linhas.slice(1).map((l, i) => `${linhas[i]} ${l}`)]) {
      const s = Chave.normalizar(trecho);
      for (let i = 0; i + 44 <= s.length; i++) {
        const w = s.slice(i, i + 44);
        // primeiro tudo número (o comum); letras no CNPJ só se assim não fechar
        const tentativas = [paraNumero(w), paraNumero(w.slice(0, 6)) + w.slice(6, 20) + paraNumero(w.slice(20))];
        for (const c of tentativas) if (Chave.validar(c) && Chave.plausivel(c)) return c;
      }
    }
    return null;
  },
};

function aviso(texto, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function copiar(texto, mensagem = 'Copiado!') {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const t = document.createElement('textarea');
    t.value = texto;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  aviso(mensagem);
}

// ─── Leitor de código de barras (câmera) ─────────────
// Usa o leitor nativo (Android/Chrome) e, se não houver (iPhone), o leitor embutido em /vendor.
async function obterLeitor() {
  const formatos = ['code_128', 'qr_code'];
  if ('BarcodeDetector' in window) {
    try {
      const suportados = await window.BarcodeDetector.getSupportedFormats();
      if (suportados.includes('code_128')) return new window.BarcodeDetector({ formats: formatos });
    } catch { /* cai no leitor embutido */ }
  }
  const mod = await import('/vendor/barcode-detector.js');
  mod.prepareZXingModule({
    overrides: { locateFile: (arquivo, prefixo) => (arquivo.endsWith('.wasm') ? `/vendor/${arquivo}` : prefixo + arquivo) },
    fireImmediately: true,
  });
  return new mod.BarcodeDetector({ formats: formatos });
}

// Leitor dos números impressos da chave (OCR com Tesseract.js, servido em /vendor/ocr).
// Carregado só quando a câmera abre; depois fica pronto para as próximas leituras.
let leitorNumeros = null;
function obterLeitorNumeros() {
  leitorNumeros ??= (async () => {
    if (!window.Tesseract) {
      await new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = '/vendor/ocr/tesseract.min.js';
        s.onload = ok;
        s.onerror = falha;
        document.head.appendChild(s);
      });
    }
    const w = await window.Tesseract.createWorker('eng', 1, {
      workerPath: '/vendor/ocr/worker.min.js', corePath: '/vendor/ocr/core', langPath: '/vendor/ocr/lang', workerBlobURL: false,
    });
    await w.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ', tessedit_pageseg_mode: '6', debug_file: '/dev/null',
    });
    return w;
  })().catch(err => { leitorNumeros = null; throw err; });
  return leitorNumeros;
}

// Desenha um pedaço de uma imagem (vídeo, foto) num canvas, girado se preciso. Para os números,
// em tons de cinza com mais contraste; para o código de barras, sem filtro (o filtro atrapalha a leitura).
function desenhar(fonte, x, y, w, h, larguraMax, graus = 0, paraNumeros = true, ampliarAte = 2) {
  const fator = Math.min(ampliarAte, larguraMax / Math.max(w, h));
  const W = Math.round(w * fator), H = Math.round(h * fator);
  const deitar = graus % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = deitar ? H : W;
  canvas.height = deitar ? W : H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (paraNumeros) ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((graus * Math.PI) / 180);
  ctx.drawImage(fonte, x, y, w, h, -W / 2, -H / 2, W, H);
  return canvas;
}

// Recorta do vídeo a área do quadro guia (o vídeo aparece cortado na tela: object-fit cover), com
// uma folga em volta: é comum a nota encostar na borda do quadro
function recortarGuia(video, guia, larguraMax, graus = 0, paraNumeros = true) {
  const v = video.getBoundingClientRect(), g = guia.getBoundingClientRect();
  const escala = Math.max(v.width / video.videoWidth, v.height / video.videoHeight);
  const dx = (v.width - video.videoWidth * escala) / 2, dy = (v.height - video.videoHeight * escala) / 2;
  const folgaX = g.width * 0.08, folgaY = g.height * 0.08;
  const x = Math.max(0, (g.left - folgaX - v.left - dx) / escala), y = Math.max(0, (g.top - folgaY - v.top - dy) / escala);
  const w = Math.min(video.videoWidth - x, (g.width + 2 * folgaX) / escala), h = Math.min(video.videoHeight - y, (g.height + 2 * folgaY) / escala);
  return desenhar(video, x, y, w, h, larguraMax, graus, paraNumeros);
}

// Preto e branco com limiar local (média da vizinhança): foto escura, com sombra ou reflexo
// vira texto preto no fundo branco, que é o que o leitor de números entende.
function pretoEBranco(canvas, sensibilidade = 10, janela = 50, tirarBarras = false) {
  const { width: L, height: A } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, L, A);
  const px = img.data;
  const soma = new Float64Array((L + 1) * (A + 1)); // imagem integral, para a média de cada janela
  for (let y = 0; y < A; y++) {
    let linha = 0;
    for (let x = 0; x < L; x++) {
      linha += px[(y * L + x) * 4];
      soma[(y + 1) * (L + 1) + x + 1] = soma[y * (L + 1) + x + 1] + linha;
    }
  }
  const r = Math.max(8, Math.round(L / janela));
  for (let y = 0; y < A; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(A, y + r + 1);
    for (let x = 0; x < L; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(L, x + r + 1);
      const media = (soma[y1 * (L + 1) + x1] - soma[y0 * (L + 1) + x1] - soma[y1 * (L + 1) + x0] + soma[y0 * (L + 1) + x0]) / ((y1 - y0) * (x1 - x0));
      const i = (y * L + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = px[i] < media - sensibilidade ? 0 : 255;
    }
  }
  apagarManchasGrandes(px, L, A, tirarBarras);
  ctx.putImageData(img, 0, 0);
  // margem branca: o leitor erra letras encostadas na borda
  const M = 24;
  const comMargem = document.createElement('canvas');
  comMargem.width = L + 2 * M;
  comMargem.height = A + 2 * M;
  const c2 = comMargem.getContext('2d');
  c2.fillStyle = '#fff';
  c2.fillRect(0, 0, comMargem.width, comMargem.height);
  c2.drawImage(canvas, M, M);
  return comMargem;
}

// Apaga (pinta de branco) as manchas pretas grandes demais para serem letras: borda da etiqueta,
// fundo escuro em volta, linhas compridas de tabela. Sem isso o leitor acha que é uma figura.
// Com tirarBarras, apaga também as barras do código de barras (altas e finas), que confundem os números.
function apagarManchasGrandes(px, L, A, tirarBarras) {
  const visto = new Uint8Array(L * A);
  const pilha = new Int32Array(L * A);
  const mancha = new Int32Array(L * A);
  for (let inicio = 0; inicio < L * A; inicio++) {
    if (visto[inicio] || px[inicio * 4] !== 0) continue;
    let topo = 0, n = 0, x0 = L, x1 = 0, y0 = A, y1 = 0;
    pilha[topo++] = inicio;
    visto[inicio] = 1;
    while (topo) {
      const k = pilha[--topo];
      mancha[n++] = k;
      const x = k % L, y = (k - x) / L;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const v of [x > 0 ? k - 1 : -1, x < L - 1 ? k + 1 : -1, y > 0 ? k - L : -1, y < A - 1 ? k + L : -1]) {
        if (v >= 0 && !visto[v] && px[v * 4] === 0) { visto[v] = 1; pilha[topo++] = v; }
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w > L * 0.5 || h > A * 0.5 || (tirarBarras && h > A * 0.12 && h > 4 * w)) {
      for (let j = 0; j < n; j++) { const i = mancha[j] * 4; px[i] = px[i + 1] = px[i + 2] = 255; }
    }
  }
}

// Variações do tratamento da imagem, uma por tentativa (cada leitura sai um pouco diferente)
// [sensibilidade, janela, largura, apagar as barras]
const VARIACOES_OCR = [[10, 50, 1400, true], [18, 30, 1400, false], [6, 70, 1700, true], [14, 40, 1100, false]];

// Ajustes para ler de novo um trecho ampliado: [altura da letra, apagar as barras, sensibilidade,
// janela]. O leitor vai melhor com letras de 20 a 30 pixels; cada ajuste erra em lugares diferentes,
// e só uma leitura exata (com todos os dígitos verificadores certos) é aceita.
const AJUSTES_TRECHO = [
  [24, true, 10, 50], [24, false, 10, 50], [20, true, 10, 50], [28, true, 10, 50],
  [24, true, 16, 35], [30, false, 10, 50], [22, false, 6, 70], [26, true, 14, 40],
];

// O nº da nota (posições 26 a 34 da chave) aparece em outra linha do que foi lido? (sem contar a
// própria linha da chave). Ex.: "NF: 539576", "Nº 000.539.576".
function numeroDaNotaNaFoto(chave, textos) {
  const nf = String(Number(chave.slice(25, 34)));
  if (nf.length < 4) return false; // número curto aparece por acaso
  const re = new RegExp(`(^|\\D)0*${nf}(\\D|$)`);
  return textos.some(t => t.split('\n').some(l => (l.match(/\d/g) || []).length < 20 && re.test(l.replace(/(\d)\.(?=\d)/g, '$1'))));
}

// Procura a chave numa foto da galeria (a foto pode estar deitada, de cabeça para baixo e com a
// etiqueta pequena num canto). Devolve a chave ou null.
//   1. código de barras na foto inteira, na resolução original, e em pedaços ampliados;
//   2. números: para cada giro, lê a foto, acha as linhas com muitos números e lê de novo só
//      aquele trecho, ampliado (é o que resolve etiqueta pequena numa foto grande).
async function lerChaveDaFoto(arquivo, aoAvancar = () => {}) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // o navegador já aplica a rotação gravada na foto (EXIF)
    const L = img.naturalWidth, A = img.naturalHeight;

    aoAvancar('Procurando o código de barras…');
    const leitor = await obterLeitor();
    const barras = async imagem => {
      try {
        for (const c of await leitor.detect(imagem)) {
          const chave = Chave.doCodigo(c.rawValue);
          if (chave) return chave;
        }
      } catch { /* nada legível */ }
      return null;
    };
    let chave = await barras(img);
    for (const partes of [2, 3]) {
      const tw = (L / partes) * 1.5, th = (A / partes) * 1.5;
      for (let y = 0; !chave && y < A - th / 3; y += th / 3) {
        for (let x = 0; !chave && x < L - tw / 3; x += tw / 3) {
          chave = await barras(desenhar(img, x, y, Math.min(tw, L - x), Math.min(th, A - y), 2600, 0, false));
        }
      }
    }
    if (chave) return chave;

    // Chave lida pelos números só vale com confirmação: lida igual duas vezes, ou com o nº da nota
    // (que está dentro da chave) aparecendo em outro lugar da etiqueta ("NF: 539576"). Em foto de
    // baixa resolução, uma leitura com dois números errados pode fechar o dígito verificador.
    const lidas = new Map(), textos = [];
    const conferir = texto => {
      textos.push(texto);
      const nova = Chave.doTexto(texto);
      if (nova) lidas.set(nova, (lidas.get(nova) || 0) + 1);
      for (const [c, vezes] of lidas) {
        // o nº da nota confere só parte da chave: vale se nenhuma outra chave diferente foi lida
        if (vezes >= 2 || (lidas.size === 1 && numeroDaNotaNaFoto(c, textos))) return c;
      }
      return null;
    };
    const ocr = await obterLeitorNumeros();
    try {
      // Para que lado a foto está? Leitura rápida em tamanho pequeno: o lado certo tem mais
      // palavras lidas com confiança. Começa por ele (os outros ficam para depois).
      aoAvancar('Vendo para que lado a foto está…');
      await ocr.setParameters({ tessedit_pageseg_mode: '11' });
      const giros = [];
      for (const graus of [0, 270, 90, 180]) {
        const { data } = await ocr.recognize(desenhar(img, 0, 0, L, A, 1600, graus), {}, { text: true, blocks: true });
        if ((chave = conferir(data.text))) return chave;
        const palavras = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));
        giros.push({ graus, pontos: palavras.filter(w => w.confidence > 70 && w.text.length >= 3).length });
      }
      giros.sort((a, b) => b.pontos - a.pontos);

      // os dois lados mais prováveis (o lado certo quase sempre é o primeiro)
      for (const [n, { graus }] of giros.slice(0, 2).entries()) {
        aoAvancar(`Lendo os números da foto (${n + 1} de 2)…`);
        const foto = desenhar(img, 0, 0, L, A, 3200, graus);
        await ocr.setParameters({ tessedit_pageseg_mode: '11' });
        const { data } = await ocr.recognize(foto, {}, { text: true, blocks: true });
        if ((chave = conferir(data.text))) return chave;
        // linhas com muitos números (a chave lida pela metade já serve para achar onde ela está)
        const linhas = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines))
          .map(l => ({ l, numeros: (l.text.match(/\d/g) || []).length }))
          .filter(x => x.numeros >= 8)
          .sort((a, b) => b.numeros - a.numeros)
          .slice(0, 5);
        await ocr.setParameters({ tessedit_pageseg_mode: '6' });
        for (const { l } of linhas.slice(0, 3)) {
          const h = Math.max(6, l.bbox.y1 - l.bbox.y0);
          const x = Math.max(0, l.bbox.x0 - 25 * h), y = Math.max(0, l.bbox.y0 - 1.2 * h);
          const w = Math.min(foto.width - x, l.bbox.x1 - l.bbox.x0 + 50 * h), alto = Math.min(foto.height - y, 3.4 * h);
          for (const [letra, tirarBarras, sensibilidade, janela] of AJUSTES_TRECHO) {
            const trecho = desenhar(foto, x, y, w, alto, Math.max(w, alto) * Math.min(4, letra / h), 0, true, 4);
            const r = await ocr.recognize(pretoEBranco(trecho, sensibilidade, janela, tirarBarras));
            if ((chave = conferir(r.data.text))) return chave;
          }
        }
        // foto só da etiqueta (letras grandes): a foto inteira tratada, neste giro
        for (const [tamanho, modo, tirarBarras] of [[1200, '11', false], [1600, '6', true]]) {
          await ocr.setParameters({ tessedit_pageseg_mode: modo });
          const r = await ocr.recognize(pretoEBranco(desenhar(img, 0, 0, L, A, tamanho, graus), 12, 60, tirarBarras));
          if ((chave = conferir(r.data.text))) return chave;
        }
      }
    } finally {
      await ocr.setParameters({ tessedit_pageseg_mode: '6' }); // o da câmera
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function abrirLeitorChave() {
  return new Promise(resolve => {
    const tela = document.createElement('div');
    tela.className = 'leitor';
    tela.innerHTML = `
      <div class="camera">
        <video playsinline muted autoplay></video>
        <div class="guia"><span class="rotulo">código de barras e os números embaixo dele</span></div>
        <div class="ferramentas">
          <button type="button" class="virar" title="Ler com o celular deitado"><span class="icone">↻</span> <span class="texto">Virar</span></button>
          <button type="button" class="lanterna oculto"><span class="icone">🔦</span> <span class="texto">Lanterna</span></button>
          <button type="button" class="zoom oculto"><span class="icone">🔍</span> <span class="texto">Aproximar</span></button>
        </div>
      </div>
      <div class="rodape">
        <p class="instrucao">Aponte a câmera para o <b>código de barras</b> da nota.<br><span class="pequeno">Pode ser também só os <b>números da chave</b>. Deixe dentro do quadro, bem iluminado.</span></p>
        <p class="pequeno estado-ocr">Preparando a leitura dos números…</p>
        <div class="botoes">
          <button class="btn galeria" type="button"><span class="icone">🖼️</span> <span class="texto">Foto da galeria</span></button>
          <button class="btn cancelar" type="button"><span class="icone">✕</span> <span class="texto">Cancelar</span></button>
        </div>
        <input type="file" accept="image/*" hidden>
      </div>`;
    document.body.appendChild(tela);
    const video = $('video', tela);
    const guia = $('.guia', tela);
    const estadoOcr = $('.estado-ocr', tela);
    let stream = null, ativo = true, lendoFoto = false;

    const fechar = chave => {
      if (!ativo) return;
      ativo = false;
      stream?.getTracks().forEach(t => t.stop());
      paisagem.removeEventListener('change', aoGirarTela);
      tela.remove();
      resolve(chave);
    };
    const achou = chave => { navigator.vibrate?.(120); fechar(chave); };
    $('.cancelar', tela).onclick = () => fechar(null);

    // "Virar": a tela continua em pé e o quadro de leitura deita (celular de lado, código comprido).
    // Se o aparelho girar a tela sozinho (iPhone), o layout deitado já cuida disso.
    const paisagem = matchMedia('(orientation: landscape)');
    const aoGirarTela = () => { if (paisagem.matches) tela.classList.remove('deitado'); };
    paisagem.addEventListener('change', aoGirarTela);
    $('.virar', tela).onclick = () => tela.classList.toggle('deitado');
    const deitado = () => tela.classList.contains('deitado');

    // Foto da galeria
    const entrada = $('input[type=file]', tela);
    $('.galeria', tela).onclick = () => entrada.click();
    entrada.onchange = async () => {
      const arquivo = entrada.files[0];
      entrada.value = '';
      if (!arquivo) return;
      lendoFoto = true;
      estadoOcr.textContent = 'Lendo a foto…';
      try {
        const chave = await lerChaveDaFoto(arquivo, texto => { estadoOcr.textContent = texto; });
        if (chave) return achou(chave);
        aviso('Não encontrei a chave nessa foto. Tire uma foto mais de perto da etiqueta (código de barras e números '
          + 'nítidos). Foto recebida pelo WhatsApp perde qualidade: prefira a original.', 8000);
      } catch {
        aviso('Não foi possível ler essa foto.', 4000);
      } finally {
        lendoFoto = false;
      }
    };

    // Lanterna e zoom, quando a câmera do aparelho permite (Android; o iPhone não libera a lanterna)
    function prepararFerramentas(trilha) {
      const cap = trilha.getCapabilities?.() || {};
      if (cap.focusMode?.includes('continuous')) trilha.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      if (cap.torch) {
        const b = $('.lanterna', tela);
        let ligada = false;
        b.classList.remove('oculto');
        b.onclick = () => trilha.applyConstraints({ advanced: [{ torch: !ligada }] })
          .then(() => { ligada = !ligada; b.classList.toggle('ligado', ligada); }).catch(() => {});
      }
      if (cap.zoom && cap.zoom.max >= 1.5) {
        const b = $('.zoom', tela);
        const perto = Math.min(2, cap.zoom.max);
        let aproximado = false;
        b.classList.remove('oculto');
        b.onclick = () => trilha.applyConstraints({ advanced: [{ zoom: aproximado ? (cap.zoom.min || 1) : perto }] })
          .then(() => { aproximado = !aproximado; b.classList.toggle('ligado', aproximado); }).catch(() => {});
      }
    }

    // Código de barras: alterna o quadro inteiro e o recorte ampliado do quadro guia
    async function lerCodigo() {
      const leitor = await obterLeitor();
      for (let volta = 0; ativo; volta++) {
        if (!lendoFoto) {
          try {
            const imagem = volta % 2 ? recortarGuia(video, guia, 1600, deitado() ? 270 : 0, false) : video;
            for (const c of await leitor.detect(imagem)) {
              const chave = Chave.doCodigo(c.rawValue);
              if (chave) return achou(chave);
            }
          } catch { /* quadro ainda não pronto */ }
        }
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Números da chave (OCR), ao mesmo tempo. Só aceita quando duas leituras recentes dão a mesma
    // chave válida (dígitos verificadores, UF, mês, modelo e CNPJ).
    async function lerNumeros() {
      let leitor;
      try {
        leitor = await obterLeitorNumeros();
      } catch {
        estadoOcr.textContent = 'Leitura dos números indisponível neste aparelho; use o código de barras.';
        return;
      }
      const recentes = [];
      for (let volta = 0; ativo; volta++) {
        if (!lendoFoto) {
          estadoOcr.textContent = 'Lendo o código de barras e os números…';
          try {
            const [sensibilidade, janela, largura, tirarBarras] = VARIACOES_OCR[volta % VARIACOES_OCR.length];
            // deitado: o celular pode ter virado para um lado ou para o outro (4 tentativas de cada)
            const graus = deitado() ? (Math.floor(volta / 4) % 2 ? 90 : 270) : 0;
            const { data } = await leitor.recognize(pretoEBranco(recortarGuia(video, guia, largura, graus), sensibilidade, janela, tirarBarras));
            const chave = Chave.doTexto(data.text);
            if (chave && recentes.includes(chave)) return achou(chave);
            recentes.push(chave);
            if (recentes.length > VARIACOES_OCR.length) recentes.shift(); // uma volta completa de variações
          } catch { /* quadro ainda não pronto */ }
        }
        await new Promise(r => setTimeout(r, 150));
      }
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();
        prepararFerramentas(stream.getVideoTracks()[0]);
        lerNumeros();
        await lerCodigo();
      } catch (e) {
        if (!ativo) return;
        // sem câmera: a foto da galeria continua funcionando
        estadoOcr.textContent = e.name === 'NotAllowedError'
          ? 'A câmera foi bloqueada. Use uma foto da galeria ou libere a câmera nas configurações.'
          : 'Não foi possível abrir a câmera. Use uma foto da galeria ou digite a chave.';
        $('.instrucao', tela).classList.add('oculto');
      }
    })();
  });
}

// ─── PDF e arquivos no iPhone com o app instalado ────
// Instalado na tela de início, o iPhone abre o PDF dentro do próprio app, sem barra do Safari:
// não aparece compartilhar/imprimir e nem dá para voltar. Nesse caso o app baixa o arquivo e abre
// a tela de compartilhar do iPhone, que tem "Imprimir" e "Salvar em Arquivos".
const iPhoneInstalado = () => {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches);
};

function abrirArquivo(url, nomePadrao = 'arquivo.pdf') {
  if (!iPhoneInstalado()) {
    const aba = window.open(url, '_blank');
    if (!aba) location.href = url;
    return;
  }
  const folha = document.createElement('div');
  folha.className = 'folha-arquivo';
  folha.innerHTML = `
    <div class="caixa">
      <p class="titulo">⏳ Preparando o arquivo…</p>
      <p class="pequeno suave dica oculto">Na tela que abrir, toque em <b>Imprimir</b> (ou em <b>Salvar em Arquivos</b>).
        Se não aparecer, deslize a lista para cima.</p>
      <button class="btn primario grande imprimir oculto" type="button">🖨️ Imprimir</button>
      <button class="btn discreto fechar" type="button">Fechar</button>
    </div>`;
  document.body.appendChild(folha);
  const fechar = () => folha.remove();
  $('.fechar', folha).onclick = fechar;
  folha.addEventListener('click', e => { if (e.target === folha) fechar(); });

  (async () => {
    let arquivo;
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) {
        let msg = 'Não foi possível gerar o arquivo.';
        try { msg = (await resp.json()).erro || msg; } catch { /* não é JSON */ }
        throw new Error(msg);
      }
      const nome = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(resp.headers.get('Content-Disposition') || '')?.[1];
      const blob = await resp.blob();
      arquivo = new File([blob], nome ? decodeURIComponent(nome) : nomePadrao, { type: blob.type || 'application/pdf' });
    } catch (err) {
      $('.titulo', folha).textContent = `⚠️ ${err.message || 'Sem conexão. Tente de novo.'}`;
      return;
    }
    if (!navigator.canShare?.({ files: [arquivo] })) {
      $('.titulo', folha).textContent = '⚠️ Este iPhone não permite imprimir pelo app instalado. Atualize o iOS ou abra o site pelo Safari.';
      return;
    }
    const compartilhar = () => navigator.share({ files: [arquivo] })
      .then(fechar)
      .catch(err => { if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') aviso('Não foi possível abrir as opções de impressão.', 4000); });
    $('.titulo', folha).textContent = '✅ Arquivo pronto';
    $('.dica', folha).classList.remove('oculto');
    const botao = $('.imprimir', folha);
    botao.classList.remove('oculto');
    botao.onclick = compartilhar; // o iPhone só abre a tela de compartilhar a partir de um toque
  })();
}

// Links de arquivos (/f/...) e de PDFs gerados: no iPhone instalado passam pela tela acima
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href]');
  if (!a || !iPhoneInstalado()) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !/^\/(f\/|api\/(impressao|admin)\/etiquetas\.pdf)/.test(url.pathname)) return;
  e.preventDefault();
  abrirArquivo(url.pathname + url.search, a.getAttribute('download') || 'arquivo');
});

// ─── PWA ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
