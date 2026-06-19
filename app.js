// ─────────────────────────────────────────────────────────────
//  app.js — Lógica de la SPA (Single Page Application)
//  Gestiona vistas, sesión y eventos del DOM.
// ─────────────────────────────────────────────────────────────

// ── Gestión de Sesión ──────────────────────────────────────
const Session = (() => {
  const KEY = 'sol_session';

  function save(data) {
    const expires = Date.now() + CONFIG.SESSION_HOURS * 3600 * 1000;
    localStorage.setItem(KEY, JSON.stringify({ ...data, expires }));
  }

  function get() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() > data.expires) { clear(); return null; }
      return data;
    } catch { return null; }
  }

  function getToken()  { return get()?.token || null; }
  function getRole()   { return get()?.rol   || null; }
  function getEmail()  { return get()?.email || null; }
  function getArea()   { return get()?.areaAdmin || null; }
  function clear()     { localStorage.removeItem(KEY); }
  function isAdmin()   { return getRole() === 'admin'; }

  return { save, get, getToken, getRole, getEmail, getArea, clear, isAdmin };
})();


// ── Utilidades UI ──────────────────────────────────────────
const UI = {
  show(id)   { document.getElementById(id)?.classList.remove('hidden'); },
  hide(id)   { document.getElementById(id)?.classList.add('hidden'); },
  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },
  setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  },

  toast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `fixed bottom-6 right-6 px-5 py-3 rounded-lg shadow-lg text-sm font-medium z-50 transition-opacity duration-300
      ${type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`;
    t.classList.remove('opacity-0');
    setTimeout(() => t.classList.add('opacity-0'), 3500);
  },

  loading(btnId, isLoading, originalText) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = isLoading;
    btn.innerHTML = isLoading
      ? `<svg class="animate-spin h-4 w-4 mr-2 inline" viewBox="0 0 24 24" fill="none">
           <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
           <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
         </svg>Procesando...`
      : originalText;
  },

  statusBadge(estado) {
    const cls = CONFIG.STATUS_COLORS[estado] || 'bg-gray-100 text-gray-700';
    return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}">${estado}</span>`;
  },

  formatDate(val) {
    if (!val) return '—';
    const d = new Date(val);
    return isNaN(d) ? val : d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  }
};


// ── Router de Vistas ───────────────────────────────────────
const App = {
  views: ['view-login', 'view-form', 'view-my-requests', 'view-admin'],

  showView(name) {
    this.views.forEach(v => UI.hide(v));
    UI.show('view-' + name);
    // Actualizar nav activo
    document.querySelectorAll('[data-view]').forEach(el => {
      el.classList.toggle('nav-active', el.dataset.view === name);
    });
  },

  async init() {
    // Restaurar sesión si existe
    const session = Session.get();
    if (session) {
      this.applySession(session);
      this.showView('form');
    } else {
      this.showView('login');
    }

    // Bind eventos globales
    bindEvents();
  },

  applySession(session) {
    UI.setText('user-email', session.email);
    // Mostrar nav items según rol
    document.getElementById('nav-admin')?.classList.toggle('hidden', session.rol !== 'admin');
    document.getElementById('nav-my-requests')?.classList.toggle('hidden', session.rol === 'admin');
  },
};


// ── Manejadores de Eventos ──────────────────────────────────
function bindEvents() {
  // Login
  document.getElementById('form-login')?.addEventListener('submit', handleLogin);

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    Session.clear();
    App.showView('login');
  });

  // Navegación
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const view = el.dataset.view;
      App.showView(view);
      if (view === 'form')        loadForm();
      if (view === 'my-requests') loadMyRequests();
      if (view === 'admin')       loadAdminPanel();
    });
  });

  // Select de área en formulario
  document.getElementById('area')?.addEventListener('change', updateRecursoSelect);

  // Submit solicitud
  document.getElementById('form-request')?.addEventListener('submit', handleSubmitRequest);
}


// ── Login ──────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  UI.loading('btn-login', true, 'Iniciar Sesión');
  UI.hide('login-error');

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await API.login(email, password);
    if (!res.success) throw new Error(res.message);

    Session.save(res);
    App.applySession(res);
    await loadForm();
    App.showView('form');
    UI.toast('Bienvenido, ' + res.email);
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
    UI.show('login-error');
  } finally {
    UI.loading('btn-login', false, 'Iniciar Sesión');
  }
}


// Función helper para el HTML
window.toggleArea = function(areaId) {
  const isChecked = document.getElementById(`chk-${areaId}`).checked;
  document.getElementById(`div-${areaId}`).classList.toggle('hidden', !isChecked);
};

