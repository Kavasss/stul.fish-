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
const HOST = process.env.HOST || undefined; // 127.0.0.1 — только за nginx/Caddy
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 14;
const MAX_BODY = 8 * 1024 * 1024;        // только для загрузки фото
const MAX_JSON_BODY = 64 * 1024;         // все остальные запросы
const MAX_PASSWORD = 256;
const MAX_GUEST_QTY = 100;               // максимум упаковок одной позиции в заказе покупателя

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'shop.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/* ------------------------------------------------------------------ */
/* Справочники                                                          */
/* ------------------------------------------------------------------ */
const CATEGORIES = {
  fresh: 'Свежая рыба',
  smoked: 'Копчёная рыба',
  cured: 'Вяленая рыба',
  dried: 'Сушёная рыба',
  salted: 'Малосольная продукция',
  caviar: 'Икра',
  seafood: 'Морепродукты',
  frozen: 'Замороженная продукция',
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
// Зона курьерской доставки: радиус DELIVERY_RADIUS_KM от Bazaru Trocka (Targówek).
// Город выбирается из списка, точное расстояние проверяется по адресу (геокодер OpenStreetMap).
const DELIVERY_AREAS = {
  warszawa: 'Warszawa',
  zabki: 'Ząbki',
  marki: 'Marki',
  zielonka: 'Zielonka',
};
const DELIVERY_RADIUS_KM = Number(process.env.DELIVERY_RADIUS_KM) || 7;
// Стоимость доставки: за каждый начатый километр по прямой от центра зоны (грош)
const DELIVERY_PRICE_PER_KM = Math.round((Number(process.env.DELIVERY_PRICE_PER_KM) || 2) * 100);
const DELIVERY_MIN_FEE = Math.round((Number(process.env.DELIVERY_MIN_FEE) || 10) * 100); // минимальная стоимость доставки
const deliveryFee = (km) => Math.max(DELIVERY_MIN_FEE, Math.max(1, Math.ceil(km)) * DELIVERY_PRICE_PER_KM);
const DELIVERY_CENTER = (process.env.DELIVERY_CENTER || '52.2765,21.0560').split(',').map(Number); // Bazar Trocka
// GEOCODER_URL=off — не проверять расстояние (тесты, нет интернета)
const GEOCODER_URL = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
function distanceKm([lat1, lon1], [lat2, lon2]) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
// Не чаще 1 запроса в секунду (правила Nominatim), результаты кэшируются
const geoCache = new Map();
let geoQueue = Promise.resolve();
function geocode(street, city) {
  if (GEOCODER_URL === 'off') return Promise.resolve(null);
  const key = `${street}|${city}`.toLowerCase();
  if (geoCache.has(key)) return Promise.resolve(geoCache.get(key));
  const run = geoQueue.then(async () => {
    const url = `${GEOCODER_URL}?format=json&limit=1&countrycodes=pl&street=${encodeURIComponent(street)}&city=${encodeURIComponent(city)}` +
      // ищем только вокруг Варшавы, иначе «Zielonka» находится в другом конце Польши
      `&viewbox=${DELIVERY_CENTER[1] - 0.4},${DELIVERY_CENTER[0] + 0.25},${DELIVERY_CENTER[1] + 0.4},${DELIVERY_CENTER[0] - 0.25}&bounded=1`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'SHUL.FISH shop (shulfish.pl)', 'Accept-Language': 'pl' }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const d = await res.json();
      const hit = Array.isArray(d) && d[0] ? [Number(d[0].lat), Number(d[0].lon)] : null;
      if (hit && hit.every(Number.isFinite)) {
        if (geoCache.size > 2000) geoCache.clear();
        geoCache.set(key, hit);
        return hit;
      }
      return null;
    } catch { return null; }
  });
  geoQueue = run.then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}
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
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS deleted_skus (sku TEXT PRIMARY KEY, pushed INTEGER NOT NULL DEFAULT 0);
`);

// Миграции для баз, созданных старыми версиями
function addColumn(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('products', 'sheet_hash', 'TEXT');
addColumn('stock_movements', 'product_sku', "TEXT NOT NULL DEFAULT ''");
addColumn('stock_movements', 'source', "TEXT NOT NULL DEFAULT 'site'");
addColumn('stock_movements', 'sheet_synced', 'INTEGER NOT NULL DEFAULT 0');
addColumn('stock_movements', 'sheet_key', 'TEXT');
addColumn('orders', 'manager_name', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'sheet_ver', 'INTEGER NOT NULL DEFAULT 1');
addColumn('orders', 'sheet_pushed_ver', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'consent_at', 'TEXT');
addColumn('users', 'consent_at', 'TEXT');
addColumn('products', 'name_pl', "TEXT NOT NULL DEFAULT ''");
addColumn('products', 'description_pl', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'lang', "TEXT NOT NULL DEFAULT 'ru'");
addColumn('orders', 'distance_km', 'REAL');
addColumn('orders', 'total_final', 'INTEGER'); // сумма по фактическому весу (грош), задаёт менеджер
addColumn('orders', 'delivery_fee', 'INTEGER'); // стоимость доставки (грош); NULL — не рассчитана, уточнит менеджер
addColumn('order_items', 'name_pl', "TEXT NOT NULL DEFAULT ''");
// Поштучная продажа по цене за кг: piece_weight — примерный вес 1 шт., кг. NULL — обычный товар (цена за единицу).
addColumn('products', 'piece_weight', 'REAL');
// Автоперевод на польский: последний автоматический перевод и русский текст, из которого он сделан.
// Если польское поле совпадает с автопереводом — его можно обновлять при смене русского текста;
// если поле правили вручную — не трогаем.
addColumn('products', 'name_pl_auto', "TEXT NOT NULL DEFAULT ''");
addColumn('products', 'name_pl_src', "TEXT NOT NULL DEFAULT ''");
addColumn('products', 'description_pl_auto', "TEXT NOT NULL DEFAULT ''");
addColumn('products', 'description_pl_src', "TEXT NOT NULL DEFAULT ''");
addColumn('order_items', 'piece_weight', 'REAL');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_sheet_key ON stock_movements(sheet_key) WHERE sheet_key IS NOT NULL;
UPDATE stock_movements SET product_sku = COALESCE((SELECT sku FROM products WHERE products.id = stock_movements.product_id), '') WHERE product_sku = '';`);

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
    // Никаких паролей по умолчанию: либо из переменных окружения, либо случайные.
    const gen = () => crypto.randomBytes(12).toString('base64url');
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@shul.fish';
    const adminPw = process.env.ADMIN_PASSWORD || gen();
    const managerPw = process.env.MANAGER_PASSWORD || gen();
    if (adminPw.length < 8 || managerPw.length < 8) throw new Error('ADMIN_PASSWORD и MANAGER_PASSWORD должны быть не короче 8 символов');
    db.prepare('INSERT INTO users (email,name,role,password_hash,permissions) VALUES (?,?,?,?,?)')
      .run(adminEmail, 'Администратор', 'admin', hashPassword(adminPw), '[]');
    db.prepare('INSERT INTO users (email,name,role,password_hash,permissions) VALUES (?,?,?,?,?)')
      .run('manager@shul.fish', 'Менеджер', 'manager', hashPassword(managerPw), JSON.stringify(DEFAULT_MANAGER_PERMS));
    if (!process.env.ADMIN_PASSWORD || !process.env.MANAGER_PASSWORD) {
      // Файл доступен только владельцу и лежит вне публичной папки
      const credFile = path.join(DATA_DIR, 'FIRST-LOGIN.txt');
      fs.writeFileSync(credFile,
        `Первый вход в SHUL.FISH. Смените пароли в кабинете и удалите этот файл.\n\n` +
        `Администратор: ${adminEmail} / ${process.env.ADMIN_PASSWORD ? '(задан через ADMIN_PASSWORD)' : adminPw}\n` +
        `Менеджер:      manager@shul.fish / ${process.env.MANAGER_PASSWORD ? '(задан через MANAGER_PASSWORD)' : managerPw}\n`,
        { mode: 0o600 });
      console.log(`Созданы учётные записи сотрудников. Пароли записаны в ${credFile}`);
    }
  }
  // Демо-каталог — только для разработки и тестов (SEED_DEMO=1). Рабочий магазин стартует с пустым каталогом.
  if (process.env.SEED_DEMO === '1' && !db.prepare('SELECT 1 FROM products LIMIT 1').get()) {
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
// У каждого товара должен быть уникальный артикул — по нему товар связывается с Google Таблицей
function uniqueSku(base, exceptId = 0) {
  let sku = base, n = 1;
  while (db.prepare('SELECT 1 FROM products WHERE sku = ? AND id != ?').get(sku, exceptId)) sku = `${base}-${++n}`;
  return sku;
}
for (const p of db.prepare("SELECT id, sku FROM products ORDER BY id").all()) {
  const want = p.sku ? uniqueSku(p.sku, p.id) : uniqueSku(`SF-${String(p.id).padStart(3, '0')}`, p.id);
  if (want !== p.sku) db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(want, p.id);
}
db.exec(`UPDATE stock_movements SET product_sku = COALESCE((SELECT sku FROM products WHERE products.id = stock_movements.product_id), '') WHERE product_sku = ''`);

const SEED_PL = {
  'SF-001': ['Makrela wędzona na gorąco', 'Makrela atlantycka wędzona na zrębkach olchowych. Soczysta, ze złocistą skórką.'],
  'SF-002': ['Łosoś wędzony na zimno', 'Filet z łososia norweskiego, lekko solony, wędzony na zimno. Plastry 200 g.'],
  'SF-003': ['Leszcz wędzony na gorąco', 'Duży leszcz wędzony w całości. Zwarte mięso i intensywny aromat.'],
  'SF-004': ['Omul wędzony', 'Bajkalska receptura: delikatne solenie i łagodny dym.'],
  'SF-005': ['Wobła suszona', 'Klasyczna wobła z ikrą. Idealna do piwa.'],
  'SF-006': ['Taranka suszona', 'Płoć azowska suszona naturalnie na świeżym powietrzu.'],
  'SF-007': ['Ciosa suszona', 'Tłusta ciosa — cienka i przejrzysta pod światło.'],
  'SF-008': ['Leszcz suszony', 'Duży suszony leszcz o bursztynowym mięsie.'],
  'SF-009': ['Stynka suszona', 'Chrupiąca stynka o świeżym, ogórkowym aromacie.'],
  'SF-010': ['Sardela suszona', 'Drobna sardela — przekąska, od której trudno się oderwać.'],
  'SF-011': ['Kałamarnica suszona (wiórki)', 'Cienkie wiórki z kałamarnicy pacyficznej.'],
  'SF-012': ['Ikra z gorbuszy (czerwona)', 'Ziarnista ikra z gorbuszy, 1. gatunek. Słoik 250 g.'],
  'SF-013': ['Ikra z kety (czerwona)', 'Duże bursztynowe ziarno, łagodny smak. Słoik 250 g.'],
  'SF-014': ['Kawior jesiotrowy (czarny)', 'Kawior z jesiotra z hodowli, lekko solony. Słoik 50 g.'],
  'SF-015': ['Zestaw „Do piwa”', 'Wobła, stynka, kałamarnica i sardela — wszystko na wieczór z przyjaciółmi.'],
  'SF-016': ['Zestaw prezentowy „Kawiorowy”', 'Czerwona ikra i czarny kawior w eleganckim opakowaniu prezentowym z kartką.'],
};
// Польские тексты демо-каталога — только для демо (SEED_DEMO=1). Раньше они подставлялись по артикулу
// и на рабочем сайте: новые товары с теми же артикулами SF-0xx получали чужие польские названия.
if (process.env.SEED_DEMO === '1') {
  for (const [sku, [n, d]] of Object.entries(SEED_PL)) {
    db.prepare("UPDATE products SET name_pl = ?, description_pl = ? WHERE sku = ? AND name_pl = '' AND description_pl = ''").run(n, d, sku);
  }
}

/*
 * Каталог v2: вся продукция фасуется по 1 кг.
 * Стартовые товары переводятся на цену за 1 кг, только если их не меняли в админке
 * (единица и цена совпадают с исходными). Ручные правки не трогаем.
 */
const CATALOG_1KG = {
  //        старые: единица, цена(гр)  →  новые: цена, себестоимость (zł), мин. остаток, описание RU, описание PL, [название RU, название PL]
  'SF-002': ['уп', 3900, 179, 110, 5, 'Филе норвежского лосося, слабосолёное, холодного копчения. Нарезка в вакуумной упаковке 1 кг.', 'Filet z łososia norweskiego, lekko solony, wędzony na zimno. Plastry w opakowaniu próżniowym 1 kg.'],
  'SF-011': ['уп', 2500, 159, 85, 3, 'Тонкая стружка тихоокеанского кальмара. Упаковка 1 кг.', 'Cienkie wiórki z kałamarnicy pacyficznej. Opakowanie 1 kg.'],
  'SF-012': ['банка', 8900, 349, 230, 3, 'Зернистая икра горбуши, 1 сорт. Упаковка 1 кг.', 'Ziarnista ikra z gorbuszy, 1. gatunek. Opakowanie 1 kg.'],
  'SF-013': ['банка', 10900, 429, 280, 2, 'Крупное янтарное зерно, мягкий вкус. Упаковка 1 кг.', 'Duże bursztynowe ziarno, łagodny smak. Opakowanie 1 kg.'],
  'SF-014': ['банка', 18900, 3690, 2450, 1, 'Аквакультурная осетровая икра, малосольная. Упаковка 1 кг.', 'Kawior z jesiotra z hodowli, lekko solony. Opakowanie 1 kg.'],
  'SF-015': ['шт', 12900, 109, 65, 3, 'Вобла, корюшка, кальмар и анчоус — ассорти в упаковке 1 кг.', 'Wobła, stynka, kałamarnica i sardela — mix w opakowaniu 1 kg.'],
  'SF-016': ['шт', 29900, 389, 255, 2, 'Красная икра горбуши и кеты по 500 г — всего 1 кг, в подарочной упаковке.', 'Ikra z gorbuszy i kety po 500 g — razem 1 kg, w opakowaniu prezentowym.', 'Набор «Икорный» (1 кг)', 'Zestaw „Ikrowy” (1 kg)'],
};
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'catalog_1kg'").get()) {
  tx(() => {
    for (const [sku, [oldUnit, oldPrice, price, cost, minStock, desc, descPl, name, namePl]] of Object.entries(CATALOG_1KG)) {
      const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
      if (!p || p.unit !== oldUnit || p.price !== oldPrice) continue; // товар уже меняли вручную
      db.prepare(`UPDATE products SET unit = 'кг', price = ?, cost = ?, min_stock = ?, description = ?, description_pl = ?,
        name = COALESCE(?, name), name_pl = COALESCE(?, name_pl), updated_at = datetime('now') WHERE id = ?`)
        .run(price * 100, cost * 100, minStock, desc, descPl, name || null, namePl || null, p.id);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('catalog_1kg', ?)").run(new Date().toISOString());
  });
}

/*
 * Однократная очистка каталога: удаляются все стартовые/демо-товары и их фото.
 * История склада и заказы сохраняются (в них записаны название и артикул).
 * Выполняется один раз; новые товары, добавленные после этого, не трогаются.
 */
if (process.env.SEED_DEMO !== '1' && !db.prepare("SELECT 1 FROM settings WHERE key = 'catalog_cleared_v1'").get()) {
  const imgs = db.prepare('SELECT filename FROM product_images').all();
  const prods = db.prepare('SELECT id, sku, name FROM products').all();
  tx(() => {
    for (const p of prods) if (p.sku) db.prepare('INSERT OR REPLACE INTO deleted_skus (sku, pushed) VALUES (?, 0)').run(p.sku);
    db.prepare('DELETE FROM product_images').run();
    db.prepare('DELETE FROM products').run();
    if (prods.length) audit({ id: null, name: 'Система', role: 'auto' }, 'Каталог очищен', `Удалено товаров: ${prods.length}`);
    db.prepare("INSERT INTO settings (key, value) VALUES ('catalog_cleared_v1', ?)").run(new Date().toISOString());
  });
  for (const i of imgs) fs.rm(path.join(UPLOAD_DIR, i.filename), { force: true }, () => {});
}

/*
 * Однократно: единый вид артикулов SF-NNN. Товары с артикулом другого вида (SH1, DS1 …)
 * получают SF-<номер товара>. Старый артикул помечается удалённым для Google Таблицы,
 * история склада переписывается на новый артикул. Артикулы, заданные позже, не трогаются.
 */
// Приём заказов: settings.orders_paused = '1' — заказы не принимаются. Включается/выключается администратором.
// На рабочем сайте при первом запуске этой версии приём ставится на паузу (по просьбе владельца).
if (process.env.SEED_DEMO !== '1' && !db.prepare("SELECT 1 FROM settings WHERE key = 'orders_pause_init_v1'").get()) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('orders_paused', '1')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('orders_pause_init_v1', ?)").run(new Date().toISOString());
}
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'mackerel_piece_v1'").get()) {
  const p = db.prepare("SELECT * FROM products WHERE sku = 'SF-001'").get();
  if (p && p.unit === 'шт' && p.piece_weight == null) {
    db.prepare("UPDATE products SET piece_weight = 0.5, updated_at = datetime('now') WHERE id = ?").run(p.id);
    audit({ id: null, name: 'Система', role: 'auto' }, 'Поштучная продажа', `#${p.id} ${p.name}: цена за кг, ≈0,5 кг/шт`);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('mackerel_piece_v1', ?)").run(new Date().toISOString());
}
// v2: на рабочем сайте у скумбрии единицу успели сменить на «кг» — v1 её пропустил.
// Скумбрия продаётся поштучно: единица «шт», вес 1 шт. ≈ 0,5 кг, цена остаётся за 1 кг.
if (process.env.SEED_DEMO !== '1' && !db.prepare("SELECT 1 FROM settings WHERE key = 'mackerel_piece_v2'").get()) {
  const p = db.prepare("SELECT * FROM products WHERE sku = 'SF-001'").get();
  if (p && p.piece_weight == null) {
    db.prepare("UPDATE products SET piece_weight = 0.5, unit = 'шт', updated_at = datetime('now') WHERE id = ?").run(p.id);
    audit({ id: null, name: 'Система', role: 'auto' }, 'Поштучная продажа', `#${p.id} ${p.name}: единица ${p.unit} → шт, цена за кг, ≈0,5 кг/шт (остаток ${p.stock} — проверьте, что это штуки)`);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('mackerel_piece_v2', ?)").run(new Date().toISOString());
}
const ordersPaused = () => db.prepare("SELECT value FROM settings WHERE key = 'orders_paused'").get()?.value === '1';

if (!db.prepare("SELECT 1 FROM settings WHERE key = 'sku_unify_v1'").get()) {
  tx(() => {
    const renamed = [];
    for (const p of db.prepare('SELECT id, sku FROM products ORDER BY id').all()) {
      if (/^SF-\d{3,}(-\d+)?$/.test(p.sku || '')) continue;
      const sku = uniqueSku(`SF-${String(p.id).padStart(3, '0')}`, p.id);
      db.prepare("UPDATE products SET sku = ?, updated_at = datetime('now') WHERE id = ?").run(sku, p.id);
      db.prepare('UPDATE stock_movements SET product_sku = ? WHERE product_id = ?').run(sku, p.id);
      if (p.sku) db.prepare('INSERT OR REPLACE INTO deleted_skus (sku, pushed) VALUES (?, 0)').run(p.sku);
      renamed.push(`${p.sku || '—'} → ${sku}`);
    }
    if (renamed.length) audit({ id: null, name: 'Система', role: 'auto' }, 'Единые артикулы', renamed.join(', '));
    db.prepare("INSERT INTO settings (key, value) VALUES ('sku_unify_v1', ?)").run(new Date().toISOString());
  });
}

/*
 * Стоковые фото товаров: public/img/products/<АРТИКУЛ>.jpg (+ <АРТИКУЛ>_2.jpg, <АРТИКУЛ>_3.jpg …).
 * Подключаются к товару один раз и только если у товара ещё нет ни одного фото —
 * загруженные вручную фото не трогаем, удалённые вручную обратно не появятся.
 */
function importStockPhotos() {
  const dir = process.env.STOCK_PHOTOS_DIR || path.join(PUBLIC_DIR, 'img', 'products');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => /^[A-Za-z0-9_-]+\.(jpe?g|png|webp)$/i.test(f)).sort();
  const bySku = {};
  for (const f of files) {
    const m = /^([A-Za-z0-9-]+?)(?:_(\d+))?\.(jpe?g|png|webp)$/i.exec(f); // SF-002.jpg, SF-002_2.jpg
    if (!m) continue;
    (bySku[m[1].toUpperCase()] ||= []).push({ f, n: Number(m[2] || 1), ext: m[3].toLowerCase() === 'jpeg' ? 'jpg' : m[3].toLowerCase() });
  }
  for (const [sku, list] of Object.entries(bySku)) {
    const key = `stock_photos:${sku}`;
    if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key)) continue;
    const p = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku);
    if (!p) continue;
    if (!db.prepare('SELECT 1 FROM product_images WHERE product_id = ?').get(p.id)) {
      list.sort((a, b) => a.n - b.n).forEach((it, i) => {
        const name = `p${p.id}-${crypto.randomBytes(8).toString('hex')}.${it.ext}`;
        fs.copyFileSync(path.join(dir, it.f), path.join(UPLOAD_DIR, name));
        db.prepare('INSERT INTO product_images (product_id, filename, sort) VALUES (?,?,?)').run(p.id, name, i);
      });
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, new Date().toISOString());
  }
}

