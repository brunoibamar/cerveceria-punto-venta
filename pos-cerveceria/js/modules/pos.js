import { db } from '../db.js';

let cart = [];
let html5Qrcode = null;

async function loadHtml5Qrcode() {
  if (html5Qrcode) return html5Qrcode;
  if (window.Html5Qrcode) {
    html5Qrcode = window.Html5Qrcode;
    return html5Qrcode;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    script.onload = () => {
      html5Qrcode = window.Html5Qrcode;
      resolve(html5Qrcode);
    };
    script.onerror = () => reject(new Error('No se pudo cargar html5-qrcode'));
    document.head.appendChild(script);
  });
}

export function render(container) {
  const products = db.getProducts();
  const activePromos = db.getActivePromos();
  container.innerHTML = `
    <h2 class="view-title">Vender</h2>
    <div class="pos-toolbar">
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input type="search" id="product-search" placeholder="Buscar por nombre o código de barras..." autocomplete="off" enterkeyhint="search" aria-label="Buscar producto por nombre o código de barras">
      </div>
      <button class="btn btn--amber" id="btn-escanear-camara" type="button" aria-label="Escanear código de barras con cámara">
        📷 Escanear con Cámara
      </button>
    </div>
    <div class="pos-header">
      <button class="btn btn--promo" id="promo-toggle" type="button" aria-expanded="false" aria-controls="promo-panel">
        🏷️ Promociones Activas
        <span class="promo-count">${activePromos.length}</span>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="promo-panel" id="promo-panel" hidden>
      ${renderPromoPanel(activePromos)}
    </div>
    <div class="grid" id="product-grid">
      ${products
        .map(
          (p) => `
        <button class="product-tile" data-id="${p.id}">
          <span class="product-name">${p.name}</span>
          <span class="price">$${p.price.toFixed(2)}</span>
          <span class="stock">Stock: ${p.stock}</span>
        </button>
      `,
        )
        .join('')}
    </div>
    <div class="card cart-card">
      <h3 class="cart-title">Carrito</h3>
      <ul class="list" id="cart-list"></ul>
      <div class="cart-row cart-total">
        <span>Total</span>
        <span class="price" id="cart-total">$0.00</span>
      </div>
      <button class="btn btn--block" id="checkout-btn">Cobrar</button>
    </div>
  `;

  const promoToggle = container.querySelector('#promo-toggle');
  const promoPanel = container.querySelector('#promo-panel');
  const productGrid = container.querySelector('#product-grid');
  const searchInput = container.querySelector('#product-search');

  promoToggle.addEventListener('click', () => {
    const expanded = promoToggle.getAttribute('aria-expanded') === 'true';
    promoToggle.setAttribute('aria-expanded', !expanded);
    promoPanel.hidden = expanded;
    promoToggle.querySelector('.chevron').style.transform = expanded ? 'rotate(0deg)' : 'rotate(180deg)';
  });

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    productGrid.querySelectorAll('.product-tile').forEach((tile) => {
      const product = products.find((p) => p.id === tile.dataset.id);
      const haystack = product
        ? `${product.name} ${product.code || ''}`.toLowerCase()
        : tile.querySelector('.product-name').textContent.toLowerCase();
      tile.style.display = !query || haystack.includes(query) ? '' : 'none';
    });
  });

  container.querySelector('#btn-escanear-camara').addEventListener('click', () => {
    openScannerModal(products);
  });

  productGrid.addEventListener('click', (event) => {
    const tile = event.target.closest('.product-tile');
    if (!tile) {
      return;
    }
    const product = products.find((p) => p.id === tile.dataset.id);
    if (product) {
      addToCart(product);
    }
  });

  promoPanel.addEventListener('click', (event) => {
    const btn = event.target.closest('.promo-action-btn');
    if (!btn) return;
    const promoId = btn.dataset.promoId;
    const promo = activePromos.find(p => p.id === promoId);
    if (promo) {
      applyPromoToCart(promo, products);
      promoToggle.setAttribute('aria-expanded', 'false');
      promoPanel.hidden = true;
      promoToggle.querySelector('.chevron').style.transform = 'rotate(0deg)';
    }
  });

  container.querySelector('#checkout-btn').addEventListener('click', checkout);
  renderCart();
}

function renderPromoPanel(promos) {
  if (promos.length === 0) {
    return '<div class="promo-empty">No hay promociones activas configuradas.</div>';
  }
  return promos.map(promo => `
    <div class="promo-card" data-promo-id="${promo.id}">
      <div class="promo-info">
        <strong class="promo-name">${promo.name}</strong>
        <span class="promo-type-badge ${promo.type}">${promo.type === 'discount' ? 'Descuento' : 'Combo'}</span>
        <div class="promo-detail">
          ${promo.type === 'discount' 
            ? `${promo.discount}% de descuento`
            : promo.items ? promo.items.map(i => `${i.qty}× ${i.productId}`).join(' + ') + ` = $${promo.comboPrice.toFixed(2)}` : ''}
        </div>
      </div>
      <button class="btn btn--sm promo-action-btn" data-promo-id="${promo.id}" type="button">
        ${promo.type === 'discount' ? 'Aplicar descuento' : 'Agregar al carrito'}
      </button>
    </div>
  `).join('');
}

