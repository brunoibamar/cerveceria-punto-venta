const DB_KEY = 'pos_cerveceria_data_v2';

const seedData = {
  products: [
    { id: 'p1', code: 'CAG-0001', name: 'Caguama 1 L', price: 45, costPrice: 32, stock: 80, category: 'Cerveza' },
    { id: 'p2', code: 'SIX-0002', name: 'Six Pack 350 ml', price: 108, costPrice: 78, stock: 60, category: 'Cerveza' },
    { id: 'p3', code: 'LAT-0003', name: 'Latón 1 L', price: 42, costPrice: 30, stock: 90, category: 'Cerveza' },
    { id: 'p4', code: 'BOT-0004', name: 'Botella 350 ml', price: 22, costPrice: 15, stock: 150, category: 'Cerveza' },
    { id: 'p5', code: 'CHE-0005', name: 'Chela Litro', price: 40, costPrice: 28, stock: 100, category: 'Cerveza' },
    { id: 'p6', code: 'IPA-0006', name: 'IPA 350 ml', price: 24, costPrice: 17, stock: 80, category: 'Cerveza' },
    { id: 'p7', code: 'STO-0007', name: 'Stout 350 ml', price: 26, costPrice: 19, stock: 60, category: 'Cerveza' },
    { id: 'p8', code: 'MIC-0008', name: 'Michelada', price: 32, costPrice: 20, stock: 40, category: 'Preparado' },
    { id: 'p9', code: 'SNK-0009', name: 'Botana Mix', price: 28, costPrice: 18, stock: 55, category: 'Alimentos' },
  ],
  sales: [],
  promos: [
    { id: 'promo1', name: 'Caja Tecate + Six Pack Bonificado', supplier: 'Tecate', type: 'combo', items: [{ productId: 'p4', qty: 12 }, { productId: 'p2', qty: 1 }], salePrice: 180, comboPrice: 180, cost: 120, active: true, expiresAt: '' },
    { id: 'promo2', name: 'Combo Corona Navidad', supplier: 'Corona', type: 'combo', items: [{ productId: 'p1', qty: 2 }, { productId: 'p3', qty: 2 }], salePrice: 160, comboPrice: 160, cost: 104, active: true, expiresAt: '' },
    { id: 'promo3', name: 'Heineken 2x1', supplier: 'Heineken', type: 'combo', items: [{ productId: 'p6', qty: 2 }], salePrice: 40, comboPrice: 40, cost: 34, active: false, expiresAt: '' },
  ],
  settings: {
    cajaInicial: 1300,
  },
};

function read() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
  }
  const fresh = JSON.parse(JSON.stringify(seedData));
  localStorage.setItem(DB_KEY, JSON.stringify(fresh));
  return fresh;
}

function write(data) {
  localStorage.setItem(DB_KEY, JSON.stringify(data));
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const db = {
  getProducts() {
    return read().products;
  },

  addProduct(product) {
    const data = read();
    data.products.push({ id: uid('p'), costPrice: 0, ...product });
    write(data);
  },

  updateStock(id, delta) {
    const data = read();
    const product = data.products.find((p) => p.id === id);
    if (product) {
      product.stock = Math.max(0, product.stock + delta);
      write(data);
    }
  },

  deleteProduct(id) {
    const data = read();
    data.products = data.products.filter((p) => p.id !== id);
    write(data);
  },

  updateProduct(id, updates) {
    const data = read();
    const product = data.products.find((p) => p.id === id);
    if (product) {
      Object.assign(product, updates);
      write(data);
    }
  },

  addStock(id, qty) {
    const data = read();
    const product = data.products.find((p) => p.id === id);
    if (product) {
      product.stock = Math.max(0, product.stock + Math.max(0, qty));
      write(data);
    }
  },

  getSales() {
    return read().sales;
  },

  addSale(sale) {
    const data = read();
    const record = { id: uid('s'), date: new Date().toISOString(), ...sale };
    data.sales.push(record);
    write(data);
    return record;
  },

  getPromos() {
    return read().promos;
  },

  getSettings() {
    const data = read();
    return data.settings || {};
  },

  getSetting(key, fallback) {
    const settings = read().settings;
    return settings && settings[key] !== undefined ? settings[key] : fallback;
  },

  setSetting(key, value) {
    const data = read();
    data.settings = data.settings || {};
    data.settings[key] = value;
    write(data);
  },

  getActivePromos() {
    return read().promos.filter((p) => p.active);
  },

  addPromo(promo) {
    const data = read();
    data.promos.push({ id: uid('promo'), ...promo });
    write(data);
  },

  togglePromo(id) {
    const data = read();
    const promo = data.promos.find((p) => p.id === id);
    if (promo) {
      promo.active = !promo.active;
      write(data);
    }
  },

  deletePromo(id) {
    const data = read();
    data.promos = data.promos.filter((p) => p.id !== id);
    write(data);
  },

  updatePromo(id, updates) {
    const data = read();
    const promo = data.promos.find((p) => p.id === id);
    if (promo) {
      Object.assign(promo, updates);
      write(data);
    }
  },
};