'use strict';
/* SHUL.FISH — клиентское приложение (без фреймворков) */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const zl = (n) => `${Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} zł`;
const fmtQty = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '');
const stepFor = (unit) => (unit === 'кг' ? 0.5 : 1);

const state = { me: null, meta: null, cart: loadCart() };

/* ---------------- API ---------------- */
async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { /* пусто */ }
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}
function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3800);
}
const can = (p) => !!state.me && state.me.permissions.includes(p);
const isStaff = () => !!state.me && (state.me.role === 'admin' || state.me.role === 'manager');

/* ---------------- Корзина ---------------- */
function loadCart() {
  try { return JSON.parse(localStorage.getItem('sf_cart') || '[]'); } catch { return []; }
}
function saveCart() {
  try { localStorage.setItem('sf_cart', JSON.stringify(state.cart)); } catch { /* приватный режим */ }
  const count = state.cart.length;
  $('#cartCount').textContent = count;
  $('#cartCount').classList.toggle('hidden', count === 0);
}
function addToCart(p, qty) {
  const step = stepFor(p.unit);
  qty = qty || step;
  const item = state.cart.find((i) => i.id === p.id);
  if (item) item.qty = Math.round((item.qty + qty) * 1000) / 1000;
  else state.cart.push({ id: p.id, name: p.name, unit: p.unit, price: p.price, image: p.images[0]?.url || null, category: p.category, qty });
  saveCart();
  toast(`«${p.name}» добавлено в корзину`);
}

/* ---------------- Графика: золотая рыба как на логотипе ---------------- */
function fishIcon(size = 22) {
  return `<svg width="${size}" height="${Math.round(size * 0.6)}" viewBox="0 0 40 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 12c5-7 15-9 24-3l8-5-2 8 2 8-8-5c-9 6-19 4-24-3z"/><circle cx="10" cy="11" r="1.2" fill="currentColor"/><path d="M15 8c2 2 2 6 0 8M20 7c2 3 2 7 0 10"/></svg>`;
}
const ART_COLORS = {
  smoked: ['#e0a54a', '#8a5a22'], cured: ['#d8c08a', '#7a6640'], dried: ['#e6d4a0', '#8f7a48'],
  caviar: ['#ff5a2a', '#9e1f0c'], sets: ['#f3d27a', '#a8802f'],
};
function productArt(category, label = '') {
  const [c1, c2] = ART_COLORS[category] || ART_COLORS.smoked;
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  if (category === 'caviar') {
    let dots = '';
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 62;
      dots += `<circle cx="${160 + Math.cos(a) * r * 1.35}" cy="${118 + Math.sin(a) * r * 0.45}" r="${5 + Math.random() * 2}" fill="url(#${id}d)"/>`;
    }
    return `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice"><defs>
      <radialGradient id="${id}d" cx=".35" cy=".35"><stop offset="0" stop-color="#ffd0a0"/><stop offset=".35" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>
      <linearGradient id="${id}b" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3a2a1a"/><stop offset="1" stop-color="#140e08"/></linearGradient></defs>
      <rect width="320" height="240" fill="#141315"/>
      <ellipse cx="160" cy="150" rx="110" ry="46" fill="url(#${id}b)" stroke="#d4a84b" stroke-width="2"/>
      <ellipse cx="160" cy="120" rx="96" ry="32" fill="#2a1408"/>${dots}
      <text x="160" y="222" fill="#d4a84b" font-family="Oswald,sans-serif" font-size="13" letter-spacing="4" text-anchor="middle">${esc(label)}</text></svg>`;
  }
  return `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice"><defs>
    <linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="320" height="240" fill="#141315"/>
    <g transform="rotate(-12 160 120)">
      <path d="M40 120c40-52 140-64 200-18l46-30-12 48 12 48-46-30c-60 46-160 34-200-18z" fill="url(#${id})" stroke="#f3d27a" stroke-width="2"/>
      <circle cx="82" cy="112" r="7" fill="#1a1208" stroke="#f3d27a" stroke-width="2"/>
      <path d="M115 85c14 18 14 52 0 70M150 80c16 22 16 58 0 80M185 84c14 20 14 52 0 72" stroke="rgba(0,0,0,.35)" stroke-width="3" fill="none"/>
    </g>
    <text x="160" y="222" fill="#d4a84b" font-family="Oswald,sans-serif" font-size="13" letter-spacing="4" text-anchor="middle">${esc(label)}</text></svg>`;
}
function productImage(p) {
  const url = p.image || p.images?.[0]?.url;
  return url ? `<img src="${esc(url)}" alt="${esc(p.name)}" loading="lazy">` : productArt(p.category);
}

