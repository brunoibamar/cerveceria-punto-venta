// Base de datos local con localStorage para la Cervecería POS
// Persiste: productos, ventas, cortes de caja, promociones y configuración

const STORAGE_KEYS = {
  PRODUCTS: 'cerveceria_products',
  SALES: 'cerveceria_sales',
  CUTS: 'cerveceria_cuts',
  PROMOS: 'cerveceria_promos',
  SETTINGS: 'cerveceria_settings',
  SESSION: 'cerveceria_session',
  INVENTORY_CYCLES: 'cerveceria_inventory_cycles'
};

// Única semilla solicitada: 149 cartones de 12 + 11 piezas = 1799 piezas.
const INITIAL_TEST_PRODUCT = Object.freeze({
  id: 'seed-mega-corona', nombre: 'Mega Corona', marca: 'Corona', presentacion: '1L',
  categoria: 'cerveza', codigoBarras: '100211', precio: 50, precioVenta: 50,
  precioCompra: 26, costoPieza: 26, cobroExtraEnvaseFaltantePieza: 10,
  unidadesPorCarton: 12, costoCarton: 320, precioCarton: 470,
  cobroExtraEnvaseFaltanteCarton: 10, stock: 1799, stockMinimo: 5,
  coldStock: 0, coldCapacity: 24, activo: true
});

const DEFAULT_SETTINGS = {
  businessName: 'Cervecería',
  ticketHeader: 'Gracias por su compra',
  ticketFooter: 'Vuelva pronto',
  currency: 'MXN',
  printerName: '',
  currencySymbol: '$',
  coldCharge: 0,
  fridgeCapacity: 24,
  // Link o plantilla del cobro con Mercado Pago (admite {amount}, {currency}, {reference} y {folio})
  mercadoPagoCobroUrl: ''
};

