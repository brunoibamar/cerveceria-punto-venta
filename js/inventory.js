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
    cycleContainerId: 'surtidos-container',
    gridId: 'inventory-grid',
    formId: 'inventory-form',
    modalId: 'inventory-modal',
    modalCloseBtnId: 'inventory-modal-close',
    newProductBtnId: 'new-product-btn',
    fridgeModalId: 'fridge-modal',
    fridgeCloseBtnId: 'fridge-modal-close',
    scannerModalId: 'inventory-scanner-modal',
    searchQuery: '',
    inventoryUpdatesBound: false,
    cyclePickerMode: null,
    cyclePickerProductId: null,
    cyclePickerSearchQuery: '',
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
      Auth.requireAdmin();
      try {
        this.containerId = containerId || this.containerId;
        this.render();
        this.bindInventoryUpdates();
        this.bindGlobalKeys();
      } catch (e) {
        console.error('Inventory init error:', e);
        showErrorAlert(e && e.message ? e.message : String(e));
      }
    },

    initSurtidos: function (containerId) {
      Auth.requireAdmin();
      try {
        this.cycleContainerId = containerId || this.cycleContainerId;
        const container = document.getElementById(this.cycleContainerId);
        if (!container) {
          console.error('Surtidos container #' + this.cycleContainerId + ' does not exist');
          return;
        }
        this.bindInventoryUpdates();
        this.bindCycleEvents();
        this.renderInventorySummary();
        this.renderInventoryCycle();
      } catch (e) {
        console.error('Surtidos init error:', e);
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

    getOpenInventoryCycle: function () {
      const cycles = Database.getInventoryCycles();
      return cycles
        .filter(function (cycle) { return cycle.status === 'open'; })
        .sort(function (a, b) { return String(b.startedAt || '').localeCompare(String(a.startedAt || '')); })[0] || null;
    },

    dateKey: function (date) {
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
      ].join('-');
    },

    formatCycleDate: function (dateKey) {
      const parts = String(dateKey || '').split('-').map(Number);
      if (parts.length !== 3 || parts.some(function (part) { return !part; })) return dateKey || '';
      return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    },

    formatStockPresentation: function (units, unitsPerPackage) {
      const stock = Math.max(0, Number(units) || 0);
      const packageSize = Number(unitsPerPackage) || 0;
      if (packageSize < 1) return stock + ' piezas';
      const packages = Math.floor(stock / packageSize);
      const loose = stock % packageSize;
      return packages + ' cartones/paquetes' + (loose ? ' + ' + loose + ' piezas sueltas' : '') + ' (' + stock + ' piezas)';
    },

    formatCycleCompactStock: function (units, unitsPerPackage) {
      const stock = Math.max(0, Number(units) || 0);
      const packageSize = Number(unitsPerPackage) || 0;
      if (packageSize < 1) return stock + 'p';
      const packages = Math.floor(stock / packageSize);
      const loose = stock % packageSize;
      return packages + 'c' + (loose ? '+' + loose + 'p' : '');
    },

    getInventoryTotals: function () {
      return this.getActiveProducts().reduce(function (totals, product) {
        const stock = Math.max(0, Number(product.stock) || 0);
        const packageSize = Math.max(0, Number(product.unidadesPorCarton) || 0);
        totals.products += 1;
        totals.pieces += stock;
        if (packageSize > 0) {
          totals.packages += Math.floor(stock / packageSize);
          totals.loose += stock % packageSize;
        } else {
          totals.loose += stock;
        }
        return totals;
      }, { products: 0, packages: 0, loose: 0, pieces: 0 });
    },

    renderInventorySummary: function () {
      const summary = document.getElementById('surtidos-summary');
      if (!summary) return;
      const totals = this.getInventoryTotals();
      summary.innerHTML =
        '<div class="inventory-summary-card"><span>Productos activos</span><strong>' + totals.products + '</strong></div>' +
        '<div class="inventory-summary-card"><span>Cartones / paquetes</span><strong>' + totals.packages + '</strong></div>' +
        '<div class="inventory-summary-card"><span>Piezas sueltas</span><strong>' + totals.loose + '</strong></div>' +
        '<div class="inventory-summary-card inventory-summary-total"><span>Total de piezas</span><strong>' + totals.pieces + '</strong></div>';
    },

    bindInventoryUpdates: function () {
      if (this.inventoryUpdatesBound) return;
      this.inventoryUpdatesBound = true;
      const refresh = () => {
        const inventoryContainer = document.getElementById(this.containerId);
        if (inventoryContainer && inventoryContainer.isConnected) this.renderGrid();
        const surtidosContainer = document.getElementById(this.cycleContainerId);
        if (surtidosContainer && surtidosContainer.isConnected) {
          this.renderInventorySummary();
          this.renderInventoryCycle();
        }
      };
      window.addEventListener('inventory:updated', refresh);
      window.addEventListener('storage', (event) => {
        if (event.key === 'cerveceria_products' || event.key === 'cerveceria_inventory_cycles') refresh();
      });
    },

    getCycleSalesEstimates: function (cycle) {
      const estimates = {};
      if (!cycle || !cycle.startDate || !cycle.endDate) return estimates;

      const start = Date.parse(cycle.startDate + 'T00:00:00Z');
      const end = Date.parse(cycle.endDate + 'T00:00:00Z');
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return estimates;

      const sales = Database.getSales();
      sales.forEach(function (sale) {
        const status = String(sale.status || '').toLowerCase();
        if (['cancelada', 'cancelado', 'anulada', 'anulado', 'cancelled', 'canceled', 'void'].indexOf(status) !== -1) return;

        const saleDate = Date.parse(sale.fecha || sale.date || '');
        if (!Number.isFinite(saleDate) || saleDate < start || saleDate >= end) return;

        (Array.isArray(sale.items) ? sale.items : []).forEach(function (item) {
          if (!item || item.productId === undefined || item.productId === null) return;
          const productId = String(item.productId);
          const quantity = Number(item.quantity !== undefined ? item.quantity : item.cantidad);
          if (!Number.isFinite(quantity) || quantity <= 0) return;
          estimates[productId] = (estimates[productId] || 0) + quantity;
        });
      });

      return estimates;
    },

    // Guía de consulta: no guarda conteos ni modifica resultados de auditoría.
    getCycleExpectedStock: function (cycle, productId, salesEstimates) {
      const key = String(productId);
      const estimates = salesEstimates || this.getCycleSalesEstimates(cycle);
      const initial = Number(cycle.initialStock && cycle.initialStock[key]) || 0;
      const restocked = (cycle.entries || []).reduce(function (sum, entry) {
        return String(entry.productId) === key ? sum + (Number(entry.units) || 0) : sum;
      }, 0);
      return initial + restocked - (Number(estimates[key]) || 0);
    },

    formatExpectedStock: function (units, unitsPerPackage) {
      // El formateador normal limita el stock a cero; aquí se preserva el saldo negativo.
      if (units < 0) return units + ' piezas · revisa los movimientos del ciclo';
      return this.formatStockPresentation(units, unitsPerPackage);
    },

    renderExpectedStockGuide: function (expected, unitsPerPackage) {
      return '<div class="inventory-expected-guide' + (expected < 0 ? ' is-negative' : '') + '">' +
        '<span class="inventory-expected-label">Inventario esperado</span>' +
        '<strong>' + this.escapeHtml(this.formatExpectedStock(expected, unitsPerPackage)) + '</strong>' +
        '<small>Inicial + surtido − ventas estimadas. Guía para comparar con tu conteo físico.</small>' +
        '</div>';
    },

    renderInventoryCycle: function () {
      const cycle = this.getOpenInventoryCycle();
      const cycles = Database.getInventoryCycles();
      const latestClosedCycle = cycles
        .filter(function (item) { return item.status === 'closed'; })
        .sort(function (a, b) {
          return String(b.closedAt || b.startedAt || '').localeCompare(String(a.closedAt || a.startedAt || ''));
        })[0];
      const products = Database.getProducts();
      const cyclePanel = document.getElementById('inventory-cycle-panel');
      if (!cyclePanel) return;
      if (!cycle) {
        cyclePanel.innerHTML =
          '<section class="inventory-cycle">' +
            '<header class="inventory-cycle-header"><div><h3>Ciclo semanal</h3>' +
            '<span class="inventory-cycle-status">Sin ciclo activo</span></div></header>' +
            '<div class="inventory-cycle-start">' +
              '<label for="inventory-cycle-start-date">Fecha de inicio</label>' +
              '<input type="date" id="inventory-cycle-start-date" value="' + this.dateKey(new Date()) + '">' +
              '<button type="button" class="btn" data-cycle-start>Iniciar nuevo ciclo / auditoría</button>' +
            '</div>' +
            (latestClosedCycle ? '<div class="inventory-cycle-reopen"><p>¿Cerraste el último ciclo por error? Puedes reabrirlo para corregir los conteos. Se conservarán los surtidos y el stock actual.</p><button type="button" class="btn secondary" data-cycle-reopen="' + this.escapeHtml(latestClosedCycle.id) + '">Reabrir último ciclo</button></div>' : '') +
          '</section>';
        return;
      }
      const ids = Object.keys(cycle.initialStock || {});
      const finalStockDraft = cycle.finalStockDraft || {};
      const savedCount = ids.filter(function (id) {
        return finalStockDraft[id] !== undefined && finalStockDraft[id] !== null;
      }).length;
      const canCloseCycle = ids.length > 0 && savedCount === ids.length;
      const salesEstimates = this.getCycleSalesEstimates(cycle);
      let html = '<section class="inventory-cycle">';
      html += '<header class="inventory-cycle-header"><div class="inventory-cycle-title"><h3>Ciclo semanal</h3>';
      html += '<span class="inventory-cycle-status">Abierto · ' + this.escapeHtml(this.formatCycleDate(cycle.startDate)) + '</span></div>';
      html += '<div class="inventory-cycle-header-actions">';
      html += '<button type="button" class="btn secondary inventory-cycle-sync" data-cycle-rebase>Sincronizar</button>';
      html += '<button type="button" class="btn secondary inventory-cycle-count" data-cycle-open-picker="count">Conteo ' + savedCount + '/' + ids.length + '</button>';
      html += '</div></header>';
      if (latestClosedCycle) {
        html += '<div class="inventory-cycle-reopen"><p>¿Necesitas corregir el último ciclo cerrado? Puedes reabrirlo sin perder este ciclo.</p>';
        html += '<button type="button" class="btn secondary" data-cycle-reopen="' + this.escapeHtml(latestClosedCycle.id) + '">Reabrir último ciclo cerrado</button></div>';
      }
      html += '<div class="inventory-cycle-list" aria-label="Resumen de productos del ciclo">';
      ids.forEach((id) => {
        const product = products.find(function (item) { return String(item.id) === id; });
        const snapshot = cycle.products && cycle.products[id] ? cycle.products[id] : {};
        const name = product ? product.nombre : (snapshot.nombre || 'Producto eliminado');
        const description = product && product.descripcion ? product.descripcion : '';
        const brand = product ? [product.marca, product.presentacion].filter(Boolean).join(' · ') : '';
        const subtitle = [description, brand].filter(Boolean).join(' · ');
        const unitsPerPackage = product ? Number(product.unidadesPorCarton) || 0 : Number(snapshot.unidadesPorCarton) || 0;
        const initial = Number(cycle.initialStock[id]) || 0;
        const currentStock = product ? Math.max(0, Number(product.stock) || 0) : 0;
        const finalCount = finalStockDraft[id];
        const expectedStock = this.getCycleExpectedStock(cycle, id, salesEstimates);
        const entries = (cycle.entries || []).filter(function (entry) {
          return String(entry.productId) === id;
        }).reduce(function (sum, entry) { return sum + (Number(entry.units) || 0); }, 0);
        const packages = unitsPerPackage > 0 ? Math.floor(currentStock / unitsPerPackage) : 0;
        const loosePieces = unitsPerPackage > 0 ? currentStock % unitsPerPackage : currentStock;
        const escapedId = this.escapeHtml(id);
        html += '<details class="inventory-card inventory-cycle-stock-card" data-cycle-product="' + escapedId + '">';
        html += '<summary class="inventory-cycle-stock-summary">';
        html += '<span class="inventory-cycle-stock-heading"><strong class="inv-name">' + this.escapeHtml(name) + '</strong>';
        if (subtitle) html += '<span class="inventory-cycle-stock-subtitle">' + this.escapeHtml(subtitle) + '</span>';
        html += '</span>';
        html += '<span class="inventory-cycle-stock-breakdown">';
        html += '<span><small>Cartones / paquetes</small><strong>' + packages + '</strong></span>';
        html += '<span><small>Piezas sueltas</small><strong>' + loosePieces + '</strong></span>';
        html += '<span class="inventory-cycle-stock-total"><small>Total de piezas</small><strong>' + currentStock + '</strong></span>';
        html += '</span>';
        html += '<span class="inventory-cycle-expected' + (expectedStock < 0 ? ' is-negative' : '') + '"><small>Inventario esperado</small><strong>' + this.escapeHtml(this.formatExpectedStock(expectedStock, unitsPerPackage)) + '</strong></span>';
        html += '</summary>';
        html += '<div class="inventory-cycle-stock-details">';
        html += '<div class="inventory-cycle-detail-list">';
        html += '<div><span>Inventario inicial</span><strong>' + this.escapeHtml(this.formatStockPresentation(initial, unitsPerPackage)) + '</strong></div>';
        html += '<div><span>Inventario actual</span><strong>' + this.escapeHtml(this.formatStockPresentation(currentStock, unitsPerPackage)) + '</strong></div>';
        html += '<div><span>Surtido</span><strong>' + this.escapeHtml(this.formatStockPresentation(entries, unitsPerPackage)) + '</strong></div>';
        html += '<div class="inventory-cycle-sales-estimate"><span>Estimado de ventas del ciclo</span><strong>' + (Number(salesEstimates[id]) || 0) + ' piezas</strong></div>';
        html += '<div class="inventory-cycle-expected-detail"><span>Inventario esperado</span><strong>' + this.escapeHtml(this.formatExpectedStock(expectedStock, unitsPerPackage)) + '</strong></div>';
        html += '<div><span>Conteo físico</span><strong>' + (finalCount === undefined ? 'Pendiente' : this.escapeHtml(this.formatStockPresentation(finalCount, unitsPerPackage))) + '</strong></div>';
        html += '</div>';
        html += '<div class="inventory-cycle-product-actions">';
        html += '<button type="button" class="btn inventory-cycle-restock-product" data-cycle-open-picker="restock" data-cycle-product-id="' + escapedId + '">Registrar surtido</button>';
        html += '<button type="button" class="btn secondary inventory-cycle-count-product" data-cycle-open-picker="count" data-cycle-product-id="' + escapedId + '">' + (finalCount === undefined ? 'Capturar conteo físico' : 'Editar conteo físico') + '</button>';
        html += '</div>';
        html += '</div></details>';
      });
      if (!ids.length) html += '<p class="inventory-cycle-empty">No hay productos registrados para este ciclo.</p>';
      html += '</div>';
      html += '<div class="inventory-cycle-close-actions">';
      html += '<p>' + (canCloseCycle ? 'Conteos completos. El ciclo está listo para cerrar.' : ids.length ? 'Completa el conteo físico de todos los productos para habilitar el cierre.' : 'No hay productos en este ciclo para contar.') + '</p>';
      html += '<button type="button" class="btn inventory-cycle-close" data-cycle-close' + (canCloseCycle ? '' : ' disabled') + '>Cerrar ciclo</button></div>';
      html += this.renderCyclePicker(cycle, products);
      html += '</section>';
      cyclePanel.innerHTML = html;
    },

    renderCyclePicker: function (cycle, products) {
      if (!this.cyclePickerMode) return '';
      const mode = this.cyclePickerMode;
      const ids = Object.keys(cycle.initialStock || {});
      const selectedId = this.cyclePickerProductId;
      const filterQuery = String(this.cyclePickerSearchQuery || '').trim().toLocaleLowerCase();
      const selectedProduct = products.find(function (product) { return String(product.id) === String(selectedId); });
      const snapshot = cycle.products && cycle.products[selectedId] ? cycle.products[selectedId] : {};
      const productName = selectedProduct ? selectedProduct.nombre : snapshot.nombre;
      const directProduct = !!selectedId;
      const unitsPerPackage = selectedProduct
        ? Number(selectedProduct.unidadesPorCarton) || 0
        : Number(snapshot.unidadesPorCarton) || 0;
      let html = '<div class="cycle-picker-backdrop" data-cycle-picker-close></div>';
      html += '<section class="cycle-picker" role="dialog" aria-modal="true" aria-labelledby="cycle-picker-title">';
      html += '<header class="cycle-picker-header"><div><h3 id="cycle-picker-title">' + (mode === 'restock' ? 'Registrar surtido' : 'Conteo físico') + '</h3>';
      html += '<p>' + (directProduct && productName ? this.escapeHtml(productName) : 'Elige un producto para continuar') + '</p></div><button type="button" class="cycle-picker-close" data-cycle-picker-close aria-label="Cerrar">×</button></header>';
      if (!directProduct) {
        html += '<label class="cycle-picker-search-label" for="cycle-picker-search">Buscar producto</label>';
        html += '<input id="cycle-picker-search" class="cycle-picker-search" type="search" placeholder="Nombre del producto" data-cycle-picker-search autocomplete="off" value="' + this.escapeHtml(this.cyclePickerSearchQuery || '') + '">';
        html += '<div class="cycle-picker-list" role="listbox" aria-label="Productos del ciclo">';
        ids.forEach((id) => {
          const product = products.find(function (item) { return String(item.id) === id; });
          const fallback = cycle.products && cycle.products[id] ? cycle.products[id] : {};
          const name = product ? product.nombre : (fallback.nombre || 'Producto eliminado');
          const stock = product ? Math.max(0, Number(product.stock) || 0) : 0;
          const selected = String(selectedId) === id;
          const hidden = filterQuery && !String(name).toLocaleLowerCase().includes(filterQuery);
          html += '<button type="button" class="cycle-picker-option' + (selected ? ' is-selected' : '') + '" data-cycle-select-product="' + this.escapeHtml(id) + '" role="option" aria-selected="' + selected + '"' + (hidden ? ' hidden' : '') + '>';
          html += '<strong>' + this.escapeHtml(name) + '</strong><span>Actual: ' + this.escapeHtml(this.formatStockPresentation(stock, product ? product.unidadesPorCarton : fallback.unidadesPorCarton)) + '</span></button>';
        });
        html += '</div>';
      }
      if (selectedId && productName) {
        const currentStock = selectedProduct ? Math.max(0, Number(selectedProduct.stock) || 0) : 0;
        const entries = (cycle.entries || []).filter(function (entry) {
          return String(entry.productId) === String(selectedId);
        }).reduce(function (sum, entry) { return sum + (Number(entry.units) || 0); }, 0);
        const finalDraft = cycle.finalStockDraft && cycle.finalStockDraft[selectedId];
        html += '<form class="cycle-picker-form" data-cycle-picker-form>';
        html += '<h4>' + this.escapeHtml(productName) + '</h4>';
        if (mode === 'restock') {
          html += '<p class="cycle-picker-current">Stock actual: ' + this.escapeHtml(this.formatStockPresentation(currentStock, unitsPerPackage)) + '</p>';
          html += '<div class="inventory-cycle-controls"><label>Paquetes<input type="number" min="0" step="1" data-picker-packages ' + (unitsPerPackage ? '' : 'disabled') + ' value="0"></label>';
          html += '<label>Piezas sueltas<input type="number" min="0" step="1" data-picker-pieces value="0"></label></div>';
          html += '<p class="cycle-picker-preview" data-cycle-picker-preview>Nuevo stock: ' + this.escapeHtml(this.formatStockPresentation(currentStock, unitsPerPackage)) + '</p>';
          html += '<button type="submit" class="btn">Guardar surtido</button>';
        } else {
          const draftUnits = finalDraft === undefined ? 0 : Number(finalDraft);
          const draftPackages = unitsPerPackage ? Math.floor(draftUnits / unitsPerPackage) : 0;
          const draftLoose = unitsPerPackage ? draftUnits % unitsPerPackage : draftUnits;
          html += '<p class="cycle-picker-current">Inicial: ' + this.escapeHtml(this.formatStockPresentation(cycle.initialStock[selectedId], unitsPerPackage)) + ' · Surtido: ' + this.escapeHtml(this.formatStockPresentation(entries, unitsPerPackage)) + '</p>';
          html += this.renderExpectedStockGuide(this.getCycleExpectedStock(cycle, selectedId), unitsPerPackage);
          html += '<div class="inventory-cycle-controls"><label>Paquetes contados<input type="number" min="0" step="1" data-picker-packages ' + (unitsPerPackage ? '' : 'disabled') + ' value="' + draftPackages + '"></label>';
          html += '<label>Piezas sueltas<input type="number" min="0" step="1" data-picker-pieces value="' + draftLoose + '"></label></div>';
          html += '<p class="cycle-picker-preview" data-cycle-picker-preview>Desplazamiento estimado: pendiente de captura</p>';
          html += '<button type="submit" class="btn">Guardar conteo físico</button>';
        }
        html += '</form>';
      }
      html += '</section>';
      return html;
    },

    bindCycleEvents: function () {
      const container = document.getElementById(this.cycleContainerId);
      if (!container || container.dataset.cycleEventsBound === 'true') return;
      container.dataset.cycleEventsBound = 'true';
      container.addEventListener('click', (event) => {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        const openPicker = target.closest('[data-cycle-open-picker]');
        if (openPicker) {
          this.cyclePickerMode = openPicker.dataset.cycleOpenPicker;
          this.cyclePickerProductId = openPicker.dataset.cycleProductId || null;
          this.cyclePickerSearchQuery = '';
          this.renderInventoryCycle();
          const search = container.querySelector('[data-cycle-picker-search]');
          if (search) search.focus();
          return;
        }
        const closePicker = target.closest('[data-cycle-picker-close]');
        if (closePicker) {
          this.cyclePickerMode = null;
          this.cyclePickerProductId = null;
          this.cyclePickerSearchQuery = '';
          this.renderInventoryCycle();
          return;
        }
        const selectProduct = target.closest('[data-cycle-select-product]');
        if (selectProduct) {
          this.cyclePickerProductId = selectProduct.dataset.cycleSelectProduct;
          this.renderInventoryCycle();
          return;
        }
        if (target.closest('[data-cycle-start]')) {
          this.startInventoryCycle();
          return;
        }
        const reopenCycle = target.closest('[data-cycle-reopen]');
        if (reopenCycle) {
          this.reopenInventoryCycle(reopenCycle.dataset.cycleReopen);
          return;
        }
        if (target.closest('[data-cycle-rebase]')) {
          this.rebaseInventoryCycle();
          return;
        }
        if (target.closest('[data-cycle-close]')) this.closeInventoryCycle();
      });
      container.addEventListener('input', (event) => {
        const target = event.target;
        if (!target) return;
        if (target.matches('[data-cycle-picker-search]')) {
          const query = String(target.value || '').trim().toLocaleLowerCase();
          this.cyclePickerSearchQuery = target.value || '';
          container.querySelectorAll('[data-cycle-select-product]').forEach((option) => {
            option.hidden = !option.textContent.toLocaleLowerCase().includes(query);
          });
          return;
        }
        if (target.matches('[data-picker-packages], [data-picker-pieces]')) {
          this.updateCyclePickerPreview(container);
        }
      });
      container.addEventListener('submit', (event) => {
        if (!event.target.matches('[data-cycle-picker-form]')) return;
        event.preventDefault();
        this.submitCyclePickerForm(event.target);
      });
    },

    startInventoryCycle: function () {
      try {
        const dateInput = document.getElementById('inventory-cycle-start-date');
        const startDate = dateInput && dateInput.value;
        if (!startDate) throw new Error('Selecciona la fecha de inicio del ciclo.');
        Database.createInventoryCycle(startDate);
        this.renderInventoryCycle();
        this.notifyInventoryUpdated();
      } catch (error) {
        console.error('Inventory cycle start error:', error);
        showErrorAlert(error && error.message ? error.message : String(error));
      }
    },

    rebaseInventoryCycle: function () {
      try {
        const cycle = this.getOpenInventoryCycle();
        if (!cycle) throw new Error('No hay un ciclo abierto para sincronizar.');
        const dateInput = document.getElementById('inventory-cycle-reset-date');
        const startDate = dateInput && dateInput.value ? dateInput.value : this.dateKey(new Date());
        if (!confirm('Se reemplazará el inventario inicial con las existencias actuales y se borrará el registro de surtidos de este ciclo. ¿Deseas reiniciar la auditoría?')) return;
        Database.rebaseInventoryCycle(cycle.id, startDate);
        this.renderInventoryCycle();
        this.notifyInventoryUpdated();
      } catch (error) {
        console.error('Inventory cycle rebase error:', error);
        showErrorAlert(error && error.message ? error.message : String(error));
      }
    },

    reopenInventoryCycle: function (cycleId) {
      try {
        if (!confirm('Se reabrirá el último ciclo cerrado y se borrarán sus conteos finales y resultados. Se conservarán los surtidos y el stock actual. Si hay otro ciclo abierto, quedará guardado y volverá a mostrarse al cerrar este. ¿Deseas continuar?')) return;
        Database.reopenInventoryCycle(cycleId);
        this.renderInventorySummary();
        this.renderInventoryCycle();
        this.notifyInventoryUpdated();
      } catch (error) {
        console.error('Inventory cycle reopen error:', error);
        showErrorAlert(error && error.message ? error.message : String(error));
      }
    },

    readWholeNumber: function (input, label) {
      if (input && input.disabled) return 0;
      if (!input) throw new Error('No se encontró el campo de ' + label + '.');
      const rawValue = String(input.value || '').trim();
      const value = rawValue ? Number(rawValue) : 0;
      if (!Number.isInteger(value) || value < 0) throw new Error('Ingresa una cantidad válida para ' + label + '.');
      return value;
    },

    updateCyclePickerPreview: function (container) {
      const cycle = this.getOpenInventoryCycle();
      const productId = this.cyclePickerProductId;
      const preview = container.querySelector('[data-cycle-picker-preview]');
      if (!cycle || !productId || !preview) return;
      const product = Database.getProducts().find(function (item) { return String(item.id) === String(productId); });
      const snapshot = cycle.products && cycle.products[productId] ? cycle.products[productId] : {};
      const packageSize = product ? Number(product.unidadesPorCarton) || 0 : Number(snapshot.unidadesPorCarton) || 0;
      const packagesInput = container.querySelector('[data-picker-packages]');
      const piecesInput = container.querySelector('[data-picker-pieces]');
      const packages = packagesInput && packagesInput.value.trim() ? Number(packagesInput.value) : 0;
      const pieces = piecesInput && piecesInput.value.trim() ? Number(piecesInput.value) : 0;
      if (!Number.isInteger(packages) || packages < 0 || !Number.isInteger(pieces) || pieces < 0) {
        preview.textContent = 'Ingresa cantidades enteras no negativas.';
        return;
      }
      const units = packages * packageSize + pieces;
      if (this.cyclePickerMode === 'restock') {
        const current = product ? Math.max(0, Number(product.stock) || 0) : 0;
        preview.textContent = 'Nuevo stock: ' + this.formatStockPresentation(current + units, packageSize);
        return;
      }
      const entries = (cycle.entries || []).filter(function (entry) {
        return String(entry.productId) === String(productId);
      }).reduce(function (sum, entry) { return sum + (Number(entry.units) || 0); }, 0);
      const displacement = Number(cycle.initialStock[productId]) + entries - units;
      preview.textContent = 'Desplazamiento estimado: ' + this.formatStockPresentation(displacement, packageSize);
    },

    submitCyclePickerForm: function (form) {
      try {
        const cycle = this.getOpenInventoryCycle();
        if (!cycle) throw new Error('No hay un ciclo abierto.');
        const productId = this.cyclePickerProductId;
        if (!productId) throw new Error('Selecciona un producto.');
        const product = Database.getProducts().find(function (item) { return String(item.id) === productId; });
        const snapshot = cycle.products && cycle.products[productId] ? cycle.products[productId] : {};
        const packageSize = product ? Number(product.unidadesPorCarton) || 0 : Number(snapshot.unidadesPorCarton) || 0;
        const packages = this.readWholeNumber(form.querySelector('[data-picker-packages]'), 'paquetes');
        const loose = this.readWholeNumber(form.querySelector('[data-picker-pieces]'), 'piezas');
        if (packages > 0 && packageSize < 1) throw new Error('Configura primero las unidades por cartón/charola del producto.');
        const units = packages * packageSize + loose;
        if (this.cyclePickerMode === 'restock') {
          if (!product) throw new Error('El producto ya no existe.');
          if (units < 1) throw new Error('El surtido debe incluir al menos una pieza.');
          Database.recordInventoryRestock(cycle.id, productId, units, packages);
          this.cyclePickerMode = null;
          this.cyclePickerProductId = null;
          this.cyclePickerSearchQuery = '';
          this.renderInventorySummary();
          this.renderGrid();
          this.renderInventoryCycle();
          this.notifyInventoryUpdated();
          return;
        }
        Database.saveInventoryCycleFinalCount(cycle.id, productId, units);
        this.cyclePickerMode = null;
        this.cyclePickerProductId = null;
        this.cyclePickerSearchQuery = '';
        this.renderInventoryCycle();
      } catch (error) {
        console.error('Inventory cycle entry error:', error);
        showErrorAlert(error && error.message ? error.message : String(error));
      }
    },

    closeInventoryCycle: function () {
      try {
        const cycle = this.getOpenInventoryCycle();
        if (!cycle) throw new Error('No hay un ciclo abierto.');
        const finalStock = cycle.finalStockDraft || {};
        if (Object.keys(finalStock).length !== Object.keys(cycle.initialStock || {}).length) {
          throw new Error('Captura el conteo físico de todos los productos antes de cerrar el ciclo.');
        }
        Database.closeInventoryCycle(cycle.id, finalStock);
        this.cyclePickerMode = null;
        this.cyclePickerProductId = null;
        this.cyclePickerSearchQuery = '';
        this.renderInventorySummary();
        this.renderInventoryCycle();
        this.notifyInventoryUpdated();
      } catch (error) {
        console.error('Inventory cycle close error:', error);
        showErrorAlert(error && error.message ? error.message : String(error));
      }
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
      Auth.requireAdmin();
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
        html += '      <div class="inv-section">';
        html += '        <div class="inv-section-header">';
        html += '          <span class="inv-section-icon" aria-hidden="true">📦</span>';
        html += '          <span class="inv-section-title">Datos Generales</span>';
        html += '        </div>';
        html += '        <div class="inv-section-body">';
        html += '          <div class="inv-form-grid">';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-nombre">Nombre del Producto</label>';
        html += '              <input name="nombre" id="inv-nombre" placeholder="Ej. Cerveza IPA" required>';
        html += '              <span class="inv-field-hint">Nombre que se mostrará en el inventario y ticket de venta.</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-marca">Marca</label>';
        html += '              <input name="marca" id="inv-marca" placeholder="Cerveza Local">';
        html += '              <span class="inv-field-hint">Marca o cervecería del producto.</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-presentacion">Presentación</label>';
        html += '              <input name="presentacion" id="inv-presentacion" placeholder="Botella 330ml">';
        html += '              <span class="inv-field-hint">Tamaño y tipo de envase (ej. Botella 330ml, Lata 473ml).</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-barcode-input">Código de Barras</label>';
        html += '              <div class="inv-input-group">';
        html += '                <input name="codigoBarras" id="inv-barcode-input" placeholder="Escanea o escribe el código" inputmode="numeric">';
        html += '                <button type="button" id="inv-scan-form-btn" class="inv-scan-btn" onclick="InventoryManager.openInventoryScanner(document.getElementById(\'inv-barcode-input\'))" title="Escanear con la cámara (flash)"><span aria-hidden="true">📷</span><span class="inv-scan-btn-text">Cámara</span></button>';
        html += '              </div>';
        html += '              <span class="inv-field-hint">Código de barras del envase para escaneo rápido en ventas.</span>';
        html += '            </div>';
        html += '            <div class="inv-field inv-field-full">';
        html += '              <label for="inv-imagen">URL de Imagen</label>';
        html += '              <input name="imagen" id="inv-imagen" placeholder="https://..." inputmode="url">';
        html += '              <span class="inv-field-hint">Enlace directo a la foto del producto.</span>';
        html += '            </div>';
        html += '          </div>';
        html += '        </div>';
        html += '      </div>';

        html += '      <div class="inv-section">';
        html += '        <div class="inv-section-header">';
        html += '          <span class="inv-section-icon" aria-hidden="true">🍺</span>';
        html += '          <span class="inv-section-title">Modalidad Cartón / Charola (Mayoreo)</span>';
        html += '        </div>';
        html += '        <div class="inv-section-body">';
        html += '          <div class="inv-form-grid">';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-unidadesPorCarton">Unidades por cartón / charola</label>';
        html += '              <input name="unidadesPorCarton" id="inv-unidadesPorCarton" type="number" min="1" placeholder="24">';
        html += '              <span class="inv-field-hint">Ej. 12 o 24 unidades que vienen dentro del cartón.</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-costoCarton">Costo base de compra del cartón ($)</label>';
        html += '              <input name="costoCarton" id="inv-costoCarton" type="number" step="0.01" min="0" placeholder="0.00">';
        html += '              <span class="inv-field-hint">Lo que te cuesta al proveedor el cartón/charola completo.</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-precioCarton">Precio de venta de cartón completo ($)</label>';
        html += '              <input name="precioCarton" id="inv-precioCarton" type="number" step="0.01" min="0" placeholder="0.00">';
        html += '              <span class="inv-field-hint">Precio al mayoreo cuando vendes el cartón entero.</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-cobroExtraEnvaseCarton">Cobro extra por envase faltante en cartón ($)</label>';
        html += '              <input name="cobroExtraEnvaseFaltanteCarton" id="inv-cobroExtraEnvaseCarton" type="number" step="0.01" min="0" placeholder="100.00">';
        html += '              <span class="inv-field-hint">Ej. $100 extra si el cliente no devuelve los envases del cartón.</span>';
        html += '            </div>';
        html += '          </div>';
        html += '        </div>';
        html += '      </div>';

        html += '      <div class="inv-section">';
        html += '        <div class="inv-section-header">';
        html += '          <span class="inv-section-icon" aria-hidden="true">🧊</span>';
        html += '          <span class="inv-section-title">Modalidad Piezas Sueltas</span>';
        html += '        </div>';
        html += '        <div class="inv-section-body">';
        html += '          <div class="inv-form-grid">';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-precioVenta">Precio de venta por pieza ($)</label>';
        html += '              <input name="precioVenta" id="inv-precioVenta" type="number" step="0.01" min="0" placeholder="0.00">';
        html += '              <span class="inv-field-hint">Precio unitario al detalle cuando vendes suelta.</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-costoPieza">Costo base por pieza ($)</label>';
        html += '              <input name="costoPieza" id="inv-costoPieza" type="number" step="0.01" min="0" placeholder="0.00">';
        html += '              <span class="inv-field-hint">Lo que te cuesta cada pieza suelta.</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-cobroExtraEnvasePieza">Cobro extra por envase faltante en pieza ($)</label>';
        html += '              <input name="cobroExtraEnvaseFaltantePieza" id="inv-cobroExtraEnvasePieza" type="number" step="0.01" min="0" placeholder="10.00">';
        html += '              <span class="inv-field-hint">Ej. $10 extra si el cliente no devuelve el envase de la pieza.</span>';
        html += '            </div>';
        html += '          </div>';
        html += '        </div>';
        html += '      </div>';

        html += '      <div class="inv-section">';
        html += '        <div class="inv-section-header">';
        html += '          <span class="inv-section-icon" aria-hidden="true">🏷️</span>';
        html += '          <span class="inv-section-title">Promociones por Volumen (Paquetes)</span>';
        html += '        </div>';
        html += '        <div class="inv-section-body">';
        html += '          <div class="inv-form-grid">';
        for (var lvl = 1; lvl <= 3; lvl++) {
          html += '            <div class="inv-field">';
          html += '              <label for="inv-promo' + lvl + '-cantidad">Promoción ' + lvl + ' - Cantidad de piezas</label>';
          html += '              <input name="promo' + lvl + 'Cantidad" id="inv-promo' + lvl + '-cantidad" type="number" min="1" placeholder="' + (lvl === 1 ? '2' : lvl === 2 ? '6' : '12') + '">';
          html += '              <span class="inv-field-hint">Piezas requeridas para aplicar la promoción ' + lvl + '.</span>';
          html += '            </div>';
          html += '            <div class="inv-field">';
          html += '              <label for="inv-promo' + lvl + '-precio">Promoción ' + lvl + ' - Precio especial ($)</label>';
          html += '              <input name="promo' + lvl + 'Precio" id="inv-promo' + lvl + '-precio" type="number" step="0.01" min="0" placeholder="0.00">';
          html += '              <span class="inv-field-hint">Precio total para el paquete de la promoción ' + lvl + '.</span>';
          html += '            </div>';
        }
        html += '          </div>';
        html += '        </div>';
        html += '      </div>';

        html += '      <div class="inv-section">';
        html += '        <div class="inv-section-header">';
        html += '          <span class="inv-section-icon" aria-hidden="true">📊</span>';
        html += '          <span class="inv-section-title">Stock y Control</span>';
        html += '        </div>';
        html += '        <div class="inv-section-body">';
        html += '          <div class="inv-form-grid">';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-stock-cartones">Cartones / charolas / paquetes</label>';
        html += '              <input name="stockCartones" id="inv-stock-cartones" type="number" min="0" step="1" placeholder="0">';
        html += '              <span class="inv-field-hint">Se convierte a piezas usando las unidades por cartón configuradas arriba.</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-stock">Piezas sueltas</label>';
        html += '              <input name="stock" id="inv-stock" type="number" min="0" placeholder="0">';
        html += '              <span class="inv-field-hint">Unidades fuera del paquete completo.</span>';
        html += '            </div>';
        html += '            <div class="inv-field">';
        html += '              <label for="inv-stockMinimo">Stock Mínimo</label>';
        html += '              <input name="stockMinimo" id="inv-stockMinimo" type="number" min="0" placeholder="5">';
        html += '              <span class="inv-field-hint">Nivel a partir del cual se activa la alerta de reposición.</span>';
        html += '            </div>';
        html += '          </div>';
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
          var id = POS.jsArg(String(product.id));
          var stock = (product.stock === undefined || product.stock === null) ? 0 : product.stock;
          var stockMin = (product.stockMinimo === undefined || product.stockMinimo === null) ? 5 : product.stockMinimo;
          var lowStock = stock <= stockMin;
          var precioVenta = (product.precioVenta !== undefined && product.precioVenta !== null) ? product.precioVenta : ((product.precio !== undefined && product.precio !== null) ? product.precio : 0);
          var precioCompra = (product.costoPieza !== undefined && product.costoPieza !== null) ? Number(product.costoPieza) : (product.precioCompra || 0);
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
          html += '  <div class="inv-stock ' + (lowStock ? 'low-stock' : '') + '">Stock: ' + this.escapeHtml(this.formatStockPresentation(stock, product.unidadesPorCarton)) + (lowStock ? ' ⚠️ Rellenar' : '') + ' <span class="inv-stock-min">(mín. ' + stockMin + ' piezas)</span></div>';
          html += '  <div class="inv-actions">';
          html += '    <button class="inv-edit" onclick="InventoryManager.editProduct(\'' + id + '\')">Editar</button>';
          html += '    <button class="inv-delete" onclick="InventoryManager.deleteProduct(\'' + id + '\')" title="Eliminar" aria-label="Eliminar"><span class="trash-icon">&#128465;</span></button>';
          html += '  </div>';
          html += '</div>';
        }

        grid.innerHTML = html;
        this.renderInventorySummary();
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
            const unidadesPorCarton = Number((form.unidadesPorCarton && form.unidadesPorCarton.value) || 0);
            const stockCartones = Number((form.stockCartones && form.stockCartones.value) || 0);
            const stockPiezas = Number((form.stock && form.stock.value) || 0);
            if (![unidadesPorCarton, stockCartones, stockPiezas].every(function (value) {
              return Number.isInteger(value) && value >= 0;
            })) {
              throw new Error('Las cantidades de inventario deben ser números enteros no negativos.');
            }
            if (stockCartones > 0 && unidadesPorCarton < 1) {
              throw new Error('Configura las unidades por cartón/charola para capturar stock por paquetes.');
            }
            const stockFieldsUnchanged = !!id &&
              stockCartones === Number(form.dataset.stockCartonesBaseline) &&
              stockPiezas === Number(form.dataset.stockPiezasBaseline);
            const stockTotal = stockFieldsUnchanged
              ? Number(form.dataset.originalStock) || 0
              : stockCartones * unidadesPorCarton + stockPiezas;
            const product = {
              nombre: (form.nombre && form.nombre.value || '').trim(),
              marca: (form.marca && form.marca.value || '').trim(),
              presentacion: (form.presentacion && form.presentacion.value || '').trim(),
              codigoBarras: (form.codigoBarras && form.codigoBarras.value || '').trim(),
              imagen: (form.imagen && form.imagen.value || '').trim(),
              precioCompra: parseFloat((form.precioCompra && form.precioCompra.value) || 0) || 0,
              precioVenta: precioVenta,
              precio: precioVenta,
              costoPieza: parseFloat((form.costoPieza && form.costoPieza.value) || 0) || 0,
              cobroExtraEnvaseFaltantePieza: parseFloat((form.cobroExtraEnvaseFaltantePieza && form.cobroExtraEnvaseFaltantePieza.value) || 0) || 0,
              precioCarton: parseFloat((form.precioCarton && form.precioCarton.value) || 0) || 0,
              costoCarton: parseFloat((form.costoCarton && form.costoCarton.value) || 0) || 0,
              unidadesPorCarton: unidadesPorCarton,
              cobroExtraEnvaseFaltanteCarton: parseFloat((form.cobroExtraEnvaseFaltanteCarton && form.cobroExtraEnvaseFaltanteCarton.value) || 0) || 0,
              precioPromo: parseFloat((form.precioPromo && form.precioPromo.value) || 0) || 0,
              costoPromo: parseFloat((form.costoPromo && form.costoPromo.value) || 0) || 0,
              promocionesVolumen: (function () {
                var levels = [];
                for (var l = 1; l <= 3; l++) {
                  var cant = parseInt((form['promo' + l + 'Cantidad'] && form['promo' + l + 'Cantidad'].value) || 0, 10);
                  var prec = parseFloat((form['promo' + l + 'Precio'] && form['promo' + l + 'Precio'].value) || 0) || 0;
                  if (cant > 0 && prec > 0) levels.push({ cantidad: cant, precio: prec });
                }
                levels.sort(function (a, b) { return a.cantidad - b.cantidad; });
                return levels;
              })(),
              promocionesPorPieza: (form.promocionesPorPieza && form.promocionesPorPieza.value) || '',
              stock: stockTotal,
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
        const raw = DataStore.getItem('fridgeStock');
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
        DataStore.setItem('fridgeStock', String(next));
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
      Auth.requireAdmin();
      try {
        const modal = document.getElementById(this.modalId);
        const form = document.getElementById(this.formId);
        if (!modal || !form) return;
        delete form.dataset.editId;
        delete form.dataset.originalStock;
        delete form.dataset.stockCartonesBaseline;
        delete form.dataset.stockPiezasBaseline;
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
        if (form.costoPieza) form.costoPieza.value = product.costoPieza || 0;
        if (form.cobroExtraEnvaseFaltantePieza) form.cobroExtraEnvaseFaltantePieza.value = product.cobroExtraEnvaseFaltantePieza || 0;
        if (form.precioCarton) form.precioCarton.value = product.precioCarton || 0;
        if (form.costoCarton) form.costoCarton.value = product.costoCarton || 0;
        if (form.unidadesPorCarton) form.unidadesPorCarton.value = product.unidadesPorCarton || 0;
        if (form.cobroExtraEnvaseFaltanteCarton) form.cobroExtraEnvaseFaltanteCarton.value = product.cobroExtraEnvaseFaltanteCarton || 0;
        if (form.precioPromo) form.precioPromo.value = product.precioPromo || 0;
        if (form.costoPromo) form.costoPromo.value = product.costoPromo || 0;
        var promosVol = product.promocionesVolumen || [];
        for (var l = 1; l <= 3; l++) {
          var p = promosVol[l - 1];
          if (form['promo' + l + 'Cantidad']) form['promo' + l + 'Cantidad'].value = p ? p.cantidad : '';
          if (form['promo' + l + 'Precio']) form['promo' + l + 'Precio'].value = p ? p.precio : '';
        }
        if (form.promocionesPorPieza) form.promocionesPorPieza.value = product.promocionesPorPieza || '';
        const packageSize = Number(product.unidadesPorCarton) || 0;
        if (form.stockCartones) form.stockCartones.value = packageSize ? Math.floor((Number(product.stock) || 0) / packageSize) : 0;
        if (form.stock) form.stock.value = packageSize ? (Number(product.stock) || 0) % packageSize : (Number(product.stock) || 0);
        form.dataset.originalStock = String(Number(product.stock) || 0);
        form.dataset.stockCartonesBaseline = String(packageSize ? Math.floor((Number(product.stock) || 0) / packageSize) : 0);
        form.dataset.stockPiezasBaseline = String(packageSize ? (Number(product.stock) || 0) % packageSize : (Number(product.stock) || 0));
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
      html += '<div class="inv-fridge-adjust">';
      html += '  <div class="inv-fridge-input-wrap">';
      html += '    <input type="number" id="inv-fridge-adjust-input" inputmode="numeric" min="-999" max="999" value="0" placeholder="0">';
      html += '    <button type="button" class="inv-fridge-apply" onclick="InventoryManager.adjustFridgeStockByInput()">Aplicar</button>';
      html += '  </div>';
      html += '</div>';
      html += '<button type="button" class="inv-fridge-refill" onclick="InventoryManager.refillFridge()">❄️ Rellenar Nevera</button>';
      return html;
    },

    // Ajuste rápido de ±1 unidad en el stock frío de la nevera.
    adjustFridgeStock: function (delta) {
      try {
        const capacity = this.getFridgeCapacity();
        const current = this.getFridgeStock();
        const next = Math.max(0, Math.min(capacity, current + Number(delta || 0)));
        this.setFridgeStock(next);
        this.render();
        this.notifyInventoryUpdated();
        this.buildFridgePanel();
      } catch (e) {
        console.error('Inventory adjustFridgeStock error:', e);
        showErrorAlert(e && e.message ? e.message : String(e));
      }
    },

    // Ajuste del stock frío usando el valor libre del campo numérico del modal.
    adjustFridgeStockByInput: function () {
      try {
        const input = document.getElementById('inv-fridge-adjust-input');
        const delta = input ? parseInt(input.value || 0, 10) : 0;
        if (!Number.isFinite(delta) || delta === 0) return;
        this.adjustFridgeStock(delta);
        if (input) input.value = 0;
        this.openFridgeModal();
      } catch (e) {
        console.error('Inventory adjustFridgeStockByInput error:', e);
        showErrorAlert(e && e.message ? e.message : String(e));
      }
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
        const generation=this.scanner.generation=(this.scanner.generation||0)+1;

        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        }).then(function (stream) {
          if(self.scanner.generation!==generation||!self.scanner.isScanning){stream.getTracks().forEach(t=>t.stop());return;}
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
          self.scanner.codeReader = ScannerEngine.scan(video, stream, function (result) { if (result) self.applyScannedCode(result.getText()); });

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
        this.scanner.generation=(this.scanner.generation||0)+1;
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
