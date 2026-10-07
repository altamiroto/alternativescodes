// Tela de envio: cadastro (uma vez) → nota + fotos + comentário → sucesso
const estado = {
  config: { maxFileMb: 10, maxAnexos: 10 },
  notaArquivos: [], // PDF e/ou XML
  chave: null,
  anexos: [],       // { file, url }
  enviando: false,
};

const telas = ['cadastro', 'envio', 'sucesso'];
function mostrar(tela) {
  for (const t of telas) $(`#tela-${t}`).classList.toggle('oculto', t !== tela);
  window.scrollTo(0, 0);
}

function mostrarUsuario(u) {
  $('#quem').innerHTML = u
    ? `Olá, <b>${escapar(u.nome.split(' ')[0])}</b><br><a href="#" id="trocar" class="pequeno">não é você?</a>`
    : '';
  $('#trocar')?.addEventListener('click', e => {
    e.preventDefault();
    $('#cad-nome').value = '';
    $('#cad-email').value = '';
    mostrar('cadastro');
  });
}

// ─── Cadastro ────────────────────────────────────────
$('#form-cadastro').addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#cad-erro');
  erro.classList.add('oculto');
  try {
    const { usuario } = await api('/api/cadastro', { json: { nome: $('#cad-nome').value, email: $('#cad-email').value } });
    try { localStorage.setItem('nf_usuario', JSON.stringify(usuario)); } catch { /* sem armazenamento */ }
    mostrarUsuario(usuario);
    mostrar('envio');
  } catch (err) {
    erro.textContent = err.message;
    erro.classList.remove('oculto');
  }
});

// ─── Passo 1: a nota ─────────────────────────────────
$('#btn-pdf').addEventListener('click', () => $('#arquivo-nota').click());
$('#btn-chave').addEventListener('click', () => {
  $('#painel-chave').classList.toggle('oculto');
  $('#btn-chave').classList.toggle('ativo', !$('#painel-chave').classList.contains('oculto'));
});

$('#arquivo-nota').addEventListener('change', e => {
  adicionarArquivosNota([...e.target.files]);
  e.target.value = '';
});

function adicionarArquivosNota(arquivos) {
  for (const f of arquivos) {
    const ehXml = /\.xml$/i.test(f.name) || /xml/.test(f.type);
    const ehPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    if (!ehXml && !ehPdf) { aviso('Escolha um arquivo PDF (ou XML) da nota.', 4000); continue; }
    if (!checarTamanho(f)) continue;
    // um PDF e um XML no máximo
    estado.notaArquivos = estado.notaArquivos.filter(a => (/\.xml$/i.test(a.name) || /xml/.test(a.type)) !== ehXml);
    estado.notaArquivos.push(f);
  }
  desenharNota();
}

function desenharNota() {
  $('#nota-arquivos').innerHTML = estado.notaArquivos.map((f, i) => `
    <div class="arquivo-escolhido">
      <span class="icone" style="font-size:28px">${/xml/i.test(f.name + f.type) ? '🧾' : '📄'}</span>
      <span class="nome">${escapar(f.name)}<br><span class="tam">${fmt.tamanho(f.size)}</span></span>
      <button class="btn pequeno discreto" type="button" data-remover-nota="${i}">Remover</button>
    </div>`).join('');
  $$('[data-remover-nota]').forEach(b => b.addEventListener('click', () => {
    estado.notaArquivos.splice(Number(b.dataset.removerNota), 1);
    desenharNota();
  }));
  $('#btn-pdf').classList.toggle('ativo', estado.notaArquivos.length > 0);
  atualizarBotaoEnviar();
}

$('#btn-ler').addEventListener('click', async () => {
  const chave = await abrirLeitorChave();
  if (chave) {
    $('#campo-chave').value = fmt.chave(chave);
    await conferirChave();
  }
});

$('#campo-chave').addEventListener('input', () => {
  const campo = $('#campo-chave');
  const limpo = Chave.normalizar(campo.value).slice(0, 44);
  const formatado = fmt.chave(limpo);
  if (campo.value !== formatado) campo.value = formatado;
  conferirChave();
});