// ── Formulario de Solicitud ────────────────────────────────
let formConfigCache = null;

async function loadForm() {
  try {
    const res = await API.getFormConfig();
    if (res.success) {
      formConfigCache = res.data;
      // Cargar opciones en todos los selects
      ['Compras', 'Mantenimiento', 'IT'].forEach(area => {
        const sel = document.getElementById(`sel-${area.toLowerCase()}`);
        if(sel) {
          sel.innerHTML = '<option value="">-- Opciones precargadas (Opcional) --</option>';
          (formConfigCache[area] || []).forEach(op => {
            const opt = document.createElement('option');
            opt.value = op; opt.textContent = op;
            sel.appendChild(opt);
          });
        }
      });
    }
  } catch (err) {
    UI.toast('No se pudo cargar la configuración.', 'error');
  }
}

async function handleSubmitRequest(e) {
  e.preventDefault();
  
  const evento = document.getElementById('evento-nombre').value.trim();
  const justif = document.getElementById('justificacion').value.trim();
  
  if (!evento || !justif) return UI.toast('Completa el nombre y la justificación general.', 'error');

  const requerimientos = {};
  let areasChecked = 0;

  ['Compras', 'Mantenimiento', 'IT'].forEach(area => {
    const idBase = area.toLowerCase();
    if (document.getElementById(`chk-${idBase}`).checked) {
      areasChecked++;
      const selectVal = document.getElementById(`sel-${idBase}`).value;
      const textVal = document.getElementById(`det-${idBase}`).value.trim();
      
      let detalleFinal = [];
      if (selectVal) detalleFinal.push(`[${selectVal}]`);
      if (textVal) detalleFinal.push(textVal);
      
      requerimientos[area] = detalleFinal.join(' - ');
    }
  });

  if (areasChecked === 0) return UI.toast('Debes seleccionar al menos un área (Compras, Mantenimiento o IT).', 'error');

  UI.loading('btn-submit', true, 'Enviando Solicitud...');
  
  try {
    const payload = { evento, justificacion: justif, requerimientos };
    const res = await API.submitMultiRequest(payload);
    
    if (!res.success) throw new Error(res.message);
    
    UI.toast(res.message);
    e.target.reset();
    ['compras','mantenimiento','it'].forEach(a => {
      document.getElementById(`div-${a}`).classList.add('hidden');
    });
  } catch (err) {
    UI.toast(err.message, 'error');
  } finally {
    UI.loading('btn-submit', false, 'Enviar Solicitud Múltiple');
  }
}

// ── Mis Solicitudes (usuario) ──────────────────────────────
async function loadMyRequests() {
  UI.setHTML('my-requests-list', '<p class="text-slate-400 text-sm">Cargando...</p>');
  try {
    const res = await API.getMyRequests();
    if (!res.success) throw new Error(res.message);
    renderMyRequests(res.data);
  } catch (err) {
    UI.setHTML('my-requests-list', `<p class="text-red-500 text-sm">${err.message}</p>`);
  }
}

