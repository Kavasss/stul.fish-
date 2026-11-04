'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-weight-'));
process.env.SEED_DEMO = '1';
process.env.GEOCODER_URL = 'off';
process.env.ADMIN_PASSWORD = 'admin-test-pass';
process.env.MANAGER_PASSWORD = 'manager-test-pass';
const { server } = require('../server.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => new Promise((r) => server.close(r)));

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

test('менеджер задаёт сумму по фактическому весу, покупатель её видит', async () => {
  const guest = client();
  const manager = client();
  const customer = client();
  await customer('POST', '/api/auth/register', { email: 'w@example.com', name: 'W', password: '12345678', consent: true });
  const o = await customer('POST', '/api/orders', { customer_name: 'W', phone: '+48600100200', delivery: 'pickup', consent: true, items: [{ product_id: 3, qty: 2 }] });
  assert.equal(o.status, 200);
  const id = o.data.order.id;
  assert.equal(o.data.order.total_final, null);

  assert.equal((await guest('PUT', `/api/orders/${id}/total`, { total: '1' })).status, 401);
  assert.equal((await customer('PUT', `/api/orders/${id}/total`, { total: '1' })).status, 403);

  await manager('POST', '/api/auth/login', { email: 'manager@shul.fish', password: 'manager-test-pass' });
  const r = await manager('PUT', `/api/orders/${id}/total`, { total: '123,45' });
  assert.equal(r.status, 200);
  assert.equal(r.data.order.total_final, 123.45);

  const mine = await customer('GET', '/api/orders/my');
  assert.equal(mine.data.orders[0].total_final, 123.45);

  // пустое значение — сброс к предварительной сумме
  assert.equal((await manager('PUT', `/api/orders/${id}/total`, { total: '' })).data.order.total_final, null);
  assert.equal((await manager('PUT', `/api/orders/${id}/total`, { total: '-5' })).status, 400);
});

test('таблица 10% — только администратор; считается от суммы чека, отменённые не входят', async () => {
  const admin = client();
  const manager = client();
  const guest = client();
  await admin('POST', '/api/auth/login', { email: 'admin@shul.fish', password: 'admin-test-pass' });
  await manager('POST', '/api/auth/login', { email: 'manager@shul.fish', password: 'manager-test-pass' });
  assert.equal((await guest('GET', '/api/reports/percent')).status, 401);
  assert.equal((await manager('GET', '/api/reports/percent')).status, 403);
  assert.equal((await manager('GET', '/api/reports/percent.csv')).status, 403);

  const a = (await guest('POST', '/api/orders', { customer_name: 'A', phone: '+48600100200', delivery: 'pickup', consent: true, items: [{ product_id: 3, qty: 1 }] })).data.order;
  const b = (await guest('POST', '/api/orders', { customer_name: 'B', phone: '+48600100200', delivery: 'pickup', consent: true, items: [{ product_id: 3, qty: 1 }] })).data.order;
  await admin('PUT', `/api/orders/${a.id}/total`, { total: '123,45' });
  await admin('PUT', `/api/orders/${b.id}/status`, { status: 'cancelled' });

  const rep = (await admin('GET', '/api/reports/percent')).data;
  const rowA = rep.rows.find((r) => r.id === a.id);
  assert.equal(rowA.check, 123.45);
  assert.equal(rowA.percent, 12.35);
  assert.ok(!rep.rows.find((r) => r.id === b.id));
  const csv = await fetch(base + '/api/reports/percent.csv');
  assert.equal(csv.status, 401);
});

test('поштучно по цене за кг: сумма = штуки × вес шт. × цена за кг', async () => {
  const admin = client();
  const guest = client();
  await admin('POST', '/api/auth/login', { email: 'admin@shul.fish', password: 'admin-test-pass' });
  const p = (await admin('POST', '/api/products', { name: 'Скумбрия', category: 'smoked', unit: 'шт', price: 45, piece_weight: '0,5', initial_stock: 20 })).data.product;
  assert.equal(p.piece_weight, 0.5);
  assert.equal((await guest('GET', `/api/products/${p.id}`)).data.product.piece_weight, 0.5);
  const o = (await guest('POST', '/api/orders', { customer_name: 'A', phone: '+48600100200', delivery: 'pickup', consent: true, items: [{ product_id: p.id, qty: 3 }] })).data.order;
  assert.equal(o.total, 67.5); // 3 шт × 0,5 кг × 45 zł
  assert.equal(o.items[0].piece_weight, 0.5);
  // пустое поле — снова обычный товар
  assert.equal((await admin('PUT', `/api/products/${p.id}`, { piece_weight: '' })).data.product.piece_weight, null);
  assert.equal((await admin('PUT', `/api/products/${p.id}`, { piece_weight: '-1' })).status, 400);
});
