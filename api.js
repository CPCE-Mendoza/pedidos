// ─────────────────────────────────────────────────────────────
//  api.js — Cliente JSONP hacia el backend de Apps Script
//
//  POR QUÉ JSONP:
//  Los dominios Google Workspace (/a/macros/dominio.org/...)
//  bloquean CORS en doPost() porque exigen autenticación OAuth.
//  JSONP carga el endpoint como <script> — no está sujeto a
//  CORS policy — y Apps Script responde con callback({...}).
//
//  SEGURIDAD: Todo viaja por HTTPS (cifrado en tránsito).
//  El token de sesión se valida en cada llamada server-side.
// ─────────────────────────────────────────────────────────────

const API = (() => {

  let _callbackCounter = 0;

  /**
   * Ejecuta una llamada JSONP al backend de Apps Script.
   * Inyecta un <script> con la URL + callback único,
   * espera la respuesta y limpia el DOM.
   *
   * @param {string} action  - Nombre del handler en doGet()
   * @param {Object} params  - Parámetros adicionales (ya como strings)
   * @param {number} timeout - Milisegundos antes de abortar (default 15s)
   */
  function jsonp(action, params = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const cbName = '__apscb_' + (++_callbackCounter) + '_' + Date.now();
      const token  = Session.getToken();

      // Construir query string
      const qs = new URLSearchParams({
        action,
        callback: cbName,
        ...(token ? { token } : {}),
        ...params,
      }).toString();

      const url    = CONFIG.API_URL + '?' + qs;
      const script = document.createElement('script');

      // Timer de timeout
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Tiempo de espera agotado. Verificá tu conexión.'));
      }, timeout);

      // La función global que Apps Script llamará
      window[cbName] = (data) => {
        cleanup();
        // Si el backend reporta sesión inválida → logout
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

  /**
   * Serializa valores que no son strings simples.
   * Arrays y objetos se JSON.stringify + encodeURIComponent.
   */
  function enc(val) {
    if (typeof val === 'string') return encodeURIComponent(val);
    return encodeURIComponent(JSON.stringify(val));
  }

  // ── API pública ──────────────────────────────────────────

  return {
    login(email, password) {
      return jsonp('login', { email, password });
    },

    getFormConfig() {
      return jsonp('getFormConfig');
    },

    // 👇 ESTA ES LA FUNCIÓN NUEVA QUE FALTABA 👇
    submitMultiRequest(data) {
      return jsonp('submitMultiRequest', {
        data: enc(data),
      });
    },

    getMyRequests() {
      return jsonp('getMyRequests');
    },

    getAllRequests() {
      return jsonp('getAllRequests');
    },

    updateStatus(area, id, nuevoEstado, notas) {
      return jsonp('updateStatus', {
        area, id, nuevoEstado,
        notas: enc(notas || ''),
      });
    },

    updateFormConfig(area, opciones) {
      return jsonp('updateFormConfig', {
        area,
        opciones: enc(opciones),
      });
    },
  };

})();