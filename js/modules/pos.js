import { db } from '../db.js';

let cart = [];

export function renderPOS(container) {
  const products = db.getProducts();
  const activePromos = db.getActivePromos();
  container.innerHTML = `
    <h2 class="view-title">Vender</h2>
    <div class="pos-header">
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input type="search" id="product-search" placeholder="Buscar por nombre o código..." autocomplete="off" aria-label="Buscar producto">
      </div>
      <button class="btn btn--promo" id="promo-toggle" type="button" aria-expanded="false" aria-controls="promo-panel">
        🏷️ Promociones Activas
        <span class="promo-count">${activePromos.length}</span>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="promo-panel" id="promo-panel" hidden>
      ${renderPromoPanel(activePromos, products)}
    </div>
    <div class="grid" id="product-grid"></div>
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
  const searchInput = container.querySelector('#product-search');

  promoToggle.addEventListener('click', () => {
    const expanded = promoToggle.getAttribute('aria-expanded') === 'true';
    promoToggle.setAttribute('aria-expanded', !expanded);
    promoPanel.hidden = expanded;
    promoToggle.querySelector('.chevron').style.transform = expanded ? 'rotate(0deg)' : 'rotate(180deg)';
  });

  searchInput.addEventListener('input', () => {
    renderGrid(container, products, searchInput.value);
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

  container.querySelector('#product-grid').addEventListener('click', (event) => {
    const tile = event.target.closest('.product-tile');
    if (!tile) {
      return;
    }
    const product = products.find((p) => p.id === tile.dataset.id);
    if (product) {
      addToCart(product);
    }
  });

  container.querySelector('#checkout-btn').addEventListener('click', checkout);
  renderGrid(container, products, '');
  renderCart();
}

function renderPromoPanel(promos, products) {
  if (promos.length === 0) {
    return '<div class="promo-empty">No hay promociones activas configuradas.</div>';
  }
  return promos.map(promo => {
    let detailHtml = '';
    if (promo.type === 'discount') {
      detailHtml = `${promo.discount}% de descuento`;
    } else if (promo.type === 'combo' && promo.items) {
      detailHtml = promo.items.map(i => {
        const prod = products.find(p => p.id === i.productId);
        return `${i.qty}× ${prod ? prod.name : i.productId}`;
      }).join(' + ') + ` = $${promo.comboPrice.toFixed(2)}`;
    }
    return `
      <div class="promo-card" data-promo-id="${promo.id}">
        <div class="promo-info">
          <strong class="promo-name">${promo.name}</strong>
          <span class="promo-type-badge ${promo.type}">${promo.type === 'discount' ? 'Descuento' : 'Combo'}</span>
          <div class="promo-detail">${detailHtml}</div>
        </div>
        <button class="btn btn--sm promo-action-btn" data-promo-id="${promo.id}" type="button">
          ${promo.type === 'discount' ? 'Aplicar descuento' : 'Agregar al carrito'}
        </button>
      </div>
    `;
  }).join('');
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

function renderGrid(container, products, query) {
  const grid = container.querySelector('#product-grid');
  if (!grid) {
    return;
  }
  const q = query.trim().toLowerCase();
  const visible = q
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code || '').toLowerCase().includes(q),
      )
    : products;
  grid.innerHTML = visible.length
    ? visible
        .map(
          (p) => `
        <button class="product-tile" data-id="${p.id}">
          <span class="product-name">${escapeHtml(p.name)}</span>
          <span class="price">$${p.price.toFixed(2)}</span>
          <span class="stock">Stock: ${p.stock}</span>
          ${p.code ? `<span class="badge">${escapeHtml(p.code)}</span>` : ''}
        </button>
      `,
        )
        .join('')
    : `<p class="muted pos-empty">Sin resultados para "${escapeHtml(query.trim())}"</p>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
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
          <span>${item.qty} × ${escapeHtml(item.name)}${item.isCombo ? ' (Combo)' : ''}${item.discount ? ` <span class="discount-badge">-${item.discount}%</span>` : ''}</span>
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