// Предупреждение, если в старой базе остались известные пароли из первой версии
const KNOWN_WEAK = ['admin12345', 'manager12345'];
function weakStaffAccounts() {
  return db.prepare("SELECT * FROM users WHERE role IN ('admin','manager') AND active = 1").all()
    .filter((u) => KNOWN_WEAK.some((pw) => verifyPassword(pw, u.password_hash)))
    .map((u) => u.email);
}
let WEAK_ACCOUNTS = weakStaffAccounts();
if (WEAK_ACCOUNTS.length) console.warn(`⚠ ВНИМАНИЕ: у ${WEAK_ACCOUNTS.join(', ')} стоит общеизвестный пароль. Смените его немедленно!`);

/* ------------------------------------------------------------------ */
/* Сессии и запросы                                                     */
/* ------------------------------------------------------------------ */
// В базе храним только хэш токена: утечка файла БД не даёт войти под чужой сессией.
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* битая cookie */ }
    }
  }
  return out;
}
function getUser(req) {
  const token = parseCookies(req).sid;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`).get(tokenHash(token), Date.now());
  return row || null;
}
const isHttps = (req) => process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
function cookieAttrs(req) {
  return `HttpOnly; Path=/; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;
}
function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)')
    .run(tokenHash(token), userId, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  res.setHeader('Set-Cookie', `sid=${token}; ${cookieAttrs(req)}; Max-Age=${SESSION_DAYS * 86400}`);
  return token;
}
function readBody(req, limit = MAX_JSON_BODY) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) { reject(new HttpError(413, 'Слишком большой запрос')); req.resume(); return; }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); return; }
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

