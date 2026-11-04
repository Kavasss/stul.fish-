'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-seo-'));
process.env.SEED_DEMO = '1';
process.env.ADMIN_PASSWORD = 'admin-test-pass';
process.env.MANAGER_PASSWORD = 'manager-test-pass';
process.env.STOCK_PHOTOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-nophotos-'));
const { server, db } = require('../server.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => new Promise((r) => server.close(r)));
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, type: r.headers.get('content-type'), body: await r.text() }; };
const title = (html) => /<title>([^<]*)<\/title>/.exec(html)[1];

test('sitemap.xml: все страницы и товары, RU и PL', async () => {
  const r = await get('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.type, /application\/xml/);
  assert.match(r.body, /<loc>https:\/\/shulfish\.pl\/<\/loc>/);
  assert.match(r.body, /<loc>https:\/\/shulfish\.pl\/catalog\/caviar\?lang=pl<\/loc>/);
  const active = db.prepare('SELECT COUNT(*) c FROM products WHERE active = 1').get().c;
  assert.equal((r.body.match(/<loc>https:\/\/shulfish\.pl\/product\/\d+<\/loc>/g) || []).length, active);
  assert.match(r.body, /hreflang="pl" href="https:\/\/shulfish\.pl\/product\/1\?lang=pl"/);
  assert.doesNotMatch(r.body, /admin|account|cart/);
  // скрытый товар в карту не попадает
  db.prepare('UPDATE products SET active = 0 WHERE id = 2').run();
  assert.doesNotMatch((await get('/sitemap.xml')).body, /\/product\/2</);
  db.prepare('UPDATE products SET active = 1 WHERE id = 2').run();
});

test('robots.txt закрывает служебные разделы и указывает карту', async () => {
  const r = await get('/robots.txt');
  assert.match(r.type, /text\/plain/);
  for (const p of ['/api/', '/admin', '/account', '/cart']) assert.match(r.body, new RegExp(`Disallow: ${p.replace('/', '\\/')}`));
  assert.match(r.body, /Sitemap: https:\/\/shulfish\.pl\/sitemap\.xml/);
});

test('страница товара: свой title, description, canonical, разметка Product', async () => {
  const ru = await get('/product/1');
  assert.equal(ru.status, 200);
  assert.match(title(ru.body), /^Скумбрия горячего копчения — 69 zł\/кг \| SHUL\.FISH$/);
  assert.match(ru.body, /<link rel="canonical" href="https:\/\/shulfish\.pl\/product\/1">/);
  assert.match(ru.body, /<html lang="ru">/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(ru.body)[1]);
  assert.equal(ld['@type'], 'Product'); assert.equal(ld.offers.price, '69.00'); assert.equal(ld.offers.priceCurrency, 'PLN');
  const pl = await get('/product/1?lang=pl');
  assert.match(title(pl.body), /^Makrela wędzona na gorąco — 69 zł\/kg/);
  assert.match(pl.body, /<html lang="pl">/);
  assert.match(pl.body, /canonical" href="https:\/\/shulfish\.pl\/product\/1\?lang=pl"/);
  assert.equal((ru.body.match(/<title>/g) || []).length, 1, 'один title');
});

test('категории, правовые страницы, приватные разделы и 404', async () => {
  assert.match(title((await get('/catalog/caviar')).body), /^Икра — купить в Варшаве/);
  assert.match(title((await get('/catalog/caviar?lang=pl')).body), /^Ikra i kawior — kup w Warszawie/);
  assert.match(title((await get('/terms?lang=pl')).body), /^Regulamin sklepu/);
  assert.match((await get('/admin/products')).body, /<meta name="robots" content="noindex,nofollow">/);
  const nf = await get('/product/99999');
  assert.equal(nf.status, 404); assert.match(nf.body, /noindex/);
  assert.equal((await get('/nichego-net')).status, 404);
  assert.equal((await get('/googlea4b527db734c4c77.html')).body.trim(), 'google-site-verification: googlea4b527db734c4c77.html');
});

test('название товара не может вставить HTML в страницу', async () => {
  db.prepare("UPDATE products SET name = ? WHERE id = 3").run('Лещ"><script>alert(1)</script>');
  const r = await get('/product/3');
  assert.doesNotMatch(r.body, /<script>alert/);
  assert.match(title(r.body), /&quot;&gt;&lt;script&gt;/);
  const ld = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(r.body)[1];
  assert.doesNotMatch(ld, /<\/script>/);
});
