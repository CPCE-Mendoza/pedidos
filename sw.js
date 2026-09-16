const CACHE_NAME = 'cpce-solicitudes-v1';

// Instalamos los archivos estáticos básicos
self.addEventListener('install', (e) => {
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

// Interceptamos peticiones de red
self.addEventListener('fetch', (e) => {
  // NUNCA cachear las llamadas a Google Apps Script (para que los datos siempre sean en vivo)
  if (e.request.url.includes('script.google.com')) {
    return;
  }
  
  // Para el resto (HTML, CSS, JS), usar cache si existe, sino buscar en red
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});