/* ---------------- Модалка ---------------- */
function openModal(html, onMount) {
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (onMount) onMount($('#modalBody'));
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalBody').innerHTML = '';
  document.body.style.overflow = '';
}
$('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------------- Роутер ---------------- */
const routes = [
  [/^#?\/?$/, viewHome],
  [/^#\/catalog(?:\/(\w+))?$/, viewCatalog],
  [/^#\/product\/(\d+)$/, viewProduct],
  [/^#\/cart$/, viewCart],
  [/^#\/login$/, () => viewAuth('login')],
  [/^#\/register$/, () => viewAuth('register')],
  [/^#\/account$/, viewAccount],
  [/^#\/delivery$/, viewDelivery],
  [/^#\/admin(?:\/(\w+))?$/, viewAdmin],
];
async function router() {
  const hash = location.hash || '#/';
  $('#nav').classList.remove('open');
  $$('#nav a').forEach((a) => a.classList.toggle('active', hash === a.getAttribute('href')));
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await fn(...m.slice(1)); } catch (e) { app.innerHTML = `<div class="empty"><div class="big">Ошибка</div>${esc(e.message)}</div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  app.innerHTML = '<div class="empty"><div class="big">Страница не найдена</div><a class="btn" href="#/">На главную</a></div>';
}
window.addEventListener('hashchange', router);
$('#burger').addEventListener('click', () => $('#nav').classList.toggle('open'));

function updateHeader() {
  $('#adminLink').classList.toggle('hidden', !isStaff());
  $('#accountLink').title = state.me ? `Кабинет: ${state.me.name}` : 'Войти';
}

/* ---------------- Витрина ---------------- */
function productCard(p) {
  const badge = p.badge ? `<span class="badge${p.category === 'caviar' ? ' red' : ''}">${esc(p.badge)}</span>` : '';
  const stock = !p.in_stock ? '<span class="stock-tag out">Нет в наличии</span>' : '';
  return `<article class="card">
    <a href="#/product/${p.id}" class="card-img">${productImage(p)}${badge}${stock}</a>
    <div class="card-body">
      <div class="card-cat">${esc(p.category_name)}</div>
      <a href="#/product/${p.id}" class="card-title">${esc(p.name)}</a>
      <div class="card-desc">${esc(p.description)}</div>
      <div class="card-foot">
        <div class="price">${zl(p.price)} <small>/ ${esc(p.unit)}</small></div>
        <button class="btn sm primary" data-add="${p.id}" ${p.in_stock ? '' : 'disabled'}>${p.in_stock ? 'В корзину' : 'Нет'}</button>
      </div>
    </div>
  </article>`;
}
function bindAddButtons(products) {
  $$('[data-add]', app).forEach((b) => b.addEventListener('click', () => {
    const p = products.find((x) => x.id === Number(b.dataset.add));
    if (p) addToCart(p);
  }));
}

async function viewHome() {
  const { products } = await api('GET', '/api/products?featured=1');
  const cats = [
    ['smoked', 'Копчёная', 'Горячего и холодного копчения'],
    ['cured', 'Вяленая', 'Вобла, тарань, лещ, чехонь'],
    ['dried', 'Сушёная', 'Корюшка, анчоус, кальмар'],
    ['caviar', 'Икра', 'Красная и чёрная'],
  ];
  app.innerHTML = `
  <section class="hero">
    <div class="hero-text">
      <div class="gold-label">Warszawa</div>
      <h1>SHUL<span class="dot">.</span>FISH</h1>
      <div class="hero-sub">Premium quality</div>
      <div class="kinds">
        <span>${fishIcon()} Копчёная</span><span>${fishIcon()} Вяленая</span><span>${fishIcon()} Сушёная</span>
      </div>
      <div class="plaque">РЫБА &amp; ИКРА</div>
      <div class="hero-cta">
        <a href="#/catalog" class="btn primary">Перейти в каталог</a>
        <a href="#/catalog/caviar" class="btn">Икра</a>
      </div>
    </div>
    <div class="hero-badge"><img src="/img/logo.jpg" alt="SHUL.FISH — копчёная, вяленая, сушёная рыба и икра"></div>
  </section>

  <div class="features">
    <div class="feature"><span class="ico"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 19c8 0 14-6 14-14C11 5 5 11 5 19zm0 0 7-7"/></svg></span><div><b>Натуральный продукт</b><span>Без красителей и ароматизаторов</span></div></div>
    <div class="feature"><span class="ico"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="9" r="6"/><path d="m9 14-2 7 5-3 5 3-2-7"/><path d="m9.5 9 1.7 1.7L14.5 7.5"/></svg></span><div><b>Высокое качество</b><span>Проверенные поставщики</span></div></div>
    <div class="feature"><span class="ico"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg></span><div><b>Доставка по Варшаве</b><span>Курьером в день заказа</span></div></div>
  </div>

  <h2 class="section-title">Категории</h2>
  <div class="cats">
    ${cats.map(([k, t, s]) => `<a href="#/catalog/${k}" class="cat"><div class="cat-art">${productArt(k)}</div><b>${t}</b><span>${s}</span></a>`).join('')}
  </div>

  <h2 class="section-title">Хиты продаж</h2>
  <div class="grid">${products.map(productCard).join('') || '<div class="empty">Скоро здесь появятся товары</div>'}</div>
  <div style="text-align:center;margin-top:26px"><a href="#/catalog" class="btn">Весь каталог</a></div>`;
  bindAddButtons(products);
}

async function viewCatalog(category = '') {
  const cats = state.meta.categories;
  app.innerHTML = `
    <h1>${category && cats[category] ? esc(cats[category]) : 'Каталог'}</h1>
    <div class="catalog-head">
      <div class="chips">
        <a class="chip ${!category ? 'active' : ''}" href="#/catalog">Все</a>
        ${Object.entries(cats).map(([k, v]) => `<a class="chip ${category === k ? 'active' : ''}" href="#/catalog/${k}">${esc(v)}</a>`).join('')}
      </div>
      <div class="search">
        <input class="input" id="q" placeholder="Поиск…" style="width:200px">
        <select class="input" id="sort" style="width:auto">
          <option value="">По популярности</option><option value="price_asc">Сначала дешевле</option>
          <option value="price_desc">Сначала дороже</option><option value="name">По названию</option>
        </select>
      </div>
    </div>
    <div class="grid" id="grid"></div>`;
  const load = async () => {
    const qs = new URLSearchParams();
    if (category) qs.set('category', category);
    if ($('#q').value.trim()) qs.set('q', $('#q').value.trim());
    if ($('#sort').value) qs.set('sort', $('#sort').value);
    const { products } = await api('GET', '/api/products?' + qs);
    $('#grid').innerHTML = products.map(productCard).join('') || '<div class="empty" style="grid-column:1/-1"><div class="big">Ничего не найдено</div>Попробуйте изменить запрос</div>';
    bindAddButtons(products);
  };
  let t;
  $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  $('#sort').addEventListener('change', load);
  await load();
}

async function viewProduct(id) {
  const { product: p } = await api('GET', `/api/products/${id}`);
  const step = stepFor(p.unit);
  const imgs = p.images;
  app.innerHTML = `
    <p><a href="#/catalog/${p.category}" class="muted">← ${esc(p.category_name)}</a></p>
    <div class="product-page">
      <div>
        <div class="gallery-main" id="mainImg">${imgs.length ? `<img src="${esc(imgs[0].url)}" alt="${esc(p.name)}">` : productArt(p.category, p.category_name.toUpperCase())}</div>
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((im, i) => `<img src="${esc(im.url)}" data-i="${i}" class="${i === 0 ? 'active' : ''}" alt="">`).join('')}</div>` : ''}
      </div>
      <div>
        <div class="card-cat">${esc(p.category_name)}</div>
        <h1>${esc(p.name)}</h1>
        <div class="price" style="font-size:34px;margin:10px 0 16px">${zl(p.price)} <small>/ ${esc(p.unit)}</small></div>
        <p style="white-space:pre-line">${esc(p.description)}</p>
        <dl class="kv" style="margin:18px 0">
          <dt>Артикул</dt><dd>${esc(p.sku || '—')}</dd>
          <dt>Наличие</dt><dd>${p.in_stock ? '<span class="st ok">В наличии</span>' : '<span class="st out">Нет в наличии</span>'}</dd>
          ${p.unit === 'кг' ? '<dt>Шаг заказа</dt><dd>0,5 кг (точный вес уточняет менеджер)</dd>' : ''}
        </dl>
        ${p.in_stock ? `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <div class="qty"><button id="minus">−</button><input id="qty" value="${step}" inputmode="decimal"><button id="plus">+</button></div>
          <button class="btn primary" id="buy">В корзину</button>
        </div>` : ''}
        ${can('products.edit') ? `<p style="margin-top:22px"><a class="btn sm ghost" href="#/admin/products" data-edit="${p.id}">✎ Редактировать товар</a></p>` : ''}
      </div>
    </div>`;
  $$('.thumbs img').forEach((t) => t.addEventListener('click', () => {
    $('#mainImg').innerHTML = `<img src="${esc(imgs[t.dataset.i].url)}" alt="">`;
    $$('.thumbs img').forEach((x) => x.classList.toggle('active', x === t));
  }));
  if (p.in_stock) {
    const q = $('#qty');
    const norm = (v) => Math.max(step, Math.round(v / step) * step);
    $('#minus').onclick = () => { q.value = norm(Number(q.value.replace(',', '.')) - step); };
    $('#plus').onclick = () => { q.value = norm(Number(q.value.replace(',', '.')) + step); };
    $('#buy').onclick = () => addToCart(p, norm(Number(q.value.replace(',', '.')) || step));
  }
  const ed = $('[data-edit]');
  if (ed) ed.addEventListener('click', (e) => { e.preventDefault(); editProduct(p.id); });
}

function viewDelivery() {
  app.innerHTML = `<h1>Доставка и оплата</h1>
  <div class="two-col">
    <div class="panel glow">
      <h3>Доставка по Варшаве</h3>
      <p class="muted">Курьер привезёт заказ в день оформления при заказе до 16:00. Менеджер позвонит для подтверждения состава и времени.</p>
      <h3 style="margin-top:20px">Самовывоз</h3>
      <p class="muted">Забрать заказ можно по договорённости с менеджером.</p>
      <h3 style="margin-top:20px">Весовой товар</h3>
      <p class="muted">Рыба на развес продаётся с шагом 0,5 кг. Итоговая сумма может немного отличаться после взвешивания.</p>
    </div>
    <div class="panel">
      <h3>Оплата</h3>
      <p class="muted">Наличными или картой курьеру, BLIK, переводом на счёт.</p>
      <h3 style="margin-top:20px">Хранение</h3>
      <p class="muted">Копчёную рыбу и икру храните в холодильнике при +2…+6 °C. Вяленую и сушёную — в сухом прохладном месте.</p>
    </div>
  </div>`;
}

/* ---------------- Корзина и оформление ---------------- */
function cartTotal() { return state.cart.reduce((s, i) => s + i.price * i.qty, 0); }
function viewCart() {
  if (!state.cart.length) {
    app.innerHTML = `<div class="empty"><div class="big">Корзина пуста</div><p>Загляните в каталог — там много вкусного.</p><a href="#/catalog" class="btn primary">В каталог</a></div>`;
    return;
  }
  const me = state.me || {};
  app.innerHTML = `<h1>Корзина</h1>
  <div class="two-col">
    <div class="panel">
      <div id="cartRows"></div>
    </div>
    <form class="panel glow form" id="checkout">
      <h3>Оформление заказа</h3>
      <label class="field">Имя<input class="input" name="customer_name" required value="${esc(me.name || '')}"></label>
      <div class="form-row">
        <label class="field">Телефон<input class="input" name="phone" required placeholder="+48 …" value="${esc(me.phone || '')}"></label>
        <label class="field">E-mail<input class="input" name="email" type="email" value="${esc(me.email || '')}"></label>
      </div>
      <div class="radio-cards">
        <label><input type="radio" name="delivery" value="courier" checked> Курьер по Варшаве</label>
        <label><input type="radio" name="delivery" value="pickup"> Самовывоз</label>
      </div>
      <label class="field" id="addrField">Адрес доставки<input class="input" name="address" placeholder="ул., дом, кв."></label>
      <label class="field">Комментарий<textarea class="input" name="comment" placeholder="Удобное время, домофон…"></textarea></label>
      <div class="total-line big"><span>Итого</span><b id="total"></b></div>
      <button class="btn primary" type="submit">Оформить заказ</button>
      ${state.me ? '' : '<p class="muted" style="margin:0;font-size:13px"><a href="#/login" style="color:var(--gold-2)">Войдите</a>, чтобы видеть историю заказов.</p>'}
    </form>
  </div>`;
  const renderRows = () => {
    $('#cartRows').innerHTML = state.cart.map((i, idx) => `
      <div class="cart-row">
        <div class="thumb">${productImage(i)}</div>
        <div><a href="#/product/${i.id}"><b>${esc(i.name)}</b></a><div class="muted">${zl(i.price)} / ${esc(i.unit)}</div></div>
        <div class="qty row-qty"><button data-dec="${idx}">−</button><input value="${fmtQty(i.qty)}" readonly><button data-inc="${idx}">+</button></div>
        <div class="price" style="font-size:18px">${zl(Math.round(i.price * i.qty * 100) / 100)}</div>
        <button class="btn-icon" data-del="${idx}" title="Удалить">✕</button>
      </div>`).join('');
    $('#total').textContent = zl(Math.round(cartTotal() * 100) / 100);
    $$('[data-inc]').forEach((b) => b.onclick = () => { const i = state.cart[b.dataset.inc]; i.qty += stepFor(i.unit); saveCart(); renderRows(); });
    $$('[data-dec]').forEach((b) => b.onclick = () => { const i = state.cart[b.dataset.dec]; i.qty = Math.max(stepFor(i.unit), i.qty - stepFor(i.unit)); saveCart(); renderRows(); });
    $$('[data-del]').forEach((b) => b.onclick = () => { state.cart.splice(Number(b.dataset.del), 1); saveCart(); state.cart.length ? renderRows() : viewCart(); });
  };
  renderRows();
  const form = $('#checkout');
  form.addEventListener('change', () => $('#addrField').classList.toggle('hidden', form.delivery.value === 'pickup'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    try {
      const { order } = await api('POST', '/api/orders', { ...fd, items: state.cart.map((i) => ({ product_id: i.id, qty: i.qty })) });
      state.cart = []; saveCart();
      app.innerHTML = `<div class="empty"><div class="big">Спасибо! Заказ №${order.id} принят</div>
        <p>Сумма: <b style="color:var(--gold-2)">${zl(order.total)}</b>. Менеджер свяжется с вами по телефону ${esc(order.phone)}.</p>
        <a href="#/catalog" class="btn">Продолжить покупки</a></div>`;
    } catch (err) { toast(err.message, true); }
  });
}

/* ---------------- Вход / регистрация / кабинет ---------------- */
function viewAuth(mode) {
  if (state.me) { location.hash = '#/account'; return; }
  const reg = mode === 'register';
  app.innerHTML = `<div class="auth-box panel glow">
    <div class="tabs"><a class="chip ${reg ? '' : 'active'}" href="#/login">Вход</a><a class="chip ${reg ? 'active' : ''}" href="#/register">Регистрация</a></div>
    <form class="form" id="authForm">
      ${reg ? '<label class="field">Имя<input class="input" name="name" required autocomplete="name"></label>' : ''}
      <label class="field">E-mail<input class="input" name="email" type="email" required autocomplete="email"></label>
      ${reg ? '<label class="field">Телефон<input class="input" name="phone" autocomplete="tel" placeholder="+48 …"></label>' : ''}
      <label class="field">Пароль<input class="input" name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
      <button class="btn primary" type="submit">${reg ? 'Создать аккаунт' : 'Войти'}</button>
    </form>
  </div>`;
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('POST', reg ? '/api/auth/register' : '/api/auth/login', Object.fromEntries(new FormData(e.target)));
      state.me = user; updateHeader();
      toast(`Добро пожаловать, ${user.name}!`);
      location.hash = user.role === 'customer' ? '#/account' : '#/admin';
    } catch (err) { toast(err.message, true); }
  });
}

async function viewAccount() {
  if (!state.me) { location.hash = '#/login'; return; }
  const { orders } = await api('GET', '/api/orders/my');
  const me = state.me;
  app.innerHTML = `<h1>Личный кабинет</h1>
  <div class="two-col">
    <div>
      <h3>Мои заказы</h3>
      ${orders.length ? orders.map(orderCard).join('') : '<div class="panel empty">Заказов пока нет</div>'}
    </div>
    <div class="panel glow">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <h3 style="margin:0">${esc(me.name)}</h3><span class="role-pill role-${me.role}">${roleName(me.role)}</span>
      </div>
      <p class="muted">${esc(me.email)}</p>
      ${isStaff() ? '<p><a href="#/admin" class="btn primary">Панель управления</a></p>' : ''}
      <form class="form" id="profile">
        <label class="field">Имя<input class="input" name="name" value="${esc(me.name)}"></label>
        <label class="field">Телефон<input class="input" name="phone" value="${esc(me.phone || '')}"></label>
        <label class="field">Текущий пароль<input class="input" name="old_password" type="password" autocomplete="current-password"></label>
        <label class="field">Новый пароль<input class="input" name="new_password" type="password" minlength="8" autocomplete="new-password"></label>
        <button class="btn" type="submit">Сохранить</button>
      </form>
      <button class="btn danger" id="logout" style="margin-top:14px;width:100%">Выйти</button>
    </div>
  </div>`;
  $('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const { user } = await api('PUT', '/api/me', Object.fromEntries(new FormData(e.target))); state.me = user; toast('Сохранено'); viewAccount(); }
    catch (err) { toast(err.message, true); }
  });
  $('#logout').addEventListener('click', logout);
}
async function logout() {
  await api('POST', '/api/auth/logout', {});
  state.me = null; updateHeader(); location.hash = '#/';
  toast('Вы вышли из аккаунта');
}
const roleName = (r) => ({ admin: 'Администратор', manager: 'Менеджер', customer: 'Покупатель' }[r] || r);
function orderCard(o, manage = false) {
  return `<div class="panel order-card">
    <div class="order-head">
      <div><b style="font:600 18px var(--head)">Заказ №${o.id}</b> <span class="muted">· ${fmtDate(o.created_at)}</span></div>
      ${manage ? `<select class="input" data-status="${o.id}" style="width:auto" ${o.status === 'cancelled' ? 'disabled' : ''}>${Object.entries(state.meta.order_statuses).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select>` : `<span class="st st-${o.status}">${esc(o.status_name)}</span>`}
    </div>
    ${manage ? `<div class="muted" style="font-size:14px">${esc(o.customer_name)} · <a href="tel:${esc(o.phone)}" style="color:var(--gold-2)">${esc(o.phone)}</a>${o.email ? ' · ' + esc(o.email) : ''}<br>${o.delivery === 'pickup' ? 'Самовывоз' : 'Курьер: ' + esc(o.address)}${o.comment ? `<br>💬 ${esc(o.comment)}` : ''}</div>` : ''}
    <ul class="order-items">${o.items.map((i) => `<li>${esc(i.name)} — ${fmtQty(i.qty)} ${esc(i.unit)} × ${zl(i.price)}</li>`).join('')}</ul>
    <div class="total-line"><span class="muted">Сумма</span><b class="price" style="font-size:20px">${zl(o.total)}</b></div>
  </div>`;
}

/* ================================================================== */
/*                         ПАНЕЛЬ УПРАВЛЕНИЯ                            */
/* ================================================================== */
const ADMIN_SECTIONS = [
  ['dashboard', 'Сводка', null],
  ['products', 'Товары', 'products.edit'],
  ['inventory', 'Складской учёт', 'inventory.view'],
  ['movements', 'Движения', 'inventory.view'],
  ['orders', 'Заказы', 'orders.manage'],
  ['users', 'Сотрудники', 'users.manage'],
  ['log', 'Журнал', 'log.view'],
];
async function viewAdmin(section = 'dashboard') {
  if (!state.me) { location.hash = '#/login'; return; }
  if (!isStaff()) { app.innerHTML = '<div class="empty"><div class="big">Доступ запрещён</div>Раздел только для сотрудников.</div>'; return; }
  const allowed = ADMIN_SECTIONS.filter(([, , p]) => !p || can(p));
  if (!allowed.find(([k]) => k === section)) section = 'dashboard';
  let stats = {};
  try { stats = await api('GET', '/api/stats'); } catch { /* нет прав на сводку */ }
  app.innerHTML = `<div class="admin-layout">
    <aside class="panel side">
      <div class="who"><b>${esc(state.me.name)}</b><span class="role-pill role-${state.me.role}">${roleName(state.me.role)}</span></div>
      ${allowed.map(([k, t]) => `<a href="#/admin/${k}" class="${k === section ? 'active' : ''}">${t}${k === 'orders' && stats.orders_new ? `<span class="count">${stats.orders_new}</span>` : ''}</a>`).join('')}
      <a href="#/" >← На сайт</a>
    </aside>
    <section id="adminMain"></section>
  </div>`;
  const main = $('#adminMain');
  const views = { dashboard: adminDashboard, products: adminProducts, inventory: adminInventory, movements: adminMovements, orders: adminOrders, users: adminUsers, log: adminLog };
  await views[section](main, stats);
}

function adminDashboard(main, stats) {
  const perms = state.me.permissions.map((p) => `<li>${esc(state.meta.permissions[p])}</li>`).join('');
  main.innerHTML = `<h2>Сводка</h2>
    ${stats.weak_passwords ? `<div class="panel" style="border-color:var(--danger);margin-bottom:20px"><h3 style="color:var(--danger)">⚠ Небезопасные пароли</h3>
      <p>У этих учётных записей стоит общеизвестный пароль: <b>${stats.weak_passwords.map(esc).join(', ')}</b>. Любой может войти под ними — смените пароли в разделе «Сотрудники» или в личном кабинете.</p></div>` : ''}
    <div class="stats">
      ${'orders_new' in stats ? `<a href="#/admin/orders" class="stat"><div class="v">${stats.orders_new}</div><div class="l">Новых заказов</div></a>
      <div class="stat"><div class="v">${stats.orders_active}</div><div class="l">Заказов в работе</div></div>` : ''}
      ${'revenue_30d' in stats ? `<div class="stat"><div class="v">${zl(stats.revenue_30d)}</div><div class="l">Выручка за 30 дней</div></div>
      <div class="stat"><div class="v">${stats.products}</div><div class="l">Позиций в каталоге</div></div>` : ''}
    </div>
    ${stats.low_stock?.length ? `<div class="panel" style="margin-bottom:20px"><h3>⚠ Заканчиваются / нет в наличии</h3>
      <div class="table-wrap"><table><tr><th>Товар</th><th class="num">Остаток</th><th class="num">Минимум</th></tr>
      ${stats.low_stock.map((p) => `<tr><td>${esc(p.name)}</td><td class="num ${p.stock <= 0 ? 'neg' : ''}">${fmtQty(p.stock)} ${esc(p.unit)}</td><td class="num">${fmtQty(p.min_stock)}</td></tr>`).join('')}</table></div></div>` : ''}
    <div class="panel"><h3>Ваши права доступа</h3><ul class="muted">${perms}</ul></div>`;
}

/* ---------- Товары ---------- */
async function adminProducts(main) {
  const { products } = await api('GET', '/api/products?all=1');
  main.innerHTML = `<div class="toolbar">
      <h2 style="margin:0">Товары</h2>
      <div class="left">
        <input class="input" id="pf" placeholder="Фильтр…" style="width:180px">
        ${can('products.create') ? '<button class="btn primary" id="newProd">+ Новый товар</button>' : ''}
      </div>
    </div>
    <div class="table-wrap"><table id="ptable">
      <tr><th>Товар</th><th>Категория</th><th class="num">Цена</th>${can('inventory.view') ? '<th class="num">Себест.</th>' : ''}<th class="num">Остаток</th><th>Статус</th><th></th></tr>
      ${products.map((p) => `<tr data-name="${esc((p.name + ' ' + p.sku).toLowerCase())}">
        <td><div class="prod-cell"><div class="mini-thumb">${productImage(p)}</div><div><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc(p.sku)} · фото: ${p.images.length}</div></div></div></td>
        <td>${esc(p.category_name)}</td>
        <td class="num">${zl(p.price)}/${esc(p.unit)}</td>
        ${can('inventory.view') ? `<td class="num muted">${zl(p.cost)}</td>` : ''}
        <td class="num">${fmtQty(p.stock)} ${esc(p.unit)}</td>
        <td>${!p.active ? '<span class="st off">Скрыт</span>' : p.stock <= 0 ? '<span class="st out">Нет</span>' : p.min_stock !== undefined && p.stock <= p.min_stock ? '<span class="st low">Мало</span>' : '<span class="st ok">В наличии</span>'}</td>
        <td class="num">
          ${can('stock.manage') ? `<button class="btn sm ghost" data-stock="${p.id}">Склад</button>` : ''}
          <button class="btn sm" data-edit="${p.id}">Изменить</button>
        </td></tr>`).join('')}
    </table></div>`;
  $('#pf').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('#ptable tr[data-name]').forEach((tr) => tr.classList.toggle('hidden', !tr.dataset.name.includes(q)));
  });
  $('#newProd')?.addEventListener('click', () => editProduct(null));
  $$('[data-edit]', main).forEach((b) => b.addEventListener('click', () => editProduct(Number(b.dataset.edit))));
  $$('[data-stock]', main).forEach((b) => b.addEventListener('click', () => stockDialog(products.find((p) => p.id === Number(b.dataset.stock)))));
}
const refreshAdmin = () => { if (location.hash.startsWith('#/admin')) router(); };

async function editProduct(id) {
  const p = id ? (await api('GET', `/api/products/${id}`)).product : { name: '', sku: '', category: 'smoked', description: '', price: 0, cost: 0, unit: 'кг', min_stock: 0, active: true, featured: false, badge: '', images: [] };
  const priceLock = !can('products.price');
  const m = state.meta;
  openModal(`<h2>${id ? 'Редактирование товара' : 'Новый товар'}</h2>
    <form class="form" id="pform">
      <label class="field">Название<input class="input" name="name" required value="${esc(p.name)}"></label>
      <div class="form-row">
        <label class="field">Категория<select class="input" name="category">${Object.entries(m.categories).map(([k, v]) => `<option value="${k}" ${k === p.category ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field">Артикул<input class="input" name="sku" value="${esc(p.sku)}"></label>
      </div>
      <label class="field">Описание<textarea class="input" name="description">${esc(p.description)}</textarea></label>
      <div class="form-row">
        <label class="field">Цена продажи, zł${priceLock ? ' 🔒' : ''}<input class="input" name="price" type="number" step="0.01" min="0" value="${p.price}" ${priceLock ? 'disabled' : ''}></label>
        ${'cost' in p || !id ? `<label class="field">Себестоимость, zł${priceLock ? ' 🔒' : ''}<input class="input" name="cost" type="number" step="0.01" min="0" value="${p.cost ?? 0}" ${priceLock ? 'disabled' : ''}></label>` : '<div></div>'}
      </div>
      <div class="form-row">
        <label class="field">Единица<select class="input" name="unit">${m.units.map((u) => `<option ${u === p.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        <label class="field">Мин. остаток (сигнал «мало»)<input class="input" name="min_stock" type="number" step="0.1" min="0" value="${p.min_stock ?? 0}"></label>
      </div>
      <div class="form-row">
        <label class="field">Метка на карточке<input class="input" name="badge" maxlength="16" placeholder="ХИТ, NEW, PREMIUM…" value="${esc(p.badge)}"></label>
        ${!id && can('stock.manage') ? '<label class="field">Начальный остаток<input class="input" name="initial_stock" type="number" step="0.1" min="0" value="0"></label>' : '<div></div>'}
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Показывать на сайте</label>
        <label class="check"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}> В блоке «Хиты продаж»</label>
      </div>
      ${id && can('photos.manage') ? `<div><div class="field" style="margin-bottom:8px">Фотографии (первая — главная)</div>
        <div class="photos-edit" id="photos"></div></div>` : ''}
      ${!id && can('photos.manage') ? '<p class="muted" style="margin:0">Фотографии можно добавить после сохранения товара.</p>' : ''}
      ${priceLock ? '<p class="muted" style="margin:0">🔒 Изменение цен доступно только администратору или сотруднику с правом «Изменение цен».</p>' : ''}
      <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap">
        <div>${id && can('products.delete') ? '<button type="button" class="btn danger" id="delProd">Удалить</button>' : ''}</div>
        <div style="display:flex;gap:10px"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary" type="submit">Сохранить</button></div>
      </div>
    </form>`, (root) => {
    if (id && can('photos.manage')) renderPhotos(p);
    $('#pform', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        name: f.name.value, sku: f.sku.value, category: f.category.value, description: f.description.value,
        unit: f.unit.value, min_stock: f.min_stock.value || 0, badge: f.badge.value,
        active: f.active.checked, featured: f.featured.checked,
      };
      if (!priceLock) { body.price = f.price.value || 0; if (f.cost) body.cost = f.cost.value || 0; }
      if (f.initial_stock) body.initial_stock = f.initial_stock.value || 0;
      try {
        const r = await api(id ? 'PUT' : 'POST', id ? `/api/products/${id}` : '/api/products', body);
        toast('Товар сохранён');
        if (!id && can('photos.manage')) { editProduct(r.product.id); } else closeModal();
        refreshAdmin();
      } catch (err) { toast(err.message, true); }
    });
    $('#delProd', root)?.addEventListener('click', async () => {
      if (!confirm(`Удалить «${p.name}»? Это действие необратимо. История движений склада сохранится.`)) return;
      try { await api('DELETE', `/api/products/${id}`); toast('Товар удалён'); closeModal(); refreshAdmin(); }
      catch (err) { toast(err.message, true); }
    });
  });
}

function renderPhotos(p) {
  const box = $('#photos');
  if (!box) return;
  box.innerHTML = p.images.map((im, i) => `<div class="photo-item ${i === 0 ? 'main' : ''}">
      <img src="${esc(im.url)}" alt="">
      <div class="ph-actions">${i === 0 ? '<button type="button" disabled>★</button>' : `<button type="button" data-main="${im.id}" title="Сделать главной">☆</button>`}<button type="button" class="del" data-delimg="${im.id}" title="Удалить">✕</button></div>
    </div>`).join('') + `<label class="photo-add">+<small>Добавить</small><input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden id="photoInput"></label>`;
  const reload = async () => { p.images = (await api('GET', `/api/products/${p.id}`)).product.images; renderPhotos(p); refreshAdminQuiet(); };
  $('#photoInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    for (const file of files) {
      try {
        const data = await resizeImage(file, 1600, 0.86);
        await api('POST', `/api/products/${p.id}/images`, { data });
      } catch (err) { toast(`${file.name}: ${err.message}`, true); }
    }
    toast(`Загружено фото: ${files.length}`);
    reload();
  });
  $$('[data-delimg]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Удалить фото?')) return;
    try { await api('DELETE', `/api/images/${b.dataset.delimg}`); reload(); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-main]', box).forEach((b) => b.addEventListener('click', async () => {
    try { await api('PUT', `/api/images/${b.dataset.main}/main`, {}); reload(); } catch (err) { toast(err.message, true); }
  }));
}
let quietTimer;
function refreshAdminQuiet() { clearTimeout(quietTimer); quietTimer = setTimeout(() => { if (location.hash.startsWith('#/admin/products')) adminProducts($('#adminMain')); }, 300); }

