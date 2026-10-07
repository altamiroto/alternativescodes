// Tela de impressão: escolher notas → tamanho → gerar PDF
const imp = {
  filtro: 'pendentes',
  layout: 4,
  notas: [],
  selecionadas: new Set(),
  primeiraCarga: true,
};

async function carregar() {
  const params = new URLSearchParams({ filtro: imp.filtro === 'todas' ? 'todas' : 'pendentes' });
  const q = $('#busca').value.trim();
  if (q) params.set('q', q);
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
  $('#qtd-pendentes').textContent = `(${r.pendentes})`;
  // Ao abrir a tela, já deixa marcadas todas as que ainda não foram impressas
  if (imp.primeiraCarga) {
    imp.primeiraCarga = false;
    r.notas.filter(n => !n.etiqueta_impressa_em).forEach(n => imp.selecionadas.add(n.id));
  }
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
  if (!imp.notas.length) {
    $('#lista').innerHTML = imp.filtro === 'pendentes' && !$('#busca').value.trim()
      ? '<div class="vazio-imp">Nenhuma etiqueta esperando impressão.<br><span class="pequeno">Toque em <b>➕ Adicionar nota fiscal</b>. Para reimprimir, toque em <b>Todas</b>.</span></div>'
      : '<div class="vazio-imp">Nenhuma nota encontrada.</div>';
  } else {
    $('#lista').innerHTML = imp.notas.map(n => `
      <label class="linha-check nota-imp ${imp.selecionadas.has(n.id) ? 'marcada' : ''}">
        <input type="checkbox" data-id="${n.id}" ${imp.selecionadas.has(n.id) ? 'checked' : ''}>
        <span class="info">
          <b>${escapar(fmt.tituloNota(n))}</b>
          <span>${escapar(n.emitente_nome || (n.emitente_cnpj ? `CNPJ ${fmt.cnpj(n.emitente_cnpj)}` : 'Fornecedor não identificado'))}</span>
          <small>Registrada em ${fmt.data(n.created_at)}${n.criado_por_nome ? ` por ${escapar(n.criado_por_nome)}` : ''}
            ${n.etiqueta_impressa_em ? ` · <span class="selo ok">impressa ${fmt.data(n.etiqueta_impressa_em)}</span>` : ''}</small>
        </span>
        <span class="reg">${fmt.registro(n.id)}</span>
      </label>`).join('');
  }
  $$('#lista input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
    const id = Number(cb.dataset.id);
    if (cb.checked) imp.selecionadas.add(id); else imp.selecionadas.delete(id);
    cb.closest('.nota-imp').classList.toggle('marcada', cb.checked);
    atualizarResumo();
  }));
  $('#linha-todas').classList.toggle('oculto', imp.notas.length === 0);
  atualizarResumo();
}

function atualizarResumo() {
  const qtd = imp.selecionadas.size;
  const folhas = Math.ceil(qtd / imp.layout);
  $('#resumo-selecao').textContent = qtd
    ? `${qtd} nota${qtd > 1 ? 's' : ''} selecionada${qtd > 1 ? 's' : ''} · ${folhas} folha${folhas > 1 ? 's' : ''} A4`
    : 'Nenhuma nota selecionada';
  $('#btn-gerar').disabled = qtd === 0;
  const visiveis = imp.notas.map(n => n.id);
  const todas = visiveis.length > 0 && visiveis.every(id => imp.selecionadas.has(id));
  $('#marcar-todas').checked = todas;
  $('#txt-todas').textContent = todas ? `Desmarcar todas (${visiveis.length})` : `Selecionar todas (${visiveis.length})`;
}

$('#marcar-todas').addEventListener('change', e => {
  for (const n of imp.notas) {
    if (e.target.checked) imp.selecionadas.add(n.id); else imp.selecionadas.delete(n.id);
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
  imp.selecionadas.clear();
  $('#pronto').classList.remove('oculto');
  window.scrollTo(0, 0);
  setTimeout(carregar, 1500); // atualiza a lista (as impressas saem de "Ainda não impressas")
});

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
      $('#quem').innerHTML = `Olá, <b>${escapar(usuario.nome.split(' ')[0])}</b>`;
    } else if (!(await api('/api/admin/eu')).admin && !(await recadastrar())) {
      location.replace('/nova'); // primeira vez neste aparelho: cadastro
      return;
    }
  } catch { /* sem internet: tenta carregar mesmo assim */ }
  mostrarAdicionada();
  carregar();
})();

// Veio do formulário: confirma a nota que acabou de entrar na fila
function mostrarAdicionada() {
  const q = new URLSearchParams(location.search);
  if (!q.has('nova')) return;
  history.replaceState(null, '', '/');
  const id = Number(q.get('nova'));
  imp.selecionadas.add(id);
  const repetida = q.get('repetida');
  $('#adicionada').innerHTML = `<div class="aviso ok" style="margin-top:12px">✅ Nota ${fmt.registro(id)} adicionada à impressão.</div>`
    + (repetida ? `<div class="aviso atencao">Atenção: essa nota já tinha sido registrada antes (${repetida.split(',').map(fmt.registro).join(', ')}).</div>` : '');
  $('#adicionada').classList.remove('oculto');
}
