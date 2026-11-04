'use strict';
/*
 * SEO для SHUL.FISH:
 *  - у каждой страницы свой <title>, description, canonical, hreflang и Open Graph (RU/PL);
 *  - разметка Product (schema.org) с ценой и наличием на страницах товаров;
 *  - /sitemap.xml собирается из каталога, /robots.txt закрывает служебные разделы.
 */
const fs = require('node:fs');
const path = require('node:path');

const T = {
  ru: {
    home: ['SHUL.FISH — копчёная, вяленая рыба и икра в Варшаве', 'SHUL.FISH — премиальная копчёная, вяленая и сушёная рыба, красная и чёрная икра. Упаковки ≈1 кг, доставка по Варшаве в день заказа.'],
    catalog: ['Каталог рыбы и икры — SHUL.FISH', 'Копчёная, вяленая и сушёная рыба, красная и чёрная икра с доставкой по Варшаве. Упаковки ≈1 кг, цена за 1 кг.'],
    category: (c) => [`${c} — купить в Варшаве | SHUL.FISH`, `${c} с доставкой по Варшаве. Упаковки ≈1 кг, премиальное качество.`],
    product: (n, price) => `${n} — ${price} zł/кг | SHUL.FISH`,
    productTail: 'Упаковка ≈1 кг (900–1100 г), цена за 1 кг. Доставка по Варшаве.',
    delivery: ['Доставка и оплата — SHUL.FISH', 'Доставка по Варшаве курьером в день заказа, самовывоз, оплата наличными, картой, BLIK или переводом.'],
    terms: ['Правила магазина — SHUL.FISH', 'Правила интернет-магазина SHUL.FISH: заказ, оплата, доставка, возврат и рекламации.'],
    privacy: ['Политика конфиденциальности — SHUL.FISH', 'Как SHUL.FISH обрабатывает и защищает персональные данные покупателей (RODO/GDPR).'],
    cookies: ['Политика cookies — SHUL.FISH', 'Какие cookies использует сайт SHUL.FISH.'],
    notFound: 'Страница не найдена — SHUL.FISH',
    cats: { smoked: 'Копчёная рыба', cured: 'Вяленая рыба', dried: 'Сушёная рыба', salted: 'Малосольная рыба', caviar: 'Икра', frozen: 'Замороженная рыба и морепродукты', sets: 'Наборы' },
  },
  pl: {
    home: ['SHUL.FISH — ryby wędzone, suszone i ikra w Warszawie', 'SHUL.FISH — ryby wędzone, suszone i przekąski rybne premium, ikra czerwona i kawior. Opakowania ok. 1 kg, dostawa w Warszawie w dniu zamówienia.'],
    catalog: ['Katalog ryb i ikry — SHUL.FISH', 'Ryby wędzone, suszone, przekąski rybne, ikra i kawior z dostawą w Warszawie. Opakowania ok. 1 kg, cena za 1 kg.'],
    category: (c) => [`${c} — kup w Warszawie | SHUL.FISH`, `${c} z dostawą w Warszawie. Opakowania ok. 1 kg, jakość premium.`],
    product: (n, price) => `${n} — ${price} zł/kg | SHUL.FISH`,
    productTail: 'Opakowanie ok. 1 kg (900–1100 g), cena za 1 kg. Dostawa w Warszawie.',
    delivery: ['Dostawa i płatność — SHUL.FISH', 'Dostawa kurierem w Warszawie w dniu zamówienia, odbiór osobisty, płatność gotówką, kartą, BLIK lub przelewem.'],
    terms: ['Regulamin sklepu — SHUL.FISH', 'Regulamin sklepu internetowego SHUL.FISH: zamówienia, płatności, dostawa, odstąpienie od umowy i reklamacje.'],
    privacy: ['Polityka prywatności — SHUL.FISH', 'Jak SHUL.FISH przetwarza i chroni dane osobowe klientów (RODO).'],
    cookies: ['Polityka cookies — SHUL.FISH', 'Jakich plików cookies używa sklep SHUL.FISH.'],
    notFound: 'Nie znaleziono strony — SHUL.FISH',
    cats: { smoked: 'Ryby wędzone', cured: 'Ryby suszone', dried: 'Przekąski rybne', salted: 'Ryby lekko solone', caviar: 'Ikra i kawior', frozen: 'Mrożone ryby i owoce morza', sets: 'Zestawy' },
  },
};
const PRIVATE = /^\/(cart|login|register|account|admin)(\/|$)/;

