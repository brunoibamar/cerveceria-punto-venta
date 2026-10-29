const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const cycle = {
    id: 'cycle-test', status: 'open', startDate: '2026-10-28', endDate: '2026-11-04',
    initialStock: { p1: 100 },
    products: { p1: { nombre: 'Producto de prueba', unidadesPorCarton: 24 } },
    entries: [{ productId: 'p1', units: 24 }, { productId: 'otro', units: 999 }],
    finalStockDraft: {}
  };
  const products = [{ id: 'p1', nombre: 'Producto de prueba', stock: 999, unidadesPorCarton: 24 }];
  const sales = [
    { fecha: '2026-10-29T12:00:00Z', status: 'completada', items: [{ productId: 'p1', quantity: 17 }] },
    { fecha: '2026-10-29T12:00:00Z', status: 'cancelada', items: [{ productId: 'p1', quantity: 40 }] },
    { fecha: '2026-10-27T12:00:00Z', items: [{ productId: 'p1', quantity: 50 }] }
  ];
  const panel = { innerHTML: '' };
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: { getElementById: id => id === 'inventory-cycle-panel' ? panel : null },
    Database: { getSales: () => sales, getProducts: () => products, getInventoryCycles: () => [cycle] },
    console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/inventory.js'), 'utf8'), context);
  return { manager: context.window.InventoryManager, cycle, products, sales, panel };
}

test('esperado = inicial + surtidos del producto - ventas válidas del ciclo', () => {
  const { manager, cycle } = fixture();
  assert.equal(manager.getCycleExpectedStock(cycle, 'p1'), 107);
  assert.equal(manager.formatExpectedStock(107, 24), '4 cartones/paquetes + 11 piezas sueltas (107 piezas)');
});

test('sin surtidos ni ventas se conserva el inventario inicial', () => {
  const { manager, cycle } = fixture();
  cycle.entries = [];
  assert.equal(manager.getCycleExpectedStock(cycle, 'p1', {}), 100);
});

test('cero, paquetes completos y productos sin tamaño de paquete', () => {
  const { manager } = fixture();
  assert.equal(manager.formatExpectedStock(0, 24), '0 cartones/paquetes (0 piezas)');
  assert.equal(manager.formatExpectedStock(48, 24), '2 cartones/paquetes (48 piezas)');
  assert.equal(manager.formatExpectedStock(7, 0), '7 piezas');
});

test('un esperado negativo se muestra sin convertirlo en cero', () => {
  const { manager, cycle } = fixture();
  assert.equal(manager.getCycleExpectedStock(cycle, 'p1', { p1: 130 }), -6);
  assert.match(manager.formatExpectedStock(-6, 24), /^-6 piezas/);
  assert.match(manager.renderExpectedStockGuide(-6, 24), /is-negative/);
});

test('la tarjeta cerrada y el detalle muestran el esperado, distinto al stock actual', () => {
  const { manager, cycle, products, panel } = fixture();
  const before = JSON.stringify({ cycle, products });
  manager.renderInventoryCycle();
  assert.match(panel.innerHTML, /Inventario esperado/);
  assert.match(panel.innerHTML, /107 piezas/);
  assert.match(panel.innerHTML, /999/);
  assert.ok(panel.innerHTML.indexOf('Inventario esperado') < panel.innerHTML.indexOf('</summary>'));
  assert.equal(JSON.stringify({ cycle, products }), before);
});

test('el conteo físico ve la guía sin rellenarse ni modificar la auditoría', () => {
  const { manager, cycle, products } = fixture();
  manager.cyclePickerMode = 'count';
  manager.cyclePickerProductId = 'p1';
  const before = JSON.stringify(cycle);
  let html = manager.renderCyclePicker(cycle, products);
  assert.match(html, /Inventario esperado/);
  assert.match(html, /107 piezas/);
  assert.match(html, /data-picker-packages\s+value="0"/);
  assert.match(html, /data-picker-pieces value="0"/);
  assert.equal(JSON.stringify(cycle), before);
  cycle.finalStockDraft.p1 = 50;
  html = manager.renderCyclePicker(cycle, products);
  assert.match(html, /data-picker-packages\s+value="2"/);
  assert.match(html, /data-picker-pieces value="2"/);
  assert.match(html, /107 piezas/);
});

test('productos eliminados conservan el esperado usando el snapshot del ciclo', () => {
  const { manager, cycle, products, panel } = fixture();
  products.length = 0;
  manager.renderInventoryCycle();
  assert.match(panel.innerHTML, /4 cartones\/paquetes \+ 11 piezas sueltas/);
  assert.equal(cycle.finalStockDraft.p1, undefined);
});
