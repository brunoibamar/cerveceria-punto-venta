import { initRouter, navigate } from './router.js';
import { getCurrentUser, logout } from './auth.js';

const viewEl = document.getElementById('app');
const userBadgeEl = document.getElementById('role-display');
const roleDisplay = document.getElementById('role-display');

let loginModalShown = false;

function updateUserBadge() {
  const user = getCurrentUser();
  if (roleDisplay) {
    if (user) {
      roleDisplay.textContent = user.role === 'admin' ? '👑 Rol: Admin' : '👤 Rol: Cajero';
    } else {
      roleDisplay.textContent = 'Rol: -';
    }
  }
}

function updateNavVisibility() {
  const user = getCurrentUser();
  document.querySelectorAll('#bottom-nav .nav-item').forEach((item) => {
    const allowed = item.dataset.roles ? item.dataset.roles.split(' ') : [];
    if (!user) {
      item.classList.add('nav-item--hidden');
    } else {
      item.classList.toggle('nav-item--hidden', !allowed.includes(user.role));
    }
  });
}

function updateUI() {
  updateUserBadge();
  updateNavVisibility();
}

window.addEventListener('storage', updateUI);
window.addEventListener('hashchange', updateUI);

document.body.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="logout"]') || event.target.closest('[data-action="change-user"]')) {
    logout();
    navigate('config');
    return;
  }
});

updateUI();
initRouter(viewEl);
showLoginModal();

function showLoginModal() {
  const user = getCurrentUser();
  if (user) return;
  if (loginModalShown) return;
  loginModalShown = true;

  import('./modules/login.js').then(({ createLoginModal }) => {
    createLoginModal({
      onAuthenticated: () => {
        loginModalShown = false;
        updateUI();
        navigate('pos');
      },
    });
  });
}
