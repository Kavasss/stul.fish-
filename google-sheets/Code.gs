/**
 * SHUL.FISH — связь Google Таблицы «складской учёт» с сайтом.
 *
 * Установка (один раз):
 *  1. В таблице: Расширения → Apps Script. Удалите всё и вставьте этот файл целиком.
 *  2. Впишите в SECRET тот же длинный секрет, что в переменной SHEETS_SECRET на сервере.
 *  3. Начать развёртывание → Новое развёртывание → тип «Веб-приложение».
 *     Выполнять от имени: «Я». У кого есть доступ: «Все».
 *  4. Разрешите доступ к таблице и скопируйте URL веб-приложения в SHEETS_WEBAPP_URL на сервере.
 *
 * Без правильного секрета скрипт ничего не отдаёт и не меняет.
 */
var SECRET = 'ВСТАВЬТЕ_СЮДА_SHEETS_SECRET';

var SH = { products: 'Товары', moves: 'Движения', orders: 'Заказы' };
// Колонки (нумерация с 1)
var P = { SKU: 1, NAME: 2, CAT: 3, UNIT: 4, PRICE: 5, COST: 6, MIN: 7, ONSITE: 14, DESC: 15, WIDTH: 15 };
var M = { DATE: 1, SKU: 2, OP: 4, QTY: 5, COMMENT: 7, EMP: 8, ID: 10, WIDTH: 10 };
var O_WIDTH = 11;

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  if (!SECRET || SECRET.indexOf('ВСТАВЬТЕ') === 0 || SECRET.length < 24 || !req || req.secret !== SECRET) {
    return out_({ ok: false, error: 'unauthorized' });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return out_({ ok: false, error: 'busy' });
  try {
    var res = handle_(req, SpreadsheetApp.getActive());
    res.ok = true;
    return out_(res);
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return out_({ ok: false, error: 'use POST' });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req, ss) {
  switch (req.action) {
    case 'ping': return { sheets: ss.getSheets().map(function (s) { return s.getName(); }) };
    case 'pull': return pull_(ss);
    case 'push': return push_(ss, req);
    case 'reset': return reset_(ss);
    default: throw new Error('unknown action');
  }
}

/* ---------------- утилиты ---------------- */
function sheet_(ss, name) {
  var s = ss.getSheetByName(name);
  if (!s) throw new Error('Нет листа «' + name + '»');
  return s;
}
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function num_(v) {
  if (typeof v === 'number') return v;
  var s = str_(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function dateIso_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    if (typeof Utilities !== 'undefined' && tz) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return v.getFullYear() + '-' + pad_(v.getMonth() + 1) + '-' + pad_(v.getDate());
  }
  var s = str_(v), m;
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) return m[3] + '-' + pad_(+m[2]) + '-' + pad_(+m[1]);
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
  return '';
}
function toDate_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : '';
}
function dataRows_(s, width) {
  var n = s.getMaxRows() - 1;
  return n > 0 ? s.getRange(2, 1, n, width).getValues() : [];
}
// Номер последней строки, где заполнена хотя бы одна из колонок (формулы не учитываются)
function lastRow_(rows, cols) {
  for (var i = rows.length - 1; i >= 0; i--) {
    for (var j = 0; j < cols.length; j++) if (str_(rows[i][cols[j] - 1]) !== '') return i + 2;
  }
  return 1;
}
function ensureRows_(s, lastNeeded) {
  var max = s.getMaxRows();
  if (lastNeeded > max) s.insertRowsAfter(max, lastNeeded - max + 50);
}
function fp_(date, sku, op, qty) { return [date, sku, op, qty].join('|'); }

