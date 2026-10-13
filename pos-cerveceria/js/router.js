import { getCurrentUser } from './auth.js';

const DEFAULT_ROUTE = 'pos';

const routes = {
  pos: { roles: ['admin', 'cajero'], load: () => import('./modules/pos.js') },
  inventory: { roles: ['admin'], load: () => import('./modules/inventory.js') },
  promos: { roles: ['admin'], load: () => import('./modules/promos.js') },
  reports: { roles: ['admin'], load: () => import('./modules/reports.js') },
  config: { roles: ['admin'], load: () => import('./modules/config.js') },
};

export function navigate(route) {
  window.location.hash = `/${route}`;
}

export function initRouter(container) {
  window.addEventListener('hashchange', render);
  render();

  async function render() {
    if (!container) {
      return;
    }
    const hash = window.location.hash.replace(/^#\/?/, '') || DEFAULT_ROUTE;
    const routeName = routes[hash] ? hash : DEFAULT_ROUTE;
    const user = getCurrentUser();

    if (!user) {
      setActiveNav('config');
      const { render: renderConfig } = await loadModule('config');
      renderConfig(container);
      return;
    }

    const route = routes[routeName];
    if (!route.roles.includes(user.role)) {
      navigate('pos');
      return;
    }

    setActiveNav(routeName);
    const module = await loadModule(routeName);
    module.render(container, user);
  }
}

async function loadModule(name) {
  try {
    return await routes[name].load();
  } catch {
    return import('./modules/pos.js');
  }
}

function setActiveNav(routeName) {
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