// Сжимаем фото в браузере перед загрузкой
function resizeImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Только JPG, PNG или WEBP'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
    img.src = url;
  });
}

function stockDialog(p) {
  const types = { in: 'Приход (поставка)', out: 'Расход', writeoff: 'Списание (брак, порча)', adjust: 'Инвентаризация (фактический остаток)' };
  openModal(`<h2>Склад: ${esc(p.name)}</h2>
    <p>Текущий остаток: <b class="price" style="font-size:20px">${fmtQty(p.stock)} ${esc(p.unit)}</b></p>
    <form class="form" id="sform">
      <div class="radio-cards">${Object.entries(types).map(([k, v], i) => `<label><input type="radio" name="type" value="${k}" ${i === 0 ? 'checked' : ''}> ${v}</label>`).join('')}</div>
      <div class="form-row">
        <label class="field" id="qtyLabel">Количество, ${esc(p.unit)}<input class="input" name="qty" type="number" step="0.001" min="0" required></label>
        ${can('products.price') ? `<label class="field" id="costField">Закупочная цена за ${esc(p.unit)}, zł (необязательно)<input class="input" name="unit_cost" type="number" step="0.01" min="0" placeholder="${p.cost ?? ''}"></label>` : '<div></div>'}
      </div>
      <label class="field">Комментарий / причина<input class="input" name="note" placeholder="Поставщик, номер накладной, причина списания…"></label>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Провести</button></div>
    </form>`, (root) => {
    const f = $('#sform', root);
    f.addEventListener('change', () => {
      $('#qtyLabel', root).firstChild.textContent = f.type.value === 'adjust' ? `Фактический остаток, ${p.unit}` : `Количество, ${p.unit}`;
      $('#costField', root)?.classList.toggle('hidden', f.type.value !== 'in');
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', `/api/stock/${p.id}`, Object.fromEntries(new FormData(f)));
        toast('Операция проведена'); closeModal(); refreshAdmin();
      } catch (err) { toast(err.message, true); }
    });
  });
}

