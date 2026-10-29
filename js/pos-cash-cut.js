// Resumen, impresión y cierre del turno.
Object.assign(POS, {
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
        const raw = AppStorage.getItem('pos_session');
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
      const raw = DataStore.getItem('cerveceria_caja');
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
    const promocionesResumen = SalesBreakdown.getVolumePromotionsSummary(ventas);
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
              <button type="button" class="btn secondary" id="pos-cut-email">📧 Enviar a Correo</button>
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

    const resumenFrio = SalesBreakdown.getColdItemsSummary(summary.ventas);

    const promocionesResumen = SalesBreakdown.getVolumePromotionsSummary(summary.ventas);
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
    const resumenFrio = SalesBreakdown.getColdItemsSummary(tickets);
    const promocionesResumen = SalesBreakdown.getVolumePromotionsSummary(tickets);

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
      DataStore.atomic(() => {
        const existing = Database.getCuts().find(c => c.tipo === 'cierre' && c.turnoId && c.turnoId === cut.turnoId);
        if (existing) throw new Error('Este turno ya fue cerrado.');
        const cuts = Database.recordCut(cut);
        recorded = cuts[cuts.length - 1];
        this.archiveTurnSales(recorded);
        CashSession.clear();
      });
    } catch (error) {
      console.error('[POS] Error al registrar el corte de caja:', error);
      alert('No se pudo registrar el corte de caja. Intenta de nuevo.');
      return null;
    }

    const saved = recorded || cut;
    try {
      AppStorage.setItem(this.CUT_LAST_KEY, JSON.stringify(saved));
    } catch (e) {
      console.error('[POS] No se pudo guardar el último corte:', e);
    }
    return saved;
  },

  // Ejecuta una acción de salida del corte (JSON / ticket / correo).
  async runCutAction(action) {
    if (this.cut.busy) return;

    const saved = this.buildCutData();
    if (!saved) return;

    this.setCutBusy(true);
    let ok = true;
    try {
      if (action === 'json') {
        ok = this.downloadCutJson(saved);
      } else if (action === 'print') {
        ok = this.printCutTicket(saved);
      } else if (action === 'email') {
        const result = await EmailService.sendCorteRespaldo(saved);
        ok = result.success;
        if (ok) {
          alert('Correo de respaldo enviado exitosamente');
        } else {
          alert(result.error || 'No se pudo enviar el correo de respaldo.');
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

    // Las acciones de exportación e impresión no cierran el turno.
    // El cierre de sesión es exclusivo del botón oficial de "Cerrar Turno / Corte de Caja".
    // El turno permanece activo e intacto para seguir operando.
  },

  // Bloquea el modal mientras se ejecuta una acción de cierre
  setCutBusy(busy) {
    this.cut.busy = !!busy;

    if (busy) {
      ['pos-cut-save-json', 'pos-cut-print', 'pos-cut-email', 'pos-cut-confirm', 'pos-cut-cash'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.disabled = true;
      });

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
      throw error;
    }
  },

  // Cierra por completo la sesión del turno: borra el estado de caja abierta
  closeCashSession() {
    try {
      if (typeof CashSession !== 'undefined' && CashSession.clear) {
        if (CashSession.readRaw()) CashSession.clear();
      } else {
        if (typeof Database !== 'undefined' && Database.clearSession) {
          Database.clearSession();
        }
        ['cerveceria_caja', 'pos_session', 'cerveceria_session'].forEach(key => {
          try {
            AppStorage.removeItem(key);
          } catch (e) {}
        });
      }
    } catch (error) {
      console.error('[POS] Error al limpiar la sesión:', error);
    }

    document.getElementById('shift-warning')?.remove();
    this.cart = [];
    this.clearSavedCart();
    this.turnTickets = [];
    this.payment.lastSale = null;
    this.cut.counted = 0;
    this.cut.isAdmin = false;
    this.cut.busy = false;
    this.cut.recorded = null;
  },


});
