// Inventario: alta y edición de productos.
// La ficha de producto vive en un MODAL flotante centrado (fondo difuminado)
// con un grid de dos columnas; el control de nevera es una tarjeta compacta
// independiente ubicada al final del formulario (estilo switch ❄️).
// Paleta "Midnight & Amber" definida en css/styles.css.
(function () {
  'use strict';

  function showErrorAlert(message) {
    try {
      const id = 'global-error-alert';
      let alertBox = document.getElementById(id);
      if (!alertBox) {
        alertBox = document.createElement('div');
        alertBox.id = id;
        alertBox.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99999;max-width:90%;padding:12px 20px;background:#991b1b;color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:14px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.7);text-align:center;display:none;';
        document.body.appendChild(alertBox);
      }
      alertBox.textContent = '⚠️ Error en Inventario: ' + message;
      alertBox.style.display = 'block';
      setTimeout(function () {
        if (alertBox) alertBox.style.display = 'none';
      }, 6000);
    } catch (e) {
      console.error('Error al mostrar alerta visual:', e);
    }
  }

  window.addEventListener('error', function (e) {
    try {
      const msg = e.error && e.error.message ? e.error.message : e.message;
      showErrorAlert(msg);
    } catch (err) {
      console.error('Error en window.onerror handler:', err);
    }
  });

  window.addEventListener('unhandledrejection', function (e) {
    try {
      const reason = e.reason;
      const msg = reason && reason.message ? reason.message : String(reason);
      showErrorAlert(msg);
    } catch (err) {
      console.error('Error en unhandledrejection handler:', err);
    }
  });

  const InventoryManager = {
    containerId: 'inventory-container',
    gridId: 'inventory-grid',
    formId: 'inventory-form',
    modalId: 'inventory-modal',
    modalCloseBtnId: 'inventory-modal-close',
    newProductBtnId: 'new-product-btn',
    fridgeModalId: 'fridge-modal',
    fridgeCloseBtnId: 'fridge-modal-close',
    scannerModalId: 'inventory-scanner-modal',
    searchQuery: '',
    scanner: {
      codeReader: null,
      videoElement: null,
      canvasElement: null,
      stream: null,
      isScanning: false,
      isContinuous: false,
      lastScanned: '',
      lastScannedTime: 0,
      debounceMs: 1200,
      torchEnabled: false,
      targetInput: null
    },

    init: function (containerId) {
      try {
        this.containerId = containerId || this.containerId;
        this.render();
        this.bindGlobalKeys();
      } catch (e) {
        console.error('Inventory init error:', e);
        showErrorAlert(e && e.message ? e.message : String(e));
      }
    },

    escapeHtml: function (text) {
      if (text === null || text === undefined) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    // ---------- Datos auxiliares ----------

    getActiveProducts: function () {
      try {
        if (typeof Database !== 'undefined' && Database.getProducts) {
          return Database.getProducts().filter(function (p) { return p.activo !== false; });
        }
      } catch (e) {
        console.error('getActiveProducts error:', e);
      }
      return [];
    },

     getFridgeCapacity: function () {
       try {
         if (typeof Database !== 'undefined' && Database.getSettings) {
           const s = Database.getSettings();
           if (s && s.fridgeCapacity) return Number(s.fridgeCapacity) || 24;
         }
       } catch (e) {}
       return 24;
     },

     getCurrencySymbol: function () {
       try {
         if (typeof Database !== 'undefined' && Database.getSettings) {
           const settings = Database.getSettings();
           if (settings && settings.currencySymbol) return settings.currencySymbol;
         }
       } catch (e) {}
       return '$';
     },

    // ---------- Render ----------

    render: function () {
      try {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        let html = '';
        html += '<div class="inventory-header">';
        html += '  <input type="text" id="inventory-search" class="inventory-search" placeholder="🔍 Buscar producto por nombre, marca o código..." value="' + this.escapeHtml(this.searchQuery || '') + '" oninput="InventoryManager.onSearch(this.value)">';
        html += '  <button class="inv-btn new-product" id="new-product-btn" onclick="InventoryManager.openNewProductModal()"><span class="inv-btn-icon">+</span><span>Nuevo producto</span></button>';
        html += '  <button class="inv-btn fridge wide" id="fridge-btn" onclick="InventoryManager.openFridgeModal()" aria-label="Estado de la nevera fría" title="Estado de la nevera fría"><span class="fridge-icon">❄️</span><span class="fridge-status" id="fridge-status"><span id="fridge-count">--</span>/<span id="fridge-max">24</span></span></button>';
        html += '</div>';
        html += '<div id="' + this.gridId + '" class="inventory-grid"></div>';

        // ---------- MODAL FLOTANTE DE PRODUCTO ----------
        html += '<div id="' + this.modalId + '" class="inv-modal" style="display:none;" aria-hidden="true">';
        html += '  <div class="inv-modal-backdrop" data-inv-close="true"></div>';
        html += '  <div class="inv-modal-shell" role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title">';
        html += '    <header class="inv-modal-header">';
        html += '      <div class="inv-modal-heading">';
        html += '        <span class="inv-modal-badge" aria-hidden="true">🍺</span>';
        html += '        <div class="inv-modal-heading-text">';
        html += '          <h3 id="inventory-modal-title">Nuevo Producto</h3>';
        html += '          <span class="inv-modal-sub">Complete los datos del producto</span>';
        html += '        </div>';
        html += '      </div>';
        html += '      <button type="button" id="' + this.modalCloseBtnId + '" class="inv-modal-close" onclick="InventoryManager.closeModal()" aria-label="Cerrar modal">✕</button>';
        html += '    </header>';
        html += '    <form id="' + this.formId + '" class="inv-form" autocomplete="off">';
        html += '      <div class="inv-form-grid">';
        html += '        <div class="inv-field">';
        html += '          <label for="inv-nombre">Nombre del Producto</label>';
        html += '          <input name="nombre" id="inv-nombre" placeholder="Ej. Cerveza IPA" required>';
        html += '        </div>';
        html += '        <div class="inv-field">';
        html += '          <label for="inv-marca">Marca</label>';
        html += '          <input name="marca" id="inv-marca" placeholder="Cerveza Local">';
        html += '        </div>';
        html += '        <div class="inv-field">';
        html += '          <label for="inv-presentacion">Presentación</label>';
        html += '          <input name="presentacion" id="inv-presentacion" placeholder="Botella 330ml">';
        html += '        </div>';
        html += '        <div class="inv-field">';
        html += '          <label for="inv-barcode-input">Código de Barras</label>';
        html += '          <div class="inv-input-group">';
        html += '            <input name="codigoBarras" id="inv-barcode-input" placeholder="Escanea o escribe el código" inputmode="numeric">';
        html += '            <button type="button" id="inv-scan-form-btn" class="inv-scan-btn" onclick="InventoryManager.openInventoryScanner(document.getElementById(\'inv-barcode-input\'))" title="Escanear con la cámara (flash)"><span aria-hidden="true">📷</span><span class="inv-scan-btn-text">Cámara</span></button>';
        html += '          </div>';
        html += '        </div>';
        html += '        <div class="inv-field inv-field-full">';
        html += '          <label for="inv-imagen">URL de Imagen</label>';
        html += '          <input name="imagen" id="inv-imagen" placeholder="https://..." inputmode="url">';
        html += '        </div>';
        html += '        <div class="inv-field">';
        html += '          <label for="inv-precioCompra">Precio de Compra ($)</label>';
        html += '          <input name="precioCompra" id="inv-precioCompra" type="number" step="0.01" min="0" placeholder="0.00">';
        html += '        </div>';
        html += '        <div class="inv-field">';
        html += '          <label for="inv-precioVenta">Precio de Venta ($)</label>';
        html += '          <input name="precioVenta" id="inv-precioVenta" type="number" step="0.01" min="0" placeholder="0.00">';
        html += '        </div>';
        html += '        <div class="inv-field">';
        html += '          <label for="inv-stock">Stock Inicial</label>';
        html += '          <input name="stock" id="inv-stock" type="number" min="0" placeholder="0">';
        html += '        </div>';
        html += '        <div class="inv-field">';
        html += '          <label for="inv-stockMinimo">Stock Mínimo</label>';
        html += '          <input name="stockMinimo" id="inv-stockMinimo" type="number" min="0" placeholder="5">';
        html += '        </div>';
        html += '      </div>';

        html += '      <footer class="inv-form-actions">';
        html += '        <button type="button" class="btn secondary" onclick="InventoryManager.closeModal()">Cancelar</button>';
        html += '        <button type="submit" class="btn inv-save-btn">Guardar producto</button>';
        html += '      </footer>';
        html += '    </form>';
        html += '  </div>';
        html += '</div>';

        // ---------- MODAL DE NEVERA (control global) ----------
        html += '<div id="' + this.fridgeModalId + '" class="inv-modal" style="display:none;" aria-hidden="true">';
        html += '  <div class="inv-modal-backdrop" data-inv-close="true"></div>';
        html += '  <div class="inv-modal-shell nevera-fria-shell" role="dialog" aria-modal="true" aria-labelledby="fridge-modal-title">';
        html += '    <header class="inv-modal-header">';
        html += '      <div class="inv-modal-heading">';
        html += '        <span class="inv-modal-badge inv-modal-badge-cold" aria-hidden="true">❄️</span>';
        html += '        <div class="inv-modal-heading-text">';
        html += '          <h3 id="fridge-modal-title">Nevera Fría</h3>';
        html += '          <span class="inv-modal-sub">Productos refrigerados y piezas frías</span>';
        html += '        </div>';
        html += '      </div>';
        html += '      <button type="button" id="' + this.fridgeCloseBtnId + '" class="inv-modal-close" onclick="InventoryManager.closeFridgeModal()" aria-label="Cerrar modal">✕</button>';
        html += '    </header>';
        html += '    <div id="fridge-content" class="inv-fridge-panel"></div>';
        html += '  </div>';
        html += '</div>';

        container.innerHTML = html;
        this.renderGrid();
        this.bindForm();
      } catch (e) {
        console.error('Inventory render error:', e);
        showErrorAlert(e && e.message ? e.message : String(e));
      }
    },

    // Re-dibuja únicamente las tarjetas (el buscador conserva el foco).
    renderGrid: function () {
      try {
        const grid = document.getElementById(this.gridId);
        if (!grid) return;

        const products = this.getActiveProducts();
        const currencySymbol = this.getCurrencySymbol();
        const q = (this.searchQuery || '').toLowerCase();

        let filtered = products;
        if (q) {
          filtered = products.filter(function (p) {
            const name = (p.nombre || '').toLowerCase();
            const marca = (p.marca || '').toLowerCase();
            const code = (p.codigoBarras || p.codigo || '').toString().toLowerCase();
            return name.indexOf(q) !== -1 || marca.indexOf(q) !== -1 || code.indexOf(q) !== -1;
          });
        }

        let html = '';
        if (filtered.length === 0) {
          html += '<div class="inventory-empty">No se encontraron productos</div>';
        }

        for (var i = 0; i < filtered.length; i++) {
          var product = filtered[i];
          var id = this.escapeHtml(String(product.id));
          var stock = (product.stock === undefined || product.stock === null) ? 0 : product.stock;
          var stockMin = (product.stockMinimo === undefined || product.stockMinimo === null) ? 5 : product.stockMinimo;
          var lowStock = stock <= stockMin;
          var precioVenta = (product.precioVenta !== undefined && product.precioVenta !== null) ? product.precioVenta : ((product.precio !== undefined && product.precio !== null) ? product.precio : 0);
          var precioCompra = product.precioCompra || 0;
          var codigo = product.codigoBarras || product.codigo || '';
          var imagen = product.imagen || product.imagenUrl || product.foto || '';

          html += '<div class="inventory-card" data-product-id="' + id + '">';
          if (imagen) {
            html += '  <div class="inv-img"><img src="' + this.escapeHtml(imagen) + '" alt="' + this.escapeHtml(product.nombre || '') + '" onerror="this.style.display=\'none\'"></div>';
          }
          html += '  <div class="inv-card-head">';
          html += '    <div class="inv-name">' + this.escapeHtml(product.nombre || '') + '</div>';
          html += '  </div>';
          if (product.descripcion) html += '  <div class="inv-meta">' + this.escapeHtml(product.descripcion) + '</div>';
          if (product.marca || product.presentacion) {
            html += '  <div class="inv-brand">' + this.escapeHtml([product.marca, product.presentacion].filter(Boolean).join(' · ')) + '</div>';
          }
          html += '  <div class="inv-prices"><div><span>Compra</span>' + currencySymbol + parseFloat(precioCompra).toFixed(2) + '</div><div><span>Venta</span>' + currencySymbol + parseFloat(precioVenta).toFixed(2) + '</div></div>';
          if (codigo) html += '  <div class="inv-code"><span>Código</span> ' + this.escapeHtml(codigo) + '</div>';
          html += '  <div class="inv-stock ' + (lowStock ? 'low-stock' : '') + '">Stock: ' + stock + (lowStock ? ' ⚠️ Rellenar' : '') + ' <span class="inv-stock-min">(mín. ' + stockMin + ')</span></div>';
          html += '  <div class="inv-actions">';
          html += '    <button class="inv-edit" onclick="InventoryManager.editProduct(\'' + id + '\')">Editar</button>';
          html += '    <button class="inv-delete" onclick="InventoryManager.deleteProduct(\'' + id + '\')" title="Eliminar" aria-label="Eliminar"><span class="trash-icon">&#128465;</span></button>';
          html += '  </div>';
          html += '</div>';
        }

        grid.innerHTML = html;
        this.updateFridgeStatus();
      } catch (e) {
        console.error('Inventory renderGrid error:', e);
        showErrorAlert(e && e.message ? e.message : String(e));
      }
    },

    onSearch: function (val) {
      this.searchQuery = (val || '').trim().toLowerCase();
      this.renderGrid();
    },

    // ---------- Formulario ----------

    bindForm: function () {
      try {
        const self = this;
        const form = document.getElementById(this.formId);
        if (!form) return;
        if (form.dataset.bound === 'true') return;
        form.dataset.bound = 'true';

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          try {
            const id = form.dataset.editId || null;
            const precioVenta = parseFloat((form.precioVenta && form.precioVenta.value) || 0) || 0;
            const product = {
              nombre: (form.nombre && form.nombre.value || '').trim(),
              marca: (form.marca && form.marca.value || '').trim(),
              presentacion: (form.presentacion && form.presentacion.value || '').trim(),
              codigoBarras: (form.codigoBarras && form.codigoBarras.value || '').trim(),
              imagen: (form.imagen && form.imagen.value || '').trim(),
              precioCompra: parseFloat((form.precioCompra && form.precioCompra.value) || 0) || 0,
              precioVenta: precioVenta,
              precio: precioVenta,
              stock: parseInt((form.stock && form.stock.value) || 0, 10) || 0,
              stockMinimo: parseInt((form.stockMinimo && form.stockMinimo.value) || 5, 10) || 5,
              activo: true
            };

            if (id) {
              if (typeof Database !== 'undefined' && Database.updateProduct) Database.updateProduct(id, product);
            } else {
              if (typeof Database !== 'undefined' && Database.addProduct) Database.addProduct(product);
            }

            form.reset();
            self.closeModal();
            self.render();
            self.notifyInventoryUpdated();
          } catch (ex) {
            console.error('Inventory form submit error:', ex);
            showErrorAlert(ex && ex.message ? ex.message : String(ex));
          }
        });
      } catch (e) {
        console.error('Inventory bindForm error:', e);
      }
    },

    notifyInventoryUpdated: function () {
      try {
        if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
          window.dispatchEvent(new CustomEvent('inventory:updated'));
        }
      } catch (e) {}
    },

    // ---------- Estado visual de la nevera fría (copo de nieve independiente) ----------

    getFridgeStock: function () {
      try {
        const capacity = this.getFridgeCapacity();
        const raw = localStorage.getItem('fridgeStock');
        if (raw === null || raw === undefined || raw === '') return capacity;
        const parsed = Number(raw);
        if (isNaN(parsed)) return capacity;
        return Math.max(0, Math.min(capacity, parsed));
      } catch (e) {
        return this.getFridgeCapacity();
      }
    },

    setFridgeStock: function (value) {
      try {
        const capacity = this.getFridgeCapacity();
        const next = Math.max(0, Math.min(capacity, Number(value) || 0));
        localStorage.setItem('fridgeStock', String(next));
      } catch (e) {}
    },

    updateFridgeStatus: function () {
      try {
        const stock = this.getFridgeStock();
        const capacity = this.getFridgeCapacity();

        const countEl = document.getElementById('fridge-count');
        const maxEl = document.getElementById('fridge-max');
        const statusEl = document.getElementById('fridge-status');
        const btn = document.getElementById('fridge-btn');

        if (countEl) countEl.textContent = String(stock);
        if (maxEl) maxEl.textContent = String(capacity);
        if (statusEl) statusEl.title = 'Piezas en nevera: ' + stock + ' de ' + capacity;
      } catch (e) {
        console.error('Inventory updateFridgeStatus error:', e);
      }
    },

    // ---------- Modal de producto ----------

    openNewProductModal: function () {
      try {
        const modal = document.getElementById(this.modalId);
        const form = document.getElementById(this.formId);
        if (!modal || !form) return;
        delete form.dataset.editId;
        form.reset();
        const title = document.getElementById('inventory-modal-title');
        if (title) title.textContent = 'Nuevo Producto';
        const sub = modal.querySelector('.inv-modal-sub');
        if (sub) sub.textContent = 'Complete los datos del producto';
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.textContent = 'Guardar producto';
        this.showModal(modal, this.closeModal.bind(this));
        setTimeout(function () {
          const input = document.getElementById('inv-nombre');
          if (input) input.focus();
        }, 120);
      } catch (e) {
        console.error('Inventory openNewProductModal error:', e);
      }
    },

    closeModal: function () {
      try {
        this.hideModal(document.getElementById(this.modalId));
      } catch (e) {}
    },

    editProduct: function (id) {
      try {
        const products = this.getActiveProducts();
        const product = products.find(function (p) { return String(p.id) === String(id); });
        if (!product) return;
        const modal = document.getElementById(this.modalId);
        const form = document.getElementById(this.formId);
        if (!modal || !form) return;

        form.dataset.editId = product.id;
        if (form.nombre) form.nombre.value = product.nombre || '';
        if (form.marca) form.marca.value = product.marca || '';
        if (form.presentacion) form.presentacion.value = product.presentacion || '';
        if (form.codigoBarras) form.codigoBarras.value = product.codigoBarras || product.codigo || '';
        if (form.imagen) form.imagen.value = product.imagen || product.imagenUrl || product.foto || '';
        if (form.precioCompra) form.precioCompra.value = product.precioCompra || 0;
        if (form.precioVenta) form.precioVenta.value = product.precioVenta !== undefined ? product.precioVenta : (product.precio || 0);
        if (form.stock) form.stock.value = product.stock || 0;
        if (form.stockMinimo) form.stockMinimo.value = product.stockMinimo !== undefined ? product.stockMinimo : 5;

        const title = document.getElementById('inventory-modal-title');
        if (title) title.textContent = 'Editar Producto';
        const sub = modal.querySelector('.inv-modal-sub');
        if (sub) sub.textContent = 'Modifica los datos y guarda los cambios';
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.textContent = 'Guardar cambios';
        this.showModal(modal, this.closeModal.bind(this));
      } catch (e) {
        console.error('Inventory editProduct error:', e);
      }
    },

    deleteProduct: function (id) {
      try {
        if (!confirm('¿Eliminar este producto?')) return;
        var card = document.querySelector('.inventory-card[data-product-id="' + id + '"]');
        var finish = function () {
          if (typeof Database !== 'undefined' && Database.deleteProduct) Database.deleteProduct(id);
          InventoryManager.render();
          InventoryManager.notifyInventoryUpdated();
        };
        if (card) {
          card.classList.add('trash-animate');
          setTimeout(finish, 420);
        } else {
          finish();
        }
      } catch (e) {
        console.error('Inventory deleteProduct error:', e);
      }
    },

    isModalOpen: function (modalId) {
      const modal = document.getElementById(modalId);
      return !!(modal && modal.classList.contains('is-open'));
    },

    showModal: function (modal, onClose) {
      try {
        if (!modal) return;
        modal.classList.remove('is-closing');
        modal.classList.add('is-open');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        const backdrop = modal.querySelector('[data-inv-close="true"]');
        if (backdrop && !backdrop.dataset.invBound) {
          backdrop.dataset.invBound = 'true';
          backdrop.addEventListener('click', function () {
            if (typeof onClose === 'function') onClose();
          });
        }
      } catch (e) {
        console.error('Inventory showModal error:', e);
      }
    },

    hideModal: function (modal) {
      try {
        if (!modal) return;
        modal.classList.remove('is-open');
        modal.classList.add('is-closing');
        setTimeout(function () {
          if (!modal || modal.classList.contains('is-open')) return;
          modal.classList.remove('is-closing');
          modal.style.display = 'none';
          modal.setAttribute('aria-hidden', 'true');
        }, 220);
      } catch (e) {
        console.error('Inventory hideModal error:', e);
      }
    },

    bindGlobalKeys: function () {
      try {
        if (this._keysBound) return;
        this._keysBound = true;
        const self = this;
        document.addEventListener('keydown', function (e) {
          if (e.key !== 'Escape') return;
          if (self.isModalOpen(self.scannerModalId)) {
            self.closeInventoryScanner();
            return;
          }
          if (self.isModalOpen(self.fridgeModalId)) {
            self.closeFridgeModal();
            return;
          }
          if (self.isModalOpen(self.modalId)) {
            self.closeModal();
          }
        });
      } catch (e) {
        console.error('bindGlobalKeys error:', e);
      }
    },

    // ---------- Modal global de nevera ----------

    openFridgeModal: function () {
      try {
        const modal = document.getElementById(this.fridgeModalId);
        const content = document.getElementById('fridge-content');
        if (!modal || !content) return;
        content.innerHTML = this.buildFridgePanel();
        this.showModal(modal, this.closeFridgeModal.bind(this));
      } catch (e) {
        console.error('Inventory openFridgeModal error:', e);
      }
    },

    closeFridgeModal: function () {
      try {
        this.hideModal(document.getElementById(this.fridgeModalId));
      } catch (e) {}
    },

     refillFridge: function () {
      try {
        const capacity = this.getFridgeCapacity();
        this.setFridgeStock(capacity);
        this.render();
        this.notifyInventoryUpdated();
        this.openFridgeModal();
      } catch (e) {
        console.error('Inventory refillFridge error:', e);
        showErrorAlert(e && e.message ? e.message : String(e));
      }
    },

    buildFridgePanel: function () {
      const stock = this.getFridgeStock();
      const capacity = this.getFridgeCapacity();

      let html = '';
      html += '<div class="inv-fridge-summary">';
      html += '  <span class="inv-fridge-summary-icon" aria-hidden="true">❄️</span>';
      html += '  <div class="inv-fridge-summary-text">';
      html += '    <strong>Piezas en nevera: ' + stock + ' / ' + capacity + '</strong>';
      html += '  </div>';
      html += '</div>';
      html += '<button type="button" class="inv-fridge-refill" onclick="InventoryManager.refillFridge()">❄️ Rellenar Nevera</button>';
      return html;
    },


    // ---------- Escáner de código de barras con flash ----------

    openInventoryScanner: function (targetInput) {
      try {
        if (!targetInput) return;
        const modal = document.getElementById(this.scannerModalId);
        if (!modal) {
          alert('Escáner no disponible en este momento.');
          return;
        }
        this.scanner.targetInput = targetInput;
        this.scanner.torchEnabled = false;
        modal.classList.add('is-open');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        this.bindScannerModal();
        this.setScannerStatus('Cámara activa. Apunta al código de barras...');
        this.startInventoryScanner();
      } catch (e) {
        console.error('openInventoryScanner error:', e);
      }
    },

    bindScannerModal: function () {
      try {
        const self = this;
        const modal = document.getElementById(this.scannerModalId);
        if (!modal) return;

        const closers = modal.querySelectorAll('[data-inv-scan-close="true"]');
        for (var i = 0; i < closers.length; i++) {
          const el = closers[i];
          if (el.dataset.invScanBound === 'true') continue;
          el.dataset.invScanBound = 'true';
          el.addEventListener('click', function () { self.closeInventoryScanner(); });
        }

        const flashBtn = document.getElementById('inv-scan-flash');
        if (flashBtn && flashBtn.dataset.invBound !== 'true') {
          flashBtn.dataset.invBound = 'true';
          flashBtn.addEventListener('click', function () { self.toggleScannerFlash(); });
        }
        this.updateFlashButton();
      } catch (e) {
        console.error('bindScannerModal error:', e);
      }
    },

    startInventoryScanner: function () {
      try {
        const self = this;
        const zxing = window.ZXing || {};
        const BrowserMultiFormatReader = zxing.BrowserMultiFormatReader;
        if (!BrowserMultiFormatReader) {
          this.setScannerStatus('Librería de escaneo no cargada. Revisa la conexión o escribe el código a mano.');
          return;
        }
        const video = document.getElementById('inv-scanner-video');
        if (!video) return;
        this.scanner.videoElement = video;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          this.setScannerStatus('Este navegador no permite usar la cámara.');
          return;
        }
        if (this.scanner.isScanning) return;
        this.scanner.isScanning = true;

        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        }).then(function (stream) {
          self.scanner.stream = stream;
          video.srcObject = stream;
          video.setAttribute('playsinline', 'true');
          if (video.play) {
            const played = video.play();
            if (played && typeof played.catch === 'function') played.catch(function () {});
          }
          self.updateFlashButton();

          if (self.scanner.codeReader) {
            try { self.scanner.codeReader.reset(); } catch (e) {}
          }
          self.scanner.codeReader = new BrowserMultiFormatReader();
          self.scanner.codeReader.decodeFromVideoDevice(undefined, video, function (result) {
            if (result) self.applyScannedCode(result.getText());
          });
        }).catch(function (error) {
          console.error('Inventory scanner camera error:', error);
          self.scanner.isScanning = false;
          self.setScannerStatus('Error al acceder a la cámara: ' + (error && error.message ? error.message : error));
        });
      } catch (e) {
        console.error('startInventoryScanner error:', e);
      }
    },

    applyScannedCode: function (code) {
      try {
        if (!code) return;
        const input = this.scanner.targetInput;
        if (input) {
          input.value = code;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        this.setScannerStatus('Código capturado: ' + code);
        this.closeInventoryScanner();
      } catch (e) {
        console.error('applyScannedCode error:', e);
      }
    },

    toggleScannerFlash: function () {
      try {
        const stream = this.scanner.stream;
        if (!stream) {
          this.setScannerStatus('La cámara todavía no está activa.');
          return;
        }
        const track = stream.getVideoTracks()[0];
        if (!track) return;
        const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
        if (!caps.torch) {
          this.setScannerStatus('Este dispositivo no tiene flash disponible.');
          return;
        }
        const next = !this.scanner.torchEnabled;
        const constraints = { advanced: [{ torch: next }] };
        if (typeof track.applyConstraints === 'function') {
          track.applyConstraints(constraints).then(() => {
            this.scanner.torchEnabled = next;
            this.updateFlashButton();
            this.setScannerStatus(next ? 'Flash activado.' : 'Flash desactivado.');
          }).catch((err) => {
            this.setScannerStatus('No se pudo cambiar el flash: ' + (err && err.message ? err.message : err));
          });
        }
      } catch (e) {
        console.error('toggleScannerFlash error:', e);
      }
    },

    updateFlashButton: function () {
      const btn = document.getElementById('inv-scan-flash');
      if (!btn) return;
      btn.textContent = this.scanner.torchEnabled ? '🔦 Desactivar Flash' : '🔦 Activar Flash';
      btn.classList.toggle('is-on', !!this.scanner.torchEnabled);
    },

    setScannerStatus: function (text) {
      const el = document.getElementById('inv-scanner-status');
      if (el) el.textContent = text;
    },

    closeInventoryScanner: function () {
      try {
        this.scanner.isScanning = false;
        this.scanner.torchEnabled = false;
        if (this.scanner.codeReader) {
          try { this.scanner.codeReader.reset(); } catch (e) {}
          this.scanner.codeReader = null;
        }
        if (this.scanner.stream) {
          this.scanner.stream.getTracks().forEach(function (track) { track.stop(); });
          this.scanner.stream = null;
        }
        if (this.scanner.videoElement) {
          this.scanner.videoElement.srcObject = null;
        }
        this.updateFlashButton();
        const modal = document.getElementById(this.scannerModalId);
        if (modal) {
          modal.classList.remove('is-open');
          modal.style.display = 'none';
          modal.setAttribute('aria-hidden', 'true');
        }
      } catch (e) {
        console.error('closeInventoryScanner error:', e);
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.InventoryManager = InventoryManager;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = InventoryManager;
  }
})();
