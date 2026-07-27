// ─────────────────────────────────────────────────────────────
//  api.js — Cliente JSONP hacia el backend de Apps Script
//  v2.6 — Completo y definitivo
// ─────────────────────────────────────────────────────────────

const API = (() => {

  let _callbackCounter = 0;

  function jsonp(action, params = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const cbName = '__apscb_' + (++_callbackCounter) + '_' + Date.now();
      const token  = Session.getToken();

      const qs = new URLSearchParams({
        action,
        callback: cbName,
        ...(token ? { token } : {}),
        ...params,
      }).toString();

      const url    = CONFIG.API_URL + '?' + qs;
      const script = document.createElement('script');

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Tiempo de espera agotado. Verificá tu conexión.'));
      }, timeout);

      window[cbName] = (data) => {
        cleanup();
        if (!data.success && data.message &&
            (data.message.includes('sesión') || data.message.includes('Sesión'))) {
          Session.clear();
          App.showView('login');
        }
        resolve(data);
      };

      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      script.onerror = () => {
        cleanup();
        reject(new Error('No se pudo conectar con el servidor. Verificá la URL en config.js'));
      };

      script.src = url;
      document.head.appendChild(script);
    });
  }

  function enc(val) {
    if (typeof val === 'string') return encodeURIComponent(val);
    return encodeURIComponent(JSON.stringify(val));
  }

  return {

    // ── Autenticación ──────────────────────────────────────────
    login(email, password) {
      return jsonp('login', { email, password });
    },

    loginOAuth(idToken) {
      return jsonp('loginOAuth', { id_token: idToken }, 20000);
    },

    // ── Configuración ──────────────────────────────────────────
    getFormConfig() {
      return jsonp('getFormConfig');
    },

    updateFormConfig(area, opciones) {
      return jsonp('updateFormConfig', { area, opciones: enc(opciones) });
    },

    // ── Solicitudes ────────────────────────────────────────────
    submitMultiRequest(data) {
      return jsonp('submitMultiRequest', { data: enc(data) });
    },

    getMyRequests() {
      return jsonp('getMyRequests');
    },

    getAllRequests() {
      return jsonp('getAllRequests');
    },

    // ── Estados ────────────────────────────────────────────────
    updateStatus(area, id, nuevoEstado, notas) {
      return jsonp('updateStatus', {
        area, id, nuevoEstado,
        notas: enc(notas || ''),
      });
    },

    // ── Reportes PDF ───────────────────────────────────────────
    // 45s de timeout — generar PDF + subir a Drive puede tardar bastante
    generarReporteArea(estado) {
      return jsonp('generarReporteArea', { estado: estado || '' }, 45000);
    },

    // ── Diagrama ───────────────────────────────────────────────
    // Como las imágenes son muy pesadas para JSONP (GET), usamos fetch (POST).
    subirDiagrama(requestId, base64, mime, ext) {
      return fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: {
          // text/plain evita bloqueos CORS de preflight en Google Apps Script
          'Content-Type': 'text/plain;charset=utf-8', 
        },
        body: JSON.stringify({
          action: 'subirDiagrama',
          token: Session.getToken(),
          request_id: requestId,
          diagrama_b64: encodeURIComponent(base64),
          diagrama_mime: encodeURIComponent(mime),
          diagrama_ext: encodeURIComponent(ext)
        })
      }).then(res => res.json());
    },

  };

})();