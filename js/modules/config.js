import { login, getCurrentUser } from '../auth.js';
import { navigate } from '../router.js';
import { db } from '../db.js';

export function renderConfig(container) {
  const user = getCurrentUser();

  if (!user) {
    container.innerHTML = `
      <h2 class="view-title">Iniciar sesión</h2>
      <form class="card form" id="login-form">
        <label class="field">
          <span>Usuario</span>
          <input class="input" name="username" autocomplete="username" required>
        </label>
        <label class="field">
          <span>PIN</span>
          <input class="input" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
        </label>
        <p class="muted">Demo: admin / 1234 (Admin) · cajero / 1234 (Cajero)</p>
        <p class="form-error" id="login-error"></p>
        <button class="btn btn--block" type="submit">Entrar</button>
      </form>
    `;

    container.querySelector('#login-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.target;
      const session = login(form.username.value, form.pin.value);
      if (!session) {
        container.querySelector('#login-error').textContent = 'Credenciales inválidas';
        return;
      }
      navigate('pos');
    });
    return;
  }

  container.innerHTML = `
    <h2 class="view-title">Configuración</h2>
    <div class="card">
      <p><strong>${user.name}</strong></p>
      <p class="muted">Rol: ${user.role} · Sesión iniciada ${new Date(user.loginAt).toLocaleString()}</p>
      <div class="actions">
        <button class="btn btn--danger" data-action="logout">Cerrar sesión</button>
      </div>
    </div>
    <div class="card">
      <h3>Roles</h3>
      <p class="muted">Admin: inventario, promociones, reportes y ventas. Cajero: ventas.</p>
    </div>
    <div class="card">
      <h3>Recargo global por Bebida Fría</h3>
      <label class="field">
        <span>Recargo por bebida fría (en moneda local)</span>
        <input class="input" type="number" min="0" step="0.01" id="cold-drink-surcharge" placeholder="Ej. 5.00">
      </label>
      <p class="muted">Este se sumará al precio de venta de todos los productos marcados como Bebida Fría / En Refrigerador.</p>
      <div class="actions" style="margin-top: var(--spacing-lg);">
        <button class="btn" id="save-surcharge">Guardar</button>
      </div>
     </div>
   `;
  // Load current surcharge and set input value
  const currentSurcharge = db.getSetting('coldDrinkSurcharge', 0);
  container.querySelector('#cold-drink-surcharge').value = currentSurcharge;

  // Save surcharge when button is clicked
  container.querySelector('#save-surcharge').addEventListener('click', () => {
    const value = parseFloat(container.querySelector('#cold-drink-surcharge').value) || 0;
    db.setSetting('coldDrinkSurcharge', value);
    alert('Recargo guardado correctamente');
  });
}
