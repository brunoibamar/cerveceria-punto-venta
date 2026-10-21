/**
 * Service Worker - Cervecería POS
 * Permite el funcionamiento offline caché de activos y recursos.
 * Versión: 1.4.0
 */

const CACHE_VERSION = 'cerveceria-pos-v1.4.0';
const CACHE_NAME = `${CACHE_VERSION}-offline`;
const DATA_CACHE_NAME = `${CACHE_VERSION}-data`;

// Recursos estáticos que se cachean al instalar.
const PRECACHE_ASSETS = [
  '/',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/animations.js',
  './js/login.js',
  './js/sales.js',
  './js/pos.js',
  './js/inventory.js',
  './js/promos.js',
  './js/reports.js',
  './js/settings.js',
  './db/database.js',
  './services/emailService.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== DATA_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Estrategia: Network first para datos, Cache first para activos estáticos.
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // No interceptar peticiones de no-GET o de extensiones de navegador.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // No cachear peticiones externas (APIs de terceros).
  if (!url.origin.startsWith(self.location.origin)) {
    return;
  }

  // Estrategia Network First para páginas y scripts.
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cacheamos la respuesta para uso futuro.
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return response;
      })
      .catch(() => {
        // Si falla la red, usar el cache.
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // Si es una página de navegación, devolver index.html.
          if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
          return cached;
        });
      })
  );
});

// Permite que la app pida actualizaciones en segundo plano.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sales') {
    event.waitUntil(syncPendingSales());
  }
});

function syncPendingSales() {
  return Promise.resolve();
}