/* ---------------- чтение изменений из таблицы ---------------- */
function pull_(ss) {
  var tz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : '';
  var products = [];
  dataRows_(sheet_(ss, SH.products), P.WIDTH).forEach(function (r, i) {
    var sku = str_(r[P.SKU - 1]);
    if (!sku) return;
    products.push({
      row: i + 2, sku: sku, name: str_(r[P.NAME - 1]), category: str_(r[P.CAT - 1]), unit: str_(r[P.UNIT - 1]),
      price: num_(r[P.PRICE - 1]), cost: num_(r[P.COST - 1]), min_stock: num_(r[P.MIN - 1]),
      on_site: str_(r[P.ONSITE - 1]), description: str_(r[P.DESC - 1]),
    });
  });
  var movements = [];
  dataRows_(sheet_(ss, SH.moves), M.WIDTH).forEach(function (r, i) {
    if (str_(r[M.ID - 1]) !== '') return; // уже проведено (или отмечено ошибкой)
    var sku = str_(r[M.SKU - 1]), op = str_(r[M.OP - 1]), qty = num_(r[M.QTY - 1]);
    if (str_(r[M.DATE - 1]) === '' || !sku || !op || qty === null) return; // строка ещё заполняется
    var date = dateIso_(r[M.DATE - 1], tz);
    movements.push({
      row: i + 2, date: date, sku: sku, op: op, qty: qty,
      comment: str_(r[M.COMMENT - 1]), employee: str_(r[M.EMP - 1]), fp: fp_(date, sku, op, qty),
    });
  });
  return { products: products, movements: movements };
}

/* ---------------- запись изменений с сайта ---------------- */
function push_(ss, req) {
  var res = { products: 0, movements: 0, orders: 0, acks: 0 };
  var tz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : '';

  // Товары: обновить строку по артикулу или добавить новую
  var ps = sheet_(ss, SH.products);
  if ((req.products && req.products.length) || (req.deleted && req.deleted.length)) {
    var rows = dataRows_(ps, P.WIDTH);
    var index = {};
    rows.forEach(function (r, i) { var k = str_(r[0]); if (k && !index[k]) index[k] = i + 2; });
    var next = lastRow_(rows, [P.SKU, P.NAME]) + 1;
    (req.products || []).forEach(function (p) {
      var row = index[p.sku];
      if (!row) { row = next++; index[p.sku] = row; ensureRows_(ps, row); }
      ps.getRange(row, P.SKU, 1, 7).setValues([[p.sku, p.name, p.category, p.unit, p.price, p.cost, p.min_stock]]);
      ps.getRange(row, P.ONSITE, 1, 2).setValues([[p.on_site, p.description]]);
      res.products++;
    });
    (req.deleted || []).forEach(function (sku) {
      var row = index[sku];
      if (!row) return;
      var name = str_(ps.getRange(row, P.NAME).getValue());
      if (name.indexOf('[удалён] ') !== 0) ps.getRange(row, P.NAME).setValue('[удалён] ' + name);
      ps.getRange(row, P.ONSITE).setValue('Нет');
    });
  }

  var ms = sheet_(ss, SH.moves);
  // Отметки о проведении строк, внесённых в таблицу вручную
  if (req.acks && req.acks.length) {
    var mrows = dataRows_(ms, M.WIDTH);
    req.acks.forEach(function (a) {
      var row = findPendingRow_(mrows, a, tz);
      if (!row) return;
      var mark = a.id ? a.id : '⚠ ' + a.error;
      ms.getRange(row, M.ID).setValue(mark);
      mrows[row - 2][M.ID - 1] = mark;
      res.acks++;
    });
  }

  // Движения с сайта: дописываем в конец одним блоком
  if (req.movements && req.movements.length) {
    var start = lastRow_(dataRows_(ms, M.WIDTH), [M.DATE, M.SKU, M.OP, M.QTY, M.ID]) + 1;
    var n = req.movements.length;
    ensureRows_(ms, start + n - 1);
    var ab = [], de = [], gh = [], j = [];
    req.movements.forEach(function (m) {
      ab.push([toDate_(m.date), m.sku]);
      de.push([m.op, m.qty]);
      gh.push([m.comment, m.employee]);
      j.push([m.id]);
    });
    ms.getRange(start, M.DATE, n, 2).setValues(ab);
    ms.getRange(start, M.OP, n, 2).setValues(de);
    ms.getRange(start, M.COMMENT, n, 2).setValues(gh);
    ms.getRange(start, M.ID, n, 1).setValues(j);
    res.movements = n;
  }

  // Заказы: обновить строку по номеру или добавить
  if (req.orders && req.orders.length) {
    var os = sheet_(ss, SH.orders);
    var orows = dataRows_(os, O_WIDTH);
    var oindex = {};
    orows.forEach(function (r, i) { var k = str_(r[0]); if (k && !oindex[k]) oindex[k] = i + 2; });
    var onext = lastRow_(orows, [1, 2, 3]) + 1;
    req.orders.forEach(function (o) {
      var key = String(o.id), row = oindex[key];
      if (!row) { row = onext++; oindex[key] = row; ensureRows_(os, row); }
      os.getRange(row, 1, 1, O_WIDTH).setValues([[o.id, toDate_(o.date), o.customer, o.phone, o.delivery, o.address,
        o.items, o.total, o.status, o.manager, o.comment]]);
      res.orders++;
    });
  }
  return res;
}

