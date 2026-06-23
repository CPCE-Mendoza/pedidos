/**
 * app.js — Lógica de la aplicación (COMPLETO & VERIFICADO)
 * - Gestión de sesión
 * - SPA con ruteador
 * - Multi-select dinámico
 * - Admin panel
 */

// ──────────────────────────────────────────────────────
// SESSION — Gestión de sesión en localStorage
// ──────────────────────────────────────────────────────
const Session = (() => {
  const KEY = 'sol_sess';
  const save = (data) => {
    const exp = Date.now() + CONFIG.SESSION_HOURS * 3600 * 1000;
    localStorage.setItem(KEY, JSON.stringify({ ...data, exp }));
  };
  const get = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (Date.now() > s.exp) { clear(); return null; }
      return s;
    } catch { return null; }
  };
  const clear = () => localStorage.removeItem(KEY);
  return { 
    save, get, clear, 
    getToken: () => get()?.token, 
    getRole: () => get()?.rol, 
    getEmail: () => get()?.email,
    isAdmin: () => get()?.rol === 'admin' 
  };
})();

// ──────────────────────────────────────────────────────
// UI — Utilidades de interfaz
// ──────────────────────────────────────────────────────
const UI = {
  show(id) { 
    const el = document.getElementById(id); 
    if(el) el.classList.remove('hidden'); 
  },
  hide(id) { 
    const el = document.getElementById(id); 
    if(el) el.classList.add('hidden'); 
  },
  toast(msg, type = 'success') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `toast toast--${type}`;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3500);
  },
loading(id, isLoading, text = 'Procesando...') {
    const btn = document.getElementById(id);
    if (!btn) return;
    
    // Guardamos el texto original solo la primera vez
    if (isLoading && !btn.dataset.original) {
      btn.dataset.original = btn.textContent; 
    }
    
    btn.disabled = isLoading;
    btn.textContent = isLoading ? text : (btn.dataset.original || btn.textContent);
  },
  statusBadge(estado) {
    const colors = { 
      Pendiente: '#d4850a', 
      'En proceso': '#1a5fa8', 
      Completado: '#1d8a4e', 
      Rechazado: '#c0392b' 
    };
    return `<span style="display:inline-block; padding:4px 8px; border-radius:4px; font-size:12px; font-weight:600; background:${colors[estado]}20; color:${colors[estado]}">${estado}</span>`;
  }
};

// ──────────────────────────────────────────────────────
// FORMCONFIG — Cache de configuración del formulario
// ──────────────────────────────────────────────────────
let FormConfigCache = null;
let FormConfigLoaded = false;

async function loadFormConfig() {
  if (FormConfigLoaded) return FormConfigCache;
  try {
    const res = await API.getFormConfig();
    if (res.success) {
      FormConfigCache = res.data;
      FormConfigLoaded = true;
      renderCheckboxes();
    }
  } catch (err) {
    UI.toast('No se pudo cargar la configuración.', 'error');
  }
}

function renderCheckboxes() {
  if (!FormConfigCache) return;
  ['Compras', 'Mantenimiento', 'Tecnica'].forEach(area => {
    const container = document.getElementById('area-' + area);
    if (!container) return;
    const opciones = FormConfigCache[area] || [];
    if (opciones.length === 0) {
      container.innerHTML = '<p style="color: var(--text-subtle); font-size: 13px; padding: 4px;">Sin opciones configuradas</p>';
    } else {
      container.innerHTML = opciones.map((op, i) => `
        <div class="checkbox-item">
          <input type="checkbox" id="cb-${area}-${i}" name="${area}" value="${op}">
          <label for="cb-${area}-${i}">${op}</label>
        </div>
      `).join('');
    }
  });
}

// ──────────────────────────────────────────────────────
// APP — Manejador principal de la aplicación
// ──────────────────────────────────────────────────────
const App = {
  async init() {
    const session = Session.get();
    if (session) {
      this.applySession(session);
      this.showView('form');
      await loadFormConfig();
    } else {
      this.showView('login');
    }
    bindEvents();
  },

  applySession(session) {
    // Mostrar nav
    const nav = document.getElementById('app-nav');
    if (nav) nav.style.display = 'flex';
    
    // Mostrar email del usuario
    const userEl = document.getElementById('user-email-short');
    if (userEl) userEl.textContent = session.email.split('@')[0];
    
    // Mostrar botón admin si aplica
    const adminBtn = document.getElementById('nav-admin');
    if (adminBtn) adminBtn.style.display = session.rol === 'admin' ? 'flex' : 'none';
  },

  showView(name) {
    const views = ['login', 'form', 'my-requests', 'admin'];
    views.forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== name);
    });
    
    // Acciones al mostrar vistas
    if (name === 'my-requests') loadMyRequests();
    if (name === 'admin') loadAdminPanel();
  }
};

