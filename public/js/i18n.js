'use strict';
/* SHUL.FISH — переводы витрины: русский и польский. Админка остаётся на русском. */

const LANGS = ['ru', 'pl'];
let LANG = (() => {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(fromUrl)) { try { localStorage.setItem('sf_lang', fromUrl); } catch { /* приватный режим */ } return fromUrl; }
  try { const saved = localStorage.getItem('sf_lang'); if (LANGS.includes(saved)) return saved; } catch { /* приватный режим */ }
  return /^pl\b/i.test(navigator.language || '') ? 'pl' : 'ru';
})();
const LOCALE = () => (LANG === 'pl' ? 'pl-PL' : 'ru-RU');

const I18N = {
  ru: {
    'meta.title': 'SHUL.FISH — копчёная, вяленая рыба и икра в Варшаве',
    'meta.desc': 'SHUL.FISH — премиальная копчёная, вяленая и сушёная рыба, красная и чёрная икра с доставкой по Варшаве.',
    'nav.catalog': 'Каталог', 'nav.fresh': 'Свежая', 'nav.seafood': 'Морепродукты', 'nav.smoked': 'Копчёная', 'nav.cured': 'Вяленая', 'nav.dried': 'Сушёная', 'nav.salted': 'Малосольная', 'nav.caviar': 'Икра', 'nav.frozen': 'Заморозка', 'nav.delivery': 'Доставка',
    'nav.account': 'Личный кабинет', 'nav.cart': 'Корзина', 'nav.menu': 'Меню', 'nav.admin': 'Панель управления', 'nav.login': 'Войти',
    'nav.accountOf': 'Кабинет: {name}', 'lang.switch': 'Język polski',
    'foot.tagline': 'Копчёная, вяленая, сушёная рыба и икра. Premium quality.',
    'foot.delivery': 'Доставка', 'foot.deliveryText': 'Курьером в день заказа — в радиусе 7 км от Bazaru Trocka (Таргувек).<br>Самовывоз — по договорённости.',
    'foot.contacts': 'Контакты', 'foot.contactsText': 'Warszawa, Polska<br>Пн–Вс 10:00–21:00',
    'legal.terms': 'Правила магазина', 'legal.privacy': 'Политика конфиденциальности', 'legal.cookies': 'Cookies',
    'common.error': 'Ошибка', 'common.notFound': 'Страница не найдена', 'common.home': 'На главную', 'common.cancel': 'Отмена', 'common.save': 'Сохранить',
    'common.saved': 'Сохранено', 'common.serverDown': 'Сервер недоступен', 'common.errorCode': 'Ошибка {code}',
    'card.outOfStock': 'Нет в наличии', 'card.toCart': 'В корзину', 'card.none': 'Нет', 'cart.added': '«{name}» добавлено в корзину',
    'home.kind1': 'Копчёная', 'home.kind2': 'Вяленая', 'home.kind3': 'Сушёная', 'home.plaque': 'РЫБА &amp; ИКРА',
    'home.toCatalog': 'Перейти в каталог', 'home.caviar': 'Икра', 'home.logoAlt': 'SHUL.FISH — копчёная, вяленая, сушёная рыба и икра',
    'home.f1': 'Натуральный продукт', 'home.f1s': 'Без красителей и ароматизаторов',
    'home.f2': 'Высокое качество', 'home.f2s': 'Проверенные поставщики',
    'home.f3': 'Доставка по Варшаве и пригородам', 'home.f3s': 'Курьером в день заказа',
    'home.categories': 'Категории', 'home.hits': 'Хиты продаж', 'home.soon': 'Скоро здесь появятся товары', 'home.allCatalog': 'Весь каталог',
    'home.c.smoked': 'Копчёная', 'home.c.smoked.s': 'Горячего и холодного копчения',
    'home.c.cured': 'Вяленая', 'home.c.cured.s': 'Вобла, тарань, лещ, чехонь',
    'home.c.dried': 'Сушёная', 'home.c.dried.s': 'Корюшка, анчоус, кальмар',
    'home.c.caviar': 'Икра', 'home.c.caviar.s': 'Красная и чёрная', 'home.c.fresh': 'Свежая', 'home.c.fresh.s': 'Охлаждённая рыба на развес', 'home.c.seafood': 'Морепродукты', 'home.c.seafood.s': 'Креветки, мидии, кальмары', 'home.c.salted': 'Малосольная', 'home.c.salted.s': 'Сельдь, лосось, скумбрия', 'home.c.frozen': 'Заморозка', 'home.c.frozen.s': 'Рыба и морепродукты',
    'cat.title': 'Каталог', 'cat.all': 'Все', 'cat.search': 'Поиск…', 'cat.sortPop': 'По популярности', 'cat.sortCheap': 'Сначала дешевле',
    'cat.sortExp': 'Сначала дороже', 'cat.sortName': 'По названию', 'cat.nothing': 'Ничего не найдено', 'cat.tryOther': 'Попробуйте изменить запрос',
    'p.sku': 'Артикул', 'p.availability': 'Наличие', 'p.inStock': 'В наличии', 'p.outOfStock': 'Нет в наличии', 'p.step': 'Фасовка',
    'p.stepKg': 'упаковка ≈1 кг (900–1100 г), цена за 1 кг — итог по фактическому весу', 'p.stepPiece': 'поштучно, 1 шт. ≈ {g} г; цена за 1 кг — итог по фактическому весу', 'p.perKg': 'кг', 'p.piece': '≈ {g} г / шт.', 'p.edit': '✎ Редактировать товар',
    'del.title': 'Доставка и оплата', 'del.city': 'Курьерская доставка', 'del.price': 'Стоимость доставки', 'del.priceKm': '2 zł за каждый начатый километр', 'del.priceMin': 'минимум 10 zł', 'del.pricePickup': 'Самовывоз — бесплатно', 'del.priceNote': 'Расстояние считается по прямой от Bazaru Trocka (Таргувек) до вашего адреса. Точная стоимость показывается в корзине сразу после ввода адреса.', 'del.priceTable': 'до 5 км — 10 zł · 5–6 км — 12 zł · 6–7 км — 14 zł', 'foot.deliveryPrice': '2 zł/км, минимум 10 zł', 'del.areas': 'Куда доставляем', 'del.radius': 'В радиусе 7 км от Bazaru Trocka (Таргувек). Расстояние проверяется автоматически по адресу при оформлении заказа. В том числе:',
    'del.cityText': 'Курьер привезёт заказ в день оформления при заказе до 16:00. Менеджер позвонит для подтверждения состава и времени.',
    'del.pickup': 'Самовывоз', 'del.pickupText': 'Забрать заказ можно по договорённости с менеджером.',
    'del.weight': 'Фасовка', 'del.weightText': 'Продукция фасуется упаковками примерно по 1 кг — фактический вес от 900 до 1100 г. Цена на сайте указана за 1 кг, сумма в корзине предварительная. Точную сумму по весу менеджер сообщит при подтверждении заказа.',
    'del.pay': 'Оплата', 'del.payText': 'Наличными или картой курьеру, BLIK, переводом на счёт.',
    'del.store': 'Хранение', 'del.storeText': 'Копчёную рыбу и икру храните в холодильнике при +2…+6 °C. Вяленую и сушёную — в сухом прохладном месте. Малосольную — в холодильнике при +2…+6 °C. Свежую рыбу и охлаждённые морепродукты — при 0…+2 °C, лучше приготовить в течение 1–2 дней. Замороженную продукцию — в морозильной камере при −18 °C, повторно не замораживать.',
    'cart.title': 'Корзина', 'cart.empty': 'Корзина пуста', 'cart.emptyText': 'Загляните в каталог — там много вкусного.', 'cart.toCatalog': 'В каталог',
    'cart.checkout': 'Оформление заказа', 'f.name': 'Имя', 'f.phone': 'Телефон', 'f.email': 'E-mail', 'f.password': 'Пароль',
    'cart.courier': 'Курьер', 'cart.pickup': 'Самовывоз', 'cart.area': 'Район / город', 'cart.address': 'Адрес доставки', 'cart.addressPh': 'ул., дом, кв.',
    'cart.comment': 'Комментарий', 'cart.commentPh': 'Удобное время, домофон…', 'cart.total': 'Итого ≈', 'cart.goods': 'Товары ≈', 'cart.delivery': 'Доставка', 'cart.dFree': 'бесплатно', 'cart.dEnter': 'укажите адрес', 'cart.dCalc': 'считаем…', 'cart.dKm': '{km} км × {rate} zł = {sum}', 'cart.dMin': '{km} км — минимум {sum}', 'cart.dUnknown': 'уточнит менеджер', 'cart.dRowKm': '{km} км × {rate} zł/км', 'cart.dRowMin': '{km} км — минимальная стоимость', 'cart.dRowPickup': 'Самовывоз', 'cart.dRowNoAddr': 'стоимость появится после ввода адреса', 'cart.weightNote': 'Упаковка весит 900–1100 г. Точную сумму по фактическому весу менеджер сообщит при подтверждении заказа.', 'cart.order': 'Заказать с обязательством оплаты', 'hours.bar': 'Приём заказов: {days}, {from}–{to}', 'hours.open': 'сейчас принимаем', 'hours.closed': 'сейчас закрыто', 'hours.daily': 'ежедневно', 'cart.closed': 'Заказы на сайте принимаются {days} с {from} до {to}. Сейчас приём закрыт — корзина сохранится, оформите заказ в это время. Вопросы — по телефону +48 576 230 707.', 'cart.paused': 'Приём заказов временно приостановлен. Каталог можно смотреть, а оформить заказ получится чуть позже. Вопросы — по телефону +48 576 230 707.',
    'cart.loginHint': '<a href="/login" style="color:var(--gold-2)">Войдите</a>, чтобы видеть историю заказов.', 'cart.remove': 'Удалить',
    'cart.thanks': 'Спасибо! Заказ №{id} принят', 'cart.thanksText': 'Предварительная сумма: <b style="color:var(--gold-2)">{sum}</b>. Менеджер позвонит по номеру {phone} и назовёт точную сумму по весу.',
    'cart.continue': 'Продолжить покупки',
    'consent': 'Я принимаю <a href="/terms" target="_blank">правила магазина</a> и <a href="/privacy" target="_blank">политику конфиденциальности</a>',
    'auth.login': 'Вход', 'auth.register': 'Регистрация', 'auth.create': 'Создать аккаунт', 'auth.enter': 'Войти', 'auth.welcome': 'Добро пожаловать, {name}!',
    'acc.title': 'Личный кабинет', 'acc.orders': 'Мои заказы', 'acc.noOrders': 'Заказов пока нет', 'acc.admin': 'Панель управления',
    'acc.oldPw': 'Текущий пароль', 'acc.newPw': 'Новый пароль', 'acc.logout': 'Выйти', 'acc.loggedOut': 'Вы вышли из аккаунта',
    'acc.delete': 'Удалить аккаунт и мои данные', 'acc.delTitle': 'Удаление аккаунта',
    'acc.delText': 'Аккаунт и личные данные профиля будут удалены безвозвратно. Данные уже оформленных заказов мы обязаны хранить для бухгалтерии (см. <a href="/privacy" style="color:var(--gold-2)">политику конфиденциальности</a>), но они больше не будут связаны с аккаунтом.',
    'acc.delPw': 'Пароль для подтверждения', 'acc.delBtn': 'Удалить навсегда', 'acc.deleted': 'Аккаунт удалён',
    'order.n': 'Заказ №{id}', 'order.sum': 'Сумма', 'order.sumEst': 'Предварительная сумма', 'order.sumFinal': 'Сумма по весу', 'order.goods': 'Товары', 'order.goodsEst': 'Товары (предварительно)', 'order.goodsFinal': 'Товары по весу', 'order.delivery': 'Доставка', 'order.dUnknown': 'уточнит менеджер',
    'role.admin': 'Администратор', 'role.manager': 'Менеджер', 'role.courier': 'Курьер', 'role.customer': 'Покупатель',
    'cookie.text': 'Мы используем необходимые cookies для входа в аккаунт и корзины. На сайте показывается реклама Google: рекламные cookies — только с вашего согласия, его можно изменить в «Настройках рекламы» внизу страницы.', 'cookie.more': 'Подробнее', 'cookie.ok': 'Понятно', 'legal.adPrefs': 'Настройки рекламы',
    'legal.effective': 'Действует с {date}', 'legal.other': 'Другие документы:', 'legal.incomplete': '⚠ Реквизиты продавца ещё не заполнены. Владелец сайта должен вписать их в <code>public/js/legal.js</code>.',
  },
  pl: {
    'meta.title': 'SHUL.FISH — ryby wędzone, suszone i ikra w Warszawie',
    'meta.desc': 'SHUL.FISH — ryby wędzone, suszone i przekąski rybne premium, ikra czerwona i kawior z dostawą w Warszawie.',
    'nav.catalog': 'Katalog', 'nav.fresh': 'Świeże', 'nav.seafood': 'Owoce morza', 'nav.smoked': 'Wędzone', 'nav.cured': 'Suszone', 'nav.dried': 'Przekąski', 'nav.salted': 'Solone', 'nav.caviar': 'Ikra', 'nav.frozen': 'Mrożonki', 'nav.delivery': 'Dostawa',
    'nav.account': 'Moje konto', 'nav.cart': 'Koszyk', 'nav.menu': 'Menu', 'nav.admin': 'Panel zarządzania', 'nav.login': 'Zaloguj się',
    'nav.accountOf': 'Konto: {name}', 'lang.switch': 'Русский язык',
    'foot.tagline': 'Ryby wędzone, suszone, przekąski rybne i ikra. Premium quality.',
    'foot.delivery': 'Dostawa', 'foot.deliveryText': 'Kurierem w dniu zamówienia — w promieniu 7 km od Bazaru Trocka (Targówek).<br>Odbiór osobisty — po uzgodnieniu.',
    'foot.contacts': 'Kontakt', 'foot.contactsText': 'Warszawa, Polska<br>Pn–Nd 10:00–21:00',
    'legal.terms': 'Regulamin sklepu', 'legal.privacy': 'Polityka prywatności', 'legal.cookies': 'Cookies',
    'common.error': 'Błąd', 'common.notFound': 'Nie znaleziono strony', 'common.home': 'Strona główna', 'common.cancel': 'Anuluj', 'common.save': 'Zapisz',
    'common.saved': 'Zapisano', 'common.serverDown': 'Serwer jest niedostępny', 'common.errorCode': 'Błąd {code}',
    'card.outOfStock': 'Brak w magazynie', 'card.toCart': 'Do koszyka', 'card.none': 'Brak', 'cart.added': 'Dodano do koszyka: „{name}”',
    'home.kind1': 'Wędzone', 'home.kind2': 'Suszone', 'home.kind3': 'Przekąski', 'home.plaque': 'RYBY &amp; IKRA',
    'home.toCatalog': 'Przejdź do katalogu', 'home.caviar': 'Ikra', 'home.logoAlt': 'SHUL.FISH — ryby wędzone, suszone i ikra',
    'home.f1': 'Naturalny produkt', 'home.f1s': 'Bez barwników i aromatów',
    'home.f2': 'Wysoka jakość', 'home.f2s': 'Sprawdzeni dostawcy',
    'home.f3': 'Dostawa w Warszawie i okolicach', 'home.f3s': 'Kurierem w dniu zamówienia',
    'home.categories': 'Kategorie', 'home.hits': 'Bestsellery', 'home.soon': 'Wkrótce pojawią się tu produkty', 'home.allCatalog': 'Cały katalog',
    'home.c.smoked': 'Wędzone', 'home.c.smoked.s': 'Wędzone na gorąco i na zimno',
    'home.c.cured': 'Suszone', 'home.c.cured.s': 'Wobła, taranka, leszcz, ciosa',
    'home.c.dried': 'Przekąski', 'home.c.dried.s': 'Stynka, sardela, kałamarnica',
    'home.c.caviar': 'Ikra', 'home.c.caviar.s': 'Czerwona ikra i kawior', 'home.c.fresh': 'Świeże', 'home.c.fresh.s': 'Schłodzone ryby na wagę', 'home.c.seafood': 'Owoce morza', 'home.c.seafood.s': 'Krewetki, małże, kałamarnice', 'home.c.salted': 'Lekko solone', 'home.c.salted.s': 'Śledź, łosoś, makrela', 'home.c.frozen': 'Mrożonki', 'home.c.frozen.s': 'Ryby i owoce morza',
    'cat.title': 'Katalog', 'cat.all': 'Wszystkie', 'cat.search': 'Szukaj…', 'cat.sortPop': 'Najpopularniejsze', 'cat.sortCheap': 'Od najtańszych',
    'cat.sortExp': 'Od najdroższych', 'cat.sortName': 'Według nazwy', 'cat.nothing': 'Nic nie znaleziono', 'cat.tryOther': 'Spróbuj zmienić zapytanie',
    'p.sku': 'Kod produktu', 'p.availability': 'Dostępność', 'p.inStock': 'Dostępny', 'p.outOfStock': 'Brak w magazynie', 'p.step': 'Opakowanie',
    'p.stepKg': 'opakowanie ≈1 kg (900–1100 g), cena za 1 kg — kwota wg rzeczywistej wagi', 'p.stepPiece': 'na sztuki, 1 szt. ≈ {g} g; cena za 1 kg — kwota wg rzeczywistej wagi', 'p.perKg': 'kg', 'p.piece': '≈ {g} g / szt.', 'p.edit': '✎ Edytuj produkt',
    'del.title': 'Dostawa i płatność', 'del.city': 'Dostawa kurierska', 'del.price': 'Koszt dostawy', 'del.priceKm': '2 zł za każdy rozpoczęty kilometr', 'del.priceMin': 'minimum 10 zł', 'del.pricePickup': 'Odbiór osobisty — bezpłatnie', 'del.priceNote': 'Odległość liczona jest w linii prostej od Bazaru Trocka (Targówek) do Twojego adresu. Dokładny koszt pojawia się w koszyku zaraz po wpisaniu adresu.', 'del.priceTable': 'do 5 km — 10 zł · 5–6 km — 12 zł · 6–7 km — 14 zł', 'foot.deliveryPrice': '2 zł/km, minimum 10 zł', 'del.areas': 'Gdzie dostarczamy', 'del.radius': 'W promieniu 7 km od Bazaru Trocka (Targówek). Odległość sprawdzamy automatycznie na podstawie adresu przy składaniu zamówienia. M.in.:',
    'del.cityText': 'Przy zamówieniu do 16:00 kurier dostarczy je tego samego dnia. Konsultant zadzwoni, aby potwierdzić skład zamówienia i godzinę dostawy.',
    'del.pickup': 'Odbiór osobisty', 'del.pickupText': 'Zamówienie można odebrać po wcześniejszym uzgodnieniu z konsultantem.',
    'del.weight': 'Opakowania', 'del.weightText': 'Produkty pakujemy w opakowania ok. 1 kg — rzeczywista waga od 900 do 1100 g. Cena w sklepie dotyczy 1 kg, kwota w koszyku jest orientacyjna. Dokładną kwotę wg wagi konsultant poda przy potwierdzeniu zamówienia.',
    'del.pay': 'Płatność', 'del.payText': 'Gotówką lub kartą u kuriera, BLIK, przelewem na konto.',
    'del.store': 'Przechowywanie', 'del.storeText': 'Ryby wędzone i ikrę przechowuj w lodówce w temp. +2…+6 °C. Ryby suszone i przekąski — w suchym, chłodnym miejscu. Ryby lekko solone — w lodówce w temp. +2…+6 °C. Świeże ryby i schłodzone owoce morza — w temp. 0…+2 °C, najlepiej przyrządzić w ciągu 1–2 dni. Mrożonki — w zamrażarce w temp. −18 °C, nie zamrażać ponownie po rozmrożeniu.',
    'cart.title': 'Koszyk', 'cart.empty': 'Koszyk jest pusty', 'cart.emptyText': 'Zajrzyj do katalogu — czeka tam wiele pyszności.', 'cart.toCatalog': 'Do katalogu',
    'cart.checkout': 'Składanie zamówienia', 'f.name': 'Imię', 'f.phone': 'Telefon', 'f.email': 'E-mail', 'f.password': 'Hasło',
    'cart.courier': 'Kurier', 'cart.pickup': 'Odbiór osobisty', 'cart.area': 'Dzielnica / miejscowość', 'cart.address': 'Adres dostawy', 'cart.addressPh': 'ulica, nr domu, nr mieszkania',
    'cart.comment': 'Komentarz', 'cart.commentPh': 'Dogodna godzina, domofon…', 'cart.total': 'Razem ≈', 'cart.goods': 'Produkty ≈', 'cart.delivery': 'Dostawa', 'cart.dFree': 'bezpłatnie', 'cart.dEnter': 'podaj adres', 'cart.dCalc': 'liczymy…', 'cart.dKm': '{km} km × {rate} zł = {sum}', 'cart.dMin': '{km} km — minimum {sum}', 'cart.dUnknown': 'poda konsultant', 'cart.dRowKm': '{km} km × {rate} zł/km', 'cart.dRowMin': '{km} km — koszt minimalny', 'cart.dRowPickup': 'Odbiór osobisty', 'cart.dRowNoAddr': 'koszt pojawi się po wpisaniu adresu', 'cart.weightNote': 'Opakowanie waży 900–1100 g. Dokładną kwotę wg rzeczywistej wagi konsultant poda przy potwierdzeniu zamówienia.', 'cart.order': 'Zamawiam z obowiązkiem zapłaty', 'hours.bar': 'Przyjmujemy zamówienia: {days}, {from}–{to}', 'hours.open': 'teraz otwarte', 'hours.closed': 'teraz zamknięte', 'hours.daily': 'codziennie', 'cart.closed': 'Zamówienia przez stronę przyjmujemy {days} w godz. {from}–{to}. Teraz jest zamknięte — koszyk zostanie zapisany, złóż zamówienie w tych godzinach. Pytania — pod numerem +48 576 230 707.', 'cart.paused': 'Przyjmowanie zamówień jest tymczasowo wstrzymane. Katalog można przeglądać, a zamówienie złożyć nieco później. Pytania — pod numerem +48 576 230 707.',
    'cart.loginHint': '<a href="/login" style="color:var(--gold-2)">Zaloguj się</a>, aby widzieć historię zamówień.', 'cart.remove': 'Usuń',
    'cart.thanks': 'Dziękujemy! Zamówienie nr {id} zostało przyjęte', 'cart.thanksText': 'Kwota orientacyjna: <b style="color:var(--gold-2)">{sum}</b>. Konsultant zadzwoni pod numer {phone} i poda dokładną kwotę wg wagi.',
    'cart.continue': 'Kontynuuj zakupy',
    'consent': 'Akceptuję <a href="/terms" target="_blank">regulamin sklepu</a> i <a href="/privacy" target="_blank">politykę prywatności</a>',
    'auth.login': 'Logowanie', 'auth.register': 'Rejestracja', 'auth.create': 'Załóż konto', 'auth.enter': 'Zaloguj się', 'auth.welcome': 'Witaj, {name}!',
    'acc.title': 'Moje konto', 'acc.orders': 'Moje zamówienia', 'acc.noOrders': 'Nie masz jeszcze zamówień', 'acc.admin': 'Panel zarządzania',
    'acc.oldPw': 'Obecne hasło', 'acc.newPw': 'Nowe hasło', 'acc.logout': 'Wyloguj się', 'acc.loggedOut': 'Wylogowano',
    'acc.delete': 'Usuń konto i moje dane', 'acc.delTitle': 'Usuwanie konta',
    'acc.delText': 'Konto i dane osobowe profilu zostaną trwale usunięte. Dane złożonych już zamówień musimy przechowywać do celów księgowych (zob. <a href="/privacy" style="color:var(--gold-2)">politykę prywatności</a>), ale nie będą one już powiązane z kontem.',
    'acc.delPw': 'Hasło w celu potwierdzenia', 'acc.delBtn': 'Usuń na zawsze', 'acc.deleted': 'Konto zostało usunięte',
    'order.n': 'Zamówienie nr {id}', 'order.sum': 'Kwota', 'order.sumEst': 'Kwota orientacyjna', 'order.sumFinal': 'Kwota wg wagi', 'order.goods': 'Produkty', 'order.goodsEst': 'Produkty (orientacyjnie)', 'order.goodsFinal': 'Produkty wg wagi', 'order.delivery': 'Dostawa', 'order.dUnknown': 'poda konsultant',
    'role.admin': 'Administrator', 'role.manager': 'Menedżer', 'role.courier': 'Kurier', 'role.customer': 'Klient',
    'cookie.text': 'Używamy niezbędnych plików cookies do logowania i obsługi koszyka. Na stronie wyświetlane są reklamy Google: reklamowe pliki cookies — tylko za Twoją zgodą, którą możesz zmienić w „Ustawieniach reklam” na dole strony.', 'cookie.more': 'Więcej', 'cookie.ok': 'Rozumiem', 'legal.adPrefs': 'Ustawienia reklam',
    'legal.effective': 'Obowiązuje od {date}', 'legal.other': 'Pozostałe dokumenty:', 'legal.incomplete': '⚠ Dane sprzedawcy nie zostały jeszcze uzupełnione. Właściciel strony musi wpisać je w pliku <code>public/js/legal.js</code>.',
  },
};

