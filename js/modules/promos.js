import { db } from '../db.js';

const SUPPLIERS = [
  'Tecate',
  'Corona',
  'Heineken',
  'Modelo',
  'Negra Modelo',
  'Pacífico',
  'Victoria',
  'Sol',
  'Constellation Brands',
  'AB InBev',
];

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

function isExpired(promo) {
  if (!promo.expiresAt) {
    return false;
  }
  const exp = new Date(`${promo.expiresAt}T23:59:59`);
  return !Number.isNaN(exp.getTime()) && exp < new Date();
}

function calcMargin(salePrice, cost) {
  const sale = Number(salePrice) || 0;
  const c = Number(cost) || 0;
  const margin = sale - c;
  const pct = sale > 0 ? (margin / sale) * 100 : 0;
  return { margin, pct };
}

function formatMoney(value) {
  const num = Number(value);
  return `$${(Number.isFinite(num) ? num : 0).toFixed(2)}`;
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function promoItemsLabel(promo, products) {
  if (!promo.items || promo.items.length === 0) {
    return 'Sin productos incluidos';
  }
  return promo.items
    .map((item) => {
      const product = products.find((p) => p.id === item.productId);
      return `${item.qty}× ${product ? product.name : item.productId}`;
    })
    .join(' + ');
}

function statusBadge(promo) {
  if (isExpired(promo)) {
    return '<span class="badge badge--expired">Vencida</span>';
  }
  return promo.active
    ? '<span class="badge badge--ok">Activa</span>'
    : '<span class="badge">Inactiva</span>';
}

function renderPromoCard(promo, products, expired = false) {
  const { margin, pct } = calcMargin(promo.salePrice, promo.cost);
  const marginClass = margin >= 0 ? 'margin--positive' : 'margin--negative';
  const expiry = promo.expiresAt
    ? `Vence: ${formatDate(promo.expiresAt)}`
    : 'Sin fecha de vencimiento';
  return `
    <li class="promo-offer ${expired ? 'promo-offer--expired' : ''}" data-id="${promo.id}">
      <div class="promo-offer-info">
        <div class="promo-offer-head">
          <strong class="promo-offer-name">${escapeHtml(promo.name)}</strong>
          <span class="badge badge--supplier">${escapeHtml(promo.supplier || '—')}</span>
          ${statusBadge(promo)}
        </div>
        <div class="promo-offer-items">${escapeHtml(promoItemsLabel(promo, products))}</div>
        <div class="promo-offer-financials">
          <span>PVP: <strong class="price">${formatMoney(promo.salePrice)}</strong></span>
          <span>Costo: ${formatMoney(promo.cost)}</span>
          <span class="promo-margin ${marginClass}">Margen: ${formatMoney(margin)} (${pct.toFixed(1)}%)</span>
        </div>
        <div class="muted promo-offer-expiry">${expiry}</div>
      </div>
      <div class="promo-offer-actions">
        ${expired
          ? ''
          : `<label class="switch" title="Activar / desactivar según temporada">
              <input type="checkbox" data-action="toggle" ${promo.active ? 'checked' : ''} aria-label="Activar o desactivar ${escapeHtml(promo.name)}">
              <span class="switch-slider"></span>
            </label>`}
        <button class="btn-icon" data-action="edit" title="Editar" type="button">✎</button>
        <button class="btn-icon btn-icon--danger" data-action="delete" title="Eliminar" type="button">✕</button>
      </div>
    </li>
  `;
}

function promoItemRow(products, productId = '', qty = 1) {
  return `
    <div class="promo-item-row">
      <select class="input" name="productId" required>
        <option value="">Seleccionar producto</option>
        ${products
          .map(
            (p) =>
              `<option value="${p.id}" ${p.id === productId ? 'selected' : ''}>${escapeHtml(p.name)} (${formatMoney(p.price)})</option>`,
          )
          .join('')}
      </select>
      <input class="input" name="qty" type="number" min="1" step="1" value="${qty}" required aria-label="Cantidad">
      <button class="btn-icon btn-icon--danger" data-action="remove-item" title="Quitar" type="button">✕</button>
    </div>
  `;
}

function openPromoModal(container, promoToEdit = null) {
  const products = db.getProducts();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="card promo-modal" role="dialog" aria-modal="true" aria-labelledby="promo-modal-title">
      <h3 class="form-title" id="promo-modal-title">${promoToEdit ? 'Editar Promoción' : 'Crear Nueva Promoción'}</h3>
      <form id="promo-modal-form" class="form" novalidate>
        <label class="field">
          <span>Nombre de la Promo</span>
          <input class="input" name="name" required maxlength="60" autocomplete="off" placeholder="ej. Caja Tecate + Six Pack Bonificado" value="${promoToEdit ? escapeHtml(promoToEdit.name) : ''}">
        </label>
        <label class="field">
          <span>Proveedor</span>
          <input class="input" name="supplier" required maxlength="40" list="promo-suppliers" autocomplete="off" placeholder="Tecate, Corona, Heineken..." value="${promoToEdit ? escapeHtml(promoToEdit.supplier || '') : ''}">
          <datalist id="promo-suppliers">
            ${SUPPLIERS.map((s) => `<option value="${s}">`).join('')}
          </datalist>
        </label>
        <fieldset class="field">
          <legend>Productos incluidos</legend>
          <div class="promo-modal-items" id="promo-modal-items">
            ${(promoToEdit && promoToEdit.items && promoToEdit.items.length
              ? promoToEdit.items
              : [{ productId: '', qty: 1 }]
            )
              .map((item) => promoItemRow(products, item.productId, item.qty))
              .join('')}
          </div>
          <button type="button" class="btn btn--secondary btn--sm btn--block" id="promo-add-item">+ Agregar producto</button>
        </fieldset>
        <div class="form-row">
          <label class="field">
            <span>Precio de Venta al Público ($)</span>
            <input class="input" name="salePrice" type="number" min="0.01" step="0.01" required value="${promoToEdit ? promoToEdit.salePrice : ''}">
          </label>
          <label class="field">
            <span>Costo Real al Proveedor ($)</span>
            <input class="input" name="cost" type="number" min="0" step="0.01" required value="${promoToEdit ? promoToEdit.cost : ''}">
          </label>
        </div>
        <div class="promo-margin-preview" id="promo-margin-preview">
          <span class="stat-label">Margen de Ganancia de la Promo</span>
          <strong id="promo-margin-value">—</strong>
        </div>
        <label class="field">
          <span>Fecha de Vencimiento</span>
          <input class="input" name="expiresAt" type="date" value="${promoToEdit && promoToEdit.expiresAt ? promoToEdit.expiresAt : ''}">
        </label>
        <div class="actions">
          <button type="button" class="btn btn--ghost" data-action="cancel">Cancelar</button>
          <button type="submit" class="btn">${promoToEdit ? 'Guardar Cambios' : 'Crear Promoción'}</button>
        </div>
      </form>
    </div>
  `;

  const form = overlay.querySelector('#promo-modal-form');
  const itemsContainer = overlay.querySelector('#promo-modal-items');
  const marginValue = overlay.querySelector('#promo-margin-value');

  function updateMarginPreview() {
    const { margin, pct } = calcMargin(form.salePrice.value, form.cost.value);
    const hasValues = form.salePrice.value !== '' || form.cost.value !== '';
    marginValue.textContent = hasValues
      ? `${formatMoney(margin)} (${pct.toFixed(1)}%)`
      : '—';
    marginValue.className = margin >= 0 ? 'margin--positive' : 'margin--negative';
  }

  form.salePrice.addEventListener('input', updateMarginPreview);
  form.cost.addEventListener('input', updateMarginPreview);
  updateMarginPreview();

  overlay.querySelector('#promo-add-item').addEventListener('click', () => {
    itemsContainer.insertAdjacentHTML('beforeend', promoItemRow(products));
  });

  itemsContainer.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="remove-item"]');
    if (!btn) {
      return;
    }
    const rows = itemsContainer.querySelectorAll('.promo-item-row');
    if (rows.length > 1) {
      btn.closest('.promo-item-row').remove();
    } else {
      const row = rows[0];
      row.querySelector('[name="productId"]').value = '';
      row.querySelector('[name="qty"]').value = 1;
    }
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-action="cancel"]')) {
      close();
    }
  });

  function close() {
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      close();
    }
  }

  document.addEventListener('keydown', onKeydown);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    const supplier = form.elements.supplier.value.trim();
    const items = [];
    itemsContainer.querySelectorAll('.promo-item-row').forEach((row) => {
      const productId = row.querySelector('[name="productId"]').value;
      const qty = Number(row.querySelector('[name="qty"]').value);
      if (productId && qty > 0) {
        items.push({ productId, qty });
      }
    });
    const salePrice = Number(form.salePrice.value);
    const cost = Number(form.cost.value);

    if (!name) {
      alert('Ingresa el nombre de la promoción.');
      return;
    }
    if (!supplier) {
      alert('Ingresa el proveedor de la promoción.');
      return;
    }
    if (items.length === 0) {
      alert('Agrega al menos un producto a la promoción.');
      return;
    }
    if (!salePrice || salePrice <= 0) {
      alert('Ingresa el Precio de Venta al Público.');
      return;
    }
    if (Number.isNaN(cost) || cost < 0) {
      alert('Ingresa el Costo Real pagado al proveedor.');
      return;
    }

    const promoData = {
      name,
      supplier,
      items,
      salePrice,
      cost,
      expiresAt: form.expiresAt.value || '',
      active: promoToEdit ? promoToEdit.active : true,
      type: 'combo',
      comboPrice: salePrice,
    };

    if (promoToEdit) {
      db.updatePromo(promoToEdit.id, promoData);
    } else {
      db.addPromo(promoData);
    }
    close();
    renderPromos(container);
  });

  document.body.appendChild(overlay);
  form.elements.name.focus();
}

export function renderPromos(container) {
  const promos = db.getPromos();
  const products = db.getProducts();
  const active = promos.filter((p) => p.active && !isExpired(p));
  const inactive = promos.filter((p) => !p.active && !isExpired(p));
  const expired = promos.filter((p) => isExpired(p));

  const marginables = [...active, ...inactive].filter((p) => Number(p.salePrice) > 0);
  const avgMargin = marginables.length
    ? `${(marginables.reduce((sum, p) => sum + calcMargin(p.salePrice, p.cost).pct, 0) / marginables.length).toFixed(1)}%`
    : '—';

  container.innerHTML = `
    <h2 class="view-title">Promociones</h2>
    <p class="muted view-subtitle">Panel de Control de Ofertas de Proveedor</p>
    <div class="grid stats">
      <div class="card stat-card">
        <span class="stat-value">${promos.length}</span>
        <span class="stat-label">Total de ofertas</span>
      </div>
      <div class="card stat-card">
        <span class="stat-value">${active.length}</span>
        <span class="stat-label">Activas</span>
      </div>
      <div class="card stat-card">
        <span class="stat-value">${expired.length}</span>
        <span class="stat-label">Vencidas</span>
      </div>
      <div class="card stat-card">
        <span class="stat-value">${avgMargin}</span>
        <span class="stat-label">Margen promedio</span>
      </div>
    </div>
    <div class="pos-header">
      <button class="btn btn--promo" id="create-promo" type="button">＋ Crear Nueva Promoción</button>
    </div>
    <h3 class="section-title">Ofertas de Proveedor</h3>
    <ul class="list promo-offer-list" id="promo-list">
      ${[...active, ...inactive].map((p) => renderPromoCard(p, products)).join('') ||
        '<li class="promo-empty">No hay promociones creadas. Usa "Crear Nueva Promoción" para agregar una oferta de proveedor.</li>'}
    </ul>
    ${expired.length
      ? `<h3 class="section-title">Promociones Vencidas</h3>
         <ul class="list promo-offer-list" id="promo-expired-list">
           ${expired.map((p) => renderPromoCard(p, products, true)).join('')}
         </ul>`
      : ''}
  `;

  container.querySelector('#create-promo').addEventListener('click', () => {
    openPromoModal(container);
  });

  container.querySelectorAll('.promo-offer-list').forEach((list) => {
    list.addEventListener('change', (event) => {
      const input = event.target.closest('input[data-action="toggle"]');
      if (!input) {
        return;
      }
      const id = input.closest('.promo-offer').dataset.id;
      db.togglePromo(id);
      renderPromos(container);
    });

    list.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) {
        return;
      }
      const id = btn.closest('.promo-offer').dataset.id;
      const promo = db.getPromos().find((p) => p.id === id);
      if (!promo) {
        return;
      }
      if (btn.dataset.action === 'edit') {
        openPromoModal(container, promo);
      } else if (btn.dataset.action === 'delete') {
        if (confirm(`¿Eliminar la promoción "${promo.name}"?`)) {
          db.deletePromo(id);
          renderPromos(container);
        }
      }
    });
  });
}