const Database = {
  // Primera instalación y migración conservadora. Nunca identifica datos por nombre solamente.
  init() {
    if (DataStore.getItem('cerveceria_factory_v1')) return;
    const products=this.getProducts();
    const firstInstall=DataStore.getItem(STORAGE_KEYS.PRODUCTS)===null && !this.getSales().length && !this.getCuts().length && !this.getInventoryCycles().length && !this.getPromos().length;
    const originalFingerprints=new Set(["4b3f9226","94a03461","b387a216","f53d0c9c","534f356c","9850284e","3486e3fe","8b6e94fa","1c59dcb2","18ccaffe"]);
    const fingerprint=product=>{
      const text=JSON.stringify(Object.fromEntries(Object.entries(product).sort(([a],[b])=>a.localeCompare(b))));
      let hash=2166136261;for(const char of text){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16);
    };
    const hashes=products.map(fingerprint);
    const pristine=products.length===originalFingerprints.size && new Set(hashes).size===originalFingerprints.size && hashes.every(hash=>originalFingerprints.has(hash)) && !this.getSales().length && !this.getCuts().length && !this.getInventoryCycles().length && !this.getPromos().length;
    DataStore.atomic(()=>{
      if (DataStore.getItem(STORAGE_KEYS.PRODUCTS)===null || pristine) this.saveProducts(firstInstall || pristine ? [{...INITIAL_TEST_PRODUCT}] : []);
      if(firstInstall || pristine) DataStore.setItem('cerveceria_mega_seed_v1',new Date().toISOString());
      for(const key of [STORAGE_KEYS.SALES,STORAGE_KEYS.CUTS,STORAGE_KEYS.PROMOS,STORAGE_KEYS.INVENTORY_CYCLES]) if(DataStore.getItem(key)===null) DataStore.setItem(key,'[]');
      if(DataStore.getItem(STORAGE_KEYS.SETTINGS)===null) this.saveSettings(DEFAULT_SETTINGS);
      if(DataStore.getItem('fridgeStock')===null || pristine) DataStore.setItem('fridgeStock','0');
      DataStore.setItem('cerveceria_factory_v1',JSON.stringify({completedAt:new Date().toISOString(),removedPristineExamples:pristine}));
    });
    if(pristine){AppStorage.removeItem(STORAGE_KEYS.PRODUCTS);AppStorage.setItem(DataStore.RECOVERY,AppStorage.getItem(DataStore.KEY));}
  },

  // ---------- Productos ----------
  getProducts() {
    const data = DataStore.getItem(STORAGE_KEYS.PRODUCTS);
    return data ? JSON.parse(data) : [];
  },

  saveProducts(products) {
    DataStore.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    return products;
  },

  addProduct(product) {
    Auth.requireAdmin();
    const products = this.getProducts();
    const newProduct = {
      coldStock: 0,
      coldCapacity: 24,
      stock: 0,
      activo: true,
      ...product
    };
    newProduct.id = newProduct.id || 'p' + crypto.randomUUID();
    products.push(newProduct);

    const cycles = this.getInventoryCycles();
    const openCycle = cycles.find(cycle => cycle.status === 'open');
    if (!openCycle) return this.saveProducts(products);

    const stock = Math.max(0, Number(newProduct.stock) || 0);
    openCycle.initialStock[newProduct.id] = 0;
    openCycle.products[newProduct.id] = this.getInventoryProductSnapshot(newProduct);
    if (stock > 0) {
      openCycle.entries.push({
        id: 'ie' + Date.now(),
        productId: newProduct.id,
        units: stock,
        packages: 0,
        unitsPerPackage: Number(newProduct.unidadesPorCarton) || 0,
        occurredAt: new Date().toISOString(),
        source: 'product-setup'
      });
    }
    this.saveInventoryState(products, cycles);
    return products;
  },

  updateProduct(id, updates) {
    Auth.requireAdmin();
    const products = this.getProducts();
    const index = products.findIndex(p => p.id === id);
    if (index === -1) return null;
    const previousStock = Math.max(0, Number(products[index].stock) || 0);
    products[index] = {
      coldStock: products[index].coldStock ?? 0,
      coldCapacity: products[index].coldCapacity ?? 24,
      ...products[index],
      ...updates
    };
    const nextStock = Math.max(0, Number(products[index].stock) || 0);
    if (nextStock > previousStock) {
      const cycles = this.getInventoryCycles();
      const cycle = cycles.find(item => item.status === 'open');
      if (cycle) {
        const key = String(products[index].id);
        if (cycle.initialStock[key] === undefined) {
          cycle.initialStock[key] = 0;
          cycle.products[key] = this.getInventoryProductSnapshot(products[index]);
        }
        cycle.entries.push({
          id: 'ie' + Date.now(),
          productId: key,
          units: nextStock - previousStock,
          packages: 0,
          unitsPerPackage: Number(products[index].unidadesPorCarton) || 0,
          occurredAt: new Date().toISOString(),
          source: 'stock-adjustment'
        });
        this.saveInventoryState(products, cycles);
        return products;
      }
    }
    return this.saveProducts(products);
  },

  deleteProduct(id) {
    Auth.requireAdmin();
    const products = this.getProducts().filter(p => p.id !== id);
    return this.saveProducts(products);
  },

  getInventoryCycles() {
    const data = DataStore.getItem(STORAGE_KEYS.INVENTORY_CYCLES);
    return data ? JSON.parse(data) : [];
  },

  saveInventoryCycles(cycles) {
    DataStore.setItem(STORAGE_KEYS.INVENTORY_CYCLES, JSON.stringify(cycles));
    return cycles;
  },

  getInventoryProductSnapshot(product) {
    return {
      nombre: product.nombre || 'Producto',
      presentacion: product.presentacion || '',
      unidadesPorCarton: Number(product.unidadesPorCarton) || 0
    };
  },

  saveInventoryState(products, cycles) {
    return DataStore.atomic(() => { this.saveProducts(products); this.saveInventoryCycles(cycles); });
  },

  createInventoryCycle(startDate) {
    Auth.requireAdmin();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new Error('La fecha inicial del ciclo no es válida.');
    }
    const cycles = this.getInventoryCycles();
    if (cycles.some(cycle => cycle.status === 'open')) {
      throw new Error('Ya existe un ciclo de inventario abierto.');
    }
    const start = new Date(startDate + 'T00:00:00Z');
    if (isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) {
      throw new Error('La fecha inicial del ciclo no es válida.');
    }
    start.setUTCDate(start.getUTCDate() + 7);
    const endDate = start.toISOString().slice(0, 10);
    const products = this.getProducts();
    const initialStock = {};
    const productSnapshots = {};
    products.forEach(product => {
      initialStock[String(product.id)] = Math.max(0, Number(product.stock) || 0);
      productSnapshots[String(product.id)] = this.getInventoryProductSnapshot(product);
    });

    const snapshotAt = new Date().toISOString();
    const cycle = {
      id: 'ic' + Date.now(),
      startDate: startDate,
      endDate: endDate,
      status: 'open',
      startedAt: snapshotAt,
      snapshotAt: snapshotAt,
      closedAt: null,
      initialStock: initialStock,
      products: productSnapshots,
      entries: [],
      finalStockDraft: {},
      finalStock: null,
      results: null
    };
    cycles.push(cycle);
    this.saveInventoryCycles(cycles);
    return cycle;
  },

  rebaseInventoryCycle(cycleId, startDate) {
    Auth.requireAdmin();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new Error('La fecha inicial del ciclo no es válida.');
    }
    const start = new Date(startDate + 'T00:00:00Z');
    if (isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) {
      throw new Error('La fecha inicial del ciclo no es válida.');
    }
    const cycles = this.getInventoryCycles();
    const cycle = cycles.find(item => item.id === cycleId && item.status === 'open');
    if (!cycle) throw new Error('El ciclo ya no está abierto. Actualiza el inventario.');

    const products = this.getProducts();
    const initialStock = {};
    const productSnapshots = {};
    products.forEach(product => {
      const key = String(product.id);
      initialStock[key] = Math.max(0, Number(product.stock) || 0);
      productSnapshots[key] = this.getInventoryProductSnapshot(product);
    });

    const timestamp = new Date().toISOString();
    cycle.startDate = startDate;
    start.setUTCDate(start.getUTCDate() + 7);
    cycle.endDate = start.toISOString().slice(0, 10);
    cycle.startedAt = timestamp;
    cycle.snapshotAt = timestamp;
    cycle.initialStock = initialStock;
    cycle.products = productSnapshots;
    cycle.entries = [];
    cycle.finalStockDraft = {};
    cycle.finalStock = null;
    cycle.results = null;
    this.saveInventoryCycles(cycles);
    return cycle;
  },

  reopenInventoryCycle(cycleId) {
    Auth.requireAdmin();
    const cycles = this.getInventoryCycles();
    const latestClosedCycle = cycles
      .filter(cycle => cycle.status === 'closed')
      .sort((a, b) => String(b.closedAt || b.startedAt || '').localeCompare(String(a.closedAt || a.startedAt || '')))[0];
    if (!latestClosedCycle || latestClosedCycle.id !== cycleId) {
      throw new Error('Solo se puede reabrir el último ciclo cerrado.');
    }

    if (cycles.some(c => c.status === 'open')) throw new Error('Cierra el ciclo actual antes de reabrir otro.');
    latestClosedCycle.status = 'open';
    latestClosedCycle.startedAt = new Date().toISOString();
    latestClosedCycle.closedAt = null;
    latestClosedCycle.finalStock = null;
    latestClosedCycle.finalStockDraft = {};
    latestClosedCycle.results = null;
    const endDate = new Date(latestClosedCycle.startDate + 'T00:00:00Z');
    endDate.setUTCDate(endDate.getUTCDate() + 7);
    latestClosedCycle.endDate = endDate.toISOString().slice(0, 10);
    this.saveInventoryCycles(cycles);
    return latestClosedCycle;
  },

  saveInventoryCycleFinalCount(cycleId, productId, units) {
    Auth.requireAdmin();
    const count = Number(units);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('El conteo físico debe ser un entero no negativo.');
    }
    const cycles = this.getInventoryCycles();
    const cycle = cycles.find(item => item.id === cycleId && item.status === 'open');
    if (!cycle) throw new Error('El ciclo ya no está abierto. Actualiza el inventario.');
    const key = String(productId);
    if (cycle.initialStock[key] === undefined) {
      throw new Error('El producto no pertenece a este ciclo.');
    }
    cycle.finalStockDraft = cycle.finalStockDraft || {};
    cycle.finalStockDraft[key] = count;
    this.saveInventoryCycles(cycles);
    return cycle;
  },

  recordInventoryRestock(cycleId, productId, units, packages) {
    Auth.requireAdmin();
    const amount = Number(units);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Ingresa una cantidad positiva de piezas para el surtido.');
    }
    const products = this.getProducts();
    const product = products.find(item => String(item.id) === String(productId));
    if (!product) throw new Error('El producto seleccionado ya no existe.');
    const cycles = this.getInventoryCycles();
    const cycle = cycles.find(item => item.id === cycleId && item.status === 'open');
    if (!cycle) throw new Error('El ciclo ya no está abierto. Actualiza el inventario.');

    const key = String(product.id);
    if (cycle.initialStock[key] === undefined) {
      cycle.initialStock[key] = 0;
      cycle.products[key] = this.getInventoryProductSnapshot(product);
    }
    cycle.entries.push({
      id: 'ie' + Date.now(),
      productId: key,
      units: amount,
      packages: Math.max(0, Number(packages) || 0),
      unitsPerPackage: Number(product.unidadesPorCarton) || 0,
      occurredAt: new Date().toISOString(),
      source: 'restock'
    });
    cycle.finalStockDraft = cycle.finalStockDraft || {};
    delete cycle.finalStockDraft[key];
    product.stock = Math.max(0, Number(product.stock) || 0) + amount;
    this.saveInventoryState(products, cycles);
    return cycle;
  },

  closeInventoryCycle(cycleId, finalStock) {
    Auth.requireAdmin();
    if (!finalStock || typeof finalStock !== 'object') {
      throw new Error('Se requiere el conteo físico final de inventario.');
    }
    const cycles = this.getInventoryCycles();
    const cycleIndex = cycles.findIndex(item => item.id === cycleId && item.status === 'open');
    if (cycleIndex < 0) throw new Error('El ciclo ya no está abierto. Actualiza el inventario.');
    const cycle = cycles[cycleIndex];
    const closedAt = new Date();
    const closeDate = [
      closedAt.getFullYear(),
      String(closedAt.getMonth() + 1).padStart(2, '0'),
      String(closedAt.getDate()).padStart(2, '0')
    ].join('-');
    const products = this.getProducts();
    const counts = {};
    const results = {};

    Object.keys(cycle.initialStock).forEach(productId => {
      const count = Number(finalStock[productId]);
      if (!Number.isInteger(count) || count < 0) {
        throw new Error('Captura el conteo físico final de todos los productos.');
      }
      counts[productId] = count;
      const entries = cycle.entries
        .filter(entry => String(entry.productId) === productId)
        .reduce((sum, entry) => sum + (Number(entry.units) || 0), 0);
      results[productId] = {
        inicial: Number(cycle.initialStock[productId]) || 0,
        entradas: entries,
        final: count,
        ventas: (Number(cycle.initialStock[productId]) || 0) + entries - count
      };
    });

    cycle.status = 'closed';
    cycle.closedAt = closedAt.toISOString();
    cycle.endDate = closeDate;
    cycle.finalStock = counts;
    cycle.finalStockDraft = counts;
    cycle.results = results;
    products.forEach(product => {
      const key = String(product.id);
      if (counts[key] !== undefined) { product.stock = counts[key]; product.coldStock = Math.min(Number(product.coldStock) || 0, product.stock); }
    });
    this.saveInventoryState(products, cycles);
    return cycle;
  },

  openRegister(user, amount) {
    if (!Auth.validSession(user)) throw new Error('Vuelve a iniciar sesión.');
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Monto de apertura inválido.');
    if (CashSession.getActiveSession()) throw new Error('Ya hay una caja abierta.');
    return DataStore.atomic(() => {
      const openedAt=new Date().toISOString();
      const turnoNumero=this.getCuts().filter(c=>c.tipo==='apertura').length+1;
      const turno='T-'+String(turnoNumero).padStart(3,'0');
      const rounded=Math.round(amount*100)/100;
      const opening=this.recordCut({tipo:'apertura',corteNumero:turnoNumero,turno,montoApertura:rounded,montoInicial:rounded,usuario:user.name,fechaApertura:openedAt}).at(-1);
      const session={...user,usuario:user.name,cashOpening:rounded,cashInitial:rounded,montoApertura:rounded,openedAt,timestamp:Date.now(),turnoNumero,turno,turnoId:opening.id,aperturaId:opening.id};
      if (!CashSession.save(session)) throw new Error('No se pudo guardar la apertura.');
      return session;
    });
  },

  // ---------- Ventas ----------
  getSales() {
    const data = DataStore.getItem(STORAGE_KEYS.SALES);
    return data ? JSON.parse(data) : [];
  },

  saveSales(sales) {
    DataStore.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales));
    return sales;
  },

  registerSale(sale) {
    const session=CashSession.getActiveSession();
    if (!session) throw new Error('Abre caja antes de vender.');
    if (ShiftGuard.overdue()) throw new Error('Cierra el turno pendiente antes de vender.');
    if (!sale || !Array.isArray(sale.items) || !sale.items.length) throw new Error('El ticket está vacío.');
    if (!Number.isFinite(sale.total) || sale.total < 0) throw new Error('Total inválido.');
    return DataStore.atomic(() => {
      const products = this.getProducts();
      const demand = new Map();
      sale.items.forEach(item => {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('Cantidad inválida.');
        demand.set(item.productId, (demand.get(item.productId) || 0) + item.quantity);
      });
      demand.forEach((qty,id) => {
        const product = products.find(p => p.id === id);
        if (!product || product.activo === false || qty > Number(product.stock)) throw new Error('Existencias insuficientes. Actualiza el ticket.');
      });
      const amount = ['efectivo','tarjeta','transferencia'].reduce((sum,key) => sum + Number((sale.paymentBreakdown || {})[key] || 0),0);
      if (!Number.isFinite(amount) || Math.abs(amount - sale.total) > 0.011 || Object.values(sale.paymentBreakdown || {}).some(value => !Number.isFinite(value) || value < 0)) throw new Error('El desglose del pago no coincide con el total.');
      const electronic = Number(sale.paymentBreakdown.tarjeta || 0) + Number(sale.paymentBreakdown.transferencia || 0);
      const cardDeclaration = sale.paymentVerification?.method === 'cashier-declared' && Number(sale.paymentBreakdown.transferencia || 0) === 0;
      if (electronic > 0 && (!sale.paymentVerification || sale.paymentVerification.status !== 'confirmed' || (!cardDeclaration && !sale.paymentVerification.reference))) throw new Error('Confirma el cobro electrónico y su referencia.');
      if (electronic > 0) {
        const attempt=PaymentVerification.getAll().find(p=>p.id===sale.paymentVerification.id);
        if (!attempt || attempt.status !== 'pending' || (attempt.amount !== undefined && Math.abs(attempt.amount-electronic)>0.011)) throw new Error('El intento de pago ya fue usado, cancelado o tiene otro importe.');
      }
      const newSale = { ...sale, turnoId: session.turnoId, turnoNumero: session.turnoNumero, cajero: session.name, cajeroId: session.userId, cajeroRol: session.role, status: 'completada', id: 's' + crypto.randomUUID(), fecha: new Date().toISOString() };
      newSale.items = sale.items.map(item => {
        const product = products.find(p => p.id === item.productId);
        const unitCost = Number(product.costoPieza ?? product.precioCompra);
        const cartonCost = Number(product.costoCarton);
        const packageSize = Number(product.unidadesPorCarton);
        const full = cartonCost > 0 && packageSize > 0 ? Math.floor(item.quantity / packageSize) : 0;
        const loose = item.quantity - full * (packageSize || 0);
        const known = full > 0 && loose === 0 || Number.isFinite(unitCost) && unitCost >= 0;
        return { ...item, costoTotal: known ? Math.round((full * (cartonCost || 0) + loose * (unitCost || 0)) * 100) / 100 : null };
      });
      const sales = this.getSales(); sales.push(newSale); this.saveSales(sales);
      this.discountInventory(newSale.items);
      if(typeof TerminalEvents!=='undefined')TerminalEvents.enqueue(newSale);
      DataStore.removeItem('cerveceria_cart');
      if (electronic > 0) PaymentVerification.finish(newSale.paymentVerification.id, 'confirmed', newSale.id);
      return newSale;
    });
  },

  discountInventory(items) {
    const products = this.getProducts();
    items.forEach(item => {
      const product = products.find(p => p.id === item.productId);
      if (!product) return;

      const qty = item.quantity || 0;
      product.stock = Math.max(0, (product.stock || 0) - qty);

      const isCold = item.piezaFria === true || item.cold === true || item.temp === 'frio';
      if (isCold) {
        const currentCold = product.coldStock ?? 0;
        product.coldStock = Math.max(0, currentCold - qty);
      }
    });
    this.saveProducts(products);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inventory:updated'));
    }
  },

  // ---------- Cortes de caja ----------
  getCuts() {
    const data = DataStore.getItem(STORAGE_KEYS.CUTS);
    return data ? JSON.parse(data) : [];
  },

  saveCuts(cuts) {
    DataStore.setItem(STORAGE_KEYS.CUTS, JSON.stringify(cuts));
    return cuts;
  },

  recordCut(cut) {
    const cuts = this.getCuts();
    const newCut = { ...cut };
    newCut.id = 'c' + crypto.randomUUID();
    newCut.fecha = new Date().toISOString();
    cuts.push(newCut);
    return this.saveCuts(cuts);
  },

  // ---------- Promociones ----------
  getPromos() {
    const data = DataStore.getItem(STORAGE_KEYS.PROMOS);
    return data ? JSON.parse(data) : [];
  },

  savePromos(promos) {
    DataStore.setItem(STORAGE_KEYS.PROMOS, JSON.stringify(promos));
    return promos;
  },

  addPromo(promo) {
    Auth.requireAdmin();
    const promos = this.getPromos();
    const newPromo = { ...promo };
    newPromo.id = 'promo' + Date.now();
    promos.push(newPromo);
    return this.savePromos(promos);
  },

  // ---------- Configuración ----------
  getSettings() {
    const data = DataStore.getItem(STORAGE_KEYS.SETTINGS);
    const settings = data ? JSON.parse(data) : { ...DEFAULT_SETTINGS };
    // El sistema no maneja impuestos: se descarta cualquier tasa guardada en instalaciones anteriores.
    delete settings.taxRate;
    return settings;
  },

  saveSettings(settings) {
    DataStore.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    return settings;
  },

  // ---------- Sesión ----------
  getSession() {
    const data = DataStore.getItem(STORAGE_KEYS.SESSION);
    return data ? JSON.parse(data) : null;
  },

  setSession(session) {
    DataStore.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
    return session;
  },

  clearSession() {
    DataStore.removeItem(STORAGE_KEYS.SESSION);
  },

  // ---------- Respaldo y Restauración ----------
  exportBackup() {
    return { version: 2, fechaExportacion: new Date().toISOString(), products: this.getProducts(), sales: this.getSales(), cuts: this.getCuts(), promos: this.getPromos(), settings: this.getSettings(), inventoryCycles: this.getInventoryCycles(), mpLink: DataStore.getItem('mp_link') || '', fridgeStock: Number(DataStore.getItem('fridgeStock') ?? 24), paymentAttempts: PaymentVerification.getAll(), users: Auth.users(), pinVaultKey: DataStore.getItem(Auth.VAULT) };
  },

  validateBackup(data) {
    if (!data || typeof data !== 'object' || ![1,2].includes(data.version)) throw new Error('Versión de respaldo inválida.');
    for (const key of ['products','sales','cuts','promos']) if (!Array.isArray(data[key])) throw new Error('El respaldo está incompleto: ' + key);
    if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new Error('Ajustes inválidos.');
    const ids = new Set();
    data.products.forEach(p => {
      if (!p || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(p.id) || ids.has(p.id) || typeof p.nombre !== 'string' || !Number.isInteger(p.stock) || p.stock < 0 || !Number.isFinite(Number(p.precio)) || Number(p.precio) < 0) throw new Error('Producto inválido o duplicado en el respaldo.');
      ids.add(p.id);
    });
    data.sales.forEach(s => {
      if (!s || !s.id || !Number.isFinite(s.total) || s.total < 0 || !Number.isFinite(Date.parse(s.fecha)) || !Array.isArray(s.items) || s.items.some(i => !i || !i.productId || !Number.isInteger(i.quantity) || i.quantity <= 0)) throw new Error('Venta inválida en el respaldo.');
    });
    data.promos.forEach(p => { if (!p || typeof p !== 'object' || !p.id || typeof p.nombre !== 'string') throw new Error('Promoción inválida.'); });
    data.cuts.forEach(c => { if (!c || typeof c !== 'object' || !c.id) throw new Error('Corte inválido.'); });
    if (data.version === 2) {
      if (!Array.isArray(data.inventoryCycles) || !Array.isArray(data.paymentAttempts) || typeof data.mpLink !== 'string') throw new Error('Respaldo v2 incompleto.');
      if (data.mpLink && !/^https:\/\//i.test(data.mpLink)) throw new Error('Link de cobro inválido.');
      if (data.users !== undefined && (!Array.isArray(data.users) || !data.users.some(u=>u.active && u.role === 'admin') || data.users.some(u=>!u || typeof u.name !== 'string' || !u.id || !['admin','employee'].includes(u.role) || !/^[a-f0-9]{32}$/.test(u.salt) || !/^[a-f0-9]{64}$/.test(u.hash)))) throw new Error('Usuarios inválidos en el respaldo.');
      if (data.fridgeStock !== undefined && (!Number.isInteger(data.fridgeStock) || data.fridgeStock < 0)) throw new Error('Conteo de nevera inválido.');
      if(data.users && data.users.some(u=>u.pinCipher) && (typeof data.pinVaultKey!=='string' || !/^[a-f0-9]{64}$/.test(data.pinVaultKey))) throw new Error('Falta la clave de recuperación de los NIP.');
      if(data.users && data.users.some(u=>u.pinCipher && (!/^[a-f0-9]{24}$/.test(u.pinCipher.iv) || !/^[a-f0-9]{40,48}$/.test(u.pinCipher.data)))) throw new Error('Copia de NIP inválida.');
      let open = 0;
      data.inventoryCycles.forEach(c => {
        if (!c || !c.id || !['open','closed'].includes(c.status) || !c.initialStock || !c.products || !Array.isArray(c.entries) || !/^\d{4}-\d{2}-\d{2}$/.test(c.startDate)) throw new Error('Ciclo inválido.');
        if (c.status === 'open') open++;
        if (Object.values(c.initialStock).some(n => !Number.isInteger(n) || n < 0) || c.entries.some(e => !e || !Number.isInteger(e.units) || e.units <= 0)) throw new Error('Cantidades inválidas en el ciclo.');
      });
      if (open > 1) throw new Error('El respaldo contiene más de un ciclo abierto.');
    }
    return data;
  },

  importBackup(backupData) {
    Auth.requireAdmin();
    const data = this.validateBackup(backupData);
    const before = JSON.stringify(this.exportBackup());
    // Una copia previa descargable se conserva antes de reemplazar los datos.
    AppStorage.setItem('cerveceria_before_restore', before);
    DataStore.atomic(() => {
      this.saveProducts(data.products); this.saveSales(data.sales); this.saveCuts(data.cuts); this.savePromos(data.promos); this.saveSettings(data.settings);
      this.saveInventoryCycles(data.inventoryCycles || []);
      if (data.users) { DataStore.setItem(Auth.KEY,JSON.stringify(data.users)); if(data.pinVaultKey) DataStore.setItem(Auth.VAULT,data.pinVaultKey); }
      DataStore.setItem('cerveceria_factory_v1',JSON.stringify({completedAt:new Date().toISOString(),restored:true}));
      DataStore.setItem('mp_link',data.mpLink || '');
      DataStore.setItem('fridgeStock',String(data.fridgeStock ?? 24));
      DataStore.setItem('cerveceria_payment_attempts',JSON.stringify(data.paymentAttempts || []));
      ['pos_session','cerveceria_session','cerveceria_caja','cerveceria_auth','cerveceria_cart'].forEach(key=>DataStore.removeItem(key));
    });
    return true;
  }

};

if (typeof window !== 'undefined') {
  window.Database = Database;
}
