// ─────────────────────────────────────────────────────────────
//  config.js — Configuración del Frontend
//  Editar estos valores antes de publicar en GitHub Pages.
// ─────────────────────────────────────────────────────────────

const CONFIG = {
  // URL generada al publicar la Web App en Apps Script.
  // Termina en /exec (no en /dev)
  API_URL: 'https://script.google.com/macros/s/AKfycbzDDbYfSbsdLqwyAQiUT54ZEkbWRNW8Rdt8E9MO33JMMuShA6ma13ebH4WYcOwqW-KM/exec',

  // Nombre que aparece en el header de la app
  ORG_NAME: 'CPCE Mendoza',

  // 👇 CONFIGURACIÓN DE GOOGLE OAUTH 👇
  // Reemplazá el texto entre comillas con el ID de cliente real que te dio Google Cloud
  GOOGLE_CLIENT_ID: '393097089260-i83spq9s90vecj3rqp031ogg3381h7mc.apps.googleusercontent.com', 
  
  // Dominio corporativo permitido (bloquea accesos externos)
  DOMINIO: 'cpcemza.org.ar',

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