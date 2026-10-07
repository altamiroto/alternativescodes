// Painel do administrador
const painel = {
  filtro: 'todas',
  pagina: 1,
  notas: [],
  selecionadas: new Set(),
  baseUrl: location.origin,
};

function mostrarTela(nome) {
  for (const t of ['login', 'notas', 'usuarios']) $(`#tela-${t}`).classList.toggle('oculto', t !== nome);
  $('#menu').hidden = nome === 'login';
  $$('.aba[data-aba]').forEach(b => b.classList.toggle('ativa', b.dataset.aba === nome));
}

// ─── Login ───────────────────────────────────────────
$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#login-erro');
  erro.classList.add('oculto');
  try {
    await api('/api/admin/login', { json: { usuario: $('#login-usuario').value, senha: $('#login-senha').value } });
    entrar();
  } catch (err) {
    erro.textContent = err.message;
    erro.classList.remove('oculto');
  }
});

$('#sair').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

$$('.aba[data-aba]').forEach(b => b.addEventListener('click', () => {
  mostrarTela(b.dataset.aba);
  if (b.dataset.aba === 'usuarios') carregarUsuarios();
}));

// Sessão expirada no meio do uso: volta para o login
async function adm(url, opcoes) {
  try {
    return await api(url, opcoes);
  } catch (err) {
    if (err.status === 401) mostrarTela('login');
    throw err;
  }
}

// ─── Lista de notas ──────────────────────────────────
let atrasoBusca;
$('#busca').addEventListener('input', () => {
  clearTimeout(atrasoBusca);
  atrasoBusca = setTimeout(() => { painel.pagina = 1; carregarNotas(); }, 300);
});
for (const id of ['#data-de', '#data-ate']) $(id).addEventListener('change', () => { painel.pagina = 1; carregarNotas(); });
$$('.chip').forEach(c => c.addEventListener('click', () => {
  $$('.chip').forEach(x => x.classList.toggle('ativo', x === c));
  painel.filtro = c.dataset.filtro;
  painel.pagina = 1;
  carregarNotas();
}));

async function carregarNotas() {
  const params = new URLSearchParams({ filtro: painel.filtro, pagina: painel.pagina });
  if ($('#busca').value.trim()) params.set('q', $('#busca').value.trim());
  if ($('#data-de').value) params.set('de', $('#data-de').value);
  if ($('#data-ate').value) params.set('ate', $('#data-ate').value);
  const r = await adm(`/api/admin/notas?${params}`);
  painel.notas = r.notas;
  painel.baseUrl = r.baseUrl;
  painel.ultima = r;
  desenharLista(r);
}

// Realça o termo buscado dentro do trecho (o trecho já vem sem acentos e minúsculo)
function destacar(trecho, termo) {
  const t = termo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const i = t ? trecho.indexOf(t) : -1;
  if (i < 0) return escapar(trecho);
  return escapar(trecho.slice(0, i)) + '<mark>' + escapar(trecho.slice(i, i + t.length)) + '</mark>' + escapar(trecho.slice(i + t.length));
}

function selos(n) {
  const s = [];
  if (n.deleted_at) s.push('<span class="selo erro">na lixeira</span>');
  if (!n.publico_ativo) s.push('<span class="selo erro">link suspenso</span>');
  s.push(n.etiqueta_impressa_em ? '<span class="selo ok">etiqueta impressa</span>' : '<span class="selo">sem etiqueta</span>');
  if (!n.chave) s.push('<span class="selo atencao">sem chave</span>');
  else if (n.parse_status !== 'completo') s.push('<span class="selo atencao">dados incompletos</span>');
  if (n.qtd_arquivos) s.push(`<span class="selo">📎 ${n.qtd_arquivos}</span>`);
  return s.join('');
}

