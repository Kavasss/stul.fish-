'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-hours-'));
process.env.SEED_DEMO = '1';
process.env.TRANSLATE_URL = 'off';
process.env.ADMIN_PASSWORD = 'admin-test-pass';
process.env.MANAGER_PASSWORD = 'manager-test-pass';
// Приём заказов — в любой день, кроме сегодняшнего (по Варшаве): сейчас приём закрыт
const today = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', weekday: 'short' }).format(new Date())];
process.env.ORDER_HOURS = '00:00-23:59';
process.env.ORDER_DAYS = [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== today).join(',');
// Поддельный геокодер: точки на востоке от Bazaru Trocka (52.2765, 21.0560) на разном расстоянии
const POS = { Pierwsza: [52.2765, 21.07], Druga: [52.2765, 21.09], Trzecia: [52.2765, 21.11], Czwarta: [52.2765, 21.13] };
const geo = http.createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams.get('street') || '';
  const k = Object.keys(POS).find((n) => q.includes(n));
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(k ? [{ lat: String(POS[k][0]), lon: String(POS[k][1]) }] : []));
}).listen(0);
process.env.GEOCODER_URL = `http://127.0.0.1:${geo.address().port}/search`;
// Поддельный OSRM: «по дорогам» выгоднее ехать сначала к дальней точке (по долготе — с конца); router.on = false — недоступен
const router = { on: true, calls: 0 };
const osrm = http.createServer((req, res) => {
  router.calls++;
  if (!router.on) { res.statusCode = 503; return res.end('{}'); }
  const pts = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').pop()).split(';').map((p) => p.split(',').map(Number));
  const rest = pts.slice(1).map((p, i) => ({ i: i + 1, lon: p[0] })).sort((a, b) => b.lon - a.lon);
  const wi = new Array(pts.length); wi[0] = 0; rest.forEach((x, k) => { wi[x.i] = k + 1; });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code: 'Ok', waypoints: pts.map((_, i) => ({ waypoint_index: wi[i], trips_index: 0 })),
    trips: [{ legs: rest.map(() => ({ distance: 2345, duration: 300 })), distance: 2345 * rest.length, duration: 300 * rest.length }] }));
}).listen(0);
process.env.ROUTER_URL = `http://127.0.0.1:${osrm.address().port}`;
const { server, db, ordersOpenAt, parseOrderHours, planRoute, mapsLinks } = require('../server.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => new Promise((r) => { geo.close(); osrm.close(); server.close(r); }));

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

test('время приёма: пн–сб 15:00–16:00 по Варшаве', () => {
  const h = parseOrderHours('15:00-16:00', '1-6');
  assert.deepEqual(h.days, [1, 2, 3, 4, 5, 6]);
  // ноябрь — зимнее время, Варшава = UTC+1; 9 ноября 2026 — понедельник
  assert.equal(ordersOpenAt(new Date('2026-11-09T14:00:00Z'), h), true); // 15:00
  assert.equal(ordersOpenAt(new Date('2026-11-09T14:59:00Z'), h), true); // 15:59
  assert.equal(ordersOpenAt(new Date('2026-11-09T15:00:00Z'), h), false); // 16:00 — уже закрыто
  assert.equal(ordersOpenAt(new Date('2026-11-09T13:59:00Z'), h), false); // 14:59
  assert.equal(ordersOpenAt(new Date('2026-11-14T14:30:00Z'), h), true); // суббота
  assert.equal(ordersOpenAt(new Date('2026-11-08T14:30:00Z'), h), false); // воскресенье
  // летнее время, Варшава = UTC+2
  assert.equal(ordersOpenAt(new Date('2026-07-06T13:30:00Z'), h), true);
  assert.equal(parseOrderHours('off'), null);
});

test('вне времени приёма покупатель заказать не может, сотрудник — может', async () => {
  const guest = client();
  const meta = (await guest('GET', '/api/meta')).data;
  assert.equal(meta.orders_open_now, false);
  assert.equal(meta.order_hours.from, '00:00');
  const order = { customer_name: 'A', phone: '+48600100200', delivery: 'pickup', consent: true, items: [{ product_id: 3, qty: 1 }] };
  const r = await guest('POST', '/api/orders', order);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /принимаются/);
  const manager = client();
  await manager('POST', '/api/auth/login', { email: 'manager@shul.fish', password: 'manager-test-pass' });
  assert.equal((await manager('POST', '/api/orders', order)).status, 200);
});

