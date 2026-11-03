'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-test-'));
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
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

const admin = client();
const manager = client();
const guest = client();
const customer = client();

test('вход админа и менеджера, неверный пароль', async () => {
  assert.equal((await admin('POST', '/api/auth/login', { email: 'admin@shul.fish', password: 'admin12345' })).status, 200);
  const m = await manager('POST', '/api/auth/login', { email: 'manager@shul.fish', password: 'manager12345' });
  assert.equal(m.data.user.role, 'manager');
  assert.ok(!m.data.user.permissions.includes('products.price'));
  assert.equal((await guest('POST', '/api/auth/login', { email: 'admin@shul.fish', password: 'nope' })).status, 401);
});

test('гость видит каталог без себестоимости, не может менять товары', async () => {
  const r = await guest('GET', '/api/products');
  assert.ok(r.data.products.length >= 10);
  assert.equal(r.data.products[0].cost, undefined);
  assert.equal((await guest('PUT', '/api/products/1', { name: 'x' })).status, 401);
});

test('менеджер меняет описание, но не цену и не удаляет', async () => {
  assert.equal((await manager('PUT', '/api/products/1', { description: 'Новое описание' })).status, 200);
  const pr = await manager('PUT', '/api/products/1', { price: 1 });
  assert.equal(pr.status, 403);
  // та же цена — не считается изменением
  const cur = (await manager('GET', '/api/products/1')).data.product;
  assert.equal((await manager('PUT', '/api/products/1', { price: cur.price, name: cur.name })).status, 200);
  assert.equal((await manager('DELETE', '/api/products/1')).status, 403);
  assert.equal((await manager('GET', '/api/users')).status, 403);
});

test('админ создаёт товар с остатком и меняет цену', async () => {
  const r = await admin('POST', '/api/products', { name: 'Тестовая рыба', category: 'smoked', unit: 'кг', price: 50, cost: 30, initial_stock: 10, min_stock: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.data.product.stock, 10);
  const u = await admin('PUT', `/api/products/${r.data.product.id}`, { price: 55.5 });
  assert.equal(u.data.product.price, 55.5);
});

test('склад: приход, списание без причины запрещено, инвентаризация', async () => {
  assert.equal((await manager('POST', '/api/stock/2', { type: 'in', qty: 5, note: 'Поставка' })).status, 200);
  assert.equal((await manager('POST', '/api/stock/2', { type: 'writeoff', qty: 1 })).status, 400);
  const w = await manager('POST', '/api/stock/2', { type: 'writeoff', qty: 1, note: 'Брак' });
  assert.equal(w.data.product.stock, 34);
  const a = await manager('POST', '/api/stock/2', { type: 'adjust', qty: 33 });
  assert.equal(a.data.product.stock, 33);
  assert.equal((await manager('POST', '/api/stock/2', { type: 'out', qty: 1000, note: 'x' })).status, 409);
  const mv = await manager('GET', '/api/stock/movements?product_id=2');
  assert.deepEqual(mv.data.movements.slice(0, 3).map((m) => m.type), ['adjust', 'writeoff', 'in']);
});

test('заказ списывает остаток, отмена возвращает', async () => {
  const before = (await guest('GET', '/api/products/1')).data.product.stock;
  const o = await guest('POST', '/api/orders', { customer_name: 'Иван', phone: '+48 600 100 200', address: 'Marszałkowska 1', items: [{ product_id: 1, qty: 1.5 }] });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal((await guest('GET', '/api/products/1')).data.product.stock, before - 1.5);
  assert.equal((await guest('POST', '/api/orders', { customer_name: 'Иван', phone: '+48600100200', address: 'x', items: [{ product_id: 1, qty: 0.3 }] })).status, 400);
  assert.equal((await guest('POST', '/api/orders', { customer_name: 'Иван', phone: '+48600100200', address: 'x', items: [{ product_id: 1, qty: 999 }] })).status, 409);
  const c = await manager('PUT', `/api/orders/${o.data.order.id}/status`, { status: 'cancelled' });
  assert.equal(c.data.order.status, 'cancelled');
  assert.equal((await guest('GET', '/api/products/1')).data.product.stock, before);
});

test('покупатель регистрируется и видит свои заказы', async () => {
  const r = await customer('POST', '/api/auth/register', { name: 'Анна', email: 'anna@example.com', password: 'password1' });
  assert.equal(r.data.user.role, 'customer');
  await customer('POST', '/api/orders', { customer_name: 'Анна', phone: '+48600000000', delivery: 'pickup', items: [{ product_id: 12, qty: 1 }] });
  assert.equal((await customer('GET', '/api/orders/my')).data.orders.length, 1);
  assert.equal((await customer('GET', '/api/orders')).status, 403);
  assert.equal((await customer('GET', '/api/inventory')).status, 403);
});

test('фото: загрузка PNG, отказ для не-изображения', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = await manager('POST', '/api/products/3/images', { data: `data:image/png;base64,${png}` });
  assert.equal(r.status, 200);
  const img = await fetch(base + r.data.image.url);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await manager('POST', '/api/products/3/images', { data: 'data:image/png;base64,' + Buffer.from('<svg>').toString('base64') })).status, 400);
  assert.equal((await guest('POST', '/api/products/3/images', { data: `data:image/png;base64,${png}` })).status, 401);
});

test('админ ограничивает права менеджера — доступ пропадает сразу', async () => {
  const users = (await admin('GET', '/api/users')).data.users;
  const mgr = users.find((u) => u.email === 'manager@shul.fish');
  await admin('PUT', `/api/users/${mgr.id}`, { permissions: ['orders.manage', 'users.manage'] });
  assert.equal((await manager('POST', '/api/stock/2', { type: 'in', qty: 1 })).status, 403);
  assert.equal((await manager('GET', '/api/users')).status, 403, 'users.manage нельзя выдать менеджеру');
  assert.equal((await manager('GET', '/api/orders')).status, 200);
  assert.equal((await admin('PUT', `/api/users/${(await admin('GET', '/api/me')).data.user.id}`, { role: 'manager' })).status, 400);
});

test('отчёт склада и CSV', async () => {
  const r = await admin('GET', '/api/inventory');
  assert.ok(r.data.totals.cost_value > 0);
  const csv = await admin('GET', '/api/inventory.csv');
  assert.match(csv.data, /"Артикул";/);
  assert.ok((await admin('GET', '/api/log')).data.log.length > 0);
});

test('статика: запрет выхода за пределы папки', async () => {
  const r = await fetch(base + '/uploads/..%2f..%2fshop.db');
  assert.notEqual(r.status, 200);
});