// Ограничение частоты: перебор паролей, массовая регистрация, фейковые заказы
const rateBuckets = new Map();
function rateLimit(kind, key, max, windowMs, message) {
  const now = Date.now();
  const id = `${kind}:${key}`;
  const rec = rateBuckets.get(id) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n++;
  rateBuckets.set(id, rec);
  if (rec.n > max) throw new HttpError(429, message);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now - v.t > 3600e3) rateBuckets.delete(k);
}, 600e3).unref();
// Берём ПОСЛЕДНИЙ адрес из X-Forwarded-For — его дописал наш прокси (Caddy).
// Первые адреса присылает сам клиент, и подделать их может кто угодно.
const clientIp = (req) => (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean).pop()) || req.socket.remoteAddress || '';
// Одинаковое время ответа для существующего и несуществующего e-mail
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

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
    description: p.description, name_pl: p.name_pl, description_pl: p.description_pl, price: p.price / 100, unit: p.unit,
    in_stock: p.stock > 0, featured: !!p.featured, badge: p.badge, piece_weight: p.piece_weight ?? null,
    images: imgs[p.id] || [],
  };
  // Точные остатки, видимость и даты изменения — только сотрудникам
  if (seesStock(user)) {
    out.stock = p.stock;
    out.active = !!p.active;
    out.updated_at = p.updated_at;
    out.name_pl_auto = p.name_pl_auto; out.description_pl_auto = p.description_pl_auto;
  }
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
function seesStock(user) {
  return can(user, 'inventory.view') || can(user, 'stock.manage') || can(user, 'products.edit');
}
function applyMovement(product, type, qty, note, user, orderId = null, extra = {}) {
  const balance = round3(product.stock + qty);
  if (balance < 0) {
    // Покупателю не раскрываем точный остаток склада
    throw new HttpError(409, seesStock(user) || extra.source === 'sheet'
      ? `Недостаточно товара «${product.name}» на складе (остаток ${product.stock} ${product.unit})`
      : `Товара «${product.name}» нет в таком количестве. Уменьшите количество или свяжитесь с нами.`);
  }
  db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").run(balance, product.id);
  const r = db.prepare(`INSERT INTO stock_movements (product_id,product_name,product_sku,type,qty,balance_after,unit_cost,note,user_id,order_id,
      created_at,source,sheet_key,sheet_synced) VALUES (?,?,?,?,?,?,?,?,?,?,COALESCE(?, datetime('now')),?,?,?)`)
    .run(product.id, product.name, product.sku || '', type, round3(qty), balance, product.cost, note, user && user.id ? user.id : null, orderId,
      extra.createdAt || null, extra.source || 'site', extra.sheetKey || null, extra.sheetSynced ? 1 : 0);
  product.stock = balance;
  return Number(r.lastInsertRowid);
}

