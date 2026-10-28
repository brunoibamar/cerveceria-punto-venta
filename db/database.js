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

const DEFAULT_PRODUCTS = [
  {
    id: 'p1',
    nombre: 'Cerveza Lager',
    marca: 'Cerveza Local',
    presentacion: 'Lata 330ml',
    categoria: 'cerveza',
    precio: 35,
    precioCompra: 20,
    stock: 100,
    coldStock: 24,
    coldCapacity: 24,
    activo: true
  },
  {
    id: 'p2',
    nombre: 'Cerveza IPA',
    marca: 'Cerveza Artesanal',
    presentacion: 'Botella 330ml',
    categoria: 'cerveza',
    precio: 45,
    precioCompra: 28,
    stock: 80,
    coldStock: 24,
    coldCapacity: 24,
    activo: true
  },
  {
    id: 'p3',
    nombre: 'Cerveza Stout',
    marca: 'Cerveza Oscura',
    presentacion: 'Botella 330ml',
    categoria: 'cerveza',
    precio: 50,
    precioCompra: 32,
    stock: 60,
    coldStock: 24,
    coldCapacity: 24,
    activo: true
  },
  {
    id: 'p4',
    nombre: 'Cerveza Trigo',
    marca: 'Wheat Beer',
    presentacion: 'Botella 330ml',
    categoria: 'cerveza',
    precio: 40,
    precioCompra: 24,
    stock: 90,
    coldStock: 24,
    coldCapacity: 24,
    activo: true
  },
  {
    id: 'p5',
    nombre: 'Cerveza Negra',
    marca: 'Cerveza Oscura',
    presentacion: 'Botella 330ml',
    categoria: 'cerveza',
    precio: 48,
    precioCompra: 30,
    stock: 70,
    coldStock: 24,
    coldCapacity: 24,
    activo: true
  },
  {
    id: 'p6',
    nombre: 'Papas a la francesa',
    marca: 'Snacks',
    presentacion: 'Bolsa 150g',
    categoria: 'snack',
    precio: 30,
    precioCompra: 15,
    stock: 50,
    coldStock: 0,
    coldCapacity: 24,
    activo: true
  },
  {
    id: 'p7',
    nombre: 'Cacahuates japoneses',
    marca: 'Snacks',
    presentacion: 'Bolsa 100g',
    categoria: 'snack',
    precio: 25,
    precioCompra: 12,
    stock: 60,
    coldStock: 0,
    coldCapacity: 24,
    activo: true
  },
  {
    id: 'p8',
    nombre: 'Alitas de pollo',
    marca: 'Botanas Calientes',
    presentacion: 'Orden 250g',
    categoria: 'snack',
    precio: 60,
    precioCompra: 35,
    stock: 40,
    coldStock: 0,
    coldCapacity: 24,
    activo: true
  },
  {
    id: 'p9',
    nombre: 'Nachos con queso',
    marca: 'Snacks',
    presentacion: 'Orden 200g',
    categoria: 'snack',
    precio: 45,
    precioCompra: 25,
    stock: 45,
    coldStock: 0,
    coldCapacity: 24,
    activo: true
  },
  {
    id: 'p10',
    nombre: 'Botana mixta',
    marca: 'Snacks',
    presentacion: 'Bolsa 200g',
    categoria: 'snack',
    precio: 55,
    precioCompra: 30,
    stock: 35,
    coldStock: 0,
    coldCapacity: 24,
    activo: true
  }
];

const DEFAULT_SETTINGS = {
  businessName: 'Cervecería',
  ticketHeader: 'Gracias por su compra',
  ticketFooter: 'Vuelva pronto',
  currency: 'MXN',
  printerName: '',
  backupEmail: '',
  currencySymbol: '$',
  coldCharge: 0,
  fridgeCapacity: 24,
  // Link o plantilla del cobro con Mercado Pago (admite {amount}, {currency}, {reference} y {folio})
  mercadoPagoCobroUrl: ''
};

