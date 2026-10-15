import { db } from '../db.js';
import { isAdmin } from '../auth.js';

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
     <div class="card" style="width: 100%; max-width: 480px; max-height: 80vh; display: flex; flex-direction: column;">
       <h3>Editar Producto</h3>
       <div style="overflow-y: auto; flex: 1 1 auto;">
         <form id="edit-form" class="form">
           <label class="field">
             <span>Nombre</span>
             <input class="input" name="name" required maxlength="60" value="${escapeHtml(product.name)}">
           </label>
           <label class="field">
             <span>Código</span>
             <input class="input" name="code" maxlength="30" value="${escapeHtml(product.code || '')}">
           </label>
           <label class="field">
             <span>Marca</span>
             <input class="input" name="brand" maxlength="40" value="${escapeHtml(product.brand || '')}" list="brand-suggestions">
             <datalist id="brand-suggestions">
               <option value="Corona">
               <option value="Modelo">
               <option value="Tecate">
               <option value="Indio">
               <option value="Victoria">
               <option value="Pacífico">
               <option value="Minerva">
               <option value="Calavera">
               <option value="Heineken">
               <option value="Dos Equis">
             </datalist>
           </label>
           <label class="field">
             <span>Presentación / Empaque</span>
             <input class="input" name="packaging" maxlength="40" required value="${escapeHtml(product.packaging || '')}" list="packaging-suggestions">
             <datalist id="packaging-suggestions">
               <option value="Caguama 1L (Pieza)">
               <option value="Caja completa de caguama">
               <option value="Six-pack">
               <option value="Lata (Pieza)">
               <option value="Media / Caguamita (Pieza)">
               <option value="Botella (Pieza)">
               <option value="Botella 350ml">
               <option value="Latón 1L">
             </datalist>
           </label>
           <label class="field">
             <span>Categoría</span>
             <input class="input" name="category" maxlength="30" value="${escapeHtml(product.category || 'General')}">
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
           <fieldset class="field">
             <legend>🧊 Bebida Fría / En Refrigerador</legend>
             <label class="switch">
               <input type="checkbox" name="isCold" ${product.isCold ? 'checked' : ''}>
               <span class="switch-slider"></span>
             </label>
           </fieldset>
           <label class="field" id="max-fridge-field" style="${product.isCold ? '' : 'display: none;'}">
             <span>Capacidad Máxima en Refrigerador</span>
             <input class="input" name="maxFridgeCapacity" type="number" min="0" step="1" value="${product.maxFridgeCapacity || 0}" placeholder="Ej. 24 (opcional)">
           </label>
         </form>
       </div>
       <div class="actions">
         <button type="button" class="btn btn--ghost" data-action="cancel">Cancelar</button>
         <button type="submit" class="btn">Guardar</button>
       </div>
     </div>
   `;

  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cancel"]')) {
      overlay.remove();
    }
  });

  // Toggle max fridge capacity field visibility
  const isColdCheckbox = overlay.querySelector('input[name="isCold"]');
  const maxFridgeField = overlay.querySelector('#max-fridge-field');
  isColdCheckbox.addEventListener('change', () => {
    maxFridgeField.style.display = isColdCheckbox.checked ? '' : 'none';
  });

  overlay.querySelector('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    onSave({
      name: form.name.value.trim(),
      code: form.code.value.trim(),
      brand: form.brand.value.trim(),
      packaging: form.packaging.value.trim(),
      category: form.category.value.trim() || 'General',
      price: Number(form.price.value),
      costPrice: Number(form.costPrice.value) || 0,
      stock: Number(form.stock.value),
      isCold: form.isCold.checked,
      maxFridgeCapacity: form.isCold.checked ? (Number(form.maxFridgeCapacity.value) || 0) : 0,
    });
    overlay.remove();
  });

  document.body.appendChild(overlay);
}

function openNewProductModal(onSave) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
overlay.innerHTML = `
     <div class="card" style="width: 100%; max-width: 480px; max-height: 80vh; display: flex; flex-direction: column;">
       <h3>+ Nuevo Producto</h3>
       <div style="overflow-y: auto; flex: 1 1 auto;">
         <form id="new-product-form" class="form">
           <label class="field">
             <span>Nombre</span>
             <input class="input" name="name" required maxlength="60" placeholder="Ej. Cerveza Artesanal" autofocus>
           </label>
           <label class="field">
             <span>Código</span>
             <input class="input" name="code" maxlength="30" placeholder="Ej. 750123456789">
           </label>
           <label class="field">
             <span>Marca</span>
             <input class="input" name="brand" maxlength="40" placeholder="Ej. Corona, Modelo, Tecate" list="brand-suggestions">
             <datalist id="brand-suggestions">
               <option value="Corona">
               <option value="Modelo">
               <option value="Tecate">
               <option value="Indio">
               <option value="Victoria">
               <option value="Pacífico">
               <option value="Minerva">
               <option value="Calavera">
               <option value="Heineken">
               <option value="Dos Equis">
             </datalist>
           </label>
           <label class="field">
             <span>Presentación / Empaque</span>
             <input class="input" name="packaging" maxlength="40" required placeholder="Ej. Caguama 1L (Pieza)" list="packaging-suggestions">
             <datalist id="packaging-suggestions">
               <option value="Caguama 1L (Pieza)">
               <option value="Caja completa de caguama">
               <option value="Six-pack">
               <option value="Lata (Pieza)">
               <option value="Media / Caguamita (Pieza)">
               <option value="Botella (Pieza)">
               <option value="Botella 350ml">
               <option value="Latón 1L">
             </datalist>
           </label>
           <label class="field">
             <span>Categoría</span>
             <input class="input" name="category" maxlength="30" placeholder="General" value="General">
           </label>
           <div class="form-row">
             <label class="field">
               <span>Precio de Venta</span>
               <input class="input" name="price" type="number" min="0" step="0.01" required placeholder="0.00">
             </label>
             <label class="field">
               <span>Costo de Compra</span>
               <input class="input" name="costPrice" type="number" min="0" step="0.01" value="0" placeholder="0.00">
             </label>
           </div>
           <label class="field">
             <span>Stock Inicial</span>
             <input class="input" name="stock" type="number" min="0" step="1" required value="0" placeholder="0">
           </label>
           <fieldset class="field">
             <legend>🧊 Bebida Fría / En Refrigerador</legend>
             <label class="switch">
               <input type="checkbox" name="isCold">
               <span class="switch-slider"></span>
             </label>
           </fieldset>
           <label class="field" id="max-fridge-field" style="display: none;">
             <span>Capacidad Máxima en Refrigerador</span>
             <input class="input" name="maxFridgeCapacity" type="number" min="0" step="1" placeholder="Ej. 24 (opcional)">
           </label>
         </form>
       </div>
       <div class="actions">
         <button type="button" class="btn btn--ghost" data-action="cancel">Cancelar</button>
         <button type="submit" class="btn">Agregar</button>
       </div>
     </div>
   `;

  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cancel"]')) {
      overlay.remove();
    }
  });

  // Toggle max fridge capacity field visibility
  const isColdCheckbox = overlay.querySelector('input[name="isCold"]');
  const maxFridgeField = overlay.querySelector('#max-fridge-field');
  isColdCheckbox.addEventListener('change', () => {
    maxFridgeField.style.display = isColdCheckbox.checked ? '' : 'none';
  });

  overlay.querySelector('#new-product-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    onSave({
      name: form.name.value.trim(),
      code: form.code.value.trim(),
      brand: form.brand.value.trim(),
      packaging: form.packaging.value.trim(),
      category: form.category.value.trim() || 'General',
      price: Number(form.price.value),
      costPrice: Number(form.costPrice.value) || 0,
      stock: Number(form.stock.value),
      isCold: form.isCold.checked,
      maxFridgeCapacity: form.isCold.checked ? (Number(form.maxFridgeCapacity.value) || 0) : 0,
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
      <h3>+ Surtir - ${escapeHtml(product.name)}</h3>
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

function getColdProducts(products) {
  return products.filter(p => p.isCold === true && p.maxFridgeCapacity > 0);
}

function categorizeByCompartment(product) {
  const packaging = (product.packaging || '').toLowerCase();
  if (packaging.includes('lata') || packaging.includes('latón')) {
    return 'top';
  }
  if (packaging.includes('six-pack') || packaging.includes('six pack')) {
    return 'middle';
  }
  return 'bottom';
}

function renderFridgeSlot(product) {
  const missing = Math.max(0, product.maxFridgeCapacity - product.fridgeStock);
  const isAlert = missing > 0;
  const slotClass = isAlert ? 'fridge-slot--alert' : 'fridge-slot--ok';
  const label = isAlert
    ? (product.fridgeStock === 0 ? '¡PEDIR RELLENO!' : '¡BAJO STOCK!')
    : '';
  const hasWarehouseStock = product.stock > 0;

  return `
    <div class="fridge-slot ${slotClass}" data-id="${product.id}">
      <div class="fridge-slot-name">${escapeHtml(product.name)}</div>
      <div class="fridge-slot-capacity">
        <span>${product.fridgeStock} / ${product.maxFridgeCapacity}</span>
        <span class="fridge-slot-remaining ${isAlert ? 'fridge-slot-remaining--alert' : ''}">
          ${missing} ${missing === 1 ? 'falta' : 'faltan'}
        </span>
      </div>
      ${label ? `<div class="fridge-slot-label">${label}</div>` : ''}
      ${isAlert && hasWarehouseStock ? `
        <div class="fridge-slot-actions">
          <button class="btn btn--sm btn--secondary" data-action="fill-fridge" type="button">Surttir</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderFridgeSection(products) {
  const coldProducts = getColdProducts(products);
  if (coldProducts.length === 0) {
    return '';
  }

  const compartments = { top: [], middle: [], bottom: [] };
  coldProducts.forEach((product) => {
    compartments[categorizeByCompartment(product)].push(product);
  });

  const compartmentLabels = {
    top: 'Latas',
    middle: 'Six-Packs',
    bottom: 'Caguamas / Botellas',
  };

  const compartmentOrder = ['top', 'middle', 'bottom'];

  let html = `
    <div class="fridge-diagram">
      <div class="fridge-compartment-header">
        <h3 class="fridge-diagram-title">🧊 Refrigerador</h3>
      </div>
  `;

  compartmentOrder.forEach((comp, index) => {
    if (compartments[comp].length === 0) return;
    html += `
      ${index > 0 ? '<div class="fridge-compartment-divider"></div>' : ''}
      <div class="fridge-compartment fridge-compartment--${comp}">
        <div class="fridge-compartment-title">${compartmentLabels[comp]}</div>
        <div class="fridge-compartment-grid" data-compartment="${comp}">
          ${compartments[comp].map((product) => renderFridgeSlot(product)).join('')}
        </div>
      </div>
    `;
  });

  html += `</div>`;
  return html;
}

function renderInventoryCard(product) {
  const margin = calculateMargin(product.price, product.costPrice);
  const isAdminUser = isAdmin();
  const stockProgress = getStockProgress(product.stock);
  const stockProgressClass = product.stock <= 0 ? 'stock-progress--empty' : product.stock <= 15 ? 'stock-progress--low' : '';
  const isColdProduct = product.isCold === true;
  const coldClass = isColdProduct ? 'inventory-card--cold' : '';
  const coldBadge = isColdProduct ? '<span class="badge badge--cold" title="Bebida Fría / En Refrigerador">❄️ Fría</span>' : '';
  const fridgeMissing = isColdProduct ? Math.max(0, product.maxFridgeCapacity - product.fridgeStock) : 0;
  const fridgeStatus = isColdProduct
    ? fridgeMissing > 0
      ? `<div class="inventory-fridge-status low">Faltan ${fridgeMissing} ${fridgeMissing === 1 ? 'pieza' : 'piezas'} para llenar el refri</div>`
      : `<div class="inventory-fridge-status">Refri lleno</div>`
    : '';

  return `
    <article class="inventory-card ${coldClass}" data-id="${product.id}">
      <div class="inventory-card-header">
        <div class="inventory-card-title-row">
          <h3 class="inventory-card-title">${escapeHtml(product.name)}</h3>
          <div style="display: flex; gap: var(--spacing-xs); align-items: center;">
            ${coldBadge}
            ${getStockBadge(product.stock)}
          </div>
        </div>
        <span class="inventory-card-category">${escapeHtml(product.category || 'General')}${product.code ? ` · ${escapeHtml(product.code)}` : ''}${product.brand ? ` · ${escapeHtml(product.brand)}` : ''}${product.packaging ? ` · ${escapeHtml(product.packaging)}` : ''}</span>
      </div>
      <div class="inventory-card-body">
        <div class="inventory-stock-progress">
          <div class="inventory-stock-progress-bar ${stockProgressClass}" style="width: ${stockProgress}%"></div>
        </div>
        <div class="inventory-main-info">
          <span class="inventory-price">$${product.price.toFixed(2)}</span>
          <div class="inventory-stock-value-display">${product.stock} ${product.stock === 1 ? 'unidad' : 'unidades'}</div>
        </div>
        ${fridgeStatus}
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

export function renderInventory(container) {
  const products = db.getProducts();

   container.innerHTML = `
     <div class="inventory-header">
       <h2 class="view-title">Inventario</h2>
       <div class="inventory-header-actions">
         <input type="search" class="input inventory-search" id="inventory-search" placeholder="Buscar productos..." aria-label="Buscar productos">
         <button class="btn btn--primary" id="btn-new-product">+ Nuevo Producto</button>
       </div>
     </div>
     ${renderFridgeSection(products)}
     <div class="inventory-grid" id="inventory-grid">
       ${products.map((product) => renderInventoryCard(product)).join('')}
     </div>
   `;

  container.querySelector('#btn-new-product').addEventListener('click', () => {
    openNewProductModal((data) => {
      db.addProduct(data);
      renderInventory(container);
    });
  });

  const searchInput = container.querySelector('#inventory-search');
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const cards = container.querySelectorAll('.inventory-card');
    cards.forEach((card) => {
      const name = card.querySelector('.inventory-card-title').textContent.toLowerCase();
      const category = card.querySelector('.inventory-card-category').textContent.toLowerCase();
      const matches = name.includes(query) || category.includes(query);
      card.style.display = matches ? '' : 'none';
    });
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

   const fridgeDiagram = container.querySelector('.fridge-diagram');
   if (fridgeDiagram) {
     fridgeDiagram.addEventListener('click', (event) => {
       const btn = event.target.closest('button[data-action="fill-fridge"]');
       if (!btn) return;
       const slot = btn.closest('.fridge-slot');
       const id = slot.dataset.id;
       db.fillFridge(id);
       renderInventory(container);
     });
   }
 }