// ──────────────────────────────────────────────────────
// EVENT BINDING — Conectar eventos del DOM
// ──────────────────────────────────────────────────────
function bindEvents() {
  // Login
  const formLogin = document.getElementById('form-login');
  if (formLogin) {
    formLogin.addEventListener('submit', handleLogin);
  }

  // Logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      Session.clear();
      FormConfigLoaded = false;
      FormConfigCache = null;
      App.showView('login');
      const nav = document.getElementById('app-nav');
      if (nav) nav.style.display = 'none';
      UI.toast('Sesión cerrada');
    });
  }

  // Submit solicitud
  const formRequest = document.getElementById('form-request');
  if (formRequest) {
    formRequest.addEventListener('submit', handleSubmitRequest);
  }
}

// ──────────────────────────────────────────────────────
// LOGIN — Autenticación
// ──────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-login');
  const originalText = btn.textContent;
  UI.loading('btn-login', true, 'Accediendo...');
  UI.hide('login-error');

  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;

  try {
    const res = await API.login(email, pass);
    if (!res.success) throw new Error(res.message);
    
    Session.save(res);
    App.applySession(res);
    await loadFormConfig();
    App.showView('form');
    
    // Reset formulario
    document.getElementById('form-login').reset();
    UI.toast('¡Bienvenido ' + email + '!');
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
    UI.show('login-error');
  } finally {
    UI.loading('btn-login', false, originalText);
  }
}

// ──────────────────────────────────────────────────────
// SUBMIT SOLICITUD — Crear solicitud multi-área
// ──────────────────────────────────────────────────────
async function handleSubmitRequest(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit');
  const originalText = btn.textContent;
  UI.loading('btn-submit', true, 'Enviando...');
  UI.hide('form-error');

  const evento = document.getElementById('evento').value.trim();
  const justificacion = document.getElementById('justificacion').value.trim();

  // Recolectar selecciones de checkboxes
  const requerimientos = {};
  ['Compras', 'Mantenimiento', 'Tecnica'].forEach(area => {
    const checkboxes = document.querySelectorAll(`input[name="${area}"]:checked`);
    const seleccionados = Array.from(checkboxes).map(cb => cb.value);
    if (seleccionados.length > 0) {
      requerimientos[area] = seleccionados;
    }
  });

  try {
    if (!evento) throw new Error('Ingresá el nombre del evento.');
    if (!justificacion) throw new Error('Ingresá los detalles del evento.');
    if (Object.keys(requerimientos).length === 0) throw new Error('Seleccioná al menos un recurso.');

    const res = await API.submitMultiRequest({ evento, justificacion, requerimientos });
    if (!res.success) throw new Error(res.message);
    
    UI.toast(res.message);
    document.getElementById('form-request').reset();
    
  } catch (err) {
    document.getElementById('form-error').textContent = err.message;
    UI.show('form-error');
  } finally {
    UI.loading('btn-submit', false, originalText);
  }
}

// ──────────────────────────────────────────────────────
// MIS SOLICITUDES — Ver solicitudes del usuario
// ──────────────────────────────────────────────────────
async function loadMyRequests() {
  const list = document.getElementById('my-requests-list');
  list.innerHTML = '<p style="color: var(--text-subtle); text-align: center;">Cargando...</p>';
  
  try {
    const res = await API.getMyRequests();
    if (!res.success) throw new Error(res.message);
    
    if (res.data.length === 0) {
      list.innerHTML = '<p style="color: var(--text-subtle); text-align: center; padding: 20px;">No tienes solicitudes aún.</p>';
    } else {
      list.innerHTML = res.data.map(r => `
        <div style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px; background: var(--surface);">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
            <div>
              <div style="font-size: 12px; color: var(--text-muted); font-family: monospace;">ID: ${r.id}</div>
              <div style="font-weight: 600; color: var(--text-dark);">${r.recurso}</div>
              <div style="font-size: 13px; color: var(--text-muted);">${r.area}</div>
            </div>
            ${UI.statusBadge(r.estado)}
          </div>
          <div style="font-size: 14px; color: var(--text-mid); margin-bottom: 4px;">${r.justificacion.substring(0, 80)}...</div>
          ${r.notas ? `<div style="font-size: 12px; color: #c8972a; padding: 6px; background: var(--gold-light); border-radius: 4px;">📝 ${r.notas}</div>` : ''}
        </div>
      `).join('');
    }
  } catch (err) {
    list.innerHTML = `<p style="color: var(--error);">${err.message}</p>`;
  }
}

// ──────────────────────────────────────────────────────
// PANEL ADMIN — Gestión de solicitudes
// ──────────────────────────────────────────────────────
let adminDataCache = [];

