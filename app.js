/**
 * app.js — Portal de Solicitudes CPCE Mendoza
 * v2.5 — SHA-256 hashing + precarga paralela + login optimizado
 *
 * MEJORAS DE VELOCIDAD:
 *  1. SHA-256 client-side (Web Crypto API, nativa del browser, sin librerías)
 *  2. Precarga de getFormConfig en cuanto el campo email pierde el foco
 *  3. JSONP timeout reducido a 10s (era 15s)
 *  4. sessionStorage como capa de cache L1 para la config
 *     (survives page refresh, cleared on tab close)
 *  5. Token de sesión con renovación silenciosa si queda < 1h
 */

// ──────────────────────────────────────────────────────
// CONSTANTES
// ──────────────────────────────────────────────────────
const AREAS = ['Compras', 'Mantenimiento', 'Tecnica'];

const ESTADO_MAP = {
  Pendiente:    { bg: '#fff3cd', color: '#856404', icon: '🕐' },
  'En proceso': { bg: '#cfe2ff', color: '#084298', icon: '⚙️' },
  Completado:   { bg: '#d1e7dd', color: '#0a3622', icon: '✅' },
  Rechazado:    { bg: '#f8d7da', color: '#58151c', icon: '❌' },
};

// ──────────────────────────────────────────────────────
// CRYPTO — SHA-256 con Web Crypto API (nativa, sin deps)
// ──────────────────────────────────────────────────────
async function sha256(str) {
  const buf    = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ──────────────────────────────────────────────────────
// SESSION
// ──────────────────────────────────────────────────────
const Session = (() => {
  const KEY = 'sol_sess';

  const save = (data) => localStorage.setItem(KEY, JSON.stringify({
    ...data,
    exp: Date.now() + CONFIG.SESSION_HOURS * 3600 * 1000,
  }));

  const get = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s || Date.now() > s.exp) { localStorage.removeItem(KEY); return null; }
      return s;
    } catch { return null; }
  };

  const clear = () => {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem('sol_cfg'); // limpiar cache de config también
  };

  return {
    save, get, clear,
    getToken: () => get()?.token,
    getEmail: () => get()?.email,
    isAdmin:  () => get()?.rol === 'admin',
    getArea:  () => get()?.areaAdmin || '',
  };
})();

// ──────────────────────────────────────────────────────
// UI HELPERS
// ──────────────────────────────────────────────────────
const UI = {
  show(id) { document.getElementById(id)?.classList.remove('hidden'); },
  hide(id) { document.getElementById(id)?.classList.add('hidden'); },

  toast(msg, type = 'success') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent   = msg;
    t.className     = `toast toast--${type}`;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.display = 'none'; }, 4000);
  },

  setLoading(id, on, text = 'Procesando...') {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (on) btn.dataset.orig = btn.textContent;
    btn.textContent = on ? text : (btn.dataset.orig || btn.textContent);
    btn.disabled    = on;
  },

  fieldError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent   = msg;
    el.style.display = msg ? 'block' : 'none';
  },

  statusBadge(estado) {
    const s = ESTADO_MAP[estado] || { bg: '#e9ecef', color: '#495057', icon: '•' };
    return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;
      font-size:11px;font-weight:700;background:${s.bg};color:${s.color};
      white-space:nowrap;">${s.icon} ${estado}</span>`;
  },
};

// ──────────────────────────────────────────────────────
// FORMCONFIG — cache de 3 capas:
//   L1: variable en memoria (_configCache)      — más rápido
//   L2: sessionStorage                          — survives refresh
//   L3: API call                                — fuente de verdad
// ──────────────────────────────────────────────────────
const CONFIG_SS_KEY = 'sol_cfg';
let _configCache   = null;
let _configPromise = null;

function fetchFormConfig() {
  // L1: ya está en memoria
  if (_configCache) return Promise.resolve(_configCache);

  // L2: en sessionStorage (parseamos una sola vez)
  if (!_configCache) {
    try {
      const raw = sessionStorage.getItem(CONFIG_SS_KEY);
      if (raw) {
        _configCache = JSON.parse(raw);
        return Promise.resolve(_configCache);
      }
    } catch {}
  }

  // L3: llamada a la API (de-duplicada con _configPromise)
  if (_configPromise) return _configPromise;

  _configPromise = API.getFormConfig()
    .then(res => {
      if (!res.success) throw new Error(res.message);
      _configCache   = res.data;
      _configPromise = null;
      // Guardar en sessionStorage para próximas cargas
      try { sessionStorage.setItem(CONFIG_SS_KEY, JSON.stringify(res.data)); } catch {}
      return _configCache;
    })
    .catch(err => { _configPromise = null; throw err; });

  return _configPromise;
}

function renderCheckboxes(config) {
  // Solo Compras usa checkboxes dinámicos
  // Mantenimiento y Tecnica tienen formularios propios en el HTML
  const container = document.getElementById('area-Compras');
  if (!container) return;
  const opciones = config['Compras'] || [];
  container.innerHTML = opciones.length
    ? opciones.map((op, i) => `
        <div class="checkbox-item">
          <input type="checkbox" id="cb-Compras-${i}" name="Compras" value="${op}">
          <label for="cb-Compras-${i}">${op}</label>
        </div>`).join('')
    : '<p style="color:var(--text-subtle);font-size:13px;padding:4px;">Sin opciones configuradas</p>';
}

