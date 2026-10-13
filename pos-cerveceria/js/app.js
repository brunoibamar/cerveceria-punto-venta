import { initRouter, navigate } from './router.js';
import { getCurrentUser, logout } from './auth.js';

const viewEl = document.getElementById('view');
const userBadge = document.getElementById('user-badge');

function updateUserBadge() {
  if (!userBadge) return;
  const user = getCurrentUser();
  userBadge.textContent = user ? user.name : 'Invitado';
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
  if (event.target.closest('[data-action="logout"]')) {
    logout();
    updateUI();
    navigate('pos');
    showLoginModal();
    return;
  }
  if (event.target.closest('[data-action="change-user"]')) {
    logout();
    updateUI();
    navigate('pos');
    showLoginModal();
    return;
  }
});

updateUI();
initRouter(viewEl);
showLoginModal();

let loginModalShown = false;

async function showLoginModal() {
  const user = getCurrentUser();
  if (user) return;
  if (loginModalShown) return;
  loginModalShown = true;

  const { createLoginModal } = await import('./modules/login.js');
  createLoginModal({
    onAuthenticated: () => {
      loginModalShown = false;
      updateUI();
      navigate('pos');
    },
  });
}