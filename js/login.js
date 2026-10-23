// Login + apertura de caja (Cervecería POS)
// Paleta "Midnight & Amber": fondo #12100E, tarjetas #1C1815, acento #E0A96D
//
// La pantalla de login y la apertura de caja se construyen con clases CSS
// definidas en css/styles.css (sección "LOGIN / APERTURA DE CAJA"). El marcado
// usa exclusivamente clases y nunca estilos inline, de modo que el logotipo,
// el formulario de fondo inicial y los botones de acceso tienen siempre el
// mismo tamaño y permanecen visibles en cualquier pantalla.

// ---------------------------------------------------------------------------
// CashSession: autoridad única sobre el turno/caja activo.
// Es la única fuente de verdad que consultan login.js, app.js y pos.js para
// saber si existe una caja abierta. Si no la hay, el POS queda bloqueado.
// ---------------------------------------------------------------------------
const CashSession = {
  KEYS: {
    POS: 'pos_session',
    DB: 'cerveceria_session',
    CAJA: 'cerveceria_caja'
  },

  // Sesión cruda persistida: se toma la primera clave válida que exista
  readRaw() {
    const keys = [this.KEYS.POS, this.KEYS.DB];
    for (let i = 0; i < keys.length; i++) {
      try {
        const raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (e) {
        console.error('[CashSession] No se pudo leer "' + keys[i] + '":', e);
      }
    }
    return null;
  },

  // Fondo inicial registrado en la sesión (null cuando no hay caja abierta)
  getOpeningAmount(session) {
    if (!session) return null;
    const candidates = [session.cashOpening, session.cashInitial, session.montoApertura, session.montoInicial];
    for (let i = 0; i < candidates.length; i++) {
      const value = candidates[i];
      if (value === undefined || value === null || value === '') continue;
      const amount = Number(value);
      if (Number.isFinite(amount) && amount >= 0) return amount;
    }
    return null;
  },

  // Una sesión es válida cuando tiene rol, responsable y fondo de apertura
  isValid(session) {
    if (!session || typeof session !== 'object') return false;
    if (!String(session.role || session.rol || '').trim()) return false;
    if (!String(session.name || session.usuario || '').trim()) return false;
    if (this.getOpeningAmount(session) === null) return false;
    if (!session.openedAt && !session.timestamp && !session.fechaApertura) return false;
    return true;
  },

  // Caja marcada explícitamente como cerrada
  isRegisterClosed() {
    try {
      const raw = localStorage.getItem(this.KEYS.CAJA);
      if (!raw) return false;
      const caja = JSON.parse(raw);
      return !!(caja && caja.abierta === false);
    } catch (e) {
      console.error('[CashSession] No se pudo leer el estado de la caja:', e);
      return false;
    }
  },

  // Sesión del turno activo o null si no hay caja abierta
  getActiveSession() {
    try {
      const session = this.readRaw();
      if (!this.isValid(session)) return null;
      if (this.isRegisterClosed()) return null;
      return session;
    } catch (error) {
      console.error('[CashSession] Error al obtener la sesión activa:', error);
      return null;
    }
  },

  // Persiste la apertura de caja en todas las claves de almacenamiento
  save(session) {
    const amount = this.getOpeningAmount(session);
    try {
      localStorage.setItem(this.KEYS.POS, JSON.stringify(session));
      localStorage.setItem(this.KEYS.DB, JSON.stringify(session));
      localStorage.setItem(this.KEYS.CAJA, JSON.stringify({
        abierta: true,
        fondoInicial: amount === null ? 0 : amount,
        fechaApertura: session.openedAt || new Date().toISOString(),
        turnoNumero: session.turnoNumero || null,
        turno: session.turno || null,
        turnoId: session.turnoId || null,
        usuario: session.name || session.usuario || 'Cajero'
      }));
      return session;
    } catch (error) {
      console.error('[CashSession] Error al guardar la sesión:', error);
      return null;
    }
  },

  // Elimina la sesión del turno activo (corte de caja / cierre de turno)
  clear() {
    [this.KEYS.POS, this.KEYS.DB, this.KEYS.CAJA].forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.error('[CashSession] No se pudo eliminar "' + key + '":', e);
      }
    });
  }
};