importStockPhotos();
const { createSeo } = require('./seo.js');
const seo = createSeo({ db, CATEGORIES, PUBLIC_DIR, SITE_URL: process.env.SITE_URL });
const { createTranslator, nameByGlossary } = require('./translate.js');
const translator = createTranslator();

/*
 * Однократно на рабочем сайте: убрать демо-переводы, ошибочно подставленные по артикулу,
 * и перевести такие товары заново из их русских названий и описаний.
 * Название — сразу по словарю (или онлайн в фоне), описание — онлайн в фоне.
 */
if (process.env.SEED_DEMO !== '1' && !db.prepare("SELECT 1 FROM settings WHERE key = 'pl_fix_v1'").get()) {
  const wrong = [];
  for (const p of db.prepare('SELECT * FROM products').all()) {
    const seed = SEED_PL[p.sku];
    if (!seed) continue;
    const badName = p.name_pl === seed[0], badDesc = p.description_pl === seed[1];
    if (!badName && !badDesc) continue;
    const name_pl = badName ? (nameByGlossary(p.name) || '') : p.name_pl;
    const description_pl = badDesc ? '' : p.description_pl;
    db.prepare("UPDATE products SET name_pl = ?, description_pl = ?, updated_at = datetime('now') WHERE id = ?").run(name_pl, description_pl, p.id);
    if (badName && name_pl) db.prepare('UPDATE products SET name_pl_auto = ?, name_pl_src = ? WHERE id = ?').run(name_pl, p.name, p.id);
    wrong.push({ id: p.id, name: p.name, needName: badName && !name_pl, needDesc: badDesc && !!p.description });
  }
  if (wrong.length) audit({ id: null, name: 'Система', role: 'auto' }, 'Исправлены польские переводы', wrong.map((w) => `#${w.id} ${w.name}`).join(', '));
  db.prepare("INSERT INTO settings (key, value) VALUES ('pl_fix_v1', ?)").run(new Date().toISOString());
  // онлайн-перевод того, что не покрыл словарь, — в фоне, не задерживая запуск
  (async () => {
    for (const w of wrong) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(w.id);
      if (!p) continue;
      if (w.needName && !p.name_pl) {
        const r = await translator.name(p.name);
        if (r) db.prepare('UPDATE products SET name_pl = ? WHERE id = ? AND name_pl = \'\'').run(r.text.slice(0, 120), p.id);
      }
      if (w.needDesc && !p.description_pl && p.description) {
        const r = await translator.text(p.description);
        if (r) db.prepare('UPDATE products SET description_pl = ? WHERE id = ? AND description_pl = \'\'').run(r.text.slice(0, 3000), p.id);
      }
    }
  })().catch((e) => console.error('Перевод товаров:', e.message));
}
/*
 * Автоматический польский перевод названия и описания товара.
 * Заполняет пустое польское поле и обновляет автоперевод, если сменился русский текст.
 * Ручной польский текст не трогает. Название по словарю — сразу, остальное онлайн — в фоне.
 */
