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
// Поддельный геокодер: «Daleka» — 20 км от центра, «Bliska» — рядом, остальное не находится
const http = require('node:http');
const geo = http.createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams.get('street') || '';
  const hit = /Daleka/.test(q) ? [{ lat: '52.45', lon: '21.06' }] : /Bliska/.test(q) ? [{ lat: '52.29', lon: '21.10' }] : /Srednia/.test(q) ? [{ lat: '52.2765', lon: '21.135' }] : [];
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(hit));
}).listen(0);
process.env.TRANSLATE_URL = 'off';
process.env.GEOCODER_URL = `http://127.0.0.1:${geo.address().port}/search`;
process.env.ORDER_HOURS = 'off';
const { server } = require('../server.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => new Promise((r) => { geo.close(); server.close(r); }));

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

test('доставка: район из списка добавляется к адресу, чужой район отклоняется', async () => {
  const order = (extra, ip) => fetch(base + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ items: [{ product_id: 1, qty: 1 }], customer_name: 'Тест', phone: '+48 600 000 000', delivery: 'courier', consent: true, lang: 'ru', ...extra }),
  });
  const ok = await order({ area: 'zabki', address: 'ul. Piłsudskiego 1' }, '203.0.113.92');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).order.address, 'Ząbki, ul. Piłsudskiego 1');
  assert.equal((await order({ area: 'krakow', address: 'x' }, '203.0.113.93')).status, 400);
});

test('доставка: адрес дальше 7 км отклоняется, ближний принимается с расстоянием', async () => {
  const order = (address, ip) => fetch(base + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ items: [{ product_id: 1, qty: 1 }], customer_name: 'Тест', phone: '+48 600 000 000', delivery: 'courier', area: 'marki', address, consent: true, lang: 'ru' }),
  });
  const far = await order('ul. Daleka 5', '203.0.113.94');
  assert.equal(far.status, 400);
  assert.match((await far.json()).error, /радиусе 7 км/);
  const near = await order('ul. Bliska 5', '203.0.113.95');
  assert.equal(near.status, 200);
  const d = (await near.json()).order.distance_km;
  assert.ok(d > 0 && d < 7, String(d));
});

test('стоимость доставки: 2 zł за начатый км, минимум 10 zł; самовывоз бесплатно', async () => {
  const quote = async (address, ip) => {
    const r = await fetch(base + '/api/delivery/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ area: 'warszawa', address }),
    });
    return { status: r.status, data: await r.json() };
  };
  const near = await quote('ul. Bliska 5', '203.0.113.96');      // ~3,4 км → 4 км × 2 = 8 → минимум 10
  assert.equal(near.data.km_billed, 4);
  assert.equal(near.data.fee, 10);
  const mid = await quote('ul. Srednia 5', '203.0.113.96');      // ~5,4 км → 6 км × 2 = 12
  assert.equal(mid.data.km_billed, 6);
  assert.equal(mid.data.fee, 12);
  assert.equal((await quote('ul. Nieznana 1', '203.0.113.96')).data.fee, null); // не найден — уточнит менеджер
  assert.equal((await quote('ul. Daleka 1', '203.0.113.96')).status, 400);

  const order = async (extra, ip) => (await fetch(base + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ items: [{ product_id: 3, qty: 1 }], customer_name: 'Тест', phone: '+48 600 000 000', consent: true, lang: 'ru', ...extra }),
  })).json();
  const c = (await order({ delivery: 'courier', area: 'warszawa', address: 'ul. Srednia 5' }, '203.0.113.97')).order;
  assert.equal(c.delivery_fee, 12);
  assert.equal(c.grand_total, Math.round((c.total + 12) * 100) / 100);
  const p = (await order({ delivery: 'pickup' }, '203.0.113.98')).order;
  assert.equal(p.delivery_fee, 0);
  assert.equal(p.grand_total, p.total);
});

test('ключи прототипа («constructor», «__proto__») не считаются категорией или районом', async () => {
  assert.equal((await fetch(base + '/catalog/constructor')).status, 404);
  for (const area of ['constructor', '__proto__', 'toString']) {
    const r = await fetch(base + '/api/delivery/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area, address: 'Testowa 1' }) });
    assert.equal(r.status, 400, area);
  }
});
