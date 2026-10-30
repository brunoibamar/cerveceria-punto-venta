/* Consultas sobre todas las operaciones del período, con historial paginado. */
const CloudReports = {
  from: '', to: '', offset: 0, data: null, request: 0,
  today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); },
  inventory(view) {
    view.innerHTML = '<h2>Inventario en la nube</h2><p>Existencias generales. El refri es un indicador de llenado, sin inventario separado por producto.</p><div class="grid">' + Cloud.state.products.filter(p=>p.data.activo!==false).map(p => {
      const size = Number(p.data.unidadesPorCarton || 0);
      const packages = size > 0 ? `${Math.floor(p.stock / size)} cartones + ${p.stock % size} piezas` : `${p.stock} piezas`;
      return `<section><h3>${Cloud.escape(p.data.nombre)}</h3><p class="amount">${Cloud.escape(packages)}</p><p>Total: ${p.stock} piezas</p><p>${p.stock <= Number(p.data.stockMinimo || 0) ? 'Stock bajo' : 'Existencias disponibles'}</p></section>`;
    }).join('') + '</div>' + (Cloud.state.products.length ? '' : '<p>No hay productos guardados en la nube. Cárgalos desde Inventario en la caja compartida.</p>');
  },
  async show(view) {
    if (!this.from) this.from = this.today(); if (!this.to) this.to = this.today();
    view.innerHTML = `<h2>${Cloud.view === 'history' ? 'Historial de ventas' : 'Reportes de ventas'}</h2><p>Operaciones de la caja compartida · horario de Ciudad de México.</p><form id="cloud-report-filter"><div class="grid"><label>Desde<input name="from" type="date" value="${this.from}" required></label><label>Hasta<input name="to" type="date" value="${this.to}" required></label></div><button>Consultar período</button></form><div id="cloud-report-result" aria-live="polite">Consultando…</div>`;
    document.getElementById('cloud-report-filter').onsubmit = e => { e.preventDefault(); this.from = e.target.elements.namedItem('from').value; this.to = e.target.elements.namedItem('to').value; this.offset = 0; Cloud.run(() => this.show(view)); };
    await this.load();
  },
  async load() {
    const request = ++this.request;
    const { data, error } = await Cloud.client.rpc('pos_report', { p_business: CloudConfig.businessId, p_from: this.from, p_to: this.to, p_offset: this.offset });
    if (request !== this.request || !['history', 'reports'].includes(Cloud.view)) return;
    if (error) throw error;
    this.data = data; this.results();
  },
  table(headings, rows) {
    return `<div class="table-scroll"><table><thead><tr>${headings.map(x => `<th>${Cloud.escape(x)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => '<tr>' + row.map(x => `<td>${Cloud.escape(x)}</td>`).join('') + '</tr>').join('') : `<tr><td colspan="${headings.length}">No hay ventas en este período.</td></tr>`}</tbody></table></div>`;
  },
  results() {
    const host = document.getElementById('cloud-report-result'); if (!host) return;
    const d = this.data, money = Cloud.money, totals = d.totals, costs = d.costs;
    if (Cloud.view === 'reports') {
      host.innerHTML = `<div class="grid"><section><h3>Ventas</h3><p class="amount">${money(totals.total_cents)}</p><p>${totals.tickets} tickets · ${costs.units} piezas</p></section><section><h3>Costo de lo vendido</h3><p class="amount">${money(costs.cost_cents)}</p><p>${Number(costs.unknown_costs) ? 'Hay partidas sin costo: el resultado es parcial.' : 'Costo histórico de cada venta.'}</p></section><section><h3>Utilidad bruta estimada</h3><p class="amount">${Number(costs.unknown_costs) ? 'Sin determinar' : money(Number(totals.total_cents) - Number(costs.cost_cents) - Number(costs.container_cents))}</p><p>Excluye cargos por envase. No descuenta gastos operativos.</p></section></div><h3>Formas de pago</h3>${this.table(['Efectivo', 'Tarjeta', 'Transferencia'], [[money(totals.cash_cents), money(totals.card_cents), money(totals.transfer_cents)]])}<h3>Piezas vendidas por producto</h3><p>Cartones convertidos a piezas. Incluye productos sin ventas con cero.</p>${this.table(['Producto', 'Piezas vendidas', 'Importe'], d.products.map(p => [p.name, p.units, money(p.total_cents)]))}<h3>Ventas por empleado</h3>${this.table(['Empleado', 'Tickets', 'Piezas', 'Importe'], d.employees.map(e => [e.cashier_name, e.tickets, e.units, money(e.total_cents)]))}<h3>Productos vendidos por empleado</h3>${this.table(['Empleado', 'Producto', 'Piezas', 'Importe'], d.product_employees.map(e => [e.cashier_name, e.product_name, e.units, money(e.total_cents)]))}`;
    } else {
      host.innerHTML = `<p>${totals.tickets} tickets en el período. Página ${Math.floor(this.offset / 50) + 1}.</p>` + d.history.map(s => `<section><h3>${Cloud.escape(s.cashier_name)} · ${money(s.total_cents)}</h3><p>${Cloud.escape(new Date(s.created_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }))}</p><p>Ticket: ${Cloud.escape(s.id)}</p>${this.table(['Producto', 'Piezas', 'Temperatura', 'Importe'], (s.items || []).map(i => [i.name, i.quantity, i.cold ? 'Frío' : 'Al tiempo', money(i.total_cents)]))}<p>Efectivo: ${money(s.payment.cash_cents)} · Tarjeta: ${money(s.payment.card_cents)} · Transferencia: ${money(s.payment.transfer_cents)}</p></section>`).join('') + `<div class="actions"><button id="cloud-prev" ${this.offset === 0 ? 'disabled' : ''}>Anterior</button><button id="cloud-next" ${this.offset + 50 >= Number(totals.tickets) ? 'disabled' : ''}>Siguiente</button></div>`;
      document.getElementById('cloud-prev').onclick = () => { this.offset = Math.max(0, this.offset - 50); Cloud.run(() => this.load()); };
      document.getElementById('cloud-next').onclick = () => { this.offset += 50; Cloud.run(() => this.load()); };
    }
  }
};