function desenharLista(r) {
  if (!r.notas.length) {
    $('#lista').innerHTML = '<div class="vazio">Nenhuma nota encontrada.</div>';
  } else {
    $('#lista').innerHTML = r.notas.map(n => `
      <div class="item ${painel.selecionadas.has(n.id) ? 'selecionado' : ''}" data-id="${n.id}">
        <input type="checkbox" aria-label="Selecionar" data-sel="${n.id}" ${painel.selecionadas.has(n.id) ? 'checked' : ''}>
        <div class="principal">
          <div class="titulo">${escapar(fmt.tituloNota(n))}</div>
          <div class="sub">${escapar(n.emitente_nome || fmt.cnpj(n.emitente_cnpj) || '')}</div>
          ${n.comentario ? `<div class="sub">💬 ${escapar(n.comentario.slice(0, 120))}</div>` : ''}
          ${n.trecho ? `<div class="sub trecho">🔎 …${destacar(n.trecho, $('#busca').value)}…</div>` : ''}
          <div class="selos">${selos(n)}</div>
        </div>
        <div class="lateral">
          <b>${fmt.registro(n.id)}</b><br>
          ${n.valor_total != null ? `${fmt.moeda(n.valor_total)}<br>` : ''}
          <span class="suave">${fmt.data(n.created_at)}</span><br>
          <span class="suave">${escapar(n.criado_por_nome || '')}</span>
        </div>
      </div>`).join('');
  }
  $$('[data-sel]').forEach(cb => cb.addEventListener('click', e => {
    e.stopPropagation();
    const id = Number(cb.dataset.sel);
    if (cb.checked) painel.selecionadas.add(id); else painel.selecionadas.delete(id);
    cb.closest('.item').classList.toggle('selecionado', cb.checked);
    atualizarSelecao();
  }));
  $$('.item').forEach(el => el.addEventListener('click', () => abrirNota(Number(el.dataset.id))));

  const paginas = Math.ceil(r.total / r.porPagina);
  $('#paginacao').innerHTML = paginas > 1 ? `
    <button class="btn pequeno discreto" type="button" data-pag="${r.pagina - 1}" ${r.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="suave">Página ${r.pagina} de ${paginas} · ${r.total} notas</span>
    <button class="btn pequeno discreto" type="button" data-pag="${r.pagina + 1}" ${r.pagina >= paginas ? 'disabled' : ''}>Próxima ›</button>`
    : `<span class="suave">${r.total} nota${r.total === 1 ? '' : 's'}</span>`;
  $$('[data-pag]').forEach(b => b.addEventListener('click', () => { painel.pagina = Number(b.dataset.pag); carregarNotas(); }));
  atualizarSelecao();
}

function atualizarSelecao() {
  const qtd = painel.selecionadas.size;
  $('#qtd-selecionadas').textContent = qtd ? `${qtd} selecionada${qtd > 1 ? 's' : ''}` : 'Selecionar todas';
  $('#btn-etiquetas').disabled = qtd === 0;
  const naPagina = painel.notas.map(n => n.id);
  $('#marcar-todas').checked = naPagina.length > 0 && naPagina.every(id => painel.selecionadas.has(id));
}

$('#marcar-todas').addEventListener('change', e => {
  for (const n of painel.notas) {
    if (e.target.checked) painel.selecionadas.add(n.id); else painel.selecionadas.delete(n.id);
  }
  desenharLista(painel.ultima);
});

// ─── Etiquetas ───────────────────────────────────────
function gerarEtiquetas(ids, layout, marcar) {
  const params = new URLSearchParams({ ids: ids.join(','), layout, marcar: marcar ? '1' : '0' });
  window.open(`/api/admin/etiquetas.pdf?${params}`, '_blank');
}

$('#btn-etiquetas').addEventListener('click', () => {
  const ids = [...painel.selecionadas].sort((a, b) => a - b);
  gerarEtiquetas(ids, Number($('#layout').value), $('#marcar-impressa').checked);
  painel.selecionadas.clear();
  setTimeout(carregarNotas, 1500); // atualiza o selo "etiqueta impressa"
});