function applyPromoToCart(promo, products) {
  if (promo.type === 'discount') {
    if (cart.length === 0) {
      alert('Agrega productos al carrito antes de aplicar el descuento.');
      return;
    }
    cart.forEach(item => {
      item.discount = promo.discount;
      item.originalPrice = item.price;
      item.price = item.price * (1 - promo.discount / 100);
    });
    renderCart();
    alert(`Descuento ${promo.discount}% aplicado a todo el carrito.`);
  } else if (promo.type === 'combo' && promo.items) {
    promo.items.forEach(comboItem => {
      const product = products.find(p => p.id === comboItem.productId);
      if (product) {
        addToCart(product, comboItem.qty);
      }
    });
    const comboItem = cart.find(item => item.id === promo.id + '_combo');
    if (comboItem) {
      comboItem.price = promo.comboPrice;
      comboItem.isCombo = true;
      comboItem.comboItems = promo.items.map(ci => ci.productId);
    }
    renderCart();
    alert(`Combo "${promo.name}" agregado al carrito por $${promo.comboPrice.toFixed(2)}.`);
  }
}

function openScannerModal(products) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'scanner-modal';
  overlay.innerHTML = `
    <div class="card scanner-modal" role="dialog" aria-modal="true" aria-label="Escáner de código de barras">
      <h3 class="scanner-title">📷 Lector de Código de Barras</h3>
      <div class="scanner-viewport">
        <div id="scanner-viewport" style="width:100%;"></div>
        <p class="scanner-status" id="scanner-status">Cargando lector…</p>
      </div>
      <label class="field">
        <span>O ingresa el código / nombre manualmente</span>
        <input class="input" id="scanner-manual" type="search"
          placeholder="Código de barras o nombre" autocomplete="off">
      </label>
      <div class="scanner-actions">
        <button class="btn btn--block" id="scanner-find" type="button">Buscar producto</button>
        <button class="btn btn--ghost btn--block" id="scanner-close" type="button">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const statusEl = overlay.querySelector('#scanner-status');
  const manual = overlay.querySelector('#scanner-manual');
  const viewport = overlay.querySelector('#scanner-viewport');
  let scanner = null;
  let closed = false;

  function findProduct(query) {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (
      products.find((p) => (p.code || '').toLowerCase() === q) ||
      products.find((p) => (p.code || '').toLowerCase().includes(q)) ||
      products.find((p) => p.name.toLowerCase().includes(q))
    );
  }

  function handleScan(value) {
    const product = findProduct(value);
    if (product) {
      close();
      addToCart(product);
      return true;
    }
    statusEl.textContent = `Código "${value}" no encontrado en el inventario`;
    return false;
  }

  async function startScanner() {
    try {
      await loadHtml5Qrcode();
      scanner = new window.Html5Qrcode('scanner-viewport');
      statusEl.textContent = 'Iniciando cámara…';
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 150 },
          aspectRatio: 1.77,
          disableFlip: true,
        },
        (decodedText, decodedResult) => {
          if (closed) return;
          handleScan(decodedText);
        },
        (error) => {
          // Ignore scan errors (no barcode found, etc.)
        }
      );
      statusEl.textContent = 'Cámara activa: apunta al código de barras';
    } catch (err) {
      console.error('Scanner error:', err);
      statusEl.textContent = 'Error al iniciar cámara. Ingresa el código manualmente.';
      viewport.innerHTML = '<p style="padding:1rem;text-align:center;color:var(--color-text-muted);">No se pudo acceder a la cámara.<br>Usa el campo manual abajo.</p>';
    }
  }

  function close() {
    closed = true;
    if (scanner) {
      scanner.stop().catch(() => {});
      scanner = null;
    }
    overlay.remove();
  }

  overlay.querySelector('#scanner-close').addEventListener('click', close);
  overlay.querySelector('#scanner-find').addEventListener('click', () => {
    handleScan(manual.value);
  });
  manual.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleScan(manual.value);
    }
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  startScanner();
}

function addToCart(product, qty = 1) {
  const line = cart.find((item) => item.id === product.id && !item.isCombo);
  if (line) {
    line.qty += qty;
  } else {
    cart.push({ id: product.id, name: product.name, price: product.price, qty });
  }
  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter((item) => item.id !== id);
  renderCart();
}

function renderCart() {
  const list = document.getElementById('cart-list');
  const totalEl = document.getElementById('cart-total');
  const checkoutBtn = document.getElementById('checkout-btn');
  if (!list) {
    return;
  }
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  list.innerHTML = cart.length
    ? cart
        .map(
          (item) => `
        <li class="list-item ${item.isCombo ? 'combo-item' : ''}">
          <span>${item.qty} × ${item.name}${item.isCombo ? ' (Combo)' : ''}${item.discount ? ` <span class="discount-badge">-${item.discount}%</span>` : ''}</span>
          <span class="actions">
            <span class="price">$${(item.price * item.qty).toFixed(2)}</span>
            <button class="btn-icon" data-id="${item.id}" title="Quitar">✕</button>
          </span>
        </li>
      `,
        )
        .join('')
    : '<li class="list-item muted">Carrito vacío</li>';
  totalEl.textContent = `$${total.toFixed(2)}`;
  checkoutBtn.disabled = cart.length === 0;
  list.querySelectorAll('.btn-icon').forEach((btn) => {
    btn.addEventListener('click', () => removeFromCart(btn.dataset.id));
  });
}

function checkout() {
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const items = cart.map((item) => ({ ...item }));
  db.addSale({ items, total });
  cart.forEach((item) => {
    if (!item.isCombo) {
      db.updateStock(item.id, -item.qty);
    } else if (item.comboItems) {
      item.comboItems.forEach(productId => {
        db.updateStock(productId, -item.qty);
      });
    }
  });
  cart = [];
  renderCart();
  alert(`Venta registrada: $${total.toFixed(2)}`);
}