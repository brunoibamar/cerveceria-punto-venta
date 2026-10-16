import { db } from '../db.js';

export function render(container) {
  const promos = db.getPromos();
  const products = db.getProducts();
  container.innerHTML = `
    <h2 class="view-title">Promociones</h2>
    <form class="card form" id="promo-form">
      <h3 class="form-title">Nueva promoción</h3>
      <label class="field">
        <span>Nombre</span>
        <input class="input" name="name" required maxlength="60" autocomplete="off">
      </label>
      <label class="field">
        <span>Tipo</span>
        <select class="input" name="type" id="promo-type">
          <option value="discount">Descuento porcentual</option>
          <option value="combo">Combo (precio fijo)</option>
        </select>
      </label>
      <div id="discount-fields" class="promo-fields">
        <label class="field">
          <span>Descuento (%)</span>
          <input class="input" name="discount" type="number" min="1" max="100" required>
        </label>
      </div>
      <div id="combo-fields" class="promo-fields" style="display: none;">
        <label class="field">
          <span>Precio del combo ($)</span>
          <input class="input" name="comboPrice" type="number" min="1" step="0.01" required>
        </label>
        <fieldset class="field">
          <legend>Productos del combo</legend>
          <div id="combo-items" class="combo-items"></div>
          <button type="button" class="btn btn--secondary btn--block" id="add-combo-item">+ Agregar producto</button>
        </fieldset>
      </div>
      <button class="btn btn--block" type="submit">Crear</button>
    </form>
    <ul class="list" id="promo-list">
      ${promos
        .map(
          (p) => `
        <li class="list-item" data-id="${p.id}">
          <div>
            <strong>${p.name}</strong>
            <div class="muted">
              ${p.type === 'discount' ? `${p.discount}% de descuento` : `Combo: $${p.comboPrice.toFixed(2)}`}
              ${p.type === 'combo' && p.items ? ` (${p.items.map(i => `${i.qty}×${products.find(pr => pr.id === i.productId)?.name || i.productId}`).join(', ')})` : ''}
            </div>
          </div>
          <div class="actions">
            <span class="badge ${p.active ? 'badge--ok' : ''}">${p.active ? 'Activa' : 'Inactiva'}</span>
            <button class="btn-icon" data-action="toggle" title="Activar o desactivar">⇄</button>
            <button class="btn-icon btn-icon--danger" data-action="delete" title="Eliminar">✕</button>
          </div>
        </li>
      `,
        )
        .join('')}
    </ul>
  `;

  const typeSelect = container.querySelector('#promo-type');
  const discountFields = container.querySelector('#discount-fields');
  const comboFields = container.querySelector('#combo-fields');
  const comboItemsContainer = container.querySelector('#combo-items');
  const addComboItemBtn = container.querySelector('#add-combo-item');

  function updateFormFields() {
    if (typeSelect.value === 'discount') {
      discountFields.style.display = '';
      comboFields.style.display = 'none';
    } else {
      discountFields.style.display = 'none';
      comboFields.style.display = '';
      renderComboItems();
    }
  }

  function renderComboItems() {
    const form = container.querySelector('#promo-form');
    const existingItems = Array.from(form.querySelectorAll('.combo-item-row')).map(row => ({
      productId: row.dataset.productId,
      qty: Number(row.querySelector('[name="qty"]').value)
    }));
    comboItemsContainer.innerHTML = existingItems.length
      ? existingItems.map((item, idx) => createComboItemRow(item.productId, item.qty, idx)).join('')
      : createComboItemRow('', 1, 0);
    attachComboItemListeners();
  }

  function createComboItemRow(productId = '', qty = 1, index = 0) {
    return `
      <div class="combo-item-row" data-product-id="${productId}" data-index="${index}" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; align-items: stretch;">
        <select class="input" name="productId" style="width: 100%;" required>
          <option value="">Seleccionar producto</option>
          ${products.map(p => `<option value="${p.id}" ${p.id === productId ? 'selected' : ''}>${p.name} ($${p.price.toFixed(2)})</option>`).join('')}
        </select>
        <input class="input" name="qty" type="number" min="1" value="${qty}" style="width: 100%;" required>
        <button type="button" class="btn-icon btn-icon--danger" data-action="remove-combo-item" title="Quitar">✕</button>
      </div>
    `;
  }

  function attachComboItemListeners() {
    comboItemsContainer.querySelectorAll('[data-action="remove-combo-item"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.combo-item-row');
        const rows = comboItemsContainer.querySelectorAll('.combo-item-row');
        if (rows.length > 1) {
          row.remove();
        } else {
          row.querySelector('[name="productId"]').value = '';
          row.querySelector('[name="qty"]').value = 1;
        }
      });
    });
    comboItemsContainer.querySelectorAll('[name="productId"]').forEach(select => {
      select.addEventListener('change', () => {
        const row = select.closest('.combo-item-row');
        row.dataset.productId = select.value;
      });
    });
  }

  typeSelect.addEventListener('change', updateFormFields);
  addComboItemBtn.addEventListener('click', () => {
    const idx = comboItemsContainer.querySelectorAll('.combo-item-row').length;
    comboItemsContainer.insertAdjacentHTML('beforeend', createComboItemRow('', 1, idx));
    attachComboItemListeners();
  });

  updateFormFields();

  container.querySelector('#promo-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const type = formData.get('type');
    const promoData = {
      name: formData.get('name').trim(),
      type,
      active: true,
    };

    if (type === 'discount') {
      promoData.discount = Number(formData.get('discount'));
    } else {
      promoData.comboPrice = Number(formData.get('comboPrice'));
      const items = [];
      form.querySelectorAll('.combo-item-row').forEach(row => {
        const productId = row.querySelector('[name="productId"]').value;
        const qty = Number(row.querySelector('[name="qty"]').value);
        if (productId && qty > 0) {
          items.push({ productId, qty });
        }
      });
      promoData.items = items;
    }

    db.addPromo(promoData);
    form.reset();
    updateFormFields();
    render(container);
  });

  container.querySelector('#promo-list').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) {
      return;
    }
    const id = btn.closest('.list-item').dataset.id;
    if (btn.dataset.action === 'toggle') {
      db.togglePromo(id);
    } else if (btn.dataset.action === 'delete') {
      db.deletePromo(id);
    }
    render(container);
  });
}