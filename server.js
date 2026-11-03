'use strict';
/*
 * SHUL.FISH — интернет-магазин копчёной, вяленой, сушёной рыбы и икры.
 * Сервер без внешних зависимостей: node:http + node:sqlite (Node.js >= 22.13).
 */
process.removeAllListeners('warning');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 14;
const MAX_BODY = 8 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'shop.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/* ------------------------------------------------------------------ */
/* Справочники                                                          */
/* ------------------------------------------------------------------ */
const CATEGORIES = {
  smoked: 'Копчёная рыба',
  cured: 'Вяленая рыба',
  dried: 'Сушёная рыба',
  caviar: 'Икра',
  sets: 'Наборы',
};
const UNITS = ['кг', 'шт', 'банка', 'уп'];

// Все права в системе. Админ имеет их всегда.
const PERMISSIONS = {
  'products.create': 'Создание товаров',
  'products.edit': 'Редактирование описаний и наличия',
  'products.price': 'Изменение цен и себестоимости',
  'products.delete': 'Удаление товаров',
  'photos.manage': 'Загрузка и удаление фото',
  'stock.manage': 'Приход / расход / списание',
  'orders.manage': 'Обработка заказов',
  'inventory.view': 'Просмотр складского учёта',
  'log.view': 'Журнал действий',
  'users.manage': 'Управление пользователями',
};
const ADMIN_ONLY = ['users.manage'];
const DEFAULT_MANAGER_PERMS = ['products.edit', 'photos.manage', 'stock.manage', 'orders.manage', 'inventory.view'];

const MOVEMENT_TYPES = {
  in: 'Приход',
  out: 'Расход',
  writeoff: 'Списание',
  adjust: 'Инвентаризация',
  sale: 'Продажа',
  return: 'Возврат',
};
const ORDER_STATUSES = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  assembling: 'Собирается',
  delivering: 'В доставке',
  done: 'Выполнен',
  cancelled: 'Отменён',
};

/* ------------------------------------------------------------------ */
/* Схема БД                                                             */
/* ------------------------------------------------------------------ */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','customer')),
  permissions TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,   -- в грошах (1 zł = 100)
  cost INTEGER NOT NULL DEFAULT 0,    -- себестоимость, в грошах
  unit TEXT NOT NULL DEFAULT 'кг',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  badge TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  type TEXT NOT NULL,
  qty REAL NOT NULL,             -- со знаком: + приход, - расход
  balance_after REAL NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  delivery TEXT NOT NULL DEFAULT 'courier',
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mov_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
`);

/* ------------------------------------------------------------------ */
/* Утилиты                                                              */
/* ------------------------------------------------------------------ */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const round3 = (n) => Math.round(n * 1000) / 1000;
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
function num(v, { min = -Infinity, max = Infinity, name = 'значение' } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Некорректное ${name}`);
  return n;
}
const money = (zl, name) => Math.round(num(zl, { min: 0, max: 1e6, name }) * 100);

function userPerms(u) {
  if (!u) return [];
  if (u.role === 'admin') return Object.keys(PERMISSIONS);
  if (u.role === 'manager') {
    try { return JSON.parse(u.permissions).filter((p) => PERMISSIONS[p] && !ADMIN_ONLY.includes(p)); }
    catch { return []; }
  }
  return [];
}
const can = (u, perm) => userPerms(u).includes(perm);
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, permissions: userPerms(u), active: !!u.active, created_at: u.created_at };
}
function audit(user, action, details = '') {
  db.prepare('INSERT INTO audit_log (user_id, user_name, action, details) VALUES (?,?,?,?)')
    .run(user ? user.id : null, user ? `${user.name} (${user.role})` : 'гость', action, String(details).slice(0, 1000));
}