/* ---------- Складской учёт ---------- */
async function adminInventory(main) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  main.innerHTML = `<div class="toolbar"><h2 style="margin:0">Складской учёт</h2>
    <div class="left">
      <label class="muted">с <input type="date" class="input" id="from" value="${monthAgo}" style="width:auto"></label>
      <label class="muted">по <input type="date" class="input" id="to" value="${today}" style="width:auto"></label>
      <a class="btn sm" id="csv">⇩ CSV / Excel</a>
    </div></div><div id="inv"></div>`;
  const load = async () => {
    const from = $('#from').value, to = $('#to').value;
    $('#csv').href = `/api/inventory.csv?from=${from}&to=${to}`;
    const rep = await api('GET', `/api/inventory?from=${from}&to=${to}`);
    const t = rep.totals;
    $('#inv').innerHTML = `<div class="stats">
        <div class="stat"><div class="v">${zl(t.cost_value)}</div><div class="l">Склад по себестоимости</div></div>
        <div class="stat"><div class="v">${zl(t.retail_value)}</div><div class="l">Склад по цене продажи</div></div>
        <div class="stat"><div class="v">${zl(t.margin_value)}</div><div class="l">Потенциальная наценка</div></div>
        <div class="stat"><div class="v">${t.low} / ${t.out}</div><div class="l">Мало / нет в наличии</div></div>
      </div>
      <div class="table-wrap"><table>
        <tr><th>Артикул</th><th>Товар</th><th class="num">Остаток</th><th class="num">Себест.</th><th class="num">Сумма</th><th class="num">Приход</th><th class="num">Продано</th><th class="num">Расход/спис.</th><th class="num">Корр.</th><th>Статус</th></tr>
        ${rep.rows.map((r) => `<tr>
          <td class="muted">${esc(r.sku)}</td><td><b>${esc(r.name)}</b><div class="muted" style="font-size:12px">${esc(r.category)}${r.active ? '' : ' · скрыт'}</div></td>
          <td class="num">${fmtQty(r.stock)} ${esc(r.unit)}</td><td class="num">${zl(r.cost)}</td><td class="num">${zl(r.cost_value)}</td>
          <td class="num ${r.period_in ? 'pos' : ''}">${r.period_in ? '+' + fmtQty(r.period_in) : '—'}</td>
          <td class="num">${r.period_sold ? fmtQty(r.period_sold) : '—'}</td>
          <td class="num ${r.period_out ? 'neg' : ''}">${r.period_out ? '−' + fmtQty(r.period_out) : '—'}</td>
          <td class="num">${r.period_adjust ? (r.period_adjust > 0 ? '+' : '') + fmtQty(r.period_adjust) : '—'}</td>
          <td><span class="st ${r.status}">${{ ok: 'В наличии', low: 'Мало', out: 'Нет' }[r.status]}</span></td></tr>`).join('')}
      </table></div>`;
  };
  $('#from').addEventListener('change', load);
  $('#to').addEventListener('change', load);
  await load();
}

