// Reportes: métricas compactas en cuadrícula, acordeones por botón y gráficas controladas
const ReportsManager = {
  containerId: 'reports-content',
  chartHours: null,
  chartProducts: null,
  currentFilter: 'dia',
  openAcc: null,
  liveBound: false,

  init(containerId) {
    this.containerId = containerId || this.containerId;
    this.chartHours = null;
    this.chartProducts = null;
    if (!this.cutDate) this.cutDate = this.dateKey(new Date());
    if (!this.salesDate) this.salesDate = this.dateKey(new Date());
    this.bindLiveSales();
    this.render();
    this.loadChartLib(() => {});
  },

  bindLiveSales() {
    if (this.liveBound) return;
    this.liveBound = true;
    window.addEventListener('sales:updated', () => {
      const container = document.getElementById(this.containerId);
      if (!container) return;
      this.render();
    });
  },

  loadChartLib(callback) {
    if (window.Chart) {
      callback();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js';
    script.onload = callback;
    script.onerror = () => {
      console.warn('[Reports] No se pudo cargar Chart.js');
      callback();
    };
    document.head.appendChild(script);
  },

  getDateRange(filter) {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    switch (filter) {
      case 'semana': {
        const day = start.getDay() || 7;
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (day - 1));
        end.setHours(23, 59, 59, 999);
        break;
      }
      case 'mes': {
        start.setHours(0, 0, 0, 0);
        start.setDate(1);
        end.setHours(23, 59, 59, 999);
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
        break;
      }
      case 'dia':
      default: {
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      }
    }
    return { start, end };
  },

  getFilteredSales(filter = this.currentFilter) {
    const sales = Database.getSales() || [];
    const { start, end } = this.getDateRange(filter);
    return sales.filter(s => {
      const d = new Date(s.fecha);
      return !isNaN(d) && d >= start && d <= end;
    });
  },

  dateKey(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  formatDateLabel(dateKey) {
    const parts = String(dateKey || '').split('-');
    if (parts.length !== 3) return dateKey || '';
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  },

  formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  },

  getCutsByPeriod(filter = this.currentFilter) {
    const { start, end } = this.getDateRange(filter);
    return this.getClosedCuts().filter(cut => {
      const date = new Date(cut.fecha);
      return !isNaN(date) && date >= start && date <= end;
    });
  },

  getCutsByDate(dateKey) {
    const target = dateKey || this.dateKey(new Date());
    return this.getClosedCuts().filter(cut => this.dateKey(cut.fecha) === target);
  },

  getClosedCuts() {
    const cuts = Database.getCuts() || [];
    return cuts
      .filter(cut => cut && cut.tipo === 'cierre')
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  },

  differenceClass(difference) {
    const value = Number(difference) || 0;
    if (Math.abs(value) < 0.005) return 'is-ok';
    return value < 0 ? 'is-error' : 'is-warn';
  },

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  formatCurrency(amount) {
    const settings = Database.getSettings() || {};
    const symbol = settings.currencySymbol || '$';
    return `${symbol}${Number(amount || 0).toFixed(2)}`;
  },

  getOpeningAmount() {
    let amount = 0;
    try {
      if (typeof POS !== 'undefined' && typeof POS.getSessionInfo === 'function') {
        const session = POS.getSessionInfo();
        if (session) {
          const val = session.cashOpening !== undefined && session.cashOpening !== null
            ? session.cashOpening
            : (session.montoApertura !== undefined && session.montoApertura !== null ? session.montoApertura : 0);
          amount = Number(val) || 0;
          if (amount > 0) return amount;
        }
      }
    } catch (e) {}
    try {
      if (typeof Database !== 'undefined') {
        if (Database.getSession) {
          const s = Database.getSession();
          if (s) {
            const val = s.cashOpening !== undefined && s.cashOpening !== null
              ? s.cashOpening
              : (s.montoApertura !== undefined && s.montoApertura !== null ? s.montoApertura : 0);
            amount = Number(val) || 0;
            if (amount > 0) return amount;
          }
        }
        const cuts = Database.getCuts ? Database.getCuts() : [];
        if (Array.isArray(cuts) && cuts.length) {
          const last = cuts[cuts.length - 1];
          const val = last && (last.montoApertura !== undefined ? last.montoApertura : last.fondoInicial);
          amount = Number(val) || 0;
          if (amount > 0) return amount;
        }
      }
    } catch (e) {}
    try {
      const raw = localStorage.getItem('pos_session');
      if (raw) {
        const s = JSON.parse(raw);
        const val = s.cashOpening !== undefined && s.cashOpening !== null
          ? s.cashOpening
          : (s.montoApertura !== undefined && s.montoApertura !== null ? s.montoApertura : 0);
        amount = Number(val) || 0;
      }
    } catch (e) {}
    return amount || 0;
  },

  paymentTotals(filtered) {
    let efectivo = 0;
    let electronico = 0;
    filtered.forEach(s => {
      const bd = s.paymentBreakdown || {};
      const method = (s.paymentMethod || '').toLowerCase();
      const bEfectivo = Number(bd.efectivo || 0);
      const bTarjeta = Number(bd.tarjeta || 0);
      const bTransferencia = Number(bd.transferencia || 0);
      const breakdownTotal = bEfectivo + bTarjeta + bTransferencia;
      if (breakdownTotal > 0) {
        efectivo += bEfectivo;
        electronico += bTarjeta + bTransferencia;
        return;
      }
      if (method.includes('efectivo') && !method.includes('mixto')) {
        efectivo += Number(s.total || 0);
      } else if (method.includes('tarjeta') || method.includes('transfer') || method.includes('electronico') || method.includes('mixto')) {
        electronico += Number(s.total || 0);
      } else {
        efectivo += Number(s.total || 0);
      }
    });
    return { efectivo, electronico };
  },

  getProductStats(filtered) {
    const products = Database.getProducts() || [];
    const byId = new Map(products.map(p => [p.id, p]));
    const stats = new Map();
    filtered.forEach(s => {
      (s.items || []).forEach(item => {
        const id = item.productId;
        if (!id) return;
        const qty = Number(item.quantity) || 0;
        const price = Number(item.price || item.precio || 0) || 0;
        if (!stats.has(id)) {
          stats.set(id, {
            nombre: item.productName || item.nombre || (byId.get(id) && byId.get(id).nombre) || 'Producto',
            categoria: (byId.get(id) && byId.get(id).categoria) || '',
            cantidad: 0,
            ingreso: 0
          });
        }
        const st = stats.get(id);
        st.cantidad += qty;
        st.ingreso += qty * price;
      });
    });
    return [...stats.values()].sort((a, b) => b.cantidad - a.cantidad || b.ingreso - a.ingreso);
  },

  // ---------- Paneles de acordeón ----------
  renderSalesPanel(filtered) {
    if (!filtered.length) {
      return '<div class="reports-empty">No hay ventas en el periodo seleccionado.</div>';
    }
    let html = '<div class="reports-list"><table class="reports-table"><thead><tr><th>Hora</th><th>Productos</th><th>Método</th><th class="num">Total</th></tr></thead><tbody>';
    [...filtered].reverse().forEach(s => {
      const items = Array.isArray(s.items) ? s.items : [];
      const qty = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
      const method = (s.paymentMethod || '').toLowerCase();
      let metodo = 'Efectivo';
      if (method.includes('tarjeta') || method.includes('transfer')) metodo = 'Tarjeta/Transferencia';
      else if (method.includes('mixto') || method.includes('electronico')) metodo = 'Mixto';
      html += `<tr><td>${this.formatDateTime(s.fecha)}</td><td>${qty} ${qty === 1 ? 'pieza' : 'piezas'}</td><td><span class="reports-chip">${this.escapeHtml(metodo)}</span></td><td class="num">${this.formatCurrency(s.total || 0)}</td></tr>`;
    });
    html += '</tbody></table></div>';
    return html;
  },

  renderCutsPanel(cuts) {
    if (!cuts.length) {
      return '<div class="reports-empty">No hay cortes de caja en el periodo seleccionado.</div>';
    }
    let html = '<div class="reports-list"><table class="reports-table"><thead><tr><th>Fecha</th><th class="num">Total</th></tr></thead><tbody>';
    cuts.forEach(c => {
      html += `<tr><td>${this.formatDateTime(c.fecha)}</td><td class="num">${this.formatCurrency(Number(c.totalGeneral) || 0)}</td></tr>`;
    });
    html += '</tbody></table></div>';
    return html;
  },

  // ---------- Vista principal ----------
  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const filtered = this.getFilteredSales();
    const { efectivo, electronico } = this.paymentTotals(filtered);
    const cuts = this.getCutsByPeriod(this.currentFilter);
    const totalCuts = cuts.reduce((sum, c) => sum + (Number(c.totalGeneral) || 0), 0);
    const totalVentas = filtered.reduce((sum, s) => sum + (s.total || 0), 0);
    const transacciones = filtered.length;
    const promoGains = filtered.reduce((sum, s) => {
      const pd = Number(s.promoDiscount) || 0;
      if (pd <= 0) return sum;
      const items = Array.isArray(s.items) ? s.items : [];
      const hasPromoItem = items.some(item => {
        if (!item) return false;
        const cat = (item.categoria || item.category || item.tipo || '').toString().toLowerCase();
        if (cat.includes('promo')) return true;
        if (cat.includes('comb')) return true;
        if (cat.includes('paquet')) return true;
        if (item.esPromo === true || item.isPromo === true || item.promo === true) return true;
        return false;
      });
      if (!hasPromoItem) return sum;
      return sum + pd;
    }, 0);

    const isOpen = acc => this.openAcc === acc;

    let html = `
      <div class="reports-view">
        <div class="reports-header">
          <h2>Reportes</h2>
        </div>

        <div class="reports-metrics-grid">
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Fondo Inicial</span><span class="metric-icon">💵</span></div>
            <div class="metric-value">${this.formatCurrency(this.getOpeningAmount())}</div>
            <div class="metric-sub">Apertura de caja</div>
          </div>
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Total de Ventas</span><span class="metric-icon">💰</span></div>
            <div class="metric-value highlight">${this.formatCurrency(totalVentas)}</div>
            <div class="metric-sub">${transacciones} transacciones</div>
          </div>
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Transacciones</span><span class="metric-icon">🧾</span></div>
            <div class="metric-value">${transacciones}</div>
            <div class="metric-sub">En el periodo</div>
          </div>
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Efectivo</span><span class="metric-icon">💵</span></div>
            <div class="metric-value">${this.formatCurrency(efectivo)}</div>
            <div class="metric-sub">Pagos en efectivo</div>
          </div>
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Tarjeta / Transferencia</span><span class="metric-icon">💳</span></div>
            <div class="metric-value highlight">${this.formatCurrency(electronico)}</div>
            <div class="metric-sub">Tarjeta y transferencia</div>
          </div>
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Cortes de Caja</span><span class="metric-icon">🔒</span></div>
            <div class="metric-value">${this.formatCurrency(totalCuts)}</div>
            <div class="metric-sub">${cuts.length} cortes</div>
          </div>
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Ganancias de Promociones</span><span class="metric-icon">🎁</span></div>
            <div class="metric-value">${this.formatCurrency(promoGains)}</div>
            <div class="metric-sub">Descuentos aplicados</div>
          </div>
        </div>

        <div class="reports-period">
          <button class="period-btn ${this.currentFilter === 'dia' ? 'active' : ''}" data-filter="dia">Día</button>
          <button class="period-btn ${this.currentFilter === 'semana' ? 'active' : ''}" data-filter="semana">Semana</button>
          <button class="period-btn ${this.currentFilter === 'mes' ? 'active' : ''}" data-filter="mes">Mes</button>
        </div>

        <div class="reports-accordion-bar">
          <button type="button" class="reports-acc-btn ${isOpen('sales') ? 'active' : ''}" data-acc="sales" aria-expanded="${isOpen('sales')}">
            <div class="reports-acc-row"><span class="reports-acc-icon">📋</span><span class="reports-acc-label">Historial de Turno</span></div>
            <span class="reports-acc-chevron">▾</span>
          </button>
          <button type="button" class="reports-acc-btn ${isOpen('cuts') ? 'active' : ''}" data-acc="cuts" aria-expanded="${isOpen('cuts')}">
            <div class="reports-acc-row"><span class="reports-acc-icon">💰</span><span class="reports-acc-label">Cortes de Caja</span></div>
            <span class="reports-acc-chevron">▾</span>
          </button>
          <button type="button" class="reports-acc-btn ${isOpen('hours') ? 'active' : ''}" data-acc="hours" aria-expanded="${isOpen('hours')}">
            <div class="reports-acc-row"><span class="reports-acc-icon">🕒</span><span class="reports-acc-label">Horarios Pico</span></div>
            <span class="reports-acc-chevron">▾</span>
          </button>
          <button type="button" class="reports-acc-btn ${isOpen('products') ? 'active' : ''}" data-acc="products" aria-expanded="${isOpen('products')}">
            <div class="reports-acc-row"><span class="reports-acc-icon">🏆</span><span class="reports-acc-label">Productos Más Vendidos</span></div>
            <span class="reports-acc-chevron">▾</span>
          </button>
        </div>

        <div class="reports-accordion-panels">
          <div class="reports-acc-panel" id="reports-acc-panel-sales" data-acc-panel="sales" ${!isOpen('sales') ? 'hidden' : ''}>
            ${this.renderSalesPanel(filtered)}
          </div>
          <div class="reports-acc-panel" id="reports-acc-panel-cuts" data-acc-panel="cuts" ${!isOpen('cuts') ? 'hidden' : ''}>
            ${this.renderCutsPanel(cuts)}
          </div>
          <div class="reports-acc-panel" id="reports-acc-panel-hours" data-acc-panel="hours" ${!isOpen('hours') ? 'hidden' : ''}>
            <div class="reports-chart-wrap"><canvas id="reports-chart-hours" height="250"></canvas></div>
          </div>
          <div class="reports-acc-panel" id="reports-acc-panel-products" data-acc-panel="products" ${!isOpen('products') ? 'hidden' : ''}>
            <div class="reports-chart-wrap"><canvas id="reports-chart-products" height="250"></canvas></div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
    this.bindEvents();
    if (isOpen('hours')) this.renderHoursChart();
    if (isOpen('products')) this.renderProductsChart();
  },

  bindEvents() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    container.querySelectorAll('.period-btn').forEach(btn => {
      btn.onclick = () => {
        this.currentFilter = btn.dataset.filter;
        this.render();
      };
    });

    container.querySelectorAll('.reports-acc-btn').forEach(btn => {
      btn.onclick = () => {
        const acc = btn.dataset.acc;
        this.openAcc = this.openAcc === acc ? null : acc;
        this.render();
      };
    });
  },

  renderHoursChart() {
    const canvas = document.getElementById('reports-chart-hours');
    if (!canvas || !window.Chart) return;
    const ctx = canvas.getContext('2d');
    if (this.chartHours) {
      try { this.chartHours.destroy(); } catch (e) {}
    }
    const filtered = this.getFilteredSales();
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const counts = hours.map(h => {
      return filtered.filter(s => {
        const d = new Date(s.fecha);
        return d.getHours() === h;
      }).reduce((sum, s) => sum + (s.total || 0), 0);
    });
    const labels = hours.map(h => String(h).padStart(2, '0') + ':00');
    this.chartHours = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Ventas por hora ($)',
          data: counts,
          borderColor: '#E0A96D',
          backgroundColor: 'rgba(224, 169, 109, 0.25)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#E0A96D'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#FAF4EE' } } },
        scales: {
          x: { ticks: { color: '#B8A89A' }, grid: { color: 'rgba(224, 169, 109, 0.15)' } },
          y: { ticks: { color: '#B8A89A' }, grid: { color: 'rgba(224, 169, 109, 0.15)' } }
        }
      }
    });
  },

  renderProductsChart() {
    const canvas = document.getElementById('reports-chart-products');
    if (!canvas || !window.Chart) return;
    const ctx = canvas.getContext('2d');
    if (this.chartProducts) {
      try { this.chartProducts.destroy(); } catch (e) {}
    }
    const filtered = this.getFilteredSales();
    const stats = this.getProductStats(filtered).slice(0, 10);
    const labels = stats.map(s => s.nombre.length > 18 ? s.nombre.substring(0, 18) + '…' : s.nombre);
    const data = stats.map(s => s.cantidad);
    this.chartProducts = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Cantidad vendida',
          data: data,
          backgroundColor: 'rgba(224, 169, 109, 0.6)',
          borderColor: '#E0A96D',
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#FAF4EE' } } },
        scales: {
          x: { ticks: { color: '#B8A89A' }, grid: { color: 'rgba(224, 169, 109, 0.15)' } },
          y: { ticks: { color: '#B8A89A' }, grid: { color: 'rgba(224, 169, 109, 0.15)' } }
        }
      }
    });
  }
};

if (typeof window !== 'undefined') {
  window.ReportsManager = ReportsManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReportsManager;
}