/* ------------------------------------------------------------------ */
/* Начальные данные                                                     */
/* ------------------------------------------------------------------ */
function seed() {
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const adminPw = process.env.ADMIN_PASSWORD || 'admin12345';
    const managerPw = process.env.MANAGER_PASSWORD || 'manager12345';
    db.prepare('INSERT INTO users (email,name,role,password_hash,permissions) VALUES (?,?,?,?,?)')
      .run(process.env.ADMIN_EMAIL || 'admin@shul.fish', 'Администратор', 'admin', hashPassword(adminPw), '[]');
    db.prepare('INSERT INTO users (email,name,role,password_hash,permissions) VALUES (?,?,?,?,?)')
      .run('manager@shul.fish', 'Менеджер', 'manager', hashPassword(managerPw), JSON.stringify(DEFAULT_MANAGER_PERMS));
    console.log('Созданы учётные записи: admin@shul.fish и manager@shul.fish (смените пароли в админке!)');
  }
  if (!db.prepare('SELECT 1 FROM products LIMIT 1').get()) {
    const items = [
      ['SF-001', 'Скумбрия горячего копчения', 'smoked', 'Атлантическая скумбрия, копчённая на ольховой щепе. Сочная, с золотистой корочкой.', 69, 41, 'кг', 18, 5, 1, 'ХИТ'],
      ['SF-002', 'Лосось холодного копчения', 'smoked', 'Филе норвежского лосося, слабосолёное, холодного копчения. Нарезка 200 г.', 39, 24, 'уп', 30, 8, 1, ''],
      ['SF-003', 'Лещ горячего копчения', 'smoked', 'Крупный лещ, коптится целиком. Плотное мясо и насыщенный аромат.', 59, 34, 'кг', 9, 4, 0, ''],
      ['SF-004', 'Омуль копчёный', 'smoked', 'Байкальский рецепт: лёгкий посол и мягкий дымок.', 89, 55, 'кг', 4, 3, 0, 'NEW'],
      ['SF-005', 'Вобла вяленая', 'cured', 'Классическая вобла с икрой. Идеальна к пиву.', 79, 46, 'кг', 22, 6, 1, 'ХИТ'],
      ['SF-006', 'Тарань вяленая', 'cured', 'Азовская тарань, естественная сушка на свежем воздухе.', 75, 44, 'кг', 14, 5, 0, ''],
      ['SF-007', 'Чехонь вяленая', 'cured', 'Жирная чехонь, тонкая и прозрачная на просвет.', 72, 40, 'кг', 3, 5, 0, ''],
      ['SF-008', 'Лещ вяленый', 'cured', 'Крупный вяленый лещ, мясо янтарного цвета.', 68, 38, 'кг', 11, 4, 0, ''],
      ['SF-009', 'Корюшка сушёная', 'dried', 'Хрустящая корюшка со свежим огуречным ароматом.', 99, 60, 'кг', 7, 3, 1, ''],
      ['SF-010', 'Анчоус сушёный', 'dried', 'Мелкий анчоус — снек, который невозможно остановить.', 85, 48, 'кг', 12, 3, 0, ''],
      ['SF-011', 'Кальмар сушёный (стружка)', 'dried', 'Тонкая стружка тихоокеанского кальмара.', 25, 13, 'уп', 40, 10, 0, ''],
      ['SF-012', 'Икра горбуши красная', 'caviar', 'Зернистая икра горбуши, 1 сорт. Банка 250 г.', 89, 58, 'банка', 25, 6, 1, 'PREMIUM'],
      ['SF-013', 'Икра кеты красная', 'caviar', 'Крупное янтарное зерно, мягкий вкус. Банка 250 г.', 109, 70, 'банка', 12, 4, 0, ''],
      ['SF-014', 'Икра осетровая чёрная', 'caviar', 'Аквакультурная осетровая икра, малосольная. Банка 50 г.', 189, 125, 'банка', 6, 3, 1, 'PREMIUM'],
      ['SF-015', 'Набор «К пиву»', 'sets', 'Вобла, корюшка, кальмар и анчоус — всё для вечера с друзьями.', 129, 78, 'шт', 10, 3, 0, 'SET'],
      ['SF-016', 'Подарочный набор «Икорный»', 'sets', 'Красная и чёрная икра в подарочной упаковке с открыткой.', 299, 196, 'шт', 5, 2, 1, 'GIFT'],
    ];
    const ins = db.prepare('INSERT INTO products (sku,name,category,description,price,cost,unit,stock,min_stock,featured,badge) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const mov = db.prepare("INSERT INTO stock_movements (product_id,product_name,type,qty,balance_after,unit_cost,note) VALUES (?,?,'in',?,?,?,'Начальный остаток')");
    tx(() => {
      for (const it of items) {
        const r = ins.run(it[0], it[1], it[2], it[3], it[4] * 100, it[5] * 100, it[6], it[7], it[8], it[9], it[10]);
        mov.run(r.lastInsertRowid, it[1], it[7], it[7], it[5] * 100);
      }
    });
  }
}
seed();

