'use strict';
/*
 * Двусторонняя синхронизация сайта с Google Таблицей «складской учёт»
 * через веб-приложение Google Apps Script (google-sheets/Code.gs).
 *
 *  Сайт → Таблица: товары, все движения склада, заказы.
 *  Таблица → Сайт: правки товаров (цены, названия, описания, «На сайте»),
 *                  новые товары и строки движений, внесённые в таблицу вручную.
 */
const crypto = require('node:crypto');

const OP_LABEL = { in: 'Приход', out: 'Расход', writeoff: 'Списание', adjust: 'Корректировка', sale: 'Продажа', return: 'Возврат' };
const OP_TYPE = Object.assign(Object.create(null), Object.fromEntries(Object.entries(OP_LABEL).map(([k, v]) => [v.toLowerCase(), k])));
const CHUNK = { products: 300, movements: 500, orders: 300 };

function createSheetsSync({ db, CATEGORIES, UNITS, ORDER_STATUSES, applyMovement, audit, tx, log = console }) {
  const URL_ = process.env.SHEETS_WEBAPP_URL || '';
  const SECRET = process.env.SHEETS_SECRET || '';
  const INTERVAL = Math.max(30, Number(process.env.SHEETS_SYNC_INTERVAL) || 120) * 1000;
  const configured = Boolean(URL_ && SECRET);
  const CAT_BY_LABEL = Object.assign(Object.create(null), Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [v.toLowerCase(), k])));
  const SHEET_USER = { id: null, name: 'Google Таблица', role: 'sheet' };

  const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;
  const setSetting = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v === null ? null : String(v));

  if (configured && SECRET.length < 24) log.warn('⚠ SHEETS_SECRET слишком короткий — используйте не меньше 24 случайных символов');

  /* ---------------- вызов Apps Script ---------------- */
  async function call(action, payload = {}) {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, action, secret: SECRET }),
      redirect: 'follow',
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Таблица ответила не JSON (HTTP ${res.status}). Проверьте URL веб-приложения и что доступ открыт «Все».`); }
    if (!data.ok) throw new Error(data.error === 'unauthorized' ? 'Таблица отклонила секрет: SECRET в скрипте и SHEETS_SECRET на сервере не совпадают' : `Ошибка таблицы: ${data.error}`);
    return data;
  }

  /* ---------------- преобразования ---------------- */
  const hashOf = (n) => crypto.createHash('sha1').update(JSON.stringify([n.name, n.category, n.unit, n.price, n.cost, n.min_stock, n.active, n.description, n.name_pl, n.description_pl])).digest('hex');
  const siteNorm = (p) => ({ name: p.name, category: p.category, unit: p.unit, price: p.price, cost: p.cost, min_stock: p.min_stock, active: p.active ? 1 : 0, description: p.description, name_pl: p.name_pl || '', description_pl: p.description_pl || '' });
  function sheetNorm(r) {
    const category = CAT_BY_LABEL[String(r.category).toLowerCase()] || (CATEGORIES[r.category] ? r.category : null);
    if (!r.name) return { error: 'пустое название' };
    if (!category) return { error: `неизвестная категория «${r.category}»` };
    if (!UNITS.includes(r.unit)) return { error: `неизвестная единица «${r.unit}»` };
    if (r.price === null || r.price < 0) return { error: 'некорректная цена' };
    return {
      name: String(r.name).slice(0, 120), category, unit: r.unit,
      price: Math.round(r.price * 100), cost: Math.round(Math.max(0, r.cost || 0) * 100),
      min_stock: Math.max(0, Math.round((r.min_stock || 0) * 1000) / 1000),
      active: String(r.on_site).toLowerCase() === 'нет' ? 0 : 1,
      description: String(r.description || '').slice(0, 3000),
      name_pl: String(r.name_pl || '').slice(0, 120), description_pl: String(r.description_pl || '').slice(0, 3000),
    };
  }
  const productPayload = (p) => ({
    sku: p.sku, name: p.name, category: CATEGORIES[p.category] || p.category, unit: p.unit,
    price: p.price / 100, cost: p.cost / 100, min_stock: p.min_stock, on_site: p.active ? 'Да' : 'Нет', description: p.description,
    name_pl: p.name_pl || '', description_pl: p.description_pl || '',
  });
  const fmtQty = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
  function orderPayload(o) {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id)
      .map((i) => `${i.name} ${fmtQty(i.qty)} ${i.unit} × ${i.price / 100} zł`).join('; ');
    return {
      id: o.id, date: o.created_at.slice(0, 10), customer: o.customer_name, phone: o.phone,
      delivery: o.delivery === 'pickup' ? 'Самовывоз' : 'Курьер', address: o.address, items, total: ((o.total_final ?? o.total) + (o.delivery === 'pickup' ? 0 : o.delivery_fee || 0)) / 100,
      status: ORDER_STATUSES[o.status] || o.status, manager: o.manager_name || '', comment: o.comment,
    };
  }

  /* ---------------- таблица → сайт ---------------- */
  function applySheetProducts(rows, warnings) {
    const seen = new Set();
    const tomb = new Set(db.prepare('SELECT sku FROM deleted_skus').all().map((r) => r.sku));
    for (const r of rows) {
      if (seen.has(r.sku)) { warnings.push(`Товары, строка ${r.row}: артикул ${r.sku} повторяется — учтена первая строка`); continue; }
      seen.add(r.sku);
      if (tomb.has(r.sku)) continue;
      const n = sheetNorm(r);
      const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(r.sku);
      if (n.error) {
        if (!p || p.sheet_hash !== null) warnings.push(`Товары, строка ${r.row} (${r.sku}): ${n.error} — строка пропущена`);
        continue;
      }
      const h = hashOf(n);
      if (!p) {
        const res = db.prepare(`INSERT INTO products (sku,name,category,description,price,cost,unit,min_stock,active,name_pl,description_pl,sheet_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.sku, n.name, n.category, n.description, n.price, n.cost, n.unit, n.min_stock, n.active, n.name_pl, n.description_pl, h);
        audit(SHEET_USER, 'Создан товар из таблицы', `#${res.lastInsertRowid} ${r.sku} ${n.name}`);
        continue;
      }
      if (p.sheet_hash === null || h === p.sheet_hash) continue; // таблица не менялась — сайт отправит свои правки сам
      // Пустые польские колонки (например, в таблице до обновления) не затирают польский текст сайта
      const namePl = n.name_pl || p.name_pl || '';
      const descPl = n.description_pl || p.description_pl || '';
      db.prepare(`UPDATE products SET name=?, category=?, description=?, price=?, cost=?, unit=?, min_stock=?, active=?, name_pl=?, description_pl=?,
        sheet_hash=?, updated_at=datetime('now') WHERE id=?`).run(n.name, n.category, n.description, n.price, n.cost, n.unit, n.min_stock, n.active, namePl, descPl, h, p.id);
      const changed = Object.keys(n).filter((k) => n[k] !== siteNorm(p)[k]);
      audit(SHEET_USER, 'Изменён товар из таблицы', `#${p.id} ${p.sku}: ${changed.join(', ') || 'без изменений'}`);
    }
    return seen;
  }

  function importSheetMovements(rows) {
    const acks = [];
    for (const m of rows) {
      const key = crypto.createHash('sha1').update(`${m.row}|${m.fp}`).digest('hex');
      const existing = db.prepare('SELECT id FROM stock_movements WHERE sheet_key = ?').get(key);
      if (existing) { acks.push({ row: m.row, fp: m.fp, id: existing.id }); continue; }
      try {
        const type = OP_TYPE[String(m.op).toLowerCase()];
        if (!type) throw new Error(`неизвестная операция «${m.op}»`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) throw new Error('некорректная дата');
        if (type !== 'adjust' && !(m.qty > 0)) throw new Error('количество должно быть больше нуля');
        if (type === 'adjust' && m.qty === 0) throw new Error('корректировка на 0');
        const id = tx(() => {
          const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(m.sku);
          if (!p) throw new Error(`нет товара с артикулом ${m.sku} на сайте`);
          const delta = type === 'adjust' ? m.qty : (['in', 'return'].includes(type) ? Math.abs(m.qty) : -Math.abs(m.qty));
          const note = [m.comment, m.employee && `сотрудник: ${m.employee}`, 'из таблицы'].filter(Boolean).join(' · ');
          return applyMovement(p, type, delta, note, null, null, { createdAt: `${m.date} 12:00:00`, source: 'sheet', sheetKey: key, sheetSynced: 1 });
        });
        audit(SHEET_USER, `Склад из таблицы: ${OP_LABEL[type]}`, `${m.sku}: ${m.qty}`);
        acks.push({ row: m.row, fp: m.fp, id });
      } catch (e) {
        acks.push({ row: m.row, fp: m.fp, error: e.message });
      }
    }
    return acks;
  }

  /* ---------------- сайт → таблица ---------------- */
  async function pushPending(seenSkus, acks) {
    let first = true;
    for (let guard = 0; guard < 1000; guard++) {
      const products = db.prepare('SELECT * FROM products ORDER BY id').all()
        .filter((p) => p.sheet_hash !== hashOf(siteNorm(p)) || (seenSkus && !seenSkus.has(p.sku)))
        .slice(0, CHUNK.products);
      const deleted = db.prepare('SELECT sku FROM deleted_skus WHERE pushed = 0').all().map((r) => r.sku);
      const moves = db.prepare(`SELECT m.*, u.name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.sheet_synced = 0 ORDER BY m.id LIMIT ${CHUNK.movements}`).all();
      const orders = db.prepare(`SELECT * FROM orders WHERE sheet_ver > sheet_pushed_ver ORDER BY id LIMIT ${CHUNK.orders}`).all();
      const ackPart = first ? acks : [];
      if (!products.length && !deleted.length && !moves.length && !orders.length && !ackPart.length) break;
      await call('push', {
        products: products.map(productPayload),
        deleted,
        movements: moves.map((m) => ({
          id: m.id, date: m.created_at.slice(0, 10), sku: m.product_sku || '', op: OP_LABEL[m.type] || m.type,
          qty: m.type === 'adjust' ? m.qty : Math.abs(m.qty), comment: m.note,
          employee: m.user_name || (m.type === 'sale' || m.type === 'return' ? 'Сайт' : m.source === 'sheet' ? 'Таблица' : 'Система'),
        })),
        orders: orders.map(orderPayload),
        acks: ackPart,
      });
      tx(() => {
        for (const p of products) db.prepare('UPDATE products SET sheet_hash = ? WHERE id = ?').run(hashOf(siteNorm(p)), p.id);
        for (const s of deleted) db.prepare('UPDATE deleted_skus SET pushed = 1 WHERE sku = ?').run(s);
        for (const m of moves) db.prepare('UPDATE stock_movements SET sheet_synced = 1 WHERE id = ?').run(m.id);
        for (const o of orders) db.prepare('UPDATE orders SET sheet_pushed_ver = ? WHERE id = ?').run(o.sheet_ver, o.id);
      });
      if (seenSkus) for (const p of products) seenSkus.add(p.sku);
      first = false;
    }
  }

  /* ---------------- цикл синхронизации ---------------- */
  let running = null;
  let again = false;
  async function syncNow({ full = false } = {}) {
    if (!configured) throw new Error('Связь с таблицей не настроена: задайте SHEETS_WEBAPP_URL и SHEETS_SECRET');
    if (running) { again = true; return running; }
    running = (async () => {
      await null; // дать присвоиться running до любого раннего выхода — иначе finally сработает раньше
      const warnings = [];
      try {
        if (full) {
          await call('reset');
          tx(() => {
            db.exec(`UPDATE products SET sheet_hash = NULL; UPDATE stock_movements SET sheet_synced = 0;
                     UPDATE orders SET sheet_pushed_ver = 0; UPDATE deleted_skus SET pushed = 1;`);
          });
          await pushPending(null, []);
          setSetting('initialized', '1');
        } else {
          if (getSetting('initialized') !== '1') throw new Error('Сначала сделайте полную выгрузку сайта в таблицу');
          const snap = await call('pull');
          const seen = tx(() => applySheetProducts(snap.products || [], warnings));
          const acks = importSheetMovements(snap.movements || []);
          for (const a of acks) if (a.error) warnings.push(`Движения, строка ${a.row}: ${a.error} — строка помечена ⚠, исправьте её и очистите колонку «ID сайта»`);
          await pushPending(seen, acks);
        }
        setSetting('last_sync_at', new Date().toISOString());
        setSetting('last_error', null);
        setSetting('last_warnings', JSON.stringify(warnings.slice(0, 50)));
        return { ok: true, warnings };
      } catch (e) {
        setSetting('last_error', e.message);
        setSetting('last_error_at', new Date().toISOString());
        log.error('Синхронизация с таблицей:', e.message);
        throw e;
      } finally {
        running = null;
        if (again) { again = false; schedule(); }
      }
    })();
    return running;
  }

  let timer = null;
  function schedule(delay = 3000) {
    if (!configured || getSetting('initialized') !== '1') return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow().catch(() => {}), delay);
    timer.unref?.();
  }
  let interval = null;
  function start() {
    if (!configured || interval) return;
    interval = setInterval(() => { if (getSetting('initialized') === '1') syncNow().catch(() => {}); }, INTERVAL);
    interval.unref?.();
  }
  function stop() { clearInterval(interval); clearTimeout(timer); interval = null; }

  function status() {
    let warnings = [];
    try { warnings = JSON.parse(getSetting('last_warnings') || '[]'); } catch { /* пусто */ }
    const pendingProducts = configured ? db.prepare('SELECT * FROM products').all().filter((p) => p.sheet_hash !== hashOf(siteNorm(p))).length : 0;
    return {
      configured,
      webapp_host: URL_ ? (() => { try { return new URL(URL_).host; } catch { return 'некорректный URL'; } })() : null,
      initialized: getSetting('initialized') === '1',
      syncing: Boolean(running),
      interval_sec: INTERVAL / 1000,
      last_sync_at: getSetting('last_sync_at'),
      last_error: getSetting('last_error'),
      last_error_at: getSetting('last_error_at'),
      warnings,
      pending: {
        products: pendingProducts,
        movements: db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE sheet_synced = 0').get().c,
        orders: db.prepare('SELECT COUNT(*) c FROM orders WHERE sheet_ver > sheet_pushed_ver').get().c,
      },
    };
  }

  return { configured, syncNow, schedule, start, stop, status };
}

module.exports = { createSheetsSync, OP_LABEL };