function renderMyRequests(items) {
  if (!items.length) {
    UI.setHTML('my-requests-list', '<p class="text-slate-400 text-sm italic">No tienes solicitudes registradas.</p>');
    return;
  }

  // AGRUPAMOS por ID para que un evento con 3 áreas se vea en una sola Card
  const grouped = {};
  items.forEach(r => {
    if (!grouped[r.id]) {
      // Extraemos el nombre del evento de la justificación
      const partesJustif = r.justificacion.split('\nDetalles: ');
      const eventoNombre = partesJustif[0].replace('Evento: ', '') || r.id;
      const justifTexto = partesJustif[1] || r.justificacion;

      grouped[r.id] = { id: r.id, fecha: r.fecha, evento: eventoNombre, justificacion: justifTexto, tareas: [] };
    }
    grouped[r.id].tareas.push(r);
  });

  // Renderizamos las tarjetas agrupadas
  const html = Object.values(grouped).map(g => `
    <div class="border border-slate-200 rounded-2xl p-5 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-base font-bold text-slate-800">${g.evento}</h3>
        <span class="text-xs font-mono text-indigo-500 bg-indigo-50 px-2 py-1 rounded-md">${g.id}</span>
      </div>
      <p class="text-sm text-slate-500 mb-4 line-clamp-2">${g.justificacion}</p>
      
      <div class="space-y-2 border-t border-slate-100 pt-3">
        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Estado por Área</p>
        ${g.tareas.map(t => `
          <div class="bg-slate-50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-slate-100">
            <div>
              <span class="text-xs font-bold text-slate-700 block">${t.area}</span>
              <span class="text-xs text-slate-600 block mt-0.5">${t.recurso}</span>
              ${t.notas ? `<p class="text-[11px] text-amber-700 mt-1.5 bg-amber-50 rounded flex inline-flex items-center px-1.5 py-0.5">💬 Admin: ${t.notas}</p>` : ''}
            </div>
            <div class="self-start sm:self-auto shrink-0">${UI.statusBadge(t.estado)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  UI.setHTML('my-requests-list', html);
}


// ── Panel de Administración ────────────────────────────────
let adminRequestsCache = [];

async function loadAdminPanel() {
  if (!Session.isAdmin()) { App.showView('form'); return; }

  UI.setText('admin-area-title', 'Área: ' + (Session.getArea() || ''));
  UI.setHTML('admin-requests-list', '<p class="text-slate-400 text-sm">Cargando solicitudes...</p>');

  try {
    const res = await API.getAllRequests();
    if (!res.success) throw new Error(res.message);
    adminRequestsCache = res.data;
    renderAdminRequests(adminRequestsCache);
    loadAdminConfig();
  } catch (err) {
    UI.setHTML('admin-requests-list', `<p class="text-red-500 text-sm">${err.message}</p>`);
  }
}

function renderAdminRequests(items) {
  if (!items.length) {
    UI.setHTML('admin-requests-list', '<p class="text-slate-400 text-sm italic">No hay solicitudes en tu área.</p>');
    return;
  }

  const html = items.map(r => `
    <div class="border border-slate-200 rounded-xl p-4" id="row-${r.id}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div>
          <p class="text-xs font-mono text-slate-400">${r.id}</p>
          <p class="font-semibold text-slate-800">${r.recurso}</p>
          <p class="text-xs text-slate-500">${r.solicitante} · ${UI.formatDate(r.fecha)}</p>
        </div>
        ${UI.statusBadge(r.estado)}
      </div>
      <p class="text-sm text-slate-600 mb-3">${r.justificacion}</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
        <select onchange="" class="status-select col-span-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-indigo-500 focus:border-indigo-500">
          ${['Pendiente','En proceso','Completado','Rechazado'].map(s =>
            `<option ${s === r.estado ? 'selected' : ''}>${s}</option>`
          ).join('')}
        </select>
        <input type="text" placeholder="Notas para el solicitante..." value="${r.notas || ''}"
          class="notes-input col-span-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-indigo-500 focus:border-indigo-500">
        <button onclick="submitStatusUpdate('${r.id}', '${r.area}', this)"
          class="col-span-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-1.5 px-3 rounded-lg transition-colors">
          Actualizar
        </button>
      </div>
    </div>
  `).join('');

  UI.setHTML('admin-requests-list', html);
}

async function submitStatusUpdate(id, area, btn) {
  const row    = btn.closest('[id^="row-"]');
  const estado = row.querySelector('.status-select').value;
  const notas  = row.querySelector('.notes-input').value.trim();

  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await API.updateStatus(area, id, estado, notas);
    if (!res.success) throw new Error(res.message);
    UI.toast('Estado actualizado. Solicitante notificado.');
    loadAdminPanel(); // Refrescar
  } catch (err) {
    UI.toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Actualizar';
  }
}


// ── Config del Formulario (Admin) ──────────────────────────
async function loadAdminConfig() {
  const area = Session.getArea();
  if (!area || !formConfigCache) return;

  const opciones = formConfigCache[area] || [];
  document.getElementById('config-area-name').textContent = area;
  document.getElementById('config-opciones').value = opciones.join('\n');
}

async function saveAdminConfig() {
  const area    = Session.getArea();
  const rawText = document.getElementById('config-opciones').value;
  const opciones = rawText.split('\n').map(s => s.trim()).filter(Boolean);

  UI.loading('btn-save-config', true, 'Guardar Opciones');
  try {
    const res = await API.updateFormConfig(area, opciones);
    if (!res.success) throw new Error(res.message);
    formConfigCache[area] = opciones;
    UI.toast('Opciones del formulario actualizadas.');
  } catch (err) {
    UI.toast(err.message, 'error');
  } finally {
    UI.loading('btn-save-config', false, 'Guardar Opciones');
  }
}

// Filtro de solicitudes en panel admin
function filterAdminRequests() {
  const q      = document.getElementById('admin-search').value.toLowerCase();
  const estado = document.getElementById('admin-filter-status').value;

  const filtered = adminRequestsCache.filter(r => {
    const matchQ = !q || r.solicitante.toLowerCase().includes(q) || r.recurso.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
    const matchE = !estado || r.estado === estado;
    return matchQ && matchE;
  });

  renderAdminRequests(filtered);
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => App.init());