// Названия, которые приходят из справочников
const CAT_NAMES = {
  ru: { fresh: 'Свежая рыба', smoked: 'Копчёная рыба', cured: 'Вяленая рыба', dried: 'Сушёная рыба', salted: 'Малосольная продукция', caviar: 'Икра', seafood: 'Морепродукты', frozen: 'Замороженная продукция', sets: 'Наборы' },
  pl: { fresh: 'Świeże ryby', smoked: 'Ryby wędzone', cured: 'Ryby suszone', dried: 'Przekąski rybne', salted: 'Lekko solone', caviar: 'Ikra i kawior', seafood: 'Owoce morza', frozen: 'Mrożonki', sets: 'Zestawy' },
};
// Зона доставки (ключи совпадают с DELIVERY_AREAS на сервере)
const DELIVERY_AREAS = [
  ['warszawa', { ru: 'Варшава (Таргувек, Брудно, Прага, Белоленка и др.)', pl: 'Warszawa (Targówek, Bródno, Praga, Białołęka i in.)' }],
  ['zabki', { ru: 'Зомбки (Ząbki)', pl: 'Ząbki' }],
  ['marki', { ru: 'Марки (Marki)', pl: 'Marki' }],
  ['zielonka', { ru: 'Зелёнка (Zielonka), ближняя часть', pl: 'Zielonka (bliższa część)' }],
];
const UNIT_NAMES = { pl: { 'кг': 'kg', 'шт': 'szt.', 'банка': 'słoik', 'уп': 'opak.' } };
const STATUS_NAMES = {
  ru: { new: 'Новый', confirmed: 'Подтверждён', assembling: 'Собирается', delivering: 'В доставке', done: 'Выполнен', cancelled: 'Отменён' },
  pl: { new: 'Nowe', confirmed: 'Potwierdzone', assembling: 'W kompletacji', delivering: 'W doręczeniu', done: 'Zrealizowane', cancelled: 'Anulowane' },
};