/* ------------------------------------------------------------------ */
/* Сессии и запросы                                                     */
/* ------------------------------------------------------------------ */
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function getUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`).get(token, Date.now());
  return row || null;
}
function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)')
    .run(token, userId, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' && headers['Content-Type'] ? headers['Content-Type'] : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

// Простая защита от перебора паролей
const loginAttempts = new Map();
function checkRate(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { n: 0, t: now };
  if (now - rec.t > 15 * 60e3) { rec.n = 0; rec.t = now; }
  rec.n++;
  loginAttempts.set(ip, rec);
  if (rec.n > 20) throw new HttpError(429, 'Слишком много попыток входа. Попробуйте через 15 минут.');
}

/* ------------------------------------------------------------------ */
/* Товары                                                               */
/* ------------------------------------------------------------------ */
function imagesFor(ids) {
  if (!ids.length) return {};
  const rows = db.prepare(`SELECT * FROM product_images WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort, id`).all(...ids);
  const map = {};
  for (const r of rows) (map[r.product_id] ||= []).push({ id: r.id, url: `/uploads/${r.filename}` });
  return map;
}
function shapeProduct(p, imgs, user) {
  const out = {
    id: p.id, sku: p.sku, name: p.name, category: p.category, category_name: CATEGORIES[p.category] || p.category,
    description: p.description, price: p.price / 100, unit: p.unit,
    in_stock: p.stock > 0, stock: p.stock, active: !!p.active, featured: !!p.featured, badge: p.badge,
    images: imgs[p.id] || [], updated_at: p.updated_at,
  };
  if (can(user, 'inventory.view') || can(user, 'products.price')) {
    out.cost = p.cost / 100;
    out.min_stock = p.min_stock;
  }
  return out;
}
function getProductRow(id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id));
  if (!p) throw new HttpError(404, 'Товар не найден');
  return p;
}
function applyMovement(product, type, qty, note, user, orderId = null) {
  const balance = round3(product.stock + qty);
  if (balance < 0) throw new HttpError(409, `Недостаточно товара «${product.name}» на складе (остаток ${product.stock} ${product.unit})`);
  db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").run(balance, product.id);
  db.prepare('INSERT INTO stock_movements (product_id,product_name,type,qty,balance_after,unit_cost,note,user_id,order_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(product.id, product.name, type, round3(qty), balance, product.cost, note, user ? user.id : null, orderId);
  product.stock = balance;
  return balance;
}

/* ------------------------------------------------------------------ */
/* Маршруты API                                                         */
/* ------------------------------------------------------------------ */
const routes = [];
function route(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, ...opts });
}
function need(user, perm) {
  if (!user) throw new HttpError(401, 'Требуется вход');
  if (perm && !can(user, perm)) throw new HttpError(403, 'Недостаточно прав');
}

route('GET', '/api/meta', () => ({ categories: CATEGORIES, units: UNITS, permissions: PERMISSIONS, admin_only: ADMIN_ONLY, movement_types: MOVEMENT_TYPES, order_statuses: ORDER_STATUSES, default_manager_perms: DEFAULT_MANAGER_PERMS }));
route('GET', '/api/me', ({ user }) => ({ user: publicUser(user) }));

route('POST', '/api/auth/register', ({ body, res }) => {
  const email = str(body.email, 120).toLowerCase();
  const name = str(body.name, 80);
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Укажите корректный e-mail');
  if (!name) throw new HttpError(400, 'Укажите имя');
  if (password.length < 8) throw new HttpError(400, 'Пароль должен быть не короче 8 символов');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Такой e-mail уже зарегистрирован');
  const r = db.prepare("INSERT INTO users (email,name,phone,role,password_hash) VALUES (?,?,?,'customer',?)")
    .run(email, name, str(body.phone, 30), hashPassword(password));
  createSession(res, r.lastInsertRowid);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  return { user: publicUser(u) };
});
route('POST', '/api/auth/login', ({ body, res, req }) => {
  checkRate(req.socket.remoteAddress);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(str(body.email, 120).toLowerCase());
  if (!u || !verifyPassword(String(body.password || ''), u.password_hash)) throw new HttpError(401, 'Неверный e-mail или пароль');
  if (!u.active) throw new HttpError(403, 'Учётная запись заблокирована');
  createSession(res, u.id);
  if (u.role !== 'customer') audit(u, 'Вход в систему');
  return { user: publicUser(u) };
});
route('POST', '/api/auth/logout', ({ req, res }) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  return { ok: true };
});
route('PUT', '/api/me', ({ user, body }) => {
  need(user);
  const name = str(body.name, 80) || user.name;
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, str(body.phone, 30), user.id);
  if (body.new_password) {
    if (!verifyPassword(String(body.old_password || ''), user.password_hash)) throw new HttpError(400, 'Текущий пароль указан неверно');
    if (String(body.new_password).length < 8) throw new HttpError(400, 'Новый пароль должен быть не короче 8 символов');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.new_password)), user.id);
  }
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) };
});

// --- Каталог ---
route('GET', '/api/products', ({ user, query }) => {
  const staffView = query.get('all') === '1' && (can(user, 'products.edit') || can(user, 'inventory.view'));
  const where = [];
  const args = [];
  if (!staffView) where.push('active = 1');
  if (query.get('category') && CATEGORIES[query.get('category')]) { where.push('category = ?'); args.push(query.get('category')); }
  if (query.get('q')) { where.push('(name LIKE ? OR description LIKE ? OR sku LIKE ?)'); const q = `%${query.get('q')}%`; args.push(q, q, q); }
  if (query.get('featured') === '1') where.push('featured = 1');
  const sort = { price_asc: 'price ASC', price_desc: 'price DESC', name: 'name COLLATE NOCASE' }[query.get('sort')] || 'featured DESC, (stock > 0) DESC, id';
  const rows = db.prepare(`SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sort}`).all(...args);
  const imgs = imagesFor(rows.map((r) => r.id));
  return { products: rows.map((r) => shapeProduct(r, imgs, user)) };
});
route('GET', '/api/products/:id', ({ user, params }) => {
  const p = getProductRow(params.id);
  if (!p.active && !can(user, 'products.edit')) throw new HttpError(404, 'Товар не найден');
  return { product: shapeProduct(p, imagesFor([p.id]), user) };
});
function productFields(body, user, existing) {
  const f = {};
  if ('name' in body) { f.name = str(body.name, 120); if (!f.name) throw new HttpError(400, 'Укажите название'); }
  if ('sku' in body) f.sku = str(body.sku, 40);
  if ('category' in body) { if (!CATEGORIES[body.category]) throw new HttpError(400, 'Неизвестная категория'); f.category = body.category; }
  if ('description' in body) f.description = str(body.description, 3000);
  if ('unit' in body) { if (!UNITS.includes(body.unit)) throw new HttpError(400, 'Неизвестная единица'); f.unit = body.unit; }
  if ('min_stock' in body) f.min_stock = round3(num(body.min_stock, { min: 0, max: 1e6, name: 'минимальный остаток' }));
  if ('active' in body) f.active = body.active ? 1 : 0;
  if ('featured' in body) f.featured = body.featured ? 1 : 0;
  if ('badge' in body) f.badge = str(body.badge, 16);
  const priceChange = ('price' in body && (!existing || money(body.price, 'цена') !== existing.price)) ||
                      ('cost' in body && (!existing || money(body.cost, 'себестоимость') !== existing.cost));
  if (priceChange) {
    if (!can(user, 'products.price')) throw new HttpError(403, 'Нет прав на изменение цен');
    if ('price' in body) f.price = money(body.price, 'цена');
    if ('cost' in body) f.cost = money(body.cost, 'себестоимость');
  }
  return f;
}
route('POST', '/api/products', ({ user, body }) => {
  need(user, 'products.create');
  const f = productFields(body, user, null);
  if (!f.name || !f.category) throw new HttpError(400, 'Название и категория обязательны');
  const initial = body.initial_stock ? round3(num(body.initial_stock, { min: 0, max: 1e6, name: 'начальный остаток' })) : 0;
  const id = tx(() => {
    const cols = Object.keys(f);
    const r = db.prepare(`INSERT INTO products (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => f[c]));
    const p = getProductRow(r.lastInsertRowid);
    if (initial > 0) {
      if (!can(user, 'stock.manage')) throw new HttpError(403, 'Нет прав на оприходование');
      applyMovement(p, 'in', initial, 'Начальный остаток', user);
    }
    return p.id;
  });
  audit(user, 'Создан товар', `#${id} ${f.name}`);
  return { product: shapeProduct(getProductRow(id), {}, user) };
});
route('PUT', '/api/products/:id', ({ user, params, body }) => {
  need(user, 'products.edit');
  const p = getProductRow(params.id);
  const f = productFields(body, user, p);
  const cols = Object.keys(f);
  if (cols.length) {
    db.prepare(`UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...cols.map((c) => f[c]), p.id);
    const changes = cols.map((c) => (c === 'price' || c === 'cost' ? `${c}: ${p[c] / 100} → ${f[c] / 100} zł` : c)).join(', ');
    audit(user, 'Изменён товар', `#${p.id} ${p.name}: ${changes}`);
  }
  const fresh = getProductRow(p.id);
  return { product: shapeProduct(fresh, imagesFor([p.id]), user) };
});
route('DELETE', '/api/products/:id', ({ user, params }) => {
  need(user, 'products.delete');
  const p = getProductRow(params.id);
  const imgs = db.prepare('SELECT filename FROM product_images WHERE product_id = ?').all(p.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  for (const i of imgs) fs.rm(path.join(UPLOAD_DIR, i.filename), { force: true }, () => {});
  audit(user, 'Удалён товар', `#${p.id} ${p.name} (остаток ${p.stock} ${p.unit})`);
  return { ok: true };
});

// --- Фото ---
const IMAGE_SIGS = [
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];
route('POST', '/api/products/:id/images', ({ user, params, body }) => {
  need(user, 'photos.manage');
  const p = getProductRow(params.id);
  const m = /^data:image\/[a-z+]+;base64,(.+)$/s.exec(String(body.data || ''));
  if (!m) throw new HttpError(400, 'Ожидается изображение в формате data URL');
  const buf = Buffer.from(m[1], 'base64');
  const sig = IMAGE_SIGS.find((s) => s.test(buf));
  if (!sig) throw new HttpError(400, 'Поддерживаются только JPG, PNG и WEBP');
  const filename = `p${p.id}-${crypto.randomBytes(8).toString('hex')}.${sig.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  const sort = (db.prepare('SELECT MAX(sort) m FROM product_images WHERE product_id = ?').get(p.id).m ?? -1) + 1;
  const r = db.prepare('INSERT INTO product_images (product_id, filename, sort) VALUES (?,?,?)').run(p.id, filename, sort);
  audit(user, 'Загружено фото', `#${p.id} ${p.name}`);
  return { image: { id: Number(r.lastInsertRowid), url: `/uploads/${filename}` } };
});
route('DELETE', '/api/images/:id', ({ user, params }) => {
  need(user, 'photos.manage');
  const img = db.prepare('SELECT * FROM product_images WHERE id = ?').get(Number(params.id));
  if (!img) throw new HttpError(404, 'Фото не найдено');
  db.prepare('DELETE FROM product_images WHERE id = ?').run(img.id);
  fs.rm(path.join(UPLOAD_DIR, img.filename), { force: true }, () => {});
  audit(user, 'Удалено фото', `товар #${img.product_id}`);
  return { ok: true };
});
route('PUT', '/api/images/:id/main', ({ user, params }) => {
  need(user, 'photos.manage');
  const img = db.prepare('SELECT * FROM product_images WHERE id = ?').get(Number(params.id));
  if (!img) throw new HttpError(404, 'Фото не найдено');
  const min = db.prepare('SELECT MIN(sort) m FROM product_images WHERE product_id = ?').get(img.product_id).m;
  db.prepare('UPDATE product_images SET sort = ? WHERE id = ?').run(min - 1, img.id);
  return { ok: true };
});

// --- Склад ---
route('POST', '/api/stock/:id', ({ user, params, body }) => {
  need(user, 'stock.manage');
  const type = body.type;
  if (!['in', 'out', 'writeoff', 'adjust'].includes(type)) throw new HttpError(400, 'Неизвестный тип операции');
  const qtyIn = round3(num(body.qty, { min: 0, max: 1e6, name: 'количество' }));
  const note = str(body.note, 300);
  if ((type === 'out' || type === 'writeoff') && !note) throw new HttpError(400, 'Укажите причину расхода/списания');
  const result = tx(() => {
    const p = getProductRow(params.id);
    let delta;
    if (type === 'adjust') delta = round3(qtyIn - p.stock);
    else if (type === 'in') delta = qtyIn;
    else delta = -qtyIn;
    if (type !== 'adjust' && qtyIn === 0) throw new HttpError(400, 'Количество должно быть больше нуля');
    if (type === 'in' && body.unit_cost !== undefined && body.unit_cost !== '' && can(user, 'products.price')) {
      const c = money(body.unit_cost, 'закупочная цена');
      db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(c, p.id);
      p.cost = c;
    }
    applyMovement(p, type, delta, note || (type === 'adjust' ? `Фактический остаток: ${qtyIn}` : ''), user);
    return p;
  });
  audit(user, `Склад: ${MOVEMENT_TYPES[type]}`, `#${result.id} ${result.name}: ${qtyIn} ${result.unit}, остаток ${result.stock}`);
  return { product: shapeProduct(getProductRow(result.id), imagesFor([result.id]), user) };
});
route('GET', '/api/stock/movements', ({ user, query }) => {
  need(user, 'inventory.view');
  const where = [];
  const args = [];
  if (query.get('product_id')) { where.push('m.product_id = ?'); args.push(Number(query.get('product_id'))); }
  if (query.get('type') && MOVEMENT_TYPES[query.get('type')]) { where.push('m.type = ?'); args.push(query.get('type')); }
  if (query.get('from')) { where.push('date(m.created_at) >= date(?)'); args.push(query.get('from')); }
  if (query.get('to')) { where.push('date(m.created_at) <= date(?)'); args.push(query.get('to')); }
  const limit = Math.min(Number(query.get('limit')) || 200, 2000);
  const rows = db.prepare(`SELECT m.*, u.name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ${limit}`).all(...args);
  return { movements: rows.map((r) => ({ ...r, unit_cost: r.unit_cost / 100, type_name: MOVEMENT_TYPES[r.type] || r.type })) };
});
function inventoryReport(from, to) {
  const products = db.prepare('SELECT * FROM products ORDER BY category, name').all();
  const period = db.prepare(`SELECT product_id, type, SUM(qty) q FROM stock_movements
    WHERE date(created_at) >= date(?) AND date(created_at) <= date(?) GROUP BY product_id, type`).all(from, to);
  const per = {};
  for (const r of period) (per[r.product_id] ||= {})[r.type] = r.q;
  let totalCost = 0, totalRetail = 0, low = 0, out = 0;
  const rows = products.map((p) => {
    const pp = per[p.id] || {};
    const costValue = Math.round(p.stock * p.cost) / 100;
    const retailValue = Math.round(p.stock * p.price) / 100;
    totalCost += costValue; totalRetail += retailValue;
    if (p.stock <= 0) out++; else if (p.stock <= p.min_stock) low++;
    return {
      id: p.id, sku: p.sku, name: p.name, category: CATEGORIES[p.category], unit: p.unit, active: !!p.active,
      stock: p.stock, min_stock: p.min_stock, cost: p.cost / 100, price: p.price / 100,
      cost_value: costValue, retail_value: retailValue,
      status: p.stock <= 0 ? 'out' : p.stock <= p.min_stock ? 'low' : 'ok',
      period_in: round3((pp.in || 0) + (pp.return || 0)),
      period_sold: round3(-(pp.sale || 0)),
      period_out: round3(-((pp.out || 0) + (pp.writeoff || 0))),
      period_adjust: round3(pp.adjust || 0),
    };
  });
  const r2 = (n) => Math.round(n * 100) / 100;
  return { from, to, rows, totals: { products: rows.length, cost_value: r2(totalCost), retail_value: r2(totalRetail), margin_value: r2(totalRetail - totalCost), low, out } };
}
function periodFromQuery(query) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  return [valid(query.get('from')) ? query.get('from') : monthAgo, valid(query.get('to')) ? query.get('to') : today];
}
route('GET', '/api/inventory', ({ user, query }) => {
  need(user, 'inventory.view');
  return inventoryReport(...periodFromQuery(query));
});
route('GET', '/api/inventory.csv', ({ user, query, res }) => {
  need(user, 'inventory.view');
  const rep = inventoryReport(...periodFromQuery(query));
  const head = ['Артикул', 'Товар', 'Категория', 'Ед.', 'Остаток', 'Мин. остаток', 'Себестоимость', 'Цена', 'Сумма по себест.', 'Сумма по цене', `Приход ${rep.from}–${rep.to}`, 'Продано', 'Расход/списание', 'Корректировки', 'Статус'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(';')];
  for (const r of rep.rows) {
    lines.push([r.sku, r.name, r.category, r.unit, r.stock, r.min_stock, r.cost, r.price, r.cost_value, r.retail_value, r.period_in, r.period_sold, r.period_out, r.period_adjust,
      { ok: 'В наличии', low: 'Мало', out: 'Нет' }[r.status]].map(esc).join(';'));
  }
  send(res, 200, '﻿' + lines.join('\r\n'), {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="inventory-${rep.to}.csv"`,
  });
  return undefined;
});

// --- Заказы ---
route('POST', '/api/orders', ({ user, body }) => {
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (!items.length) throw new HttpError(400, 'Корзина пуста');
  const name = str(body.customer_name, 80);
  const phone = str(body.phone, 30);
  if (!name || !/^[+\d][\d\s()-]{6,}$/.test(phone)) throw new HttpError(400, 'Укажите имя и корректный телефон');
  const delivery = body.delivery === 'pickup' ? 'pickup' : 'courier';
  const address = str(body.address, 300);
  if (delivery === 'courier' && !address) throw new HttpError(400, 'Укажите адрес доставки по Варшаве');
  const orderId = tx(() => {
    const r = db.prepare('INSERT INTO orders (user_id,customer_name,phone,email,address,delivery,comment) VALUES (?,?,?,?,?,?,?)')
      .run(user ? user.id : null, name, phone, str(body.email, 120), address, delivery, str(body.comment, 1000));
    const oid = Number(r.lastInsertRowid);
    let total = 0;
    for (const it of items) {
      const p = getProductRow(it.product_id);
      if (!p.active) throw new HttpError(409, `Товар «${p.name}» недоступен`);
      const step = p.unit === 'кг' ? 0.5 : 1;
      const qty = round3(num(it.qty, { min: step, max: 1000, name: 'количество' }));
      if (Math.abs(qty / step - Math.round(qty / step)) > 1e-6) throw new HttpError(400, `Количество «${p.name}» должно быть кратно ${step}`);
      applyMovement(p, 'sale', -qty, `Заказ №${oid}`, user, oid);
      db.prepare('INSERT INTO order_items (order_id,product_id,name,unit,price,qty) VALUES (?,?,?,?,?,?)').run(oid, p.id, p.name, p.unit, p.price, qty);
      total += Math.round(p.price * qty);
    }
    db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(total, oid);
    return oid;
  });
  return { order: getOrder(orderId) };
});
function getOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
  if (!o) throw new HttpError(404, 'Заказ не найден');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id).map((i) => ({ ...i, price: i.price / 100 }));
  return { ...o, total: o.total / 100, status_name: ORDER_STATUSES[o.status], items };
}
route('GET', '/api/orders/my', ({ user }) => {
  need(user);
  const ids = db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(user.id);
  return { orders: ids.map((r) => getOrder(r.id)) };
});
route('GET', '/api/orders', ({ user, query }) => {
  need(user, 'orders.manage');
  const st = query.get('status');
  const ids = st && ORDER_STATUSES[st]
    ? db.prepare('SELECT id FROM orders WHERE status = ? ORDER BY id DESC LIMIT 300').all(st)
    : db.prepare('SELECT id FROM orders ORDER BY id DESC LIMIT 300').all();
  return { orders: ids.map((r) => getOrder(r.id)) };
});
route('PUT', '/api/orders/:id/status', ({ user, params, body }) => {
  need(user, 'orders.manage');
  const status = body.status;
  if (!ORDER_STATUSES[status]) throw new HttpError(400, 'Неизвестный статус');
  tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(params.id));
    if (!o) throw new HttpError(404, 'Заказ не найден');
    if (o.status === status) return;
    if (o.status === 'cancelled') throw new HttpError(409, 'Отменённый заказ нельзя вернуть в работу — оформите новый');
    if (status === 'cancelled') {
      // Возвращаем товар на склад
      for (const it of db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id)) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
        if (p) applyMovement(p, 'return', it.qty, `Отмена заказа №${o.id}`, user, o.id);
      }
    }
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, o.id);
    audit(user, 'Статус заказа', `№${o.id}: ${ORDER_STATUSES[o.status]} → ${ORDER_STATUSES[status]}`);
  });
  return { order: getOrder(params.id) };
});

// --- Пользователи ---
route('GET', '/api/users', ({ user }) => {
  need(user, 'users.manage');
  return { users: db.prepare('SELECT * FROM users ORDER BY CASE role WHEN \'admin\' THEN 0 WHEN \'manager\' THEN 1 ELSE 2 END, id').all().map(publicUser) };
});
route('POST', '/api/users', ({ user, body }) => {
  need(user, 'users.manage');
  const email = str(body.email, 120).toLowerCase();
  const role = ['admin', 'manager', 'customer'].includes(body.role) ? body.role : 'manager';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Укажите корректный e-mail');
  if (String(body.password || '').length < 8) throw new HttpError(400, 'Пароль должен быть не короче 8 символов');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Такой e-mail уже существует');
  const perms = Array.isArray(body.permissions) ? body.permissions.filter((p) => PERMISSIONS[p] && !ADMIN_ONLY.includes(p)) : DEFAULT_MANAGER_PERMS;
  const r = db.prepare('INSERT INTO users (email,name,phone,role,password_hash,permissions) VALUES (?,?,?,?,?,?)')
    .run(email, str(body.name, 80) || email, str(body.phone, 30), role, hashPassword(String(body.password)), JSON.stringify(perms));
  audit(user, 'Создан пользователь', `${email} (${role})`);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) };
});
route('PUT', '/api/users/:id', ({ user, params, body }) => {
  need(user, 'users.manage');
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id));
  if (!target) throw new HttpError(404, 'Пользователь не найден');
  const changes = [];
  if (target.id === user.id && ((body.role && body.role !== 'admin') || body.active === false)) {
    throw new HttpError(400, 'Нельзя понизить или заблокировать собственную учётную запись');
  }
  if (body.role && ['admin', 'manager', 'customer'].includes(body.role) && body.role !== target.role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, target.id); changes.push(`роль → ${body.role}`);
  }
  if (Array.isArray(body.permissions)) {
    const perms = body.permissions.filter((p) => PERMISSIONS[p] && !ADMIN_ONLY.includes(p));
    db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(JSON.stringify(perms), target.id); changes.push('права');
  }
  if ('active' in body) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(body.active ? 1 : 0, target.id);
    if (!body.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    changes.push(body.active ? 'разблокирован' : 'заблокирован');
  }
  if ('name' in body && str(body.name, 80)) { db.prepare('UPDATE users SET name = ? WHERE id = ?').run(str(body.name, 80), target.id); changes.push('имя'); }
  if (body.password) {
    if (String(body.password).length < 8) throw new HttpError(400, 'Пароль должен быть не короче 8 символов');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.password)), target.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? ').run(target.id);
    changes.push('пароль сброшен');
  }
  if (changes.length) audit(user, 'Изменён пользователь', `${target.email}: ${changes.join(', ')}`);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) };
});

// --- Журнал и сводка ---
route('GET', '/api/log', ({ user }) => {
  need(user, 'log.view');
  return { log: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').all() };
});
route('GET', '/api/stats', ({ user }) => {
  need(user);
  if (user.role === 'customer') throw new HttpError(403, 'Недостаточно прав');
  const out = {};
  if (can(user, 'orders.manage') || can(user, 'inventory.view')) {
    out.orders_new = db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'new'").get().c;
    out.orders_active = db.prepare("SELECT COUNT(*) c FROM orders WHERE status IN ('new','confirmed','assembling','delivering')").get().c;
  }
  if (can(user, 'inventory.view')) {
    out.revenue_30d = (db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'cancelled' AND created_at >= datetime('now','-30 days')").get().s) / 100;
    out.low_stock = db.prepare('SELECT id, name, stock, min_stock, unit FROM products WHERE stock <= min_stock ORDER BY stock').all();
    out.products = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  }
  return out;
});

/* ------------------------------------------------------------------ */
/* HTTP-сервер                                                          */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  let base = PUBLIC_DIR;
  let rel = pathname;
  if (pathname.startsWith('/uploads/')) { base = UPLOAD_DIR; rel = pathname.slice('/uploads'.length); }
  const file = path.normalize(path.join(base, decodeURIComponent(rel)));
  if (!file.startsWith(base + path.sep) && file !== base) return send(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    let target = file;
    if (err || st.isDirectory()) {
      if (base === UPLOAD_DIR) return send(res, 404, { error: 'Не найдено' });
      target = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': base === UPLOAD_DIR ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, pathname);
  }
  try {
    const r = routes.find((rt) => rt.method === req.method && rt.re.test(pathname));
    if (!r) throw new HttpError(404, 'Метод API не найден');
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json') && req.headers['content-length'] !== '0' && req.method !== 'DELETE') {
      throw new HttpError(415, 'Ожидается application/json');
    }
    const m = r.re.exec(pathname);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
    const user = getUser(req);
    const result = await r.handler({ req, res, user, params, body, query: url.searchParams });
    if (result !== undefined && !res.headersSent) send(res, 200, result);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Внутренняя ошибка сервера' : e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`SHUL.FISH запущен: http://localhost:${PORT}`));
}
module.exports = { server, db };
