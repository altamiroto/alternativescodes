// Service worker: abre rápido (cache da "casca" do app) e recebe arquivos do "Compartilhar" do Android.
// Dados das notas e a API sempre vêm da rede.
const VERSAO = 'notas-v3';
const CASCA = [
  '/', '/imprimir', '/instalar', '/css/app.css', '/js/comum.js', '/js/enviar.js', '/js/imprimir.js', '/js/nota.js',
  '/nota.html', '/manifest.json', '/icons/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO && k !== 'compartilhado').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function receberCompartilhamento(request) {
  const form = await request.formData();
  const cache = await caches.open('compartilhado');
  const arquivos = form.getAll('arquivos').filter(f => f && typeof f !== 'string');
  await Promise.all(arquivos.map((f, i) => cache.put(
    `/compartilhado/${Date.now()}-${i}`,
    new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nome': encodeURIComponent(f.name || 'arquivo') } })
  )));
  return Response.redirect('/?compartilhado=1', 303);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (e.request.method === 'POST' && url.pathname === '/compartilhar') {
    e.respondWith(receberCompartilhamento(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/f/') || url.pathname.startsWith('/admin')) return;

  // Página pública /n/<código>: sempre a mesma casca
  const alvo = url.pathname.startsWith('/n/') ? '/nota.html' : e.request;

  // Rede primeiro (pega atualizações), cache se estiver sem internet
  // cache: 'no-cache' = sempre confere com o servidor (nunca usa cópia velha do navegador)
  const rede = e.request.mode === 'navigate'
    ? fetch(e.request)
    : fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' });
  e.respondWith(
    rede
      .then(resp => {
        if (resp.ok && CASCA.includes(url.pathname)) {
          const copia = resp.clone();
          caches.open(VERSAO).then(c => c.put(e.request, copia));
        }
        return resp;
      })
      .catch(() => caches.match(alvo, { ignoreSearch: true }))
  );
});
