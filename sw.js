// Cambiamos a v3 para obligar a los celulares a descargar todo de nuevo
const CACHE_NAME = 'cpce-solicitudes-v3';

// 1. Instalar y forzar a tomar el control inmediatamente
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        './',
        './index.html',
        './styles.css',
        './app.js',
        './api.js',
        './config.js'
      ]);
    })
  );
});

// 2. Limpiar versiones viejas de la memoria del celular
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

// 3. Estrategia "Network First" (Red primero, caché de respaldo)
self.addEventListener('fetch', (e) => {
  // Nunca interceptar las llamadas al servidor de Google
  if (e.request.url.includes('script.google.com')) {
    return;
  }
  
  e.respondWith(
    // Intenta buscar la versión más nueva en internet...
    fetch(e.request)
      .then((response) => {
        // Si hay internet, actualiza la caché silenciosamente y muestra la web
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return response;
      })
      .catch(() => {
        // Si no hay internet, muestra la versión guardada en el celular
        return caches.match(e.request);
      })
  );
});