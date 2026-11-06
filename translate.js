'use strict';
/*
 * Перевод названий и описаний товаров RU → PL.
 *
 * Названия: собственный словарь рыб и способов обработки с польскими окончаниями
 * (машинный перевод путает: «плотва» → «karaluch» — таракан). Если в названии есть
 * незнакомые слова — онлайн-переводчик MyMemory. Описания — MyMemory.
 * TRANSLATE_URL=off — без онлайн-перевода (тесты, нет интернета).
 */

// Существительные: [польский, род (f/m/n/pl), родительный падеж для «из …»]
const NOUNS = {
  'скумбрия': ['makrela', 'f', 'makreli'],
  'макрель': ['makrela', 'f', 'makreli'],
  'плотва': ['płoć', 'f', 'płoci'],
  'вобла': ['wobła', 'f', 'wobły'],
  'тарань': ['taranka', 'f', 'taranki'],
  'лещ': ['leszcz', 'm', 'leszcza'],
  'чехонь': ['ciosa', 'f', 'ciosy'],
  'вомер': ['womer', 'm', 'womera'],
  'дорада': ['dorada', 'f', 'dorady'],
  'сибас': ['labraks', 'm', 'labraksa'],
  'лосось': ['łosoś', 'm', 'łososia'],
  'семга': ['łosoś atlantycki', 'm', 'łososia atlantyckiego'],
  'сёмга': ['łosoś atlantycki', 'm', 'łososia atlantyckiego'],
  'форель': ['pstrąg', 'm', 'pstrąga'],
  'горбуша': ['gorbusza', 'f', 'gorbuszy'],
  'кета': ['keta', 'f', 'kety'],
  'нерка': ['nerka', 'f', 'nerki'],
  'кижуч': ['kiżucz', 'm', 'kiżucza'],
  'масляная': ['ryba maślana', 'f', 'ryby maślanej'],
  'масляная рыба': ['ryba maślana', 'f', 'ryby maślanej'],
  'эсколар': ['eskolar', 'm', 'eskolara'],
  'корюшка': ['stynka', 'f', 'stynki'],
  'анчоус': ['sardela', 'f', 'sardeli'],
  'хамса': ['sardela', 'f', 'sardeli'],
  'килька': ['szprot', 'm', 'szprota'],
  'шпроты': ['szproty', 'pl', 'szprotów'],
  'кальмар': ['kałamarnica', 'f', 'kałamarnicy'],
  'хек': ['morszczuk', 'm', 'morszczuka'],
  'минтай': ['mintaj', 'm', 'mintaja'],
  'треска': ['dorsz', 'm', 'dorsza'],
  'пикша': ['plamiak', 'm', 'plamiaka'],
  'сельдь': ['śledź', 'm', 'śledzia'],
  'селедка': ['śledź', 'm', 'śledzia'],
  'селёдка': ['śledź', 'm', 'śledzia'],
  'омуль': ['omul', 'm', 'omula'],
  'сиг': ['sieja', 'f', 'siei'],
  'судак': ['sandacz', 'm', 'sandacza'],
  'щука': ['szczupak', 'm', 'szczupaka'],
  'карп': ['karp', 'm', 'karpia'],
  'сом': ['sum', 'm', 'suma'],
  'угорь': ['węgorz', 'm', 'węgorza'],
  'палтус': ['halibut', 'm', 'halibuta'],
  'камбала': ['flądra', 'f', 'flądry'],
  'тунец': ['tuńczyk', 'm', 'tuńczyka'],
  'осетр': ['jesiotr', 'm', 'jesiotra'],
  'осётр': ['jesiotr', 'm', 'jesiotra'],
  'креветки': ['krewetki', 'pl', 'krewetek'],
  'креветка': ['krewetka', 'f', 'krewetki'],
  'мидии': ['małże', 'pl', 'małży'],
  'осьминог': ['ośmiornica', 'f', 'ośmiornicy'],
  'икра': ['ikra', 'f', 'ikry'],
  'юкола': ['jukola', 'f', 'jukoli'],
  'балык': ['balyk', 'm', 'balyku'],
  'филе': ['filet', 'm', 'fileta'],
  'стейк': ['stek', 'm', 'steku'],
  'тушка': ['tuszka', 'f', 'tuszki'],
  'спинка': ['grzbiet', 'm', 'grzbietu'],
  'брюшки': ['boczki', 'pl', 'boczków'],
  'набор': ['zestaw', 'm', 'zestawu'],
  'рыба': ['ryba', 'f', 'ryby'],
};
// Признаки после существительного: основа + окончание по роду
const ADJ = [
  [/^холодного копчения$/, (g) => `wędzon${end(g)} na zimno`],
  [/^горячего копчения$/, (g) => `wędzon${end(g)} na gorąco`],
  [/^(копч[её]н(ый|ая|ое|ые)|копчен(ый|ая|ое|ые))$/, (g) => `wędzon${end(g)}`],
  [/^(вялен(ый|ая|ое|ые)|сушен(ый|ая|ое|ые)|суш[её]н(ый|ая|ое|ые))$/, (g) => `suszon${end(g)}`],
  [/^(малосол[её]н(ый|ая|ое|ые)|слабосол[её]н(ый|ая|ое|ые)|малосольн(ый|ая|ое|ые))$/, (g) => `lekko solon${end(g)}`],
  [/^(сол[её]н(ый|ая|ое|ые))$/, (g) => `solon${end(g)}`],
  [/^(морож[её]нн?(ый|ая|ое|ые)|заморож[её]нн?(ый|ая|ое|ые)|мороженн?(ый|ая|ое|ые))$/, (g) => `mrożon${end(g)}`],
  [/^(маринованн?(ый|ая|ое|ые))$/, (g) => `marynowan${end(g)}`],
  [/^(охлажд[её]нн?(ый|ая|ое|ые))$/, (g) => `schłodzon${end(g)}`],
  [/^(свеж(ий|ая|ее|ие))$/, (g) => `śwież${end(g)}`],
  [/^(жарен(ый|ая|ое|ые)|жар[её]нн?(ый|ая|ое|ые))$/, (g) => `smażon${end(g)}`],
  [/^(запеч[её]нн?(ый|ая|ое|ые))$/, (g) => `pieczon${end(g)}`],
  [/^(красн(ый|ая|ое|ые))$/, (g) => `czerwon${end(g)}`],
  [/^(ч[её]рн(ый|ая|ое|ые))$/, (g) => `czarn${end(g)}`],
  [/^(потрошен(ый|ая|ое|ые)|потрош[её]нн?(ый|ая|ое|ые))$/, (g) => `patroszon${end(g)}`],
  [/^(целиком|цел(ый|ая|ое|ые))$/, () => 'w całości'],
  [/^(нарезка)$/, () => 'w plastrach'],
];
// Родительный падеж: «из лосося», «икра горбуши», «филе трески»
const GEN = {
  'лосося': 'łososia', 'семги': 'łososia atlantyckiego', 'форели': 'pstrąga', 'трески': 'dorsza', 'горбуши': 'gorbuszy',
  'кеты': 'kety', 'нерки': 'nerki', 'кижуча': 'kiżucza', 'кальмара': 'kałamarnicy', 'тунца': 'tuńczyka', 'сельди': 'śledzia',
  'скумбрии': 'makreli', 'хека': 'morszczuka', 'минтая': 'mintaja', 'щуки': 'szczupaka', 'осетра': 'jesiotra',
  'креветок': 'krewetek', 'палтуса': 'halibuta', 'сома': 'suma', 'карпа': 'karpia', 'угря': 'węgorza', 'судака': 'sandacza',
  'мойвы': 'gromadnika', 'летучей рыбы': 'ryby latającej', 'щучья': 'szczupaka',
};
const end = (g) => ({ f: 'a', m: 'y', n: 'e', pl: 'e' }[g] || 'a');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Название целиком по словарю, или null, если есть незнакомые слова
function nameByGlossary(ru) {
  let text = String(ru).toLowerCase().replace(/ё/g, 'е').replace(/[«»"„”]/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = (s) => s.replace(/ё/g, 'е');
  if (!text) return null;
  // «… (1 кг)», «500 г» — оставляем числа и единицы
  const extras = [];
  text = text.replace(/\(?\s*(\d+(?:[.,]\d+)?)\s*(кг|г|гр|шт)\.?\s*\)?/g, (_, n, u) => { extras.push(`${n} ${{ кг: 'kg', г: 'g', гр: 'g', шт: 'szt.' }[u]}`); return ' '; }).replace(/\s+/g, ' ').trim();
  // «с икрой», «из лосося», «без головы»
  let withPart = '';
  const parts = [];
  const nounKeys = Object.keys(NOUNS).map(norm).sort((a, b) => b.length - a.length);
  const nounOf = (k) => NOUNS[Object.keys(NOUNS).find((x) => norm(x) === k)];
  // в JS \b не работает с кириллицей — границы слов задаём пробелами
  text = ` ${text} `.replace(/ с икрой /, () => { withPart = 'z ikrą'; return ' '; })
    .replace(/ без головы /, () => { parts.push('bez głowy'); return ' '; })
    .replace(/\s+/g, ' ').trim();
  let fromPart = '';
  const fromM = /(?:^| )из (.+)$/.exec(text);
  if (fromM) {
    const gen = GEN[fromM[1].trim()];
    if (!gen) return null;
    fromPart = `z ${gen}`;
    text = text.slice(0, fromM.index).trim();
  }
  // существительное: самое длинное совпадение в начале или в конце
  let noun = null;
  for (const k of nounKeys) {
    if (text === k || text.startsWith(k + ' ')) { noun = nounOf(k); text = text.slice(k.length).trim(); break; }
    if (text.endsWith(' ' + k)) { noun = nounOf(k); text = text.slice(0, -k.length).trim(); break; }
  }
  if (!noun) return null;
  const [pl, g] = noun;
  const adjs = [];
  // «икра горбуши», «филе трески» — существительное в родительном падеже сразу после
  let ofPart = '';
  for (const [ru, plGen] of Object.entries(GEN).sort((a, b) => b[0].length - a[0].length)) {
    if (text === ru || text.startsWith(ru + ' ')) { ofPart = plGen; text = text.slice(ru.length).trim(); break; }
  }
  // оставшиеся слова — признаки; «холодного копчения» — из двух слов
  let rest = text ? text.split(' ') : [];
  while (rest.length) {
    const two = rest.slice(0, 2).join(' ');
    let hit = ADJ.find(([re]) => re.test(two));
    if (hit && rest.length >= 2) { adjs.push(hit[1](g)); rest = rest.slice(2); continue; }
    hit = ADJ.find(([re]) => re.test(rest[0]));
    if (!hit) return null;
    adjs.push(hit[1](g));
    rest = rest.slice(1);
  }
  return cap([pl, ofPart, ...adjs, withPart, fromPart, ...parts, extras.length ? `(${extras.join(', ')})` : ''].filter(Boolean).join(' '));
}

// Частые ошибки машинного перевода рыбной тематики
const FIXES = [
  [/\bkaraluch(a|y|ów|em|e)?\b/gi, 'płoć'],
  [/\bz kawiorem\b/gi, 'z ikrą'], // рыба «с икрой» — это ikra, kawior — только чёрная икра
  [/\bna chipsach olszowych\b/gi, 'na zrębkach olchowych'],
  [/\bchipsach\b/gi, 'zrębkach'],
  [/\bolszow(ych|ym|ej|e)\b/gi, 'olchow$1'],
  [/\bwędzon(y|a|e) na zimno dymem\b/gi, 'wędzon$1 na zimno'],
];
const fixMt = (t) => FIXES.reduce((s, [re, to]) => s.replace(re, to), t);

function createTranslator({ url = process.env.TRANSLATE_URL || 'https://api.mymemory.translated.net/get' } = {}) {
  const cache = new Map();
  async function online(text) {
    if (url === 'off') return null;
    const key = text;
    if (cache.has(key)) return cache.get(key);
    try {
      // TRANSLATE_EMAIL — e-mail магазина для MyMemory: дневной лимит 50 000 символов вместо 5 000
      const de = process.env.TRANSLATE_EMAIL ? `&de=${encodeURIComponent(process.env.TRANSLATE_EMAIL)}` : '';
      const res = await fetch(`${url}?langpair=ru|pl${de}&q=${encodeURIComponent(text)}`, {
        headers: { 'User-Agent': 'SHUL.FISH shop (shulfish.pl)' }, signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const d = await res.json();
      const out = d && d.responseStatus == 200 && d.responseData && String(d.responseData.translatedText || '').trim();
      // MyMemory при превышении лимита возвращает текст ошибки вместо перевода
      if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) return null;
      const fixed = fixMt(out);
      if (cache.size > 1000) cache.clear();
      cache.set(key, fixed);
      return fixed;
    } catch { return null; }
  }
  return {
    async name(ru) {
      const g = nameByGlossary(ru);
      if (g) return { text: g, source: 'glossary' };
      const t = await online(ru);
      return t ? { text: cap(t), source: 'online' } : null;
    },
    async text(ru) {
      const chunks = [];
      let cur = '';
      for (const part of String(ru).split(/(?<=[.!?\n])\s+/)) {
        if ((cur + ' ' + part).length > 450 && cur) { chunks.push(cur); cur = part; } else cur = cur ? cur + ' ' + part : part;
      }
      if (cur) chunks.push(cur);
      const out = [];
      for (const c of chunks.slice(0, 8)) {
        const t = await online(c.slice(0, 480));
        if (!t) return null;
        out.push(t);
      }
      return out.length ? { text: out.join(' '), source: 'online' } : null;
    },
  };
}

module.exports = { createTranslator, nameByGlossary };
