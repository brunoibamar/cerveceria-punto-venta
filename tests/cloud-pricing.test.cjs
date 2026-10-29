const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../services/cloud-pricing.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const product = { data: { precioVenta: 50, unidadesPorCarton: 12, precioCarton: 470, cobroExtraEnvaseFaltantePieza: 10, cobroExtraEnvaseFaltanteCarton: 10 } };
test('cotización de paquetes y piezas coincide con los importes en centavos del servidor', () => {
  assert.equal(pricing.quote(product, 1, false, false), 5000);
  assert.equal(pricing.quote(product, 24, false, false), 94000);
  assert.equal(pricing.quote(product, 13, false, false), 52000);
  assert.equal(pricing.quote(product, 13, true, true, { coldCharge: 2 }), 56600);
});
test('cantidades inválidas no pueden cotizarse', () => {
  for (const value of [0, -1, 1.2, NaN]) assert.throws(() => pricing.quote(product, value, false, false));
});

function cloudHarness() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const host = { querySelectorAll: () => [] };
  const context = { document: { getElementById: () => host }, sessionStorage: storage, navigator: { onLine: true }, crypto, CloudConfig: { businessId: 'business' }, Intl, console };
  const source = fs.readFileSync(path.join(__dirname, '../js/cloud.js'), 'utf8').replace(/Cloud\.init\(\)\.catch\(error => Cloud\.notice\(error\.message\)\);\s*$/, '');
  vm.runInNewContext(source + '\nglobalThis.subject = Cloud;', context);
  const cloud = context.subject;
  cloud.state = { member: { user_id: 'cashier' } };
  cloud.render = () => {};
  cloud.notice = () => {};
  cloud.refresh = async () => {};
  return { cloud, storage };
}

test('respuesta perdida conserva UUID y datos, bloquea otra venta y reintenta sin duplicar', async () => {
  const { cloud, storage } = cloudHarness();
  const calls = [];
  cloud.client = { rpc: async (_, args) => { calls.push(args); return { error: { message: 'Respuesta perdida' } }; } };
  await assert.rejects(cloud.command('sale', { total: 50 }));
  assert.ok(storage.getItem(cloud.pendingKey));
  await assert.rejects(cloud.command('sale', { total: 60 }));
  cloud.client.rpc = async (_, args) => { calls.push(args); return { data: { id: args.p_request } }; };
  await cloud.command(null, null, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].p_request, calls[1].p_request);
  assert.equal(JSON.stringify(calls[0].p_payload), JSON.stringify(calls[1].p_payload));
  assert.equal(storage.getItem(cloud.pendingKey), null);
});

test('rechazo explícito de PostgreSQL libera la solicitud para corregir el ticket', async () => {
  const { cloud, storage } = cloudHarness();
  cloud.client = { rpc: async () => ({ error: { code: 'P0001', message: 'Existencias insuficientes' } }) };
  await assert.rejects(cloud.command('sale', {}));
  assert.equal(storage.getItem(cloud.pendingKey), null);
  assert.equal(cloud.busy, false);
});
