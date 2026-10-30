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
        const raw = DataStore.getItem(keys[i]);
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
    if (!session || typeof session !== 'object' || !Auth.validSession(session)) return false;
    if (!String(session.role || session.rol || '').trim()) return false;
    if (!String(session.name || session.usuario || '').trim()) return false;
    if (this.getOpeningAmount(session) === null) return false;
    if (!session.openedAt && !session.timestamp && !session.fechaApertura) return false;
    return true;
  },

  // La caja solo está activa si existe un registro explícito y coincide con la sesión.
  isRegisterOpen(session) {
    try {
      const raw = DataStore.getItem(this.KEYS.CAJA);
      if (!raw) return false;
      const caja = JSON.parse(raw);
      if (!caja || caja.abierta !== true) return false;

      const fondoInicial = Number(caja.fondoInicial);
      const fondoSesion = this.getOpeningAmount(session);
      const usuarioCaja = String(caja.usuario || '').trim();
      const usuarioSesion = String(session && (session.name || session.usuario) || '').trim();

      return Number.isFinite(fondoInicial)
        && fondoInicial >= 0
        && fondoInicial === fondoSesion
        && usuarioCaja !== ''
        && usuarioCaja === usuarioSesion;
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
      if (!this.isRegisterOpen(session)) return null;
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
      return DataStore.atomic(() => {
      DataStore.setItem(this.KEYS.POS, JSON.stringify(session));
      DataStore.setItem(this.KEYS.DB, JSON.stringify(session));
      DataStore.setItem(this.KEYS.CAJA, JSON.stringify({
        abierta: true,
        fondoInicial: amount === null ? 0 : amount,
        fechaApertura: session.openedAt || new Date().toISOString(),
        turnoNumero: session.turnoNumero || null,
        turno: session.turno || null,
        turnoId: session.turnoId || null,
        usuario: session.name || session.usuario || 'Cajero'
      }));
      return session;
      });
    } catch (error) {
      console.error('[CashSession] Error al guardar la sesión:', error);
      return null;
    }
  },

  // Elimina la sesión del turno activo (corte de caja / cierre de turno)
  clear() {
    DataStore.atomic(() => {
      [this.KEYS.POS,this.KEYS.DB,this.KEYS.CAJA].forEach(key=>DataStore.removeItem(key));
      DataStore.removeItem('cerveceria_auth');
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
        <a class="login-back" href="${typeof CloudConfig!=='undefined'?CloudConfig.link('nube.html?mode=supervisor'):'nube.html?mode=supervisor'}" target="_blank" rel="noopener">Entrar como supervisor</a>
        <p class="login-note">Supervisa con tu correo y contraseña, sin abrir ni cerrar la caja.</p>
        <p class="login-note">
          Para operar el punto de venta es obligatorio registrar la apertura de caja con el fondo inicial del turno.
        </p>
      </div>
    `;
    Auth.renderBootstrapNotice().catch(error=>console.error('[Seguridad]',error));
    document.getElementById('role-admin').onclick = () => this.renderPinPad();
    document.getElementById('role-employee').onclick = () => this.renderStaffForm('employee');
  },

  renderPinPad() { Auth.renderLogin('admin'); },
  renderStaffForm() { Auth.renderLogin('employee'); },

  // Paso final obligatorio: apertura de caja con el fondo inicial del turno
  openCash(user) {
    this.container.innerHTML='<div class="login-screen"><div class="cash-card"><h2 class="cash-card-title">Apertura de Caja</h2><p class="cash-card-subtitle">Fondo inicial en efectivo</p><form id="cash-open-form"><input id="cash-amount" class="cash-amount" type="number" step="0.01" min="0" value="0" inputmode="decimal" required><p id="cash-error" class="form-error" role="alert"></p><button type="submit" id="cash-confirm" class="cash-confirm">Confirmar</button></form></div></div>';
    this.resetScroll();
    document.getElementById('cash-open-form').onsubmit=e=>{
      e.preventDefault(); const button=document.getElementById('cash-confirm'); button.disabled=true;
      try { const session=Database.openRegister(user,Number(document.getElementById('cash-amount').value)); App.enterApp(session); ShiftGuard.check(); }
      catch(error) { document.getElementById('cash-error').textContent=error.message; button.disabled=false; }
    };
  }

};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Login;
  module.exports.CashSession = CashSession;
}
