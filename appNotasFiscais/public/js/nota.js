// Página pública do registro: só leitura
(async function () {
  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
  let r;
  try {
    r = await api(`/api/public/${encodeURIComponent(slug)}`);
  } catch {
    $('#carregando').classList.add('oculto');
    $('#nao-encontrada').classList.remove('oculto');
    return;
  }
  const n = r.nota;
  const arq = id => `/f/${n.slug}/${id}`;

  document.title = `${fmt.tituloNota(n)} · ${fmt.registro(n.id)}`;
  $('#registro').innerHTML = `Registro<br><b>${fmt.registro(n.id)}</b>`;
  $('#titulo').textContent = fmt.tituloNota(n);

  const linhas = [
    ['Fornecedor', n.emitente_nome],
    ['CNPJ', fmt.cnpj(n.emitente_cnpj)],
    ['Emissão', fmt.data(n.data_emissao)],
    ['Destinatário', n.destinatario_nome],
    ['CNPJ dest.', fmt.cnpj(n.destinatario_cnpj)],
    ['UF', n.uf],
    ['Protocolo', n.protocolo],
  ].filter(([, v]) => v);
  $('#dados').innerHTML = linhas.map(([k, v]) => `<dt>${k}</dt><dd>${escapar(v)}</dd>`).join('')
    || '<dd class="suave" style="grid-column:1/-1">Sem dados da nota além do que foi enviado.</dd>';

  if (n.chave) {
    $('#barras').src = `/api/public/${n.slug}/barras.png`;
    $('#chave').textContent = fmt.chave(n.chave);
    $('#btn-copiar-chave').onclick = () => copiar(n.chave, 'Chave copiada!');
  } else {
    $('#card-chave').classList.add('oculto');
  }

  // Documento da nota (PDF / XML)
  const docs = r.arquivos.filter(a => a.tipo !== 'anexo');
  $('#documentos').innerHTML = docs.map(a => a.tipo === 'nota_pdf'
    ? `<a class="btn primario" href="${arq(a.id)}" target="_blank" rel="noopener">📄 Ver PDF da nota</a>`
    : `<a class="btn discreto" href="${arq(a.id)}" download>🧾 Baixar XML da nota</a>`).join('');
  $('#card-documentos').classList.toggle('oculto', docs.length === 0);

  if (n.comentario) $('#comentario').textContent = n.comentario;
  else $('#card-comentario').classList.add('oculto');

  // Anexos
  const anexos = r.arquivos.filter(a => a.tipo === 'anexo');
  const visuais = anexos.filter(a => /^image\/(jpeg|png|gif|webp|avif)$/.test(a.mime) || a.mime.startsWith('video/'));
  const outros = anexos.filter(a => !visuais.includes(a));
  $('#galeria').innerHTML = visuais.map(a => a.mime.startsWith('video/')
    ? `<div class="video"><video src="${arq(a.id)}" controls playsinline preload="metadata"></video></div>`
    : `<a href="${arq(a.id)}" target="_blank" rel="noopener"><img src="${arq(a.id)}" alt="${escapar(a.nome_original)}" loading="lazy"></a>`).join('');
  $('#outros').innerHTML = outros.map(a =>
    `<a class="btn discreto" href="${arq(a.id)}" target="_blank" rel="noopener">📎 ${escapar(a.nome_original || 'Arquivo')} <span class="suave pequeno">(${fmt.tamanho(a.tamanho)})</span></a>`).join('');
  $('#card-anexos').classList.toggle('oculto', anexos.length === 0);

  $('#btn-compartilhar').onclick = () => compartilharLink(r.url, document.title);
  $('#rodape').textContent = `Registrado em ${fmt.dataHora(n.created_at)}${n.criado_por_nome ? ` por ${n.criado_por_nome}` : ''}`;

  // Administrador logado: atalho para editar
  try {
    if ((await api('/api/admin/eu')).admin) {
      $('#aviso-admin').innerHTML = `<div class="aviso atencao" style="margin:0 0 14px">Você está como administrador.
        <a href="/admin#nota-${n.id}">Editar no painel</a></div>`;
    }
  } catch { /* público */ }

  $('#carregando').classList.add('oculto');
  $('#nota').classList.remove('oculto');
})();
