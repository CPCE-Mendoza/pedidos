// ─────────────────────────────────────────────────────────────
//  config.js — Configuración del Frontend

// ─────────────────────────────────────────────────────────────

const CONFIG = {
  // URL generada al publicar la Web App en Apps Script.
  // Termina en /exec (no en /dev)
  API_URL: 'https://script.google.com/macros/s/AKfycbydvtg1WqFkS6KuddmD2kVL0xcEakZEMfwB4Z7w6nW5PAucdoXif329LHQimzfQ69Gm/exec',

  // Nombre que aparece en el header de la app
  ORG_NAME: 'CPCE Mendoza',

  // 👇 CONFIGURACIÓN DE GOOGLE OAUTH 👇
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