'use strict';
/* Каталог по 1 кг и автоподключение стоковых фото по артикулу */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-cat-'));
const photos = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-photos-'));
for (const f of ['SF-003.png', 'SF-003_2.png', 'SF-012.png', 'SF-999.png', 'readme.txt']) fs.writeFileSync(path.join(photos, f), PNG);

// «Старая» база: стартовый каталог, где админ уже вручную поменял цену икры кеты (SF-013)
before(() => {
  process.env.DATA_DIR = dataDir;
  process.env.SEED_DEMO = '1';
  process.env.ADMIN_PASSWORD = 'admin-test-pass';
  process.env.MANAGER_PASSWORD = 'manager-test-pass';
  process.env.STOCK_PHOTOS_DIR = photos;
});

let server, db, base;
test('миграция на 1 кг: стартовые товары пересчитаны, ручные правки не тронуты', async () => {
  // 1-й запуск создаёт базу и сразу применяет миграцию; откатываем флаг и имитируем старую базу
  ({ server, db } = require('../server.js'));
  db.prepare("DELETE FROM settings WHERE key = 'catalog_1kg'").run();
  db.prepare("UPDATE products SET unit = 'банка', price = 8900, cost = 5800 WHERE sku = 'SF-012'").run();
  db.prepare("UPDATE products SET unit = 'банка', price = 9999 WHERE sku = 'SF-013'").run(); // ручная правка
  db.close();
  delete require.cache[require.resolve('../server.js')];
  delete require.cache[require.resolve('../sheets-sync.js')];
  ({ server, db } = require('../server.js'));
  const p12 = db.prepare("SELECT * FROM products WHERE sku = 'SF-012'").get();
  assert.equal(p12.unit, 'кг'); assert.equal(p12.price, 34900); assert.match(p12.description, /1 кг/); assert.match(p12.description_pl, /1 kg/);
  const p13 = db.prepare("SELECT * FROM products WHERE sku = 'SF-013'").get();
  assert.equal(p13.price, 9999, 'ручная цена сохранена'); assert.equal(p13.unit, 'банка');
  const p16 = db.prepare("SELECT * FROM products WHERE sku = 'SF-016'").get();
  assert.equal(p16.name, 'Набор «Икорный» (1 кг)'); assert.equal(p16.name_pl, 'Zestaw „Ikrowy” (1 kg)');
  const units = db.prepare("SELECT DISTINCT unit FROM products WHERE sku != 'SF-013'").all().map((r) => r.unit);
  assert.deepEqual(units, ['кг']);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => (server ? server.close(r) : r())));

test('заказ только целыми упаковками', async () => {
  const order = (qty) => fetch(base + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_name: 'Jan', phone: '+48600100200', delivery: 'pickup', consent: true, items: [{ product_id: 1, qty }] }) });
  assert.equal((await order(0.5)).status, 400);
  assert.match((await (await order(1.5)).json()).error, /только целое число упаковок/);
  assert.equal((await order(2)).status, 200);
});

test('стоковые фото подключены по артикулу, в правильном порядке', async () => {
  const imgs = (sku) => db.prepare('SELECT i.* FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.sku = ? ORDER BY sort').all(sku);
  assert.equal(imgs('SF-003').length, 2, 'SF-003.png и SF-003_2.png');
  assert.equal(imgs('SF-012').length, 1);
  assert.equal(imgs('SF-001').length, 0);
  const p = (await (await fetch(base + '/api/products/3')).json()).product;
  assert.equal(p.images.length, 2);
  assert.equal((await fetch(base + p.images[0].url)).headers.get('content-type'), 'image/png');
});

test('удалённое вручную фото не возвращается при перезапуске', async () => {
  const id = db.prepare("SELECT id FROM products WHERE sku = 'SF-012'").get().id;
  db.prepare('DELETE FROM product_images WHERE product_id = ?').run(id);
  await new Promise((r) => server.close(r));
  db.close();
  delete require.cache[require.resolve('../server.js')];
  delete require.cache[require.resolve('../sheets-sync.js')];
  ({ server, db } = require('../server.js'));
  await new Promise((r) => server.listen(0, r));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM product_images WHERE product_id = ?').get(id).c, 0);
  // проверка, что база валидна
  assert.ok(new DatabaseSync(path.join(dataDir, 'shop.db')).prepare('SELECT COUNT(*) c FROM products').get().c >= 16);
});
