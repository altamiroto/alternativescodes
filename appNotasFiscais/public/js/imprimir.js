// Minhas notas: imprimir as notas adicionadas neste fluxo (e, se quiser, antigas)
//
// "Para imprimir agora" = as notas que a pessoa adicionou desde a última lista. A lista fica
// guardada na conta (vale em qualquer aparelho com o mesmo e-mail) e NÃO some ao imprimir:
// só recomeça quando ela adiciona uma nota depois de imprimir ou toca em "Começar lista nova".
// "Notas antigas" = todas as outras notas dela, sem nada marcado: marca só o que quiser.
const imp = {
  filtro: 'lote',
  layout: 4,
  lote: { quantidade: 0, impresso: false },
  notas: [],
  selecionadas: new Set(),
  desmarcadas: new Set(), // notas da lista que a pessoa desmarcou de propósito
};

async function carregar() {
  const params = new URLSearchParams();
  if (imp.filtro === 'lote') {
    params.set('lista', 'agora');
  } else {
    params.set('filtro', 'todas');
    const q = $('#busca').value.trim();
    if (q) params.set('q', q);
  }
  let r;
  try {
    r = await api(`/api/impressao/notas?${params}`);
  } catch (err) {
    if (err.status === 401 && !imp.tentouRecadastro && await recadastrar()) return carregar();
    if (err.status === 401 || err.status === 403) return semAcesso(err);
    aviso(err.message, 5000);
    return;
  }
  imp.notas = r.notas;
  imp.lote = r.lote;
  if (r.todas) $('#titulo-lista').textContent = 'Notas de todos (administrador)';
  // notas da lista entram marcadas (menos as que a pessoa desmarcou)
  if (imp.filtro === 'lote') r.notas.forEach(n => { if (!imp.desmarcadas.has(n.id)) imp.selecionadas.add(n.id); });
  mostrarTela();
}

function mostrarTela() {
  desenhar();
  $('#carregando').classList.add('oculto');
  $('#impressao').classList.remove('oculto');
}

// O aparelho lembra quem é (cadastro feito antes) mas perdeu o login: refaz em silêncio
async function recadastrar() {
  imp.tentouRecadastro = true;
  try {
    const salvo = JSON.parse(localStorage.getItem('nf_usuario') || 'null');
    if (!salvo?.nome || !salvo?.email) return false;
    await api('/api/cadastro', { json: salvo });
    return true;
  } catch {
    return false;
  }
}

function semAcesso(err) {
  // Ainda não se cadastrou: vai para o cadastro (fica na tela de adicionar nota)
  if (err.status === 401) { location.replace('/nova'); return; }
  $('#carregando').classList.add('oculto');
  if (err.status === 403) {
    $('#sem-acesso-titulo').textContent = 'A impressão é feita pelo administrador';
    $('#sem-acesso-texto').textContent = 'Você pode continuar adicionando as notas fiscais normalmente.';
    $('#sem-acesso-botao').textContent = '➕ Adicionar nota fiscal';
    $('#sem-acesso-botao').href = '/nova';
  }
  $('#sem-acesso').classList.remove('oculto');
}

function desenhar() {
  const lote = imp.filtro === 'lote';
  $('#qtd-lote').textContent = imp.lote.quantidade ? `(${imp.lote.quantidade})` : '';
  $('#busca').classList.toggle('oculto', lote);
  $('#explica-filtro').innerHTML = lote
    ? (imp.lote.impresso
      ? '<span class="aviso ok" style="display:block;margin:0">✅ <b>Esta lista já foi impressa.</b> Pode gerar o PDF de novo, se precisar. Ao adicionar uma nota nova, começa uma lista nova.</span>'
      : 'As notas que você adicionou agora. Elas continuam aqui depois de imprimir.')
    : 'Todas as suas outras notas. <b>Marque só as que quiser imprimir.</b>';
  $('#lista-nova').classList.toggle('oculto', !lote || !imp.notas.length);

  if (!imp.notas.length) {
    $('#lista').innerHTML = lote
      ? '<div class="vazio-imp">Nenhuma nota para imprimir agora.<br><span class="pequeno">Toque em <b>➕ Adicionar nota fiscal</b>.</span></div>'
      : '<div class="vazio-imp">Nenhuma nota encontrada.</div>';
  } else {
    $('#lista').innerHTML = imp.notas.map(n => `
      <label class="linha-check nota-imp ${imp.selecionadas.has(n.id) ? 'marcada' : ''}">
        <input type="checkbox" data-id="${n.id}" ${imp.selecionadas.has(n.id) ? 'checked' : ''}>
        <span class="info">
          <b>${escapar(fmt.tituloNota(n))}</b>
          <span>${escapar(n.emitente_nome || (n.emitente_cnpj ? `CNPJ ${fmt.cnpj(n.emitente_cnpj)}` : 'Fornecedor não identificado'))}</span>
          <small>Registrada em ${fmt.data(n.created_at)}${n.criado_por_nome ? ` por ${escapar(n.criado_por_nome)}` : ''}
            ${lote ? '' : n.etiqueta_impressa_em ? ` · <span class="selo ok">impressa ${fmt.data(n.etiqueta_impressa_em)}</span>` : ' · <span class="selo atencao">não impressa</span>'}</small>
        </span>
        <span class="reg">${fmt.registro(n.id)}</span>
      </label>`).join('');
  }
  $$('#lista input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
    const id = Number(cb.dataset.id);
    if (cb.checked) { imp.selecionadas.add(id); imp.desmarcadas.delete(id); } else { imp.selecionadas.delete(id); imp.desmarcadas.add(id); }
    cb.closest('.nota-imp').classList.toggle('marcada', cb.checked);
    atualizarResumo();
  }));
  $('#linha-todas').classList.toggle('oculto', imp.notas.length < 2);
  atualizarResumo();
}

