import { db } from '../db.js';
import { isAdmin } from '../auth.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&';
      case '<':
        return '<';
      case '>':
        return '>';
      case '"':
        return '"';
      default:
        return "'";
    }
  });
}

function getStockBadge(stock) {
  if (stock <= 0) {
    return '<span class="badge badge--out-of-stock">🔴 Agotado</span>';
  }
  if (stock <= 15) {
    return '<span class="badge badge--low-stock">🟠 Stock Bajo</span>';
  }
  return '<span class="badge badge--in-stock">🟢 En Stock</span>';
}

function calculateMargin(price, costPrice) {
  const cost = costPrice || 0;
  const margin = price - cost;
  const percent = price > 0 ? ((margin / price) * 100).toFixed(1) : '0.0';
  return {
    margin: margin.toFixed(2),
    percent,
  };
}

function openEditModal(product, onSave) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="card" style="width: 100%; max-width: 480px;">
      <h3>Editar Producto</h3>
      <form id="edit-form" class="form">
        <label class="field">
          <span>Nombre</span>
          <input class="input" name="name" required maxlength="60" value="${product.name}">
        </label>
        <label class="field">
          <span>Código</span>
          <input class="input" name="code" maxlength="30" value="${product.code || ''}">
        </label>
        <label class="field">
          <span>Categoría</span>
          <input class="input" name="category" maxlength="30" value="${product.category || 'General'}">
        </label>
        <div class="form-row">
          <label class="field">
            <span>Precio de Venta</span>
            <input class="input" name="price" type="number" min="0" step="0.01" required value="${product.price}">
          </label>
          <label class="field">
            <span>Costo de Compra</span>
            <input class="input" name="costPrice" type="number" min="0" step="0.01" value="${product.costPrice || 0}">
          </label>
        </div>
        <label class="field">
          <span>Stock Actual</span>
          <input class="input" name="stock" type="number" min="0" step="1" required value="${product.stock}">
        </label>
        <div class="actions">
          <button type="button" class="btn btn--ghost" data-action="cancel">Cancelar</button>
          <button type="submit" class="btn">Guardar</button>
        </div>
      </form>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cancel"]')) {
      overlay.remove();
    }
  });

  overlay.querySelector('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    onSave({
      name: form.name.value.trim(),
      code: form.code.value.trim(),
      category: form.category.value.trim() || 'General',
      price: Number(form.price.value),
      costPrice: Number(form.costPrice.value) || 0,
      stock: Number(form.stock.value),
    });
    overlay.remove();
  });

  document.body.appendChild(overlay);
}

