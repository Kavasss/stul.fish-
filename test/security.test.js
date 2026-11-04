'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-sec-'));
process.env.SEED_DEMO = '1';
process.env.ADMIN_PASSWORD = 'admin-test-pass';
process.env.MANAGER_PASSWORD = 'manager-test-pass';
process.env.TRUST_PROXY = '1';
const { server } = require('../server.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => new Promise((r) => server.close(r)));

const login = (email, password, xff) => fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(xff ? { 'X-Forwarded-For': xff } : {}) },
  body: JSON.stringify({ email, password }),
});

test('поддельный X-Forwarded-For не обходит ограничение по IP', async () => {
  const codes = [];
  // Клиент подставляет случайный адрес, прокси дописывает настоящий в конец
  for (let i = 0; i < 22; i++) codes.push((await login(`probe${i}@example.invalid`, 'x', `10.0.0.${i}, 203.0.113.7`)).status);
  assert.equal(codes[0], 401);
  assert.equal(codes.at(-1), 429);
});

test('чужие неудачные попытки не блокируют вход владельцу с верным паролем', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login('manager@shul.fish', 'wrong', `198.51.100.${i}`)).status, 401);
  assert.equal((await login('manager@shul.fish', 'manager-test-pass', '198.51.100.50')).status, 200);
  // после 10 неудачных подряд аккаунт временно защищён даже от верного пароля
  for (let i = 0; i < 10; i++) await login('admin@shul.fish', 'wrong', `192.0.2.${i}`);
  assert.equal((await login('admin@shul.fish', 'admin-test-pass', '192.0.2.99')).status, 429);
});

test('большие запросы отклоняются, кроме загрузки фото', async () => {
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.90' },
    body: JSON.stringify({ email: 'big@example.com', name: 'x'.repeat(200 * 1024), password: '12345678' }),
  });
  assert.equal(r.status, 413);
});

test('служебные файлы из public не отдаются', async () => {
  assert.equal((await fetch(base + '/img/products/README.md')).status, 404);
  assert.equal((await fetch(base + '/js/app.js')).status, 200);
});

test('заказ покупателя ограничен по количеству', async () => {
  const r = await fetch(base + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.91' },
    body: JSON.stringify({ items: [{ product_id: 1, qty: 101 }], customer_name: 'Тест', phone: '+48 600 000 000', delivery: 'pickup', consent: true, lang: 'ru' }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /не больше 100/);
});
