'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Рабочий режим (без демо-каталога): при первом запуске приём заказов на паузе
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-pause-'));
delete process.env.SEED_DEMO;
process.env.TRANSLATE_URL = 'off';
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

test('приём заказов: пауза по умолчанию, переключает только администратор', async () => {
  const admin = client();
  const manager = client();
  const guest = client();
  assert.equal((await guest('GET', '/api/meta')).data.orders_paused, true);

  await admin('POST', '/api/auth/login', { email: 'admin@shul.fish', password: 'admin-test-pass' });
  await manager('POST', '/api/auth/login', { email: 'manager@shul.fish', password: 'manager-test-pass' });
  const p = await admin('POST', '/api/products', { name: 'Тест', category: 'smoked', price: 10, initial_stock: 5 });
  const order = { customer_name: 'A', phone: '+48600100200', delivery: 'pickup', consent: true, items: [{ product_id: p.data.product.id, qty: 1 }] };

  const blocked = await guest('POST', '/api/orders', order);
  assert.equal(blocked.status, 503);
  assert.match(blocked.data.error, /приостановлен/);
  assert.equal((await admin('POST', '/api/orders', order)).status, 503); // заказы закрыты для всех

  assert.equal((await guest('PUT', '/api/settings/orders', { paused: false })).status, 401);
  assert.equal((await manager('PUT', '/api/settings/orders', { paused: false })).status, 403);

  assert.equal((await admin('PUT', '/api/settings/orders', { paused: false })).data.orders_paused, false);
  assert.equal((await guest('GET', '/api/meta')).data.orders_paused, false);
  assert.equal((await guest('POST', '/api/orders', order)).status, 200);

  assert.equal((await admin('PUT', '/api/settings/orders', { paused: true })).data.orders_paused, true);
  assert.equal((await guest('POST', '/api/orders', order)).status, 503);
});