function openSupplyModal(product, onSave) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="card" style="width: 100%; max-width: 320px;">
      <h3>+ Surtir - ${product.name}</h3>
      <form id="supply-form" class="form">
        <label class="field">
          <span>Cantidad a agregar (cajas/unidades)</span>
          <input class="input" name="qty" type="number" min="1" step="1" required value="1" autofocus>
        </label>
        <div class="actions">
          <button type="button" class="btn btn--ghost" data-action="cancel">Cancelar</button>
          <button type="submit" class="btn">Agregar</button>
        </div>
      </form>
    </div>
  `;

overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cancel"]')) {
      overlay.remove();
    }
  });

  overlay.querySelector('#supply-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    onSave(Math.max(1, Number(form.qty.value)));
    overlay.remove();
  });

  document.body.appendChild(overlay);
}

function openDeleteModal(product, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="card" style="width: 100%; max-width: 400px;">
      <h3>🗑️ Eliminar Producto</h3>
      <p style="margin: var(--spacing-md) 0; color: var(--color-text-muted);">
        ¿Estás seguro de eliminar <strong>${escapeHtml(product.name)}</strong> del inventario?
      </p>
      <p style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
        Esta acción no se puede deshacer.
      </p>
      <div class="actions" style="margin-top: var(--spacing-lg);">
        <button type="button" class="btn btn--ghost" data-action="cancel">Cancelar</button>
        <button type="button" class="btn btn--danger" data-action="confirm">Eliminar</button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cancel"]')) {
      overlay.remove();
    }
  });

  overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
    onConfirm();
    overlay.remove();
  });

  document.body.appendChild(overlay);
}

function getStockProgress(stock) {
  if (stock <= 0) return 0;
  if (stock >= 100) return 100;
  return Math.min(100, Math.max(0, (stock / 100) * 100));
}

export function renderInventory(container) {
  const products = db.getProducts();

  container.innerHTML = `
    <h2 class="view-title">Inventario</h2>
    <form class="inventory-form-card" id="product-form">
      <h3 class="form-title">Nuevo producto</h3>
      <div class="form-group">
        <label class="form-label">Nombre</label>
        <input type="text" class="form-input" name="name" required maxlength="60" autocomplete="off" placeholder="Ej. Cerveza Artesanal">
      </div>
      <div class="form-group">
        <label class="form-label">Código</label>
        <input type="text" class="form-input" name="code" maxlength="30" autocomplete="off" placeholder="Ej. 750123456789">
      </div>
      <div class="form-group">
        <label class="form-label">Categoría</label>
        <input type="text" class="form-input" name="category" maxlength="30" autocomplete="off" placeholder="General">
      </div>
      <div class="form-group">
        <label class="form-label">Precio de Venta</label>
        <input type="number" class="form-input" name="price" min="0" step="0.01" required placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label">Costo de Compra</label>
        <input type="number" class="form-input" name="costPrice" min="0" step="0.01" value="0" placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label">Stock Inicial</label>
        <input type="number" class="form-input" name="stock" min="0" step="1" required value="0" placeholder="0">
      </div>
      <button class="btn btn--block" type="submit">Agregar producto</button>
    </form>
    <div class="inventory-grid" id="inventory-grid">
      ${products.map((product) => renderInventoryCard(product)).join('')}
    </div>
  `;

  container.querySelector('#product-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    db.addProduct({
      name: form.name.value.trim(),
      code: form.code.value.trim(),
      category: form.category.value.trim() || 'General',
      price: Number(form.price.value),
      costPrice: Number(form.costPrice.value) || 0,
      stock: Number(form.stock.value),
    });
    renderInventory(container);
  });

  container.querySelector('#inventory-grid').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) {
      return;
    }
    const card = btn.closest('.inventory-card');
    const id = card.dataset.id;
    const product = db.getProducts().find((p) => p.id === id);
    if (!product) return;
    const action = btn.dataset.action;
    if (action === 'increase') {
      db.updateStock(id, 1);
      renderInventory(container);
    } else if (action === 'decrease') {
      db.updateStock(id, -1);
      renderInventory(container);
    } else if (action === 'edit') {
      openEditModal(product, (updates) => {
        db.updateProduct(id, updates);
        renderInventory(container);
      });
    } else if (action === 'supply') {
      openSupplyModal(product, (qty) => {
        db.addStock(id, qty);
        renderInventory(container);
      });
    } else if (action === 'delete') {
      openDeleteModal(product, () => {
        db.deleteProduct(id);
        renderInventory(container);
      });
    }
  });
}

function renderInventoryCard(product) {
  const margin = calculateMargin(product.price, product.costPrice);
  const isAdminUser = isAdmin();
  const stockProgress = getStockProgress(product.stock);
  const stockProgressClass = product.stock <= 0 ? 'stock-progress--empty' : product.stock <= 15 ? 'stock-progress--low' : '';

  return `
    <article class="inventory-card" data-id="${product.id}">
      <div class="inventory-card-header">
        <div class="inventory-card-title-row">
          <h3 class="inventory-card-title">${escapeHtml(product.name)}</h3>
          ${getStockBadge(product.stock)}
        </div>
        <span class="inventory-card-category">${escapeHtml(product.category || 'General')}${product.code ? ` · ${escapeHtml(product.code)}` : ''}</span>
      </div>
      <div class="inventory-card-body">
        <div class="inventory-stock-progress">
          <div class="inventory-stock-progress-bar ${stockProgressClass}" style="width: ${stockProgress}%"></div>
        </div>
        <div class="inventory-main-info">
          <span class="inventory-price">$${product.price.toFixed(2)}</span>
          <div class="inventory-stock-value-display">${product.stock} ${product.stock === 1 ? 'unidad' : 'unidades'}</div>
        </div>
        ${isAdminUser ? `
        <div class="inventory-financials">
          <div class="inventory-financial-item">
            <span>Costo</span>
            <span>$${(product.costPrice || 0).toFixed(2)}</span>
          </div>
          <div class="inventory-financial-item">
            <span>Utilidad</span>
            <span>$${margin.margin} (${margin.percent}%)</span>
          </div>
        </div>
        ` : ''}
      </div>
      <div class="inventory-card-actions">
        <button class="btn btn--amber" type="button" data-action="supply">+ Surtir</button>
        <button class="btn btn--secondary" type="button" data-action="edit">✏️ Editar</button>
        <button class="btn btn--danger btn--icon-only" type="button" data-action="delete" title="Eliminar">🗑️</button>
      </div>
    </article>
  `;
}


