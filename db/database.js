// Base de datos local con localStorage para la Cervecería POS
// Persiste: productos, ventas, cortes de caja, promociones y configuración

const STORAGE_KEYS = {
  PRODUCTS: 'cerveceria_products',
  SALES: 'cerveceria_sales',
  CUTS: 'cerveceria_cuts',
  PROMOS: 'cerveceria_promos',
  SETTINGS: 'cerveceria_settings',
  SESSION: 'cerveceria_session'
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
  fridgeCapacity: 24
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
    return this.saveProducts(products);
  },

  updateProduct(id, updates) {
    const products = this.getProducts();
    const index = products.findIndex(p => p.id === id);
    if (index === -1) return null;
    products[index] = {
      coldStock: products[index].coldStock ?? 0,
      coldCapacity: products[index].coldCapacity ?? 24,
      ...products[index],
      ...updates
    };
    return this.saveProducts(products);
  },

  deleteProduct(id) {
    const products = this.getProducts().filter(p => p.id !== id);
    return this.saveProducts(products);
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