// ──────────────────────────────────────────────────────
// PRECARGA — SOLO se dispara si ya hay sesión activa.
// Sin sesión no hay token válido → el backend rechaza
// getFormConfig y el error contamina _configPromise.
// ──────────────────────────────────────────────────────
function bindPrecarga() {
  // Solo precargamos si el usuario YA está logueado
  // (ej: refresh de página con sesión activa)
  if (Session.getToken()) {
    fetchFormConfig().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────
// APP ROUTER
// ──────────────────────────────────────────────────────
const App = {
  async init() {
    bindEvents();
    bindPrecarga();

    const session = Session.get();
    if (session) {
      this._applySession(session);
      // Mostrar formulario inmediatamente, pintar checkboxes en paralelo
      this.showView('form');
      this._loadConfig();
    } else {
      this.showView('login');
    }
  },

  async _loadConfig() {
    try {
      const config = await fetchFormConfig();
      renderCheckboxes(config);
    } catch {
      UI.toast('No se pudo cargar la configuración.', 'error');
    }
  },

  _applySession(session) {
    const nav = document.getElementById('app-nav');
    if (nav) nav.style.display = 'flex';
    const userEl = document.getElementById('user-email-short');
    if (userEl) userEl.textContent = session.email.split('@')[0];
    const adminBtn = document.getElementById('nav-admin');
    if (adminBtn) adminBtn.style.display = session.rol === 'admin' ? 'flex' : 'none';
  },

  showView(name) {
    ['login', 'form', 'my-requests', 'admin'].forEach(v =>
      document.getElementById('view-' + v)?.classList.toggle('hidden', v !== name)
    );
    if (name === 'my-requests') loadMyRequests();
    if (name === 'admin')       loadAdminPanel();
  },
};

// ──────────────────────────────────────────────────────
// EVENTOS GLOBALES
// ──────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('form-login')
    ?.addEventListener('submit', handleLogin);
  document.getElementById('form-request')
    ?.addEventListener('submit', handleSubmitRequest);
  document.getElementById('btn-logout')
    ?.addEventListener('click', () => {
      // Revocar sesión de Google para que no auto-loguee en el próximo acceso
      try {
        if (window.google?.accounts?.id) {
          google.accounts.id.disableAutoSelect();
          google.accounts.id.revoke(Session.getEmail() || '', () => {});
        }
      } catch {}

      Session.clear();
      _configCache = _configPromise = null;
      document.getElementById('app-nav').style.display = 'none';
      App.showView('login');
    });
}

// ──────────────────────────────────────────────────────
// OAUTH — Google Identity Services
// Se inicializa cuando el script de Google carga (callback onGoogleLibraryLoad)
// ──────────────────────────────────────────────────────

// Callback que llama Google cuando su librería termina de cargar
function onGoogleLibraryLoad() {
  if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.includes('TU_CLIENT_ID')) {
    // Client ID no configurado → solo mostrar formulario clásico
    document.getElementById('oauth-section')?.style.setProperty('display', 'none');
    return;
  }

  google.accounts.id.initialize({
    client_id:        CONFIG.GOOGLE_CLIENT_ID,
    callback:         handleOAuthCredential,
    auto_select:      false,  // No auto-login silencioso
    cancel_on_tap_outside: true,
    // Restringir al dominio corporativo
    hosted_domain:    CONFIG.DOMINIO,
  });

  // Renderizar el botón oficial de Google
  google.accounts.id.renderButton(
    document.getElementById('google-signin-btn'),
    {
      theme:     'outline',
      size:      'large',
      text:      'signin_with',
      shape:     'rectangular',
      logo_alignment: 'center',
      width:     280,
      locale:    'es',
    }
  );
}

/**
 * Callback que Google llama cuando el usuario selecciona su cuenta.
 * Recibe el credential (id_token JWT) y lo valida contra el backend.
 */
async function handleOAuthCredential(googleResponse) {
  const idToken = googleResponse?.credential;
  if (!idToken) {
    showOAuthError('No se recibió respuesta de Google. Intentá de nuevo.');
    return;
  }

  showOAuthLoading(true);

  try {
    const res = await API.loginOAuth(idToken);

    if (!res.success) throw new Error(res.message);

    // ✅ Login OAuth exitoso — mismo flujo que login clásico
    Session.save(res);
    App._applySession(res);
    App.showView('form');
    App._loadConfig();
    UI.toast(`Bienvenido/a, ${res.email.split('@')[0]} 👋`);

    // Limpiar estado OAuth
    showOAuthError('');

  } catch (err) {
    showOAuthError(err.message);
    // Revocar para que el usuario pueda intentar con otra cuenta
    google.accounts.id.disableAutoSelect();
  } finally {
    showOAuthLoading(false);
  }
}

function showOAuthError(msg) {
  const el = document.getElementById('oauth-error');
  if (!el) return;
  el.textContent   = msg;
  el.style.display = msg ? 'block' : 'none';
}

function showOAuthLoading(on) {
  const loading = document.getElementById('oauth-loading');
  const btnWrap = document.getElementById('google-btn-wrap');
  if (loading) loading.style.display = on ? 'block' : 'none';
  if (btnWrap) btnWrap.style.display = on ? 'none'  : 'flex';
}

