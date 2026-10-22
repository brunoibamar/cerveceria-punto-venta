// Reportes: métricas compactas en cuadrícula, acordeones por botón y gráficas controladas
const ReportsManager = {
  containerId: 'reports-content',
  chartHours: null,
  chartProducts: null,
  currentFilter: 'dia',
  openAcc: null,
  liveBound: false,
  cutsModalOpen: false,
  cutsModalFilter: 'dia',
  cutsModalExpanded: [],
  monthNames: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  dayNames: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],


  init(containerId) {
    this.containerId = containerId || this.containerId;
    this.chartHours = null;
    this.chartProducts = null;
    if (!this.cutDate) this.cutDate = this.dateKey(new Date());
    if (!this.salesDate) this.salesDate = this.dateKey(new Date());
    this.bindLiveSales();
    this.bindModalKeys();
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

  // Cierra el modal de cortes con la tecla Escape
  bindModalKeys() {
    if (this.keysBound) return;
    this.keysBound = true;
    document.addEventListener('keydown', (event) => {
      if (!this.cutsModalOpen) return;
      if (event.key !== 'Escape') return;
      this.cutsModalOpen = false;
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
      case 'año': {
        start.setHours(0, 0, 0, 0);
        start.setMonth(0);
        start.setDate(1);
        end.setHours(23, 59, 59, 999);
        end.setMonth(11);
        end.setDate(31);
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
    const sales = (typeof Database !== 'undefined' && Database.getSales) ? (Database.getSales() || []) : [];
    const { start, end } = this.getDateRange(filter);
    return (sales || []).filter(s => {
      if (!s) return false;
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
      if (!cut) return false;
      const date = new Date(cut.fecha);
      return !isNaN(date) && date >= start && date <= end;
    });
  },

  getCutsByDate(dateKey) {
    const target = dateKey || this.dateKey(new Date());
    return this.getClosedCuts().filter(cut => cut && this.dateKey(cut.fecha) === target);
  },

  getLiveTurnSummary() {
    try {
      if (typeof POS !== 'undefined' && typeof POS.getSessionInfo === 'function') {
        const s = POS.getSessionInfo();
        if (s) return { cantidadVentas: Number(s.ventas || 0) || 0, totalVentas: Number(s.total || 0) || 0 };
      }
    } catch (e) {}
    return null;
  },

  renderLiveTurnCard(summary) {
    if (!summary) return '';
    return `<div class="reports-card"><strong>Turno actual</strong><div>${summary.cantidadVentas} ventas · ${this.formatCurrency(summary.totalVentas)}</div></div>`;
  },

  renderCutCard(cut) {
    if (!cut) return '';
    return `<div class="reports-card"><div>${this.formatDateTime(cut.fecha)}</div><div>${this.formatCurrency(Number(cut.totalGeneral) || 0)}</div></div>`;
  },

  getClosedCuts() {
    const cuts = (typeof Database !== 'undefined' && Database.getCuts) ? (Database.getCuts() || []) : [];
    return (cuts || [])
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
    let html = '<div class="reports-list"><div class="reports-table-wrap"><table class="reports-table"><thead><tr><th>Hora</th><th>Productos</th><th>Método</th><th class="num">Total</th></tr></thead><tbody>';
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

  renderCutsPanel(cuts, filter = this.currentFilter) {
    const safeCuts = Array.isArray(cuts) ? cuts : [];
    if (!safeCuts.length && filter !== 'dia') {
      return '<div class="reports-empty">No hay cortes de caja en el periodo seleccionado.</div>';
    }
    if (filter !== 'dia') {
      let html = '<div class="reports-list"><table class="reports-table"><thead><tr><th>Periodo</th><th class="num">Total</th></tr></thead><tbody>';
       safeCuts.forEach(c => {
        html += `<tr><td>${this.formatDateTime(c.fecha)}</td><td class="num">${this.formatCurrency(Number(c.totalGeneral) || 0)}</td></tr>`;
      });
    html += '</tbody></table></div></div>';
      return html;
    }

    const liveSummary = this.getLiveTurnSummary();
    const hasLive = liveSummary && (liveSummary.cantidadVentas > 0 || liveSummary.totalVentas > 0);

    let html = '<div class="reports-list">';

    // Tarjeta especial: TURNO ACTUAL EN CURSO
    if (hasLive) {
      html += this.renderLiveTurnCard(liveSummary);
    }

    safeCuts.forEach(c => {
      html += this.renderCutCard(c);
    });

    if (!cuts.length && !hasLive) {
      html += '<div class="reports-empty">No hay cortes de caja en el periodo seleccionado.</div>';
    }

    html += '</div>';
    return html;
  },

  // ==========================================================
  // Modal de cortes de caja: tarjetas desplegables por sección
  // ==========================================================

  // Etiqueta legible del rol del cajero que realizó el corte
  cutsRoleLabel(cut) {
    const raw = String((cut && (cut.rol || cut.role)) || '').trim().toLowerCase();
    if (!raw) return 'Cajero';
    if (raw === 'admin' || raw === 'administrador') return 'Administrador';
    if (raw === 'empleado' || raw === 'employee' || raw === 'staff') return 'Empleado';
    if (raw === 'guest' || raw === 'invitado') return 'Invitado';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  },

  // Fecha efectiva del corte (cierre si existe, si no la de registro)
  cutsDate(cut) {
    if (!cut) return null;
    const date = new Date(cut.fechaCierre || cut.fecha);
    return isNaN(date.getTime()) ? null : date;
  },

  cutsDateKey(cut) {
    const date = this.cutsDate(cut);
    return date ? this.dateKey(date) : '';
  },

  // Horario de cierre del corte (formato 24 horas)
  cutsCloseTime(cut) {
    if (!cut) return '--:--';
    const date = this.cutsDate(cut);
    if (date) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    if (cut.horaCierre) return String(cut.horaCierre).slice(0, 5);
    return '--:--';
  },

  // Horario del ticket dentro del desglose (formato 24 horas)
  cutsTicketTime(ticket) {
    if (!ticket) return '--:--';
    const date = new Date(ticket.fecha);
    if (!isNaN(date.getTime())) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    if (ticket.hora) return String(ticket.hora).slice(0, 5);
    return '--:--';
  },

  // Etiqueta del método de pago de un ticket
  cutsPaymentLabel(ticket) {
    if (!ticket) return 'Efectivo';
    if (ticket.paymentLabel) return ticket.paymentLabel;
    const method = String(ticket.paymentMethod || 'efectivo').toLowerCase();
    if (method.includes('tarjeta')) return 'Tarjeta';
    if (method.includes('transfer')) return 'Transferencia';
    if (method.includes('mixto')) return 'Mixto';
    if (method.includes('electronico')) return 'Electrónico';
    return 'Efectivo';
  },

  // Icono asociado al método de pago
  cutsPaymentIcon(label) {
    const value = String(label || '').toLowerCase();
    if (value.includes('tarjeta')) return '💳';
    if (value.includes('transfer')) return '🏦';
    if (value.includes('mixto')) return '🔀';
    return '💵';
  },

  // Clave estable de una tarjeta de corte
  cutsKey(cut, index) {
    const id = cut && (cut.id || cut.turnoId);
    if (id) return `cut:${id}`;
    return `cut:${this.cutsDateKey(cut)}-${index}`;
  },

  // Empaqueta los cortes con su clave de tarjeta
  cutsEntries(cuts) {
    return (cuts || []).map((cut, index) => ({ cut: cut, key: this.cutsKey(cut, index) }));
  },

  // Lunes de la semana a la que pertenece una fecha
  cutsWeekStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - (day - 1));
    return d;
  },

  // Nombre del día en español con la semana empezando en lunes
  cutsDayName(date) {
    if (!date) return '';
    const index = date.getDay() === 0 ? 6 : date.getDay() - 1;
    return this.dayNames[index] || '';
  },

  // Etiqueta de la semana: "Semana del 21 al 28"
  cutsWeekLabel(from, to) {
    if (!from || !to) return 'Semana';
    const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
    if (sameMonth) return `Semana del ${from.getDate()} al ${to.getDate()}`;
    const first = this.monthNames[from.getMonth()].toLowerCase();
    const second = this.monthNames[to.getMonth()].toLowerCase();
    return `Semana del ${from.getDate()} ${first} al ${to.getDate()} ${second}`;
  },

  cutsTotal(entries) {
    return (entries || []).reduce((sum, entry) => sum + (Number(entry.cut.totalGeneral) || 0), 0);
  },

  // Construye las tarjetas del modal según la pestaña activa
  buildCutsGroups(filter) {
    const cuts = this.getCutsByPeriod(filter);
    if (filter === 'semana') return this.groupCutsByDays(cuts);
    if (filter === 'mes') return this.groupCutsByWeeks(cuts);
    if (filter === 'año') return this.groupCutsByMonths(cuts);
    return this.groupCutsByTurns(cuts);
  },

  // Día / Turno actual: una tarjeta por corte realizado
  groupCutsByTurns(cuts) {
    const ordered = [...(cuts || [])].reverse();
    return this.cutsEntries(ordered).map(entry => {
      const cut = entry.cut;
      const ventas = Number(cut.cantidadVentas) || 0;
      return {
        kind: 'cut',
        key: entry.key,
        icon: '🔒',
        title: `${cut.turno || 'Corte'} · ${this.formatDateLabel(this.cutsDateKey(cut))}`,
        subtitle: `Cerró ${this.cutsCloseTime(cut)} · ${this.cutsRoleLabel(cut)} · ${ventas} ${ventas === 1 ? 'venta' : 'ventas'}`,
        entries: [entry],
        total: Number(cut.totalGeneral) || 0
      };
    });
  },

  // Semana: una tarjeta por día (lunes a domingo)
  groupCutsByDays(cuts) {
    const { start } = this.getDateRange('semana');
    const groups = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      const key = this.dateKey(day);
      const entries = this.cutsEntries((cuts || []).filter(cut => this.cutsDateKey(cut) === key));
      groups.push({
        kind: 'group',
        key: `dia:${key}`,
        icon: String(day.getDate()),
        title: this.cutsDayName(day),
        subtitle: `${day.getDate()} de ${this.monthNames[day.getMonth()].toLowerCase()}`,
        entries: entries,
        total: this.cutsTotal(entries)
      });
    }
    return groups;
  },

  // Mes: una tarjeta por semana (ej. "Semana del 21 al 28")
  groupCutsByWeeks(cuts) {
    const { start, end } = this.getDateRange('mes');
    const cursor = this.cutsWeekStart(start);
    const groups = [];
    while (cursor.getTime() <= end.getTime()) {
      const weekEnd = new Date(cursor);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      const from = cursor.getTime() < start.getTime() ? new Date(start) : new Date(cursor);
      const to = weekEnd.getTime() > end.getTime() ? new Date(end) : new Date(weekEnd);
      // Los cortes siempre se asignan a su semana calendario recortada al mes
      const entries = this.cutsEntries((cuts || []).filter(cut => {
        const date = this.cutsDate(cut);
        return date && date.getTime() >= cursor.getTime() && date.getTime() <= weekEnd.getTime();
      }));
      // Si el recorte deja menos de 4 días se muestra la semana calendario completa
      const span = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
      const labelFrom = span < 4 ? new Date(cursor) : from;
      const labelTo = span < 4 ? new Date(weekEnd) : to;
      groups.push({
        kind: 'group',
        key: `semana:${this.dateKey(cursor)}`,
        icon: String(labelFrom.getDate()),
        title: this.cutsWeekLabel(labelFrom, labelTo),
        subtitle: `${this.cutsDayName(labelFrom)} – ${this.cutsDayName(labelTo)}`,
        entries: entries,
        total: this.cutsTotal(entries)
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return groups;
  },

  // Año: una tarjeta por mes (enero a diciembre)
  groupCutsByMonths(cuts) {
    const { start } = this.getDateRange('año');
    const year = start.getFullYear();
    const groups = [];
    for (let m = 0; m < 12; m++) {
      const from = new Date(year, m, 1, 0, 0, 0, 0);
      const to = new Date(year, m + 1, 0, 23, 59, 59, 999);
      const entries = this.cutsEntries((cuts || []).filter(cut => {
        const date = this.cutsDate(cut);
        return date && date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
      }));
      groups.push({
        kind: 'group',
        key: `mes:${year}-${String(m + 1).padStart(2, '0')}`,
        icon: String(m + 1),
        title: this.monthNames[m],
        subtitle: String(year),
        entries: entries,
        total: this.cutsTotal(entries)
      });
    }
    return groups;
  },

  // Tarjeta principal (acordeón) del modal
  renderCutsCard(group) {
    const open = this.cutsModalExpanded.indexOf(group.key) !== -1;
    const count = (group.entries || []).length;
    const badge = count ? `${count} ${count === 1 ? 'corte' : 'cortes'}` : 'Sin cortes';
    const note = group.kind === 'cut' ? this.escapeHtml(group.subtitle) : `${this.escapeHtml(group.subtitle)} · ${badge}`;
    return `
      <div class="cuts-group">
        <button type="button" class="cuts-card ${count ? '' : 'is-empty'}" data-cuts-toggle="${group.key}" aria-expanded="${open}" ${count ? '' : 'disabled'}>
          <span class="cuts-card-icon">${group.icon}</span>
          <span class="cuts-card-head">
            <span class="cuts-card-title">${this.escapeHtml(group.title)}</span>
            <span class="cuts-card-sub">${note}</span>
          </span>
          <span class="cuts-card-side">
            <span class="cuts-card-total">${this.formatCurrency(group.total)}</span>
            <span class="cuts-card-caret">▾</span>
          </span>
        </button>
        <div class="cuts-card-panel" data-cuts-panel="${group.key}" ${open ? '' : 'hidden'}>
          ${this.renderCutsPanelContent(group)}
        </div>
      </div>`;
  },

  // Contenido del acordeón: el corte o la lista de cortes del grupo
  renderCutsPanelContent(group) {
    const entries = group.entries || [];
    if (group.kind === 'cut') {
      if (!entries.length) return '<div class="cuts-panel-empty">Corte sin información disponible.</div>';
      return this.renderCutDetail(entries[0].cut);
    }
    if (!entries.length) {
      return '<div class="cuts-panel-empty">No hay cortes registrados en este periodo.</div>';
    }
    return `<div class="cuts-panel-list">${entries.map(entry => this.renderCutsCutRow(entry)).join('')}</div>`;
  },

  // Fila de corte dentro de un grupo (acordeón anidado)
  renderCutsCutRow(entry) {
    const cut = entry.cut;
    const open = this.cutsModalExpanded.indexOf(entry.key) !== -1;
    const ventas = Number(cut.cantidadVentas) || 0;
    return `
      <div class="cuts-cut ${open ? 'is-open' : ''}">
        <button type="button" class="cuts-cut-head" data-cuts-toggle="${entry.key}" aria-expanded="${open}">
          <span class="cuts-cut-time">${this.cutsCloseTime(cut)}</span>
          <span class="cuts-cut-meta">
            <span class="cuts-cut-title">${this.escapeHtml(cut.turno || 'Corte')}</span>
            <span class="cuts-cut-role">${this.escapeHtml(this.cutsRoleLabel(cut))} · ${ventas} ${ventas === 1 ? 'venta' : 'ventas'}</span>
          </span>
          <span class="cuts-cut-side">
            <span class="cuts-cut-total">${this.formatCurrency(Number(cut.totalGeneral) || 0)}</span>
            <span class="cuts-card-caret">▾</span>
          </span>
        </button>
        <div class="cuts-cut-panel" data-cuts-panel="${entry.key}" ${open ? '' : 'hidden'}>
          ${this.renderCutDetail(cut)}
        </div>
      </div>`;
  },

  // Desglose detallado del corte: resumen de caja y tabla de productos
  renderCutDetail(cut) {
    if (!cut) return '';
    const tickets = Array.isArray(cut.tickets) ? cut.tickets.filter(t => t) : [];
    const total = Number(cut.totalGeneral) || 0;
    const ventas = Number(cut.cantidadVentas) || 0;
    const diferencia = Number(cut.diferencia) || 0;
    const estado = cut.estado || (Math.abs(diferencia) < 0.005 ? 'exacto' : (diferencia > 0 ? 'sobrante' : 'faltante'));
    const estadoLabel = { exacto: 'Exacto', sobrante: 'Sobrante', faltante: 'Faltante' }[estado] || 'Cerrado';

    let html = '<div class="cuts-detail">';

    html += `<div class="cuts-detail-summary">
      <div class="cuts-detail-cell"><span class="cuts-detail-label">Fondo inicial</span><span class="cuts-detail-value">${this.formatCurrency(cut.montoApertura !== undefined ? cut.montoApertura : (cut.montoInicial || 0))}</span></div>
      <div class="cuts-detail-cell"><span class="cuts-detail-label">Ventas</span><span class="cuts-detail-value">${ventas}</span></div>
      <div class="cuts-detail-cell"><span class="cuts-detail-label">Efectivo</span><span class="cuts-detail-value">${this.formatCurrency(cut.ventasEfectivo || 0)}</span></div>
      <div class="cuts-detail-cell"><span class="cuts-detail-label">Tarjeta</span><span class="cuts-detail-value">${this.formatCurrency(cut.ventasTarjeta || 0)}</span></div>
      <div class="cuts-detail-cell"><span class="cuts-detail-label">Transferencia</span><span class="cuts-detail-value">${this.formatCurrency(cut.ventasTransferencia || 0)}</span></div>
      <div class="cuts-detail-cell"><span class="cuts-detail-label">Diferencia</span><span class="cuts-detail-value ${this.differenceClass(diferencia)}">${this.formatCurrency(diferencia)}</span></div>
    </div>`;

    html += '<div class="cuts-detail-tickets">';
    if (!tickets.length) {
      html += '<div class="cuts-panel-empty">Este corte no contiene tickets registrados.</div>';
    } else {
      html += '<table class="cuts-items"><thead><tr><th>Producto</th><th class="num">Piezas</th><th class="num">Subtotal</th><th>Método</th></tr></thead><tbody>';
      tickets.forEach(ticket => {
        const metodo = this.cutsPaymentLabel(ticket);
        const items = Array.isArray(ticket.items) ? ticket.items.filter(it => it) : [];
        html += `<tr class="cuts-items-ticket"><td colspan="4"><span class="cuts-ticket-time">${this.cutsTicketTime(ticket)}</span><span class="cuts-ticket-meta">${items.length} ${items.length === 1 ? 'renglón' : 'renglones'}</span></td></tr>`;
        if (!items.length) {
          html += '<tr class="cuts-items-empty"><td colspan="4">Sin productos registrados en este ticket.</td></tr>';
        }
        items.forEach(item => {
          const cold = item.cold === true || item.piezaFria === true || item.piezaFria === 'true';
          const nombre = item.nombre || item.productName || 'Producto';
          const cantidad = Number(item.cantidad) || 0;
          const subtotal = Number(item.subtotal) || (cantidad * (Number(item.precio) || 0));
          html += `<tr>
            <td class="cuts-item-name">${this.escapeHtml(nombre)}${cold ? ' <span class="cuts-cold" title="Bebida fría">❄️</span>' : ''}</td>
            <td class="num">${cantidad}</td>
            <td class="num">${this.formatCurrency(subtotal)}</td>
            <td><span class="cuts-chip">${this.cutsPaymentIcon(metodo)} ${this.escapeHtml(metodo)}</span></td>
          </tr>`;
        });
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    html += `<div class="cuts-detail-footer">
      <span class="cuts-detail-label">Total del corte</span>
      <span class="cuts-detail-total">${this.formatCurrency(total)}</span>
      <span class="cuts-status is-${this.escapeHtml(estado)}">${this.escapeHtml(estadoLabel)}</span>
    </div>`;

    html += '</div>';
    return html;
  },

  // Tarjeta del turno en curso (solo informativa)
  renderCutsLiveCard(summary) {
    if (!summary) return '';
    const ventas = Number(summary.cantidadVentas) || 0;
    const total = Number(summary.totalVentas) || 0;
    return `
      <div class="cuts-group">
        <div class="cuts-card cuts-card-live">
          <span class="cuts-card-icon">🟢</span>
          <span class="cuts-card-head">
            <span class="cuts-card-title">Turno en curso</span>
            <span class="cuts-card-sub">Ventas activas de esta sesión · ${ventas} ${ventas === 1 ? 'venta' : 'ventas'}</span>
          </span>
          <span class="cuts-card-side">
            <span class="cuts-card-total">${this.formatCurrency(total)}</span>
            <span class="cuts-live-badge">En vivo</span>
          </span>
        </div>
      </div>`;
  },

  renderCutsModal() {
    const filter = this.cutsModalFilter || 'dia';
    const cuts = this.getCutsByPeriod(filter);
    const totalCuts = cuts.reduce((sum, c) => sum + (Number(c.totalGeneral) || 0), 0);
    const totalVentas = cuts.reduce((sum, c) => sum + (Number(c.cantidadVentas) || 0), 0);
    const groups = this.buildCutsGroups(filter);
    const filters = [
      { id: 'dia', label: 'Día / Turno Actual' },
      { id: 'semana', label: 'Semana' },
      { id: 'mes', label: 'Mes' },
      { id: 'año', label: 'Año' }
    ];

    const liveSummary = this.getLiveTurnSummary();
    const hasLive = filter === 'dia' && liveSummary && (liveSummary.cantidadVentas > 0 || liveSummary.totalVentas > 0);

    let body = '';
    if (hasLive) body += this.renderCutsLiveCard(liveSummary);
    body += groups.map(group => this.renderCutsCard(group)).join('');
    if (!groups.length) {
      body += '<div class="cuts-panel-empty">No hay cortes de caja en el periodo seleccionado.</div>';
    }

    return `
      <div class="cuts-modal-overlay">
        <div class="cuts-modal-backdrop" data-cuts-modal-close="true"></div>
        <div class="cuts-modal" role="dialog" aria-modal="true" aria-label="Cortes de caja">
          <div class="cuts-modal-head">
            <div class="cuts-modal-titles">
              <span class="cuts-modal-eyebrow">Historial de caja</span>
              <h3 class="cuts-modal-title">Cortes de Caja</h3>
            </div>
            <button type="button" class="cuts-modal-close" data-cuts-modal-close="true" aria-label="Cerrar cortes de caja">✕</button>
          </div>

          <div class="cuts-modal-summary">
            <div class="cuts-modal-total">
              <span class="cuts-modal-total-value">${this.formatCurrency(totalCuts)}</span>
              <span class="cuts-modal-total-label">Total del periodo</span>
            </div>
            <div class="cuts-modal-badges">
              <span class="cuts-modal-badge">🔒 ${cuts.length} ${cuts.length === 1 ? 'corte' : 'cortes'}</span>
              <span class="cuts-modal-badge">🧾 ${totalVentas} ${totalVentas === 1 ? 'venta' : 'ventas'}</span>
            </div>
          </div>

          <div class="cuts-modal-filters" role="tablist">
            ${filters.map(f => `<button type="button" class="cuts-modal-filter ${filter === f.id ? 'active' : ''}" data-cuts-filter="${f.id}" role="tab" aria-selected="${filter === f.id}">${f.label}</button>`).join('')}
          </div>

          <div class="cuts-modal-body">
            ${body}
          </div>
        </div>
      </div>`;
  },

  // Despliega o contrae una tarjeta sin rehacer todo el reporte
  toggleCutsModalExpanded(key) {
    if (!key) return;
    const index = this.cutsModalExpanded.indexOf(key);
    const open = index === -1;
    if (open) this.cutsModalExpanded.push(key);
    else this.cutsModalExpanded.splice(index, 1);

    const container = document.getElementById(this.containerId);
    if (!container) return;
    const trigger = container.querySelector('[data-cuts-toggle="' + key + '"]');
    const panel = container.querySelector('[data-cuts-panel="' + key + '"]');
    if (trigger) trigger.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
    const wrap = trigger && trigger.closest('.cuts-cut');
    if (wrap) wrap.classList.toggle('is-open', open);
  },

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
           <div class="metric-card metric-card-clickable" data-open-cuts-modal="true">
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
          <button class="period-btn ${this.currentFilter === 'año' ? 'active' : ''}" data-filter="año">Año</button>
        </div>

        <div class="reports-accordion-bar">
          ${this.currentFilter === 'dia' ? `<button type="button" class="reports-acc-btn ${isOpen('sales') ? 'active' : ''}" data-acc="sales" aria-expanded="${isOpen('sales')}">
            <div class="reports-acc-row"><span class="reports-acc-icon">📋</span><span class="reports-acc-label">Historial de Turno</span></div>
            <span class="reports-acc-chevron">▾</span>
          </button>` : ''}

          <button type="button" class="reports-acc-btn ${isOpen('hours') ? 'active' : ''}" data-acc="hours" aria-expanded="${isOpen('hours')}">
            <div class="reports-acc-row"><span class="reports-acc-icon">🕒</span><span class="reports-acc-label">${this.currentFilter === 'dia' ? 'Horarios Pico' : (this.currentFilter === 'semana' ? 'Ventas por Día' : (this.currentFilter === 'mes' ? 'Ventas por Semana' : 'Ventas por Mes'))}</span></div>
            <span class="reports-acc-chevron">▾</span>
          </button>
          <button type="button" class="reports-acc-btn ${isOpen('products') ? 'active' : ''}" data-acc="products" aria-expanded="${isOpen('products')}">
            <div class="reports-acc-row"><span class="reports-acc-icon">🏆</span><span class="reports-acc-label">Productos Más Vendidos</span></div>
            <span class="reports-acc-chevron">▾</span>
          </button>
        </div>

        <div class="reports-accordion-panels">
          ${this.currentFilter === 'dia' ? `<div class="reports-acc-panel" id="reports-acc-panel-sales" data-acc-panel="sales" ${!isOpen('sales') ? 'hidden' : ''}>
            ${this.renderSalesPanel(filtered)}
          </div>` : ''}

          <div class="reports-acc-panel" id="reports-acc-panel-hours" data-acc-panel="hours" ${!isOpen('hours') ? 'hidden' : ''}>
            <div class="reports-chart-wrap"><canvas id="reports-chart-hours" height="250"></canvas></div>
          </div>
          <div class="reports-acc-panel" id="reports-acc-panel-products" data-acc-panel="products" ${!isOpen('products') ? 'hidden' : ''}>
            <div class="reports-chart-wrap"><canvas id="reports-chart-products" height="250"></canvas></div>
          </div>
         </div>
       </div>
       ${this.cutsModalOpen ? this.renderCutsModal() : ''}
     `;


    container.innerHTML = html;
    this.bindEvents();
    if (isOpen('hours')) this.renderPeriodChart();
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

     container.querySelectorAll('.metric-card-clickable').forEach(card => {
       card.onclick = () => { this.cutsModalOpen = true; this.render(); };
     });
     container.querySelectorAll('[data-cuts-modal-close="true"]').forEach(el => {
       el.onclick = () => { this.cutsModalOpen = false; this.render(); };
     });
     container.querySelectorAll('[data-cuts-filter]').forEach(btn => {
       btn.onclick = () => { this.cutsModalFilter = btn.dataset.cutsFilter; this.render(); };
     });
     container.querySelectorAll('[data-cuts-toggle]').forEach(el => {
       el.onclick = () => { this.toggleCutsModalExpanded(el.dataset.cutsToggle); };
     });
   },


  renderPeriodChart() {
    const canvas = document.getElementById('reports-chart-hours');
    if (!canvas || !window.Chart) return;
    const ctx = canvas.getContext('2d');
    if (this.chartHours) {
      try { this.chartHours.destroy(); } catch (e) {}
    }
    const filtered = this.getFilteredSales();
    const filter = this.currentFilter;
    let labels = [];
    let data = [];
    let label = 'Ventas';
    if (filter === 'dia') {
      const hours = Array.from({ length: 24 }, (_, i) => i);
      labels = hours.map(h => String(h).padStart(2, '0') + ':00');
      data = hours.map(h => filtered.filter(s => new Date(s.fecha).getHours() === h).reduce((sum, s) => sum + (s.total || 0), 0));
      label = 'Ventas por hora ($)';
    } else if (filter === 'semana') {
      const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      labels = days;
      data = days.map((_, i) => {
        const dayIndex = i === 6 ? 0 : i + 1;
        return filtered
          .filter(s => new Date(s.fecha).getDay() === dayIndex)
          .reduce((sum, s) => sum + (s.total || 0), 0);
      });
      label = 'Ventas por día ($)';
    } else if (filter === 'mes') {
      labels = ['Sem 1','Sem 2','Sem 3','Sem 4'];
      data = labels.map((_, i) => filtered.filter(s => {
        const d = new Date(s.fecha).getDate();
        const w = Math.ceil(d / 7);
        return w === i + 1;
      }).reduce((sum, s) => sum + (s.total || 0), 0));
      label = 'Ventas por semana ($)';
    } else if (filter === 'año') {
      const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      labels = months;
      data = months.map((_, i) => filtered.filter(s => new Date(s.fecha).getMonth() === i).reduce((sum, s) => sum + (s.total || 0), 0));
      label = 'Ventas por mes ($)';
    }
    this.chartHours = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: data,
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