// Ищем строку, которую сайт провёл: сначала по номеру, затем (если строки сдвинулись) по содержимому
function findPendingRow_(rows, a, tz) {
  function match(i) {
    var r = rows[i];
    if (!r || str_(r[M.ID - 1]) !== '') return false;
    return fp_(dateIso_(r[M.DATE - 1], tz), str_(r[M.SKU - 1]), str_(r[M.OP - 1]), num_(r[M.QTY - 1])) === a.fp;
  }
  if (match(a.row - 2)) return a.row;
  for (var i = 0; i < rows.length; i++) if (match(i)) return i + 2;
  return 0;
}

/* ---------------- полная перезапись данными сайта ---------------- */
function reset_(ss) {
  var ps = sheet_(ss, SH.products), ms = sheet_(ss, SH.moves), os = sheet_(ss, SH.orders);
  var pn = ps.getMaxRows() - 1, mn = ms.getMaxRows() - 1, on = os.getMaxRows() - 1;
  if (pn > 0) { ps.getRange(2, 1, pn, 7).clearContent(); ps.getRange(2, P.ONSITE, pn, 2).clearContent(); }
  if (mn > 0) {
    ms.getRange(2, M.DATE, mn, 2).clearContent();
    ms.getRange(2, M.OP, mn, 2).clearContent();
    ms.getRange(2, M.COMMENT, mn, 2).clearContent();
    ms.getRange(2, M.ID, mn, 1).clearContent();
  }
  if (on > 0) os.getRange(2, 1, on, O_WIDTH).clearContent();
  ms.getRange(1, M.ID).setValue('ID сайта');
  // Формулы на открытые диапазоны — работают на любом числе строк
  ps.getRange(2, 8).setFormula('=ARRAYFORMULA(IF(A2:A="","",SUMIF(Движения!B2:B,A2:A,Движения!F2:F)))');
  ps.getRange(2, 9).setFormula('=ARRAYFORMULA(IF(A2:A="","",H2:H*F2:F))');
  ps.getRange(2, 10).setFormula('=ARRAYFORMULA(IF(A2:A="","",H2:H*E2:E))');
  ps.getRange(2, 11).setFormula('=ARRAYFORMULA(IF((A2:A="")+(F2:F=0),"",(E2:E-F2:F)/F2:F))');
  ps.getRange(2, 12).setFormula('=ARRAYFORMULA(IF(A2:A="","",IF(H2:H<=0,"Нет",IF(H2:H<=G2:G,"Мало","В наличии"))))');
  ps.getRange(2, 13).setFormula('=ARRAYFORMULA(IF(A2:A="","",-SUMIF(Движения!B2:B,A2:A,Движения!I2:I)))');
  ms.getRange(2, 3).setFormula('=ARRAYFORMULA(IF(B2:B="","",IFERROR(VLOOKUP(B2:B,Товары!A2:B,2,FALSE),"⚠ нет такого артикула")))');
  ms.getRange(2, 6).setFormula('=ARRAYFORMULA(IF((B2:B="")+(E2:E=""),"",IF((D2:D="Приход")+(D2:D="Возврат")+(D2:D="Корректировка"),E2:E,-ABS(E2:E))))');
  ms.getRange(2, 9).setFormula('=ARRAYFORMULA(IF(((D2:D="Продажа")+(D2:D="Возврат"))*(A2:A>=TODAY()-30)*(B2:B<>""),F2:F,0))');
  return { reset: true };
}