// ─── Detalhe / edição ────────────────────────────────
function fecharGaveta() {
  $('#gaveta').classList.add('oculto');
  if (location.hash.startsWith('#nota-')) history.replaceState(null, '', '/admin');
}
$$('[data-fechar]').forEach(el => el.addEventListener('click', fecharGaveta));
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharGaveta(); });

const CAMPOS = [
  ['chave', 'Chave de acesso', 'text', 'inteiro'],
  ['numero', 'Número'], ['serie', 'Série'],
  ['emitente_nome', 'Fornecedor (emitente)', 'text', 'inteiro'],
  ['emitente_cnpj', 'CNPJ do fornecedor'], ['uf', 'UF'],
  ['data_emissao', 'Data de emissão', 'date'], ['valor_total', 'Valor total (R$)'],
  ['destinatario_nome', 'Destinatário', 'text', 'inteiro'],
  ['destinatario_cnpj', 'CNPJ/CPF do destinatário'], ['modelo', 'Modelo (55 NF-e, 65 NFC-e)'],
  ['protocolo', 'Protocolo de autorização', 'text', 'inteiro'],
  ['comentario', 'Comentário', 'textarea', 'inteiro'],
];

async function abrirNota(id) {
  const r = await adm(`/api/admin/notas/${id}`);
  const n = r.nota;
  history.replaceState(null, '', `/admin#nota-${id}`);
  $('#det-titulo').textContent = `${fmt.registro(n.id)} · ${fmt.tituloNota(n)}`;

  const valor = c => {
    if (c === 'valor_total') return n.valor_total == null ? '' : String(n.valor_total).replace('.', ',');
    if (c === 'chave') return fmt.chave(n.chave);
    return n[c] ?? '';
  };
  const campos = CAMPOS.map(([c, rotulo, tipo = 'text', classe = '']) => `
    <div class="${classe}">
      <label for="f-${c}">${rotulo}</label>
      ${tipo === 'textarea'
        ? `<textarea id="f-${c}" data-campo="${c}">${escapar(valor(c))}</textarea>`
        : `<input id="f-${c}" type="${tipo}" data-campo="${c}" value="${escapar(valor(c))}" ${c === 'chave' ? 'class="chave" inputmode="numeric"' : ''}>`}
    </div>`).join('');

  const arquivos = r.arquivos.map(a => `
    <div class="arquivo-linha ${a.deleted_at ? 'removido' : ''}">
      <span>${a.tipo === 'nota_pdf' ? '📄' : a.tipo === 'nota_xml' ? '🧾' : a.mime.startsWith('video/') ? '🎬' : a.mime.startsWith('image/') ? '🖼️' : '📎'}</span>
      <span class="nome">${a.deleted_at ? escapar(a.nome_original) : `<a href="/f/${n.slug}/${a.id}" target="_blank" rel="noopener">${escapar(a.nome_original || 'arquivo')}</a>`}
        <span class="suave pequeno">· ${fmt.tamanho(a.tamanho)}</span></span>
      ${a.deleted_at
        ? `<button class="btn pequeno discreto" type="button" data-restaurar-arq="${a.id}">Restaurar</button>`
        : `<button class="btn pequeno perigo" type="button" data-remover-arq="${a.id}">Remover</button>`}
    </div>`).join('') || '<p class="suave">Nenhum arquivo.</p>';

  $('#det-conteudo').innerHTML = `
    <div class="card">
      <div class="linha" style="justify-content:space-between">
        <a href="${r.url}" target="_blank" rel="noopener" class="pequeno" style="overflow-wrap:anywhere">${escapar(r.url)}</a>
        <button class="btn pequeno discreto" type="button" id="det-copiar">Copiar link</button>
      </div>
      <p class="suave pequeno" style="margin-bottom:0">Enviado por <b>${escapar(n.criado_por_nome || '—')}</b>
        ${n.criado_por_email ? `(${escapar(n.criado_por_email)})` : ''} em ${fmt.dataHora(n.created_at)}<br>
        Leitura: ${escapar(n.origem_dados || '—')} · ${escapar(n.parse_status || '—')}
        ${n.etiqueta_impressa_em ? `<br>Etiqueta impressa em ${fmt.dataHora(n.etiqueta_impressa_em)}` : ''}</p>
    </div>

    <div class="card">
      <h2>Dados da nota</h2>
      <form id="form-nota" class="form-grade">${campos}</form>
      <div id="det-erro" class="aviso erro oculto"></div>
      <div class="linha" style="margin-top:14px">
        <button class="btn pequeno primario" type="button" id="det-salvar">💾 Salvar</button>
        <button class="btn pequeno discreto" type="button" id="det-reprocessar" title="Lê de novo o PDF/XML e preenche campos vazios">🔄 Ler PDF/XML de novo</button>
      </div>
    </div>

    ${n.itens?.length ? `
    <div class="card">
      <h2>Produtos (${n.itens.length})</h2>
      <table class="tabela">
        <thead><tr><th>Descrição</th><th>Qtd</th><th class="esconder-celular">Código / EAN</th></tr></thead>
        <tbody>${n.itens.map(i => `<tr>
          <td>${escapar(i.descricao)}</td>
          <td>${i.quantidade != null ? `${String(i.quantidade).replace('.', ',')} ${escapar(i.unidade || '')}` : ''}</td>
          <td class="esconder-celular pequeno">${escapar([i.codigo, i.ean].filter(Boolean).join(' · '))}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <div class="card">
      <h2>Etiqueta</h2>
      <div class="linha">
        <select id="det-layout" style="width:auto;min-height:40px;padding:6px 10px">
          <option value="4">4 por folha</option><option value="8">8 por folha</option><option value="16">16 por folha</option>
        </select>
        <button class="btn pequeno discreto" type="button" id="det-etiqueta">🖨️ Gerar etiqueta desta nota</button>
      </div>
    </div>

    <div class="card">
      <h2>Arquivos</h2>
      ${arquivos}
      <input type="file" id="det-novos" multiple hidden>
      <button class="btn pequeno discreto" type="button" id="det-anexar" style="margin-top:10px">➕ Adicionar arquivos</button>
    </div>

    <div class="card">
      <h2>Acesso e exclusão</h2>
      <div class="linha">
        <button class="btn pequeno discreto" type="button" id="det-suspender">${n.publico_ativo ? '⏸️ Suspender link público' : '▶️ Reativar link público'}</button>
        ${n.deleted_at
          ? '<button class="btn pequeno discreto" type="button" id="det-restaurar">♻️ Restaurar da lixeira</button>'
          : '<button class="btn pequeno perigo" type="button" id="det-excluir">🗑️ Mover para a lixeira</button>'}
      </div>
      <p class="suave pequeno" style="margin-bottom:0">O link e o QR Code nunca mudam. Suspender só esconde o conteúdo até reativar.</p>
    </div>

    <div class="card">
      <h2>Histórico</h2>
      <ul class="historico">${r.historico.map(h => `<li>${fmt.dataHora(h.created_at)} · <b>${escapar(h.quem || '')}</b> ${escapar(h.acao)}</li>`).join('') || '<li>Sem registros.</li>'}</ul>
    </div>`;

  $('#gaveta').classList.remove('oculto');
  const recarregar = async () => { await abrirNota(id); carregarNotas(); };

  $('#det-copiar').onclick = () => copiar(r.url, 'Link copiado!');
  $('#det-salvar').onclick = async () => {
    const corpo = {};
    $$('[data-campo]', $('#form-nota')).forEach(el => { corpo[el.dataset.campo] = el.value; });
    try {
      await adm(`/api/admin/notas/${id}`, { method: 'PATCH', json: corpo });
      aviso('Salvo!');
      recarregar();
    } catch (err) {
      $('#det-erro').textContent = err.message;
      $('#det-erro').classList.remove('oculto');
    }
  };
  $('#det-reprocessar').onclick = async () => {
    const res = await adm(`/api/admin/notas/${id}/reprocessar`, { method: 'POST' });
    aviso(res.preenchidos.length ? `Preenchido: ${res.preenchidos.join(', ')}` : 'Nada novo encontrado no arquivo.', 4000);
    recarregar();
  };
  $('#det-etiqueta').onclick = () => { gerarEtiquetas([id], Number($('#det-layout').value), true); setTimeout(recarregar, 1500); };
  $('#det-suspender').onclick = async () => {
    await adm(`/api/admin/notas/${id}`, { method: 'PATCH', json: { publico_ativo: !n.publico_ativo } });
    recarregar();
  };
  $('#det-excluir')?.addEventListener('click', async () => {
    if (!confirm('Mover esta nota para a lixeira? O link deixa de funcionar até ser restaurada.')) return;
    await adm(`/api/admin/notas/${id}/excluir`, { method: 'POST' });
    fecharGaveta();
    carregarNotas();
  });
  $('#det-restaurar')?.addEventListener('click', async () => {
    await adm(`/api/admin/notas/${id}/restaurar`, { method: 'POST' });
    recarregar();
  });
  $$('[data-remover-arq]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover este arquivo do registro?')) return;
    await adm(`/api/admin/arquivos/${b.dataset.removerArq}`, { method: 'DELETE' });
    recarregar();
  }));
  $$('[data-restaurar-arq]').forEach(b => b.addEventListener('click', async () => {
    await adm(`/api/admin/arquivos/${b.dataset.restaurarArq}/restaurar`, { method: 'POST' });
    recarregar();
  }));
  $('#det-anexar').onclick = () => $('#det-novos').click();
  $('#det-novos').onchange = async e => {
    const form = new FormData();
    for (const f of e.target.files) {
      const ehNota = /\.(pdf|xml)$/i.test(f.name) && !r.arquivos.some(a => !a.deleted_at && a.tipo === (/\.xml$/i.test(f.name) ? 'nota_xml' : 'nota_pdf'));
      form.append(ehNota ? 'nota' : 'anexos', f, f.name);
    }
    try {
      await adm(`/api/admin/notas/${id}/arquivos`, { method: 'POST', body: form });
      aviso('Arquivos adicionados!');
      recarregar();
    } catch (err) {
      aviso(err.message, 5000);
    }
  };
}

