import { login, getCurrentUser } from '../auth.js';
import { navigate } from '../router.js';

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
  `;
}