async function loadAdminPanel() {
  if (!Session.isAdmin()) { 
    App.showView('form'); 
    return; 
  }
  
  const session = Session.get();
  document.getElementById('admin-area-name').textContent = 'Área: ' + (session.areaAdmin || '—');
  const list = document.getElementById('admin-requests-list');
  list.innerHTML = '<p style="color: var(--text-subtle); text-align: center;">Cargando...</p>';

  try {
    const res = await API.getAllRequests();
    if (!res.success) throw new Error(res.message);
    
    adminDataCache = res.data;
    renderAdminRequests(adminDataCache);
    await loadAdminConfig();
  } catch (err) {
    list.innerHTML = `<p style="color: var(--error);">${err.message}</p>`;
  }
}

function renderAdminRequests(items) {
  const list = document.getElementById('admin-requests-list');
  
  if (items.length === 0) {
    list.innerHTML = '<p style="color: var(--text-subtle); text-align: center; padding: 20px;">Sin solicitudes en tu área.</p>';
    return;
  }
  
  list.innerHTML = items.map(r => `
    <div style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px; background: var(--surface);" id="row-${r.id}">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
        <div>
          <div style="font-size: 12px; color: var(--text-muted); font-family: monospace;">ID: ${r.id}</div>
          <div style="font-weight: 600; color: var(--text-dark);">${r.recurso}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${r.solicitante}</div>
        </div>
        ${UI.statusBadge(r.estado)}
      </div>
      <div style="font-size: 13px; color: var(--text-mid); margin-bottom: 8px;">${r.justificacion.substring(0, 100)}...</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
        <select style="padding: 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px;" class="status-select">
          <option ${r.estado === 'Pendiente' ? 'selected' : ''}>Pendiente</option>
          <option ${r.estado === 'En proceso' ? 'selected' : ''}>En proceso</option>
          <option ${r.estado === 'Completado' ? 'selected' : ''}>Completado</option>
          <option ${r.estado === 'Rechazado' ? 'selected' : ''}>Rechazado</option>
        </select>
        <input type="text" placeholder="Notas..." style="padding: 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px;" class="notes-input" value="${r.notas || ''}">
        <button onclick="submitStatusUpdate('${r.id}', '${r.area}', this)" class="btn btn--primary" style="padding: 6px; font-size: 12px;">
          ✓ Actualizar
        </button>
      </div>
    </div>
  `).join('');
}

async function submitStatusUpdate(id, area, btn) {
  const row = btn.closest('[id^="row-"]');
  const estado = row.querySelector('.status-select').value;
  const notas = row.querySelector('.notes-input').value.trim();
  
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await API.updateStatus(area, id, estado, notas);
    if (!res.success) throw new Error(res.message);
    
    UI.toast('Actualizado y notificado al solicitante.');
    await loadAdminPanel();
  } catch (err) {
    UI.toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = '✓ Actualizar';
  }
}

function filterAdminRequests() {
  const q = document.getElementById('admin-search').value.toLowerCase();
  const estado = document.getElementById('admin-filter-status').value;
  
  const filtered = adminDataCache.filter(r => {
    const matchQ = !q || 
      r.solicitante.toLowerCase().includes(q) || 
      r.recurso.toLowerCase().includes(q) || 
      r.id.toLowerCase().includes(q);
    const matchE = !estado || r.estado === estado;
    return matchQ && matchE;
  });
  
  renderAdminRequests(filtered);
}

async function loadAdminConfig() {
  const session = Session.get();
  if (!session.areaAdmin || !FormConfigCache) return;
  
  const opciones = FormConfigCache[session.areaAdmin] || [];
  document.getElementById('config-opciones').value = opciones.join('\n');
}

async function saveAdminConfig() {
  const session = Session.get();
  const raw = document.getElementById('config-opciones').value;
  const opciones = raw.split('\n').map(s => s.trim()).filter(Boolean);
  
  const btn = document.getElementById('btn-save-config');
  const originalText = btn.textContent;
  UI.loading('btn-save-config', true, 'Guardando...');

  try {
    const res = await API.updateFormConfig(session.areaAdmin, opciones);
    if (!res.success) throw new Error(res.message);
    
    FormConfigCache[session.areaAdmin] = opciones;
    UI.toast(res.message);
  } catch (err) {
    UI.toast(err.message, 'error');
  } finally {
    UI.loading('btn-save-config', false, originalText);
  }
}

function switchAdminTab(tab) {
  const tabs = ['tab-solicitudes', 'tab-config'];
  tabs.forEach(t => {
    const el = document.getElementById(t);
    if (el) el.classList.toggle('hidden', t !== tab);
    
    const btn = document.getElementById('tab-btn-' + t.replace('tab-', ''));
    if (btn) {
      btn.style.color = t === tab ? 'var(--blue-main)' : 'var(--text-muted)';
      btn.style.borderBottomColor = t === tab ? 'var(--blue-main)' : 'transparent';
    }
  });
}

// ──────────────────────────────────────────────────────
// BOOTSTRAP — Inicialización
// ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());