async function adminMovements(main) {
  const { products } = await api('GET', '/api/products?all=1');
  main.innerHTML = `<div class="toolbar"><h2 style="margin:0">Движения товара</h2>
    <div class="left">
      <select class="input" id="mp" style="width:auto"><option value="">Все товары</option>${products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <select class="input" id="mt" style="width:auto"><option value="">Все операции</option>${Object.entries(state.meta.movement_types).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    </div></div><div id="mv"></div>`;
  const load = async () => {
    const qs = new URLSearchParams({ limit: 500 });
    if ($('#mp').value) qs.set('product_id', $('#mp').value);
    if ($('#mt').value) qs.set('type', $('#mt').value);
    const { movements } = await api('GET', '/api/stock/movements?' + qs);
    $('#mv').innerHTML = movements.length ? `<div class="table-wrap"><table>
      <tr><th>Дата</th><th>Товар</th><th>Операция</th><th class="num">Кол-во</th><th class="num">Остаток</th><th>Комментарий</th><th>Сотрудник</th></tr>
      ${movements.map((m) => `<tr><td class="muted">${fmtDate(m.created_at)}</td><td>${esc(m.product_name)}</td><td>${esc(m.type_name)}</td>
        <td class="num ${m.qty >= 0 ? 'pos' : 'neg'}">${m.qty > 0 ? '+' : ''}${fmtQty(m.qty)}</td><td class="num">${fmtQty(m.balance_after)}</td>
        <td>${esc(m.note)}</td><td class="muted">${esc(m.user_name || (m.type === 'sale' ? 'покупатель' : '—'))}</td></tr>`).join('')}
    </table></div>` : '<div class="panel empty">Движений нет</div>';
  };
  $('#mp').addEventListener('change', load);
  $('#mt').addEventListener('change', load);
  await load();
}

