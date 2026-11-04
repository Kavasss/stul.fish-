'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-test-'));
process.env.SEED_DEMO = '1';
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
  assert.equal((await admin('POST', '/api/auth/login', { email: 'admin@shul.fish', password: 'admin-test-pass' })).status, 200);
  const m = await manager('POST', '/api/auth/login', { email: 'manager@shul.fish', password: 'manager-test-pass' });
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
  const before = (await manager('GET', '/api/products/1')).data.product.stock;
  const o = await guest('POST', '/api/orders', { customer_name: 'Иван', phone: '+48 600 100 200', address: 'Marszałkowska 1', consent: true, items: [{ product_id: 1, qty: 2 }] });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal((await manager('GET', '/api/products/1')).data.product.stock, before - 2);
  assert.equal((await guest('POST', '/api/orders', { customer_name: 'Иван', phone: '+48600100200', address: 'x', consent: true, items: [{ product_id: 1, qty: 0.5 }] })).status, 400);
  assert.equal((await guest('POST', '/api/orders', { customer_name: 'Иван', phone: '+48600100200', address: 'x', consent: true, items: [{ product_id: 1, qty: 99 }] })).status, 409);
  const c = await manager('PUT', `/api/orders/${o.data.order.id}/status`, { status: 'cancelled' });
  assert.equal(c.data.order.status, 'cancelled');
  assert.equal((await manager('GET', '/api/products/1')).data.product.stock, before);
});