test('маршрут развоза: активные курьерские заказы по порядку от Bazaru Trocka', async () => {
  const manager = client();
  await manager('POST', '/api/auth/login', { email: 'manager@shul.fish', password: 'manager-test-pass' });
  const make = async (address) => (await manager('POST', '/api/orders', { customer_name: address, phone: '+48600100200', delivery: 'courier', area: 'warszawa', address, consent: true, items: [{ product_id: 3, qty: 1 }] })).data.order;
  // оформлены вразнобой
  const c = await make('Trzecia 3'), a = await make('Pierwsza 1 m. 5'), d = await make('Czwarta 4'), b = await make('Druga 2'), x = await make('Nieznana 9');
  const done = await make('Druga 7');
  await manager('PUT', `/api/orders/${done.id}/status`, { status: 'done' });
  // старый заказ без координат — найдётся при построении маршрута
  db.prepare('UPDATE orders SET lat = NULL, lon = NULL WHERE id = ?').run(c.id);

  assert.equal((await client()('GET', '/api/orders/route')).status, 401);
  // по дорогам: порядок от маршрутизатора, километры и минуты по дорогам
  const road = (await manager('GET', '/api/orders/route')).data;
  assert.equal(road.mode, 'road');
  assert.deepEqual(road.stops.map((s) => s.id), [d.id, c.id, b.id, a.id]);
  assert.deepEqual(road.stops.map((s) => [s.leg_km, s.leg_min]), [[2.3, 5], [2.3, 5], [2.3, 5], [2.3, 5]]);
  assert.equal(road.total_km, 9.2);
  assert.equal(road.total_min, 20);
  // маршрутизатор недоступен — порядок по прямой
  router.on = false;
  const r = (await manager('GET', '/api/orders/route')).data;
  router.on = true;
  assert.equal(r.mode, 'straight');
  assert.equal(r.total_min, null);
  assert.deepEqual(r.stops.map((s) => s.id), [a.id, b.id, c.id, d.id]);
  assert.deepEqual(r.stops.map((s) => s.n), [1, 2, 3, 4]);
  assert.deepEqual(r.unlocated.map((s) => s.id), [x.id]);
  assert.ok(!r.stops.find((s) => s.id === done.id));
  assert.ok(r.total_km > 4 && r.total_km < 6, String(r.total_km));
  assert.equal(r.links.length, 1);
  const u = new URL(r.links[0].url);
  assert.equal(u.searchParams.get('origin'), '52.2765,21.056');
  assert.equal(u.searchParams.get('destination'), 'Czwarta 4, Warszawa');
  assert.equal(u.searchParams.get('waypoints'), 'Pierwsza 1 m. 5, Warszawa|Druga 2, Warszawa|Trzecia 3, Warszawa');
});

test('маршрут: перестановки сокращают путь, длинный маршрут делится на ссылки', () => {
  const pts = [[52.2765, 21.13], [52.2765, 21.07], [52.2765, 21.11], [52.2765, 21.09]].map((pt, i) => ({ pt, i }));
  assert.deepEqual(planRoute([52.2765, 21.056], pts).map((p) => p.i), [1, 3, 2, 0]);
  // 23 точки: ссылки 1–10, 11–20, 21–23; следующая часть начинается с последней точки предыдущей
  const stops = Array.from({ length: 23 }, (_, i) => ({ maps: `Ulica ${i + 1}, Warszawa` }));
  const links = mapsLinks([52.2765, 21.056], stops);
  assert.deepEqual(links.map((l) => [l.from, l.to]), [[1, 10], [11, 20], [21, 23]]);
  const second = new URL(links[1].url).searchParams;
  assert.equal(second.get('origin'), 'Ulica 10, Warszawa');
  assert.equal(second.get('destination'), 'Ulica 20, Warszawa');
  assert.equal(second.get('waypoints').split('|').length, 9);
  // для телефона: по 4 адреса (3 промежуточных), старт — текущее место курьера
  const mob = mapsLinks([52.2765, 21.056], stops, { size: 4, fromHere: true });
  assert.deepEqual(mob.map((l) => [l.from, l.to]), [[1, 4], [5, 8], [9, 12], [13, 16], [17, 20], [21, 23]]);
  const m2 = new URL(mob[1].url).searchParams;
  assert.equal(m2.get('origin'), null);
  assert.equal(m2.get('waypoints').split('|').length, 3);
  assert.equal(m2.get('destination'), 'Ulica 8, Warszawa');
});

