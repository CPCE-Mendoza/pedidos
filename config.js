// ─────────────────────────────────────────────────────────────
//  config.js — Configuración del Frontend
//  Editar estos valores antes de publicar en GitHub Pages.
// ─────────────────────────────────────────────────────────────

const CONFIG = {
  // URL generada al publicar la Web App en Apps Script.
  // Termina en /exec (no en /dev)
  API_URL: 'https://script.google.com/macros/s/AKfycbwh17ZjA_ebDIly30LMSRVTIkaua_a6A9Ko-MtgVLqNzHilXsFVV7rss0iVAzdkJvzu/exec',

  // Nombre que aparece en el header de la app
  ORG_NAME: 'Mi Organización',

  // Colores de estado (para badges)
  STATUS_COLORS: {
    'Pendiente':   'bg-amber-100 text-amber-800',
    'En proceso':  'bg-blue-100 text-blue-800',
    'Completado':  'bg-green-100 text-green-800',
    'Rechazado':   'bg-red-100 text-red-800',
  },

  // Duración de la sesión local en horas (debe coincidir con SESSION_HOURS en .gs)
  SESSION_HOURS: 8,
};