test('покупатель регистрируется и видит свои заказы', async () => {
  const r = await customer('POST', '/api/auth/register', { name: 'Анна', email: 'anna@example.com', password: 'password1', consent: true });
  assert.equal(r.data.user.role, 'customer');
  await customer('POST', '/api/orders', { customer_name: 'Анна', phone: '+48600000000', delivery: 'pickup', consent: true, items: [{ product_id: 12, qty: 1 }] });
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

/* ---------------- Безопасность ---------------- */
const http = require('node:http');
function rawGet(p) {
  return new Promise((resolve) => {
    const u = new URL(base);
    http.get({ host: u.hostname, port: u.port, path: p }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  });
}

test('гость не видит точные остатки, видимость и даты изменений', async () => {
  const list = (await guest('GET', '/api/products')).data.products;
  for (const p of list) {
    for (const k of ['stock', 'cost', 'min_stock', 'active', 'updated_at']) assert.equal(p[k], undefined, `поле ${k} утекает`);
  }
  assert.equal(typeof list[0].in_stock, 'boolean');
  const one = (await guest('GET', '/api/products/1')).data.product;
  assert.equal(one.stock, undefined);
  // ?all=1 для гостя игнорируется
  const all = (await guest('GET', '/api/products?all=1')).data.products;
  assert.ok(all.every((p) => p.stock === undefined));
});

test('ошибка заказа не раскрывает остаток склада', async () => {
  const r = await guest('POST', '/api/orders', { customer_name: 'Иван', phone: '+48600100200', address: 'x', consent: true, items: [{ product_id: 2, qty: 99 }] });
  assert.equal(r.status, 409);
  assert.doesNotMatch(r.data.error, /\d+\s*(уп|кг|шт|банка)|остаток/);
});

test('скрытый товар не виден и не раскрывается через заказ', async () => {
  const created = await admin('POST', '/api/products', { name: 'Секретная новинка', category: 'caviar', unit: 'шт', price: 10, cost: 5, initial_stock: 5, active: false });
  const id = created.data.product.id;
  assert.equal((await guest('GET', `/api/products/${id}`)).status, 404);
  assert.ok(!(await guest('GET', '/api/products?q=Секретная')).data.products.length);
  const r = await guest('POST', '/api/orders', { customer_name: 'Иван', phone: '+48600100200', address: 'x', consent: true, items: [{ product_id: id, qty: 1 }] });
  assert.equal(r.status, 404);
  assert.doesNotMatch(JSON.stringify(r.data), /Секретная/);
});

test('покупатель не получает служебные данные', async () => {
  for (const url of ['/api/stock/movements', '/api/inventory', '/api/inventory.csv', '/api/orders', '/api/users', '/api/log', '/api/stats']) {
    assert.equal((await customer('GET', url)).status, 403, url);
    assert.equal((await guest('GET', url)).status, 401, url);
  }
});

test('битые адреса не роняют сервер, обход папок и скрытые файлы закрыты', async () => {
  assert.equal(await rawGet('/%E0%A4%A'), 400);
  assert.equal(await rawGet('/api/products/%E0%A4%A'), 400);
  for (const p of ['/uploads/%2e%2e/shop.db', '/uploads/..%2fshop.db', '/%2e%2e/data/shop.db']) {
    const body = await (await fetch(base + p)).text();
    assert.doesNotMatch(body, /SQLite format/, p + ' отдал базу');
  }
  assert.equal(await rawGet('/uploads/shop.db'), 404);
  assert.equal(await rawGet('/../data/shop.db'), 404); // нормализуется в /data/shop.db → страница «не найдено», а не база
  const r = await fetch(base + '/../data/shop.db');
  assert.match(await r.text(), /<!doctype html>/i);
  assert.equal(await rawGet('/.git/config'), 404);
  assert.equal((await fetch(base + '/api/me')).status, 200, 'сервер жив');
});

test('защитные заголовки', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('CSRF: запрос с чужого сайта отклоняется, с нашего — проходит', async () => {
  const evil = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(evil.status, 403);
  const ok = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
  assert.equal(ok.status, 200);
  const form = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '' });
  assert.equal(form.status, 415);
});

test('сессии хранятся в виде хэша', async () => {
  const { db } = require('../server.js');
  const rows = db.prepare('SELECT token FROM sessions').all();
  assert.ok(rows.length > 0);
  const c = client();
  await c('POST', '/api/auth/login', { email: 'anna@example.com', password: 'password1', consent: true });
  // подставить хэш из базы как cookie не получится
  const stolen = rows[0].token;
  const r = await fetch(base + '/api/me', { headers: { Cookie: `sid=${stolen}` } });
  assert.equal((await r.json()).user, null);
});

test('смена пароля выкидывает другие сессии', async () => {
  const a = client();
  const b = client();
  await a('POST', '/api/auth/register', { name: 'Пётр', email: 'petr@example.com', password: 'password1', consent: true });
  await b('POST', '/api/auth/login', { email: 'petr@example.com', password: 'password1', consent: true });
  assert.ok((await b('GET', '/api/me')).data.user);
  assert.equal((await a('PUT', '/api/me', { old_password: 'password1', new_password: 'password2' })).status, 200);
  assert.ok((await a('GET', '/api/me')).data.user, 'текущая сессия остаётся');
  assert.equal((await b('GET', '/api/me')).data.user, null, 'другая сессия завершена');
  // неверный старый пароль не меняет и имя
  assert.equal((await a('PUT', '/api/me', { name: 'Хакер', old_password: 'wrong', new_password: 'password3' })).status, 400);
  assert.equal((await a('GET', '/api/me')).data.user.name, 'Пётр');
});

test('перебор пароля блокируется по e-mail', async () => {
  const c = client();
  let last;
  for (let i = 0; i < 11; i++) last = await c('POST', '/api/auth/login', { email: 'victim@example.com', password: 'x' + i });
  assert.equal(last.status, 429);
});

test('CSV экранирует формулы Excel', async () => {
  await admin('POST', '/api/products', { name: '=HYPERLINK("http://evil")', category: 'sets', unit: 'шт', price: 1, cost: 1 });
  const csv = (await admin('GET', '/api/inventory.csv')).data;
  assert.match(csv, /"'=HYPERLINK/);
});

/* ---------------- Два языка ---------------- */
test('товары отдают польские поля, поиск находит по-польски', async () => {
  const p = (await guest('GET', '/api/products/1')).data.product;
  assert.equal(p.name_pl, 'Makrela wędzona na gorąco');
  assert.ok(p.description_pl.length > 10);
  const found = (await guest('GET', '/api/products?q=Makrela')).data.products;
  assert.deepEqual(found.map((x) => x.id), [1]);
  // сортировка по польскому названию: «Ciosa» раньше «Makrela», хотя по-русски «Скумбрия» раньше «Чехонь»
  const names = (await guest('GET', '/api/products?sort=name&lang=pl')).data.products.map((x) => x.name_pl);
  assert.ok(names.indexOf('Ciosa suszona') < names.indexOf('Makrela wędzona na gorąco'));
});

test('админ редактирует польские поля, заказ помнит язык', async () => {
  const r = await admin('PUT', '/api/products/3', { name_pl: 'Leszcz wędzony (test)', description_pl: 'Opis PL' });
  assert.equal(r.data.product.name_pl, 'Leszcz wędzony (test)');
  const o = await guest('POST', '/api/orders', { customer_name: 'Jan', phone: '+48600100300', delivery: 'pickup', lang: 'pl', consent: true, items: [{ product_id: 3, qty: 1 }] });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.order.lang, 'pl');
  assert.equal(o.data.order.items[0].name_pl, 'Leszcz wędzony (test)');
  assert.equal(o.data.order.items[0].name, 'Лещ горячего копчения', 'для склада остаётся русское название');
});