/* ---------- Заказы ---------- */
async function adminOrders(main) {
  main.innerHTML = `<div class="toolbar"><h2 style="margin:0">Заказы</h2>
    <div class="chips" id="ostat"><button class="chip active" data-s="">Все</button>${Object.entries(state.meta.order_statuses).map(([k, v]) => `<button class="chip" data-s="${k}">${v}</button>`).join('')}</div></div>
    <div id="olist"></div>`;
  let current = '';
  const load = async () => {
    const { orders } = await api('GET', '/api/orders' + (current ? `?status=${current}` : ''));
    $('#olist').innerHTML = orders.length ? orders.map((o) => orderCard(o, true)).join('') : '<div class="panel empty">Заказов нет</div>';
    $$('[data-status]', main).forEach((s) => s.addEventListener('change', async () => {
      if (s.value === 'cancelled' && !confirm('Отменить заказ? Товар будет возвращён на склад.')) { load(); return; }
      try { await api('PUT', `/api/orders/${s.dataset.status}/status`, { status: s.value }); toast('Статус обновлён'); load(); }
      catch (err) { toast(err.message, true); load(); }
    }));
  };
  $$('#ostat .chip').forEach((c) => c.addEventListener('click', () => {
    current = c.dataset.s; $$('#ostat .chip').forEach((x) => x.classList.toggle('active', x === c)); load();
  }));
  await load();
}