function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) ?? I18N.ru[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}
const catName = (code) => CAT_NAMES[LANG][code] || CAT_NAMES.ru[code] || code;
const unitName = (u) => (UNIT_NAMES[LANG] && UNIT_NAMES[LANG][u]) || u;
const statusName = (s) => STATUS_NAMES[LANG][s] || s;
// Метки на карточках задаются в админке свободным текстом — переводим частые
const BADGES_PL = { 'ХИТ': 'HIT', 'НОВИНКА': 'NOWOŚĆ', 'НОВОЕ': 'NOWOŚĆ', 'АКЦИЯ': 'PROMOCJA', 'СКИДКА': 'RABAT', 'ПОДАРОК': 'PREZENT', 'НАБОР': 'ZESTAW' };
const badgeName = (b) => (LANG === 'pl' && BADGES_PL[String(b).toUpperCase()]) || b;
const pName = (p) => (LANG === 'pl' && p.name_pl) || p.name;
const pDesc = (p) => (LANG === 'pl' && p.description_pl) || p.description;

// Ошибки сервера, которые может увидеть покупатель
const SERVER_ERRORS_PL = [
  [/^Неверный e-mail или пароль$/, 'Nieprawidłowy e-mail lub hasło'],
  [/^Учётная запись заблокирована$/, 'Konto zostało zablokowane'],
  [/^Слишком много попыток входа.*/, 'Zbyt wiele prób logowania. Spróbuj ponownie za 15 minut.'],
  [/^Слишком много регистраций.*/, 'Zbyt wiele rejestracji. Spróbuj ponownie później.'],
  [/^Заказы на сайте принимаются .* с (\d\d:\d\d) до (\d\d:\d\d)\..*$/, 'Zamówienia przez stronę przyjmujemy w godz. $1–$2. Złóż zamówienie w tych godzinach.'],
  [/^Слишком много заказов подряд.*/, 'Zbyt wiele zamówień z rzędu. Zadzwoń do nas — przyjmiemy zamówienie telefonicznie.'],
  [/^Укажите корректный e-mail$/, 'Podaj prawidłowy adres e-mail'],
  [/^Укажите имя$/, 'Podaj imię'],
  [/^Новый пароль должен быть не короче 8 символов$/, 'Nowe hasło musi mieć co najmniej 8 znaków'],
  [/^Пароль должен быть не короче 8 символов$/, 'Hasło musi mieć co najmniej 8 znaków'],
  [/^Нужно принять правила.*/, 'Należy zaakceptować regulamin sklepu i politykę prywatności'],
  [/^Такой e-mail уже зарегистрирован$/, 'Ten adres e-mail jest już zarejestrowany'],
  [/^Текущий пароль указан неверно$/, 'Obecne hasło jest nieprawidłowe'],
  [/^Пароль указан неверно$/, 'Nieprawidłowe hasło'],
  [/^Корзина пуста$/, 'Koszyk jest pusty'],
  [/^Укажите имя и корректный телефон$/, 'Podaj imię i prawidłowy numer telefonu'],
  [/^Укажите адрес доставки.*/, 'Podaj adres dostawy'],
  [/^Приём заказов временно приостановлен.*/, 'Przyjmowanie zamówień jest tymczasowo wstrzymane. Prosimy zajrzeć później lub zadzwonić.'],
  [/^Выберите район доставки.*/, 'Wybierz miejscowość dostawy z listy'],
  [/^Адрес примерно в ([\d.]+) км от нас — курьер доставляет в радиусе (\d+) км от Bazaru Trocka\. Выберите самовывоз или позвоните нам\.$/, 'Adres jest ok. $1 km od nas — kurier dowozi w promieniu $2 km od Bazaru Trocka. Wybierz odbiór osobisty lub zadzwoń do nas.'],
  [/^Товар не найден$/, 'Nie znaleziono produktu'],
  [/^Товара «(.+)» нет в таком количестве.*/, 'Produktu „$1” nie ma w takiej ilości. Zmniejsz ilość lub skontaktuj się z nami.'],
  [/^Количество «(.+)» — только целое число упаковок$/, 'Ilość produktu „$1” — tylko pełne opakowania'],
  [/^Количество «(.+)» — не больше (\d+)\. Для оптового заказа позвоните нам\.$/, 'Ilość produktu „$1” — maksymalnie $2. W sprawie zamówień hurtowych prosimy o telefon.'],
  [/^Пароль должен быть не длиннее (\d+) символов$/, 'Hasło może mieć maksymalnie $1 znaków'],
  [/^Некорректное .*/, 'Nieprawidłowa wartość'],
  [/^Требуется вход$/, 'Wymagane zalogowanie'],
  [/^Недостаточно прав$/, 'Brak uprawnień'],
  [/^Учётную запись сотрудника.*/, 'Konto pracownika może usunąć tylko administrator'],
  [/^Внутренняя ошибка сервера$/, 'Wewnętrzny błąd serwera. Spróbuj ponownie.'],
  [/^Запрос с чужого сайта отклонён$/, 'Żądanie z obcej strony zostało odrzucone'],
];
function trError(msg) {
  if (LANG !== 'pl') return msg;
  for (const [re, pl] of SERVER_ERRORS_PL) if (re.test(msg)) return msg.replace(re, pl);
  return msg;
}

// Статичные тексты в index.html: data-i18n (innerHTML), data-i18n-title (title/aria-label)
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  // Заголовок и описание конкретной страницы подставляет сервер (seo.js) — общий ставим только на главной
  if (location.pathname === '/') {
    document.title = t('meta.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.desc'));
  }
  // cat.n.<код> — название категории (пункты выпадающего меню «Каталог»)
  document.querySelectorAll('[data-i18n]').forEach((el) => { const k = el.dataset.i18n; if (k.startsWith('cat.n.')) el.textContent = catName(k.slice(6)); else el.innerHTML = t(k); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', t(el.dataset.i18nTitle));
  });
  const btn = document.getElementById('langBtn');
  if (btn) { btn.textContent = LANG === 'pl' ? 'RU' : 'PL'; btn.title = t('lang.switch'); btn.setAttribute('aria-label', t('lang.switch')); }
}
function setLang(l) {
  if (!LANGS.includes(l)) return;
  LANG = l;
  try { localStorage.setItem('sf_lang', l); } catch { /* приватный режим */ }
  applyStaticI18n();
}
