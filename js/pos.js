// Lógica del punto de venta (POS)
// Catálogo, carrito, palomita de "Pieza Fría", búsqueda rápida, escáner,
// modal de cobro multipago (efectivo / tarjeta-transferencia / mixto) y sincronización con la nevera

// Registro en vivo de ventas: normaliza cada ticket cobrado para construir el
// historial en vivo del turno activo y su archivado dentro del corte de caja.
const POS = {
  cart: [],
  searchTerm: '',
  piezaFriaGlobal: false,
  turnTickets: [], // historial de tickets cobrados en el turno activo
  liveSalesCollapsed: true, // historial colapsado por defecto
  FRIDGE_MAX: 24,
  FRIDGE_KEY: 'fridgeStock',
  CART_KEY: 'cerveceria_cart',
  CUT_LAST_KEY: 'cerveceria_ultimo_corte',
  PAYMENT_METHODS: ['efectivo', 'electronico', 'mixto'],
  payment: {
    method: 'efectivo',
    electronicType: 'tarjeta',
    mixType: 'tarjeta',
    cardChannel: null, // forma de cobro con tarjeta: nfc, qr o terminal
    cashReceived: 0,
    mixCash: 0,
    mixElectronic: 0,
    isOpen: false,
    lastSale: null
  },
  cut: {
    isOpen: false,
    counted: 0,
    isAdmin: false,
    busy: false, // bloquea el modal mientras se ejecuta una acción de cierre
    recorded: null // corte ya registrado en la base de datos (evita duplicados)
  },
  scanner: {
    codeReader: null,
    videoElement: null,
    stream: null,
    isScanning: false,
    isContinuous: false,
    lastScanned: '',
    lastScannedTime: 0,
    debounceMs: 1500
  },

  init() {
    this.loadCart();
    this.loadSearchTerm();
    this.piezaFriaGlobal = this.loadPiezaFriaGlobal();
    this.refreshTurnTickets();
    this.renderProductList();
    this.renderCart();
    this.bindSearch();
    this.bindCameraBtn();
    this.initScannerModal();
    this.bindInventoryListener();
    this.mountLiveSalesPanel();
    this.closePaymentModal();
    this.closeCashCutModal();
  },

  bindInventoryListener() {
    if (this._inventoryListenerBound) return;
    this._inventoryListenerBound = true;
    window.addEventListener('inventory:updated', () => {
      this.renderProductList();
      this.renderCart();
      this.updateFridgeCounter();
    });
  },

  // ---------- Palomita "Pieza Fría" ----------

  renderColdToggle() {
    // La palomita de "Pieza Fría" se monta dentro de la barra de búsqueda.
    // Se busca por id y, como respaldo, por clase para no depender de una
    // sola marca en el HTML.
    const searchBar = document.getElementById('pos-search-bar') ||
      document.querySelector('.pos-search-bar');
    if (!searchBar) return;

    const previous = document.getElementById('pos-cold-toggle');
    if (previous && previous.parentNode) previous.parentNode.removeChild(previous);

    const template = document.getElementById('pos-cold-template');
    if (template && template.content) {
      searchBar.appendChild(template.content.cloneNode(true));
    } else {
      const holder = document.createElement('div');
      holder.innerHTML = `
        <div class="cold-toggle" id="pos-cold-toggle" role="checkbox" aria-checked="false">
          <input type="checkbox" id="pos-cold-checkbox" />
          <label for="pos-cold-checkbox" class="cold-toggle-label">
            <span class="cold-palomita" aria-hidden="true"><span class="cold-palomita-check">✓</span></span>
            <span class="toggle-label">❄️ Marcar como Frío</span>
          </label>
          <span class="fridge-counter" id="pos-fridge-counter" title="Piezas disponibles en la nevera fría">❄️ <span id="pos-fridge-count">0</span>/<span id="pos-fridge-max">24</span></span>
        </div>
      `;
      while (holder.firstChild) searchBar.appendChild(holder.firstChild);
    }

    const checkbox = document.getElementById('pos-cold-checkbox');
    const wrapper = document.getElementById('pos-cold-toggle');
    if (!checkbox || !wrapper) return;

    checkbox.checked = this.piezaFriaGlobal;
    wrapper.setAttribute('aria-checked', String(this.piezaFriaGlobal));
    checkbox.addEventListener('change', (e) => {
      this.piezaFriaGlobal = Boolean(e.target.checked);
      wrapper.setAttribute('aria-checked', String(this.piezaFriaGlobal));
      this.savePiezaFriaGlobal();
      this.updateColdToggleUI();
      this.renderCart();
      this.renderProductList();
    });

    this.updateColdToggleUI();
  },

  updateColdToggleUI() {
    const wrapper = document.getElementById('pos-cold-toggle');
    if (wrapper) {
      wrapper.classList.toggle('is-active', this.piezaFriaGlobal);
    }
    this.updateFridgeCounter();
  },

  updateFridgeCounter() {
    const counter = document.getElementById('pos-fridge-counter');
    const countEl = document.getElementById('pos-fridge-count');
    const maxEl = document.getElementById('pos-fridge-max');
    const stock = this.getFridgeStock();

    if (countEl) countEl.textContent = String(stock);
    if (maxEl) maxEl.textContent = String(this.FRIDGE_MAX);
    if (counter) {
      counter.classList.toggle('low', stock > 0 && stock <= Math.ceil(this.FRIDGE_MAX * 0.25));
      counter.classList.toggle('empty', stock === 0);
      counter.title = 'Piezas disponibles en la nevera fría: ' + stock + ' de ' + this.FRIDGE_MAX;
    }
  },

  // ---------- Contador global de la nevera fría ----------

  getFridgeStock() {
    this.FRIDGE_MAX=Math.max(1,Number(Database.getSettings().fridgeCapacity)||24);
    try {
      const raw = DataStore.getItem(this.FRIDGE_KEY);
      if (raw === null || raw === undefined || raw === '') return this.FRIDGE_MAX;
      const parsed = parseInt(raw, 10);
      if (isNaN(parsed)) return this.FRIDGE_MAX;
      return Math.max(0, Math.min(this.FRIDGE_MAX, parsed));
    } catch (e) {
      return this.FRIDGE_MAX;
    }
  },

  setFridgeStock(value) {
    this.FRIDGE_MAX=Math.max(1,Number(Database.getSettings().fridgeCapacity)||24);
    const parsed = parseInt(value, 10);
    const next = isNaN(parsed) ? this.FRIDGE_MAX : Math.max(0, Math.min(this.FRIDGE_MAX, parsed));
    try {
      DataStore.setItem(this.FRIDGE_KEY, String(next));
    } catch (e) {
      console.error('[POS] No se pudo guardar el contador de la nevera:', e);
    }
    this.updateFridgeCounter();
    return next;
  },

  adjustFridgeStock(delta) {
    return this.setFridgeStock(this.getFridgeStock() + (Number(delta) || 0));
  },

  // ---------- Persistencia del carrito (localStorage) ----------

  // Carga el carrito guardado en localStorage (si existe)
  loadCart() {
    try {
      const raw = DataStore.getItem(this.CART_KEY);
      if (!raw) {
        this.cart = [];
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.cart = [];
        return;
      }
      this.cart = parsed.map(item => {
        const cantidad = Number(item.quantity) || 0;
        const unidadesPorCarton = Number(item.unidadesPorCarton || 0);
        const precioCarton = Number(item.precioCarton || 0);
        const isCarton = unidadesPorCarton > 0 && precioCarton > 0 && cantidad >= unidadesPorCarton;
        const chargeRate = this.getColdChargeRate();
        const isCold = this.normalizeColdFlag(item.piezaFria);
        return {
          productId: item.productId || item.id || null,
          nombre: item.nombre || '',
          marca: item.marca || '',
          precio: Number(item.precio) || 0,
          precioCarton: precioCarton,
          unidadesPorCarton: unidadesPorCarton,
          quantity: cantidad,
          isCarton: isCarton,
          piezaFria: isCold,
          cargoFrio: isCold ? chargeRate * cantidad : Number(item.cargoFrio || 0),
          envaseFaltante: this.normalizeColdFlag(item.envaseFaltante),
          envaseModalidad: item.envaseModalidad || 'pieza',
          envaseCargoPieza: Number(item.envaseCargoPieza || 0),
          envaseCargoCarton: Number(item.envaseCargoCarton || 0)
        };
      }).filter(item => item.quantity > 0);
    } catch (e) {
      console.error('[POS] No se pudo cargar el carrito guardado:', e);
      this.cart = [];
    }
  },

  // Guarda el estado actual del carrito en localStorage
  saveCart() {
    try {
      DataStore.setItem(this.CART_KEY, JSON.stringify(this.cart));
    } catch (e) {
      console.error('[POS] No se pudo guardar el carrito:', e);
    }
  },

  // Carga el término de búsqueda guardado
  loadSearchTerm() {
    try {
      const raw = DataStore.getItem('cerveceria_pos_search');
      this.searchTerm = raw || '';
    } catch (e) {
      this.searchTerm = '';
    }
  },

  // Guarda el término de búsqueda actual
  saveSearchTerm() {
    try {
      DataStore.setItem('cerveceria_pos_search', this.searchTerm || '');
    } catch (e) {}
  },

  // Carga el estado de la palomita "Pieza Fría"
  loadPiezaFriaGlobal() {
    try {
      const raw = DataStore.getItem('cerveceria_pos_cold_toggle');
      return this.normalizeColdFlag(raw);
    } catch (e) {
      return false;
    }
  },

  // Guarda el estado de la palomita "Pieza Fría"
  savePiezaFriaGlobal() {
    try {
      DataStore.setItem('cerveceria_pos_cold_toggle', String(this.piezaFriaGlobal));
    } catch (e) {}
  },

  // Limpia el carrito guardado (tras cobrar o cancelar)
  clearSavedCart() {
    try {
      DataStore.removeItem(this.CART_KEY);
      DataStore.removeItem('cerveceria_pos_search');
      DataStore.removeItem('cerveceria_pos_cold_toggle');
    } catch (e) {}
  },

  // Descuenta una pieza del contador global de la nevera
  reserveColdUnit() {
    if (this.getFridgeStock() <= 0) return false;
    this.adjustFridgeStock(-1);
    return true;
  },

  // Devuelve las piezas reservadas al contador global de la nevera
  releaseColdUnits(qty) {
    const amount = Number(qty) || 0;
    if (amount <= 0) return;
    this.adjustFridgeStock(amount);
  },

  // ---------- Utilidades de datos ----------

  normalizeColdFlag(value) {
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase();
      if (text === '' || text === 'false' || text === '0' || text === 'no') return false;
      return true;
    }
    return Boolean(value);
  },

  findCartItem(productId, isCold) {
    const cold = this.normalizeColdFlag(isCold);
    return this.cart.find(item =>
      item.productId === productId && this.normalizeColdFlag(item.piezaFria) === cold
    );
  },

  getColdUnits() {
    return this.cart.reduce((sum, item) => {
      return this.normalizeColdFlag(item.piezaFria) ? sum + (Number(item.quantity) || 0) : sum;
    }, 0);
  },

  getColdUnitsFor(productId) {
    return this.cart.reduce((sum, item) => {
      if (item.productId !== productId) return sum;
      return this.normalizeColdFlag(item.piezaFria) ? sum + (Number(item.quantity) || 0) : sum;
    }, 0);
  },

  getColdChargeRate() {
    let settings = {};
    try {
      settings = Database.getSettings() || {};
    } catch (e) {
      settings = {};
    }
    const rate = Number(settings.coldCharge);
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
  },

  getColdChargeTotal() {
    return this.getColdChargeRate() * this.getColdUnits();
  },

  // ---------- Búsqueda / escáner ----------

  bindSearch() {
    const searchInput = document.getElementById('pos-search-input');
    if (searchInput) {
      searchInput.value = this.searchTerm;
      searchInput.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.trim();
        this.renderProductList();
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.searchTerm = '';
          searchInput.value = '';
          this.renderProductList();
        }
      });
    }
  },

  bindCameraBtn() {
    const cameraBtn = document.getElementById('pos-camera-btn');
    if (cameraBtn) {
      cameraBtn.addEventListener('click', () => {
        this.openCameraScanner();
      });
    }
  },

  initScannerModal() {
    const continuousCheckbox = document.getElementById('pos-scanner-continuous');
    if (continuousCheckbox) {
      continuousCheckbox.checked = this.scanner.isContinuous;
      continuousCheckbox.addEventListener('change', (e) => {
        this.scanner.isContinuous = e.target.checked;
      });
    }
  },

  getFilteredProducts() {
    const products = Database.getProducts().filter(p => p.activo !== false && (p.stock || 0) > 0);
    if (!this.searchTerm) return products;

    const term = this.searchTerm.toLowerCase();
    return products.filter(p => {
      const nameMatch = p.nombre && p.nombre.toLowerCase().includes(term);
      const marcaMatch = p.marca && p.marca.toLowerCase().includes(term);
      const barcodeMatch = p.codigoBarras && p.codigoBarras.toString().toLowerCase().includes(term);
      const codeMatch = p.codigo && p.codigo.toString().toLowerCase().includes(term);
      return nameMatch || marcaMatch || barcodeMatch || codeMatch;
    });
  },

  renderProductList() {
    const container = document.getElementById('pos-product-list');
    if (!container) return;

    const products = this.getFilteredProducts();
    const settings = Database.getSettings();
    const currency = settings.currencySymbol || '$';
    const coldBadge = this.piezaFriaGlobal
      ? '<span class="product-cold-badge" title="Se agregará como pieza fría">❄️ frío</span>'
      : '';

    let html = '<h2>Productos</h2><div class="product-grid">';
    if (products.length === 0) {
      html += '<div class="product-empty">No se encontraron productos</div>';
    }
    products.forEach(product => {
      const stock = Number(product.stock) || 0;
      const coldStock = product.coldStock !== undefined ? Number(product.coldStock) : 0;
      html += `
        <div class="product-card" onclick="POS.addToCart('${this.jsArg(product.id)}')">
          <div class="product-name">${this.escapeHtml(product.nombre || '')}${coldBadge}</div>
          <div class="product-price">${this.escapeHtml(currency)}${Number(product.precio || 0).toFixed(2)}</div>
          <div class="product-stock">Stock: ${stock}${coldStock > 0 ? ` • ❄️ ${coldStock}` : ''}</div>
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  },

  // ---------- Carrito ----------

  addToCart(productId, forcedCold) {
    const product = Database.getProducts().find(p => p.id === productId);
    if (!product) return;
    if (this.cart.filter(i => i.productId === productId).reduce((s,i)=>s+Number(i.quantity || 0),0) + 1 > Number(product.stock)) { alert('No hay suficiente stock disponible.'); return; }

    const isCold = forcedCold !== undefined
      ? this.normalizeColdFlag(forcedCold)
      : Boolean(this.piezaFriaGlobal);

    const existing = this.cart.find(item =>
      item.productId === productId && this.normalizeColdFlag(item.piezaFria) === isCold
    );

    if (isCold) {
      const check = this.canAddCold(product, productId, 1);
      if (!check.ok) {
        if (check.needConfirm) {
          const accept = window.confirm(check.reason + ' ¿Deseas agregarlo de todas formas?');
          if (!accept) return;
        } else {
          alert(check.reason);
          return;
        }
      } else {
        this.reserveColdUnit();
      }
    } else {
      const stock = Math.max(0, Number(product.stock) || 0);
      const nextQty = (existing ? (Number(existing.quantity) || 0) : 0) + 1;
      if (nextQty > stock) {
        alert('No hay suficiente stock disponible.');
        return;
      }
    }

    if (existing) {
      existing.quantity = (Number(existing.quantity) || 0) + 1;
      const cartonQty = Number(existing.unidadesPorCarton || 0);
      existing.isCarton = cartonQty > 0 && existing.quantity >= cartonQty;
    } else {
      const cartonQty = Number(product.unidadesPorCarton || 0);
      this.cart.push({
        productId: product.id,
        nombre: product.nombre,
        marca: product.marca,
        precio: Number(product.precio) || 0,
        precioCarton: Number(product.precioCarton || 0),
        unidadesPorCarton: cartonQty,
        quantity: 1,
        isCarton: cartonQty > 0 && 1 >= cartonQty,
        piezaFria: isCold,
        envaseFaltante: false,
        envaseModalidad: 'pieza',
        envaseCargoPieza: Number(product.cobroExtraEnvaseFaltantePieza || 0),
        envaseCargoCarton: Number(product.cobroExtraEnvaseFaltanteCarton || 0)
      });
    }

    this.saveCart();
    this.renderCart();
    this.renderProductList();
  },

  // Valida si se pueden agregar piezas frías de un producto
  canAddCold(product, productId, extraQty) {
    const amount = Number(extraQty) || 0;
    const fridge = this.getFridgeStock();
    if (fridge < amount) {
      return {
        ok: false,
        needConfirm: true,
        reason: 'La nevera fría tiene ' + fridge + ' pieza(s) disponible(s).'
      };
    }

    return { ok: true, needConfirm: false, reason: '' };
  },

  removeFromCart(productId, isCold) {
    const item = this.findCartItem(productId, isCold) ||
      this.cart.find(i => i.productId === productId);
    if (!item) return;
    this.removeCartItem(item);
  },

  removeCartItem(item) {
    if (this.normalizeColdFlag(item.piezaFria)) {
      this.releaseColdUnits(Number(item.quantity) || 0);
    }
    this.cart = this.cart.filter(i => i !== item);
    this.saveCart();
    this.renderCart();
    this.renderProductList();
  },

  changeQuantity(productId, delta, isCold) {
    const item = this.findCartItem(productId, isCold) ||
      this.cart.find(i => i.productId === productId);
    if (!item) return;
    this.changeQuantityFor(item, delta);
  },

  setQuantity(productId, quantity, isCold) {
    const item = this.findCartItem(productId, isCold) ||
      this.cart.find(i => i.productId === productId);
    if (!item) return;

    const next = Number(quantity);
    if (!Number.isInteger(next) || next < 1) {
      alert('Ingresa una cantidad entera mayor que cero.');
      this.renderCart();
      return;
    }

    this.changeQuantityFor(item, next - (Number(item.quantity) || 0));
    if (this.cart.includes(item) && Number(item.quantity) !== next) this.renderCart();
  },

  changeQuantityFor(item, delta) {
    const product = Database.getProducts().find(p => p.id === item.productId);
    const isCold = this.normalizeColdFlag(item.piezaFria);
    const step = Number(delta) || 0;
    const current = Number(item.quantity) || 0;
    const next = current + step;

    if (next < 1) {
      this.removeCartItem(item);
      return;
    }

    if (isCold) {
      if (step > 0) {
        const check = this.canAddCold(product, item.productId, step);
        if (!check.ok) {
          if (check.needConfirm) {
            const accept = window.confirm(check.reason + ' ¿Deseas agregarlo de todas formas?');
            if (!accept) return;
          } else {
            alert(check.reason);
            return;
          }
        } else {
          this.adjustFridgeStock(-step);
        }
      } else {
        this.releaseColdUnits(-step);
      }
    } else {
      const stock = product ? Math.max(0, Number(product.stock) || 0) : Infinity;
      if (next > stock) {
        alert('No hay suficiente stock disponible.');
        return;
      }
    }

    item.quantity = next;
    const cartonQty = Number(product && product.unidadesPorCarton || 0);
    item.isCarton = cartonQty > 0 && next >= cartonQty;
    this.saveCart();
    this.renderCart();
    this.renderProductList();
  },

  toggleCold(productId, isCold) {
    const item = this.findCartItem(productId, isCold) ||
      this.cart.find(i => i.productId === productId);
    if (!item) return;

    const product = Database.getProducts().find(p => p.id === item.productId);
    const targetCold = !this.normalizeColdFlag(isCold);
    const qty = Number(item.quantity) || 0;

    if (targetCold) {
      const check = this.canAddCold(product, item.productId, qty);
      if (!check.ok) {
        if (check.needConfirm) {
          const accept = window.confirm(check.reason + ' ¿Deseas marcar como frío de todas formas?');
          if (!accept) return;
        } else {
          alert(check.reason);
          return;
        }
      } else {
        this.adjustFridgeStock(-qty);
      }
    } else {
      this.releaseColdUnits(qty);
    }

    const other = this.cart.find(i =>
      i !== item &&
      i.productId === item.productId &&
      this.normalizeColdFlag(i.piezaFria) === targetCold
    );

if (other) {
        other.quantity = (Number(other.quantity) || 0) + qty;
        this.cart = this.cart.filter(i => i !== item);
      } else {
        item.piezaFria = targetCold;
      }

      this.saveCart();
      this.renderCart();
      this.renderProductList();
    },

  canBeCold(product) {
    if (!product) return false;
    const coldStock = product.coldStock !== undefined ? Number(product.coldStock) : 0;
    return this.getFridgeStock() > 0;
  },

  // ---------- Control de envase faltante ----------

  toggleEnvaseFaltante(productId, isCold) {
    const cold = this.normalizeColdFlag(isCold);
    const item = this.findCartItem(productId, cold) || this.cart.find(i => i.productId === productId);
    if (!item) return;
    item.envaseFaltante = !this.normalizeColdFlag(item.envaseFaltante);
    this.saveCart();
    this.renderCart();
    this.renderSummaryTotals();
  },

  getEnvaseChargeTotal() {
    return this.cart.reduce((sum, item) => sum + this.getItemEnvaseCharge(item), 0);
  },

  // Cargo de envase por ítem individual:
  // - Cartón completo: tarifa fija por cartón (ej. $100), sin multiplicar por piezas contenidas
  // - Piezas sueltas: tarifa por pieza (ej. $10) multiplicada por cantidad
  getItemEnvaseCharge(item) {
    if (!this.normalizeColdFlag(item.envaseFaltante)) return 0;
    const qty = Number(item.quantity) || 0;
    const cartonQty = Number(item.unidadesPorCarton || 0);
    const cartonPrice = Number(item.precioCarton || 0);
    const fullCartons = cartonQty > 0 ? Math.floor(qty / cartonQty) : 0;
    const isFullCarton = fullCartons > 0 && cartonPrice > 0;

    if (isFullCarton) {
      const cargoCarton = Number(item.envaseCargoCarton || 0);
      let total = fullCartons * cargoCarton;
      const remainder = qty % cartonQty;
      if (remainder > 0) {
        const cargoPieza = Number(item.envaseCargoPieza || 0);
        total += remainder * cargoPieza;
      }
      return total;
    }
    // Piezas sueltas: cargo por pieza
    const cargoPieza = Number(item.envaseCargoPieza || 0);
    return qty * cargoPieza;
  },

  // ---------- Totales ----------

  getSubtotal() {
    return this.cart.reduce((sum, item) => {
      return sum + this.getItemSubtotal(item);
    }, 0);
  },

  // Detecta qué promoción por volumen (paquete) aplica a un ítem del carrito.
  // Retorna { cantidad, precio } si hay coincidencia EXACTA, o null si no aplica.
  // Es un método puro: no modifica el ítem ni tiene efectos secundarios.
  getVolumePromoInfo(item) {
    const qty = Number(item.quantity) || 0;
    const product = (typeof Database !== 'undefined' && Database.getProducts)
      ? Database.getProducts().find(p => p.id === item.productId)
      : null;
    const promos = (product && product.promocionesVolumen) || [];
    for (const promo of promos) {
      const promoQty = Number(promo.cantidad) || 0;
      const promoPrice = Number(promo.precio) || 0;
      if (promoQty > 0 && promoPrice > 0 && qty === promoQty) {
        return { cantidad: promoQty, precio: promoPrice };
      }
    }
    return null;
  },

  // Subtotal de producto de una línea del carrito: aplica jerarquía de precios:
  // 1. Cartón/Charola Completo (mayoreo cerrado) si qty >= unidadesPorCarton.
  // 2. Promoción por Volumen (paquete) si qty coincide EXACTAMENTE con cantidad configurada.
  // 3. Precio unitario normal si no aplica promoción ni cartón.
  // Cada nivel se cobra como precio fijo total, sin descuentos traslapados.
  getItemSubtotal(item) {
    const qty = Number(item.quantity) || 0;
    const unitPrice = Number(item.precio) || 0;
    const cartonQty = Number(item.unidadesPorCarton || 0);
    const cartonPrice = Number(item.precioCarton || 0);

    // 1. Cartón/Charola Completo: máxima prioridad (mayoreo cerrado)
    if (cartonQty > 0 && cartonPrice > 0 && qty >= cartonQty) {
      const fullCartons = Math.floor(qty / cartonQty);
      const remainder = qty % cartonQty;
      const remainderSubtotal = remainder > 0
        ? this.getItemSubtotal({ ...item, quantity: remainder })
        : 0;
      return fullCartons * cartonPrice + remainderSubtotal;
    }

    // 2. Promociones por Volumen: coincidencia EXACTA con cantidad configurada.
    //    Se cobra directamente el precio total del paquete configurado.
    const promoInfo = this.getVolumePromoInfo(item);
    if (promoInfo) {
      return promoInfo.precio;
    }

    // 3. Precio unitario normal (sin promoción ni cartón)
    return unitPrice * qty;
  },

  // Evalúa las promociones activas contra el carrito: combos completos, descuentos y faltantes
  getPromoEvaluation() {
    return { subtotal: this.getSubtotal(), discount: 0, applications: [], pending: [] };
  },

  getPromoDiscount() {
    return Math.max(0, Number(this.getPromoEvaluation().discount) || 0);
  },

  // ---------- Promociones por volumen por producto (paquetes: ej. 2x$50, 6x$150) ----------

  // Las promociones por volumen se aplican directamente como precio fijo del paquete
  // dentro de getItemSubtotal(). No hay descuentos adicionales que aplicar aquí,
  // evitando doble conteo o cálculos de descuento automáticos extraños.
  getVolumePromoDiscount() {
    return 0;
  },

  getTotal() {
    return Math.max(0, this.getSubtotal() + this.getColdChargeTotal() + this.getEnvaseChargeTotal() - this.getPromoDiscount() - this.getVolumePromoDiscount());
  },

  getCurrencySymbol() {
    try {
      const settings = Database.getSettings() || {};
      return settings.currencySymbol || '$';
    } catch (e) {
      return '$';
    }
  },

  formatMoney(value) {
    const amount = Number(value);
    const safe = Number.isFinite(amount) ? amount : 0;
    return this.getCurrencySymbol() + safe.toFixed(2);
  },

  renderCart() {
    const container = document.getElementById('pos-cart');
    if (!container) return;

    const settings = Database.getSettings();
    const currency = settings.currencySymbol || '$';
    const chargeRate = this.getColdChargeRate();

    let html = '<h2>Ticket</h2>';
    if (this.cart.length === 0) {
      html += '<div class="cart-empty">Carrito vacío</div>';
    } else {
      html += '<div class="cart-items-grid">';
      this.cart.forEach(item => {
        const isCold = this.normalizeColdFlag(item.piezaFria);
        const idArg = this.jsArg(item.productId);
        const coldArg = isCold ? 'true' : 'false';
        const qty = Number(item.quantity) || 0;
        const price = Number(item.precio) || 0;
        const lineCharge = isCold ? chargeRate * qty : 0;

        // ---------- Detección automática de cartón/charola completo (dinámica) ----------
        const cartonQty = Number(item.unidadesPorCarton || 0);
        const cartonPrice = Number(item.precioCarton || 0);
        const fullCartons = cartonQty > 0 ? Math.floor(qty / cartonQty) : 0;
        const isFullCarton = fullCartons > 0 && cartonPrice > 0;
        const productSubtotal = this.getItemSubtotal(item);

        // ---------- Control de envase faltante ----------
        const envaseChecked = this.normalizeColdFlag(item.envaseFaltante);
        const envaseLineCharge = envaseChecked ? this.getItemEnvaseCharge(item) : 0;

        const lineTotal = productSubtotal + lineCharge + envaseLineCharge;

        let envaseHtml = '';
        const envaseUnitLabel = item.envaseModalidad === 'carton'
          ? Number(item.envaseCargoCarton || 0)
          : Number(item.envaseCargoPieza || 0);
        const hasEnvaseCargo = envaseUnitLabel > 0;

        if (hasEnvaseCargo) {
          envaseHtml = `
            <label class="cart-envase" style="display:inline-flex;align-items:center;gap:6px;">
              <input type="checkbox" class="cart-envase-checkbox" ${envaseChecked ? 'checked' : ''}
                onchange="POS.toggleEnvaseFaltante('${idArg}', ${coldArg})"
                title="Marcar si el cliente no devuelve el envase" />
              <span style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">Falta envase (+${this.escapeHtml(currency)}${envaseUnitLabel.toFixed(2)})</span>
            </label>`;
        }

        const envaseLineHtml = envaseLineCharge > 0
          ? `<span class="cart-tag cart-tag-envase">+${this.escapeHtml(currency)}${envaseLineCharge.toFixed(2)} envase</span>`
          : '';

        const tempHtml = isCold
          ? `<button type="button" class="temp-indicator temp-cold" onclick="POS.toggleCold('${idArg}', true)" onkeydown="if(event.key==='Enter'||event.key===' '){POS.toggleCold('${idArg}', true);}" title="Pieza fría (toca para quitar la marca)">❄️ <span class="temp-check">✓</span> Frío</button>`
          : `<button type="button" class="temp-indicator temp-ambient" onclick="POS.toggleCold('${idArg}', false)" onkeydown="if(event.key==='Enter'||event.key===' '){POS.toggleCold('${idArg}', false);}" title="Toca para marcar como pieza fría">❄️ Frío</button>`;

        const chargeHtml = lineCharge > 0
          ? `<span class="cart-tag cart-tag-cold">+${this.escapeHtml(currency)}${lineCharge.toFixed(2)} frío</span>`
          : '';

        const cartonBadge = isFullCarton
          ? `<span class="cart-tag cart-tag-carton">📦 ${fullCartons} ${fullCartons === 1 ? 'cartón' : 'cartones'} completo${fullCartons === 1 ? '' : 's'} · ${this.escapeHtml(currency)}${cartonPrice.toFixed(2)} c/u</span>`
          : '';

        html += `
          <div class="cart-item-card${isCold ? ' is-cold' : ''}">
            <div class="cart-item-body">
              <div class="cart-item-name">
                <span class="cart-item-title">${this.escapeHtml(item.nombre || '')}</span>
                <div class="cart-item-tags">
                  ${tempHtml}
                  ${chargeHtml}
                  ${envaseHtml}
                  ${envaseLineHtml}
                  ${cartonBadge}
                </div>
              </div>
              <div class="cart-item-price">${this.escapeHtml(currency)}${isFullCarton ? cartonPrice.toFixed(2) : price.toFixed(2)}</div>
              <div class="cart-item-qty">
                <button type="button" class="btn-qty" onclick="POS.changeQuantity('${idArg}', -1, ${coldArg})">-</button>
                <input type="number" class="cart-qty-value" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" min="1" step="1" value="${qty}"
                  aria-label="Cantidad de ${this.escapeHtml(item.nombre || 'producto')}"
                  onfocus="this.select()" onkeydown="if(event.key==='Enter'){event.preventDefault();POS.setQuantity('${idArg}',this.value,${coldArg});}"
                  onchange="POS.setQuantity('${idArg}', this.value, ${coldArg})" />
                <button type="button" class="btn-qty" onclick="POS.changeQuantity('${idArg}', 1, ${coldArg})">+</button>
              </div>
              <div class="cart-item-total">${this.escapeHtml(currency)}${lineTotal.toFixed(2)}</div>
            </div>
            <button type="button" class="btn-delete" onclick="POS.removeFromCart('${idArg}', ${coldArg})" title="Eliminar producto">×</button>
          </div>
        `;
      });
      html += '</div>';
      html += this.renderCartPromos(currency);
    }

    container.innerHTML = html;
    this.renderSummaryTotals();

    const chargeBtn = document.getElementById('pos-charge-btn');
    if (chargeBtn) {
      const hasItems = this.cart.length > 0;
      chargeBtn.disabled = !hasItems;
      chargeBtn.classList.toggle('is-empty', !hasItems);
      chargeBtn.title = hasItems
        ? 'Cobrar ' + this.formatMoney(this.getTotal())
        : 'Agrega productos al ticket para cobrar';
    }
  },

  // Promociones aplicadas al ticket (combos detectados) y pistas de combos incompletos
  renderCartPromos(currency) {
    const evaluation = this.getPromoEvaluation();
    const applications = evaluation.applications || [];
    const pending = evaluation.pending || [];
    const volumeDiscount = this.getVolumePromoDiscount();

    if (!applications.length && !pending.length && volumeDiscount <= 0) return '';

    let html = '<div class="cart-promos">';

    applications.forEach(app => {
      const pieces = (app.detalle || []).map(d => d.cantidad + 'x ' + d.nombre).join(' • ');
      const sets = app.combos > 1 ? ' (' + app.combos + ' combos)' : '';
      const detail = pieces || this.getPromoTypeLabel(app.tipo) + ' ' + app.valor + (app.tipo === 'monto' ? '' : '%');

      html += `
        <div class="cart-promo">
          <span class="cart-promo-tag">🎁 ${this.escapeHtml(app.nombre || '')}${sets}</span>
          <span class="cart-promo-detail">${this.escapeHtml(detail)}</span>
          <span class="cart-promo-value">-${this.escapeHtml(currency)}${(Number(app.discount) || 0).toFixed(2)}</span>
        </div>
      `;
    });

    if (volumeDiscount > 0) {
      html += `
        <div class="cart-promo">
          <span class="cart-promo-tag">📦 Descuento por volumen</span>
          <span class="cart-promo-detail">Paquetes aplicados automáticamente</span>
          <span class="cart-promo-value">-${this.escapeHtml(currency)}${volumeDiscount.toFixed(2)}</span>
        </div>
      `;
    }

    pending.forEach(entry => {
      const faltan = (entry.faltan || []).map(f => f.cantidad + 'x ' + f.nombre).join(', ');
      html += `
        <div class="cart-promo is-pending">
          <span class="cart-promo-tag">Falta para “${this.escapeHtml(entry.nombre || '')}”</span>
          <span class="cart-promo-detail">${this.escapeHtml(faltan)}</span>
        </div>
      `;
    });

    html += '</div>';
    return html;
  },

  getPromoTypeLabel(tipo) {
    if (tipo === 'porcentaje') return 'Porcentaje';
    if (tipo === 'monto') return 'Monto fijo';
    if (tipo === 'volumen') return 'Por volumen';
    if (tipo === 'happy_hour') return 'Happy Hour';
    return tipo || 'Descuento';
  },

  // Resumen unico del ticket: se renderiza en la barra de totales, sobre el boton COBRAR
  renderSummaryTotals() {
    const coldCharge = this.getColdChargeTotal();
    const evaluation = this.getPromoEvaluation();
    const promoDiscount = Math.max(0, Number(evaluation.discount) || 0);
    const volumeDiscount = this.getVolumePromoDiscount();

    const subtotalEl = document.getElementById('pos-subtotal');
    if (subtotalEl) {
      subtotalEl.textContent = this.formatMoney(this.getSubtotal());
      subtotalEl.classList.remove('value-pop');
      void subtotalEl.offsetWidth;
      subtotalEl.classList.add('value-pop');
    }

    const coldRowEl = document.getElementById('pos-cold-charge-row');
    if (coldRowEl) coldRowEl.hidden = coldCharge <= 0;

    const coldEl = document.getElementById('pos-cold-charge');
    if (coldEl) coldEl.textContent = this.formatMoney(coldCharge);

    this.renderPromoDiscountRow(evaluation, promoDiscount);
    this.renderVolumePromoDiscountRow(volumeDiscount);

    const totalEl = document.getElementById('pos-total');
    if (totalEl) {
      totalEl.textContent = this.formatMoney(this.getTotal());
      totalEl.classList.remove('value-pop');
      void totalEl.offsetWidth;
      totalEl.classList.add('value-pop');
    }
  },

  // Fila de descuento por promociones: se inserta sola en la barra de totales del POS
  renderPromoDiscountRow(evaluation, promoDiscount) {
    const row = this.ensurePromoDiscountRow();
    if (!row) return;

    row.hidden = promoDiscount <= 0;

    const labelEl = row.querySelector('.pos-totals-label');
    if (labelEl) {
      const combos = (evaluation.applications || []).filter(app => app.esCombo).map(app => app.nombre);
      labelEl.textContent = combos.length
        ? 'Descuento promo (' + combos.join(', ') + ')'
        : 'Descuento promo';
    }

    const valueEl = row.querySelector('.pos-totals-value');
    if (valueEl) valueEl.textContent = '-' + this.formatMoney(promoDiscount);
  },

  ensurePromoDiscountRow() {
    const existing = document.getElementById('pos-promo-discount-row');
    if (existing) return existing;

    const totals = document.querySelector('.pos-totals');
    if (!totals) return null;

    const grandRow = totals.querySelector('.pos-totals-grand');
    const row = document.createElement('div');
    row.id = 'pos-promo-discount-row';
    row.className = 'pos-totals-row pos-totals-promo';
    row.hidden = true;
    row.innerHTML = '<span class="pos-totals-label">Descuento promo</span><span class="pos-totals-value">-$0.00</span>';

    if (grandRow && grandRow.parentNode) {
      grandRow.parentNode.insertBefore(row, grandRow);
    } else {
      totals.appendChild(row);
    }

    return row;
  },

  // Fila de descuento por promociones de volumen por producto (paquetes: ej. 2x$50)
  renderVolumePromoDiscountRow(volumeDiscount) {
    const row = this.ensureVolumePromoDiscountRow();
    if (!row) return;
    row.hidden = volumeDiscount <= 0;
    const valueEl = row.querySelector('.pos-totals-value');
    if (valueEl) valueEl.textContent = '-' + this.formatMoney(volumeDiscount);
  },

  ensureVolumePromoDiscountRow() {
    const existing = document.getElementById('pos-volume-promo-discount-row');
    if (existing) return existing;

    const totals = document.querySelector('.pos-totals');
    if (!totals) return null;

    const grandRow = totals.querySelector('.pos-totals-grand');
    const row = document.createElement('div');
    row.id = 'pos-volume-promo-discount-row';
    row.className = 'pos-totals-row pos-totals-volume-promo';
    row.hidden = true;
    row.innerHTML = '<span class="pos-totals-label">Descuento por volumen</span><span class="pos-totals-value">-$0.00</span>';

    if (grandRow && grandRow.parentNode) {
      grandRow.parentNode.insertBefore(row, grandRow);
    } else {
      totals.appendChild(row);
    }

    return row;
  },

  // ---------- Cobro multipago (modal) ----------

  // Estructura completa del modal de cobro.
  // Se construye desde JS para que el modal sea siempre una ventana flotante
  // centrada (nunca un bloque plano en el flujo de la pagina).
  buildPaymentModalMarkup() {
    return `
      <div class="payment-backdrop" data-payment-close="true"></div>

      <div class="payment-shell">
        <!-- Pantalla 1: cobro -->
        <div class="payment-screen" id="pos-pay-screen-cobro">
          <header class="payment-header">
            <div class="payment-header-text">
              <h2 id="pos-payment-title">Cobrar venta</h2>
              <span class="payment-subtitle" id="pos-pay-subtitle">Ticket actual</span>
            </div>
            <button type="button" class="payment-icon-btn" data-payment-close="true" aria-label="Cerrar cobro">✕</button>
          </header>

          <div class="payment-total-card">
            <span class="payment-total-label">Total a pagar</span>
            <strong class="payment-total-value" id="pos-pay-total">$0.00</strong>
            <span class="payment-total-detail" id="pos-pay-total-detail"></span>
          </div>

          <div class="payment-items" id="pos-pay-items">
            <div class="payment-items-title">Productos del ticket</div>
            <div id="pos-pay-items-list"></div>
          </div>

          <div class="payment-tabs" role="tablist" aria-label="Método de pago">
            <button type="button" class="payment-tab is-active" data-payment-method="efectivo" role="tab" aria-selected="true">
              <span class="payment-tab-icon">💵</span><span class="payment-tab-label">Efectivo</span>
            </button>
            <button type="button" class="payment-tab" data-payment-method="tarjeta" role="tab" aria-selected="false">
              <span class="payment-tab-icon">💳</span><span class="payment-tab-label">Tarjeta</span>
            </button>
            <button type="button" class="payment-tab" data-payment-method="transferencia" role="tab" aria-selected="false">
              <span class="payment-tab-icon">🏦</span><span class="payment-tab-label">Transferencia</span>
            </button>
            <button type="button" class="payment-tab" data-payment-method="mixto" role="tab" aria-selected="false">
              <span class="payment-tab-icon">🔀</span><span class="payment-tab-label">Mixto</span>
            </button>
          </div>

          <div class="payment-body">
            <!-- Efectivo -->
            <section class="payment-section is-active" data-payment-section="efectivo">
              <label class="payment-field">
                <span class="payment-field-label">Efectivo recibido</span>
                <input type="number" id="pos-pay-cash" class="payment-input" inputmode="decimal" step="0.01" min="0" placeholder="0.00" autocomplete="off" />
              </label>

              <div class="payment-summary">
                <div class="payment-summary-row"><span>Total</span><span id="pos-pay-sum-total">$0.00</span></div>
                <div class="payment-summary-row"><span>Recibido</span><span id="pos-pay-sum-received">$0.00</span></div>
                <div class="payment-summary-row is-change" id="pos-pay-sum-change-row">
                  <span>Cambio</span><span id="pos-pay-sum-change">$0.00</span>
                </div>
              </div>

              <p class="payment-hint" id="pos-pay-hint"></p>
            </section>

            <!-- Tarjeta / Transferencia -->
            <section class="payment-section" data-payment-section="electronico">
              <div class="payment-amount-card">
                <span class="payment-total-label">A cobrar con <span id="pos-pay-electronic-label">tarjeta</span></span>
                <strong class="payment-amount-value" id="pos-pay-electronic-amount">$0.00</strong>
                <span class="payment-total-detail">Se carga el monto exacto del total, sin cambio.</span>
              </div>

              <!-- Opciones de cobro con tarjeta (Mercado Pago): NFC, QR y terminal física -->
              <div class="pay-card-options" id="pos-pay-card-options"></div>

              <div class="payment-summary">
                <div class="payment-summary-row"><span>Total</span><span id="pos-pay-card-total">$0.00</span></div>
                <div class="payment-summary-row"><span>Método</span><span id="pos-pay-card-method">Tarjeta</span></div>
                <div class="payment-summary-row is-change"><span>Cambio</span><span>$0.00</span></div>
              </div>

              <p class="payment-hint" id="pos-pay-card-hint">Confirma el cobro en el lector o en la app bancaria y continua con "Confirmar Pago".</p>
            </section>

            <!-- Mixto -->
            <section class="payment-section" data-payment-section="mixto">
              <div class="payment-mix-grid">
                <label class="payment-field">
                  <span class="payment-field-label">Efectivo recibido</span>
                  <input type="number" id="pos-pay-mix-cash" class="payment-input" inputmode="decimal" step="0.01" min="0" placeholder="0.00" autocomplete="off" />
                </label>
                <label class="payment-field">
                  <span class="payment-field-label">Tarjeta / Transferencia</span>
                  <input type="number" id="pos-pay-mix-electronic" class="payment-input" inputmode="decimal" step="0.01" min="0" placeholder="0.00" autocomplete="off" />
                </label>
              </div>

              <div class="payment-chip-group" id="pos-pay-mix-types">
                <button type="button" class="payment-chip is-active" data-mix-type="tarjeta">💳 Tarjeta</button>
                <button type="button" class="payment-chip" data-mix-type="transferencia">🏦 Transferencia</button>
              </div>

              <div class="payment-summary">
                <div class="payment-summary-row"><span>Total</span><span id="pos-pay-mix-total">$0.00</span></div>
                <div class="payment-summary-row"><span>Aplicado en efectivo</span><span id="pos-pay-mix-applied">$0.00</span></div>
                <div class="payment-summary-row"><span>Tarjeta / Transferencia</span><span id="pos-pay-mix-electronic-row">$0.00</span></div>
                <div class="payment-summary-row is-change" id="pos-pay-mix-change-row">
                  <span>Cambio</span><span id="pos-pay-mix-change">$0.00</span>
                </div>
              </div>

              <p class="payment-hint" id="pos-pay-mix-hint"></p>
            </section>
          </div>

          <footer class="payment-footer">
            <button type="button" class="btn secondary" data-payment-close="true">Cancelar</button>
            <button type="button" class="btn" id="pos-pay-confirm">Confirmar Pago</button>
          </footer>
        </div>

        <!-- Pantalla 2: confirmacion / ticket digital -->
        <div class="payment-screen" id="pos-pay-screen-success">
          <header class="payment-header">
            <div class="payment-header-text">
              <h2>Venta completada</h2>
              <span class="payment-subtitle" id="pos-pay-success-subtitle">Transaccion registrada</span>
            </div>
            <button type="button" class="payment-icon-btn" data-payment-close="true" aria-label="Cerrar">✕</button>
          </header>

          <div class="payment-success-body">
            <div class="payment-success-icon">✓</div>
            <div class="payment-success-grid">
              <div class="payment-success-item"><span>Total</span><strong id="pos-pay-success-total">$0.00</strong></div>
              <div class="payment-success-item"><span>Método</span><strong id="pos-pay-success-method">Efectivo</strong></div>
              <div class="payment-success-item"><span>Cambio</span><strong id="pos-pay-success-change">$0.00</strong></div>
            </div>
            <button type="button" class="payment-link-btn" id="pos-pay-toggle-ticket">Ver ticket digital</button>
            <pre class="payment-ticket" id="pos-pay-ticket"></pre>
          </div>

          <footer class="payment-footer">
            <button type="button" class="btn secondary" id="pos-pay-print">Imprimir Ticket</button>
            <button type="button" class="btn" id="pos-pay-new-sale">Nueva Venta</button>
          </footer>
        </div>
      </div>
    `;
  },

  ensurePaymentModal() {
    let modal = document.getElementById('pos-payment-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pos-payment-modal';
      modal.className = 'payment-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'pos-payment-title');
      modal.innerHTML = this.buildPaymentModalMarkup();
      document.body.appendChild(modal);
    }
    if (!modal) return null;

    if (modal.dataset.paymentBound !== '1') {
      modal.dataset.paymentBound = '1';
      this.bindPaymentModal(modal);
    }
    return modal;
  },

  bindPaymentModal(modal) {
    modal.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      if (target.closest('[data-payment-close]')) {
        this.closePaymentModal();
        return;
      }

      const methodBtn = target.closest('[data-payment-method]');
      if (methodBtn) {
        this.setPaymentMethod(methodBtn.dataset.paymentMethod);
        return;
      }

      const mixType = target.closest('[data-mix-type]');
      if (mixType) {
        this.payment.mixType = mixType.dataset.mixType;
        this.renderPaymentModal();
        return;
      }

      // Sub-opciones de cobro con tarjeta (NFC / QR / terminal física)
      const cardOption = target.closest('[data-card-option]');
      if (cardOption) {
        this.setCardChannel(cardOption.dataset.cardOption);
        return;
      }
    });

    const cashInput = document.getElementById('pos-pay-cash');
    if (cashInput) {
      cashInput.addEventListener('input', (e) => {
        this.setCashReceived(e.target.value);
      });
    }

    const mixCashInput = document.getElementById('pos-pay-mix-cash');
    if (mixCashInput) {
      mixCashInput.addEventListener('input', (e) => {
        this.setMixCash(e.target.value);
      });
    }

    const mixElectronicInput = document.getElementById('pos-pay-mix-electronic');
    if (mixElectronicInput) {
      mixElectronicInput.addEventListener('input', (e) => {
        this.setMixElectronic(e.target.value);
      });
    }

    const confirmBtn = document.getElementById('pos-pay-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => this.confirmPayment());
    }

    const newSaleBtn = document.getElementById('pos-pay-new-sale');
    if (newSaleBtn) {
      newSaleBtn.addEventListener('click', () => this.closePaymentModal());
    }

    const printBtn = document.getElementById('pos-pay-print');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        if (this.payment.lastSale) this.printTicket(this.payment.lastSale);
      });
    }

    const toggleTicketBtn = document.getElementById('pos-pay-toggle-ticket');
    if (toggleTicketBtn) {
      toggleTicketBtn.addEventListener('click', () => {
        const ticket = document.getElementById('pos-pay-ticket');
        if (!ticket) return;
        const visible = ticket.classList.toggle('is-visible');
        toggleTicketBtn.textContent = visible ? 'Ocultar ticket digital' : 'Ver ticket digital';
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.payment.isOpen) {
        this.closePaymentModal();
      }
    });
  },

  openPaymentModal() {
    if (!this.cart.length) {
      alert('Agrega productos al ticket antes de cobrar.');
      return;
    }

    const modal = this.ensurePaymentModal();
    if (!modal) {
      alert('No se pudo abrir el modal de cobro.');
      return;
    }

    this.resetPaymentState();
    modal.classList.add('is-active');
    modal.classList.remove('is-success');
    this.payment.isOpen = true;
    this.renderPaymentModal();

    setTimeout(() => {
      const input = document.getElementById('pos-pay-cash');
      if (input) {
        input.focus();
        input.select();
      }
    }, 80);
  },

  closePaymentModal() {
    const modal = document.getElementById('pos-payment-modal');
    if (modal) {
      modal.classList.remove('is-active');
      modal.classList.remove('is-success');
    }
    this.payment.isOpen = false;
  },

  resetPaymentState() {
    const total = this.getTotal();
    this.payment.method = 'efectivo';
    this.payment.electronicType = 'tarjeta';
    this.payment.mixType = 'tarjeta';
    this.payment.cardChannel = null;
    this.payment.cardReference = (typeof SalesPayment !== 'undefined') ? SalesPayment.buildReference() : '';
    this.payment.cashReceived = 0;
    this.payment.mixCash = 0;
    this.payment.mixElectronic = total;
    this.payment.lastSale = null;
    if (typeof SalesPayment !== 'undefined' && SalesPayment.reset) SalesPayment.reset();
  },

  setPaymentMethod(method) {
    const value = String(method || '').toLowerCase();

    // Tarjeta y Transferencia comparten la seccion de cobro electronico
    if (value === 'tarjeta' || value === 'transferencia') {
      this.payment.method = 'electronico';
      this.payment.electronicType = value;
      this.renderPaymentModal();
      return;
    }

    if (!this.PAYMENT_METHODS.includes(value)) return;
    const total = this.getTotal();

    this.payment.method = value;

    if (value === 'mixto') {
      this.payment.mixCash = this.payment.cashReceived;
      this.payment.mixElectronic = Math.max(0, total - this.payment.mixCash);
    }

    this.renderPaymentModal();
  },

  // Elige la forma de cobro con tarjeta: nfc, qr o terminal física
  setCardChannel(channel) {
    if (typeof SalesPayment === 'undefined') return;
    this.payment.cardChannel = SalesPayment.normalizeChannel(channel);
    this.renderPaymentModal();
  },

  // Canal de cobro con tarjeta seleccionado (por defecto: terminal física)
  getCardChannel() {
    if (typeof SalesPayment === 'undefined') return 'terminal';
    return SalesPayment.normalizeChannel(this.payment.cardChannel);
  },

  // Datos del cobro actual que necesita el módulo de opciones de tarjeta
  getCardContext() {
    const session = this.getSessionInfo();
    return {
      total: this.getTotal(),
      currency: this.getCurrencySymbol(),
      method: this.payment.electronicType,
      reference: this.payment.cardReference || '',
      folio: session ? this.formatTurno(session.turnoNumero) : '',
      channel: this.getCardChannel()
    };
  },

  // Pestana activa del selector de metodo de pago
  isPaymentTabActive(method) {
    const value = String(method || '').toLowerCase();
    if (value === 'tarjeta' || value === 'transferencia') {
      return this.payment.method === 'electronico' && this.payment.electronicType === value;
    }
    return value === this.payment.method;
  },

  setCashReceived(value) {
    this.payment.cashReceived = Math.max(0, Number(value) || 0);
    this.renderPaymentModal();
  },

  setMixCash(value) {
    const total = this.getTotal();
    const cash = Math.max(0, Number(value) || 0);
    this.payment.mixCash = cash;
    this.payment.mixElectronic = Math.min(total, Math.max(0, total - cash));
    this.renderPaymentModal();
  },

  setMixElectronic(value) {
    const total = this.getTotal();
    const electronic = Math.min(total, Math.max(0, Number(value) || 0));
    this.payment.mixElectronic = electronic;
    const applied = total - electronic;
    if (this.payment.mixCash < applied) {
      this.payment.mixCash = applied;
    }
    this.renderPaymentModal();
  },

  renderPaymentModal() {
    const modal = document.getElementById('pos-payment-modal');
    if (!modal) return;

    const total = this.getTotal();
    const currency = this.getCurrencySymbol();
    const items = this.cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const coldUnits = this.getColdUnits();

    const totalEl = document.getElementById('pos-pay-total');
    if (totalEl) totalEl.textContent = currency + total.toFixed(2);

    const detailEl = document.getElementById('pos-pay-total-detail');
    if (detailEl) {
      const parts = [items + (items === 1 ? ' producto' : ' productos')];
      if (coldUnits > 0) parts.push(coldUnits + (coldUnits === 1 ? ' pieza fría' : ' piezas frías'));
      detailEl.textContent = parts.join(' • ');
    }

    const subtitle = document.getElementById('pos-pay-subtitle');
    if (subtitle) {
      subtitle.textContent = items + (items === 1 ? ' producto en el ticket' : ' productos en el ticket');
    }

    modal.querySelectorAll('[data-payment-method]').forEach(btn => {
      const active = this.isPaymentTabActive(btn.dataset.paymentMethod);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    modal.querySelectorAll('[data-payment-section]').forEach(section => {
      section.classList.toggle('is-active', section.dataset.paymentSection === this.payment.method);
    });

    this.renderPaymentItems();
    this.renderCashSection(total);
    this.renderElectronicSection(total);
    this.renderMixSection(total);
    this.updateConfirmButton();
  },

  // Resumen de productos mostrado dentro del modal de cobro
  renderPaymentItems() {
    const list = document.getElementById('pos-pay-items-list');
    if (!list) return;

    if (!this.cart.length) {
      list.innerHTML = '<div class="payment-item"><span class="payment-item-name">Sin productos en el ticket</span></div>';
      return;
    }

    const currency = this.getCurrencySymbol();

    list.innerHTML = this.cart.map(item => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.precio) || 0;
      const isCold = this.normalizeColdFlag(item.piezaFria);
      const line = price * qty;

      return `
        <div class="payment-item${isCold ? ' is-cold' : ''}">
          <span class="payment-item-name">
            <span class="payment-item-qty">${qty}x</span> ${this.escapeHtml(item.nombre || '')}
          </span>
          <span class="payment-item-value">${this.escapeHtml(currency)}${line.toFixed(2)}</span>
        </div>
      `;
    }).join('');
  },

  renderCashSection(total) {
    const input = document.getElementById('pos-pay-cash');
    if (input && document.activeElement !== input) {
      input.value = this.payment.cashReceived > 0 ? this.payment.cashReceived.toFixed(2) : '';
    }

    const change = this.payment.cashReceived - total;
    const missing = Math.max(0, -change);

    const sumTotal = document.getElementById('pos-pay-sum-total');
    if (sumTotal) sumTotal.textContent = this.formatMoney(total);

    const sumReceived = document.getElementById('pos-pay-sum-received');
    if (sumReceived) sumReceived.textContent = this.formatMoney(this.payment.cashReceived);

    const sumChange = document.getElementById('pos-pay-sum-change');
    if (sumChange) {
      sumChange.textContent = missing > 0
        ? 'Faltan ' + this.formatMoney(missing)
        : this.formatMoney(change);
    }

    const changeRow = document.getElementById('pos-pay-sum-change-row');
    if (changeRow) {
      changeRow.classList.toggle('is-error', missing > 0);
      changeRow.classList.toggle('is-ok', missing === 0 && change > 0);
    }

    const hint = document.getElementById('pos-pay-hint');
    if (hint) {
      hint.classList.remove('is-error');
      hint.classList.remove('is-ok');
      if (missing > 0) {
        hint.textContent = 'Faltan ' + this.formatMoney(missing) + ' para completar el cobro.';
        hint.classList.add('is-error');
      } else if (change > 0) {
        hint.textContent = 'Entrega el cambio de ' + this.formatMoney(change) + ' al cliente.';
        hint.classList.add('is-ok');
      } else {
        hint.textContent = 'Cobro exacto, sin cambio.';
      }
    }
  },

  renderElectronicSection(total) {
    // El bloque de opciones con tarjeta solo se prepara en la sección electrónica
    if (this.payment.method !== 'electronico') return;

    const type = this.payment.electronicType;
    const isTransfer = type === 'transferencia';

    const amountEl = document.getElementById('pos-pay-electronic-amount');
    if (amountEl) amountEl.textContent = this.formatMoney(total);

    const labelEl = document.getElementById('pos-pay-electronic-label');
    if (labelEl) labelEl.textContent = isTransfer ? 'transferencia' : 'tarjeta';

    const cardTotal = document.getElementById('pos-pay-card-total');
    if (cardTotal) cardTotal.textContent = this.formatMoney(total);

    const cardMethod = document.getElementById('pos-pay-card-method');
    if (cardMethod) cardMethod.textContent = isTransfer ? 'Transferencia' : 'Tarjeta';

    // Sub-opciones de cobro con tarjeta de Mercado Pago (NFC, QR o terminal física)
    if (typeof SalesPayment !== 'undefined') {
      const context = this.getCardContext();
      context.total = total;
      SalesPayment.render(context);
    }

    const hint = document.getElementById('pos-pay-card-hint');
    if (hint) {
      const channel = this.getCardChannel();
      if (channel === 'nfc') {
        hint.textContent = 'Acerca el teléfono a la etiqueta NFC o usa Tap to Pay en la app de Mercado Pago y confirma el cobro.';
      } else if (channel === 'qr') {
        hint.textContent = 'Abre el código QR a pantalla completa para que el cliente lo escanee en la app de Mercado Pago y confirma el cobro.';
      } else {
        hint.textContent = 'Cobra en la terminal de Mercado Pago, verifica el voucher y confirma el pago.';
      }
    }
  },

  renderMixSection(total) {
    const modal = document.getElementById('pos-payment-modal');
    if (modal) {
      modal.querySelectorAll('[data-mix-type]').forEach(chip => {
        chip.classList.toggle('is-active', chip.dataset.mixType === this.payment.mixType);
      });
    }

    const cashInput = document.getElementById('pos-pay-mix-cash');
    if (cashInput && document.activeElement !== cashInput) {
      cashInput.value = this.payment.mixCash > 0 ? this.payment.mixCash.toFixed(2) : '';
    }

    const electronicInput = document.getElementById('pos-pay-mix-electronic');
    if (electronicInput && document.activeElement !== electronicInput) {
      electronicInput.value = this.payment.mixElectronic > 0 ? this.payment.mixElectronic.toFixed(2) : '';
    }

    const applied = total - this.payment.mixElectronic;
    const change = this.payment.mixCash - applied;
    const invalid = applied < -0.001 || change < -0.001;
    const missing = Math.max(0, -change);

    const mixTotal = document.getElementById('pos-pay-mix-total');
    if (mixTotal) mixTotal.textContent = this.formatMoney(total);

    const mixApplied = document.getElementById('pos-pay-mix-applied');
    if (mixApplied) mixApplied.textContent = this.formatMoney(Math.max(0, applied));

    const mixElectronic = document.getElementById('pos-pay-mix-electronic-row');
    if (mixElectronic) mixElectronic.textContent = this.formatMoney(this.payment.mixElectronic);

    const mixChange = document.getElementById('pos-pay-mix-change');
    if (mixChange) {
      mixChange.textContent = missing > 0
        ? 'Faltan ' + this.formatMoney(missing)
        : this.formatMoney(Math.max(0, change));
    }

    const changeRow = document.getElementById('pos-pay-mix-change-row');
    if (changeRow) {
      changeRow.classList.toggle('is-error', invalid);
      changeRow.classList.toggle('is-ok', !invalid && change > 0);
    }

    const hint = document.getElementById('pos-pay-mix-hint');
    if (hint) {
      hint.classList.remove('is-error');
      hint.classList.remove('is-ok');
      const methodLabel = this.payment.mixType === 'transferencia' ? 'transferencia' : 'tarjeta';
      if (invalid) {
        hint.textContent = 'Revisa el desglose: el efectivo no cubre la parte que le corresponde.';
        hint.classList.add('is-error');
      } else if (this.payment.mixElectronic <= 0) {
        hint.textContent = 'El total se cobra completo en efectivo.';
      } else {
        hint.textContent = this.formatMoney(Math.max(0, applied)) + ' en efectivo y ' +
          this.formatMoney(this.payment.mixElectronic) + ' con ' + methodLabel + '.';
        hint.classList.add('is-ok');
      }
    }
  },

  updateConfirmButton() {
    const btn = document.getElementById('pos-pay-confirm');
    if (!btn) return;

    const total = this.getTotal();
    let valid = this.cart.length > 0;

    if (valid && this.payment.method === 'efectivo') {
      valid = (this.payment.cashReceived + 0.001) >= total;
    } else if (valid && this.payment.method === 'mixto') {
      const applied = total - this.payment.mixElectronic;
      valid = applied >= -0.001 && (this.payment.mixCash + 0.001) >= applied;
    }

    btn.disabled = !valid;
    btn.textContent = valid ? 'Confirmar Pago' : 'Pago incompleto';
  },

  async confirmPayment() {
    if (this.paymentProcessing) return;
    this.paymentProcessing = true;
    try {
    if (!this.cart.length) {
      alert('El ticket está vacío.');
      return;
    }

    const total = this.getTotal();
    let paymentMethod = 'efectivo';
    let breakdown = { efectivo: 0, tarjeta: 0, transferencia: 0, recibido: 0, cambio: 0 };
    let paymentDetail = null;

    if (this.payment.method === 'efectivo') {
      const change = this.payment.cashReceived - total;
      if (change < -0.001) {
        alert('El efectivo recibido no cubre el total de la venta.');
        return;
      }
      paymentMethod = 'efectivo';
      breakdown.efectivo = total;
      breakdown.recibido = this.payment.cashReceived;
      breakdown.cambio = Math.max(0, change);
    } else if (this.payment.method === 'electronico') {
      const type = this.payment.electronicType === 'transferencia' ? 'transferencia' : 'tarjeta';
      paymentMethod = type;
      breakdown[type] = total;
      breakdown.recibido = total;
      breakdown.cambio = 0;
      paymentDetail = this.getPaymentDetail(type, total);
    } else {
      const electronic = this.payment.mixElectronic;
      const applied = total - electronic;
      const change = this.payment.mixCash - applied;
      if (applied < -0.001 || change < -0.001) {
        alert('Revisa el desglose del pago mixto antes de confirmar.');
        return;
      }
      const type = this.payment.mixType === 'transferencia' ? 'transferencia' : 'tarjeta';
      paymentMethod = 'mixto';
      breakdown.efectivo = Math.max(0, applied);
      breakdown[type] = Math.max(0, electronic);
      breakdown.recibido = this.payment.mixCash;
      breakdown.cambio = Math.max(0, change);
      paymentDetail = electronic > 0 ? this.getPaymentDetail(type, electronic) : null;
    }

    const electronicAmount = Number(breakdown.tarjeta || 0) + Number(breakdown.transferencia || 0);
    const verification = electronicAmount > 0 ? await PaymentVerification.request(electronicAmount, Number(breakdown.transferencia || 0) > 0) : null;
    if (electronicAmount > 0 && !verification) return;
    const result = this.completeSale({
      paymentVerification: verification,
      paymentMethod: paymentMethod,
      breakdown: breakdown,
      paymentDetail: paymentDetail,
      cashReceived: breakdown.recibido,
      change: breakdown.cambio
    });

    if (!result.success) {
      if (verification) PaymentVerification.finish(verification.id, 'cancelled');
      alert(result.error || 'No se pudo registrar la venta.');
      return;
    }

    this.payment.lastSale = result.sale;
    this.showPaymentSuccess(result.sale);
    } finally { this.paymentProcessing = false; }
  },

  // Detalle del cobro con tarjeta: forma de cobro (NFC, QR o terminal) y referencia
  getPaymentDetail(type, amount) {
    if (type !== 'tarjeta' && type !== 'transferencia') return null;
    const channel = this.getCardChannel();
    const label = (typeof SalesPayment !== 'undefined') ? SalesPayment.getChannelLabel(channel) : '';
    return {
      channel: channel,
      label: label,
      reference: this.payment.cardReference || '',
      amount: this.round2(Number(amount) || 0)
    };
  },

  // Registra la venta, descuenta inventario (incluye piezas frías) y limpia el ticket
  completeSale(details) {
    let committed = null;
    try {
      if (!this.cart.length) throw new Error('El ticket está vacío.');
      if (!CashSession.getActiveSession()) throw new Error('Abre caja para vender.');
      if (ShiftGuard.overdue()) { ShiftGuard.check(); throw new Error('Cierra el turno pendiente antes de vender.'); }
      const chargeRate = this.getColdChargeRate();
      const session = this.getSessionInfo();
      const items = this.cart.map(item => {
        const isCold = this.normalizeColdFlag(item.piezaFria);
        const qty = Number(item.quantity) || 0;
        const envaseCargo = this.getItemEnvaseCharge(item);
        const unidadesPorCarton = Number(item.unidadesPorCarton || 0);
        const precioCarton = Number(item.precioCarton || 0);
        const esCartonCompleto = unidadesPorCarton > 0
          && precioCarton > 0
          && qty >= unidadesPorCarton;
        const promoInfo = esCartonCompleto ? null : this.getVolumePromoInfo(item);
        return {
          ...item,
          quantity: qty,
          piezaFria: isCold,
          envaseFaltante: this.normalizeColdFlag(item.envaseFaltante),
          envaseModalidad: item.envaseModalidad || 'pieza',
          envaseCargo: this.normalizeColdFlag(item.envaseFaltante) ? envaseCargo : 0,
          cargoFrio: isCold ? chargeRate * qty : 0,
          promoVolumenAplicada: promoInfo ? { cantidad: promoInfo.cantidad, precio: promoInfo.precio } : null
        };
      });

      const evaluation = this.getPromoEvaluation();
      const promoDiscount = (evaluation.applications && evaluation.applications.length > 0)
        ? Math.max(0, Number(evaluation.discount) || 0)
        : 0;

      const sale = {
        items: items,
        subtotal: this.getSubtotal(),
        coldCharge: this.getColdChargeTotal(),
        coldUnits: this.getColdUnits(),
        total: this.getTotal(),
        promoDiscount: promoDiscount,
        volumenPromoDiscount: Math.max(0, Number(this.getVolumePromoDiscount()) || 0),
        promoName: (evaluation.applications && evaluation.applications.length) ? evaluation.applications.map(a=>a.nombre).join(', ') : '',
        promosAplicados: (evaluation.applications || []).map(app => ({
          id: app.id,
          nombre: app.nombre,
          tipo: app.tipo,
          valor: app.valor,
          discount: app.discount,
          combos: app.combos,
          esCombo: app.esCombo,
          detalle: (app.detalle || []).map(d => ({
            productId: d.productId,
            nombre: d.nombre,
            cantidad: d.cantidad
          }))
        })),
        paymentVerification: details.paymentVerification || null,
        paymentMethod: details.paymentMethod,
        paymentBreakdown: details.breakdown,
        paymentDetail: details.paymentDetail || null,
        cashReceived: details.cashReceived,
        change: details.change,
        turnoId: session ? session.turnoId : null,
        turnoNumero: session ? session.turnoNumero : null,
        corteId: session ? (session.corteId || session.turnoId || null) : null,
        corteNumero: session ? (session.corteNumero || session.turnoNumero || null) : null,
        cajero: session ? session.usuario : null,
        status: 'completada'
      };

      const recorded = Database.registerSale(sale);
      committed = recorded;
      this.cart = [];
      this.clearSavedCart();
      // Database.registerSale ya descuenta stock común y stock de nevera fría (coldStock) de las piezas frías.
      this.checkColdAlerts(sale.items);
      this.registerTurnTicket(recorded);
      this.cart = [];
      this.cut.recorded = null;
      this.clearSavedCart();
      this.renderCart();
      this.renderProductList();
      this.updateFridgeCounter();

      return { success: true, change: details.change, sale: recorded };
    } catch (error) {
      console.error('[POS] Error al completar la venta:', error);
      if (committed) return { success: true, change: details.change, sale: committed };
      return { success: false, error: error.message || 'Ocurrió un error al registrar la venta.' };
    }
  },

  // Cobro rápido en efectivo (compatibilidad con el botón anterior)
  processCashPayment(cashReceived) {
    const total = this.getTotal();
    const cash = Number(cashReceived) || 0;
    const change = cash - total;

    if (change < 0) {
      return { success: false, error: 'Efectivo insuficiente' };
    }

    return this.completeSale({
      paymentMethod: 'efectivo',
      breakdown: { efectivo: total, tarjeta: 0, transferencia: 0, recibido: cash, cambio: change },
      cashReceived: cash,
      change: change
    });
  },

  // ---------- Historial de ventas en vivo (turno activo) ----------

  // Carga en memoria el historial de tickets del turno activo
  refreshTurnTickets() {
    this.turnTickets = this.getTurnSales().map(sale => SalesLog.buildTicket(sale));
    return this.turnTickets;
  },

  // Tickets cobrados durante el turno activo
  getTurnTickets() {
    if (!this.turnTickets.length) this.refreshTurnTickets();
    return this.turnTickets;
  },

  // Registra el ticket recién cobrado en el historial del turno y avisa a los reportes
  registerTurnTicket(sale) {
    // Se reconstruye el historial del turno: la venta recién cobrada ya está en la base de datos
    this.refreshTurnTickets();

    let ticket = this.turnTickets.find(entry => entry.id && entry.id === sale.id);
    if (!ticket) {
      ticket = SalesLog.buildTicket(sale);
      this.turnTickets.push(ticket);
    }

    this.renderLiveSales();
    this.notifySalesUpdated(ticket);
    return ticket;
  },

  // Notifica que hay una venta nueva registrada (los reportes se actualizan en vivo)
  notifySalesUpdated(ticket) {
    try {
      window.dispatchEvent(new CustomEvent('sales:updated', { detail: { ticket: ticket } }));
    } catch (e) {
      console.warn('[POS] No se pudo notificar la venta registrada:', e);
    }
  },

  // Inserta el panel de historial en vivo dentro de la vista de ventas
  mountLiveSalesPanel() {
    if (document.getElementById('pos-live-sales')) {
      this.bindLiveSalesToggle();
      this.bindLiveTicketDetails();
      return;
    }
    const sidebar = document.querySelector('.pos-sidebar');
    const template = document.getElementById('sales-history-template');
    if (!sidebar || !template || !template.content) return;

    sidebar.appendChild(template.content.cloneNode(true));
    this.renderLiveSales();
    this.bindLiveSalesToggle();
    this.bindLiveTicketDetails();
  },

  // Vincula el clic/teclado en la barra resumen para expandir/colapsar el historial
  bindLiveSalesToggle() {
    const header = document.getElementById('pos-live-sales-header');
    if (!header) return;
    if (header.dataset.liveSalesBound === '1') return;
    header.dataset.liveSalesBound = '1';
    header.addEventListener('click', () => this.toggleLiveSales());
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleLiveSales();
      }
    });
  },

  // Alterna el estado colapsado/expandido del historial de ventas en vivo
  toggleLiveSales() {
    this.liveSalesCollapsed = !this.liveSalesCollapsed;
    const list = document.getElementById('pos-live-sales-list');
    const header = document.getElementById('pos-live-sales-header');
    const arrow = document.querySelector('.live-sales-arrow');
    const expanded = !this.liveSalesCollapsed;
    if (list) list.classList.toggle('expanded', expanded);
    if (header) header.setAttribute('aria-expanded', String(expanded));
    if (arrow) arrow.textContent = expanded ? '▲' : '▼';
  },

  bindLiveTicketDetails() {
    const list = document.getElementById('pos-live-sales-list');
    if (!list || list.dataset.liveTicketDetailsBound === '1') return;
    list.dataset.liveTicketDetailsBound = '1';
    list.addEventListener('click', (event) => {
      const ticketElement = event.target.closest('[data-live-ticket-id]');
      if (ticketElement) this.openLiveTicketDetail(ticketElement.dataset.liveTicketId);
    });
    list.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const ticketElement = event.target.closest('[data-live-ticket-id]');
      if (!ticketElement) return;
      event.preventDefault();
      this.openLiveTicketDetail(ticketElement.dataset.liveTicketId);
    });
  },

  // Pinta el feed con las ventas del turno activo
  renderLiveSales() {
    const list = document.getElementById('pos-live-sales-list');
    if (!list) return;

    const tickets = this.getTurnTickets();
    const session = this.getSessionInfo();
    const total = tickets.reduce((sum, t) => sum + (Number(t.total) || 0), 0);
    const coldUnits = tickets.reduce((sum, t) => sum + (t.cold ? t.cold.unidades : 0), 0);

    const counter = document.getElementById('pos-live-sales-count');
    if (counter) counter.textContent = String(tickets.length);

    const sub = document.getElementById('pos-live-sales-sub');
    if (sub) {
      const parts = [];
      if (session) parts.push('Turno ' + this.formatTurno(session.turnoNumero));
      parts.push(tickets.length + (tickets.length === 1 ? ' venta' : ' ventas'));
      parts.push(this.formatMoney(total));
      if (coldUnits > 0) parts.push('❄️ ' + coldUnits);
      sub.textContent = parts.join(' • ');
    }

    // Aplica estado colapsado/expandido tras renderizar
    const header = document.getElementById('pos-live-sales-header');
    const arrow = document.querySelector('.live-sales-arrow');
    const expanded = !this.liveSalesCollapsed;
    if (list) list.classList.toggle('expanded', expanded && tickets.length > 0);
    if (header) header.setAttribute('aria-expanded', String(expanded && tickets.length > 0));
    if (arrow) arrow.textContent = expanded ? '▲' : '▼';

    if (!tickets.length) {
      list.innerHTML = '<div class="live-sales-empty">Aún no hay ventas registradas en este turno.</div>';
      return;
    }

    list.innerHTML = tickets.slice(-15).reverse().map(ticket => this.renderLiveTicket(ticket)).join('');
  },

  // Renglón de un ticket dentro del feed en vivo
  renderLiveTicket(ticket) {
    const canceled = this.isCanceledTicket(ticket.status);
    const cold = ticket.cold && ticket.cold.aplicado
      ? `<span class="sale-tag is-cold" title="Cargo por bebida fría">❄️ ${ticket.cold.unidades} fría${ticket.cold.unidades === 1 ? '' : 's'}${ticket.cold.cargo > 0 ? ' · +' + this.escapeHtml(this.formatMoney(ticket.cold.cargo)) : ''}</span>`
      : '';

    const corte = ticket.corteNumero
      ? `<span class="sale-tag is-cut" title="Asociado al corte de caja">${this.escapeHtml('Corte #'+ticket.corteNumero)}</span>`
      : '';

    return `
      <article class="live-ticket" role="button" tabindex="0" data-live-ticket-id="${this.escapeHtml(ticket.id)}" aria-label="Ver detalle del ticket ${this.escapeHtml(ticket.hora)}">
        <span class="live-ticket-time">${this.escapeHtml(ticket.hora)}</span>
        <div class="live-ticket-body">
          <div class="live-ticket-items">${this.escapeHtml(ticket.detalle)}</div>
          <div class="live-ticket-tags">
            <span class="sale-tag sale-tag-cashier">Atendió: ${this.escapeHtml(ticket.cajero || 'Sin responsable registrado')}</span>
            <span class="sale-tag ${canceled ? 'is-canceled' : 'is-completed'}">${canceled ? 'Cancelada' : 'Completada'}</span>
            ${cold}
            ${corte}
            <span class="sale-tag">${this.escapeHtml(SalesLog.paymentIcon(ticket.paymentMethod))} ${this.escapeHtml(ticket.paymentLabel)}</span>
          </div>
        </div>
        <span class="live-ticket-total">${this.escapeHtml(this.formatMoney(ticket.total))}</span>
      </article>
    `;
  },

  isCanceledTicket(status) {
    return ['cancelada', 'cancelado', 'anulada', 'anulado', 'cancelled', 'canceled', 'void'].indexOf(String(status || '').toLowerCase()) !== -1;
  },

  openLiveTicketDetail(ticketId) {
    const ticket = this.getTurnTickets().find((item) => String(item.id) === String(ticketId));
    if (!ticket) return;

    const existingModal = document.getElementById('pos-live-ticket-modal');
    if (existingModal) existingModal.remove();

    const canceled = this.isCanceledTicket(ticket.status);
    const items = Array.isArray(ticket.items) ? ticket.items : [];
    const envaseCharge = items.reduce((sum, item) => sum + (Number(item.envaseCargo) || 0), 0);
    const itemMarkup = items.map((item) => {
      const quantityLabel = item.cantidad === 1 ? 'pieza' : 'piezas';
      const tags = [];
      if (item.cold) tags.push('Fría' + (item.cargoFrio > 0 ? ' · cargo ' + this.formatMoney(item.cargoFrio) : ''));
      if (item.envaseFaltante) {
        const envaseLabel = item.envaseModalidad ? ' (' + item.envaseModalidad + ')' : '';
        tags.push('Envase faltante' + envaseLabel + (item.envaseCargo > 0 ? ' · ' + this.formatMoney(item.envaseCargo) : ''));
      }
      if (item.promoVolumenAplicada) {
        tags.push('Promoción ' + item.promoVolumenAplicada.cantidad + ' × ' + this.formatMoney(item.promoVolumenAplicada.precio));
      }
      const cartonCount = item.unidadesPorCarton > 0 ? Math.floor(item.cantidad / item.unidadesPorCarton) : 0;
      const loosePieces = item.unidadesPorCarton > 0 ? item.cantidad % item.unidadesPorCarton : 0;
      const carton = item.isCarton && cartonCount > 0
        ? ' (' + cartonCount + ' cartón' + (cartonCount === 1 ? '' : 'es') +
          (loosePieces > 0 ? ' + ' + loosePieces + ' pieza' + (loosePieces === 1 ? '' : 's') + ' suelta' + (loosePieces === 1 ? '' : 's') : '') + ')'
        : '';
      return `
        <div class="live-ticket-detail-item">
          <div class="live-ticket-detail-item-heading">
            <strong>${this.escapeHtml(item.nombre)}</strong>
            <span>${item.cantidad} ${quantityLabel}${carton}</span>
          </div>
          <div class="live-ticket-detail-item-meta">
            <span>${this.escapeHtml(this.formatMoney(item.precio))} c/u${item.precioCarton > 0 ? ' · ' + this.formatMoney(item.precioCarton) + ' por cartón' : ''}${item.unidadesPorCarton > 0 ? ' · ' + item.unidadesPorCarton + ' piezas por cartón' : ''}</span>
            <strong>${this.escapeHtml(this.formatMoney(item.subtotal))}</strong>
          </div>
          ${tags.length ? '<div class="live-ticket-detail-tags">' + tags.map((tag) => '<span>' + this.escapeHtml(tag) + '</span>').join('') + '</div>' : ''}
        </div>`;
    }).join('');
    const breakdown = ticket.breakdown || {};
    const paymentRows = [
      ['Efectivo', breakdown.efectivo],
      ['Tarjeta', breakdown.tarjeta],
      ['Transferencia', breakdown.transferencia]
    ].filter((row) => Number(row[1]) > 0);
    const paymentMarkup = paymentRows.length
      ? paymentRows.map((row) => '<div><span>' + row[0] + '</span><strong>' + this.escapeHtml(this.formatMoney(row[1])) + '</strong></div>').join('')
      : '<div><span>Método de pago</span><strong>' + this.escapeHtml(ticket.paymentLabel) + '</strong></div>';
    const modal = document.createElement('div');
    modal.id = 'pos-live-ticket-modal';
    modal.className = 'live-ticket-modal-overlay';
    modal.setAttribute('role', 'presentation');
    modal.innerHTML = `
      <section class="live-ticket-modal" role="dialog" aria-modal="true" aria-labelledby="live-ticket-modal-title">
        <header class="live-ticket-modal-header">
          <div>
            <span class="live-ticket-modal-eyebrow">Detalle de venta · ${this.escapeHtml(ticket.hora)}</span>
            <h2 id="live-ticket-modal-title">Ticket</h2>
          </div>
          <button type="button" class="live-ticket-modal-close" data-live-ticket-modal-close aria-label="Cerrar detalle">✕</button>
        </header>
        <div class="live-ticket-modal-content">
          <div class="live-ticket-modal-status ${canceled ? 'is-canceled' : 'is-completed'}">${canceled ? 'Venta cancelada' : 'Venta completada'}</div>
          <div class="live-ticket-detail-items">${itemMarkup || '<p>Este ticket no contiene productos.</p>'}</div>
          <div class="live-ticket-modal-summary">
            <div><span>Subtotal de productos</span><strong>${this.escapeHtml(this.formatMoney(ticket.subtotal))}</strong></div>
            ${ticket.coldCharge > 0 ? '<div><span>Cargos por piezas frías</span><strong>' + this.escapeHtml(this.formatMoney(ticket.coldCharge)) + '</strong></div>' : ''}
            ${envaseCharge > 0 ? '<div><span>Cargos por envases</span><strong>' + this.escapeHtml(this.formatMoney(envaseCharge)) + '</strong></div>' : ''}
            ${ticket.promoDiscount > 0 ? '<div><span>Descuentos / promociones</span><strong>−' + this.escapeHtml(this.formatMoney(ticket.promoDiscount)) + '</strong></div>' : ''}
            ${ticket.volumePromoDiscount > 0 ? '<div><span>Descuento por volumen</span><strong>−' + this.escapeHtml(this.formatMoney(ticket.volumePromoDiscount)) + '</strong></div>' : ''}
            <div class="is-total"><span>Total</span><strong>${this.escapeHtml(this.formatMoney(ticket.total))}</strong></div>
          </div>
          <button type="button" class="btn secondary live-ticket-detail-toggle" aria-expanded="false">Ver ticket detallado</button>
          <section class="live-ticket-full-detail" hidden>
            <h3>Detalle del ticket</h3>
            <div class="live-ticket-payment-breakdown">${paymentMarkup}</div>
            ${ticket.paymentDetail && ticket.paymentDetail.label ? '<p class="live-ticket-payment-note">' + this.escapeHtml(ticket.paymentDetail.label) + (ticket.paymentDetail.reference ? ' · Referencia: ' + this.escapeHtml(ticket.paymentDetail.reference) : '') + '</p>' : ''}
            ${Number(breakdown.recibido) > 0 ? '<div class="live-ticket-payment-breakdown"><div><span>Recibido</span><strong>' + this.escapeHtml(this.formatMoney(breakdown.recibido)) + '</strong></div><div><span>Cambio</span><strong>' + this.escapeHtml(this.formatMoney(breakdown.cambio)) + '</strong></div></div>' : ''}
            ${ticket.cajero ? '<p class="live-ticket-payment-note">Atendió: ' + this.escapeHtml(ticket.cajero) + '</p>' : ''}
          </section>
        </div>
      </section>`;

    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-live-ticket-modal-close]')) modal.remove();
      const toggle = event.target.closest('.live-ticket-detail-toggle');
      if (toggle) {
        const detail = modal.querySelector('.live-ticket-full-detail');
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        toggle.textContent = expanded ? 'Ver ticket detallado' : 'Ocultar ticket detallado';
        detail.hidden = expanded;
        if (!expanded) detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') modal.remove();
    });
    document.body.appendChild(modal);
    modal.querySelector('.live-ticket-modal-close').focus();
  },

  showPaymentSuccess(sale) {
    const modal = document.getElementById('pos-payment-modal');
    if (!modal) return;

    modal.classList.add('is-success');

    const subtitle = document.getElementById('pos-pay-success-subtitle');
    if (subtitle) {
      const now = new Date();
      const time = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      subtitle.textContent = (sale && sale.id ? 'Folio ' + sale.id + ' • ' : '') + time;
    }

    const totalEl = document.getElementById('pos-pay-success-total');
    if (totalEl) totalEl.textContent = this.formatMoney(sale ? sale.total : 0);

    const methodEl = document.getElementById('pos-pay-success-method');
    if (methodEl) methodEl.textContent = this.getPaymentLabel(sale);

    const changeEl = document.getElementById('pos-pay-success-change');
    if (changeEl) changeEl.textContent = this.formatMoney(sale ? sale.change : 0);

    const ticket = document.getElementById('pos-pay-ticket');
    if (ticket) {
      ticket.textContent = this.generateTicket(sale);
      ticket.classList.remove('is-visible');
    }

    const toggle = document.getElementById('pos-pay-toggle-ticket');
    if (toggle) toggle.textContent = 'Ver ticket digital';
  },

  getPaymentLabel(sale) {
    if (!sale) return 'Efectivo';
    const breakdown = sale.paymentBreakdown || {};
    const channel = this.getPaymentChannelLabel(sale);
    const suffix = channel ? ' · ' + channel : '';

    if (sale.paymentMethod === 'mixto') {
      const parts = [];
      if (Number(breakdown.efectivo) > 0) parts.push('Efectivo');
      if (Number(breakdown.tarjeta) > 0) parts.push('Tarjeta');
      if (Number(breakdown.transferencia) > 0) parts.push('Transferencia');
      const base = parts.length ? parts.join(' + ') : 'Mixto';
      return channel ? base + suffix : base;
    }
    if (sale.paymentMethod === 'tarjeta') return 'Tarjeta' + suffix;
    if (sale.paymentMethod === 'transferencia') return 'Transferencia' + suffix;
    return 'Efectivo';
  },

  // Etiqueta corta de la forma de cobro con tarjeta (NFC, QR o Terminal)
  getPaymentChannelLabel(sale) {
    const detail = (sale && sale.paymentDetail) || {};
    const channel = detail.channel;
    if (!channel) return '';
    if (typeof SalesPayment !== 'undefined' && SalesPayment.getChannelLabel) {
      return SalesPayment.getChannelLabel(channel);
    }
    return String(channel).toUpperCase();
  },

  checkColdAlerts(items) {
    const products = Database.getProducts();
    let needsRefill = false;

    (items || []).forEach(item => {
      const product = products.find(p => p.id === item.productId);
      if (!product) return;
      const isCold = this.normalizeColdFlag(item.piezaFria) || item.cold === true || item.temp === 'frio';
      if (isCold) {
        const coldStock = product.coldStock !== undefined ? Number(product.coldStock) : 0;
        const coldCapacity = product.coldCapacity !== undefined ? Number(product.coldCapacity) : 24;
        if (coldCapacity > 0 && coldStock < Math.ceil(coldCapacity * 0.25)) {
          needsRefill = true;
        }
      }
    });

    const fridgeStock = this.getFridgeStock();
    if (fridgeStock <= Math.ceil(this.FRIDGE_MAX * 0.25)) {
      needsRefill = true;
    }

    if (needsRefill) {
      setTimeout(() => {
        alert('⚠️ Alerta: Faltan piezas por rellenar en la nevera (Copo de Nieve). Revisa el inventario.');
      }, 100);
    }
  },

  // ---------- Ticket impreso ----------

  generateTicket(sale) {
    const settings = Database.getSettings();
    const now = new Date();
    const fecha = now.toLocaleDateString('es-MX');
    const hora = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const currency = settings.currencySymbol || '$';

    const items = sale.items || [];
    let coldCharge = Number(sale.coldCharge);
    if (!Number.isFinite(coldCharge)) {
      coldCharge = items.reduce((sum, item) => {
        const isCold = this.normalizeColdFlag(item.piezaFria);
        const amount = Number(item.cargoFrio);
        if (isCold && Number.isFinite(amount)) return sum + amount;
        return sum;
      }, 0);
    }
    const coldUnits = Number(sale.coldUnits);
    const coldCount = Number.isFinite(coldUnits)
      ? coldUnits
      : items.reduce((sum, item) => sum + (this.normalizeColdFlag(item.piezaFria) ? (Number(item.quantity) || 0) : 0), 0);

    let ticket = `
========================================
   ${settings.businessName || 'Cervecería POS'}
========================================
Fecha: ${fecha}  Hora: ${hora}
----------------------------------------
Productos:
`;

    items.forEach(item => {
      const isCold = this.normalizeColdFlag(item.piezaFria) || item.cold === true;
      const temp = isCold ? ' [FRIO]' : '';
      const qty = Number(item.quantity) || 0;
      const price = Number(item.precio) || 0;
      ticket += `  ${item.nombre}${temp} x${qty}   ${currency}${(price * qty).toFixed(2)}\n`;
      const amount = Number(item.cargoFrio);
      if (isCold && Number.isFinite(amount) && amount > 0) {
        ticket += `      + Cargo bebida fría (${qty}): ${currency}${amount.toFixed(2)}\n`;
      }
      const envaseCargo = Number(item.envaseCargo || 0);
      if (this.normalizeColdFlag(item.envaseFaltante) && Number.isFinite(envaseCargo) && envaseCargo > 0) {
        ticket += `      + Importe envase: ${currency}${envaseCargo.toFixed(2)}\n`;
      }
    });

    ticket += `----------------------------------------\n`;
    ticket += `  Subtotal:   ${currency}${Number(sale.subtotal || 0).toFixed(2)}\n`;
    if (coldCharge > 0) {
      ticket += `  Cargo frio: ${currency}${coldCharge.toFixed(2)} (${coldCount} pieza(s))\n`;
    }

    const promoDiscount = Number(sale.promoDiscount) || 0;
    if (promoDiscount > 0) {
      ticket += `  Descuento: ${currency}${promoDiscount.toFixed(2)}\n`;
      const applied = Array.isArray(sale.promosAplicados) ? sale.promosAplicados : [];
      applied.forEach(app => {
        const pieces = (app.detalle || []).map(d => d.cantidad + 'x ' + d.nombre).join(', ');
        const sets = app.combos > 1 ? ' x' + app.combos : '';
        const rule = app.tipo === 'monto'
          ? currency + Number(app.valor || 0).toFixed(2)
          : Number(app.valor || 0) + '%';
        ticket += `    ${app.nombre}${sets} (${rule}): -${currency}${Number(app.discount || 0).toFixed(2)}\n`;
        if (pieces) ticket += `      ${pieces}\n`;
      });
    }

    ticket += `  TOTAL:      ${currency}${Number(sale.total || 0).toFixed(2)}\n`;

    const breakdown = sale.paymentBreakdown;
    if (breakdown) {
      if (Number(breakdown.efectivo) > 0) {
        ticket += `  Efectivo:   ${currency}${Number(breakdown.efectivo).toFixed(2)}\n`;
      }
      if (Number(breakdown.tarjeta) > 0) {
        ticket += `  Tarjeta:    ${currency}${Number(breakdown.tarjeta).toFixed(2)}\n`;
      }
      if (Number(breakdown.transferencia) > 0) {
        ticket += `  Transfer.:  ${currency}${Number(breakdown.transferencia).toFixed(2)}\n`;
      }
      const channelLabel = this.getPaymentChannelLabel(sale);
      if (channelLabel) {
        ticket += `  Cobro:      ${channelLabel}\n`;
      }
      if (sale.paymentMethod === 'mixto') {
        ticket += `  Recibido:   ${currency}${Number(breakdown.recibido || 0).toFixed(2)}\n`;
      }
      ticket += `  Cambio:     ${currency}${Number(breakdown.cambio || 0).toFixed(2)}\n`;
    } else {
      ticket += `  Efectivo:   ${currency}${Number(sale.cashReceived || 0).toFixed(2)}\n`;
      ticket += `  Cambio:     ${currency}${Number(sale.change || 0).toFixed(2)}\n`;
    }

    ticket += `----------------------------------------\n`;
    ticket += `   ${settings.ticketHeader || ''}\n`;
    ticket += `   ${settings.ticketFooter || ''}\n`;
    ticket += `========================================\n`;

    return ticket;
  },

  printTicket(sale) {
    const ticket = this.generateTicket(sale);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write('<pre style="font-family: monospace; white-space: pre-wrap;">' + this.escapeHtml(ticket) + '</pre>');
    printWindow.document.close();
    printWindow.print();
  },

  // ---------- Escape / seguridad de argumentos inline ----------

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // Escapa un valor para poder usarlo dentro de un onclick="..." (atributo HTML + cadena JS)
  jsArg(value) {
    const raw = String(value === null || value === undefined ? '' : value);
    const jsSafe = raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return jsSafe
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
};

if (typeof window !== 'undefined') {
  window.POS = POS;
  window.SalesLog = SalesLog;
}

// Exportar para uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = POS;
}

POS.cancelOpening=function(){try{POS.closeCashSession();}catch(e){}location.reload();};