function plNeeds(p, field) {
  const ru = p[field], pl = p[field + '_pl'], auto = p[field + '_pl_auto'], src = p[field + '_pl_src'];
  if (!ru) return false;
  if (!pl) return true;
  return pl === auto && src !== ru; // наш автоперевод устарел
}
function setPl(id, field, text, ru) {
  db.prepare(`UPDATE products SET ${field}_pl = ?, ${field}_pl_auto = ?, ${field}_pl_src = ? WHERE id = ?`).run(text, text, ru, id);
}
const plQueue = new Set();
let plRunning = false;
function autoPl(id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return;
  if (plNeeds(p, 'name')) {
    const g = nameByGlossary(p.name);
    if (g) setPl(id, 'name', g.slice(0, 120), p.name); else plQueue.add(id);
  }
  if (plNeeds(p, 'description')) plQueue.add(id);
  runPlQueue();
}
async function runPlQueue() {
  if (plRunning) return;
  plRunning = true;
  try {
    while (plQueue.size) {
      const id = plQueue.values().next().value;
      plQueue.delete(id);
      for (const field of ['name', 'description']) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!p || !plNeeds(p, field)) continue;
        const r = field === 'name' ? await translator.name(p.name) : await translator.text(p.description);
        const now = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        // за время перевода текст могли поменять — сохраняем, только если исходник тот же
        if (r && now && now[field] === p[field] && plNeeds(now, field)) setPl(id, field, r.text.slice(0, field === 'name' ? 120 : 3000), p[field]);
      }
    }
  } catch (e) { console.error('Автоперевод:', e.message); } finally { plRunning = false; }
}
// При запуске и раз в 15 минут — товары, добавленные через Google Таблицу или без перевода
function sweepPl() {
  try { sweepPlNow(); } catch (e) { if (!/not open/.test(e.message)) console.error('Автоперевод:', e.message); }
}
function sweepPlNow() {
  for (const p of db.prepare("SELECT id FROM products WHERE (name != '' AND name_pl = '') OR (description != '' AND description_pl = '') OR (name_pl = name_pl_auto AND name_pl != '' AND name_pl_src != name) OR (description_pl = description_pl_auto AND description_pl != '' AND description_pl_src != description)").all()) autoPl(p.id);
}
setTimeout(sweepPl, 3000).unref();
setInterval(sweepPl, 15 * 60e3).unref();

const { createSheetsSync } = require('./sheets-sync.js');
const sheets = createSheetsSync({ db, CATEGORIES, UNITS, ORDER_STATUSES, applyMovement, audit, tx });

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

route('GET', '/api/meta', () => ({ orders_paused: ordersPaused(), categories: CATEGORIES, units: UNITS, permissions: PERMISSIONS, admin_only: ADMIN_ONLY, movement_types: MOVEMENT_TYPES, order_statuses: ORDER_STATUSES, delivery_areas: DELIVERY_AREAS, delivery_radius_km: DELIVERY_RADIUS_KM, delivery_price_per_km: DELIVERY_PRICE_PER_KM / 100, default_manager_perms: DEFAULT_MANAGER_PERMS }));
route('GET', '/api/me', ({ user }) => ({ user: publicUser(user) }));

