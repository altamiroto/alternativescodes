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
  // UF (código IBGE), mês e modelo coerentes: filtra leituras erradas que por acaso fecham o DV
  plausivel(c) {
    const UFS = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 35, 41, 42, 43, 50, 51, 52, 53];
    const mes = Number(c.slice(4, 6));
    return UFS.includes(Number(c.slice(0, 2))) && mes >= 1 && mes <= 12 && ['55', '57', '58', '65', '67'].includes(c.slice(20, 22));
  },
  // Procura a chave no texto lido da foto (OCR): 44 caracteres seguidos, em grupos ou não. Letras
  // fora do CNPJ (posições 7 a 20) só podem ser números lidos errado (O→0, I→1, S→5, B→8...).
  doTexto(texto) {
    const MAPA = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', T: '1', J: '1', Z: '2', A: '4', S: '5', G: '6', B: '8' };
    const paraNumero = t => t.replace(/[A-Z]/g, l => MAPA[l] || l);
    const linhas = String(texto || '').toUpperCase().split('\n');
    for (const trecho of [...linhas, linhas.join(' ')]) {
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

// Recorta do vídeo a área do quadro guia (o vídeo aparece cortado na tela: object-fit cover)
function recortarGuia(video, guia, larguraMax) {
  const v = video.getBoundingClientRect(), g = guia.getBoundingClientRect();
  const escala = Math.max(v.width / video.videoWidth, v.height / video.videoHeight);
  const dx = (v.width - video.videoWidth * escala) / 2, dy = (v.height - video.videoHeight * escala) / 2;
  const x = Math.max(0, (g.left - v.left - dx) / escala), y = Math.max(0, (g.top - v.top - dy) / escala);
  const w = Math.min(video.videoWidth - x, g.width / escala), h = Math.min(video.videoHeight - y, g.height / escala);
  const fator = Math.min(2, larguraMax / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * fator);
  canvas.height = Math.round(h * fator);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Preto e branco com limiar local (média da vizinhança): foto escura, com sombra ou reflexo
// vira texto preto no fundo branco, que é o que o leitor de números entende.
function pretoEBranco(canvas, sensibilidade = 10, janela = 50) {
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

// Variações do tratamento da imagem, uma por tentativa (cada leitura sai um pouco diferente)
const VARIACOES_OCR = [[10, 50, 1400], [18, 30, 1400], [6, 70, 1700], [14, 40, 1100]];

function abrirLeitorChave() {
  return new Promise(resolve => {
    const tela = document.createElement('div');
    tela.className = 'leitor';
    tela.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="guia"><span>código de barras e os números embaixo dele</span></div>
      <div class="ferramentas">
        <button type="button" class="lanterna oculto">🔦 Lanterna</button>
        <button type="button" class="zoom oculto">🔍 Aproximar</button>
      </div>
      <div class="rodape">
        <p>Aponte a câmera para o <b>código de barras</b> da nota.<br><span class="pequeno">Pode ser também só os <b>números da chave</b>. Deixe dentro do quadro, bem iluminado.</span></p>
        <p class="pequeno estado-ocr">Preparando a leitura dos números…</p>
        <button class="btn discreto cancelar" type="button" style="color:#fff;border-color:#555;background:transparent">Cancelar</button>
      </div>`;
    document.body.appendChild(tela);
    const video = $('video', tela);
    const guia = $('.guia', tela);
    const estadoOcr = $('.estado-ocr', tela);
    let stream = null, ativo = true;

    const fechar = chave => {
      if (!ativo) return;
      ativo = false;
      stream?.getTracks().forEach(t => t.stop());
      tela.remove();
      resolve(chave);
    };
    const achou = chave => { navigator.vibrate?.(120); fechar(chave); };
    $('.cancelar', tela).onclick = () => fechar(null);

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
        try {
          const imagem = volta % 2 ? recortarGuia(video, guia, 1600) : video;
          for (const c of await leitor.detect(imagem)) {
            const chave = Chave.doCodigo(c.rawValue);
            if (chave) return achou(chave);
          }
        } catch { /* quadro ainda não pronto */ }
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Números da chave (OCR), ao mesmo tempo. Só aceita quando duas leituras seguidas dão a mesma
    // chave válida (dígito verificador, UF, mês e modelo), para não pegar número lido errado.
    async function lerNumeros() {
      let leitor;
      try {
        leitor = await obterLeitorNumeros();
      } catch {
        estadoOcr.textContent = 'Leitura dos números indisponível neste aparelho; use o código de barras.';
        return;
      }
      let anterior = null;
      for (let volta = 0; ativo; volta++) {
        estadoOcr.textContent = 'Lendo o código de barras e os números…';
        try {
          const [sensibilidade, janela, largura] = VARIACOES_OCR[volta % VARIACOES_OCR.length];
          const { data } = await leitor.recognize(pretoEBranco(recortarGuia(video, guia, largura), sensibilidade, janela));
          const chave = Chave.doTexto(data.text);
          if (chave && chave === anterior) return achou(chave);
          anterior = chave;
        } catch { /* quadro ainda não pronto */ }
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
        fechar(null);
        aviso(e.name === 'NotAllowedError'
          ? 'A câmera foi bloqueada. Libere o acesso à câmera nas configurações do navegador.'
          : 'Não foi possível abrir a câmera. Digite a chave.', 5000);
      }
    })();
  });
}

// ─── PWA ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
