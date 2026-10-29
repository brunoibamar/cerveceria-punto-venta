// App: enrutador de vistas, control de pestanas de navegacion inferior y sesion
// El cierre del turno (y por tanto la salida) se hace unicamente desde "Corte de Caja".

const App = {
  views: ['pos', 'inventory', 'surtidos', 'reports', 'settings'],
  currentView: null,
  eventsBound: false,

  // Contenedor de tarjetas que recibe la entrada escalonada en cada vista
    staggerTargets: {
    pos: '.product-grid',
    inventory: '.inventory-grid',
    surtidos: '.inventory-cycle-list',
    reports: '.reports-metrics-grid',
    settings: '.settings-grid'
  },

  async init() {
    if (!WriteGuard.ready) { WriteGuard.start(() => this.init()); return; }
    try {
      const main = document.getElementById('app-main');
      if (!main) {
        console.error('[App] Contenedor principal #app-main no existe en el HTML');
        return;
      }

      if (typeof Database !== 'undefined' && Database.init) {
        try {
          Database.init();
          await Auth.ensureCredentials();
          Demo.init();
        } catch (dbErr) {
          this.showStorageRecovery(dbErr);
          return;
        }
      }

      // Verificación inicial obligatoria: sin caja/turno activo se bloquea
      // la app y se muestra el login con la apertura de caja.
      const session = this.getActiveSession();
      if (!session) {
        this.showLogin();
        return;
      }

      this.enterApp(session);
      ShiftGuard.check();
    } catch (error) {
      console.error('[App] Error fatal en App.init:', error);
      try {
        this.showLogin();
      } catch (e) {
        console.error('[App] No se pudo mostrar login tras error:', e);
      }
    }
  },

  showStorageRecovery(error) {
    const main=document.getElementById('app-main'); main.replaceChildren();
    const panel=document.createElement('div'); panel.className='startup-notice';
    const heading=document.createElement('h2'); heading.textContent='No se pudo abrir el almacenamiento';
    const detail=document.createElement('p'); detail.textContent=error.message;
    const button=document.createElement('button'); button.className='btn'; button.textContent='Recuperar copia local';
    button.onclick=async()=>{ try { await DataStore.recover(); location.reload(); } catch(e) { detail.textContent=e.message; } };
    panel.append(heading,detail,button); main.append(panel);
  },

  // Devuelve la sesion solo si existe y la caja esta abierta (fondo de ingreso registrado)
  getActiveSession() {
    try {
      // CashSession es la autoridad unica sobre el turno activo
      if (typeof CashSession !== 'undefined' && CashSession.getActiveSession) {
        return CashSession.getActiveSession();
      }
      // Sin el guardián de sesión no se permite entrar por datos alternativos.
      return null;
    } catch (error) {
      console.error('[App] Error en getActiveSession:', error);
      return null;
    }
  },

  showLogin() {
    try {
      this.currentView = null;
      const main = document.getElementById('app-main');
      if (!main) {
        console.error('[App] No existe #app-main para mostrar login');
        return;
      }
      if (typeof Login !== 'undefined' && Login.init) {
        Login.init('app-main');
        return;
      }
      // Respaldo: sin modulo de login la app queda bloqueada
      const tabBar = document.getElementById('tab-bar');
      if (tabBar) tabBar.style.display = 'none';
      const headerActions = document.querySelector('.header-actions');
      if (headerActions) headerActions.style.display = 'none';
      main.innerHTML = '<div style="padding:24px;color:#FAF4EE;text-align:center;">Debes iniciar sesión y abrir caja para usar el sistema.</div>';
    } catch (error) {
      console.error('[App] Error en showLogin:', error);
    }
  },

  enterApp(session) {
    try {
      // Solo se entra al POS con una caja abierta y verificada
      const active = this.getActiveSession();
      if (!active) {
        console.warn('[App] Sin caja abierta: se regresa al login');
        this.showLogin();
        return;
      }
      this.restoreAppChrome(active);
      this.bindEvents();
      this.showView('pos');
      document.querySelectorAll('.tab-btn').forEach(btn => { btn.hidden = ['inventory','surtidos','settings'].includes(btn.dataset.view) && !Auth.isAdmin(); });
    } catch (error) {
      console.error('[App] Error en enterApp:', error);
      try {
        this.showView('pos');
      } catch (e) {
        console.error('[App] No se pudo forzar vista pos:', e);
      }
    }
  },

  // Vuelve a mostrar la barra inferior flotante y las acciones de cabecera
  restoreAppChrome(session) {
    try {
      const tabBar = document.getElementById('tab-bar');
      if (tabBar) {
        tabBar.style.display = 'flex';
        tabBar.classList.add('is-visible');
      }
      const headerActions = document.querySelector('.header-actions');
      if (headerActions) {
        headerActions.style.display = 'flex';
        headerActions.classList.add('is-visible');
      }
      const userArea = document.getElementById('header-user');
      const userName = document.getElementById('user-name');
      if (userArea) userArea.style.display = 'flex';
      if (userName) {
        const name = (session && (session.name || session.usuario)) || 'Usuario';
        userName.textContent = name;
      }
      const corteBtn = document.getElementById('btn-corte-caja');
      if (corteBtn) corteBtn.style.display = 'flex';
    } catch (error) {
      console.error('[App] Error en restoreAppChrome:', error);
    }
  },

  bindEvents() {
    if (this.eventsBound) return;
    try {
      this.bindTabBar();
      this.bindCorteCaja();
      this.bindConnectionStatus();
      this.eventsBound = true;
    } catch (error) {
      console.error('[App] Error al vincular eventos:', error);
      this.eventsBound = false;
    }
  },


  bindTabBar() {
    try {
      const buttons = document.querySelectorAll('.tab-btn');
      if (!buttons || buttons.length === 0) return;
      buttons.forEach(btn => {
        if (!btn) return;
        btn.addEventListener('click', () => {
          try {
            const view = btn.dataset.view;
            this.showView(view);
          } catch (e) {
            console.error('[App] Error al cambiar vista:', e);
          }
        });
      });
    } catch (error) {
      console.error('[App] Error en bindTabBar:', error);
    }
  },

  bindCorteCaja() {
    try {
      const btn = document.getElementById('btn-corte-caja');
      if (btn) {
        btn.addEventListener('click', () => {
          try {
            // El corte de caja abre el modal de resumen y cierre del turno activo
            if (typeof POS !== 'undefined' && typeof POS.openCashCutModal === 'function') {
              POS.openCashCutModal();
              return;
            }
            this.showView('reports');
          } catch (e) {
            console.error('[App] Error al abrir el corte de caja:', e);
          }
        });
      }
    } catch (error) {
      console.error('[App] Error en bindCorteCaja:', error);
    }
  },

  bindConnectionStatus() {
    try {
      const statusEl = document.getElementById('connection-status');
      if (!statusEl) return;

      const update = () => {
        try {
          if (navigator.onLine) {
            statusEl.classList.add('online');
            statusEl.classList.remove('offline');
            statusEl.title = 'En línea';
          } else {
            statusEl.classList.add('offline');
            statusEl.classList.remove('online');
            statusEl.title = 'Offline';
          }
        } catch (e) {
          console.error('[App] Error actualizando connection status:', e);
        }
      };

      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      update();
    } catch (error) {
      console.error('[App] Error en bindConnectionStatus:', error);
    }
  },

  showView(view) {
    try {
      if (!view || !this.views.includes(view)) {
        console.warn('[App] Vista no válida:', view);
        return;
      }

      // Control de acceso: sin caja abierta no se entra a ventas, inventario,
      // promociones ni reportes; la app vuelve a la pantalla de login.
      if (!this.getActiveSession()) {
        console.warn('[App] Vista "' + view + '" bloqueada: no hay caja abierta');
        this.showLogin();
        return;
      }

      if (['inventory','surtidos','settings'].includes(view) && !Auth.isAdmin()) { alert('Esta sección requiere administrador.'); return; }
      this.currentView = view;

      // Cierra el modal de cobro si se esta cambiando de vista
      if (typeof POS !== 'undefined' && POS.closePaymentModal) {
        try {
          POS.closePaymentModal();
        } catch (closeErr) {
          console.error('[App] Error al cerrar el modal de cobro:', closeErr);
        }
      }

      // Cierra el modal de corte de caja si se esta cambiando de vista
      if (typeof POS !== 'undefined' && POS.closeCashCutModal) {
        try {
          POS.closeCashCutModal();
        } catch (cutErr) {
          console.error('[App] Error al cerrar el modal de corte de caja:', cutErr);
        }
      }

      const main = document.getElementById('app-main');
      if (!main) {
        console.error('[App] Contenedor #app-main no existe');
        return;
      }

      try {
        const session = this.getActiveSession();
        this.restoreAppChrome(session);
      } catch (chromeErr) {
        console.error('[App] Error restaurando chrome:', chromeErr);
      }

      // Marca la pestana activa: la barra flotante siempre refleja la vista real
      const tabBtns = document.querySelectorAll('.tab-btn');
      tabBtns.forEach(btn => {
        if (!btn) return;
        const isActive = btn.dataset.view === view;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
      });

      const corteBtn = document.getElementById('btn-corte-caja');
      if (corteBtn) {
        corteBtn.style.display = 'flex';
      }

      switch (view) {
        case 'pos': {
          main.innerHTML = `
            <div class="pos-view">
              <div class="pos-sidebar">
                <div class="pos-search-bar" id="pos-search-bar">
                  <input type="text" id="pos-search-input" placeholder="Buscar por nombre o código de barras..." autocomplete="off" />
                  <button type="button" id="pos-camera-btn" class="btn-camera" title="Escanear código de barras con cámara">📷 <span class="btn-text">Escanear con Cámara</span></button>
                </div>
                <div id="pos-product-list"></div>
              </div>
              <div class="pos-main">
                <div id="pos-cart"></div>
                <div class="pos-summary-bar">
                  <div class="pos-totals">
                    <div class="pos-totals-row">
                      <span class="pos-totals-label">Subtotal</span>
                      <span class="pos-totals-value" id="pos-subtotal">$0.00</span>
                    </div>
                    <div class="pos-totals-row pos-totals-cold" id="pos-cold-charge-row" hidden>
                      <span class="pos-totals-label">Cargo bebida fría</span>
                      <span class="pos-totals-value" id="pos-cold-charge">$0.00</span>
                    </div>
                    <div class="pos-totals-row pos-totals-grand">
                      <span class="pos-totals-label">Total a Pagar</span>
                      <strong class="pos-totals-value" id="pos-total">$0.00</strong>
                    </div>
                  </div>
                    <div class="pos-summary-actions">
                      <button type="button" class="btn pos-charge-btn" id="pos-charge-btn" onclick="if (typeof POS !== 'undefined') POS.openPaymentModal()">Cobrar</button>
                    </div>
                </div>
              </div>
            </div>
            <div id="pos-scanner-modal" class="scanner-modal" role="dialog" aria-modal="true">
              <div class="scanner-modal-backdrop" onclick="if (typeof POS !== 'undefined') POS.closeCameraScanner()"></div>
              <div class="scanner-modal-content">
                <div class="scanner-modal-header">
                  <h2>Escáner de códigos de barras</h2>
                  <button type="button" class="scanner-close" onclick="if (typeof POS !== 'undefined') POS.closeCameraScanner()" aria-label="Cerrar escáner">✕</button>
                </div>
                <div class="scanner-modal-body">
                  <div class="scanner-video-wrapper">
                    <video id="pos-scanner-video" playsinline muted></video>
                    <div class="scanner-guide"></div>
                    <div class="scanner-overlay">
                      <div class="scanner-hint">Apunta la cámara al código de barras</div>
                    </div>
                  </div>
                  <div class="scanner-mode">
                    <label style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px;">
                      <input type="checkbox" id="pos-scanner-continuous" />
                      Modo continuo
                    </label>
                  </div>
                  <div class="scanner-status" id="pos-scanner-status">Iniciando cámara...</div>
                </div>
                <div class="scanner-modal-footer">
                  <button type="button" class="btn secondary" onclick="if (typeof POS !== 'undefined') POS.closeCameraScanner()">Cerrar</button>
                  <button type="button" class="btn" id="pos-scanner-toggle" onclick="if (typeof POS !== 'undefined') POS.toggleCameraScanner()">Detener</button>
                </div>
              </div>
            </div>
          `;
          if (typeof POS !== 'undefined' && POS.init) {
            try {
              POS.init();
            } catch (posErr) {
              console.error('[App] Error inicializando POS:', posErr);
            }
          }
          break;
        }

        case 'inventory': {
          main.innerHTML = `<div id="inventory-container"></div>`;
          const invContainer = document.getElementById('inventory-container');
          if (invContainer && typeof InventoryManager !== 'undefined' && InventoryManager.init) {
            try {
              InventoryManager.init('inventory-container');
            } catch (invErr) {
              console.error('[App] Error inicializando InventoryManager:', invErr);
            }
          } else if (!invContainer) {
            console.error('[App] Contenedor #inventory-container no existe tras render');
          }
          break;
        }

        case 'surtidos': {
          main.innerHTML = `
            <div id="surtidos-container" class="surtidos-view">
              <div id="surtidos-summary" class="inventory-summary" aria-live="polite"></div>
              <div id="inventory-cycle-panel"></div>
            </div>
          `;
          const surtidosContainer = document.getElementById('surtidos-container');
          if (surtidosContainer && typeof InventoryManager !== 'undefined' && InventoryManager.initSurtidos) {
            try {
              InventoryManager.initSurtidos('surtidos-container');
            } catch (invErr) {
              console.error('[App] Error inicializando módulo de Surtidos:', invErr);
            }
          } else if (!surtidosContainer) {
            console.error('[App] Contenedor #surtidos-container no existe tras render');
          }
          break;
        }

        case 'reports': {
          main.innerHTML = `<div id="reports-content"></div>`;
          const reportsContainer = document.getElementById('reports-content');
          if (reportsContainer && typeof ReportsManager !== 'undefined' && ReportsManager.init) {
            try {
              ReportsManager.init('reports-content');
            } catch (repErr) {
              console.error('[App] Error inicializando ReportsManager:', repErr);
            }
          } else if (!reportsContainer) {
            console.error('[App] Contenedor #reports-content no existe tras render');
          }
          break;
        }

        case 'settings': {
          main.innerHTML = `<div id="settings-content"></div>`;
          const settingsContainer = document.getElementById('settings-content');
          if (settingsContainer && typeof SettingsManager !== 'undefined' && SettingsManager.init) {
            try {
              SettingsManager.init('settings-content');
            } catch (setErr) {
              console.error('[App] Error inicializando SettingsManager:', setErr);
            }
          } else if (!settingsContainer) {
            console.error('[App] Contenedor #settings-content no existe tras render');
          }
          break;
        }

        default:
          break;
      }

      // Cada vista arranca desde arriba al cambiar de pestaña
      try {
        main.scrollTop = 0;
      } catch (scrollErr) {
        console.error('[App] No se pudo reiniciar el scroll de la vista:', scrollErr);
      }

      // Entrada animada del contenido al cambiar de pestaña
      this.animateView(main);
    } catch (error) {
      console.error('[App] Error fatal en showView:', error);
      try {
        const main = document.getElementById('app-main');
        if (main) {
          main.innerHTML = '<div style="padding:16px;color:var(--text-secondary)">Ocurrio un error al cargar la vista. Intenta cambiar de pestana o recargar.</div>';
        }
      } catch (e) {
        console.error('[App] Error mostrando fallback:', e);
      }
    }
  },

  // Anima la entrada del contenido de la vista (fade-in suave al cambiar de pestaña)
  animateView(main) {
    try {
      if (!main) return;
      if (typeof UIAnimations !== 'undefined') {
        UIAnimations.fadeIn(main);
        const selector = this.staggerTargets[this.currentView];
        if (selector) UIAnimations.staggerIn(main, selector);
        return;
      }
      main.classList.remove('animate-fade-in');
      void main.offsetWidth; // reflow: reinicia la animación
      main.classList.add('animate-fade-in');
    } catch (error) {
      console.error('[App] Error animando la vista:', error);
    }
  }
};

// Inicializacion segura al cargar DOM
(function safeInit() {
  try {
    const start = () => {
      try {
        App.init();
      } catch (err) {
        console.error('[App] Error en inicializacion DOMContentLoaded:', err);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  } catch (error) {
    console.error('[App] Error configurando inicializacion segura:', error);
  }
})();
