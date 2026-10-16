const DB_KEY = 'pos_cerveceria_data_v2';

const seedData = {
  products: [
    { id: 'p1', code: 'CAG-0001', name: 'Caguama 1 L', brand: 'Corona', packaging: 'Caguama 1L (Pieza)', price: 45, costPrice: 32, stock: 80, category: 'Cerveza', isCold: true, maxFridgeCapacity: 24, fridgeStock: 0 },
    { id: 'p2', code: 'SIX-0002', name: 'Six Pack 350 ml', brand: 'Tecate', packaging: 'Six-pack', price: 108, costPrice: 78, stock: 60, category: 'Cerveza', isCold: true, maxFridgeCapacity: 12, fridgeStock: 0 },
    { id: 'p3', code: 'LAT-0003', name: 'Latón 1 L', brand: 'Modelo', packaging: 'Lata (Pieza)', price: 42, costPrice: 30, stock: 90, category: 'Cerveza', isCold: true, maxFridgeCapacity: 24, fridgeStock: 0 },
    { id: 'p4', code: 'BOT-0004', name: 'Botella 350 ml', brand: 'Corona', packaging: 'Botella (Pieza)', price: 22, costPrice: 15, stock: 150, category: 'Cerveza', isCold: false, maxFridgeCapacity: 0, fridgeStock: 0 },
    { id: 'p5', code: 'CHE-0005', name: 'Chela Litro', brand: 'Indio', packaging: 'Caguama 1L (Pieza)', price: 40, costPrice: 28, stock: 100, category: 'Cerveza', isCold: true, maxFridgeCapacity: 24, fridgeStock: 0 },
    { id: 'p6', code: 'IPA-0006', name: 'IPA 350 ml', brand: 'Minerva', packaging: 'Botella (Pieza)', price: 24, costPrice: 17, stock: 80, category: 'Cerveza', isCold: true, maxFridgeCapacity: 12, fridgeStock: 0 },
    { id: 'p7', code: 'STO-0007', name: 'Stout 350 ml', brand: 'Calavera', packaging: 'Botella (Pieza)', price: 26, costPrice: 19, stock: 60, category: 'Cerveza', isCold: true, maxFridgeCapacity: 12, fridgeStock: 0 },
    { id: 'p8', code: 'MIC-0008', name: 'Michelada', brand: 'Casa', packaging: 'Vaso 500ml', price: 32, costPrice: 20, stock: 40, category: 'Preparado', isCold: true, maxFridgeCapacity: 20, fridgeStock: 0 },
    { id: 'p9', code: 'SNK-0009', name: 'Botana Mix', brand: 'Sabritas', packaging: 'Bolsa Grande', price: 28, costPrice: 18, stock: 55, category: 'Alimentos', isCold: false, maxFridgeCapacity: 0, fridgeStock: 0 },
  ],
  sales: [],
  promos: [
    { id: 'promo1', name: '2x1 Viernes', type: 'discount', discount: 50, active: true },
    { id: 'promo2', name: '1 Caguama + 1 Six Pack = $140', type: 'combo', items: [{ productId: 'p1', qty: 1 }, { productId: 'p2', qty: 1 }], comboPrice: 140, active: true },
    { id: 'promo3', name: 'Promoción Tecate', type: 'combo', items: [{ productId: 'p4', qty: 12 }], comboPrice: 180, active: true },
  ],
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

  fillFridge(id) {
    const data = read();
    const product = data.products.find((p) => p.id === id);
    if (product && product.isCold) {
      const missing = Math.max(0, (product.maxFridgeCapacity || 0) - (product.fridgeStock || 0));
      const availableFromWarehouse = Math.min(missing, product.stock);
      product.fridgeStock = Math.min(product.maxFridgeCapacity || 0, (product.fridgeStock || 0) + availableFromWarehouse);
      product.stock = Math.max(0, product.stock - availableFromWarehouse);
      write(data);
    }
  },

  fillAllFridges() {
    const data = read();
    let changed = false;
    for (const product of data.products) {
      if (!product.isCold || !(product.maxFridgeCapacity > 0)) {
        continue;
      }
      const missing = Math.max(0, (product.maxFridgeCapacity || 0) - (product.fridgeStock || 0));
      const availableFromWarehouse = Math.min(missing, product.stock);
      if (availableFromWarehouse > 0) {
        product.fridgeStock = Math.min(product.maxFridgeCapacity || 0, (product.fridgeStock || 0) + availableFromWarehouse);
        product.stock = Math.max(0, product.stock - availableFromWarehouse);
        changed = true;
      }
    }
    if (changed) {
      write(data);
    }
    return changed;
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
};