const CACHE_NAME = 'planilha-v8-cache';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Instalação do Service Worker e cache dos arquivos
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting(); // Força a atualização imediata
});

// Ativação e limpeza de caches antigos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// Intercepta requisições: se estiver offline, busca do cache
self.addEventListener('fetch', (e) => {
  // Ignora requisições para a API (/api/...)
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    caches.match(e.request).then((response) => {
      // Retorna do cache se encontrar, senão tenta a rede
      return response || fetch(e.request).catch(() => {
        // Se a rede falhar e for navegação, retorna o index.html
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