route('POST', '/api/auth/register', ({ body, req, res }) => {
  rateLimit('register', clientIp(req), 10, 3600e3, 'Слишком много регистраций. Попробуйте позже.');
  const email = str(body.email, 120).toLowerCase();
  const name = str(body.name, 80);
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Укажите корректный e-mail');
  if (!name) throw new HttpError(400, 'Укажите имя');
  if (password.length < 8) throw new HttpError(400, 'Пароль должен быть не короче 8 символов');
  if (password.length > MAX_PASSWORD) throw new HttpError(400, `Пароль должен быть не длиннее ${MAX_PASSWORD} символов`);
  if (body.consent !== true) throw new HttpError(400, 'Нужно принять правила магазина и политику конфиденциальности');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Такой e-mail уже зарегистрирован');
  const r = db.prepare("INSERT INTO users (email,name,phone,role,password_hash,consent_at) VALUES (?,?,?,'customer',?,datetime('now'))")
    .run(email, name, str(body.phone, 30), hashPassword(password));
  createSession(req, res, r.lastInsertRowid);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  return { user: publicUser(u) };
});
route('POST', '/api/auth/login', ({ body, res, req }) => {
  const email = str(body.email, 120).toLowerCase();
  const tooMany = 'Слишком много попыток входа. Попробуйте через 15 минут.';
  rateLimit('login-ip', clientIp(req), 20, 15 * 60e3, tooMany);
  // Защита конкретного аккаунта от перебора с разных IP: считаем только неудачные попытки
  const failKey = `login-fail:${email}`;
  const fails = rateBuckets.get(failKey);
  if (fails && Date.now() - fails.t <= 15 * 60e3 && fails.n >= 10) throw new HttpError(429, tooMany);
  const password = String(body.password || '');
  if (password.length > MAX_PASSWORD) throw new HttpError(401, 'Неверный e-mail или пароль');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = verifyPassword(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) {
    try { rateLimit('login-fail', email, Infinity, 15 * 60e3, tooMany); } catch {}
    throw new HttpError(401, 'Неверный e-mail или пароль');
  }
  rateBuckets.delete(failKey);
  if (!u.active) throw new HttpError(403, 'Учётная запись заблокирована');
  createSession(req, res, u.id);
  if (u.role !== 'customer') audit(u, 'Вход в систему');
  return { user: publicUser(u) };
});
route('POST', '/api/auth/logout', ({ req, res }) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash(token));
  res.setHeader('Set-Cookie', `sid=; ${cookieAttrs(req)}; Max-Age=0`);
  return { ok: true };
});
route('PUT', '/api/me', ({ user, body, req, res }) => {
  need(user);
  // Сначала проверяем всё, потом сохраняем — без частичных изменений при ошибке
  if (body.new_password) {
    if (!verifyPassword(String(body.old_password || ''), user.password_hash)) throw new HttpError(400, 'Текущий пароль указан неверно');
    if (String(body.new_password).length < 8) throw new HttpError(400, 'Новый пароль должен быть не короче 8 символов');
    if (String(body.new_password).length > MAX_PASSWORD) throw new HttpError(400, `Пароль должен быть не длиннее ${MAX_PASSWORD} символов`);
  }
  const name = str(body.name, 80) || user.name;
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, str(body.phone, 30), user.id);
  if (body.new_password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.new_password)), user.id);
    // Выходим на всех остальных устройствах, текущую сессию пересоздаём
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    createSession(req, res, user.id);
    WEAK_ACCOUNTS = weakStaffAccounts();
    if (user.role !== 'customer') audit(user, 'Смена собственного пароля');
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
  if (query.get('q')) { where.push('(name LIKE ? OR description LIKE ? OR sku LIKE ? OR name_pl LIKE ? OR description_pl LIKE ?)'); const q = `%${query.get('q')}%`; args.push(q, q, q, q, q); }
  if (query.get('featured') === '1') where.push('featured = 1');
  const byName = query.get('lang') === 'pl' ? "COALESCE(NULLIF(name_pl, ''), name) COLLATE NOCASE" : 'name COLLATE NOCASE';
  const sort = { price_asc: 'price ASC', price_desc: 'price DESC', name: byName }[query.get('sort')] || 'featured DESC, (stock > 0) DESC, id';
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
  if ('sku' in body) {
    f.sku = str(body.sku, 40).toUpperCase();
    if (f.sku && db.prepare('SELECT 1 FROM products WHERE sku = ? AND id != ?').get(f.sku, existing ? existing.id : 0)) {
      throw new HttpError(409, `Артикул ${f.sku} уже занят другим товаром`);
    }
    if (!f.sku) delete f.sku;
  }
  if ('category' in body) { if (!CATEGORIES[body.category]) throw new HttpError(400, 'Неизвестная категория'); f.category = body.category; }
  if ('description' in body) f.description = str(body.description, 3000);
  if ('name_pl' in body) f.name_pl = str(body.name_pl, 120);
  if ('description_pl' in body) f.description_pl = str(body.description_pl, 3000);
  if (body.name_pl_auto === true && f.name_pl) { f.name_pl_auto = f.name_pl; f.name_pl_src = f.name ?? existing?.name ?? ''; }
  if (body.description_pl_auto === true && f.description_pl) { f.description_pl_auto = f.description_pl; f.description_pl_src = f.description ?? existing?.description ?? ''; }
  if ('unit' in body) { if (!UNITS.includes(body.unit)) throw new HttpError(400, 'Неизвестная единица'); f.unit = body.unit; }
  if ('min_stock' in body) f.min_stock = round3(num(body.min_stock, { min: 0, max: 1e6, name: 'минимальный остаток' }));
  if ('piece_weight' in body) {
    const raw = String(body.piece_weight ?? '').trim().replace(',', '.');
    f.piece_weight = raw === '' || Number(raw) === 0 ? null : round3(num(raw, { min: 0.01, max: 50, name: 'вес 1 шт.' }));
  }
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
    if (!f.sku) db.prepare('UPDATE products SET sku = ? WHERE id = ?').run(uniqueSku(`SF-${String(r.lastInsertRowid).padStart(3, '0')}`), r.lastInsertRowid);
    const p = getProductRow(r.lastInsertRowid);
    if (initial > 0) {
      if (!can(user, 'stock.manage')) throw new HttpError(403, 'Нет прав на оприходование');
      applyMovement(p, 'in', initial, 'Начальный остаток', user);
    }
    return p.id;
  });
  audit(user, 'Создан товар', `#${id} ${f.name}`);
  autoPl(id);
  sheets.schedule();
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
    // старый артикул в таблице помечаем удалённым, чтобы он не «воскрес» как новый товар
    if (f.sku && p.sku && f.sku !== p.sku) db.prepare('INSERT OR REPLACE INTO deleted_skus (sku, pushed) VALUES (?, 0)').run(p.sku);
    sheets.schedule();
    autoPl(p.id);
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
  if (p.sku) db.prepare('INSERT OR REPLACE INTO deleted_skus (sku, pushed) VALUES (?, 0)').run(p.sku);
  sheets.schedule();
  return { ok: true };
});

// --- Автоперевод RU → PL для редактора товара ---
route('POST', '/api/translate', async ({ user, body }) => {
  need(user);
  if (!can(user, 'products.edit') && !can(user, 'products.create')) throw new HttpError(403, 'Недостаточно прав');
  rateLimit('translate', user.id, 300, 3600e3, 'Слишком много запросов перевода. Попробуйте позже.');
  const kind = body.kind === 'text' ? 'text' : 'name';
  const text = str(body.text, kind === 'text' ? 3000 : 120);
  if (!text) return { text: '', source: null };
  const r = kind === 'text' ? await translator.text(text) : await translator.name(text);
  if (!r) throw new HttpError(502, 'Не удалось перевести автоматически — впишите польский текст вручную');
  return r;
});