let ultimaConsulta = '';
async function conferirChave() {
  const c = Chave.normalizar($('#campo-chave').value);
  const status = $('#chave-status');
  estado.chave = null;
  if (!c) {
    status.innerHTML = '';
  } else if (c.length < 44) {
    status.innerHTML = `<div class="aviso atencao">Faltam ${44 - c.length} números.</div>`;
  } else if (!Chave.validar(c)) {
    status.innerHTML = '<div class="aviso erro">Essa chave não confere. Confira os números com a nota.</div>';
  } else {
    estado.chave = c;
    status.innerHTML = '<div class="aviso ok">✔ Chave correta.</div>';
    if (ultimaConsulta !== c) {
      ultimaConsulta = c;
      try {
        const r = await api(`/api/chave/${c}`);
        if (estado.chave !== c) return;
        const d = r.dados;
        let html = `<div class="aviso ok">✔ Chave correta: ${d.modelo === '65' ? 'NFC-e' : 'NF'} ${fmt.numero(d.numero)} · Série ${d.serie}<br>
          <span class="pequeno">CNPJ do fornecedor ${fmt.cnpj(d.emitente_cnpj)}</span></div>`;
        if (r.registros_anteriores.length) {
          const a = r.registros_anteriores[0];
          html += `<div class="aviso atencao">Essa nota já foi registrada em ${fmt.dataHora(a.created_at)}${a.criado_por_nome ? ` por ${escapar(a.criado_por_nome)}` : ''} (${fmt.registro(a.id)}).
            Se for para corrigir, pode enviar de novo.</div>`;
        }
        status.innerHTML = html;
      } catch { /* sem internet: a validação local já basta */ }
    }
  }
  atualizarBotaoEnviar();
}

// ─── Passo 2: fotos e vídeos ─────────────────────────
$('#btn-foto').addEventListener('click', () => $('#arquivo-foto').click());
$('#btn-galeria').addEventListener('click', () => $('#arquivo-galeria').click());
for (const id of ['#arquivo-foto', '#arquivo-galeria']) {
  $(id).addEventListener('change', async e => {
    await adicionarAnexos([...e.target.files]);
    e.target.value = '';
  });
}

function checarTamanho(f) {
  if (f.size > estado.config.maxFileMb * 1024 * 1024) {
    const dica = f.type.startsWith('video/') ? ' Grave um vídeo mais curto (cerca de 15 segundos).' : '';
    aviso(`"${f.name}" é grande demais (${fmt.tamanho(f.size)}). O limite é ${estado.config.maxFileMb} MB.${dica}`, 6000);
    return false;
  }
  return true;
}

// Fotos grandes são reduzidas no próprio aparelho antes de enviar
async function comprimirImagem(f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 1.5 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return f;
  }
}

async function adicionarAnexos(arquivos) {
  for (const original of arquivos) {
    if (estado.anexos.length >= estado.config.maxAnexos) {
      aviso(`Máximo de ${estado.config.maxAnexos} arquivos por envio.`, 4000);
      break;
    }
    const f = await comprimirImagem(original);
    if (!checarTamanho(f)) continue;
    estado.anexos.push({ file: f, url: URL.createObjectURL(f) });
  }
  desenharAnexos();
}

function desenharAnexos() {
  $('#miniaturas').innerHTML = estado.anexos.map(({ file, url }, i) => {
    let visual;
    if (file.type.startsWith('image/')) visual = `<img src="${url}" alt="">`;
    else if (file.type.startsWith('video/')) visual = `<video src="${url}#t=0.1" muted playsinline preload="metadata"></video>`;
    else visual = `<span class="tipo">📎 ${escapar(file.name)}</span>`;
    return `<div class="miniatura">${visual}<span class="peso">${fmt.tamanho(file.size)}</span>
      <button type="button" aria-label="Remover" data-remover="${i}">✕</button></div>`;
  }).join('');
  $$('[data-remover]').forEach(b => b.addEventListener('click', () => {
    const [removido] = estado.anexos.splice(Number(b.dataset.remover), 1);
    URL.revokeObjectURL(removido.url);
    desenharAnexos();
  }));
}

// ─── Enviar ──────────────────────────────────────────
function podeEnviar() {
  return !estado.enviando && (estado.notaArquivos.length > 0 || !!estado.chave);
}

function atualizarBotaoEnviar() {
  $('#btn-enviar').disabled = !podeEnviar();
  $('#enviar-dica').classList.toggle('oculto', podeEnviar() || estado.enviando);
}

function enviarComProgresso(form) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/notas');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) $('#progresso > div').style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
    };
    xhr.onload = () => {
      let dados = null;
      try { dados = JSON.parse(xhr.responseText); } catch { /* resposta vazia */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(dados);
      else reject(Object.assign(new Error(dados?.erro || 'Não foi possível enviar. Tente de novo.'), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error('Sem conexão com a internet. Verifique e toque em Enviar de novo.'));
    xhr.send(form);
  });
}