const Login = {
  pin: '',
  selectedRole: null,

  init(containerId) {
    this.container = document.getElementById(containerId || 'app-main');
    this.hideAppChrome();
    this.renderGlassyLogin();
  },

  // Oculta navegación y acciones de cabecera: sin caja abierta no hay acceso
  hideAppChrome() {
    const tabBar = document.getElementById('tab-bar');
    if (tabBar) {
      tabBar.style.display = 'none';
      tabBar.classList.remove('is-visible');
    }
    const headerActions = document.querySelector('.header-actions');
    if (headerActions) {
      headerActions.style.display = 'none';
      headerActions.classList.remove('is-visible');
    }
    const userArea = document.getElementById('header-user');
    if (userArea) userArea.style.display = 'none';
    const corteBtn = document.getElementById('btn-corte-caja');
    if (corteBtn) corteBtn.style.display = 'none';
  },

  // Tras renderizar el login el área principal vuelve al inicio del scroll:
  // así el contenido centrado nunca queda a medias de la pantalla.
  resetScroll() {
    if (!this.container) return;
    try {
      this.container.scrollTop = 0;
    } catch (e) {
      console.error('[Login] No se pudo reiniciar el scroll:', e);
    }
  },

  // Sesión/caja activa del turno en curso (null si no hay)
  getActiveSession() {
    if (typeof CashSession === 'undefined') return null;
    return CashSession.getActiveSession();
  },

  formatMoney(value) {
    const amount = Number(value);
    const safe = Number.isFinite(amount) ? amount : 0;
    let symbol = '$';
    try {
      const settings = (typeof Database !== 'undefined' && Database.getSettings) ? (Database.getSettings() || {}) : {};
      symbol = settings.currencySymbol || '$';
    } catch (e) {
      symbol = '$';
    }
    return symbol + safe.toFixed(2);
  },

  formatTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  },

  // Número de turno consecutivo (uno por cada apertura de caja registrada)
  getNextTurnoNumero() {
    try {
      const cuts = (typeof Database !== 'undefined' && Database.getCuts) ? (Database.getCuts() || []) : [];
      const aperturas = cuts.filter(c => c && c.tipo === 'apertura').length;
      return aperturas + 1;
    } catch (e) {
      return 1;
    }
  },

  // Pantalla de login glassy (solo Iniciar Sesión)
  renderGlassyLogin() {
    this.container.innerHTML = `
      <div class="glassy-login">
        <div class="glassy-brand">
          <svg class="brand-logo" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><use href="#brand-logo-symbol"></use></svg>
          <h1 class="glassy-brand-title">Cervecería</h1>
          <p class="glassy-brand-subtitle">PUNTO DE VENTA</p>
        </div>
        <div id="signin-content"></div>
      </div>
    `;
    this.resetScroll();
    this.renderSignInPanel();
  },

  // Rellena el panel de Iniciar Sesión (selección de rol)
  renderSignInPanel() {
    const content = this.container.querySelector('#signin-content');
    content.innerHTML = `
      <div class="auth-panel">
        <p class="login-subheading">Selecciona tu rol</p>
        <div class="login-roles">
          <button id="role-admin" class="login-role-btn is-admin">Administrador</button>
          <button id="role-employee" class="login-role-btn is-employee">Empleado</button>
        </div>
        <p class="login-note">
          Para operar el punto de venta es obligatorio registrar la apertura de caja con el fondo inicial del turno.
        </p>
      </div>
    `;
    document.getElementById('role-admin').onclick = () => this.renderPinPad();
    document.getElementById('role-employee').onclick = () => this.renderStaffForm('employee');
  },

  renderPinPad() {
    this.pin = '';
    this.container.innerHTML = `
      <div class="login-screen">
        <h2 class="login-heading">NIP de Administrador</h2>
        <div id="pin-display" class="pin-display">____</div>
        <div class="pin-grid">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<button data-digit="${n}" class="pin-key">${n}</button>`).join('')}
          <button id="pin-clear" class="pin-key is-clear">⌫</button>
          <button data-digit="0" class="pin-key">0</button>
          <button id="pin-ok" class="pin-key is-ok">OK</button>
        </div>
        <button id="pin-back" class="login-back">Volver</button>
      </div>
    `;
    this.resetScroll();
    this.container.querySelectorAll('[data-digit]').forEach(btn => {
      btn.onclick = () => { if (this.pin.length < 4) { this.pin += btn.dataset.digit; this.updatePinDisplay(); } };
    });
    document.getElementById('pin-clear').onclick = () => { this.pin = this.pin.slice(0,-1); this.updatePinDisplay(); };
    document.getElementById('pin-ok').onclick = () => this.submitPin();
    document.getElementById('pin-back').onclick = () => this.renderGlassyLogin();
  },

  updatePinDisplay() {
    document.getElementById('pin-display').textContent = this.pin.padEnd(4,'_').split('').join(' ');
  },

  submitPin() {
    if (this.pin.length !== 4) { alert('Ingresa 4 dígitos.'); return; }
    if (this.pin !== '1234') { alert('NIP incorrecto.'); this.pin=''; this.updatePinDisplay(); return; }
    this.openCash({ role:'admin', name:'Administrador' });
  },

  // Acceso del personal: mismo flujo, distinto rol para el turno
  renderStaffForm(role) {
    const isGuest = role === 'guest';
    const titulo = isGuest ? 'Acceso Invitado' : 'Acceso Empleado';
    const placeholder = isGuest ? 'Nombre del invitado' : 'Nombre del empleado';

    this.container.innerHTML = `
      <div class="login-screen">
        <h2 class="login-heading">${titulo}</h2>
        <form id="emp-form" class="login-form">
          <input name="nombre" class="login-field" placeholder="${placeholder}" autocomplete="off" required />
          <input name="clave" type="password" class="login-field" placeholder="Clave de acceso" autocomplete="off" required />
          <button type="submit" class="login-submit">Entrar</button>
        </form>
        <button id="emp-back" class="login-back">Volver</button>
      </div>
    `;
    this.resetScroll();
    document.getElementById('emp-form').onsubmit = (e) => {
      e.preventDefault();
      const form = e.target;
      const nombre = form.nombre.value.trim();
      const clave = form.clave.value;
      if (!nombre || !clave) { alert('Completa todos los campos.'); return; }
      this.openCash({ role: role, name: nombre });
    };
    document.getElementById('emp-back').onclick = () => this.renderGlassyLogin();
  },

  // Paso final obligatorio: apertura de caja con el fondo inicial del turno
  openCash(user) {
    this.container.innerHTML = `
      <div class="login-screen">
        <div class="cash-card">
          <h2 class="cash-card-title">Apertura de Caja</h2>
          <p class="cash-card-subtitle">Fondo inicial en efectivo</p>
          <input id="cash-amount" class="cash-amount" type="number" step="0.01" min="0" value="0" inputmode="decimal" />
          <button id="cash-confirm" class="cash-confirm">Confirmar</button>
        </div>
      </div>
    `;
    this.resetScroll();
    document.getElementById('cash-confirm').onclick = () => {
      try {
        const input = document.getElementById('cash-amount');
        const amount = parseFloat(input.value);
        if (isNaN(amount) || amount < 0) {
          alert('Monto inválido.');
          return;
        }

        const timestamp = Date.now();
        const openedAt = new Date().toISOString();
        const turnoNumero = this.getNextTurnoNumero();
        const turno = 'T-' + String(turnoNumero).padStart(3, '0');
        const usuario = user.name || 'Cajero';

        // Registro de la apertura del turno (queda como historial en la base de datos)
        let aperturaId = null;
        if (typeof Database !== 'undefined') {
          try {
            const cuts = Database.recordCut({
              tipo: 'apertura',
              corteNumero: turnoNumero,
              turno: turno,
              montoApertura: amount,
              montoInicial: amount,
              usuario: usuario,
              fechaApertura: openedAt,
              horaApertura: this.formatTime(openedAt)
            });
            if (Array.isArray(cuts) && cuts.length) {
              const last = cuts[cuts.length - 1];
              aperturaId = (last && last.id) ? last.id : null;
            }
          } catch (e) {
            console.error('Error al registrar corte de apertura:', e);
          }
        }

        const session = {
          role: user.role || 'admin',
          name: usuario,
          usuario: usuario,
          cashInitial: amount,
          cashOpening: amount,
          montoApertura: amount,
          timestamp: timestamp,
          openedAt: openedAt,
          turnoNumero: turnoNumero,
          turno: turno,
          turnoId: aperturaId,
          aperturaId: aperturaId
        };

        // Persistencia de la caja abierta: sin esto la app vuelve al login
        if (typeof CashSession !== 'undefined') {
          const saved = CashSession.save(session);
          if (!saved) {
            alert('No se pudo registrar la apertura de caja. Revisa el almacenamiento del navegador.');
            return;
          }
        } else {
          localStorage.setItem('pos_session', JSON.stringify(session));
          localStorage.setItem('cerveceria_session', JSON.stringify(session));
        }

        // Se mantiene sincronizada la capa de base de datos
        if (typeof Database !== 'undefined' && Database.setSession) {
          try {
            Database.setSession(session);
          } catch (e) {
            console.error('Error al guardar sesión en Database:', e);
          }
        }

        // Transición inmediata a POS
        if (typeof App !== 'undefined' && typeof App.enterApp === 'function') {
          App.enterApp(session);
        } else {
          // Fallback: mostrar POS directamente y restaurar chrome
          try {
            const tabBar = document.getElementById('tab-bar');
            if (tabBar) tabBar.style.display = 'flex';
            const headerActions = document.querySelector('.header-actions');
            if (headerActions) headerActions.style.display = 'flex';
            const userArea = document.getElementById('header-user');
            const userName = document.getElementById('user-name');
            if (userArea) userArea.style.display = 'flex';
            if (userName) userName.textContent = usuario;
            if (typeof POS !== 'undefined' && typeof POS.init === 'function') {
              const main = document.getElementById('app-main');
              if (main) {
                main.innerHTML = '';
              }
              POS.init();
            }
          } catch (e) {
            console.error('Error en fallback de transición:', e);
          }
        }
      } catch (err) {
        console.error('Error en apertura:', err);
      }
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Login;
  module.exports.CashSession = CashSession;
}