// ──────────────────────────────────────────────────────
// LOGIN HELPERS — overlay de carga y mensajes de error
// ──────────────────────────────────────────────────────
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  if (!msg) {
    el.style.display = 'none';
    el.textContent   = '';
    return;
  }
  el.textContent   = msg;
  el.style.display = 'block';
  // Scroll suave hacia el error
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showLoginOverlay(on) {
  // Bloquear el botón y mostrar spinner en el texto
  const btn = document.getElementById('btn-login');
  if (!btn) return;
  if (on) {
    btn.dataset.orig = btn.textContent;
    btn.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:8px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.5" style="animation:spin-login .7s linear infinite;">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83
            M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        Verificando...
      </span>`;
    btn.disabled = true;

    // Estilo del spinner (se inyecta una sola vez)
    if (!document.getElementById('spin-style')) {
      const s = document.createElement('style');
      s.id = 'spin-style';
      s.textContent = '@keyframes spin-login { to { transform: rotate(360deg); } }';
      document.head.appendChild(s);
    }

    // Overlay semitransparente sobre el formulario
    let overlay = document.getElementById('login-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'login-overlay';
      overlay.style.cssText = `
        position:absolute; inset:0; background:rgba(255,255,255,.6);
        display:flex; align-items:center; justify-content:center;
        border-radius:inherit; z-index:10;
      `;
      const formEl = document.getElementById('form-login');
      if (formEl) {
        formEl.style.position = 'relative';
        formEl.appendChild(overlay);
      }
    }
    overlay.style.display = 'flex';

  } else {
    btn.innerHTML = btn.dataset.orig || 'Acceder';
    btn.disabled  = false;
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'none';
  }
}

// ──────────────────────────────────────────────────────
// LOGIN — SHA-256 client-side + overlay + diagnóstico
// ──────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pass  = document.getElementById('login-password').value;

  // Limpiar error anterior
  showLoginError('');

  // Validación rápida client-side antes de tocar la red
  if (!email) { showLoginError('Ingresá tu correo electrónico.'); return; }
  if (!email.includes('@')) { showLoginError('El correo no parece válido.'); return; }
  if (!pass)  { showLoginError('Ingresá tu contraseña.'); return; }

  // Mostrar overlay de carga
  showLoginOverlay(true);

  try {
    // SHA-256 de la contraseña — nunca sale en texto plano
    const passHash = await sha256(pass);

    // Llamar al backend
    let res;
    try {
      res = await API.login(email, passHash);
    } catch (netErr) {
      // Error de red / timeout / CORS
      throw new Error(
        'No se pudo conectar con el servidor. ' +
        'Verificá tu conexión o intentá de nuevo en unos segundos.'
      );
    }

    // Respuesta recibida pero con error de credenciales
    if (!res.success) {
      throw new Error(res.message || 'Credenciales incorrectas.');
    }

    // ✅ Login exitoso
    Session.save(res);
    App._applySession(res);
    e.target.reset();
    App.showView('form');

    // Cargar config DESPUÉS del login (ahora sí tenemos token)
    App._loadConfig();
    UI.toast(`Bienvenido/a, ${email.split('@')[0]} 👋`);

  } catch (err) {
    showLoginError(err.message);
  } finally {
    showLoginOverlay(false);
  }
}

// ──────────────────────────────────────────────────────
// NUEVA SOLICITUD
// ──────────────────────────────────────────────────────
async function handleSubmitRequest(e) {
  e.preventDefault();
  UI.setLoading('btn-submit', true, 'Enviando...');
  UI.fieldError('form-error', '');

  const evento      = document.getElementById('evento')?.value.trim()      || '';
  const fecha       = document.getElementById('fecha')?.value               || '';
  const horario     = document.getElementById('horario')?.value             || '';
  const horarioFin  = document.getElementById('horario_fin')?.value         || '';
  const asistentes  = document.getElementById('asistentes')?.value          || '';
  const comentarios = document.getElementById('comentarios')?.value.trim() || '';

  const justificacion = [
    fecha       ? `Fecha: ${fecha}`                           : '',
    horario     ? `Horario: ${horario} — ${horarioFin || '?'}` : '',
    asistentes  ? `Asistentes: ${asistentes}`                 : '',
    comentarios ? `Comentarios: ${comentarios}`               : '',
  ].filter(Boolean).join(' | ');

  const requerimientos = {};

  // Compras: checkboxes simples (dinámicos desde config)
  const comprasChecked = [...document.querySelectorAll('input[name="Compras"]:checked')]
    .map(cb => cb.value);
  if (comprasChecked.length) requerimientos['Compras'] = comprasChecked;

  // Mantenimiento: formulario detallado con grillas
  const mantoData = recolectarMantenimiento();
  if (mantoData) requerimientos['Mantenimiento'] = mantoData;

  // Técnica: campos numéricos de equipamiento
  const tecnicaData = recolectarTecnica();
  if (tecnicaData) requerimientos['Tecnica'] = tecnicaData;

  try {
    if (!evento)                             throw new Error('Ingresá el nombre del evento.');
    if (!fecha)                              throw new Error('Seleccioná la fecha del evento.');
    if (!horario)                            throw new Error('Indicá el horario de inicio.');
    if (!horarioFin)                         throw new Error('Indicá el horario de fin.');
    if (horarioFin <= horario)               throw new Error('La hora de fin debe ser posterior al inicio.');
    if (!asistentes || +asistentes < 1)      throw new Error('Indicá la cantidad de personas.');
    if (!Object.keys(requerimientos).length) throw new Error('Seleccioná al menos un recurso.');

    const res = await API.submitMultiRequest({ evento, justificacion, requerimientos });
    if (!res.success) throw new Error(res.message);

    // Extraer el ID de la respuesta ("Solicitud registrada en X área(s). ID: REQ-xxx")
    const idMatch = res.message.match(/REQ-\d+/);
    const reqId   = idMatch ? idMatch[0] : null;

    // Subir diagrama en segundo plano si existe
    if (reqId && _diagramaFile) {
      subirDiagramaBackground(reqId, _diagramaFile);
    }

    UI.toast(`✅ ${res.message}`);
    e.target.reset();
    resetMantenimiento();
    resetTecnica();
    removeDiagramaOnReset();
  } catch (err) {
    UI.fieldError('form-error', err.message);
  } finally {
    UI.setLoading('btn-submit', false);
  }
}

// ──────────────────────────────────────────────────────
// MIS SOLICITUDES — con historial desplegable
// ──────────────────────────────────────────────────────
async function loadMyRequests() {
  const list = document.getElementById('my-requests-list');
  list.innerHTML = skeletonCards(3);
  try {
    const res = await API.getMyRequests();
    if (!res.success) throw new Error(res.message);

    if (!res.data.length) {
      list.innerHTML = emptyState('No tenés solicitudes registradas aún.');
      return;
    }

    const byId = groupById(res.data);
    list.innerHTML = Object.entries(byId).map(([id, rows]) => {
      const first = rows[0];
      return `
        <div class="req-card">
          <div class="req-card__header">
            <div>
              <div class="req-card__id">${id}</div>
              <div class="req-card__title">${escapeHtml(first.evento || extractEvento(first.justificacion))}</div>
              <div class="req-card__sub">${formatDate(first.fecha)}</div>
            </div>
          </div>
          <div class="req-card__areas">
            ${rows.map(r => `
              <div class="req-card__area-block">
                <div class="req-card__area-row">
                  <span class="req-card__area-label">${areaIcon(r.area)} ${r.area}</span>
                  ${UI.statusBadge(r.estado)}
                </div>
                <div class="req-card__recurso-detail">
                  ${renderRecurso(r.recurso, r.area)}
                </div>
                ${renderHistorial(r.historial, r.id + '-' + r.area)}
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');

    injectCardStyles();
  } catch (err) {
    list.innerHTML = `<p style="color:var(--error);text-align:center;">${err.message}</p>`;
  }
}

// ──────────────────────────────────────────────────────
// HISTORIAL
// ──────────────────────────────────────────────────────
function renderHistorial(historial, uid) {
  if (!historial?.length) return '';
  const toggleId   = 'hist-' + uid.replace(/[^a-z0-9]/gi, '-');
  const countLabel = historial.length === 1 ? '1 movimiento' : `${historial.length} movimientos`;

  const lineas = historial.map((h, i) => {
    const s       = ESTADO_MAP[h.estado] || { bg: '#e9ecef', color: '#495057', icon: '•' };
    const esUltimo = i === historial.length - 1;
    return `
      <div class="hist-item${esUltimo ? ' hist-item--last' : ''}">
        <div class="hist-dot" style="background:${s.color};"></div>
        <div class="hist-body">
          <div class="hist-header">
            <span class="hist-estado" style="color:${s.color};">${s.icon} ${h.estado}</span>
            <span class="hist-ts">${formatDatetime(h.ts)}</span>
          </div>
          ${h.nota ? `<div class="hist-nota">💬 ${escapeHtml(h.nota)}</div>` : ''}
          <div class="hist-admin">por ${escapeHtml(h.admin === 'manual' ? 'edición directa' : (h.admin || '—'))}</div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="hist-wrap">
      <button class="hist-toggle" onclick="toggleHistorial('${toggleId}')">
        📋 Ver historial (${countLabel})
      </button>
      <div id="${toggleId}" class="hist-list hidden">${lineas}</div>
    </div>`;
}

function toggleHistorial(id) {
  const el  = document.getElementById(id);
  const btn = el?.previousElementSibling;
  if (!el) return;
  const nowHidden = el.classList.toggle('hidden');
  if (btn) {
    btn.textContent = nowHidden
      ? btn.textContent.replace('Ocultar', 'Ver')
      : btn.textContent.replace('Ver', 'Ocultar');
  }
}

// ──────────────────────────────────────────────────────
// ADMIN PANEL
// ──────────────────────────────────────────────────────
let _adminCache = [];

async function loadAdminPanel() {
  if (!Session.isAdmin()) { App.showView('form'); return; }
  document.getElementById('admin-area-name').textContent = 'Área: ' + (Session.getArea() || '—');
  const list = document.getElementById('admin-requests-list');
  list.innerHTML = skeletonCards(2);

  try {
    const [reqRes, cfgRes] = await Promise.all([
      API.getAllRequests(),
      fetchFormConfig(),
    ]);
    if (!reqRes.success) throw new Error(reqRes.message);
    _adminCache = reqRes.data;
    renderAdminRequests(_adminCache);
    renderAdminConfig(cfgRes);
  } catch (err) {
    list.innerHTML = `<p style="color:var(--error);text-align:center;">${err.message}</p>`;
  }
}

function renderAdminCard(r) {
  return `
    <div class="req-card" id="row-${r.id}">
      <div class="req-card__header">
        <div style="flex:1;min-width:0;">
          <div class="req-card__id">${r.id}</div>
          <div class="req-card__title">${escapeHtml(r.evento || r.recurso)}</div>
          <div class="req-card__sub">${escapeHtml(r.solicitante)} · ${formatDate(r.fecha)}</div>
        </div>
        <div style="flex-shrink:0;">${UI.statusBadge(r.estado)}</div>
      </div>
      <div class="req-card__justif">
        ${renderRecurso(r.recurso, r.area)}
        <div style="margin-top:6px;color:var(--text-subtle);font-size:12px;">
          ${escapeHtml(r.justificacion).replace(/\n/g, ' · ')}
        </div>
      </div>
      ${renderHistorial(r.historial, r.id)}
      <div class="req-card__actions" style="margin-top:10px;">
        <select class="status-select admin-select">
          ${['Pendiente','En proceso','Completado','Rechazado'].map(s =>
            `<option ${s === r.estado ? 'selected' : ''}>${s}</option>`
          ).join('')}
        </select>
        <input type="text" placeholder="Nota para el solicitante..."
          class="notes-input admin-input" value="${escapeHtml(r.notas || '')}">
        <button class="btn btn--primary admin-btn"
          onclick="submitStatusUpdate('${r.id}', '${r.area}', this)">
          Guardar
        </button>
      </div>
    </div>`;
}

function renderAdminRequests(items) {
  const list = document.getElementById('admin-requests-list');
  if (!items.length) { list.innerHTML = emptyState('No hay solicitudes en tu área.'); return; }
  list.innerHTML = items.map(renderAdminCard).join('');
  injectCardStyles();
}

async function submitStatusUpdate(id, area, btn) {
  const row    = document.getElementById('row-' + id);
  const estado = row.querySelector('.status-select').value;
  const notas  = row.querySelector('.notes-input').value.trim();

  btn.disabled    = true;
  btn.textContent = '⏳';

  try {
    const res = await API.updateStatus(area, id, estado, notas);
    if (!res.success) throw new Error(res.message);

    UI.toast('✅ Actualizado. Solicitante notificado.');

    // Actualizar cache + historial local sin reload
    const cached = _adminCache.find(r => r.id === id);
    if (cached) {
      cached.estado = estado;
      cached.notas  = notas;
      if (!cached.historial) cached.historial = [];
      cached.historial.push({
        estado, nota: notas,
        admin: Session.getEmail(),
        ts:    new Date().toISOString(),
      });
    }

    // Reemplazar solo esta card en el DOM
    const tmp = document.createElement('div');
    tmp.innerHTML = cached ? renderAdminCard(cached) : '';
    const newCard = tmp.firstElementChild;
    if (newCard) row.replaceWith(newCard);
    injectCardStyles();

  } catch (err) {
    UI.toast(err.message, 'error');
    btn.disabled    = false;
    btn.textContent = 'Guardar';
  }
}

function filterAdminRequests() {
  const q      = document.getElementById('admin-search').value.toLowerCase();
  const estado = document.getElementById('admin-filter-status').value;
  renderAdminRequests(_adminCache.filter(r =>
    (!q || r.solicitante.toLowerCase().includes(q) ||
           r.recurso.toLowerCase().includes(q) ||
           r.id.toLowerCase().includes(q) ||
           (r.evento || '').toLowerCase().includes(q)) &&
    (!estado || r.estado === estado)
  ));
}

// ──────────────────────────────────────────────────────
// CONFIG ADMIN
// ──────────────────────────────────────────────────────
function renderAdminConfig(config) {
  const area = Session.getArea();
  const ta   = document.getElementById('config-opciones');
  if (ta) ta.value = ((config && config[area]) || []).join('\n');
}

async function saveAdminConfig() {
  const area    = Session.getArea();
  const opciones = document.getElementById('config-opciones').value
    .split('\n').map(s => s.trim()).filter(Boolean);
  UI.setLoading('btn-save-config', true, 'Guardando...');
  try {
    const res = await API.updateFormConfig(area, opciones);
    if (!res.success) throw new Error(res.message);
    // Actualizar las dos capas de cache
    if (_configCache) _configCache[area] = opciones;
    try { sessionStorage.setItem(CONFIG_SS_KEY, JSON.stringify(_configCache)); } catch {}
    UI.toast('✅ Opciones actualizadas.');
  } catch (err) {
    UI.toast(err.message, 'error');
  } finally {
    UI.setLoading('btn-save-config', false);
  }
}

function switchAdminTab(tab) {
  ['tab-solicitudes', 'tab-config'].forEach(t => {
    document.getElementById(t)?.classList.toggle('hidden', t !== tab);
    const btn = document.getElementById('tab-btn-' + t.replace('tab-', ''));
    if (btn) {
      const active = t === tab;
      btn.style.color             = active ? 'var(--blue-main)' : 'var(--text-muted)';
      btn.style.borderBottomColor = active ? 'var(--blue-main)' : 'transparent';
    }
  });
}

// ──────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────
function groupById(rows) {
  return rows.reduce((acc, r) => { (acc[r.id] = acc[r.id] || []).push(r); return acc; }, {});
}

function extractEvento(justif) {
  const m = (justif || '').match(/Evento:\s*(.+?)(\n|$)/);
  return m ? m[1].trim() : (justif || '').substring(0, 50);
}

function formatDate(val) {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  } catch { return String(val); }
}

function formatDatetime(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return isoStr; }
}

function areaIcon(area) {
  return { Compras: '🛒', Mantenimiento: '🏢', Tecnica: '💻' }[area] || '📋';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function skeletonCards(n) {
  return Array(n).fill(0).map(() => `
    <div style="border:1px solid var(--border);border-radius:var(--radius-md);
      padding:16px;background:var(--surface);animation:pulse 1.5s infinite;">
      <div style="height:12px;background:#e0e8f0;border-radius:4px;width:40%;margin-bottom:10px;"></div>
      <div style="height:16px;background:#e0e8f0;border-radius:4px;width:70%;margin-bottom:8px;"></div>
      <div style="height:12px;background:#e0e8f0;border-radius:4px;width:55%;"></div>
    </div>`).join('');
}

function emptyState(msg) {
  return `<div style="text-align:center;padding:32px 16px;">
    <div style="font-size:36px;margin-bottom:8px;">📭</div>
    <p style="color:var(--text-subtle);font-size:15px;">${msg}</p>
  </div>`;
}

let _stylesInjected = false;
function injectCardStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
    .req-card {
      border:1px solid var(--border); border-radius:var(--radius-md);
      padding:14px; background:var(--surface); transition:box-shadow .2s;
    }
    .req-card:hover { box-shadow:var(--shadow-md); }
    .req-card__header {
      display:flex; justify-content:space-between;
      align-items:flex-start; margin-bottom:8px; gap:8px;
    }
    .req-card__id    { font-size:11px; font-family:monospace; color:var(--text-subtle); }
    .req-card__title { font-weight:700; color:var(--text-dark); font-size:15px; }
    .req-card__sub   { font-size:12px; color:var(--text-muted); margin-top:2px; }
    .req-card__areas { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
    .req-card__area-row {
      display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13px;
    }
    .req-card__area-label { font-weight:600; color:var(--blue-main); min-width:100px; }
    .req-card__recursos   { flex:1; color:var(--text-dark); }
    .req-card__justif {
      font-size:13px; color:var(--text-muted); margin:6px 0 10px; line-height:1.5;
    }
    .req-card__actions {
      display:grid; gap:8px; grid-template-columns:140px 1fr auto;
    }
    @media(max-width:520px){ .req-card__actions{ grid-template-columns:1fr; } }
    .admin-select,.admin-input {
      padding:7px 10px; border:1px solid var(--border);
      border-radius:var(--radius-sm); font-size:13px; font-family:inherit; width:100%;
    }
    .admin-select:focus,.admin-input:focus {
      outline:none; border-color:var(--blue-main);
      box-shadow:0 0 0 2px rgba(26,95,168,.15);
    }
    .admin-btn { white-space:nowrap; padding:7px 14px; font-size:13px; }
    /* ── HISTORIAL ── */
    .hist-wrap  { margin:8px 0 4px; }
    .hist-toggle {
      background:none; border:1px dashed var(--border);
      border-radius:var(--radius-sm); padding:5px 10px;
      font-size:12px; color:var(--text-muted); cursor:pointer; transition:all .15s;
    }
    .hist-toggle:hover {
      background:var(--blue-pale); border-color:var(--blue-main); color:var(--blue-main);
    }
    .hist-list {
      margin-top:8px; padding:10px 0 2px 16px;
      border-left:2px solid var(--border);
      display:flex; flex-direction:column; gap:0;
    }
    .hist-item  { position:relative; padding:0 0 14px 18px; }
    .hist-item--last { padding-bottom:4px; }
    .hist-dot {
      position:absolute; left:-6px; top:3px;
      width:10px; height:10px; border-radius:50%;
      border:2px solid var(--white); box-shadow:0 0 0 1px var(--border);
    }
    .hist-header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .hist-estado { font-weight:700; font-size:13px; }
    .hist-ts     { font-size:11px; color:var(--text-subtle); }
    .hist-nota   {
      margin-top:3px; font-size:12px; color:var(--text-mid);
      background:var(--gold-light); border-radius:4px; padding:3px 8px; display:inline-block;
    }
    .hist-admin  { font-size:11px; color:var(--text-subtle); margin-top:2px; }

    /* ── AREA BLOCK (mis solicitudes) ── */
    .req-card__area-block {
      padding:10px 0; border-bottom:1px solid var(--border);
    }
    .req-card__area-block:last-child { border-bottom:none; padding-bottom:0; }
    .req-card__area-block:first-child { padding-top:0; }
    .req-card__recurso-detail { margin:6px 0 6px 4px; }

    /* ── CHIPS (Compras / Tecnica) ── */
    .rec-chips { display:flex; flex-wrap:wrap; gap:5px; }
    .rec-chip {
      display:inline-block; padding:3px 10px;
      background:var(--blue-pale); color:var(--blue-main);
      border:1px solid var(--blue-light);
      border-radius:999px; font-size:12px; font-weight:600;
    }

    /* ── LISTA MANTENIMIENTO ── */
    .rec-manto { display:flex; flex-direction:column; gap:7px; }
    .rec-manto__item {
      display:flex; align-items:flex-start; gap:7px;
    }
    .rec-manto__icon { font-size:14px; line-height:1.4; flex-shrink:0; }
    .rec-manto__body { display:flex; flex-direction:column; gap:3px; flex:1; }
    .rec-manto__cat  {
      font-size:11px; font-weight:700; text-transform:uppercase;
      letter-spacing:0.05em; color:var(--text-muted);
    }
    .rec-manto__text { font-size:13px; color:var(--text-dark); }
    .rec-manto__subs { display:flex; flex-wrap:wrap; gap:4px; }
    .rec-manto__sub  {
      display:inline-flex; align-items:center; gap:4px;
      background:var(--surface); border:1px solid var(--border);
      border-radius:6px; padding:2px 8px; font-size:12px;
    }
    .rec-manto__sub-label { color:var(--text-muted); }
    .rec-manto__sub-val   { font-weight:700; color:var(--blue-main); }
    .rec-manto__other     { font-size:13px; color:var(--text-dark); }
  `;
  document.head.appendChild(style);
}

// Mostrar/ocultar input "Otro" en Instalaciones
function toggleOtroInstalaciones(cb) {
  const wrap = document.getElementById('inst_otro_input_wrap');
  if (wrap) wrap.style.display = cb.checked ? 'block' : 'none';
  if (!cb.checked) {
    const txt = document.getElementById('inst_otro_text');
    if (txt) txt.value = '';
  }
}

// ──────────────────────────────────────────────────────
// MANTENIMIENTO — Recolectar campos del formulario detallado
// ──────────────────────────────────────────────────────
function recolectarMantenimiento() {
  // Grilla Seguridad
  const segGuardias   = document.querySelector('input[name="seg_guardias"]:checked')?.value   || 'No aplica';
  const segAcceso     = document.querySelector('input[name="seg_acceso"]:checked')?.value     || 'No aplica';
  const segAmbulancia = document.querySelector('input[name="seg_ambulancia"]:checked')?.value || 'No aplica';

  // Grilla Limpieza
  const limpDurante  = document.querySelector('input[name="limp_durante"]:checked')?.value  || 'No aplica';
  const limpPost     = document.querySelector('input[name="limp_post"]:checked')?.value     || 'No aplica';
  const limpResiduos = document.querySelector('input[name="limp_residuos"]:checked')?.value || 'No aplica';

  // Instalaciones (checkboxes múltiples)
  const instalaciones = [...document.querySelectorAll('input[name="instalaciones"]:checked')]
    .map(cb => {
      if (cb.value === 'otro') {
        const txt = document.getElementById('inst_otro_text')?.value.trim();
        return txt ? `Otro: ${txt}` : null;
      }
      return cb.value;
    })
    .filter(Boolean);

  // Observaciones
  const observaciones = document.getElementById('manto_observaciones')?.value.trim() || '';

  // Encomienda
  const encomienda = document.querySelector('input[name="encomienda"]:checked')?.value || 'No';

  // Construir resumen legible para guardar en la hoja
  const partes = [
    `SEGURIDAD — Guardias: ${segGuardias} | Acceso/Acreditaciones: ${segAcceso} | Ambulancia: ${segAmbulancia}`,
    `LIMPIEZA — Durante: ${limpDurante} | Post evento: ${limpPost} | Residuos especiales: ${limpResiduos}`,
  ];

  if (instalaciones.length) {
    partes.push(`INSTALACIONES — ${instalaciones.join(', ')}`);
  }

  if (observaciones) {
    partes.push(`OBSERVACIONES — ${observaciones}`);
  }

  partes.push(`ENCOMIENDA — ${encomienda}`);

  // Si TODO está en "No aplica" y no hay nada seleccionado → no enviar
  const todoNoAplica =
    segGuardias   === 'No aplica' &&
    segAcceso     === 'No aplica' &&
    segAmbulancia === 'No aplica' &&
    limpDurante   === 'No aplica' &&
    limpPost      === 'No aplica' &&
    limpResiduos  === 'No aplica' &&
    instalaciones.length === 0   &&
    !observaciones               &&
    encomienda === 'No';

  if (todoNoAplica) return null; // No incluir Mantenimiento si no pidió nada

  return partes;
}

// ──────────────────────────────────────────────────────
// MANTENIMIENTO — Reset completo del formulario
// ──────────────────────────────────────────────────────
function resetMantenimiento() {
  // Radios de seguridad → No aplica
  ['seg_guardias','seg_acceso','seg_ambulancia',
   'limp_durante','limp_post','limp_residuos'].forEach(name => {
    const noAplica = document.querySelector(`input[name="${name}"][value="No aplica"]`);
    if (noAplica) noAplica.checked = true;
  });

  // Checkboxes instalaciones → desmarcados
  document.querySelectorAll('input[name="instalaciones"]')
    .forEach(cb => { cb.checked = false; });

  // Ocultar input "Otro"
  const otroWrap = document.getElementById('inst_otro_input_wrap');
  if (otroWrap) otroWrap.style.display = 'none';
  const otroText = document.getElementById('inst_otro_text');
  if (otroText) otroText.value = '';

  // Observaciones
  const obs = document.getElementById('manto_observaciones');
  if (obs) obs.value = '';

  // Encomienda → No
  const encNo = document.querySelector('input[name="encomienda"][value="No"]');
  if (encNo) encNo.checked = true;
}

// ──────────────────────────────────────────────────────
// REPORTE PDF — botón del panel admin
// ──────────────────────────────────────────────────────
async function descargarReporteArea() {
  const btn    = document.getElementById('btn-reporte');
  const estado = document.getElementById('admin-filter-status')?.value || '';

  if (btn) {
    btn.dataset.orig = btn.textContent;
    btn.textContent  = '⏳ Generando PDF...';
    btn.disabled     = true;
  }

  try {
    const res = await API.generarReporteArea(estado);
    if (!res.success) throw new Error(res.message);

    // Abrir la URL de descarga en pestaña nueva
    window.open(res.url, '_blank');
    UI.toast('✅ PDF generado. Descargando...');
  } catch (err) {
    UI.toast('Error al generar el PDF: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.textContent = btn.dataset.orig || '📄 Descargar Reporte';
      btn.disabled    = false;
    }
  }
}

// ──────────────────────────────────────────────────────
// MEJORA 3: VALIDACIÓN DE HORARIOS en tiempo real
// ──────────────────────────────────────────────────────
function validarHorarios() {
  const inicio = document.getElementById('horario')?.value     || '';
  const fin    = document.getElementById('horario_fin')?.value || '';
  const errEl  = document.getElementById('horario-error');
  const finInput = document.getElementById('horario_fin');

  if (!errEl || !finInput) return true;

  if (inicio && fin && fin <= inicio) {
    errEl.style.display    = 'block';
    finInput.style.border  = '1.5px solid var(--error)';
    return false;
  }

  errEl.style.display   = 'none';
  finInput.style.border = '';
  return true;
}

// ──────────────────────────────────────────────────────
// RENDER RECURSO — formatea el campo "recurso" según el área.
// Mantenimiento: multilínea con prefijos SEGURIDAD —, LIMPIEZA —, etc.
//   → se muestra como lista de items con icono y sub-valores.
// Compras / Tecnica: lista simple separada por comas.
//   → chips/tags inline.
// ──────────────────────────────────────────────────────
function renderRecurso(recurso, area) {
  if (!recurso) return '';

  if (area === 'Mantenimiento') {
    // Cada línea es una categoría: "SEGURIDAD — Guardias: 3 | Acceso: No aplica | ..."
    const lineas = String(recurso).split('\n').filter(l => l.trim());

    const ICONS = {
      SEGURIDAD:    '🛡️',
      LIMPIEZA:     '🧹',
      INSTALACIONES:'⚡',
      OBSERVACIONES:'💬',
      ENCOMIENDA:   '📦',
    };

    return `<div class="rec-manto">
      ${lineas.map(linea => {
        // Separar "CATEGORIA — detalle"
        const dashIdx = linea.indexOf(' — ');
        if (dashIdx === -1) return `<div class="rec-manto__item"><span class="rec-manto__other">${escapeHtml(linea)}</span></div>`;

        const cat    = linea.substring(0, dashIdx).trim();
        const detail = linea.substring(dashIdx + 3).trim();
        const icon   = ICONS[cat] || '•';

        // Para SEGURIDAD y LIMPIEZA: los sub-items vienen como "Guardias: 3 | Acceso: No aplica"
        // Filtramos los que son "No aplica" para no mostrar ruido
        if (cat === 'SEGURIDAD' || cat === 'LIMPIEZA') {
          const subItems = detail.split('|').map(s => s.trim()).filter(s => {
            const val = s.split(':')[1]?.trim();
            return val && val !== 'No aplica';
          });

          if (!subItems.length) return ''; // Todos en No aplica → no mostrar

          return `<div class="rec-manto__item">
            <span class="rec-manto__icon">${icon}</span>
            <div class="rec-manto__body">
              <span class="rec-manto__cat">${cap(cat)}</span>
              <div class="rec-manto__subs">
                ${subItems.map(s => {
                  const [label, val] = s.split(':').map(x => x.trim());
                  return `<span class="rec-manto__sub">
                    <span class="rec-manto__sub-label">${escapeHtml(label)}</span>
                    <span class="rec-manto__sub-val">${escapeHtml(val)}</span>
                  </span>`;
                }).join('')}
              </div>
            </div>
          </div>`;
        }

        // INSTALACIONES, OBSERVACIONES, ENCOMIENDA — texto directo
        if (cat === 'ENCOMIENDA' && detail === 'No') return ''; // No mostrar si es No

        return `<div class="rec-manto__item">
          <span class="rec-manto__icon">${icon}</span>
          <div class="rec-manto__body">
            <span class="rec-manto__cat">${cap(cat)}</span>
            <span class="rec-manto__text">${escapeHtml(detail)}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // Compras / Tecnica: chips inline
  const items = String(recurso).split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  return `<div class="rec-chips">
    ${items.map(item => `<span class="rec-chip">${escapeHtml(item)}</span>`).join('')}
  </div>`;
}

// helper: capitaliza primera letra
function cap(str) {
  return str.charAt(0) + str.slice(1).toLowerCase();
}

function removeDiagramaOnReset() {
  if (_diagramaFile) removeDiagrama({ stopPropagation: () => {} });
}

/**
 * Sube el diagrama en background después de registrar la solicitud.
 * No bloquea el flujo principal — si falla, loguea silenciosamente.
 */
async function subirDiagramaBackground(reqId, file) {
  try {
    const base64 = await getDiagramaBase64();
    if (!base64) return;

    const ext  = file.name.split('.').pop().toLowerCase();
    const mime = file.type || 'image/png';

    // Verificar que el base64 no sea demasiado grande para JSONP (~6000 chars)
    // Para archivos grandes mostramos aviso pero no bloqueamos
    if (base64.length > 500000) {
      UI.toast('⚠️ El diagrama es muy grande para enviarse. Adjuntalo manualmente.', 'error');
      return;
    }

    const res = await API.subirDiagrama(reqId, base64, mime, ext);
    if (res.success) {
      UI.toast('🗺️ Diagrama guardado en la solicitud.');
    }
  } catch (e) {
    // Silencioso — la solicitud ya quedó registrada
    console.warn('Error subiendo diagrama:', e.message);
  }
}

// ──────────────────────────────────────────────────────
// TÉCNICA — Recolectar equipamiento numérico
// ──────────────────────────────────────────────────────
const TECNICA_EQUIPOS = [
  { id: 'tec_microfono',   label: 'Micrófono'    },
  { id: 'tec_computadora', label: 'Computadora'  },
  { id: 'tec_tablet',      label: 'Tablet'       },
  { id: 'tec_proyector',   label: 'Proyector'    },
  { id: 'tec_pantalla',    label: 'Pantalla/TV'  },
  { id: 'tec_parlante',    label: 'Parlante'     },
];

function recolectarTecnica() {
  const lineas = [];

  TECNICA_EQUIPOS.forEach(({ id, label }) => {
    const val = parseInt(document.getElementById(id)?.value || '0', 10);
    if (val > 0) lineas.push(`${label}: ${val}`);
  });

  const obs = document.getElementById('tec_observaciones')?.value.trim() || '';
  if (obs) lineas.push(`Observaciones: ${obs}`);

  return lineas.length ? lineas : null;
}

function resetTecnica() {
  TECNICA_EQUIPOS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) el.value = '0';
  });
  const obs = document.getElementById('tec_observaciones');
  if (obs) obs.value = '';
}

// Botones +/− del contador
function counterChange(id, delta) {
  const input = document.getElementById(id);
  if (!input) return;
  const newVal = Math.max(0, Math.min(99, parseInt(input.value || '0', 10) + delta));
  input.value = newVal;
  // Actualizar borde de la card si tiene valor
  const card = input.closest('.tecnica-item');
  if (card) card.style.borderColor = newVal > 0 ? 'var(--blue-main)' : '';
}

function clampCounter(input) {
  const val = parseInt(input.value || '0', 10);
  input.value = isNaN(val) ? 0 : Math.max(0, Math.min(99, val));
}

// ──────────────────────────────────────────────────────
// DIAGRAMA — Subida de imagen del evento
// ──────────────────────────────────────────────────────
let _diagramaFile = null; // File object guardado globalmente

function handleDiagramaFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  procesarDiagramaFile(file);
}