// --- Фото ---
const IMAGE_SIGS = [
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];
route('POST', '/api/products/:id/images', { maxBody: MAX_BODY }, ({ user, params, body }) => {
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
  sheets.schedule();
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
  // Защита от формул в Excel: текст, начинающийся с = + - @, экранируем апострофом
  const esc = (v) => {
    let s = String(v ?? '');
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
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
// Проверка адреса курьерской доставки: город из списка, расстояние и стоимость.
// Если адрес не нашёлся на карте — distance и fee = null (уточнит менеджер).
async function courierQuote(body) {
  const area = DELIVERY_AREAS[body.area || 'warszawa'];
  if (!area) throw new HttpError(400, 'Выберите район доставки из списка');
  const raw = str(body.address, 300);
  if (!raw) throw new HttpError(400, 'Укажите адрес доставки');
  const street = raw.replace(/^\s*(ul\.|ulica|al\.|aleja|os\.|pl\.)\s*/i, '').split(/\s+(?:m\.|lok\.|kv\.|кв\.)/i)[0].replace(/\s*\/\s*\d+\s*$/, '').trim(); // номер квартиры для поиска не нужен
  const point = await geocode(street, area);
  let distance = null;
  if (point) {
    distance = Math.round(distanceKm(DELIVERY_CENTER, point) * 10) / 10;
    if (distance > DELIVERY_RADIUS_KM) {
      throw new HttpError(400, `Адрес примерно в ${distance} км от нас — курьер доставляет в радиусе ${DELIVERY_RADIUS_KM} км от Bazaru Trocka. Выберите самовывоз или позвоните нам.`);
    }
  }
  return { address: `${area}, ${raw}`.slice(0, 340), distance, fee: distance == null ? null : deliveryFee(distance) };
}
route('POST', '/api/delivery/quote', async ({ body, req }) => {
  rateLimit('quote', clientIp(req), 60, 3600e3, 'Слишком много запросов. Попробуйте позже.');
  const q = await courierQuote(body);
  return { distance_km: q.distance, km_billed: q.distance == null ? null : Math.max(1, Math.ceil(q.distance)), fee: q.fee == null ? null : q.fee / 100, price_per_km: DELIVERY_PRICE_PER_KM / 100, min_fee: DELIVERY_MIN_FEE / 100 };
});
route('POST', '/api/orders', async ({ user, body, req }) => {
  // Не даём боту «выкупить» склад фейковыми заказами
  if (!seesStock(user)) rateLimit('order', clientIp(req), 10, 3600e3, 'Слишком много заказов подряд. Позвоните нам, и мы оформим заказ вручную.');
  if (ordersPaused()) throw new HttpError(503, 'Приём заказов временно приостановлен. Пожалуйста, загляните позже или позвоните нам.');
  if (body.consent !== true) throw new HttpError(400, 'Нужно принять правила магазина и политику конфиденциальности');
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (!items.length) throw new HttpError(400, 'Корзина пуста');
  const name = str(body.customer_name, 80);
  const phone = str(body.phone, 30);
  if (!name || !/^[+\d][\d\s()-]{6,}$/.test(phone)) throw new HttpError(400, 'Укажите имя и корректный телефон');
  const delivery = body.delivery === 'pickup' ? 'pickup' : 'courier';
  // Курьер: проверка радиуса и стоимость доставки. Адрес не нашёлся — заказ принимаем, менеджер уточнит.
  let address = '', distance = null, fee = 0;
  if (delivery === 'courier') ({ address, distance, fee } = await courierQuote(body));
  const orderId = tx(() => {
    const r = db.prepare("INSERT INTO orders (user_id,customer_name,phone,email,address,delivery,comment,lang,consent_at,distance_km,delivery_fee) VALUES (?,?,?,?,?,?,?,?,datetime('now'),?,?)")
      .run(user ? user.id : null, name, phone, str(body.email, 120), address, delivery, str(body.comment, 1000), body.lang === 'pl' ? 'pl' : 'ru', distance, fee);
    const oid = Number(r.lastInsertRowid);
    let total = 0;
    for (const it of items) {
      const p = getProductRow(it.product_id);
      // Скрытый товар выглядит для покупателя так же, как несуществующий — название не раскрываем
      if (!p.active) throw new HttpError(404, 'Товар не найден');
      // Вся продукция продаётся упаковками по 1 кг (или поштучно) — только целое количество
      const qty = round3(num(it.qty, { min: 1, max: 1000, name: 'количество' }));
      if (!Number.isInteger(qty)) throw new HttpError(400, `Количество «${p.name}» — только целое число упаковок`);
      if (!seesStock(user) && qty > MAX_GUEST_QTY) throw new HttpError(400, `Количество «${p.name}» — не больше ${MAX_GUEST_QTY}. Для оптового заказа позвоните нам.`);
      applyMovement(p, 'sale', -qty, `Заказ №${oid}`, user, oid);
      db.prepare('INSERT INTO order_items (order_id,product_id,name,name_pl,unit,price,qty,piece_weight) VALUES (?,?,?,?,?,?,?,?)').run(oid, p.id, p.name, p.name_pl || '', p.unit, p.price, qty, p.piece_weight ?? null);
      // поштучно по цене за кг: штуки × примерный вес × цена за кг (точную сумму по весу задаёт менеджер)
      total += Math.round(p.price * qty * (p.piece_weight || 1));
    }
    db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(total, oid);
    return oid;
  });
  sheets.schedule();
  return { order: getOrder(orderId) };
});
function getOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
  if (!o) throw new HttpError(404, 'Заказ не найден');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id).map((i) => ({ ...i, price: i.price / 100 }));
  const fee = o.delivery === 'pickup' ? 0 : o.delivery_fee;
  return { ...o, total: o.total / 100, total_final: o.total_final == null ? null : o.total_final / 100,
    delivery_fee: fee == null ? null : fee / 100, grand_total: ((o.total_final ?? o.total) + (fee || 0)) / 100, status_name: ORDER_STATUSES[o.status], items };
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
    db.prepare("UPDATE orders SET status = ?, manager_name = ?, sheet_ver = sheet_ver + 1, updated_at = datetime('now') WHERE id = ?").run(status, user.name, o.id);
    sheets.schedule();
    audit(user, 'Статус заказа', `№${o.id}: ${ORDER_STATUSES[o.status]} → ${ORDER_STATUSES[status]}`);
  });
  return { order: getOrder(params.id) };
});

// Фактическая сумма по весу (упаковки 900–1100 г). Пустое значение — сбросить к предварительной.
route('PUT', '/api/orders/:id/total', ({ user, params, body }) => {
  need(user, 'orders.manage');
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(params.id));
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (o.status === 'cancelled') throw new HttpError(409, 'Заказ отменён');
  const parse = (v, name) => { const s = String(v ?? '').trim().replace(',', '.'); return s === '' ? null : money(s, name); };
  const changes = [];
  if ('total' in body) {
    const total = parse(body.total, 'сумма');
    db.prepare('UPDATE orders SET total_final = ? WHERE id = ?').run(total, o.id);
    changes.push(`товары по весу: ${total == null ? 'сброшено' : total / 100 + ' zł'}`);
  }
  if ('delivery_fee' in body && o.delivery === 'courier') {
    const f = parse(body.delivery_fee, 'стоимость доставки');
    db.prepare('UPDATE orders SET delivery_fee = ? WHERE id = ?').run(f, o.id);
    changes.push(`доставка: ${f == null ? 'не задана' : f / 100 + ' zł'}`);
  }
  db.prepare("UPDATE orders SET sheet_ver = sheet_ver + 1, updated_at = datetime('now') WHERE id = ?").run(o.id);
  sheets.schedule();
  audit(user, 'Сумма заказа', `№${o.id}: ${changes.join(', ')}`);
  return { order: getOrder(o.id) };
});