function atualizarResumo() {
  const qtd = imp.selecionadas.size;
  const folhas = Math.ceil(qtd / imp.layout);
  $('#resumo-selecao').textContent = qtd
    ? `${qtd} nota${qtd > 1 ? 's' : ''} marcada${qtd > 1 ? 's' : ''} · ${folhas} folha${folhas > 1 ? 's' : ''} A4`
    : 'Nenhuma nota marcada';
  $('#btn-gerar').textContent = qtd ? `🖨️ Gerar PDF (${qtd})` : '🖨️ Gerar PDF';
  $('#btn-gerar').disabled = qtd === 0;
  const visiveis = imp.notas.map(n => n.id);
  const todas = visiveis.length > 0 && visiveis.every(id => imp.selecionadas.has(id));
  $('#marcar-todas').checked = todas;
  $('#txt-todas').textContent = todas ? `Desmarcar todas (${visiveis.length})` : `Marcar todas (${visiveis.length})`;
}

$('#marcar-todas').addEventListener('change', e => {
  for (const n of imp.notas) {
    if (e.target.checked) { imp.selecionadas.add(n.id); imp.desmarcadas.delete(n.id); } else { imp.selecionadas.delete(n.id); imp.desmarcadas.add(n.id); }
  }
  desenhar();
});

$$('.segmentos button').forEach(b => b.addEventListener('click', () => {
  $$('.segmentos button').forEach(x => x.classList.toggle('ativo', x === b));
  imp.filtro = b.dataset.filtro;
  carregar();
}));

let atraso;
$('#busca').addEventListener('input', () => {
  clearTimeout(atraso);
  atraso = setTimeout(carregar, 300);
});

$$('.tamanho').forEach(b => b.addEventListener('click', () => {
  $$('.tamanho').forEach(x => x.classList.toggle('ativo', x === b));
  imp.layout = Number(b.dataset.layout);
  try { localStorage.setItem('nf_layout', String(imp.layout)); } catch { /* sem armazenamento */ }
  atualizarResumo();
}));

$('#btn-gerar').addEventListener('click', () => {
  const ids = [...imp.selecionadas].sort((a, b) => a - b);
  if (!ids.length) return;
  const params = new URLSearchParams({ ids: ids.join(','), layout: imp.layout });
  // Abre direto (síncrono ao toque) para o navegador não bloquear a nova aba
  const aba = window.open(`/api/impressao/etiquetas.pdf?${params}`, '_blank');
  if (!aba) location.href = `/api/impressao/etiquetas.pdf?${params}`;
  // A lista continua na tela (marcada como impressa) para reimprimir se precisar
  $('#adicionada').classList.add('oculto');
  $('#pronto').classList.remove('oculto');
  window.scrollTo(0, 0);
  setTimeout(carregar, 1500);
});

// "Começar lista nova": esvazia o "Para imprimir agora" (as notas vão para "Notas antigas")
$('#lista-nova').addEventListener('click', async () => {
  if (!imp.lote.impresso && !confirm('Tirar estas notas da lista? Elas continuam em "Notas antigas".')) return;
  await api('/api/impressao/lista-nova', { method: 'POST' }).catch(err => aviso(err.message, 5000));
  imp.selecionadas.clear();
  imp.desmarcadas.clear();
  $('#pronto').classList.add('oculto');
  $('#adicionada').classList.add('oculto');
  carregar();
});

// Veio do formulário: confirma a nota que acabou de entrar na lista
function receberNova() {
  const q = new URLSearchParams(location.search);
  if (!q.has('nova')) return;
  history.replaceState(null, '', '/');
  const ids = q.get('nova').split(',').map(Number).filter(Boolean);
  const repetidas = (q.get('repetida') || '').split(',').map(Number).filter(Boolean);
  const texto = ids.length > 1
    ? `✅ ${ids.length} notas adicionadas (${ids.map(fmt.registro).join(', ')}).`
    : `✅ Nota ${fmt.registro(ids[0])} adicionada. Adicione outra ou gere o PDF.`;
  $('#adicionada').innerHTML = `<div class="aviso ok" style="margin-top:12px">${texto}</div>`
    + (repetidas.length ? `<div class="aviso atencao">Atenção: ${repetidas.length > 1 ? 'as notas' : 'a nota'} ${repetidas.map(fmt.registro).join(', ')} já tinha${repetidas.length > 1 ? 'm' : ''} sido registrada${repetidas.length > 1 ? 's' : ''} antes.</div>` : '');
  $('#adicionada').classList.remove('oculto');
}

// ─── Início ──────────────────────────────────────────
(async () => {
  try {
    const salvo = Number(localStorage.getItem('nf_layout'));
    if ([4, 8, 16].includes(salvo)) {
      imp.layout = salvo;
      $$('.tamanho').forEach(x => x.classList.toggle('ativo', Number(x.dataset.layout) === salvo));
    }
  } catch { /* padrão: 4 */ }
  try {
    const { usuario } = await api('/api/eu');
    if (usuario) {
      $('#quem').innerHTML = `Olá, <b>${escapar(usuario.nome.split(' ')[0])}</b><br><a href="/nova?trocar=1" class="pequeno">não é você?</a>`;
    } else if (!(await api('/api/admin/eu')).admin && !(await recadastrar())) {
      location.replace('/nova'); // primeira vez neste aparelho: cadastro
      return;
    }
  } catch { /* sem internet: tenta carregar mesmo assim */ }
  receberNova();
  carregar();
})();