// ─── Usuários ────────────────────────────────────────
async function carregarUsuarios() {
  const { usuarios } = await adm('/api/admin/usuarios');
  $('#usuarios').innerHTML = usuarios.length ? `
    <table class="tabela">
      <thead><tr><th>Nome</th><th class="esconder-celular">E-mail</th><th>Notas</th><th class="esconder-celular">Desde</th><th></th></tr></thead>
      <tbody>${usuarios.map(u => `
        <tr>
          <td><b>${escapar(u.nome)}</b>${u.bloqueado ? ' <span class="selo erro">bloqueado</span>' : ''}</td>
          <td class="esconder-celular">${escapar(u.email)}</td>
          <td>${u.qtd_notas}</td>
          <td class="esconder-celular">${fmt.data(u.created_at)}</td>
          <td><button class="btn pequeno ${u.bloqueado ? 'discreto' : 'perigo'}" type="button" data-bloquear="${u.id}" data-valor="${!u.bloqueado}">
            ${u.bloqueado ? 'Desbloquear' : 'Bloquear'}</button></td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<p class="suave">Ninguém se cadastrou ainda.</p>';
  $$('[data-bloquear]').forEach(b => b.addEventListener('click', async () => {
    await adm(`/api/admin/usuarios/${b.dataset.bloquear}`, { method: 'PATCH', json: { bloqueado: b.dataset.valor === 'true' } });
    carregarUsuarios();
  }));
}

// ─── Início ──────────────────────────────────────────
async function entrar() {
  mostrarTela('notas');
  await carregarNotas();
  const m = /^#nota-(\d+)$/.exec(location.hash);
  if (m) abrirNota(Number(m[1])).catch(() => {});
}

(async () => {
  const { admin } = await api('/api/admin/eu').catch(() => ({ admin: false }));
  if (admin) entrar(); else mostrarTela('login');
})();
