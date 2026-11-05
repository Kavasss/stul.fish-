'use strict';
/*
 * Сквозной тест связи сайта с Google Таблицей.
 * Настоящий google-sheets/Code.gs выполняется в песочнице поверх таблицы в памяти,
 * сервер ходит к нему по HTTP — как к веб-приложению Apps Script.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');

/* ---------- таблица в памяти с API, как у SpreadsheetApp ---------- */
class FakeSheet {
  constructor(name, header, rows = 60) {
    this.name = name;
    this.maxRows = rows;
    this.grid = [header.slice()];
    this.width = 16;
  }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  cell(r, c) { return (this.grid[r - 1] || [])[c - 1] ?? ''; }
  set(r, c, v) { (this.grid[r - 1] ||= [])[c - 1] = v; }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    if (r + nr - 1 > sh.maxRows) throw new Error(`range beyond sheet: ${r + nr - 1} > ${sh.maxRows}`);
    return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
        const v = sh.cell(r + i, c + j);
        return typeof v === 'string' && v.startsWith('=') ? '' : v; // формулы «считаются» в пустоту
      })),
      setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => sh.set(r + i, c + j, v))),
      getValue: () => sh.cell(r, c),
      setValue: (v) => sh.set(r, c, v),
      setFormula: (f) => sh.set(r, c, f),
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.set(r + i, c + j, ''); },
    };
  }
  rows() { return this.grid.slice(1).filter((r) => r && r.some((v) => v !== '' && v !== undefined && !(typeof v === 'string' && v.startsWith('=')))); }
}
const book = {
  'Товары': new FakeSheet('Товары', ['Артикул', 'Название', 'Категория', 'Ед.', 'Цена', 'Себест.', 'Мин.', 'Остаток', '', '', '', '', '', 'На сайте', 'Описание']),
  'Движения': new FakeSheet('Движения', ['Дата', 'Артикул', 'Товар', 'Операция', 'Кол-во', 'Изм.', 'Комментарий', 'Сотрудник', 'служ.']),
  'Заказы': new FakeSheet('Заказы', ['№', 'Дата', 'Клиент', 'Телефон', 'Доставка', 'Адрес', 'Состав', 'Сумма', 'Статус', 'Менеджер', 'Комментарий'], 10),
};
// «Старые» данные из шаблона — должны стереться полной выгрузкой
book['Товары'].set(2, 1, 'OLD-1'); book['Товары'].set(2, 2, 'Пример');
book['Движения'].set(2, 1, new Date(2026, 0, 1)); book['Движения'].set(2, 2, 'OLD-1');

const SECRET = 'test-secret-0123456789-abcdefgh';
const ctx = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => book[n] || null, getSheets: () => Object.values(book), getSpreadsheetTimeZone: () => '' }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType() { return this; }, text: t }) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheets', 'Code.gs'), 'utf8').replace("'ВСТАВЬТЕ_СЮДА_SHEETS_SECRET'", `'${SECRET}'`), ctx);

let calls = 0;
const gas = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    calls++;
    // Как настоящий Apps Script: POST отвечает редиректом, ответ забирается GET-ом
    if (req.method === 'POST') {
      gas.lastOut = ctx.doPost({ postData: { contents: b } }).text;
      res.writeHead(302, { Location: '/echo' }); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(gas.lastOut);
  });
});

let base, srv, db, sheets;
before(async () => {
  await new Promise((r) => gas.listen(0, r));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shulfish-sheets-'));
  process.env.SEED_DEMO = '1';
  process.env.TRANSLATE_URL = 'off';
process.env.GEOCODER_URL = 'off';
  process.env.ADMIN_PASSWORD = 'admin-test-pass';
  process.env.MANAGER_PASSWORD = 'manager-test-pass';
  process.env.SHEETS_WEBAPP_URL = `http://127.0.0.1:${gas.address().port}/exec`;
  process.env.SHEETS_SECRET = SECRET;
  ({ server: srv, db, sheets } = require('../server.js'));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { sheets.stop(); await new Promise((r) => srv.close(r)); await new Promise((r) => gas.close(r)); });

let cookie = '';
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json() };
}
const row = (sheet, sku) => book[sheet].grid.findIndex((r, i) => i > 0 && r && r[0] === sku) + 1;
const siteStock = (sku) => db.prepare('SELECT stock FROM products WHERE sku = ?').get(sku)?.stock;

test('до первой выгрузки инкрементальная синхронизация запрещена', async () => {
  await api('POST', '/api/auth/login', { email: 'admin@shul.fish', password: 'admin-test-pass' });
  const s = await api('GET', '/api/sheets/status');
  assert.equal(s.data.configured, true);
  assert.equal(s.data.initialized, false);
  const r = await api('POST', '/api/sheets/sync', {});
  assert.equal(r.status, 502);
  assert.match(r.data.error, /полную выгрузку/);
});

