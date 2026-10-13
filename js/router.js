import { getCurrentUser } from './auth.js';
import { renderPOS } from './modules/pos.js';
import { renderInventory } from './modules/inventory.js';
import { renderReports } from './modules/reports.js';
import { renderConfig } from './modules/config.js';
import { renderPromos } from './modules/promos.js';

const DEFAULT_ROUTE = 'pos';

const routes = {
  pos: { roles: ['admin', 'cajero'] },
  inventory: { roles: ['admin'] },
  promos: { roles: ['admin'] },
  reports: { roles: ['admin'] },
  config: { roles: ['admin'] },
};

export function navigate(route) {
  window.location.hash = `/${route}`;
}

export function initRouter(container) {
  window.addEventListener('hashchange', () => handleRoute(container));
  window.addEventListener('DOMContentLoaded', () => handleRoute(container));
  handleRoute(container);
}

export function handleRoute(container) {
  const appContainer = container || document.getElementById('app');
  if (!appContainer) return;

  const hash = window.location.hash || '#/pos';
  const routeName = hash.replace(/^#\/?/, '') || DEFAULT_ROUTE;
  const user = getCurrentUser();

  if (!user) {
    appContainer.innerHTML = '';
    updateActiveNavTab(DEFAULT_ROUTE);
    import('./modules/login.js').then(({ createLoginModal }) => {
      createLoginModal({
        onAuthenticated: () => {
          window.location.reload();
        },
      });
    });
    return;
  }

  const route = routes[routeName] || routes[DEFAULT_ROUTE];
  if (!route.roles.includes(user.role)) {
    navigate(DEFAULT_ROUTE);
    return;
  }

  appContainer.innerHTML = '';

  switch (routeName) {
    case 'inventory':
      renderInventory(appContainer, user);
      break;
    case 'promos':
      renderPromos(appContainer, user);
      break;
    case 'reports':
      renderReports(appContainer, user);
      break;
    case 'config':
      renderConfig(appContainer, user);
      break;
    case 'pos':
    default:
      renderPOS(appContainer, user);
      break;
  }

  updateActiveNavTab(routeName);
}

function updateActiveNavTab(routeName) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    const isActive = item.dataset.route === routeName;
    item.classList.toggle('active', isActive);
    if (isActive) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });
}