$('#btn-enviar').addEventListener('click', async () => {
  if (!podeEnviar()) return;
  const erro = $('#envio-erro');
  erro.classList.add('oculto');
  estado.enviando = true;
  const botao = $('#btn-enviar');
  botao.textContent = 'Enviando…';
  atualizarBotaoEnviar();
  $('#progresso').classList.remove('oculto');

  const form = new FormData();
  for (const f of estado.notaArquivos) form.append('nota', f, f.name);
  if (estado.chave) form.append('chave', estado.chave);
  for (const { file } of estado.anexos) form.append('anexos', file, file.name);
  form.append('comentario', $('#comentario').value);

  try {
    const r = await enviarComProgresso(form);
    mostrarSucesso(r);
  } catch (err) {
    if (err.status === 401) { mostrar('cadastro'); return; }
    erro.textContent = err.message;
    erro.classList.remove('oculto');
  } finally {
    estado.enviando = false;
    botao.textContent = '✔ Enviar';
    $('#progresso').classList.add('oculto');
    $('#progresso > div').style.width = '0';
    atualizarBotaoEnviar();
  }
});

function mostrarSucesso(r) {
  const n = r.nota;
  $('#ok-registro').textContent = fmt.registro(r.id);
  const partes = [];
  if (n.numero) partes.push(fmt.tituloNota(n));
  if (n.emitente_nome) partes.push(n.emitente_nome);
  $('#ok-resumo').textContent = partes.join(' · ') || (n.chave ? '' : 'Não foi possível ler a chave do PDF, mas o arquivo foi guardado.');
  $('#ok-anteriores').innerHTML = r.registros_anteriores?.length
    ? `<div class="aviso atencao">Essa nota já tinha sido registrada antes (${r.registros_anteriores.map(a => fmt.registro(a.id)).join(', ')}).</div>`
    : '';
  $('#ok-qr').src = `/api/public/${r.slug}/qr.png`;
  $('#ok-link').href = r.url;
  $('#ok-link').textContent = r.url.replace(/^https?:\/\//, '');
  $('#btn-abrir').href = `/n/${r.slug}`;
  $('#btn-compartilhar').onclick = () => compartilharLink(r.url, `Nota ${fmt.registro(r.id)}`);
  mostrar('sucesso');
}

$('#btn-outra').addEventListener('click', () => {
  estado.notaArquivos = [];
  estado.chave = null;
  estado.anexos.forEach(a => URL.revokeObjectURL(a.url));
  estado.anexos = [];
  ultimaConsulta = '';
  $('#campo-chave').value = '';
  $('#chave-status').innerHTML = '';
  $('#comentario').value = '';
  $('#painel-chave').classList.add('oculto');
  $('#btn-chave').classList.remove('ativo');
  $('#envio-erro').classList.add('oculto');
  desenharNota();
  desenharAnexos();
  mostrar('envio');
});

// ─── Arquivos vindos do "Compartilhar" do Android ────
async function receberCompartilhados() {
  if (!new URLSearchParams(location.search).has('compartilhado') || !('caches' in window)) return;
  history.replaceState(null, '', '/');
  const cache = await caches.open('compartilhado');
  const chaves = await cache.keys();
  const arquivos = [];
  for (const req of chaves) {
    const resp = await cache.match(req);
    const blob = await resp.blob();
    arquivos.push(new File([blob], decodeURIComponent(resp.headers.get('X-Nome') || 'arquivo'), { type: blob.type }));
    await cache.delete(req);
  }
  const ehNota = f => /\.(pdf|xml)$/i.test(f.name) || /pdf|xml/.test(f.type);
  adicionarArquivosNota(arquivos.filter(ehNota));
  await adicionarAnexos(arquivos.filter(f => !ehNota(f)));
}

// ─── Início ──────────────────────────────────────────
(async function iniciar() {
  try {
    estado.config = await api('/api/config');
    $('#limite-txt').textContent = `Até ${estado.config.maxAnexos} arquivos, de no máximo ${estado.config.maxFileMb} MB cada.`;
  } catch { /* usa o padrão */ }

  let usuario = null;
  try { usuario = (await api('/api/eu')).usuario; } catch { /* offline */ }

  // Cookie perdido mas o aparelho lembra quem é: refaz o cadastro em silêncio
  if (!usuario) {
    try {
      const salvo = JSON.parse(localStorage.getItem('nf_usuario') || 'null');
      if (salvo?.nome && salvo?.email) {
        usuario = (await api('/api/cadastro', { json: salvo })).usuario;
      }
    } catch { /* segue para o cadastro */ }
  }

  if (usuario) {
    mostrarUsuario(usuario);
    mostrar('envio');
  } else {
    mostrar('cadastro');
  }
  await receberCompartilhados();
})();