const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const fmtPrice = (grosze) => (grosze / 100).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function createSeo({ db, CATEGORIES, PUBLIC_DIR, SITE_URL }) {
  const site = String(SITE_URL || 'https://shulfish.pl').replace(/\/+$/, '');
  const templatePath = path.join(PUBLIC_DIR, 'index.html');
  let template = null;
  let templateMtime = 0;
  function getTemplate() {
    const m = fs.statSync(templatePath).mtimeMs;
    if (!template || m !== templateMtime) { template = fs.readFileSync(templatePath, 'utf8'); templateMtime = m; }
    return template;
  }
  const urlFor = (p, lang) => site + p + (lang === 'pl' ? '?lang=pl' : '');
  const firstImage = (productId) => db.prepare('SELECT filename FROM product_images WHERE product_id = ? ORDER BY sort, id LIMIT 1').get(productId);

  /** Мета-данные страницы по адресу. */
  function pageMeta(pathname, lang) {
    const L = T[lang];
    let m;
    const base = { status: 200, path: pathname, image: site + '/img/logo.jpg', type: 'website', robots: 'index,follow', jsonld: null };
    if (pathname === '/') return { ...base, title: L.home[0], desc: L.home[1] };
    if (pathname === '/catalog') return { ...base, title: L.catalog[0], desc: L.catalog[1] };
    if ((m = /^\/catalog\/([a-z]+)$/.exec(pathname)) && CATEGORIES[m[1]]) {
      const [title, desc] = L.category(L.cats[m[1]]);
      return { ...base, title, desc };
    }
    if ((m = /^\/product\/(\d+)$/.exec(pathname))) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(m[1]));
      if (p) {
        const name = (lang === 'pl' && p.name_pl) || p.name;
        const descr = (lang === 'pl' && p.description_pl) || p.description;
        const img = firstImage(p.id);
        const image = img ? `${site}/uploads/${img.filename}` : base.image;
        return {
          ...base, type: 'product', image,
          title: L.product(name, fmtPrice(p.price)),
          desc: clip(`${descr} ${L.productTail}`, 160),
          jsonld: {
            '@context': 'https://schema.org', '@type': 'Product', name, sku: p.sku, description: clip(descr, 500),
            image: [image], brand: { '@type': 'Brand', name: 'SHUL.FISH' },
            offers: {
              '@type': 'Offer', url: urlFor(pathname, lang), priceCurrency: 'PLN', price: (p.price / 100).toFixed(2),
              availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
              itemCondition: 'https://schema.org/NewCondition',
            },
          },
        };
      }
      return { ...base, status: 404, title: L.notFound, desc: L.home[1], robots: 'noindex' };
    }
    const simple = { '/delivery': 'delivery', '/terms': 'terms', '/privacy': 'privacy', '/cookies': 'cookies' }[pathname];
    if (simple) return { ...base, title: L[simple][0], desc: L[simple][1] };
    if (PRIVATE.test(pathname)) return { ...base, title: L.home[0], desc: L.home[1], robots: 'noindex,nofollow' };
    return { ...base, status: 404, title: L.notFound, desc: L.home[1], robots: 'noindex' };
  }

  /** index.html с подставленными мета-тегами страницы. */
  function renderPage(pathname, query) {
    const lang = query.get('lang') === 'pl' ? 'pl' : 'ru';
    const m = pageMeta(pathname, lang);
    const alt = m.robots.startsWith('index') ? [
      `<link rel="alternate" hreflang="ru" href="${escAttr(urlFor(m.path, 'ru'))}">`,
      `<link rel="alternate" hreflang="pl" href="${escAttr(urlFor(m.path, 'pl'))}">`,
      `<link rel="alternate" hreflang="x-default" href="${escAttr(urlFor(m.path, 'ru'))}">`,
    ] : [];
    const tags = [
      `<title>${escAttr(m.title)}</title>`,
      `<meta name="description" content="${escAttr(m.desc)}">`,
      `<meta name="robots" content="${m.robots}">`,
      `<link rel="canonical" href="${escAttr(urlFor(m.path, lang))}">`,
      ...alt,
      `<meta property="og:site_name" content="SHUL.FISH">`,
      `<meta property="og:type" content="${m.type}">`,
      `<meta property="og:url" content="${escAttr(urlFor(m.path, lang))}">`,
      `<meta property="og:title" content="${escAttr(m.title)}">`,
      `<meta property="og:description" content="${escAttr(m.desc)}">`,
      `<meta property="og:image" content="${escAttr(m.image)}">`,
      `<meta property="og:locale" content="${lang === 'pl' ? 'pl_PL' : 'ru_RU'}">`,
      `<meta property="og:locale:alternate" content="${lang === 'pl' ? 'ru_RU' : 'pl_PL'}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    ];
    if (m.jsonld) tags.push(`<script type="application/ld+json">${JSON.stringify(m.jsonld).replace(/</g, '\\u003c')}</script>`);
    const html = getTemplate()
      .replace(/<html lang="[a-z]+">/, `<html lang="${lang}">`)
      .replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, `<!--seo-->\n  ${tags.join('\n  ')}\n  <!--/seo-->`);
    return { status: m.status, html };
  }

  function sitemap() {
    const today = new Date().toISOString().slice(0, 10);
    const pages = [
      { p: '/', pr: '1.0', cf: 'daily' }, { p: '/catalog', pr: '0.9', cf: 'daily' },
      ...Object.keys(CATEGORIES).map((c) => ({ p: `/catalog/${c}`, pr: '0.8', cf: 'daily' })),
      ...db.prepare('SELECT id, updated_at FROM products WHERE active = 1 ORDER BY id').all()
        .map((r) => ({ p: `/product/${r.id}`, pr: '0.7', cf: 'weekly', lm: String(r.updated_at || '').slice(0, 10) })),
      { p: '/delivery', pr: '0.5', cf: 'monthly' },
      { p: '/terms', pr: '0.2', cf: 'yearly' }, { p: '/privacy', pr: '0.2', cf: 'yearly' }, { p: '/cookies', pr: '0.1', cf: 'yearly' },
    ];
    const x = (s) => escAttr(s);
    const entry = (pg, lang) => `  <url>
    <loc>${x(urlFor(pg.p, lang))}</loc>
    <lastmod>${pg.lm || today}</lastmod>
    <changefreq>${pg.cf}</changefreq>
    <priority>${pg.pr}</priority>
    <xhtml:link rel="alternate" hreflang="ru" href="${x(urlFor(pg.p, 'ru'))}"/>
    <xhtml:link rel="alternate" hreflang="pl" href="${x(urlFor(pg.p, 'pl'))}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${x(urlFor(pg.p, 'ru'))}"/>
  </url>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.flatMap((pg) => [entry(pg, 'ru'), entry(pg, 'pl')]).join('\n')}
</urlset>
`;
  }

  function robots() {
    return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /account
Disallow: /cart
Disallow: /login
Disallow: /register

Sitemap: ${site}/sitemap.xml
`;
  }

  return { renderPage, sitemap, robots, pageMeta };
}

module.exports = { createSeo };
