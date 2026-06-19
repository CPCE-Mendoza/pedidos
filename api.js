// ─────────────────────────────────────────────────────────────
//  api.js — Cliente HTTP hacia el backend de Apps Script
//  Todas las llamadas al servidor pasan por este módulo.
// ─────────────────────────────────────────────────────────────

const API = (() => {

  /**
   * Llamada base. Apps Script con "Ejecutar como: Yo"
   * requiere no-cors para solicitudes cross-origin,
   * pero podemos usar CORS normal porque nuestro doPost
   * devuelve ContentService sin restricciones de origen.
   *
   * IMPORTANTE: Apps Script ignora headers de CORS en doPost
   * con deployments públicos — fetch con mode:'cors' funciona.
   */
  async function call(action, payload = {}) {
    const token = Session.getToken();
    const body  = JSON.stringify({ action, token, ...payload });

    const res = await fetch(CONFIG.API_URL, {
      method:  'POST',
      // Apps Script no acepta preflight (OPTIONS), así que
      // enviamos como text/plain para evitar preflight CORS.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
    });

    if (!res.ok) throw new Error(`Error HTTP ${res.status}`);

    const data = await res.json();

    // Si el backend reporta sesión inválida, limpiar y redirigir
    if (!data.success && data.message && data.message.includes('sesión')) {
      Session.clear();
      App.showView('login');
      throw new Error(data.message);
    }

    return data;
  }

  return {
    login:            (email, password)          => call('login',            { email, password }),
    getFormConfig:    ()                         => call('getFormConfig'),
    submitRequest:    (area, recurso, justif)    => call('submitRequest',    { area, recurso, justificacion: justif }),
    getMyRequests:    ()                         => call('getMyRequests'),
    getAllRequests:    ()                         => call('getAllRequests'),
    updateStatus:     (area, id, estado, notas)  => call('updateStatus',     { area, id, nuevoEstado: estado, notas }),
    updateFormConfig: (area, opciones)           => call('updateFormConfig', { area, opciones }),
  };
})();