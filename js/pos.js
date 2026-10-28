// Lógica del punto de venta (POS)
// Catálogo, carrito, palomita de "Pieza Fría", búsqueda rápida, escáner,
// modal de cobro multipago (efectivo / tarjeta-transferencia / mixto) y sincronización con la nevera

// Registro en vivo de ventas: normaliza cada ticket cobrado para construir el
// historial en vivo del turno activo y su archivado dentro del corte de caja.
const SalesLog = {
  // Detecta si un renglón del ticket corresponde a una bebida fría
  isColdItem(item) {
    if (!item) return false;
    if (item.piezaFria === true || item.piezaFria === 'true') return true;
    if (item.cold === true) return true;
    if (typeof item.temp === 'string' && item.temp.toLowerCase() === 'frio') return true;
    return false;
  },

  // Hora exacta de la transacción en formato HH:MM:SS (hora local)
  timeLabel(value) {
    const date = value ? new Date(value) : new Date();
    if (isNaN(date.getTime())) return '--:--:--';
    const pad = (n) => String(n).padStart(2, '0');
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  },

  // Llave de fecha local (YYYY-MM-DD)
  dateKey(value) {
    const date = value ? new Date(value) : new Date();
    if (isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  },

  // Desglose legible de los productos: "1x Caguama Corona, 3x Latas Corona"
  describeItems(items) {
    const list = (items || []).map(item => {
      const cantidad = Number(item.cantidad !== undefined ? item.cantidad : item.quantity) || 0;
      const nombre = item.nombre || item.productName || 'Producto';
      return cantidad + 'x ' + nombre;
    });
    return list.length ? list.join(', ') : 'Sin productos';
  },

  // Etiqueta corta de la forma de cobro con tarjeta (NFC, QR o Terminal)
  paymentChannelLabel(sale) {
    const detail = (sale && sale.paymentDetail) || {};
    const channel = detail.channel;
    if (!channel) return '';
    if (typeof SalesPayment !== 'undefined' && SalesPayment.getChannelLabel) {
      return SalesPayment.getChannelLabel(channel);
    }
    return String(channel).toUpperCase();
  },

  // Etiqueta del método de pago: Efectivo, Tarjeta, Transferencia o Mixto
  paymentLabel(sale) {
    if (!sale) return 'Efectivo';
    const breakdown = sale.paymentBreakdown || {};
    const channel = this.paymentChannelLabel(sale);
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

  // Icono del método de pago
  paymentIcon(method) {
    if (method === 'tarjeta') return '💳';
    if (method === 'transferencia') return '🏦';
    if (method === 'mixto') return '🔀';
    return '💵';
  },

  // Número válido o valor por defecto
  toNumber(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  },

  // Redondeo a dos decimales
  round2(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100) / 100;
  },

  // Versión ligera del ticket para archivarlo dentro del corte de caja.
  // Incluye los ítems completos (nombre, cantidad, subtotal, cargo frío)
  // para que el corte pueda renderizar el desglose de productos vendidos.
  compactTicket(ticket) {
    if (!ticket) return null;
    const items = Array.isArray(ticket.items) ? ticket.items.map(item => ({
      productId: item.productId || null,
      nombre: item.nombre || item.productName || 'Producto',
      marca: item.marca || '',
      cantidad: Number(item.cantidad !== undefined ? item.cantidad : item.quantity) || 0,
      precio: Number(item.precio !== undefined ? item.precio : item.price) || 0,
      cold: Boolean(item.cold === true || item.piezaFria === true || item.piezaFria === 'true'),
      cargoFrio: Number(item.cargoFrio) || 0,
      envaseFaltante: Boolean(item.envaseFaltante),
      envaseModalidad: item.envaseModalidad || 'pieza',
      envaseCargo: Number(item.envaseCargo || 0),
      isCarton: Boolean(item.isCarton || item.carton || item.charola),
      unidadesPorCarton: Number(item.unidadesPorCarton || 0),
      promoVolumenAplicada: item.promoVolumenAplicada ? {
        cantidad: Number(item.promoVolumenAplicada.cantidad) || 0,
        precio: Number(item.promoVolumenAplicada.precio) || 0
      } : null,
      subtotal: Number(item.subtotal) || 0
    })) : [];
    return {
      id: ticket.id,
      fecha: ticket.fecha,
      hora: ticket.hora,
      items: items,
      detalle: ticket.detalle,
      unidades: ticket.unidades,
      cold: ticket.cold,
      subtotal: ticket.subtotal,
      coldCharge: ticket.coldCharge,
      promoDiscount: ticket.promoDiscount,
      total: ticket.total,
      paymentMethod: ticket.paymentMethod,
      paymentLabel: ticket.paymentLabel,
      paymentDetail: ticket.paymentDetail,
      breakdown: ticket.breakdown,
      turnoId: ticket.turnoId,
      turnoNumero: ticket.turnoNumero,
      cajero: ticket.cajero,
      status: ticket.status
    };
  },

  // Convierte una venta registrada en la base de datos en un ticket de historial
  buildTicket(sale) {
    const source = sale || {};
    const fecha = source.fecha || new Date().toISOString();
    const rawItems = Array.isArray(source.items) ? source.items : [];

      const items = rawItems.map(item => {
        const cantidad = Number(item.quantity) || 0;
        const precio = Number(item.precio !== undefined ? item.precio : item.price) || 0;
        const cold = this.isColdItem(item);
        const cargoFrio = Number(item.cargoFrio) || 0;
        return {
          productId: item.productId || null,
          nombre: item.nombre || item.productName || 'Producto',
          marca: item.marca || '',
          cantidad,
          precio,
          cold,
          cargoFrio,
          envaseFaltante: Boolean(item.envaseFaltante),
          envaseModalidad: item.envaseModalidad || 'pieza',
          envaseCargo: Number(item.envaseCargo || 0),
          isCarton: Boolean(item.isCarton || item.carton || item.charola),
          unidadesPorCarton: Number(item.unidadesPorCarton || 0),
          promoVolumenAplicada: item.promoVolumenAplicada ? {
            cantidad: Number(item.promoVolumenAplicada.cantidad) || 0,
            precio: Number(item.promoVolumenAplicada.precio) || 0
          } : null,
          subtotal: this.round2(precio * cantidad)
        };
      });

    const computedColdUnits = items.reduce((sum, item) => sum + (item.cold ? item.cantidad : 0), 0);
    const computedColdCharge = items.reduce((sum, item) => sum + (item.cold ? item.cargoFrio : 0), 0);
    const computedSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const breakdown = source.paymentBreakdown || {};

    const coldUnits = this.toNumber(source.coldUnits, computedColdUnits);
    const coldCharge = this.round2(this.toNumber(source.coldCharge, computedColdCharge));
    const subtotal = this.round2(this.toNumber(source.subtotal, computedSubtotal));

    return {
      id: source.id || '',
      fecha: fecha,
      hora: this.timeLabel(fecha),
      items: items,
      detalle: this.describeItems(items),
      unidades: items.reduce((sum, item) => sum + item.cantidad, 0),
      cold: {
        unidades: coldUnits,
        cargo: coldCharge,
        aplicado: coldUnits > 0
      },
      subtotal: subtotal,
      coldCharge: coldCharge,
      promoDiscount: Number(source.promoDiscount) || 0,
      total: Number(source.total) || 0,
      paymentMethod: source.paymentMethod || 'efectivo',
      paymentLabel: this.paymentLabel(source),
      paymentDetail: source.paymentDetail || null,
      breakdown: {
        efectivo: Number(breakdown.efectivo) || 0,
        tarjeta: Number(breakdown.tarjeta) || 0,
        transferencia: Number(breakdown.transferencia) || 0,
        recibido: Number(breakdown.recibido) || 0,
        cambio: Number(breakdown.cambio) || 0
      },
      turnoId: source.turnoId || null,
      turnoNumero: source.turnoNumero || null,
      cajero: source.cajero || null,
      corteId: source.corteId || null,
      corteNumero: source.corteNumero || null,
      status: source.status || 'completada'
    };
  }
};

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
    try {
      const raw = localStorage.getItem(this.FRIDGE_KEY);
      if (raw === null || raw === undefined || raw === '') return this.FRIDGE_MAX;
      const parsed = parseInt(raw, 10);
      if (isNaN(parsed)) return this.FRIDGE_MAX;
      return Math.max(0, Math.min(this.FRIDGE_MAX, parsed));
    } catch (e) {
      return this.FRIDGE_MAX;
    }
  },

  setFridgeStock(value) {
    const parsed = parseInt(value, 10);
    const next = isNaN(parsed) ? this.FRIDGE_MAX : Math.max(0, Math.min(this.FRIDGE_MAX, parsed));
    try {
      localStorage.setItem(this.FRIDGE_KEY, String(next));
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
      const raw = localStorage.getItem(this.CART_KEY);
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
      localStorage.setItem(this.CART_KEY, JSON.stringify(this.cart));
    } catch (e) {
      console.error('[POS] No se pudo guardar el carrito:', e);
    }
  },

  // Carga el término de búsqueda guardado
  loadSearchTerm() {
    try {
      const raw = localStorage.getItem('cerveceria_pos_search');
      this.searchTerm = raw || '';
    } catch (e) {
      this.searchTerm = '';
    }
  },

  // Guarda el término de búsqueda actual
  saveSearchTerm() {
    try {
      localStorage.setItem('cerveceria_pos_search', this.searchTerm || '');
    } catch (e) {}
  },

  // Carga el estado de la palomita "Pieza Fría"
  loadPiezaFriaGlobal() {
    try {
      const raw = localStorage.getItem('cerveceria_pos_cold_toggle');
      return this.normalizeColdFlag(raw);
    } catch (e) {
      return false;
    }
  },

  // Guarda el estado de la palomita "Pieza Fría"
  savePiezaFriaGlobal() {
    try {
      localStorage.setItem('cerveceria_pos_cold_toggle', String(this.piezaFriaGlobal));
    } catch (e) {}
  },

  // Limpia el carrito guardado (tras cobrar o cancelar)
  clearSavedCart() {
    try {
      localStorage.removeItem(this.CART_KEY);
      localStorage.removeItem('cerveceria_pos_search');
      localStorage.removeItem('cerveceria_pos_cold_toggle');
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
    const perProductCold = product ? (Number(product.coldStock) || 0) : 0;
    const productColdUnits = this.getColdUnitsFor(productId);

    if (perProductCold > 0 && productColdUnits + amount > perProductCold) {
      return {
        ok: false,
        needConfirm: false,
        reason: 'No hay suficientes piezas frías de ' + ((product && product.nombre) || 'este producto') + ' en la nevera.'
      };
    }

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
    return coldStock > 0 || this.getFridgeStock() > 0;
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
          ? `<span class="cart-tag cart-tag-carton">📦 ${fullCartons} cartón${fullCartons > 1 ? 'es' : ''} completo · ${this.escapeHtml(currency)}${cartonPrice.toFixed(2)} c/u</span>`
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
                <span class="cart-qty-value">${qty}</span>
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

  confirmPayment() {
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

    const result = this.completeSale({
      paymentMethod: paymentMethod,
      breakdown: breakdown,
      paymentDetail: paymentDetail,
      cashReceived: breakdown.recibido,
      change: breakdown.cambio
    });

    if (!result.success) {
      alert(result.error || 'No se pudo registrar la venta.');
      return;
    }

    this.payment.lastSale = result.sale;
    this.showPaymentSuccess(result.sale);
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
    try {
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
      // Database.registerSale ya descuenta stock común y stock de nevera fría (coldStock) de las piezas frías.
      this.checkColdAlerts(sale.items);
      this.registerTurnTicket(recorded);
      this.cart = [];
      this.clearSavedCart();
      this.renderCart();
      this.renderProductList();
      this.updateFridgeCounter();

      return { success: true, change: details.change, sale: recorded };
    } catch (error) {
      console.error('[POS] Error al completar la venta:', error);
      return { success: false, error: 'Ocurrió un error al registrar la venta.' };
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
    if (document.getElementById('pos-live-sales')) return;
    const sidebar = document.querySelector('.pos-sidebar');
    const template = document.getElementById('sales-history-template');
    if (!sidebar || !template || !template.content) return;

    sidebar.appendChild(template.content.cloneNode(true));
    this.renderLiveSales();
    this.bindLiveSalesToggle();
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
    const cold = ticket.cold && ticket.cold.aplicado
      ? `<span class="sale-tag is-cold" title="Cargo por bebida fría">❄️ ${ticket.cold.unidades} fría${ticket.cold.unidades === 1 ? '' : 's'}${ticket.cold.cargo > 0 ? ' · +' + this.escapeHtml(this.formatMoney(ticket.cold.cargo)) : ''}</span>`
      : '';

    const corte = ticket.corteNumero
      ? `<span class="sale-tag is-cut" title="Asociado al corte de caja">${this.escapeHtml('Corte #'+ticket.corteNumero)}</span>`
      : '';

    return `
      <div class="live-ticket">
        <span class="live-ticket-time">${this.escapeHtml(ticket.hora)}</span>
        <div class="live-ticket-body">
          <div class="live-ticket-items">${this.escapeHtml(ticket.detalle)}</div>
          <div class="live-ticket-tags">
            ${cold}
            ${corte}
            <span class="sale-tag">${this.escapeHtml(SalesLog.paymentIcon(ticket.paymentMethod))} ${this.escapeHtml(ticket.paymentLabel)}</span>
          </div>
        </div>
        <span class="live-ticket-total">${this.escapeHtml(this.formatMoney(ticket.total))}</span>
      </div>
    `;
  },

  // ---------- Corte de caja / cierre de turno ----------

  // Sesión cruda del turno activo (base de datos o almacenamiento local)
  readRawSession() {
    // CashSession es la autoridad unica sobre el turno activo
    if (typeof CashSession !== 'undefined' && CashSession.readRaw) {
      return CashSession.readRaw();
    }

    let session = null;
    try {
      session = (typeof Database !== 'undefined' && Database.getSession) ? Database.getSession() : null;
    } catch (e) {
      session = null;
    }

    if (!session) {
      try {
        const raw = localStorage.getItem('pos_session');
        session = raw ? JSON.parse(raw) : null;
      } catch (e) {
        session = null;
      }
    }

    return session;
  },

  // Rol con el que se abrió la caja ('admin', 'employee', 'guest'...)
  getSessionRole() {
    const session = this.readRawSession();
    return String((session && (session.role || session.rol)) || '').trim().toLowerCase();
  },

  // Solo el administrador cierra el turno sin conteo físico de efectivo
  isAdminSession() {
    const role = this.getSessionRole();
    return role === 'admin' || role === 'administrador' || role === 'administrator';
  },

  // Devuelve los datos de la sesión (turno) activo: cajero, fondo inicial, apertura y número de turno
  getSessionInfo() {
    // Solo hay información de turno si la caja sigue abierta
    const session = (typeof CashSession !== 'undefined' && CashSession.getActiveSession)
      ? CashSession.getActiveSession()
      : this.readRawSession();

    if (!session) return null;

    let caja = null;
    try {
      const raw = localStorage.getItem('cerveceria_caja');
      caja = raw ? JSON.parse(raw) : null;
    } catch (e) {
      caja = null;
    }

    const openedAt = session.openedAt ||
      (caja && caja.fechaApertura) ||
      (session.timestamp ? new Date(session.timestamp).toISOString() : null);

    const cashOpening = Number(
      session.cashOpening !== undefined && session.cashOpening !== null ? session.cashOpening :
      (session.cashInitial !== undefined && session.cashInitial !== null ? session.cashInitial :
      (session.montoApertura !== undefined && session.montoApertura !== null ? session.montoApertura :
      (caja ? caja.fondoInicial : 0)))
    ) || 0;

    return {
      usuario: session.name || session.usuario || 'Cajero',
      rol: session.role || session.rol || 'admin',
      cashOpening: cashOpening,
      openedAt: openedAt,
      turnoNumero: Number(session.turnoNumero || session.corteNumero) || 1,
      turnoId: session.turnoId || session.aperturaId || null,
      aperturaId: session.aperturaId || session.turnoId || null
    };
  },

  // Ventas que pertenecen al turno activo (por id de turno o por hora de apertura)
  getTurnSales() {
    const session = this.getSessionInfo();
    if (!session) return [];

    let sales = [];
    try {
      sales = Database.getSales() || [];
    } catch (e) {
      sales = [];
    }

    const openedTime = session.openedAt ? new Date(session.openedAt).getTime() : NaN;

    return sales.filter(sale => {
      if (!sale) return false;
      if (sale.turnoId && session.turnoId) return sale.turnoId === session.turnoId;
      const time = sale.fecha ? new Date(sale.fecha).getTime() : NaN;
      if (isNaN(time)) return false;
      if (isNaN(openedTime)) return true;
      return time >= openedTime;
    });
  },

  // Suma los importes cobrados por método de pago de una lista de ventas
  sumPayments(sales) {
    let efectivo = 0;
    let tarjeta = 0;
    let transferencia = 0;

    (sales || []).forEach(sale => {
      const total = Number(sale.total) || 0;
      const breakdown = sale.paymentBreakdown || {};
      const bEfectivo = Number(breakdown.efectivo) || 0;
      const bTarjeta = Number(breakdown.tarjeta) || 0;
      const bTransferencia = Number(breakdown.transferencia) || 0;

      if (bEfectivo + bTarjeta + bTransferencia > 0) {
        efectivo += bEfectivo;
        tarjeta += bTarjeta;
        transferencia += bTransferencia;
        return;
      }

      const method = String(sale.paymentMethod || '').toLowerCase();
      if (method.includes('transfer')) {
        transferencia += total;
      } else if (method.includes('tarjeta') || method.includes('electron')) {
        tarjeta += total;
      } else if (method.includes('mixto')) {
        tarjeta += total;
      } else {
        efectivo += total;
      }
    });

    return { efectivo, tarjeta, transferencia };
  },

  // Reparte el importe cobrado con tarjeta por forma de cobro (NFC, QR o terminal)
  sumCardChannels(sales) {
    const channels = { nfc: 0, qr: 0, terminal: 0 };

    (sales || []).forEach(sale => {
      if (!sale) return;
      const detail = sale.paymentDetail || {};
      const channel = detail.channel;
      if (!channel || channels[channel] === undefined) return;

      const breakdown = sale.paymentBreakdown || {};
      const amount = (Number(breakdown.tarjeta) || 0) + (Number(breakdown.transferencia) || 0);
      if (amount <= 0) return;

      channels[channel] = this.round2(channels[channel] + amount);
    });

    return channels;
  },

  // Resumen completo del turno activo (base del modal de corte)
  getTurnSummary() {
    const session = this.getSessionInfo() || {
      usuario: 'Cajero',
      rol: 'admin',
      cashOpening: 0,
      openedAt: null,
      turnoNumero: 1,
      turnoId: null,
      aperturaId: null
    };

    const ventas = this.getTurnSales();
    const pagos = this.sumPayments(ventas);
    const fondoInicial = Number(session.cashOpening) || 0;
    const totalVentas = ventas.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    const promocionesResumen = EmailService.getVolumePromotionsSummary(ventas);
    const promocionesAplicadas = promocionesResumen.cantidad > 0 ? [{
      nombre: 'Promociones',
      veces: promocionesResumen.cantidad,
      descuento: promocionesResumen.monto
    }] : [];
    const canales = this.sumCardChannels(ventas);
    const totalEsperado = this.round2(fondoInicial + pagos.efectivo);

    return {
      session: session,
      fondoInicial: fondoInicial,
      ventasEfectivo: this.round2(pagos.efectivo),
      ventasTarjeta: this.round2(pagos.tarjeta),
      ventasTransferencia: this.round2(pagos.transferencia),
      ventasPorCanal: canales,
      descuentosPromociones: promocionesResumen.monto,
      promocionesResumen: promocionesResumen,
      promocionesAplicadas: promocionesAplicadas,
      totalVentas: this.round2(totalVentas),
      cantidadVentas: ventas.length,
      totalEsperado: totalEsperado,
      totalEnCaja: totalEsperado,
      ventas: ventas
    };
  },

  round2(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100) / 100;
  },

  formatTurno(numero) {
    const value = Number(numero) || 0;
    return 'T-' + String(value).padStart(3, '0');
  },

  formatTime(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  },

  formatDateTime(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  },

  ensureCutModal() {
    let modal = document.getElementById('pos-cut-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'pos-cut-modal';
    modal.className = 'payment-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pos-cut-title');
    modal.innerHTML = `
      <div class="payment-backdrop" data-cut-close="true"></div>
      <div class="payment-shell">
        <div class="payment-screen" id="pos-cut-screen">
          <header class="payment-header">
            <div class="payment-header-text">
              <h2 id="pos-cut-title">Corte de Caja</h2>
              <span class="payment-subtitle" id="pos-cut-subtitle">Cierre del turno activo</span>
            </div>
            <button type="button" class="payment-icon-btn" data-cut-close="true" aria-label="Cerrar corte">✕</button>
          </header>

          <div class="payment-body">
            <div class="payment-total-card">
              <span class="payment-total-label">Total en caja</span>
              <strong class="payment-total-value" id="pos-cut-expected">$0.00</strong>
              <span class="payment-total-detail" id="pos-cut-detail">Fondo inicial + ventas en efectivo</span>
            </div>

            <div class="payment-summary">
              <div class="payment-summary-row"><span>Fondo inicial</span><span id="pos-cut-initial">$0.00</span></div>
              <div class="payment-summary-row"><span>Ventas en efectivo</span><span id="pos-cut-efectivo">$0.00</span></div>
              <div class="payment-summary-row"><span>Ventas con tarjeta</span><span id="pos-cut-tarjeta">$0.00</span></div>
              <div class="payment-summary-row"><span>Ventas por transferencia</span><span id="pos-cut-transferencia">$0.00</span></div>
              <div class="cut-channels" id="pos-cut-channels" hidden>
                <div class="payment-summary-row"><span>Cobro con código QR</span><span id="pos-cut-qr">$0.00</span></div>
                <div class="payment-summary-row"><span>Cobro en terminal física</span><span id="pos-cut-terminal">$0.00</span></div>
              </div>
              <div class="payment-summary-row"><span>Promociones</span><span id="pos-cut-promociones">$0.00</span></div>
              <div class="payment-summary-row"><span>Piezas frías</span><span id="pos-cut-piezas-frias">$0.00</span></div>
              <div class="payment-summary-row"><span>Cartones fríos</span><span id="pos-cut-cartones-frios">$0.00</span></div>
              <div class="payment-summary-row"><span>Total de ventas del turno</span><span id="pos-cut-ventas">$0.00</span></div>
              <div class="payment-summary-row is-change"><span>Total en caja</span><span id="pos-cut-total-caja">$0.00</span></div>
            </div>

            <div class="cut-promos" id="pos-cut-promos" hidden>
              <div class="cut-promos-title">Promociones aplicadas en el turno</div>
              <ul class="cut-promos-list" id="pos-cut-promos-list"></ul>
            </div>

            <label class="payment-field cut-field" id="pos-cut-cash-field">
              <span class="payment-field-label">Efectivo físico contado</span>
              <input type="number" id="pos-cut-cash" class="payment-input" inputmode="decimal" step="0.01" min="0" placeholder="0.00" autocomplete="off" />
            </label>

            <div class="payment-summary">
              <div class="payment-summary-row" id="pos-cut-counted-row"><span>Efectivo contado</span><span id="pos-cut-counted">$0.00</span></div>
              <div class="payment-summary-row is-change" id="pos-cut-diff-row"><span>Diferencia de caja</span><span id="pos-cut-diff">$0.00</span></div>
            </div>

            <p class="payment-hint" id="pos-cut-hint">Cuenta el efectivo en caja e ingrésalo para cerrar el turno.</p>
          </div>

          <footer class="payment-footer">
            <div class="cut-actions">
              <button type="button" class="btn secondary" id="pos-cut-save-json">💾 Guardar localmente JSON</button>
              <button type="button" class="btn secondary" id="pos-cut-print">🖨️ Imprimir Ticket</button>
              <button type="button" class="btn secondary" id="pos-cut-email">📧 Enviar a correo</button>
            </div>
            <div class="cut-footer-row">
              <button type="button" class="btn secondary" data-cut-close="true">Cancelar</button>
              <button type="button" class="btn" id="pos-cut-confirm">Confirmar Corte</button>
            </div>
          </footer>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.bindCutModal(modal);
    return modal;
  },

  bindCutModal(modal) {
    modal.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      if (target.closest('[data-cut-close]')) {
        this.closeCashCutModal();
      }
    });

    const cashInput = document.getElementById('pos-cut-cash');
    if (cashInput) {
      cashInput.addEventListener('input', () => {
        if (this.isAdminSession()) return;
        this.cut.counted = parseFloat(cashInput.value);
        this.renderCashCutModal();
      });
    }

    const confirmBtn = document.getElementById('pos-cut-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => this.confirmCashCut());
    }

    const jsonBtn = document.getElementById('pos-cut-save-json');
    if (jsonBtn) {
      jsonBtn.addEventListener('click', () => this.runCutAction('json'));
    }

    const printBtn = document.getElementById('pos-cut-print');
    if (printBtn) {
      printBtn.addEventListener('click', () => this.runCutAction('print'));
    }

    const emailBtn = document.getElementById('pos-cut-email');
    if (emailBtn) {
      emailBtn.addEventListener('click', () => this.runCutAction('email'));
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.cut.isOpen) {
        this.closeCashCutModal();
      }
    });
  },

  // Abre el modal de corte de caja con el resumen del turno activo
  openCashCutModal() {
    const session = this.getSessionInfo();
    if (!session) {
      alert('No hay un turno de caja abierto. Inicia sesión nuevamente para abrir caja.');
      return;
    }

    // Si no hubo ventas en el turno, permitir cerrar la sesión directamente
    // sin exigir desglose ni generar reporte de corte con monto cero.
    const summary = this.getTurnSummary();
    if (!summary || (Number(summary.totalVentas) || 0) <= 0) {
      const ok = window.confirm('No se registraron ventas en este turno. ¿Cerrar sesión y volver al login?');
      if (!ok) return;
      this.closeCashCutModal();
      this.closeCashSession();
      try {
        if (typeof App !== 'undefined' && typeof App.showLogin === 'function') {
          App.currentView = null;
          App.showLogin();
        } else {
          location.reload();
        }
      } catch (e) {
        location.reload();
      }
      return;
    }

    const modal = this.ensureCutModal();
    if (!modal) return;

    // El administrador cierra el turno sin conteo físico: el efectivo contado
    // se asigna automáticamente con el total esperado en caja.
    const isAdmin = this.isAdminSession();
    const expected = this.getTurnSummary().totalEsperado;

    this.cut.isOpen = true;
    this.cut.isAdmin = isAdmin;
    this.cut.busy = false;
    this.cut.counted = isAdmin ? expected : 0;

    const input = document.getElementById('pos-cut-cash');
    if (input) {
      input.disabled = isAdmin;
      input.value = isAdmin ? expected.toFixed(2) : '';
    }

    modal.classList.add('is-active');
    this.renderCashCutModal();

    setTimeout(() => {
      if (isAdmin) return;
      const field = document.getElementById('pos-cut-cash');
      if (field) field.focus();
    }, 80);
  },

  closeCashCutModal() {
    const modal = document.getElementById('pos-cut-modal');
    if (modal) modal.classList.remove('is-active');
    this.cut.isOpen = false;
  },

  renderCashCutModal() {
    const modal = document.getElementById('pos-cut-modal');
    if (!modal) return;

    const summary = this.getTurnSummary();
    const currency = this.getCurrencySymbol();
    const isAdmin = this.isAdminSession();

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setText('pos-cut-initial', currency + summary.fondoInicial.toFixed(2));
    setText('pos-cut-efectivo', currency + summary.ventasEfectivo.toFixed(2));
    setText('pos-cut-tarjeta', currency + summary.ventasTarjeta.toFixed(2));
    setText('pos-cut-transferencia', currency + summary.ventasTransferencia.toFixed(2));

    // Desglose por forma de cobro con tarjeta (solo si se usó alguna)
    const canales = summary.ventasPorCanal || { qr: 0, terminal: 0 };
    setText('pos-cut-qr', currency + canales.qr.toFixed(2));
    setText('pos-cut-terminal', currency + canales.terminal.toFixed(2));
    const channelsBox = document.getElementById('pos-cut-channels');
    if (channelsBox) {
      channelsBox.hidden = !(canales.qr > 0 || canales.terminal > 0);
    }

    const resumenFrio = EmailService.getColdItemsSummary(summary.ventas);

    const promocionesResumen = EmailService.getVolumePromotionsSummary(summary.ventas);
    const montoPromociones = promocionesResumen.monto;
    setText('pos-cut-promociones', montoPromociones > 0 ? currency + montoPromociones.toFixed(2) : currency + '0.00');
    setText('pos-cut-piezas-frias', currency + resumenFrio.piezasMonto.toFixed(2));
    setText('pos-cut-cartones-frios', currency + resumenFrio.cartonesMonto.toFixed(2));
    setText('pos-cut-ventas', currency + summary.totalVentas.toFixed(2));
    setText('pos-cut-expected', currency + summary.totalEnCaja.toFixed(2));
    setText('pos-cut-total-caja', currency + summary.totalEnCaja.toFixed(2));

    setText(
      'pos-cut-detail',
      'Fondo inicial + ventas en efectivo • ' + summary.cantidadVentas + ' venta(s) • ' +
      currency + summary.totalVentas.toFixed(2) + ' vendidos'
    );

    setText(
      'pos-cut-subtitle',
      'Turno ' + this.formatTurno(summary.session.turnoNumero) + ' • ' + summary.session.usuario +
      (summary.session.openedAt ? ' • abrió ' + this.formatTime(summary.session.openedAt) : '')
    );

    // Detalle de promociones aplicadas durante el turno
    this.renderCutPromos(summary.promocionesAplicadas);

    // Control por rol: el administrador no declara efectivo físico,
    // el empleado y el invitado sí deben contarlo antes de cerrar.
    const field = document.getElementById('pos-cut-cash-field');
    if (field) field.hidden = isAdmin;

    const input = document.getElementById('pos-cut-cash');
    if (input) {
      input.disabled = isAdmin;
      if (isAdmin) input.value = summary.totalEsperado.toFixed(2);
    }

    const diffRow = document.getElementById('pos-cut-diff-row');
    if (diffRow) diffRow.hidden = isAdmin;

    const parsed = parseFloat(input ? input.value : '');
    const hasCount = !isNaN(parsed) && parsed >= 0;
    const valid = isAdmin || hasCount;
    const counted = isAdmin ? summary.totalEsperado : (hasCount ? this.round2(parsed) : 0);
    const diff = isAdmin ? 0 : this.round2(counted - summary.totalEsperado);

    setText('pos-cut-counted', currency + counted.toFixed(2));

    const diffEl = document.getElementById('pos-cut-diff');
    if (diffEl) {
      if (!valid) {
        diffEl.textContent = currency + '0.00';
      } else if (Math.abs(diff) < 0.005) {
        diffEl.textContent = 'Exacto';
      } else {
        diffEl.textContent = (diff > 0 ? '+' : '−') + currency + Math.abs(diff).toFixed(2);
      }
    }

    if (diffRow) {
      diffRow.classList.toggle('is-error', valid && diff < -0.005);
      diffRow.classList.toggle('is-ok', valid && Math.abs(diff) < 0.005);
    }

    const hint = document.getElementById('pos-cut-hint');
    if (hint) {
      hint.classList.remove('is-error');
      hint.classList.remove('is-ok');
      if (isAdmin) {
        hint.textContent = 'Cierre de administrador: se registra el efectivo esperado en caja, sin conteo físico.';
      } else if (!valid) {
        hint.textContent = 'Ingresa el efectivo físico contado en caja para cerrar el turno.';
      } else if (Math.abs(diff) < 0.005) {
        hint.textContent = 'Caja cuadrada. El corte se registrará sin diferencia.';
        hint.classList.add('is-ok');
      } else if (diff < 0) {
        hint.textContent = 'Faltan ' + currency + Math.abs(diff).toFixed(2) + ' en caja. Se registrará la diferencia.';
        hint.classList.add('is-error');
      } else {
        hint.textContent = 'Sobran ' + currency + diff.toFixed(2) + ' en caja. Se registrará la diferencia.';
        hint.classList.add('is-ok');
      }
    }

    const confirmBtn = document.getElementById('pos-cut-confirm');
    if (confirmBtn) {
      confirmBtn.disabled = !valid || this.cut.busy;
      confirmBtn.textContent = isAdmin
        ? 'Confirmar y Cerrar Caja'
        : (valid ? 'Confirmar Corte' : 'Ingresa el efectivo');
    }

    // Las acciones de salida se habilitan cuando el corte ya es válido
    ['pos-cut-save-json', 'pos-cut-print', 'pos-cut-email'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !valid || this.cut.busy;
    });
  },

  // Detalle de las promociones aplicadas en el turno
  renderCutPromos(aplicadas) {
    const box = document.getElementById('pos-cut-promos');
    const list = document.getElementById('pos-cut-promos-list');
    if (!box || !list) return;

    const items = Array.isArray(aplicadas) ? aplicadas : [];
    if (!items.length) {
      list.innerHTML = '';
      box.hidden = true;
      return;
    }

    const currency = this.getCurrencySymbol();
    list.innerHTML = items.map(item => {
      const veces = Number(item.veces) || 0;
      const descuento = Number(item.descuento) || 0;
      return '<li class="cut-promos-item">' +
        '<span class="cut-promos-name">' + this.escapeHtml(item.nombre || 'Promoción') +
        '<span class="cut-promos-times"> x' + veces + '</span></span>' +
        '<span class="cut-promos-value">' + this.escapeHtml(currency) + Math.abs(descuento).toFixed(2) + '</span>' +
        '</li>';
    }).join('');

    box.hidden = false;
  },

  // Confirma el corte: registra el corte, cierra la sesión del turno y regresa al login
  confirmCashCut() {
    if (this.cut.busy) return;

    const saved = this.ensureCutRecorded();
    if (!saved) return;

    this.finishCashCut(0);
  },

  // Registra el corte una sola vez y devuelve el corte ya guardado
  ensureCutRecorded() {
    if (this.cut.recorded) return this.cut.recorded;

    const cut = this.buildCutData();
    if (!cut) return null;

    const saved = this.persistCut(cut);
    if (!saved) return null;

    this.cut.recorded = saved;
    return saved;
  },

  // Construye el registro del corte con el desglose explicativo del turno
  buildCutData() {
    const isAdmin = this.isAdminSession();
    const summary = this.getTurnSummary();
    const session = summary.session;
    const now = new Date();
    const esperado = summary.totalEsperado;

    // El administrador confirma con el total esperado en caja (sin conteo físico);
    // el empleado y el invitado deben declarar el efectivo real contado.
    let counted = esperado;
    if (!isAdmin) {
      const input = document.getElementById('pos-cut-cash');
      counted = parseFloat(input ? input.value : '');
      if (isNaN(counted) || counted < 0) {
        alert('Ingresa el efectivo físico contado en caja.');
        return null;
      }
    }

    const diferencia = this.round2(counted - esperado);
    const tickets = this.getTurnTickets();
    const ticketsCorte = tickets.map(ticket => SalesLog.compactTicket(ticket));
    const productos = this.getCutProducts({ tickets: ticketsCorte });

    // Desglose de frío y promociones desde las transacciones del turno
    const resumenFrio = EmailService.getColdItemsSummary(tickets);
    const promocionesResumen = EmailService.getVolumePromotionsSummary(tickets);

    return {
      tipo: 'cierre',
      corteNumero: session.turnoNumero,
      turno: this.formatTurno(session.turnoNumero),
      usuario: session.usuario,
      rol: session.rol,
      modoCierre: isAdmin ? 'administrador' : 'conteo_fisico',
      conteoFisico: !isAdmin,
      montoApertura: summary.fondoInicial,
      montoInicial: summary.fondoInicial,
      fechaApertura: session.openedAt,
      fechaCierre: now.toISOString(),
      horaApertura: session.openedAt ? this.formatTime(session.openedAt) : '--:--',
      horaCierre: this.formatTime(now),
      ventasEfectivo: summary.ventasEfectivo,
      ventasTarjeta: summary.ventasTarjeta,
      ventasTransferencia: summary.ventasTransferencia,
      ventasPorCanal: {
        nfc: summary.ventasPorCanal.nfc,
        qr: summary.ventasPorCanal.qr,
        terminal: summary.ventasPorCanal.terminal
      },
      descuentosPromociones: promocionesResumen.monto,
      promocionesAplicadas: promocionesResumen.cantidad > 0 ? [{
        nombre: 'Promociones',
        veces: promocionesResumen.cantidad,
        descuento: promocionesResumen.monto
      }] : [],
      totalVentas: summary.totalVentas,
      totalGeneral: summary.totalVentas,
      cantidadVentas: summary.cantidadVentas,
      ventasIds: tickets.map(ticket => ticket.id),
      tickets: ticketsCorte,
      productos: productos,
      efectivoContado: this.round2(counted),
      totalEsperado: esperado,
      totalEnCaja: esperado,
      diferencia: diferencia,
      estado: Math.abs(diferencia) < 0.005 ? 'exacto' : (diferencia > 0 ? 'sobrante' : 'faltante'),
      turnoId: session.turnoId || null,
      aperturaId: session.aperturaId || null,
      desglose: {
        fondoInicial: summary.fondoInicial,
        ventasEfectivo: summary.ventasEfectivo,
        ventasTarjeta: summary.ventasTarjeta,
        ventasTransferencia: summary.ventasTransferencia,
        ventasPorCanal: {
          nfc: summary.ventasPorCanal.nfc,
          qr: summary.ventasPorCanal.qr,
          terminal: summary.ventasPorCanal.terminal
        },
        promociones: promocionesResumen.monto,
        promocionesCant: promocionesResumen.cantidad,
        promocionesPiezas: promocionesResumen.piezas,
        promocionesMonto: promocionesResumen.monto,
        piezasFriasCant: resumenFrio.piezasCant,
        piezasFriasMonto: resumenFrio.piezasMonto,
        cartonesFriosCant: resumenFrio.cartonesCant,
        cartonesFriosMonto: resumenFrio.cartonesMonto,
        productos: productos,
        totalVentas: summary.totalVentas,
        totalEnCaja: esperado,
        efectivoContado: this.round2(counted),
        diferencia: diferencia,
        cantidadVentas: summary.cantidadVentas
      }
    };
  },

  // Guarda el corte en la base de datos, archiva sus ventas y conserva el último corte
  persistCut(cut) {
    let recorded = null;
    try {
      const cuts = Database.recordCut(cut);
      if (Array.isArray(cuts) && cuts.length) recorded = cuts[cuts.length - 1];
    } catch (error) {
      console.error('[POS] Error al registrar el corte de caja:', error);
      alert('No se pudo registrar el corte de caja. Intenta de nuevo.');
      return null;
    }

    const saved = recorded || cut;
    this.archiveTurnSales(saved);
    try {
      localStorage.setItem(this.CUT_LAST_KEY, JSON.stringify(saved));
    } catch (e) {
      console.error('[POS] No se pudo guardar el último corte:', e);
    }
    return saved;
  },

  // Ejecuta una acción de salida del corte (JSON / ticket / correo) y cierra la sesión
  async runCutAction(action) {
    if (this.cut.busy) return;

    let emailConfig = null;
    if (action === 'email') {
      emailConfig = this.getEmailConfig();
      if (!emailConfig.ok) {
        alert(emailConfig.error);
        return;
      }
    }

    const saved = this.ensureCutRecorded();
    if (!saved) return;

    this.setCutBusy(true);

    let ok = true;
    try {
      if (action === 'json') {
        ok = this.downloadCutJson(saved);
      } else if (action === 'print') {
        ok = this.printCutTicket(saved);
      } else if (action === 'email') {
        const result = await this.sendCutByEmail(saved, emailConfig);
        ok = result.success;
        if (ok) {
          alert('¡Correo enviado con éxito!');
        } else {
          alert(result.error);
        }
      }
    } catch (error) {
      console.error('[POS] Error al ejecutar la acción del corte:', error);
      alert('Ocurrió un error al ejecutar la acción del corte.');
      ok = false;
    } finally {
      this.setCutBusy(false);
    }

    if (!ok) return;

    // Las acciones de correo, JSON e impresión NO cierran el turno.
    // El cierre de sesión es exclusivo del botón oficial de "Cerrar Turno / Corte de Caja".
    // El turno permanece activo e intacto para seguir operando.
  },

  // Bloquea el modal mientras se ejecuta una acción de cierre
  setCutBusy(busy) {
    this.cut.busy = !!busy;

    if (busy) {
      const hint = document.getElementById('pos-cut-hint');
      if (hint) {
        hint.classList.remove('is-error');
        hint.classList.remove('is-ok');
        hint.textContent = 'Procesando el corte de caja…';
      }
      return;
    }

    this.renderCashCutModal();
  },

  // Genera y descarga el archivo JSON con los datos del corte
  downloadCutJson(cut) {
    try {
      const settings = Database.getSettings() || {};
      const payload = {
        tipo: 'corte_caja',
        version: 1,
        generadoEn: new Date().toISOString(),
        negocio: settings.businessName || 'Cervecería POS',
        corte: cut
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = this.getCutFileName(cut, 'json');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error('[POS] Error al guardar el JSON del corte:', error);
      alert('No se pudo generar el archivo JSON del corte.');
      return false;
    }
  },

  // Nombre del archivo de salida del corte (JSON / ticket)
  getCutFileName(cut, extension) {
    const ahora = new Date();
    const y = ahora.getFullYear();
    const m = String(ahora.getMonth() + 1).padStart(2, '0');
    const d = String(ahora.getDate()).padStart(2, '0');
    const turno = (cut && cut.turno) ? cut.turno : 'T-000';
    return 'corte_caja_' + turno + '_' + y + '-' + m + '-' + d + '.' + extension;
  },

  // Ticket formateado del corte de caja (vista para impresora)
  generateCutTicket(cut) {
    const settings = Database.getSettings() || {};
    const currency = settings.currencySymbol || '$';
    const data = cut || {};
    const desglose = data.desglose || {};

    const monto = (value) => currency + (Number(value) || 0).toFixed(2);
    const linea = (label, value) => ' ' + String(label).padEnd(28, ' ') + String(value);
    const borde = '========================================';

    const diferencia = Number(data.diferencia) || 0;
    const estado = Math.abs(diferencia) < 0.005
      ? 'Exacto'
      : (diferencia > 0 ? '+' : '-') + monto(Math.abs(diferencia));

    let ticket = '';
    ticket += borde + '\n';
    ticket += '   CORTE DE CAJA - CIERRE DE TURNO\n';
    ticket += '   ' + (settings.businessName || 'Cervecería POS') + '\n';
    ticket += borde + '\n';
    ticket += linea('Corte', '#' + (data.corteNumero || '-') + ' ' + (data.turno || '')) + '\n';
    ticket += linea('Usuario', (data.usuario || 'Cajero') + ' (' + this.getCutRoleLabel(data.rol) + ')') + '\n';
    ticket += linea('Apertura', data.horaApertura || '--:--') + '\n';
    ticket += linea('Cierre', data.horaCierre || '--:--') + '\n';
    ticket += '----------------------------------------\n';
    ticket += ' DESGLOSE DEL TURNO\n';
    ticket += '----------------------------------------\n';
    ticket += linea('Fondo inicial', monto(desglose.fondoInicial !== undefined ? desglose.fondoInicial : data.montoApertura)) + '\n';
    ticket += linea('Ventas en efectivo', monto(desglose.ventasEfectivo !== undefined ? desglose.ventasEfectivo : data.ventasEfectivo)) + '\n';
    ticket += linea('Ventas con tarjeta', monto(desglose.ventasTarjeta !== undefined ? desglose.ventasTarjeta : data.ventasTarjeta)) + '\n';
    ticket += linea('Ventas por transferencia', monto(desglose.ventasTransferencia !== undefined ? desglose.ventasTransferencia : data.ventasTransferencia)) + '\n';
    ticket += linea('Cobro con código QR', monto(desglose.ventasPorCanal?.qr || 0)) + '\n';
    ticket += linea('Cobro en terminal física', monto(desglose.ventasPorCanal?.terminal || 0)) + '\n';
    ticket += linea('Promociones (descuento)', monto(desglose.promocionesMonto !== undefined ? desglose.promocionesMonto : desglose.promociones !== undefined ? desglose.promociones : data.descuentosPromociones)) + '\n';
    ticket += linea('Piezas frías', (desglose.piezasFriasCant || 0) + ' x ' + monto(desglose.piezasFriasMonto || 0)) + '\n';
    ticket += linea('Cartones fríos', (desglose.cartonesFriosCant || 0) + ' x ' + monto(desglose.cartonesFriosMonto || 0)) + '\n';
    ticket += linea('Promociones aplicadas', (desglose.promocionesCant || 0) + ' x ' + monto(desglose.promocionesMonto || 0)) + '\n';
    const productos = Array.isArray(data.productos)
      ? data.productos
      : (Array.isArray(desglose.productos) ? desglose.productos : this.getCutProducts(data));
    if (productos.length) {
      ticket += '----------------------------------------\n';
      ticket += ' SALIDA DE PRODUCTOS\n';
      productos.forEach(producto => {
        const cartones = Number(producto.cartones) || 0;
        const piezas = Number(producto.piezas) || 0;
        ticket += ' ' + (producto.nombre || 'Producto') + ': ' +
          cartones + (cartones === 1 ? ' cartón/paquete, ' : ' cartones/paquetes, ') +
          piezas + (piezas === 1 ? ' pieza suelta\n' : ' piezas sueltas\n');
      });
    }
    ticket += linea('Total de ventas', monto(desglose.totalVentas !== undefined ? desglose.totalVentas : data.totalVentas)) + '\n';
    ticket += '----------------------------------------\n';
    ticket += linea('Total en caja', monto(data.totalEnCaja !== undefined ? data.totalEnCaja : data.totalEsperado)) + '\n';
    ticket += linea('Efectivo contado', monto(data.efectivoContado)) + '\n';
    ticket += linea('Diferencia de caja', estado) + '\n';
    ticket += '----------------------------------------\n';
    ticket += linea('Ventas del turno', (Number(data.cantidadVentas) || 0) + ' transaccion(es)') + '\n';
    ticket += linea('ID del corte', data.id || '-') + '\n';
    ticket += borde + '\n';

    return ticket;
  },

  // Despliega la vista formateada del corte de caja para impresora
  printCutTicket(cut) {
    const ticket = this.generateCutTicket(cut);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('No se pudo abrir la ventana de impresión. Revisa los permisos del navegador.');
      return false;
    }

    printWindow.document.write('<pre style="font-family: monospace; white-space: pre-wrap;">' + this.escapeHtml(ticket) + '</pre>');
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    return true;
  },

  // Etiqueta legible del rol con el que se cerró el corte
  getCutRoleLabel(rol) {
    const role = String(rol || '').trim().toLowerCase();
    if (role === 'admin' || role === 'administrador' || role === 'administrator') return 'Administrador';
    if (role === 'employee' || role === 'empleado') return 'Empleado';
    if (role === 'guest' || role === 'invitado') return 'Invitado';
    return 'Cajero';
  },

  // Credenciales EmailJS fijas en el servicio
  getEmailConfig() {
    if (typeof emailjs === 'undefined') {
      return { ok: false, error: 'La librería de EmailJS no está disponible. Revisa tu conexión a internet.' };
    }

    const defaults = EmailService.config;
    return {
      ok: true,
      destino: 'tonitocerverciapunto@gmail.com',
      publicKey: defaults.publicKey,
      serviceId: defaults.serviceId,
      templateId: defaults.templateId
    };
  },

  // Envía el reporte del corte de caja por correo con las credenciales de EmailJS
  async sendCutByEmail(cut, config) {
    const credenciales = (config && config.ok) ? config : this.getEmailConfig();
    if (!credenciales || !credenciales.ok) {
      return { success: false, error: (credenciales && credenciales.error) || 'No se pudo leer la configuración de correo.' };
    }

    if (typeof EmailService === 'undefined') {
      return { success: false, error: 'El servicio de correo no está disponible.' };
    }

    try {
      const payload = {
        id: cut.id || 'N/A',
        fecha: cut.fechaCierre || new Date().toISOString().split('T')[0],
        hora: cut.horaCierre || new Date().toLocaleTimeString(),
        turno: cut.turno || 'N/A',
        corteNumero: cut.corteNumero || 'N/A',
        totalEfectivo: cut.ventasEfectivo || 0,
        totalTarjeta: cut.ventasTarjeta || 0,
        totalTransferencia: cut.ventasTransferencia || 0,
        totalGeneral: cut.totalGeneral || 0,
        totalVentas: cut.totalVentas || 0,
        cantidadVentas: cut.cantidadVentas || 0,
        montoApertura: cut.montoApertura || 0,
        fondoInicial: cut.fondoInicial || 0,
        descuentosPromociones: cut.descuentosPromociones || 0,
        promocionesAplicadas: cut.promocionesAplicadas || [],
        transacciones: cut.tickets || [],
        ventas: cut.usuario || 'Sistema',
        productos: this.getCutProducts(cut)
      };

      const fecha = cut.fechaCierre ? String(cut.fechaCierre).split('T')[0] : '';
      const asunto = 'Corte de caja ' + (cut.turno || '') + (fecha ? ' - ' + fecha : '');
      const result = await EmailService.sendCorteRespaldo(payload, credenciales.destino, asunto);

      if (!result || !result.success) {
        return { success: false, error: (result && result.error) || 'EmailJS no pudo enviar el correo del corte.' };
      }
      return { success: true };
    } catch (error) {
      console.error('[POS] Error al enviar el corte por correo:', error);
      return { success: false, error: error.message || 'Error al enviar el corte por correo.' };
    }
  },

  // Productos vendidos en el corte (agrupados por artículo)
  getCutProducts(cut) {
    const agregados = new Map();
    const tickets = Array.isArray(cut && cut.tickets)
      ? cut.tickets
      : (cut ? [] : this.getTurnTickets());

    tickets.forEach(ticket => {
      const items = Array.isArray(ticket && ticket.items) ? ticket.items : [];
      items.forEach(item => {
        if (!item) return;
        const nombre = item.nombre || 'Producto';
        const cantidad = Math.max(
          0,
          Math.floor(Number(item.cantidad !== undefined ? item.cantidad : item.quantity) || 0)
        );
        const importe = Number(item.subtotal) || 0;
        const clave = item.productId ? String(item.productId) : nombre.toLocaleLowerCase();
        const actual = agregados.get(clave) || {
          nombre: nombre,
          cantidad: 0,
          cartones: 0,
          piezas: 0,
          importe: 0,
          unidadesPorCarton: 0
        };
        actual.cantidad += cantidad;
        actual.importe = this.round2(actual.importe + importe);
        const unidadesPorCarton = Number(item.unidadesPorCarton) || 0;
        const esCarton = Boolean(item.isCarton || item.carton || item.charola);
        const cartones = esCarton && unidadesPorCarton > 0
          ? Math.floor(cantidad / unidadesPorCarton)
          : 0;
        actual.cartones += cartones;
        actual.piezas += Math.max(0, cantidad - cartones * unidadesPorCarton);
        actual.unidadesPorCarton = Math.max(actual.unidadesPorCarton, unidadesPorCarton);
        agregados.set(clave, actual);
      });
    });

    if (!agregados.size) {
      (Array.isArray(cut && cut.tickets) ? cut.tickets : []).forEach(ticket => {
        if (!ticket) return;
        const nombre = ticket.detalle || 'Productos';
        const clave = nombre.toLocaleLowerCase();
        const actual = agregados.get(clave) || {
          nombre: nombre,
          cantidad: Number(ticket.unidades) || 0,
          cartones: 0,
          piezas: Number(ticket.unidades) || 0,
          importe: 0,
          unidadesPorCarton: 0
        };
        actual.importe = this.round2(actual.importe + (Number(ticket.total) || 0));
        agregados.set(clave, actual);
      });
    }

    return Array.from(agregados.values()).map(producto => {
      return {
        nombre: producto.nombre,
        cantidad: Math.max(0, Math.floor(producto.cantidad)),
        cartones: producto.cartones,
        piezas: producto.piezas,
        unidadesPorCarton: producto.unidadesPorCarton,
        importe: producto.importe
      };
    });
  },

  // Cierra por completo la sesión del turno y regresa al login (apertura de caja)
  finishCashCut(delay) {
    const run = () => {
      this.closeCashCutModal();
      this.closeCashSession();

      try {
        // Tras el corte no queda turno abierto: la app vuelve al login
        // y queda lista para una nueva apertura de caja.
        if (typeof App !== 'undefined' && typeof App.showLogin === 'function') {
          App.currentView = null;
          App.showLogin();
        } else {
          location.reload();
        }
      } catch (error) {
        console.error('[POS] Error al regresar al login tras el corte:', error);
        location.reload();
      }
    };

    const espera = Number(delay) || 0;
    if (espera > 0) {
      setTimeout(run, espera);
      return;
    }
    run();
  },

  // Asocia las ventas del turno con el corte de caja y las archiva en ese corte
  archiveTurnSales(cut) {
    try {
      const ids = (cut.ventasIds || []).filter(Boolean);
      if (!ids.length) return;

      const sales = Database.getSales() || [];
      let changed = false;

      sales.forEach(sale => {
        if (!sale || ids.indexOf(sale.id) === -1) return;
        sale.corteId = cut.id || null;
        sale.corteNumero = cut.corteNumero || null;
        sale.archivadoEnCorte = true;
        changed = true;
      });

      if (changed) Database.saveSales(sales);
    } catch (error) {
      console.error('[POS] Error al archivar las ventas del corte:', error);
    }
  },

  // Cierra por completo la sesión del turno: borra el estado de caja abierta
  closeCashSession() {
    try {
      if (typeof CashSession !== 'undefined' && CashSession.clear) {
        CashSession.clear();
      } else {
        if (typeof Database !== 'undefined' && Database.clearSession) {
          Database.clearSession();
        }
        ['cerveceria_caja', 'pos_session', 'cerveceria_session'].forEach(key => {
          try {
            localStorage.removeItem(key);
          } catch (e) {}
        });
      }
    } catch (error) {
      console.error('[POS] Error al limpiar la sesión:', error);
    }

    this.cart = [];
    this.clearSavedCart();
    this.turnTickets = [];
    this.payment.lastSale = null;
    this.cut.counted = 0;
    this.cut.isAdmin = false;
    this.cut.busy = false;
    this.cut.recorded = null;
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

  // ---------- Escáner ----------

  findProductByBarcode(barcode) {
    if (!barcode) return null;
    const code = barcode.toString().trim();
    const products = Database.getProducts();
    return products.find(p => {
      const b1 = p.codigoBarras && p.codigoBarras.toString().trim();
      const b2 = p.codigo && p.codigo.toString().trim();
      return (b1 && b1 === code) || (b2 && b2 === code);
    });
  },

  addProductByBarcode(barcode) {
    const product = this.findProductByBarcode(barcode);
    if (!product) {
      this.setScannerStatus('Código no encontrado: ' + barcode);
      return null;
    }

    const isCold = Boolean(this.piezaFriaGlobal);
    const hasStock = (product.stock || 0) > 0;
    const hasCold = isCold && (Number(product.coldStock) || 0) > 0;

    if (product.activo === false || (!hasStock && !hasCold)) {
      this.setScannerStatus('Producto sin stock o inactivo: ' + product.nombre);
      return null;
    }

    this.addToCart(product.id);
    this.setScannerStatus('Agregado: ' + product.nombre + (isCold ? ' (frío ❄️)' : ''));
    return product;
  },

  openCameraScanner() {
    const modal = document.getElementById('pos-scanner-modal');
    if (!modal) return;

    modal.classList.add('active');
    this.initScannerModal();
    const continuousCheckbox = document.getElementById('pos-scanner-continuous');
    if (continuousCheckbox) {
      this.scanner.isContinuous = continuousCheckbox.checked;
    }

    setTimeout(() => {
      this.startCameraScanner();
    }, 50);
  },

  closeCameraScanner() {
    this.stopCameraScanner();
    const modal = document.getElementById('pos-scanner-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  },

  toggleCameraScanner() {
    if (this.scanner.isScanning) {
      this.stopCameraScanner();
    } else {
      this.startCameraScanner();
    }
  },

  setScannerStatus(text) {
    const statusEl = document.getElementById('pos-scanner-status');
    if (statusEl) {
      statusEl.textContent = text;
    }
  },

  async startCameraScanner() {
    if (this.scanner.isScanning) return;

    const videoElement = document.getElementById('pos-scanner-video');
    if (!videoElement) {
      this.setScannerStatus('No se encontró el elemento de video');
      return;
    }
    this.scanner.videoElement = videoElement;

    const toggleBtn = document.getElementById('pos-scanner-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = 'Detener';
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      this.scanner.stream = stream;
      videoElement.srcObject = stream;
      await videoElement.play();

      this.scanner.isScanning = true;
      this.scanner.lastScanned = '';
      this.scanner.lastScannedTime = 0;
      this.setScannerStatus('Cámara activa. Apunta al código de barras...');

      await this.initCodeReader();
    } catch (error) {
      console.error('Error al iniciar cámara:', error);
      this.setScannerStatus('Error al acceder a la cámara: ' + error.message);
      if (toggleBtn) {
        toggleBtn.textContent = 'Iniciar';
      }
    }
  },

  stopCameraScanner() {
    this.scanner.isScanning = false;

    if (this.scanner.stream) {
      this.scanner.stream.getTracks().forEach(track => track.stop());
      this.scanner.stream = null;
    }

    if (this.scanner.videoElement) {
      this.scanner.videoElement.srcObject = null;
    }

    if (this.scanner.codeReader) {
      try {
        this.scanner.codeReader.reset();
      } catch (e) {}
    }

    const toggleBtn = document.getElementById('pos-scanner-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = 'Iniciar';
    }
    this.setScannerStatus('Cámara detenida');
  },

  async initCodeReader() {
    const { BrowserMultiFormatReader } = window.ZXing || {};
    if (!BrowserMultiFormatReader) {
      this.setScannerStatus('Librería ZXing no cargada. Agrega el script de ZXing a index.html');
      this.stopCameraScanner();
      return;
    }

    if (this.scanner.codeReader) {
      try {
        this.scanner.codeReader.reset();
      } catch (e) {}
    }

    this.scanner.codeReader = new BrowserMultiFormatReader();
    try {
      await this.scanner.codeReader.decodeFromVideoDevice(undefined, this.scanner.videoElement, (result, err) => {
        if (result) {
          const code = result.getText();
          const now = Date.now();
          if (this.scanner.isContinuous) {
            if (code === this.scanner.lastScanned && (now - this.scanner.lastScannedTime) < this.scanner.debounceMs) {
              return;
            }
            this.scanner.lastScanned = code;
            this.scanner.lastScannedTime = now;
            this.addProductByBarcode(code);
          } else {
            this.scanner.lastScanned = code;
            this.scanner.lastScannedTime = now;
            this.addProductByBarcode(code);
            this.closeCameraScanner();
          }
        }
        if (err && !(err.name === 'NotFoundException' || err.name === 'ChecksumException' || err.name === 'FormatException')) {
          console.warn(err);
        }
      });
    } catch (error) {
      console.error(error);
      this.setScannerStatus('Error al iniciar lector de códigos: ' + error.message);
    }
  },

  printTicket(sale) {
    const ticket = this.generateTicket(sale);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write('<pre style="font-family: monospace; white-space: pre-wrap;">' + ticket + '</pre>');
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
