/* Caja central: sesiones por pestaña, confirmación remota y consulta en vivo. */
const Cloud = {
  client: null, state: null, view: 'monitor', cart: [], busy: false, channel: null,
  host: document.getElementById('cloud-main'),
  supervisor: new URLSearchParams(location.search).get('mode') === 'supervisor',
  money: value => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0) / 100),
  escape: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  notice(message = '') { document.getElementById('cloud-notice').textContent = message; },
  async init() {
    this.recovering = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery' || sessionStorage.getItem('pos-cloud-recovery') === '1';
    const callbackError = new URLSearchParams(location.hash.slice(1)).get('error_code');
    if (callbackError) {
      history.replaceState(null, '', location.pathname + location.search);
      this.notice(callbackError === 'otp_expired' ? 'El enlace de confirmación venció o ya fue utilizado. Si ya confirmaste tu cuenta, entra con tu correo y contraseña.' : 'No se pudo completar la confirmación. Intenta entrar con tu correo y contraseña.');
    }
    let slot = sessionStorage.getItem('pos-cloud-slot');
    if (!slot) { slot = crypto.randomUUID(); sessionStorage.setItem('pos-cloud-slot', slot); }
    this.client = supabase.createClient(CloudConfig.url, CloudConfig.key, {
      auth: { storage: sessionStorage, storageKey: 'pos-cloud-auth-' + slot, persistSession: true, detectSessionInUrl: true }
    });
    this.client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { this.recovering = true; sessionStorage.setItem('pos-cloud-recovery', '1'); this.renderRecovery(); }
      if (event === 'SIGNED_OUT') { this.state = null; this.cart = []; this.login(); }
    });
    window.addEventListener('online', () => this.refresh().catch(e => this.notice(e.message)));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.state) this.refresh().catch(e => this.notice(e.message)); });
    const { data, error } = await this.client.auth.getSession();
    if (error) this.notice(error.message);
    if (data?.session) await this.connect(); else this.login();
  },
  login() {
    document.getElementById('cloud-status').textContent = this.supervisor ? 'Acceso de supervisor' : 'Acceso a la caja compartida';
    this.host.innerHTML = `<section class="login"><h2>Entrar al negocio</h2><p>Este acceso conecta todos tus dispositivos. Tu cuenta debe estar autorizada por el administrador.</p><form id="cloud-login"><label>Correo<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="actions"><button>Entrar</button><button type="button" class="secondary" id="cloud-signup">Crear mi acceso</button></div><p id="auth-message" role="status"></p></form><p class="muted">La contraseña de Supabase no es tu contraseña del punto de venta. Cada persona crea su acceso aquí.</p><a href="./">Volver a la caja local</a></section>`;
    const form = document.getElementById('cloud-login');
    const signupButton = document.getElementById('cloud-signup');
    const registration = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Primera vez: crear una cuenta autorizada';
    const explanation = document.createElement('p'); explanation.textContent = 'Solo al crear la cuenta se confirma el correo. Para los siguientes accesos usa Entrar.';
    registration.append(summary, explanation, signupButton); form.append(registration);
    this.host.querySelector('h2').textContent = this.supervisor ? 'Entrar como supervisor' : 'Entrar al negocio';
    form.querySelector('button').textContent = this.supervisor ? 'Entrar a supervisión' : 'Entrar';
    const auth = async signup => {
      if (!form.reportValidity()) return;
      const buttons = form.querySelectorAll('button'); buttons.forEach(b => b.disabled = true);
      try {
        const credentials = { email: form.email.value.trim(), password: form.password.value };
        const result = signup ? await this.client.auth.signUp({ ...credentials, options: { emailRedirectTo: new URL('nube.html', location.href).href } }) : await this.client.auth.signInWithPassword(credentials);
        if (result.error) throw result.error;
        form.password.value = '';
        if (result.data.session) await this.connect();
        else document.getElementById('auth-message').textContent = 'Revisa tu correo y confirma el acceso. Después vuelve aquí para entrar con tu contraseña.';
      } catch (error) { this.notice(this.authMessage(error)); }
      finally { buttons.forEach(b => b.disabled = false); }
    };
    form.onsubmit = e => { e.preventDefault(); auth(false); };
    document.getElementById('cloud-signup').onclick = () => auth(true);
    const recovery = document.createElement('button'); recovery.type = 'button'; recovery.className = 'secondary'; recovery.textContent = 'Olvidé mi contraseña';
    form.append(recovery);
    recovery.onclick = async () => {
      if (!form.email.reportValidity()) return;
      recovery.disabled = true;
      try {
        const { error } = await this.client.auth.resetPasswordForEmail(form.email.value.trim(), { redirectTo: new URL('nube.html', location.href).href });
        if (error) throw error;
        this.notice('Si el correo tiene una cuenta registrada, recibirás un enlace para elegir una contraseña nueva. Revisa también spam.');
      } catch (error) { this.notice(this.authMessage(error)); }
      finally { recovery.disabled = false; }
    };
  },
  renderRecovery() {
    this.host.innerHTML = '<section class="login"><h2>Elegir una contraseña nueva</h2><form id="cloud-recovery"><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Repetir contraseña<input name="repeat" type="password" autocomplete="new-password" minlength="8" required></label><button>Guardar contraseña y entrar</button></form></section>';
    document.getElementById('cloud-recovery').onsubmit = event => {
      event.preventDefault();
      this.run(async () => {
        const form = event.target;
        const password = form.elements.namedItem('password').value;
        if (password !== form.elements.namedItem('repeat').value) throw new Error('Las contraseñas no coinciden.');
        const button = form.querySelector('button'); button.disabled = true;
        try {
          const { error } = await this.client.auth.updateUser({ password });
          if (error) throw error;
          form.reset(); this.recovering = false; sessionStorage.removeItem('pos-cloud-recovery');
          this.notice('Contraseña actualizada.'); await this.connect();
        } finally { button.disabled = false; }
      });
    };
  },
  authMessage(error) {
    if (error.code === 'email_not_confirmed') return 'Falta confirmar tu correo una sola vez. Después podrás entrar directamente con tu contraseña.';
    if (error.code === 'invalid_credentials') return 'Correo o contraseña incorrectos. Usa la contraseña que creaste para el punto de venta.';
    return error.message;
  },
  async connect() {
    if (this.recovering) { this.renderRecovery(); return; }
    const claim = await this.client.rpc('pos_claim_access');
    if (claim.error) { this.login(); throw claim.error; }
    await this.refresh();
    if (this.channel) await this.client.removeChannel(this.channel);
    this.channel = this.client.channel('business-' + CloudConfig.businessId);
    for (const table of ['pos_products', 'pos_shifts', 'pos_sales', 'pos_inventory_movements', 'pos_documents','pos_terminal_sales','pos_terminal_items','pos_terminal_shifts']) {
      this.channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: 'business_id=eq.' + CloudConfig.businessId }, () => {
        clearTimeout(this.refreshTimer); this.refreshTimer = setTimeout(() => this.refresh().catch(e => this.notice(e.message)), 250);
      });
    }
    this.channel.subscribe(status => {
        if (status === 'SUBSCRIBED') this.refresh().catch(e => this.notice(e.message));
        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) document.getElementById('cloud-status').textContent = 'Actualización en vivo desconectada. Intentando reconectar…';
      });
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.refresh().catch(() => {}), 15000);
  },
  async refresh() {
    if (this.loading) return;
    this.loading = true;
    try {
      const { data, error } = await this.client.rpc('pos_snapshot', { p_business: CloudConfig.businessId });
      if (error) throw error;
      if (!data?.member) throw new Error('No tienes acceso activo al negocio.');
      if (this.supervisor && data.member.role !== 'admin') throw new Error('El acceso de supervisor requiere una cuenta administradora autorizada.');
      this.state = data;
      this.updateTerminalStatus();
      document.getElementById('cloud-status').textContent = `${data.business.name} · ${data.member.display_name} · Última lectura ${new Date(data.read_at).toLocaleTimeString('es-MX')}`;
      // No reemplazar formularios ni cobros que el usuario esté editando.
      if (!this.host.querySelector('[data-cloud-shell]')) this.render();
      else if (this.view === 'monitor') this.renderView();
      else if (this.supervisor && this.view === 'products') CloudReports.inventory(document.getElementById('cloud-view'));
      else if (['reports','history'].includes(this.view)) this.run(() => CloudReports.load());
      else this.updateReadNotice();
    } catch (error) {
      document.getElementById('cloud-status').textContent = 'No se pudo actualizar. La información puede estar atrasada.';
      throw error;
    } finally { this.loading = false; }
  },
  updateReadNotice() {
    const el = document.getElementById('cloud-read-note');
    if (el) el.textContent = 'Datos actualizados. El servidor comprobará existencias y precios al confirmar.';
  },
  updateTerminalStatus() {
    const el=document.getElementById('terminal-delivery-status');if(!el)return;
    const terminal=this.state?.terminal;
    el.textContent=!terminal?'Terminal pendiente de activar en Ajustes del POS.':!terminal.active?'El envío de la terminal está desactivado.':terminal.last_sync_at?'Último envío de la terminal: '+new Date(terminal.last_sync_at).toLocaleString('es-MX'):'Terminal autorizada; esperando el primer envío.';
  },
  get admin() { return this.state?.member.role === 'admin'; },
  get shift() { return this.state?.shifts.find(s => !s.closed_at && s.user_id === this.state.member.user_id); },
  get settings() { return this.state?.documents.settings || {}; },
  get pendingKey() { return 'pos-cloud-request-' + CloudConfig.businessId + '-' + this.state.member.user_id; },
  async command(command, payload, retry = false) {
    if (this.supervisor) throw new Error('La supervisión es de consulta. Usa la caja compartida para operar.');
    if (this.busy) throw new Error('Hay una operación en curso.');
    if (!navigator.onLine) throw new Error('Necesitas internet para confirmar esta operación.');
    const key = this.pendingKey;
    const existing = sessionStorage.getItem(key);
    if (existing && !retry) throw new Error('Hay una operación pendiente de respuesta. Usa «Reintentar operación pendiente».');
    const request = retry ? JSON.parse(existing) : { id: crypto.randomUUID(), command, payload };
    if (!request) throw new Error('No hay operación pendiente.');
    sessionStorage.setItem(key, JSON.stringify(request));
    this.busy = true;
    this.host.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const { data, error } = await this.client.rpc('pos_command', { p_business: CloudConfig.businessId, p_request: request.id, p_command: request.command, p_payload: request.payload });
      if (error) {
        // Errores SQL explícitos revierten la transacción. Una respuesta de red ambigua se conserva.
        if (/^(P0001|23505|23514|23502|23503|22P02|22003|22023)$/.test(error.code || '')) sessionStorage.removeItem(key);
        throw error;
      }
      sessionStorage.removeItem(key);
      if (request.command === 'sale') this.cart = [];
      await this.refresh();
      this.notice('Operación confirmada y guardada en la nube.');
      return data;
    } finally { this.busy = false; this.render(); }
  },
  run(action) { return Promise.resolve().then(action).catch(e => { this.notice(e.message); }); },
  render() {
    if (!this.state) return;
    this.host.innerHTML = `<div data-cloud-shell><nav>${[['monitor', 'Supervisión'], ['sale', 'Ventas y turno'], ...(this.admin ? [['products', 'Inventario'], ['settings', 'Ajustes y accesos']] : [])].map(([id, label]) => `<button class="${this.view === id ? '' : 'secondary'}" data-view="${id}">${label}</button>`).join('')}<button class="secondary" id="cloud-logout">Salir de este dispositivo</button></nav><p id="cloud-read-note" class="muted"></p><div id="cloud-pending"></div><div id="cloud-view"></div></div>`;
    if (this.admin) {
      const nav = this.host.querySelector('nav');
      for (const [id,label] of [['reports','Reportes'],['history','Historial de ventas']]) {
        const button = document.createElement('button'); button.dataset.view = id; button.textContent = label;
        button.className = this.view === id ? '' : 'secondary'; nav.insertBefore(button, document.getElementById('cloud-logout'));
      }
    }
    if (this.supervisor) this.host.querySelectorAll('[data-view]').forEach(b => { if (!['monitor','products','reports','history'].includes(b.dataset.view)) b.remove(); });
    const terminalStatus=document.createElement('p');terminalStatus.id='terminal-delivery-status';terminalStatus.className='muted';
    this.host.querySelector('[data-cloud-shell]').insertBefore(terminalStatus,document.getElementById('cloud-read-note'));this.updateTerminalStatus();
    this.host.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { this.view = b.dataset.view; this.render(); });
    document.getElementById('cloud-logout').onclick = () => this.run(async () => {
      if (sessionStorage.getItem(this.pendingKey)) throw new Error('Resuelve la operación pendiente antes de salir.');
      if (this.shift && !confirm('Tu turno seguirá abierto. ¿Salir únicamente de este dispositivo?')) return;
      if (this.channel) await this.client.removeChannel(this.channel);
      clearInterval(this.pollTimer);
      const { error } = await this.client.auth.signOut({ scope: 'local' }); if (error) throw error;
    });
    if (sessionStorage.getItem(this.pendingKey)) {
      document.getElementById('cloud-pending').innerHTML = '<section class="warning"><p>Una operación quedó sin respuesta. Reintentar conserva su identificador y evita duplicados.</p><button id="cloud-retry">Reintentar operación pendiente</button></section>';
      document.getElementById('cloud-retry').onclick = () => this.run(() => this.command(null, null, true));
    }
    this.renderView();
  },
  renderView() {
    const view = document.getElementById('cloud-view'); if (!view) return;
    if (this.view === 'monitor') this.monitor(view);
    else if (this.view === 'sale') this.sales(view);
    else if (this.view === 'products' && this.admin) this.supervisor ? CloudReports.inventory(view) : this.products(view);
    else if (['reports','history'].includes(this.view) && this.admin) this.run(() => CloudReports.show(view));
    else if (this.view === 'settings' && this.admin) this.access(view);
  },
  monitor(view) {
    const today = this.state.today;
    view.innerHTML = `<h2>Supervisión en vivo</h2><p>Ventas confirmadas de hoy · horario de Ciudad de México.</p><section><p class="amount">${this.money(today.reduce((sum, row) => sum + Number(row.total_cents), 0))}</p><p>${today.reduce((sum, row) => sum + Number(row.tickets), 0)} tickets</p>${today.map(row => `<p>${this.escape(row.cashier_name)}: ${this.money(row.total_cents)} · ${row.tickets} ventas</p>`).join('')}</section><h2>Turnos abiertos</h2>${this.state.shifts.filter(s => !s.closed_at).map(s => `<section><strong>${this.escape(s.register_name)}</strong><p>${this.escape(s.cashier_name || (s.user_id === this.state.member.user_id ? this.state.member.display_name : 'Cajero: ' + String(s.user_id || '').slice(0, 8)))}</p><p>Apertura: ${new Date(s.opened_at).toLocaleString('es-MX')} · Fondo: ${this.money(s.opening_cents)}</p></section>`).join('') || '<p>No hay turnos abiertos.</p>'}<h2>Últimas ventas</h2><p class="muted">Hasta 500 tickets recientes. El resumen de hoy incluye todas las ventas del día.</p><div class="table-scroll"><table><thead><tr><th>Fecha</th><th>Atendió</th><th>Total</th></tr></thead><tbody>${this.state.sales.map(s => `<tr><td>${new Date(s.created_at).toLocaleString('es-MX')}</td><td>${this.escape(s.cashier_name)}</td><td>${this.money(s.total_cents)}</td></tr>`).join('')}</tbody></table></div><h2>Últimos cortes</h2>${this.state.shifts.filter(s => s.closed_at).slice(0, 20).map(s => `<section><p>${new Date(s.closed_at).toLocaleString('es-MX')}</p><p>Fondo: ${this.money(s.opening_cents)} · Conteo: ${this.money(s.counted_cents)}</p></section>`).join('') || '<p>No hay cortes registrados.</p>'}`;
  },
  sales(view) {
    if (!this.shift) {
      const other = this.state.shifts.find(s => !s.closed_at);
      view.innerHTML = other ? '<section><h2>La caja está operando</h2><p>Puedes supervisar las ventas mientras el cajero termina su turno. No se ha cerrado ninguna sesión.</p></section>' : '<section><h2>Abrir turno</h2><form id="open-shift"><label>Fondo inicial<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" value="0" required></label><button>Abrir caja principal</button></form></section>';
      const form = document.getElementById('open-shift'); if (form) form.onsubmit = e => { e.preventDefault(); this.run(() => this.command('open_shift', { opening_cents: CloudPricing.cents(form.amount.value) })); };
      return;
    }
    view.innerHTML = `<div class="split"><div><h2>Productos</h2><label>Buscar<input id="cloud-search" type="search" placeholder="Nombre o código de barras"></label><div id="cloud-products"></div></div><div><h2>Ticket</h2><div id="cloud-cart"></div><p class="amount" id="cloud-total"></p><form id="cloud-payment"><label>Forma de pago<select name="method"><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option></select></label><label>Efectivo recibido<input name="received" type="number" min="0" step="0.01" inputmode="decimal"></label><label>Referencia de pago electrónico<input name="reference" maxlength="120"></label><label class="check"><input name="verified" type="checkbox">Verifiqué la recepción del pago electrónico</label><button>Confirmar venta</button></form><details><summary>Cerrar mi turno</summary><form id="close-shift"><label>Efectivo contado<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" required></label><button>Confirmar corte y cerrar turno</button></form></details></div></div>`;
    const list = () => {
      const term = document.getElementById('cloud-search').value.trim().toLocaleLowerCase();
      document.getElementById('cloud-products').innerHTML = this.state.products.filter(p => p.data.activo !== false && `${p.data.nombre} ${p.data.codigoBarras || ''}`.toLocaleLowerCase().includes(term)).map(p => `<section><h3>${this.escape(p.data.nombre)}</h3><p class="amount">${this.money(CloudPricing.cents(p.data.precioVenta ?? p.data.precio))}</p><p>${p.stock} piezas · ${p.cold_stock} frías</p><button data-add="${this.escape(p.id)}">Agregar</button></section>`).join('');
      document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const product = this.state.products.find(p => p.id === b.dataset.add); this.cart.push({ product, settings: { ...this.settings }, quantity: 1, cold: false, missing: false }); this.renderCart(); });
    };
    document.getElementById('cloud-search').oninput = list; list(); this.renderCart();
    const paymentForm = document.getElementById('cloud-payment');
    const updatePaymentFields = () => {
      const method = paymentForm.elements.namedItem('method').value;
      paymentForm.reference.closest('label').hidden = method !== 'transfer';
      paymentForm.verified.closest('label').hidden = method !== 'transfer';
      paymentForm.received.closest('label').hidden = method !== 'cash';
    };
    paymentForm.elements.namedItem('method').onchange = updatePaymentFields;
    updatePaymentFields();
    document.getElementById('cloud-payment').onsubmit = e => { e.preventDefault(); this.run(async () => {
      if (!this.cart.length) throw new Error('El ticket está vacío.');
      const form = e.target, total = this.total(), method = form.elements.namedItem('method').value;
      const payment = { cash_cents: 0, card_cents: 0, transfer_cents: 0 };
      payment[method + '_cents'] = total;
      let change = 0;
      if (method === 'cash') { const received = CloudPricing.cents(form.received.value); if (received < total) throw new Error('Efectivo insuficiente.'); change = received - total; }
      else if (method === 'transfer') { if (!form.verified.checked || !form.reference.value.trim()) throw new Error('Verifica el pago electrónico e indica su referencia.'); payment.reference = form.reference.value.trim(); payment.verified = true; }
      await this.command('sale', { shift_id: this.shift.id, expected_total_cents: total, payment, items: this.cart.map(i => ({ product_id: i.product.id, revision: i.product.revision, quantity: i.quantity, cold: i.cold, missing_container: i.missing })) });
      this.notice('Venta confirmada en la nube. Cambio: ' + this.money(change));
    }); };
    document.getElementById('close-shift').onsubmit = e => { e.preventDefault(); this.run(async () => {
      if (this.cart.length) throw new Error('Termina o retira el ticket antes de cerrar el turno.');
      const result = await this.command('close_shift', { id: this.shift.id, counted_cents: CloudPricing.cents(e.target.amount.value) });
      this.notice(`Corte confirmado. Esperado: ${this.money(result.expected_cents)}. Diferencia: ${this.money(result.difference_cents)}.`);
    }); };
  },
  total() { return this.cart.reduce((sum, i) => sum + CloudPricing.quote(i.product, i.quantity, i.cold, i.missing, i.settings), 0); },
  renderCart() {
    const host = document.getElementById('cloud-cart'); if (!host) return;
    host.innerHTML = this.cart.map((i, n) => `<article class="cart-item-card ${i.cold ? 'is-cold' : ''}"><h3>${this.escape(i.product.data.nombre)}</h3><label>Cantidad<input data-qty="${n}" type="number" min="1" step="1" inputmode="numeric" value="${i.quantity}"></label><label class="check"><input data-cold="${n}" type="checkbox" ${i.cold ? 'checked' : ''}>Frío</label><label class="check"><input data-missing="${n}" type="checkbox" ${i.missing ? 'checked' : ''}>Falta envase</label><p>${this.money(CloudPricing.quote(i.product, i.quantity, i.cold, i.missing, i.settings))}</p><button class="secondary" data-remove="${n}">Quitar</button></article>`).join('') || '<p>Agrega un producto.</p>';
    host.querySelectorAll('[data-qty]').forEach(el => el.onchange = () => { const qty = Number(el.value); if (!Number.isInteger(qty) || qty < 1) { this.notice('La cantidad debe ser un número entero positivo.'); this.renderCart(); return; } this.cart[el.dataset.qty].quantity = qty; this.renderCart(); });
    for (const field of ['cold', 'missing']) host.querySelectorAll(`[data-${field}]`).forEach(el => el.onchange = () => { this.cart[el.dataset[field]][field] = el.checked; this.renderCart(); });
    host.querySelectorAll('[data-remove]').forEach(el => el.onclick = () => { this.cart.splice(Number(el.dataset.remove), 1); this.renderCart(); });
    document.getElementById('cloud-total').textContent = 'Total: ' + this.money(this.total());
  },
  products(view, editing = null) {
    const p = editing?.data || {};
    const fields = [['nombre', 'Nombre', 'text'], ['marca', 'Marca', 'text'], ['presentacion', 'Presentación', 'text'], ['codigoBarras', 'Código de barras', 'text'], ['precioVenta', 'Precio por pieza', 'number'], ['costoPieza', 'Costo por pieza', 'number'], ['unidadesPorCarton', 'Piezas por cartón', 'number'], ['precioCarton', 'Precio por cartón', 'number'], ['costoCarton', 'Costo por cartón', 'number'], ['cobroExtraEnvaseFaltantePieza', 'Envase faltante por pieza', 'number'], ['cobroExtraEnvaseFaltanteCarton', 'Envase faltante por cartón', 'number']];
    view.innerHTML = `<h2>Inventario compartido</h2><p>Las existencias se guardan en piezas totales. Las piezas frías forman parte de ese total.</p><div class="grid">${this.state.products.map(product => `<section><h3>${this.escape(product.data.nombre)}</h3><p>${product.stock} piezas · ${product.cold_stock} frías</p><button class="secondary" data-edit="${this.escape(product.id)}">Editar</button></section>`).join('')}</div><section><h2>${editing ? 'Editar producto' : 'Nuevo producto'}</h2><form id="cloud-product"><div class="grid">${fields.map(([key, label, type]) => `<label>${label}<input name="${key}" type="${type}" ${type === 'number' ? 'min="0" step="0.01" inputmode="decimal"' : 'maxlength="100"'} value="${this.escape(p[key] ?? (type === 'number' ? 0 : ''))}" ${key === 'nombre' || type === 'number' ? 'required' : ''}></label>`).join('')}<label>Stock total en piezas<input name="stock" type="number" step="1" min="0" inputmode="numeric" value="${editing?.stock || 0}" required></label><label>Piezas frías<input name="cold_stock" type="number" step="1" min="0" inputmode="numeric" value="${editing?.cold_stock || 0}" required></label></div><button>Guardar en la nube</button></form><button class="secondary" id="cloud-new">Preparar otro producto</button></section>`;
    view.querySelectorAll('[data-edit]').forEach(el => el.onclick = () => this.products(view, this.state.products.find(row => row.id === el.dataset.edit)));
    document.getElementById('cloud-new').onclick = () => this.products(view);
    document.getElementById('cloud-product').onsubmit = e => { e.preventDefault(); this.run(async () => {
      const form = e.target, data = { ...p, activo: true };
      fields.forEach(([key, , type]) => data[key] = type === 'number' ? Number(form.elements.namedItem(key).value) : form.elements.namedItem(key).value.trim());
      if (!Number.isInteger(data.unidadesPorCarton)) throw new Error('Las piezas por cartón deben ser enteras.');
      await this.command('save_product', { id: editing?.id || crypto.randomUUID(), revision: editing?.revision || null, data, stock: Number(form.stock.value), cold_stock: Number(form.cold_stock.value) });
    }); };
  },
  access(view) {
    view.innerHTML = `<section><h2>Accesos de empleados</h2><p>Autoriza el correo del empleado. Después, él crea su acceso desde esta misma página y confirma su correo. Su sesión será independiente de la tuya.</p><form id="grant-employee"><label>Nombre de empleado<input name="name" maxlength="100" required></label><label>Correo<input name="email" type="email" required></label><button>Autorizar acceso de empleado</button></form></section><section><h2>Cargo por bebida fría</h2><form id="cloud-settings"><label>Cargo por pieza<input name="coldCharge" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(this.settings.coldCharge || 0)}" required></label><button>Guardar</button></form></section><section><h2>Primera carga</h2><p>La nube empieza vacía. No copia automáticamente los datos de prueba de cada dispositivo.</p><button id="cloud-seed" ${this.state.products.length ? 'disabled' : ''}>Cargar Mega Corona para pruebas</button><p class="muted">La caja local y sus respaldos permanecen separados de esta etapa de conexión.</p></section>`;
    document.getElementById('grant-employee').onsubmit = e => { e.preventDefault(); this.run(() => this.command('grant_employee', { name: e.target.elements.namedItem('name').value.trim(), email: e.target.email.value.trim() })); };
    document.getElementById('cloud-settings').onsubmit = e => { e.preventDefault(); this.run(() => this.command('save_settings', { data: { ...this.settings, coldCharge: Number(e.target.coldCharge.value) } })); };
    document.getElementById('cloud-seed').onclick = () => this.run(() => this.command('save_product', { id: 'seed-mega-corona', revision: null, stock: 1799, cold_stock: 0, data: { nombre: 'Mega Corona', marca: 'Corona', presentacion: '1L', codigoBarras: '100211', precioVenta: 50, costoPieza: 26, cobroExtraEnvaseFaltantePieza: 10, unidadesPorCarton: 12, costoCarton: 320, precioCarton: 470, cobroExtraEnvaseFaltanteCarton: 10, stockMinimo: 5, activo: true } }));
    const devicePanel=document.createElement('section');devicePanel.innerHTML='<h2>Terminal vinculada</h2><p>Desactivar detiene nuevos envíos; conserva todas las ventas e inventario ya recibidos.</p><button class="secondary">Desactivar envío de la terminal</button>';
    devicePanel.querySelector('button').onclick=()=>this.run(async()=>{if(!confirm('¿Detener los envíos de la terminal vinculada?'))return;const {error}=await this.client.rpc('pos_terminal_link',{p_business:CloudConfig.businessId,p_revoke:true});if(error)throw error;await this.refresh();this.notice('Terminal desactivada. Los datos guardados se conservaron.');});view.append(devicePanel);
  }
};
Cloud.init().catch(error => Cloud.notice(error.message));
