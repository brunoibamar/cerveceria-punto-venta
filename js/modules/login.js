import { loginAsGuest, loginAsAdmin, verifyAdminPin, getCurrentUser } from '../auth.js';

const PIN_LENGTH = 4;

export function createLoginModal({ onAuthenticated } = {}) {
  const user = getCurrentUser();
  if (user) {
    onAuthenticated?.(user);
    return;
  }

  if (document.getElementById('login-modal')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'login-modal';
  overlay.innerHTML = `
    <div class="login-modal card" role="dialog" aria-modal="true" aria-label="Pantalla de selección de rol">
      <h1 class="login-title">Cervecería &amp; Depósito</h1>
      <p class="login-subtitle">Seleccione modo de acceso</p>
      <div class="login-actions" id="role-select-step">
        <button class="btn btn--secondary btn--block btn--lg" data-action="guest">
          Ingresar como Cajero / Invitado
        </button>
        <button class="btn btn--primary btn--block btn--lg" data-action="admin">
          Ingresar como Administrador
        </button>
      </div>
      <div id="pin-step" style="display:none; flex-direction: column; gap: var(--spacing-md);">
        <h2 class="login-title">Acceso Administrador</h2>
        <p class="login-subtitle">Ingrese PIN de 4 dígitos</p>
        <div class="pin-display" id="pin-display">
          <div class="pin-dot" data-index="0"></div>
          <div class="pin-dot" data-index="1"></div>
          <div class="pin-dot" data-index="2"></div>
          <div class="pin-dot" data-index="3"></div>
        </div>
        <p class="form-error" id="pin-error" style="display:none;"></p>
        <div class="pin-keypad" id="pin-keypad"></div>
        <button class="btn btn--ghost btn--block" data-action="back">Volver</button>
      </div>
    </div>
  `;

  const roleStep = overlay.querySelector('#role-select-step');
  const pinStep = overlay.querySelector('#pin-step');
  const keypad = overlay.querySelector('#pin-keypad');
  const pinError = overlay.querySelector('#pin-error');
  const pinDisplay = overlay.querySelector('#pin-display');
  let pinDigits = [];

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace'];
  keys.forEach((k) => {
    const btn = document.createElement('button');
    btn.className = 'pin-key';
    btn.dataset.key = k;
    if (k === 'clear') {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24" aria-hidden="true"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
      btn.setAttribute('aria-label', 'Borrar');
    } else if (k === 'backspace') {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24" aria-hidden="true"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>`;
      btn.setAttribute('aria-label', 'Retroceder');
    } else {
      btn.textContent = k;
    }
    keypad.appendChild(btn);
  });

  function showRoleStep() {
    roleStep.style.display = 'flex';
    pinStep.style.display = 'none';
    pinDigits = [];
    updatePinDisplay();
    hideError();
  }

  function showPinStep() {
    roleStep.style.display = 'none';
    pinStep.style.display = 'flex';
    pinDigits = [];
    updatePinDisplay();
    hideError();
  }

  function updatePinDisplay() {
    const dots = pinDisplay.querySelectorAll('.pin-dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < pinDigits.length));
  }

  function showError(msg) {
    pinError.textContent = msg;
    pinError.style.display = 'block';
  }

  function hideError() {
    pinError.style.display = 'none';
    pinError.textContent = '';
  }

  function checkPin() {
    const pin = pinDigits.join('');
    if (verifyAdminPin(pin)) {
      const session = loginAsAdmin(pin);
      close(session);
    } else {
      showError('PIN incorrecto');
      pinDigits = [];
      updatePinDisplay();
    }
  }

  function close(session) {
    overlay.remove();
    if (session) onAuthenticated?.(session);
  }

  overlay.addEventListener('click', (e) => {
    const guestBtn = e.target.closest('[data-action="guest"]');
    const adminBtn = e.target.closest('[data-action="admin"]');
    const backBtn = e.target.closest('[data-action="back"]');
    const keyBtn = e.target.closest('.pin-key');

    if (guestBtn) {
      const session = loginAsGuest();
      close(session);
      return;
    }
    if (adminBtn) {
      showPinStep();
      return;
    }
    if (backBtn) {
      showRoleStep();
      return;
    }
    if (keyBtn) {
      const key = keyBtn.dataset.key;
      if (key === 'backspace') {
        if (pinDigits.length) {
          pinDigits.pop();
          updatePinDisplay();
        }
      } else if (key === 'clear') {
        pinDigits = [];
        updatePinDisplay();
        hideError();
      } else {
        if (pinDigits.length < PIN_LENGTH) {
          pinDigits.push(key);
          updatePinDisplay();
          if (pinDigits.length === PIN_LENGTH) {
            checkPin();
          }
        }
      }
    }
  });

  document.body.appendChild(overlay);
  showRoleStep();
  return overlay;
}