/* ---------- Сотрудники и права ---------- */
async function adminUsers(main) {
  const { users } = await api('GET', '/api/users');
  main.innerHTML = `<div class="toolbar"><h2 style="margin:0">Сотрудники и покупатели</h2><button class="btn primary" id="newUser">+ Добавить сотрудника</button></div>
    <div class="table-wrap"><table>
      <tr><th>Имя</th><th>E-mail</th><th>Роль</th><th>Права</th><th>Статус</th><th></th></tr>
      ${users.map((u) => `<tr>
        <td><b>${esc(u.name)}</b>${u.id === state.me.id ? ' <span class="muted">(вы)</span>' : ''}</td><td>${esc(u.email)}</td>
        <td><span class="role-pill role-${u.role}">${roleName(u.role)}</span></td>
        <td class="muted" style="font-size:12px">${u.role === 'admin' ? 'Все' : u.role === 'manager' ? u.permissions.length + ' из ' + Object.keys(state.meta.permissions).length : '—'}</td>
        <td>${u.active ? '<span class="st ok">Активен</span>' : '<span class="st out">Заблокирован</span>'}</td>
        <td class="num"><button class="btn sm" data-u="${u.id}">Настроить</button></td></tr>`).join('')}
    </table></div>`;
  $('#newUser').addEventListener('click', () => userDialog(null));
  $$('[data-u]', main).forEach((b) => b.addEventListener('click', () => userDialog(users.find((u) => u.id === Number(b.dataset.u)))));
}
function userDialog(u) {
  const m = state.meta;
  const isNew = !u;
  u = u || { name: '', email: '', role: 'manager', permissions: m.default_manager_perms, active: true };
  const self = !isNew && u.id === state.me.id;
  openModal(`<h2>${isNew ? 'Новый сотрудник' : esc(u.name)}</h2>
    <form class="form" id="uform">
      <div class="form-row">
        <label class="field">Имя<input class="input" name="name" value="${esc(u.name)}" required></label>
        <label class="field">E-mail<input class="input" name="email" type="email" value="${esc(u.email)}" ${isNew ? 'required' : 'disabled'}></label>
      </div>
      <div class="form-row">
        <label class="field">Роль<select class="input" name="role" ${self ? 'disabled' : ''}>
          ${['manager', 'admin', 'customer'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${roleName(r)}</option>`).join('')}</select></label>
        <label class="field">${isNew ? 'Пароль' : 'Новый пароль (сброс)'}<input class="input" name="password" type="password" minlength="8" autocomplete="new-password" ${isNew ? 'required' : ''}></label>
      </div>
      <div id="permBox">
        <div class="field" style="margin-bottom:8px">Права менеджера</div>
        <div class="perm-grid">${Object.entries(m.permissions).filter(([k]) => !m.admin_only.includes(k)).map(([k, v]) => `<label class="check"><input type="checkbox" name="perm" value="${k}" ${u.permissions.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div>
        <p class="muted" style="font-size:13px">Управление пользователями доступно только администратору.</p>
      </div>
      ${!isNew && !self ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Учётная запись активна</label>` : ''}
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Сохранить</button></div>
    </form>`, (root) => {
    const f = $('#uform', root);
    const sync = () => $('#permBox', root).classList.toggle('hidden', f.role.value !== 'manager');
    f.role.addEventListener('change', sync); sync();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: f.name.value, role: f.role.value, permissions: $$('input[name=perm]:checked', f).map((c) => c.value) };
      if (f.password.value) body.password = f.password.value;
      if (isNew) body.email = f.email.value;
      if (f.active) body.active = f.active.checked;
      if (self) delete body.role;
      try {
        await api(isNew ? 'POST' : 'PUT', isNew ? '/api/users' : `/api/users/${u.id}`, body);
        toast('Сохранено'); closeModal(); refreshAdmin();
      } catch (err) { toast(err.message, true); }
    });
  });
}

async function adminLog(main) {
  const { log } = await api('GET', '/api/log');
  main.innerHTML = `<h2>Журнал действий</h2>
    <div class="table-wrap"><table><tr><th>Дата</th><th>Сотрудник</th><th>Действие</th><th>Детали</th></tr>
    ${log.map((l) => `<tr><td class="muted">${fmtDate(l.created_at)}</td><td>${esc(l.user_name)}</td><td>${esc(l.action)}</td><td>${esc(l.details)}</td></tr>`).join('')}
    </table></div>`;
}

/* ---------------- Запуск ---------------- */
(async function init() {
  $('#year').textContent = new Date().getFullYear();
  saveCart();
  try {
    const [meta, me] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/me')]);
    state.meta = meta; state.me = me.user;
  } catch (e) {
    app.innerHTML = `<div class="empty"><div class="big">Сервер недоступен</div>${esc(e.message)}</div>`;
    return;
  }
  updateHeader();
  $('#accountLink').addEventListener('click', (e) => { if (!state.me) { e.preventDefault(); location.hash = '#/login'; } });
  router();
})();