test('неверный секрет отклоняется скриптом', async () => {
  const out = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'pull', secret: 'wrong' }) } }).text);
  assert.deepEqual(out, { ok: false, error: 'unauthorized' });
});

test('полная выгрузка: товары, движения, заказы попадают в таблицу', async () => {
  // заказ на сайте до выгрузки
  const o = await api('POST', '/api/orders', { customer_name: 'Иван', phone: '+48600100200', address: 'Marszałkowska 1', consent: true, items: [{ product_id: 1, qty: 1 }] });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const r = await api('POST', '/api/sheets/sync', { full: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const P = book['Товары'], M = book['Движения'], O = book['Заказы'];
  assert.equal(row('Товары', 'OLD-1'), 0, 'старые данные стёрты');
  assert.equal(P.rows().length, 16);
  assert.deepEqual(P.grid[row('Товары', 'SF-001') - 1].slice(0, 7), ['SF-001', 'Скумбрия горячего копчения', 'Копчёная рыба', 'кг', 69, 41, 5]);
  assert.match(P.cell(2, 8), /^=ARRAYFORMULA/, 'формулы восстановлены');
  assert.equal(M.rows().length, 17, '16 начальных приходов + продажа');
  const sale = M.rows().find((x) => x[3] === 'Продажа');
  assert.equal(sale[1], 'SF-001'); assert.equal(sale[4], 1); assert.ok(sale[9] > 0, 'у строки есть ID сайта');
  assert.equal(M.cell(1, 10), 'ID сайта');
  assert.equal(O.rows().length, 1);
  assert.equal(O.cell(2, 1), o.data.order.id);
  assert.match(O.cell(2, 7), /Скумбрия/);
  assert.equal(O.cell(2, 9), 'Новый');
  const st = (await api('GET', '/api/sheets/status')).data;
  assert.equal(st.initialized, true);
  assert.deepEqual(st.pending, { products: 0, movements: 0, orders: 0 });
});

test('сайт → таблица: смена статуса, новый товар, приход', async () => {
  const id = book['Заказы'].cell(2, 1);
  await api('PUT', `/api/orders/${id}/status`, { status: 'confirmed' });
  const np = await api('POST', '/api/products', { name: 'Сельдь пряного посола', category: 'cured', unit: 'кг', price: 45, cost: 25, initial_stock: 7 });
  assert.equal(np.status, 200);
  assert.equal(np.data.product.sku, 'SF-017', 'артикул сгенерирован');
  await sheets.syncNow();
  assert.equal(book['Заказы'].cell(2, 9), 'Подтверждён');
  assert.equal(book['Заказы'].cell(2, 10), 'Администратор');
  assert.equal(book['Заказы'].rows().length, 1, 'заказ обновлён, а не продублирован');
  assert.ok(row('Товары', 'SF-017') > 0);
  assert.ok(book['Движения'].rows().some((x) => x[1] === 'SF-017' && x[3] === 'Приход' && x[4] === 7));
});

test('таблица → сайт: правка цены и описания, новый товар', async () => {
  const P = book['Товары'];
  const r = row('Товары', 'SF-002');
  P.set(r, 5, 42.5); P.set(r, 15, 'Новое описание из таблицы');
  const nr = P.rows().length + 2;
  P.getRange(nr, 1, 1, 7).setValues([['SF-100', 'Икра щуки', 'Икра', 'банка', 49, 30, 2]]);
  P.set(nr, 14, 'Да');
  await sheets.syncNow();
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get('SF-002');
  assert.equal(p.price, 4250);
  assert.equal(p.description, 'Новое описание из таблицы');
  const n = db.prepare('SELECT * FROM products WHERE sku = ?').get('SF-100');
  assert.equal(n.name, 'Икра щуки'); assert.equal(n.category, 'caviar'); assert.equal(n.stock, 0);
  // повторная синхронизация ничего не меняет и не дублирует
  const before = P.rows().length;
  await sheets.syncNow();
  assert.equal(P.rows().length, before);
});

test('таблица → сайт: ручные движения проводятся один раз, ошибки помечаются', async () => {
  const M = book['Движения'];
  const start = M.rows().length + 2;
  M.getRange(start, 1, 3, 2).setValues([[new Date(2026, 10, 3), 'SF-003'], ['03.11.2026', 'SF-004'], [new Date(2026, 10, 3), 'NOPE']]);
  M.getRange(start, 4, 3, 2).setValues([['Приход', 5], ['Списание', 1000], ['Приход', 1]]);
  M.getRange(start, 7, 3, 2).setValues([['Поставка 7/11', 'Ольга'], ['Брак', ''], ['', '']]);
  const before = siteStock('SF-003');
  await sheets.syncNow();
  assert.equal(siteStock('SF-003'), before + 5);
  assert.ok(Number(M.cell(start, 10)) > 0, 'проведённой строке проставлен ID');
  assert.match(String(M.cell(start + 1, 10)), /^⚠ Недостаточно/);
  assert.match(String(M.cell(start + 2, 10)), /^⚠ нет товара/);
  const mv = db.prepare("SELECT * FROM stock_movements WHERE source = 'sheet'").all();
  assert.equal(mv.length, 1);
  assert.equal(mv[0].created_at, '2026-11-03 12:00:00');
  assert.match(mv[0].note, /Поставка 7\/11 · сотрудник: Ольга/);
  // повтор — не дублирует
  await sheets.syncNow();
  assert.equal(siteStock('SF-003'), before + 5);
  const st = (await api('GET', '/api/sheets/status')).data;
  assert.equal(st.warnings.length, 0, 'старые ⚠ строки больше не берутся');
});

test('сбой после проведения не приводит к дублю', async () => {
  const M = book['Движения'];
  const r = M.rows().length + 2;
  M.getRange(r, 1, 1, 2).setValues([[new Date(2026, 10, 3), 'SF-005']]);
  M.getRange(r, 4, 1, 2).setValues([['Приход', 2]]);
  const before = siteStock('SF-005');
  // «теряем» ответ на запись отметки: подменяем push на ошибку один раз
  const orig = ctx.handle_;
  let failed = false;
  ctx.handle_ = (req, ss) => { if (req.action === 'push' && !failed) { failed = true; throw new Error('сеть упала'); } return orig(req, ss); };
  await assert.rejects(sheets.syncNow(), /сеть упала/);
  assert.equal(siteStock('SF-005'), before + 2, 'проведено один раз');
  assert.equal(M.cell(r, 10), '', 'отметка не записалась');
  ctx.handle_ = orig;
  await sheets.syncNow();
  assert.equal(siteStock('SF-005'), before + 2, 'повтор не задвоил приход');
  assert.ok(Number(M.cell(r, 10)) > 0);
});

test('польские колонки синхронизируются в обе стороны', async () => {
  const P = book['Товары'];
  const r = row('Товары', 'SF-001');
  assert.equal(P.cell(1, 16), 'Название (PL)');
  assert.equal(P.cell(r, 16), 'Makrela wędzona na gorąco', 'сайт → таблица');
  P.set(r, 17, 'Opis z arkusza');
  await sheets.syncNow();
  assert.equal(db.prepare('SELECT description_pl FROM products WHERE sku = ?').get('SF-001').description_pl, 'Opis z arkusza', 'таблица → сайт');
});

test('пустые польские колонки (старая таблица) не затирают польский текст сайта', async () => {
  const P = book['Товары'];
  const r = row('Товары', 'SF-002');
  const before = db.prepare('SELECT name_pl FROM products WHERE sku = ?').get('SF-002').name_pl;
  assert.ok(before);
  // как будто колонок P/Q ещё не было, а цену при этом поменяли в таблице
  P.set(r, 16, ''); P.set(r, 17, ''); P.set(r, 5, 44);
  await sheets.syncNow();
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get('SF-002');
  assert.equal(p.price, 4400, 'цена из таблицы применилась');
  assert.equal(p.name_pl, before, 'польское название сохранилось');
  assert.equal(P.cell(r, 16), before, 'и вернулось в таблицу');
  await sheets.syncNow();
  assert.equal(P.cell(r, 16), before, 'стабильно');
});

test('удалённый на сайте товар не возвращается из таблицы', async () => {
  const id = db.prepare('SELECT id FROM products WHERE sku = ?').get('SF-100').id;
  assert.equal((await api('DELETE', `/api/products/${id}`)).status, 200);
  await sheets.syncNow();
  const r = row('Товары', 'SF-100');
  assert.match(book['Товары'].cell(r, 2), /^\[удалён\]/);
  assert.equal(book['Товары'].cell(r, 14), 'Нет');
  await sheets.syncNow();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM products WHERE sku = ?').get('SF-100').c, 0);
});

test('остатки сайта и таблицы совпадают', () => {
  // считаем остаток таблицы так же, как формула SUMIF по колонке «Изменение остатка»
  const sign = (op, q) => (['Приход', 'Возврат', 'Корректировка'].includes(op) ? q : -Math.abs(q));
  const sums = {};
  for (const r of book['Движения'].rows()) {
    if (String(r[9]).startsWith('⚠') || !r[1]) continue;
    sums[r[1]] = (sums[r[1]] || 0) + sign(r[3], r[4]);
  }
  for (const p of db.prepare('SELECT sku, stock FROM products').all()) {
    assert.equal(Math.round((sums[p.sku] || 0) * 1000) / 1000, p.stock, `остаток ${p.sku}`);
  }
});

test('статус доступен только админу', async () => {
  const m = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'manager@shul.fish', password: 'manager-test-pass' }) });
  const mc = m.headers.get('set-cookie').split(';')[0];
  const r = await fetch(base + '/api/sheets/status', { headers: { Cookie: mc } });
  assert.equal(r.status, 403);
  const s = (await api('GET', '/api/sheets/status')).data;
  assert.ok(!JSON.stringify(s).includes(SECRET), 'секрет не утекает');
  assert.ok(calls > 0);
});
