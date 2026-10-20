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

function abrirLeitorChave() {
  return new Promise(resolve => {
    const tela = document.createElement('div');
    tela.className = 'leitor';
    tela.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="guia"></div>
      <div class="rodape">
        <p>Aponte a câmera para o <b>código de barras</b> da nota.<br><span class="pequeno">Deixe o código dentro do quadro, bem iluminado.</span></p>
        <button class="btn discreto" type="button" style="color:#fff;border-color:#555;background:transparent">Cancelar</button>
      </div>`;
    document.body.appendChild(tela);
    const video = $('video', tela);
    let stream = null, ativo = true;

    const fechar = chave => {
      ativo = false;
      stream?.getTracks().forEach(t => t.stop());
      tela.remove();
      resolve(chave);
    };
    $('button', tela).onclick = () => fechar(null);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();
        const leitor = await obterLeitor();
        while (ativo) {
          try {
            const codigos = await leitor.detect(video);
            for (const c of codigos) {
              const chave = Chave.doCodigo(c.rawValue);
              if (chave) {
                navigator.vibrate?.(120);
                return fechar(chave);
              }
            }
          } catch { /* quadro ainda não pronto */ }
          await new Promise(r => setTimeout(r, 250));
        }
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