const Database = {
  // Inicializa la base de datos con productos por defecto si no existen
  init() {
    if (!this.getProducts()) {
      this.saveProducts(DEFAULT_PRODUCTS);
    }
    if (!this.getSettings()) {
      this.saveSettings(DEFAULT_SETTINGS);
    }
    if (!this.getPromos()) {
      this.savePromos([]);
    }
    if (!this.getSales()) {
      this.saveSales([]);
    }
    if (!this.getCuts()) {
      this.saveCuts([]);
    }
  },

  // ---------- Productos ----------
  getProducts() {
    const data = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    return data ? JSON.parse(data) : [];
  },

  saveProducts(products) {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    return products;
  },

  addProduct(product) {
    const products = this.getProducts();
    const newProduct = {
      coldStock: 0,
      coldCapacity: 24,
      stock: 0,
      activo: true,
      ...product
    };
    newProduct.id = newProduct.id || 'p' + Date.now();
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
    const products = this.getProducts().filter(p => p.id !== id);
    return this.saveProducts(products);
  },

  getInventoryCycles() {
    const data = localStorage.getItem(STORAGE_KEYS.INVENTORY_CYCLES);
    return data ? JSON.parse(data) : [];
  },

  saveInventoryCycles(cycles) {
    localStorage.setItem(STORAGE_KEYS.INVENTORY_CYCLES, JSON.stringify(cycles));
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
    const oldProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    const oldCycles = localStorage.getItem(STORAGE_KEYS.INVENTORY_CYCLES);
    try {
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
      localStorage.setItem(STORAGE_KEYS.INVENTORY_CYCLES, JSON.stringify(cycles));
    } catch (error) {
      try {
        if (oldProducts === null) localStorage.removeItem(STORAGE_KEYS.PRODUCTS);
        else localStorage.setItem(STORAGE_KEYS.PRODUCTS, oldProducts);
        if (oldCycles === null) localStorage.removeItem(STORAGE_KEYS.INVENTORY_CYCLES);
        else localStorage.setItem(STORAGE_KEYS.INVENTORY_CYCLES, oldCycles);
      } catch (rollbackError) {
        console.error('[Database] No se pudo revertir la actualización del inventario:', rollbackError);
      }
      throw error;
    }
  },

  createInventoryCycle(startDate) {
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
    const cycles = this.getInventoryCycles();
    const latestClosedCycle = cycles
      .filter(cycle => cycle.status === 'closed')
      .sort((a, b) => String(b.closedAt || b.startedAt || '').localeCompare(String(a.closedAt || a.startedAt || '')))[0];
    if (!latestClosedCycle || latestClosedCycle.id !== cycleId) {
      throw new Error('Solo se puede reabrir el último ciclo cerrado.');
    }

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
      if (counts[key] !== undefined) product.stock = counts[key];
    });
    this.saveInventoryState(products, cycles);
    return cycle;
  },

  // ---------- Ventas ----------
  getSales() {
    const data = localStorage.getItem(STORAGE_KEYS.SALES);
    return data ? JSON.parse(data) : [];
  },

  saveSales(sales) {
    localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales));
    return sales;
  },

  registerSale(sale) {
    const sales = this.getSales();
    const newSale = { ...sale };
    newSale.id = 's' + Date.now();
    newSale.fecha = new Date().toISOString();
    sales.push(newSale);
    this.saveSales(sales);
    this.discountInventory(newSale.items);
    return newSale;
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
    const data = localStorage.getItem(STORAGE_KEYS.CUTS);
    return data ? JSON.parse(data) : [];
  },

  saveCuts(cuts) {
    localStorage.setItem(STORAGE_KEYS.CUTS, JSON.stringify(cuts));
    return cuts;
  },

  recordCut(cut) {
    const cuts = this.getCuts();
    const newCut = { ...cut };
    newCut.id = 'c' + Date.now();
    newCut.fecha = new Date().toISOString();
    cuts.push(newCut);
    return this.saveCuts(cuts);
  },

  // ---------- Promociones ----------
  getPromos() {
    const data = localStorage.getItem(STORAGE_KEYS.PROMOS);
    return data ? JSON.parse(data) : [];
  },

  savePromos(promos) {
    localStorage.setItem(STORAGE_KEYS.PROMOS, JSON.stringify(promos));
    return promos;
  },

  addPromo(promo) {
    const promos = this.getPromos();
    const newPromo = { ...promo };
    newPromo.id = 'promo' + Date.now();
    promos.push(newPromo);
    return this.savePromos(promos);
  },

  // ---------- Configuración ----------
  getSettings() {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const settings = data ? JSON.parse(data) : { ...DEFAULT_SETTINGS };
    // El sistema no maneja impuestos: se descarta cualquier tasa guardada en instalaciones anteriores.
    delete settings.taxRate;
    return settings;
  },

  saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    return settings;
  },

  // ---------- Sesión ----------
  getSession() {
    const data = localStorage.getItem(STORAGE_KEYS.SESSION);
    return data ? JSON.parse(data) : null;
  },

  setSession(session) {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
    return session;
  },

  clearSession() {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
  },

  // ---------- Respaldo y Restauración ----------
  exportBackup() {
    const backup = {
      version: 1,
      fechaExportacion: new Date().toISOString(),
      products: this.getProducts(),
      sales: this.getSales(),
      cuts: this.getCuts(),
      promos: this.getPromos(),
      settings: this.getSettings()
    };
    return backup;
  },

  importBackup(backupData) {
    if (!backupData || typeof backupData !== 'object') {
      throw new Error('Archivo de respaldo inválido');
    }

    // Validar estructura mínima
    if (!Array.isArray(backupData.products) && !backupData.products) {
      // permitir respaldo parcial, pero al menos validar estructura
    }

    try {
      if (Array.isArray(backupData.products)) {
        this.saveProducts(backupData.products);
      }
      if (Array.isArray(backupData.sales)) {
        this.saveSales(backupData.sales);
      }
      if (Array.isArray(backupData.cuts)) {
        this.saveCuts(backupData.cuts);
      }
      if (Array.isArray(backupData.promos)) {
        this.savePromos(backupData.promos);
      }
      if (backupData.settings && typeof backupData.settings === 'object') {
        this.saveSettings(backupData.settings);
      }
      return true;
    } catch (error) {
      throw new Error('Error al restaurar el respaldo: ' + error.message);
    }
  }
};

if (typeof window !== 'undefined') {
  window.Database = Database;
}