test('курьер: видит заказы к доставке с суммой и составом, отмечает оплату, больше ничего не может', async () => {
  const admin = client();
  await admin('POST', '/api/auth/login', { email: 'admin@shul.fish', password: 'admin-test-pass' });
  const cu = (await admin('POST', '/api/users', { email: 'kurier@shul.fish', name: 'Курьер Петя', role: 'courier', password: 'courier-pass-1' })).data.user;
  assert.equal(cu.role, 'courier');
  assert.deepEqual(cu.permissions, []);
  const make = async (address, status) => {
    const res = await admin('POST', '/api/orders', { customer_name: 'K', phone: '+48600100200', delivery: 'courier', area: 'warszawa', address, consent: true, items: [{ product_id: 1, qty: 2 }] });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const o = res.data.order;
    if (status) await admin('PUT', `/api/orders/${o.id}/status`, { status });
    return o;
  };
  const ready = await make('Pierwsza 11', 'confirmed');
  const onWay = await make('Druga 12', 'delivering');
  const fresh = await make('Trzecia 13'); // «Новый» — курьер ещё не видит

  const courier = client();
  assert.equal((await courier('POST', '/api/auth/login', { email: 'kurier@shul.fish', password: 'courier-pass-1' })).status, 200);
  const r = (await courier('GET', '/api/courier/route')).data;
  const ids = r.stops.map((s) => s.id);
  assert.ok(ids.includes(ready.id) && ids.includes(onWay.id) && !ids.includes(fresh.id));
  const s = r.stops.find((x) => x.id === ready.id);
  assert.equal(s.items[0].qty, 2);
  assert.ok(s.grand_total > 0);
  assert.equal(s.paid_method, null);
  assert.deepEqual(r.collected, { count: 0, cash: 0, card: 0 });

  // оплата
  const paid = (await courier('PUT', `/api/orders/${ready.id}/payment`, { method: 'cash' })).data.order;
  assert.equal(paid.paid_method, 'cash');
  assert.equal(paid.paid_by, 'Курьер Петя');
  await courier('PUT', `/api/orders/${onWay.id}/payment`, { method: 'card' });
  const after = (await courier('GET', '/api/courier/route')).data.collected;
  assert.equal(after.count, 2);
  assert.equal(after.cash, s.grand_total);
  assert.equal((await courier('PUT', `/api/orders/${onWay.id}/payment`, { method: 'bitcoin' })).status, 400);
  assert.equal((await courier('PUT', `/api/orders/${onWay.id}/payment`, { method: null })).data.order.paid_method, null);
  // заказ не из списка доставки — нельзя
  assert.equal((await courier('PUT', `/api/orders/${fresh.id}/payment`, { method: 'cash' })).status, 403);
  // менеджер видит отметку
  const all = (await admin('GET', '/api/orders')).data.orders;
  assert.equal(all.find((o) => o.id === ready.id).paid_method, 'cash');

  // остальное курьеру закрыто
  for (const [m, u, b] of [['GET', '/api/orders'], ['GET', '/api/orders/route'], ['PUT', `/api/orders/${ready.id}/status`, { status: 'done' }],
    ['PUT', `/api/orders/${ready.id}/total`, { total: '1' }], ['GET', '/api/users'], ['GET', '/api/inventory'], ['POST', '/api/products', { name: 'X', category: 'smoked', price: 1 }],
    ['GET', '/api/reports/percent'], ['GET', '/api/log']]) {
    assert.equal((await courier(m, u, b)).status, 403, `${m} ${u}`);
  }
  // покупателю и гостю маршрут курьера закрыт
  assert.equal((await client()('GET', '/api/courier/route')).status, 401);
  const buyer = client();
  await buyer('POST', '/api/auth/register', { email: 'buyer-c@example.com', name: 'B', password: '12345678', consent: true });
  assert.equal((await buyer('GET', '/api/courier/route')).status, 403);
  assert.equal((await buyer('PUT', `/api/orders/${ready.id}/payment`, { method: 'cash' })).status, 403);
});

test('старая база без роли «курьер» обновляется без потери пользователей', () => {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get().sql;
  assert.match(sql, /'courier'/);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM users WHERE role IN ('admin','manager')").get().c >= 2);
});

test('пробные заказы: только администратор, склад и отчёты не трогают, удаляются', async () => {
  const admin = client();
  const manager = client();
  await admin('POST', '/api/auth/login', { email: 'admin@shul.fish', password: 'admin-test-pass' });
  await manager('POST', '/api/auth/login', { email: 'manager@shul.fish', password: 'manager-test-pass' });
  assert.equal((await manager('POST', '/api/test-orders', {})).status, 403);
  const stock = () => db.prepare('SELECT SUM(stock) s FROM products').get().s;
  const before = stock();
  const repBefore = (await admin('GET', '/api/reports/percent')).data.totals.orders;
  const r = (await admin('POST', '/api/test-orders', {})).data;
  assert.equal(r.created, 6);
  // повторное нажатие не удваивает пробные заказы
  const again = (await admin('POST', '/api/test-orders', {})).data;
  assert.equal(db.prepare('SELECT COUNT(*) c FROM orders WHERE is_test = 1').get().c, 6);
  r.ids = again.ids;
  assert.equal(stock(), before);
  assert.equal((await admin('GET', '/api/reports/percent')).data.totals.orders, repBefore);
  // курьер видит 5 из 6 (кроме «Нового»)
  const route = (await admin('GET', '/api/courier/route')).data;
  const seen = [...route.stops, ...route.unlocated].filter((s) => r.ids.includes(s.id));
  assert.equal(seen.length, 5);
  // отмена пробного заказа не возвращает товар на склад
  await admin('PUT', `/api/orders/${r.ids[0]}/status`, { status: 'cancelled' });
  assert.equal(stock(), before);
  assert.equal((await manager('DELETE', '/api/test-orders', {})).status, 403);
  assert.equal((await admin('DELETE', '/api/test-orders', {})).data.deleted, 6);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM orders WHERE is_test = 1').get().c, 0);
});