function procesarDiagramaFile(file) {
  // Validar tamaño (5 MB)
  if (file.size > 5 * 1024 * 1024) {
    UI.toast('El archivo supera los 5 MB. Elegí uno más pequeño.', 'error');
    return;
  }

  _diagramaFile = file;

  const dropzone   = document.getElementById('diagrama-dropzone');
  const placeholder = document.getElementById('diagrama-placeholder');
  const preview    = document.getElementById('diagrama-preview');
  const img        = document.getElementById('diagrama-img');
  const filename   = document.getElementById('diagrama-filename');

  if (filename) filename.textContent = file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)';

  // Preview solo para imágenes
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => { if (img) img.src = e.target.result; };
    reader.readAsDataURL(file);
    if (img) img.style.display = 'block';
  } else {
    if (img) img.style.display = 'none'; // PDF — no preview
  }

  if (placeholder) placeholder.style.display = 'none';
  if (preview)     preview.style.display = 'block';
  if (dropzone)    dropzone.classList.add('has-file');
}

function removeDiagrama(event) {
  event.stopPropagation();
  _diagramaFile = null;
  document.getElementById('diagrama-file').value = '';
  document.getElementById('diagrama-placeholder').style.display = 'block';
  document.getElementById('diagrama-preview').style.display    = 'none';
  document.getElementById('diagrama-dropzone').classList.remove('has-file');
  const img = document.getElementById('diagrama-img');
  if (img) img.src = '';
}

function dragOver(event) {
  event.preventDefault();
  document.getElementById('diagrama-dropzone')?.classList.add('drag-over');
}

function dragLeave(event) {
  document.getElementById('diagrama-dropzone')?.classList.remove('drag-over');
}

function dragDrop(event) {
  event.preventDefault();
  document.getElementById('diagrama-dropzone')?.classList.remove('drag-over');
  const file = event.dataTransfer?.files?.[0];
  if (file) procesarDiagramaFile(file);
}

/**
 * Convierte el archivo a base64 para enviarlo al backend via JSONP.
 * Limitación de JSONP: la URL tiene límite de ~8000 chars.
 * Para archivos grandes usamos chunks, pero para esta app
 * limitamos a 5MB y comprimimos la imagen antes de enviar.
 */
async function getDiagramaBase64() {
  if (!_diagramaFile) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result.split(',')[1]); // quitar "data:...;base64,"
    reader.onerror = () => reject(new Error('Error al leer el archivo'));
    reader.readAsDataURL(_diagramaFile);
  });
}

// ──────────────────────────────────────────────────────
// BOOTSTRAP
// ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());