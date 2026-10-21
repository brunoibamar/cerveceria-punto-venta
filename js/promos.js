// Gestión de promociones: tarjetas interactivas + modal de acciones + editor de combos
// La tarjeta no muestra botones: todo el bloque es pulsable y abre un modal
// minimalista con las acciones Editar / Eliminar.
// Los combos se arman seleccionando productos del inventario y la cantidad de piezas de cada uno.

const PromosManager = {
  containerId: 'promos-list',
  editingId: null,
  editingPromo: null,
  draftItems: [],
  pickerSearch: '',
  escapeHandler: null,

  init(containerId) {
    this.containerId = containerId || this.containerId;
    this.render();
  },

  // ---------- Utilidades ----------

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  getCurrencySymbol() {
    try {
      const settings = Database.getSettings() || {};
      return settings.currencySymbol || '$';
    } catch (e) {
      return '$';
    }
  },

  getProducts() {
    try {
      return Database.getProducts() || [];
    } catch (e) {
      return [];
    }
  },

  getProductById(id) {
    if (!id) return null;
    return this.getProducts().find(p => p.id === id) || null;
  },

  getPromos() {
    try {
      return Database.getPromos() || [];
    } catch (e) {
      return [];
    }
  },

  getActivePromos() {
    const today = new Date().toISOString().slice(0, 10);
    return this.getPromos().filter(promo => {
      if (!promo || promo.activo === false) return false;
      if (promo.startDate && today < promo.startDate) return false;
      if (promo.endDate && today > promo.endDate) return false;
      return true;
    });
  },

  getComboItems(promo) {
    if (!promo) return [];
    const raw = Array.isArray(promo.items) ? promo.items : (Array.isArray(promo.combo) ? promo.combo : []);
    const items = [];

    raw.forEach(entry => {
      if (!entry) return;
      const productId = entry.productId || entry.id || entry.productoId;
      if (!productId) return;

      const rawQty = Number(entry.cantidad !== undefined ? entry.cantidad : entry.quantity);
      if (!Number.isFinite(rawQty) || rawQty <= 0) return;

      items.push({
        productId: productId,
        cantidad: Math.max(1, Math.round(rawQty))
      });
    });

    return items;
  },

  getComboDetail(promo) {
    return this.getComboItems(promo).map(item => {
      const product = this.getProductById(item.productId);
      return {
        productId: item.productId,
        cantidad: item.cantidad,
        nombre: product ? (product.nombre || item.productId) : (item.nombre || item.productId),
        precio: product ? (Number(product.precio) || 0) : (Number(item.precio) || 0)
      };
    });
  },

  buildItemsText(detail) {
    return (detail || []).map(item => item.cantidad + 'x ' + item.nombre).join(' + ');
  },

  getTipoLabel(tipo) {
    switch (tipo) {
      case 'porcentaje': return 'Porcentaje';
      case 'monto': return 'Monto fijo';
      case 'volumen': return 'Por volumen';
      case 'happy_hour': return 'Happy Hour';
      default: return tipo || '-';
    }
  },

  getTipoOptions() {
    return [
      { value: 'porcentaje', label: 'Porcentaje' },
      { value: 'monto', label: 'Monto fijo' },
      { value: 'volumen', label: 'Por volumen' },
      { value: 'happy_hour', label: 'Happy Hour' }
    ];
  },

  formatPromoValue(promo) {
    const valor = Number(promo.valor) || 0;
    const currency = this.getCurrencySymbol();

    if (promo.tipo === 'monto') return currency + valor.toFixed(2) + ' de descuento';
    if (promo.tipo === 'volumen') {
      const pieces = this.getComboItems(promo).reduce((sum, item) => sum + item.cantidad, 0);
      const min = pieces || (Number(promo.cantidad) || 3);
      return min + '+ piezas = ' + valor + '% de descuento';
    }
    if (promo.tipo === 'happy_hour') return valor + '% de descuento (Happy Hour)';
    return valor + '% de descuento';
  },

  // ---------- Tarjetas ----------

  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const promos = this.getPromos();

    let html = '<div class="promos-header"><h2>Promociones</h2><button class="promo-add-btn" id="promo-add-btn" type="button" title="Nueva Promoción"><span class="promo-add-icon">+</span><span class="promo-add-text">Nueva Promoción</span></button></div>';
    html += '<div class="promos-grid">';

    if (promos.length === 0) {
      html += '<div class="empty-state">No hay promociones registradas.</div>';
    } else {
      promos.forEach(promo => {
        html += this.buildCardHtml(promo);
      });
    }

    html += '</div>';

    container.innerHTML = html;
    this.bindCards();

    const btn = document.getElementById('promo-add-btn');
    if (btn) btn.addEventListener('click', () => this.openModal());
  },

  // Tarjeta sin botones visibles: toda la superficie es un disparador.
  buildCardHtml(promo) {
    const detail = this.getComboDetail(promo);

    let incluyeHtml;
    if (detail.length) {
      incluyeHtml = '<ul class="promo-card-items">' + detail.map(item =>
        '<li><span class="promo-card-qty">' + item.cantidad + 'x</span> ' + this.escapeHtml(item.nombre) + '</li>'
      ).join('') + '</ul>';
    } else {
      incluyeHtml = '<div class="promo-card-row">' + this.escapeHtml(promo.incluye || '-') + '</div>';
    }

    const etiqueta = 'Promoción ' + (promo.nombre || 'sin nombre') + '. Toca para ver las opciones.';

    return `
          <div class="promo-card" data-id="${this.escapeHtml(promo.id)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${this.escapeHtml(etiqueta)}">
            <div class="promo-card-header">
              <div class="promo-card-title">${this.escapeHtml(promo.nombre || '')}</div>
              <div class="promo-card-meta">
                <div class="promo-card-badge">${this.escapeHtml(this.getTipoLabel(promo.tipo))}</div>
                <span class="promo-card-hint" aria-hidden="true">&#8942;</span>
              </div>
            </div>
            <div class="promo-card-section">
              <div class="promo-card-label">Incluye</div>
              ${incluyeHtml}
            </div>
            <div class="promo-card-divider"></div>
            <div class="promo-card-details">
              <div class="promo-card-row"><span>Descuento</span><span class="promo-card-value">${this.escapeHtml(this.formatPromoValue(promo))}</span></div>
              <div class="promo-card-row"><span>Vigencia</span><span class="promo-card-value">${this.escapeHtml(promo.duracion || '-')}</span></div>
            </div>
          </div>
        `;
  },

  bindCards() {
    document.querySelectorAll('.promo-card').forEach(card => {
      card.addEventListener('click', () => this.openCardMenu(card.dataset.id));
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          this.openCardMenu(card.dataset.id);
        }
      });
    });
  },

  // ---------- Modal de acciones (menú contextual) ----------

  openCardMenu(id) {
    const promo = this.getPromos().find(p => p.id === id);
    if (!promo) return;

    this.closeCardMenu();

    const detail = this.getComboDetail(promo);
    const incluyeHtml = detail.length
      ? '<ul class="promo-card-items">' + detail.map(item =>
        '<li><span class="promo-card-qty">' + item.cantidad + 'x</span> ' + this.escapeHtml(item.nombre) + '</li>'
      ).join('') + '</ul>'
      : '<p class="promo-menu-text">' + this.escapeHtml(promo.incluye || 'Sin detalle de productos') + '</p>';

    const menu = document.createElement('div');
    menu.id = 'promo-menu';
    menu.className = 'promo-modal is-open';
    menu.setAttribute('aria-hidden', 'false');
    menu.innerHTML = `
      <div class="promo-modal-backdrop" data-promo-close="1"></div>
      <div class="promo-modal-shell promo-modal-shell-sm" role="dialog" aria-modal="true" aria-labelledby="promo-menu-title">
        <header class="promo-modal-header">
          <div class="promo-modal-heading">
            <span class="promo-modal-badge" aria-hidden="true">&#127873;</span>
            <div class="promo-modal-heading-text">
              <h3 id="promo-menu-title">${this.escapeHtml(promo.nombre || 'Promoción')}</h3>
              <span class="promo-modal-sub">${this.escapeHtml(this.getTipoLabel(promo.tipo))}</span>
            </div>
          </div>
          <button type="button" class="promo-modal-close" data-promo-close="1" aria-label="Cerrar">&#10005;</button>
        </header>
        <div class="promo-modal-body">
          <div class="promo-menu-summary">
            <div class="promo-menu-block">
              <span class="promo-card-label">Incluye</span>
              ${incluyeHtml}
            </div>
            <div class="promo-menu-block">
              <div class="promo-card-row"><span>Descuento</span><span class="promo-card-value">${this.escapeHtml(this.formatPromoValue(promo))}</span></div>
              <div class="promo-card-row"><span>Vigencia</span><span class="promo-card-value">${this.escapeHtml(promo.duracion || '-')}</span></div>
            </div>
          </div>
          <div class="promo-modal-actions" id="promo-menu-actions">
            <button type="button" class="promo-btn primary" id="promo-edit"><span class="promo-btn-icon" aria-hidden="true">&#9998;</span><span>Editar</span></button>
            <button type="button" class="promo-btn danger" id="promo-delete"><span class="promo-btn-icon" aria-hidden="true">&#128465;</span><span>Eliminar</span></button>
          </div>
          <div class="promo-menu-confirm" id="promo-menu-confirm" hidden>
            <p class="promo-menu-confirm-text">&#191;Eliminar <strong>${this.escapeHtml(promo.nombre || 'esta promoción')}</strong>? Esta acción no se puede deshacer.</p>
            <div class="promo-modal-actions">
              <button type="button" class="promo-btn secondary" id="promo-delete-cancel">Cancelar</button>
              <button type="button" class="promo-btn danger solid" id="promo-delete-confirm">Sí, eliminar</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(menu);
    document.body.classList.add('promo-modal-open');
    this.bindEscape();

    menu.querySelectorAll('[data-promo-close]').forEach(el => el.addEventListener('click', () => this.closeCardMenu()));

    const editBtn = menu.querySelector('#promo-edit');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        this.closeCardMenu();
        this.openModal(promo);
      });
    }

    const actions = menu.querySelector('#promo-menu-actions');
    const confirmBox = menu.querySelector('#promo-menu-confirm');
    const deleteBtn = menu.querySelector('#promo-delete');
    const cancelBtn = menu.querySelector('#promo-delete-cancel');
    const confirmBtn = menu.querySelector('#promo-delete-confirm');

    if (deleteBtn && actions && confirmBox) {
      deleteBtn.addEventListener('click', () => {
        actions.hidden = true;
        confirmBox.hidden = false;
        if (confirmBtn) confirmBtn.focus();
      });
    }

    if (cancelBtn && actions && confirmBox) {
      cancelBtn.addEventListener('click', () => {
        confirmBox.hidden = true;
        actions.hidden = false;
        if (deleteBtn) deleteBtn.focus();
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const promos = this.getPromos().filter(p => p.id !== id);
        try {
          Database.savePromos(promos);
        } catch (e) {
          console.error('No se pudo eliminar la promoción:', e);
        }
        this.closeCardMenu();
        this.render();
      });
    }
  },

  closeCardMenu() {
    const existing = document.getElementById('promo-menu');
    if (existing) existing.remove();
    if (!document.getElementById('promo-modal')) {
      document.body.classList.remove('promo-modal-open');
    }
    this.unbindEscape();
  },

  // ---------- Modal de edición ----------

  openModal(promo = null) {
    this.editingId = promo ? promo.id : null;
    this.editingPromo = promo || null;
    this.pickerSearch = '';
    this.draftItems = promo ? this.getComboItems(promo) : [];

    const existing = document.getElementById('promo-modal');
    if (existing) existing.remove();

    const tipoSeleccionado = promo && promo.tipo ? promo.tipo : 'porcentaje';
    const valorActual = promo && promo.valor !== undefined && promo.valor !== null ? promo.valor : '';

    const modal = document.createElement('div');
    modal.id = 'promo-modal';
    modal.className = 'promo-modal is-open';
    modal.setAttribute('aria-hidden', 'false');
    modal.innerHTML = `
      <div class="promo-modal-backdrop" data-promo-close="1"></div>
      <div class="promo-modal-shell promo-modal-shell-wide" role="dialog" aria-modal="true" aria-labelledby="promo-modal-title">
        <header class="promo-modal-header">
          <div class="promo-modal-heading">
            <span class="promo-modal-badge" aria-hidden="true">&#127873;</span>
            <div class="promo-modal-heading-text">
              <h3 id="promo-modal-title">${promo ? 'Editar Promoción' : 'Nueva Promoción'}</h3>
              <span class="promo-modal-sub">${promo ? 'Ajusta los datos de la promoción' : 'Define el descuento y sus productos'}</span>
            </div>
          </div>
          <button type="button" class="promo-modal-close" data-promo-close="1" aria-label="Cerrar">&#10005;</button>
        </header>
        <form id="promo-form" class="promo-form" autocomplete="off">
          <div class="promo-form-grid">
            <div class="promo-field promo-field-full">
              <label for="promo-nombre">Nombre de la promoción</label>
              <input id="promo-nombre" name="nombre" type="text" placeholder="Ej. Combo IPA + Papas" value="${this.escapeHtml(promo ? promo.nombre || '' : '')}" required>
            </div>
            <div class="promo-field">
              <label for="promo-tipo">Tipo de descuento</label>
              <select id="promo-tipo" name="tipo">
                ${this.getTipoOptions().map(tipo => '<option value="' + tipo.value + '"' + (tipo.value === tipoSeleccionado ? ' selected' : '') + '>' + tipo.label + '</option>').join('')}
              </select>
            </div>
            <div class="promo-field">
              <label for="promo-valor">Valor del descuento</label>
              <input id="promo-valor" name="valor" type="number" min="0" step="0.01" inputmode="decimal" placeholder="15" value="${this.escapeHtml(valorActual)}">
            </div>
            <div class="promo-field">
              <label for="promo-start-date">Fecha de inicio</label>
              <input id="promo-start-date" name="startDate" type="date" value="${this.escapeHtml(promo ? promo.startDate || '' : '')}">
            </div>
            <div class="promo-field">
              <label for="promo-end-date">Fecha de fin</label>
              <input id="promo-end-date" name="endDate" type="date" value="${this.escapeHtml(promo ? promo.endDate || '' : '')}">
            </div>
            <div class="promo-field">
              <label for="promo-incluye">DESCRIPCIÓN / NOTA DE LA PROMOCIÓN</label>
              <input id="promo-incluye" name="incluye" type="text" placeholder="Ej. 2 cervezas + 1 papas" value="${this.escapeHtml(promo ? promo.incluye || '' : '')}">
            </div>
            <div class="promo-field promo-field-full">
              <label>Productos del combo</label>
              <div class="promo-combo" id="promo-combo-box"></div>
              <button type="button" class="promo-btn ghost" id="promo-picker-toggle"><span class="promo-btn-icon" aria-hidden="true">+</span><span>Agregar producto del inventario</span></button>
              <div id="promo-picker-slot"></div>
            </div>
          </div>
          <footer class="promo-form-actions">
            <button type="button" class="promo-btn secondary" data-promo-close="1">Cancelar</button>
            <button type="submit" class="promo-btn primary" id="promo-save">Guardar promoción</button>
          </footer>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    document.body.classList.add('promo-modal-open');
    this.bindEscape();

    modal.querySelectorAll('[data-promo-close]').forEach(el => el.addEventListener('click', () => this.closeModal()));

    const form = modal.querySelector('#promo-form');
    if (form) {
      form.addEventListener('submit', event => {
        event.preventDefault();
        this.savePromo(form);
      });
    }

    const comboBox = modal.querySelector('#promo-combo-box');
    if (comboBox) {
      comboBox.addEventListener('click', event => {
        const qtyBtn = event.target.closest('[data-qty]');
        if (qtyBtn) {
          const index = Number(qtyBtn.getAttribute('data-qty-index'));
          const delta = Number(qtyBtn.getAttribute('data-qty'));
          const item = this.draftItems[index];
          if (!item) return;
          item.cantidad = Math.max(1, (Number(item.cantidad) || 1) + delta);
          this.renderDraftItems();
          return;
        }

        const removeBtn = event.target.closest('[data-remove]');
        if (removeBtn) {
          const index = Number(removeBtn.getAttribute('data-remove'));
          if (this.draftItems[index]) {
            this.draftItems.splice(index, 1);
            this.renderDraftItems();
          }
        }
      });
    }

    const pickerToggle = modal.querySelector('#promo-picker-toggle');
    const picker = this.mountPicker(modal);
    if (pickerToggle && picker) {
      pickerToggle.addEventListener('click', () => {
        picker.hidden = !picker.hidden;
        if (!picker.hidden) {
          const input = picker.querySelector('.promo-picker-input');
          if (input) input.focus();
        }
      });
    }

    this.renderDraftItems();
    this.renderPickerList(picker ? picker.querySelector('.promo-picker-list') : null);

    const nombreInput = modal.querySelector('#promo-nombre');
    if (nombreInput) nombreInput.focus();
  },

  closeModal() {
    const existing = document.getElementById('promo-modal');
    if (existing) existing.remove();
    if (!document.getElementById('promo-menu')) {
      document.body.classList.remove('promo-modal-open');
    }
    this.editingId = null;
    this.editingPromo = null;
    this.draftItems = [];
    this.unbindEscape();
  },

  // Selector de productos: clona el template de index.html y lo inserta en el modal.
  mountPicker(modal) {
    const slot = modal.querySelector('#promo-picker-slot');
    if (!slot) return null;

    const template = document.getElementById('promo-picker-template');
    let picker = null;

    if (template && template.content) {
      const fragment = template.content.cloneNode(true);
      picker = fragment.querySelector('.promo-picker');
    }

    if (!picker) {
      picker = document.createElement('div');
      picker.className = 'promo-picker';
      picker.innerHTML = `
        <div class="promo-picker-search">
          <input type="search" class="promo-picker-input" placeholder="Buscar producto del inventario..." autocomplete="off" />
          <button type="button" class="promo-picker-close" aria-label="Cerrar buscador de productos">&#10005;</button>
        </div>
        <div class="promo-picker-list"></div>
      `;
    }

    picker.removeAttribute('id');
    picker.hidden = true;
    picker.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    slot.replaceWith(picker);

    const input = picker.querySelector('.promo-picker-input');
    const list = picker.querySelector('.promo-picker-list');
    const close = picker.querySelector('.promo-picker-close');

    if (input) {
      input.addEventListener('input', () => {
        this.pickerSearch = input.value || '';
        this.renderPickerList(list);
      });
    }

    if (close) {
      close.addEventListener('click', () => {
        picker.hidden = true;
      });
    }

    if (list) {
      list.addEventListener('click', event => {
        const item = event.target.closest('[data-product-id]');
        if (!item) return;
        this.addDraftItem(item.getAttribute('data-product-id'));
      });
    }

    return picker;
  },

  renderPickerList(list) {
    if (!list) return;

    const query = (this.pickerSearch || '').trim().toLowerCase();
    const productos = this.getProducts().filter(p => p && p.activo !== false);
    const filtrados = query
      ? productos.filter(p => {
        const nombre = String(p.nombre || '').toLowerCase();
        const marca = String(p.marca || '').toLowerCase();
        const presentacion = String(p.presentacion || '').toLowerCase();
        return nombre.includes(query) || marca.includes(query) || presentacion.includes(query);
      })
      : productos;

    if (!filtrados.length) {
      list.innerHTML = '<p class="promo-picker-empty">Sin productos para mostrar.</p>';
      return;
    }

    const currency = this.getCurrencySymbol();
    list.innerHTML = filtrados.map(producto => `
      <button type="button" class="promo-picker-item" data-product-id="${this.escapeHtml(producto.id)}">
        <span class="promo-picker-item-main">
          <span class="promo-picker-item-name">${this.escapeHtml(producto.nombre || '')}</span>
          <span class="promo-picker-item-meta">${this.escapeHtml(producto.presentacion || producto.marca || '')}</span>
        </span>
        <span class="promo-picker-item-price">${this.escapeHtml(currency)}${(Number(producto.precio) || 0).toFixed(2)}</span>
      </button>
    `).join('');
  },

  // ---------- Constructor de combos ----------

  addDraftItem(productId) {
    const product = this.getProductById(productId);
    if (!product) return;

    const existing = this.draftItems.find(item => item.productId === productId);
    if (existing) {
      existing.cantidad = (Number(existing.cantidad) || 0) + 1;
    } else {
      this.draftItems.push({ productId: productId, cantidad: 1 });
    }
    this.renderDraftItems();
  },

  renderDraftItems() {
    const box = document.getElementById('promo-combo-box');
    if (!box) return;

    if (!this.draftItems.length) {
      box.innerHTML = '<p class="promo-combo-empty">Sin productos en el combo. Agrega productos del inventario o describe la promoción en "Incluye".</p>';
      return;
    }

    const currency = this.getCurrencySymbol();
    box.innerHTML = this.draftItems.map((item, index) => {
      const product = this.getProductById(item.productId);
      const nombre = product ? (product.nombre || item.productId) : (item.nombre || item.productId);
      const precio = product ? (Number(product.precio) || 0) : (Number(item.precio) || 0);

      return `
        <div class="promo-combo-item">
          <div class="promo-combo-info">
            <span class="promo-combo-name">${this.escapeHtml(nombre)}</span>
            <span class="promo-combo-price">${this.escapeHtml(currency)}${precio.toFixed(2)}</span>
          </div>
          <div class="promo-qty">
            <button type="button" class="promo-qty-btn" data-qty="-1" data-qty-index="${index}" aria-label="Quitar una unidad de ${this.escapeHtml(nombre)}">&minus;</button>
            <span class="promo-qty-value">${item.cantidad}</span>
            <button type="button" class="promo-qty-btn" data-qty="1" data-qty-index="${index}" aria-label="Agregar una unidad de ${this.escapeHtml(nombre)}">+</button>
          </div>
          <button type="button" class="promo-combo-remove" data-remove="${index}" aria-label="Quitar ${this.escapeHtml(nombre)}">&#10005;</button>
        </div>
      `;
    }).join('');
  },

  // ---------- Guardado ----------

  savePromo(form) {
    const data = new FormData(form);
    const nombre = String(data.get('nombre') || '').trim();

    if (!nombre) {
      const nombreInput = form.querySelector('#promo-nombre');
      if (nombreInput) nombreInput.focus();
      return false;
    }

    const valor = Number(data.get('valor'));
    const items = this.draftItems.map(item => ({
      productId: item.productId,
      cantidad: Math.max(1, Math.round(Number(item.cantidad) || 1))
    }));

    const payload = {
      nombre: nombre,
      tipo: String(data.get('tipo') || 'porcentaje'),
      valor: Number.isFinite(valor) ? valor : 0,
      startDate: String(data.get('startDate') || '').trim(),
      endDate: String(data.get('endDate') || '').trim(),
      incluye: String(data.get('incluye') || '').trim(),
      items: items,
      activo: this.editingPromo ? (this.editingPromo.activo !== false) : true
    };

    try {
      if (this.editingId) {
        const promos = this.getPromos();
        const index = promos.findIndex(p => p.id === this.editingId);
        if (index >= 0) {
          promos[index] = Object.assign({}, promos[index], payload);
          Database.savePromos(promos);
        }
      } else {
        Database.addPromo(payload);
      }
    } catch (e) {
      console.error('No se pudo guardar la promoción:', e);
      return false;
    }

    this.closeModal();
    this.render();
    return true;
  },

  // ---------- Escape / foco ----------

  bindEscape() {
    if (this.escapeHandler) return;
    this.escapeHandler = event => {
      if (event.key !== 'Escape') return;
      if (document.getElementById('promo-modal')) {
        this.closeModal();
        return;
      }
      if (document.getElementById('promo-menu')) {
        this.closeCardMenu();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
  },

  unbindEscape() {
    if (this.escapeHandler && !document.getElementById('promo-modal') && !document.getElementById('promo-menu')) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
  },

  // ---------- Motor de evaluación de promociones ----------

  evaluatePromos(cart) {
    const cartItems = Array.isArray(cart) ? cart : [];
    const quantities = {};
    const unitPrice = {};
    let subtotal = 0;
    let totalPieces = 0;

    cartItems.forEach(item => {
      if (!item) return;
      const productId = item.productId;
      const qty = Number(item.quantity) || 0;
      if (!productId || qty <= 0) return;
      const price = Number(item.precio) || 0;
      quantities[productId] = (quantities[productId] || 0) + qty;
      unitPrice[productId] = price;
      subtotal += price * qty;
      totalPieces += qty;
    });

    const products = this.getProducts();
    const productById = {};
    products.forEach(product => { productById[product.id] = product; });

    const comboPromos = [];
    this.getActivePromos().forEach(promo => {
      const combo = this.getComboItems(promo);
      if (combo.length) comboPromos.push({ promo: promo, combo: combo });
    });

    if (!comboPromos.length) {
      return { subtotal: subtotal, discount: 0, applications: [], pending: [] };
    }

    const candidates = comboPromos.map(entry => {
      let sets = Infinity;
      entry.combo.forEach(item => {
        const have = quantities[item.productId] || 0;
        sets = Math.min(sets, Math.floor(have / item.cantidad));
      });
      if (!Number.isFinite(sets) || sets <= 0) return null;
      let base = 0;
      const detail = [];
      entry.combo.forEach(item => {
        const product = productById[item.productId];
        const price = unitPrice[item.productId] !== undefined ? unitPrice[item.productId] : (product ? (Number(product.precio) || 0) : (Number(item.precio) || 0));
        base += price * item.cantidad * sets;
        detail.push({ productId: item.productId, nombre: (product && product.nombre) || item.nombre || item.productId, cantidadPorCombo: item.cantidad, cantidad: item.cantidad * sets, precio: price });
      });
      const discount = this.computeComboDiscount(entry.promo, base, sets);
      if (discount <= 0) return null;
      return { promo: entry.promo, sets: sets, base: base, discount: discount, detail: detail };
    }).filter(Boolean);

    candidates.sort((a, b) => b.discount - a.discount);

    const remaining = Object.assign({}, quantities);
    const applications = [];
    let discount = 0;
    let consumedValue = 0;

    candidates.forEach(candidate => {
      let sets = Infinity;
      candidate.detail.forEach(item => {
        const have = remaining[item.productId] || 0;
        sets = Math.min(sets, Math.floor(have / item.cantidadPorCombo));
      });
      if (!Number.isFinite(sets) || sets <= 0) return;
      let base = 0;
      const detail = [];
      candidate.detail.forEach(item => {
        const used = item.cantidadPorCombo * sets;
        base += item.precio * used;
        detail.push({ productId: item.productId, nombre: item.nombre, cantidad: used, precio: item.precio });
        remaining[item.productId] = (remaining[item.productId] || 0) - used;
      });
      const amount = this.computeComboDiscount(candidate.promo, base, sets);
      if (amount <= 0) return;
      discount += amount;
      consumedValue += base;
      applications.push({ id: candidate.promo.id, nombre: candidate.promo.nombre, tipo: candidate.promo.tipo, valor: Number(candidate.promo.valor) || 0, discount: amount, combos: sets, detalle: detail, esCombo: true });
    });

    const pending = comboPromos
      .filter(entry => !applications.some(app => app.id === entry.promo.id))
      .map(entry => this.getMissingPieces(entry.promo, entry.combo, quantities, productById))
      .filter(entry => entry.faltan.length > 0);

    return { subtotal: subtotal, discount: discount, applications: applications, pending: pending };
  },

  computeComboDiscount(promo, base, sets) {
    const valor = Number(promo.valor) || 0;
    if (valor <= 0 || base <= 0) return 0;
    if (promo.tipo === 'monto') return Math.min(base, valor * sets);
    return (valor / 100) * base;
  },

  getMissingPieces(promo, combo, quantities, productById) {
    const faltan = [];
    combo.forEach(item => {
      const have = quantities[item.productId] || 0;
      const missing = item.cantidad - have;
      if (missing <= 0) return;
      const product = productById[item.productId];
      faltan.push({ productId: item.productId, nombre: (product && product.nombre) || item.nombre || item.productId, cantidad: missing });
    });
    return { id: promo.id, nombre: promo.nombre, faltan: faltan };
  },

  applyPromos(cart) {
    return this.evaluatePromos(cart).discount;
  }
};

if (typeof window !== 'undefined') {
  window.PromosManager = PromosManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PromosManager;
}