// --- 10% от суммы чека (только администратор) ---
// Сумма чека = товары (по факт. весу, если задано) + доставка. Отменённые заказы не учитываются.
function percentReport(from, to) {
  const rows = db.prepare(`SELECT * FROM orders WHERE status != 'cancelled'
    AND date(created_at) >= date(?) AND date(created_at) <= date(?) ORDER BY id DESC`).all(from, to).map((o) => {
    const check = (o.total_final ?? o.total) + (o.delivery === 'pickup' ? 0 : o.delivery_fee || 0);
    return { id: o.id, date: o.created_at, status: ORDER_STATUSES[o.status] || o.status, check: check / 100, percent: Math.round(check * 0.1) / 100 };
  });
  const sum = (k) => Math.round(rows.reduce((s, r) => s + r[k] * 100, 0)) / 100;
  return { from, to, rows, totals: { orders: rows.length, check: sum('check'), percent: sum('percent') } };
}
function needAdmin(user) {
  need(user);
  if (user.role !== 'admin') throw new HttpError(403, 'Недостаточно прав');
}
route('PUT', '/api/settings/orders', ({ user, body }) => {
  needAdmin(user);
  const paused = body.paused === true;
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('orders_paused', ?)").run(paused ? '1' : '0');
  audit(user, paused ? 'Приём заказов приостановлен' : 'Приём заказов открыт');
  return { orders_paused: paused };
});
route('GET', '/api/reports/percent', ({ user, query }) => {
  needAdmin(user);
  return percentReport(...periodFromQuery(query));
});
route('GET', '/api/reports/percent.csv', ({ user, query, res }) => {
  needAdmin(user);
  const rep = percentReport(...periodFromQuery(query));
  const num = (n) => String(n).replace('.', ',');
  const lines = ['"Заказ №";"Дата";"Статус";"Сумма чека, zł";"10%, zł"'];
  for (const r of rep.rows) lines.push([r.id, `"${r.date.slice(0, 16)}"`, `"${r.status}"`, num(r.check), num(r.percent)].join(';'));
  lines.push(['"Итого"', '""', `"${rep.totals.orders} заказов"`, num(rep.totals.check), num(rep.totals.percent)].join(';'));
  send(res, 200, '\ufeff' + lines.join('\r\n'), {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="percent-${rep.from}_${rep.to}.csv"`,
  });
  return undefined;
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
  if (String(body.password).length > MAX_PASSWORD) throw new HttpError(400, `Пароль должен быть не длиннее ${MAX_PASSWORD} символов`);
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
    if (String(body.password).length > MAX_PASSWORD) throw new HttpError(400, `Пароль должен быть не длиннее ${MAX_PASSWORD} символов`);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.password)), target.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? ').run(target.id);
    changes.push('пароль сброшен');
    WEAK_ACCOUNTS = weakStaffAccounts();
  }
  if (changes.length) audit(user, 'Изменён пользователь', `${target.email}: ${changes.join(', ')}`);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) };
});

// --- Журнал и сводка ---
// Право на удаление данных (RODO, ст. 17). Заказы остаются для бухгалтерии, но отвязываются от аккаунта.
route('POST', '/api/me/delete', ({ user, body, req, res }) => {
  need(user);
  if (user.role !== 'customer') throw new HttpError(400, 'Учётную запись сотрудника удаляет администратор');
  if (!verifyPassword(String(body.password || ''), user.password_hash)) throw new HttpError(400, 'Пароль указан неверно');
  tx(() => {
    db.prepare('UPDATE orders SET user_id = NULL WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  });
  res.setHeader('Set-Cookie', `sid=; ${cookieAttrs(req)}; Max-Age=0`);
  return { ok: true };
});

// --- Google Таблица ---
route('GET', '/api/sheets/status', ({ user }) => {
  need(user, 'users.manage');
  return sheets.status();
});
route('POST', '/api/sheets/sync', async ({ user, body }) => {
  need(user, 'users.manage');
  if (!sheets.configured) throw new HttpError(400, 'Связь не настроена: задайте SHEETS_WEBAPP_URL и SHEETS_SECRET на сервере');
  try {
    const r = await sheets.syncNow({ full: body.full === true });
    audit(user, body.full ? 'Полная выгрузка в Google Таблицу' : 'Синхронизация с Google Таблицей', r.warnings.length ? `предупреждений: ${r.warnings.length}` : '');
    return { ok: true, warnings: r.warnings, status: sheets.status() };
  } catch (e) {
    throw new HttpError(502, e.message);
  }
});

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
  if (user.role === 'admin' && WEAK_ACCOUNTS.length) {
    out.weak_passwords = WEAK_ACCOUNTS;
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
function serveStatic(req, res, pathname, query) {
  let base = PUBLIC_DIR;
  let rel = pathname;
  if (pathname.startsWith('/uploads/')) {
    base = UPLOAD_DIR;
    rel = pathname.slice('/uploads/'.length);
    // В папке загрузок отдаём только файлы с именем, которое генерирует сервер
    if (!/^p\d+-[a-f0-9]{16}\.(jpg|png|webp)$/.test(rel)) return send(res, 404, { error: 'Не найдено' });
  }
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return send(res, 400, { error: 'Некорректный адрес' }); }
  if (decoded.includes('\0')) return send(res, 400, { error: 'Некорректный адрес' });
  const file = path.normalize(path.join(base, decoded));
  if (!file.startsWith(base + path.sep) && file !== base) return send(res, 403, { error: 'Forbidden' });
  // Скрытые файлы (.env, .git и т.п.) не отдаём
  if (path.relative(base, file).split(path.sep).some((seg) => seg.startsWith('.'))) return send(res, 404, { error: 'Не найдено' });
  fs.stat(file, (err, st) => {
    let target = file;
    if (err || st.isDirectory() || file === path.join(PUBLIC_DIR, 'index.html')) {
      if (base === UPLOAD_DIR) return send(res, 404, { error: 'Не найдено' });
      // Страница приложения: index.html с заголовком, описанием и canonical именно этой страницы
      const page = seo.renderPage(pathname === '/index.html' ? '/' : pathname, query);
      res.writeHead(page.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : page.html);
    }
    const ext = path.extname(target).toLowerCase();
    // Служебные файлы (README.md и т.п.) наружу не отдаём — только известные типы
    if (!MIME[ext]) return send(res, 404, { error: 'Не найдено' });
    res.writeHead(200, {
      'Content-Type': MIME[ext],
      'Cache-Control': base === UPLOAD_DIR ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(target);
    stream.on('error', () => { if (!res.headersSent) send(res, 500, { error: 'Ошибка чтения' }); else res.destroy(); });
    stream.pipe(res);
  });
}

// Защитные заголовки для всех ответов
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
function securityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
// Изменяющие запросы принимаем только с нашего же сайта (защита от CSRF)
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return; // запросы не из браузера (curl, тесты) cookie чужого пользователя не несут
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Запрос с чужого сайта отклонён'); }
  const allowed = [req.headers.host, ...String(process.env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)];
  if (!allowed.includes(host)) throw new HttpError(403, 'Запрос с чужого сайта отклонён');
}

const server = http.createServer(async (req, res) => {
  securityHeaders(req, res);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: 'Некорректный адрес' }); }
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    if (pathname === '/sitemap.xml') return send(res, 200, seo.sitemap(), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    if (pathname === '/robots.txt') return send(res, 200, seo.robots(), { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    try { return serveStatic(req, res, pathname, url.searchParams); } catch (e) { console.error(e); return send(res, 500, { error: 'Внутренняя ошибка сервера' }); }
  }
  try {
    const r = routes.find((rt) => rt.method === req.method && rt.re.test(pathname));
    if (!r) throw new HttpError(404, 'Метод API не найден');
    if (req.method !== 'GET') checkOrigin(req);
    if ((req.method === 'POST' || req.method === 'PUT') && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'Ожидается application/json');
    }
    const m = r.re.exec(pathname);
    let params;
    try { params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); }
    catch { throw new HttpError(400, 'Некорректный адрес'); }
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req, r.maxBody || MAX_JSON_BODY);
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
  server.listen(PORT, HOST, () => {
    console.log(`SHUL.FISH запущен: http://localhost:${PORT}`);
    if (sheets.configured) { sheets.start(); console.log('Связь с Google Таблицей включена'); }
  });
}
module.exports = { server, db, sheets };
