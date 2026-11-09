'use strict';
/*
 * Правовые страницы SHUL.FISH (RU + PL): правила магазина, политика конфиденциальности, cookies.
 *
 * ⚠ ЗАПОЛНИТЕ РЕКВИЗИТЫ ПРОДАВЦА НИЖЕ. Пока в них стоят квадратные скобки,
 *   на страницах показывается предупреждение «реквизиты не заполнены».
 */
const SELLER = {
  name: 'Oleh Shuliak',
  nip: '1251791175',
  regon: '542299723',
  address: 'ul. Żurawia 47/49 lok. 4, 00-680 Warszawa',
  email: 'ghgfh2678@gmail.com',
  phone: '+48 576 230 707',
  domain: 'shulfish.pl',
  updated: '04.11.2026',
};

const legalIncomplete = () => Object.values(SELLER).some((v) => String(v).startsWith('['));
const S = (k) => esc(SELLER[k]);
const sellerBlock = () => `<p><b>${S('name')}</b><br>${S('address')}<br>NIP ${S('nip')}, REGON ${S('regon')}<br>e-mail: ${S('email')}, tel.: ${S('phone')}</p>`;
const gold = (href, text) => `<a href="${href}" style="color:var(--gold-2)">${text}</a>`;

const LEGAL = {
  /* ============================ ПРАВИЛА / REGULAMIN ============================ */
  terms: {
    title: { ru: 'Правила магазина', pl: 'Regulamin sklepu internetowego' },
    ru: () => `
      <h3>1. Общие положения</h3>
      <p>Интернет-магазин ${S('domain')} (далее — Магазин) принадлежит продавцу:</p>${sellerBlock()}
      <p>Правила определяют порядок заказа, оплаты, доставки, возврата и рассмотрения жалоб. Перед заказом покупатель знакомится с правилами
      и принимает их, отмечая соответствующее поле. Правила доступны бесплатно на этой странице, их можно сохранить или распечатать.
      Правила опубликованы на русском и польском языках. При расхождениях преимущество имеет польская версия.</p>

      <h3>2. Товары и цены</h3>
      <p>Магазин продаёт пищевые продукты: свежую, копчёную, вяленую, сушёную, малосольную и замороженную рыбу, морепродукты, икру и наборы. Цены указаны в польских злотых (zł)
      и являются ценами брутто (с НДС/VAT). Стоимость курьерской доставки — 2 zł за каждый начатый километр расстояния по прямой
      от Bazaru Trocka до адреса доставки, но не менее 10 zł; она показывается в корзине до оформления заказа. Самовывоз бесплатный.</p>
      <p>Продукция весовая и продаётся упаковками примерно по 1 кг: фактический вес упаковки — от 900 до 1100 г. Цена на сайте
      указана за 1 кг, поэтому сумма при оформлении заказа предварительная. Окончательная сумма рассчитывается по фактическому весу
      (цена за 1 кг × вес) и сообщается покупателю менеджером при подтверждении заказа, до заключения договора. Если покупатель
      не согласен с окончательной суммой, он может отказаться от заказа без каких-либо расходов.</p>

      <h3>3. Оформление заказа</h3>
      <p>Заказ можно оформить без регистрации или из личного кабинета. Чтобы оформить заказ, нужно указать имя, телефон и, для доставки,
      адрес в зоне доставки, а затем нажать кнопку «Заказать с обязательством оплаты». После оформления покупатель видит номер заказа,
      и менеджер связывается с ним для подтверждения. Договор купли-продажи заключается в момент подтверждения заказа менеджером.</p>
      <p>Заказы через сайт принимаются с понедельника по субботу с 15:00 до 16:00 (по варшавскому времени). В другое время товары можно смотреть и класть в корзину, а оформить заказ — в часы приёма или по телефону.</p>

      <h3>4. Оплата</h3>
      <p>Способы оплаты: наличными или картой курьеру, BLIK, банковским переводом. Конкретный способ согласуется при подтверждении заказа.</p>

      <h3>5. Доставка</h3>
      <p>Доставка выполняется курьером в радиусе 7 км от Bazaru Trocka (Варшава, Таргувек), включая соседние Зомбки и Марки, — обычно в день заказа (при заказе до 16:00). Также возможен самовывоз по договорённости.
      Скоропортящиеся продукты перевозятся с соблюдением условий хранения.</p>

      <h3>6. Отказ от договора</h3>
      <p>Потребитель, как правило, может отказаться от договора, заключённого дистанционно, в течение 14 дней без объяснения причин.
      Однако согласно <b>ст. 38 п. 1 пп. 4 и 5 закона о правах потребителя</b> (ustawa o prawach konsumenta z 30 maja 2014 r.)
      это право <b>не распространяется</b> на:</p>
      <ul>
        <li>товары, которые быстро портятся или имеют короткий срок годности: копчёная рыба, икра;</li>
        <li>товары в запечатанной упаковке, которую по соображениям охраны здоровья или гигиены нельзя вернуть после вскрытия.</li>
      </ul>
      <p>По остальным товарам (например, герметично упакованной сушёной рыбе в нераспечатанной упаковке) потребитель может
      отказаться от договора в течение 14 дней со дня получения. Для этого нужно написать на ${S('email')}. Деньги возвращаются
      в течение 14 дней тем же способом, которым была произведена оплата. Те же права есть у предпринимателя — физического лица,
      если покупка не связана с его профессиональной деятельностью (ст. 38a закона).</p>

      <h3>7. Жалобы (рекламации)</h3>
      <p>Продавец отвечает за соответствие товара договору. Если товар испорчен, не соответствует заказу или повреждён при доставке,
      сообщите об этом как можно скорее, лучше всего в день получения: по e-mail ${S('email')} или по телефону ${S('phone')}.
      Приложите номер заказа и фото. Мы отвечаем на жалобу в течение 14 дней. Если жалоба обоснована, мы заменим товар
      или вернём деньги.</p>

      <h3>8. Внесудебное урегулирование споров</h3>
      <p>Потребитель может обратиться за бесплатной помощью к районному (городскому) уполномоченному по защите прав потребителей
      (rzecznik konsumentów) или в Торговую инспекцию (Inspekcja Handlowa). Список организаций — на сайте UOKiK: uokik.gov.pl.</p>

      <h3>9. Личный кабинет</h3>
      <p>Регистрация добровольная и бесплатная. Аккаунт можно удалить в любой момент в личном кабинете.</p>

      <h3>10. Заключительные положения</h3>
      <p>К отношениям сторон применяется польское право. Это не лишает потребителя защиты, которую ему дают обязательные нормы
      права страны его постоянного проживания. Продавец может изменить правила. Для заказов, оформленных до изменения,
      действуют прежние правила.</p>`,
    pl: () => `
      <h3>§ 1. Postanowienia ogólne</h3>
      <p>Sklep internetowy ${S('domain')} (dalej: „Sklep”) prowadzi:</p>${sellerBlock()}
      <p>Regulamin określa zasady składania zamówień, płatności, dostawy, odstąpienia od umowy oraz rozpatrywania reklamacji.
      Przed złożeniem zamówienia Klient zapoznaje się z Regulaminem i akceptuje go, zaznaczając odpowiednie pole. Regulamin jest
      udostępniany nieodpłatnie na tej stronie w sposób umożliwiający jego pobranie, utrwalenie i wydrukowanie.
      Regulamin opublikowano w języku polskim i rosyjskim. W razie rozbieżności rozstrzyga wersja polska.</p>

      <h3>§ 2. Produkty i ceny</h3>
      <p>Sklep sprzedaje środki spożywcze: ryby świeże, wędzone, suszone, lekko solone, przekąski rybne, mrożone ryby i owoce morza, ikrę oraz zestawy. Ceny podawane są
      w złotych polskich (zł) i są cenami brutto (zawierają podatek VAT). Koszt dostawy kurierskiej wynosi 2 zł za każdy rozpoczęty
      kilometr odległości w linii prostej od Bazaru Trocka do adresu dostawy, nie mniej niż 10 zł, i jest wyświetlany w koszyku przed złożeniem zamówienia.
      Odbiór osobisty jest bezpłatny.</p>
      <p>Produkty sprzedawane są na wagę, w opakowaniach ok. 1 kg — rzeczywista waga opakowania wynosi od 900 do 1100 g. Cena
      w Sklepie dotyczy 1 kg, dlatego kwota podana przy składaniu zamówienia jest orientacyjna. Ostateczna kwota obliczana jest
      według rzeczywistej wagi (cena za 1 kg × waga) i przekazywana Klientowi przez konsultanta przy potwierdzeniu zamówienia,
      przed zawarciem umowy. Jeżeli Klient nie akceptuje ostatecznej kwoty, może zrezygnować z zamówienia bez ponoszenia kosztów.</p>

      <h3>§ 3. Składanie zamówień</h3>
      <p>Zamówienie można złożyć bez rejestracji lub po zalogowaniu na konto. W tym celu należy podać imię, numer telefonu oraz —
      w przypadku dostawy — adres w strefie dostawy, a następnie kliknąć przycisk „Zamawiam z obowiązkiem zapłaty”.
      Po złożeniu zamówienia Klient otrzymuje jego numer, a konsultant kontaktuje się z nim w celu potwierdzenia.
      Umowa sprzedaży zostaje zawarta z chwilą potwierdzenia zamówienia przez konsultanta.</p>
      <p>Zamówienia przez stronę przyjmowane są od poniedziałku do soboty w godz. 15:00–16:00 (czasu warszawskiego). W pozostałych godzinach można przeglądać produkty i dodawać je do koszyka, a zamówienie złożyć w godzinach przyjmowania lub telefonicznie.</p>

      <h3>§ 4. Płatności</h3>
      <p>Dostępne formy płatności: gotówką lub kartą u kuriera, BLIK, przelew bankowy. Forma płatności jest uzgadniana przy potwierdzeniu zamówienia.</p>

      <h3>§ 5. Dostawa</h3>
      <p>Dostawa realizowana jest kurierem w promieniu 7 km od Bazaru Trocka (Warszawa, Targówek), w tym do sąsiednich Ząbek i Marek, zazwyczaj w dniu złożenia zamówienia (przy zamówieniu do godz. 16:00).
      Możliwy jest również odbiór osobisty po wcześniejszym uzgodnieniu. Produkty łatwo psujące się przewożone są z zachowaniem warunków przechowywania.</p>

      <h3>§ 6. Odstąpienie od umowy</h3>
      <p>Konsument, który zawarł umowę na odległość, co do zasady może od niej odstąpić w terminie 14 dni bez podawania przyczyny.
      Zgodnie z <b>art. 38 ust. 1 pkt 4 i 5 ustawy z dnia 30 maja 2014 r. o prawach konsumenta</b> prawo odstąpienia od umowy
      <b>nie przysługuje</b> w odniesieniu do umów:</p>
      <ul>
        <li>w których przedmiotem świadczenia jest rzecz ulegająca szybkiemu zepsuciu lub mająca krótki termin przydatności do użycia
          (m.in. ryby wędzone, ikra);</li>
        <li>w których przedmiotem świadczenia jest rzecz dostarczana w zapieczętowanym opakowaniu, której po otwarciu opakowania
          nie można zwrócić ze względu na ochronę zdrowia lub ze względów higienicznych, jeżeli opakowanie zostało otwarte po dostarczeniu.</li>
      </ul>
      <p>W przypadku pozostałych produktów (np. przekąsek suszonych w nienaruszonym, szczelnym opakowaniu) Konsument może odstąpić
      od umowy w terminie 14 dni od dnia otrzymania towaru, składając oświadczenie na adres ${S('email')}. Sprzedawca zwraca płatność
      w terminie 14 dni, przy użyciu takiego samego sposobu płatności, jakiego użył Konsument. Powyższe uprawnienia przysługują także
      osobie fizycznej prowadzącej działalność gospodarczą, jeżeli umowa nie ma dla niej charakteru zawodowego (art. 38a ustawy).</p>

      <h3>§ 7. Reklamacje</h3>
      <p>Sprzedawca odpowiada za zgodność towaru z umową na zasadach określonych w rozdziale 5a ustawy o prawach konsumenta.
      Jeżeli towar jest zepsuty, niezgodny z zamówieniem lub uszkodzony w transporcie, prosimy o zgłoszenie jak najszybciej,
      najlepiej w dniu odbioru: e-mailem na ${S('email')} lub telefonicznie pod numerem ${S('phone')}. Prosimy podać numer zamówienia
      i dołączyć zdjęcia. Sprzedawca odpowiada na reklamację w terminie 14 dni. W przypadku uznania reklamacji Sprzedawca
      wymieni towar albo zwróci zapłaconą kwotę.</p>

      <h3>§ 8. Pozasądowe rozwiązywanie sporów</h3>
      <p>Konsument może skorzystać z bezpłatnej pomocy miejskiego lub powiatowego rzecznika konsumentów albo zwrócić się do
      Wojewódzkiego Inspektoratu Inspekcji Handlowej. Wykaz instytucji znajduje się na stronie UOKiK: uokik.gov.pl.</p>

      <h3>§ 9. Konto Klienta</h3>
      <p>Rejestracja jest dobrowolna i bezpłatna. Klient może w każdej chwili usunąć konto w panelu „Moje konto”.</p>

      <h3>§ 10. Postanowienia końcowe</h3>
      <p>Do umów zawieranych za pośrednictwem Sklepu stosuje się prawo polskie. Nie pozbawia to Konsumenta ochrony przysługującej mu
      na podstawie bezwzględnie obowiązujących przepisów prawa państwa jego zwykłego pobytu. Sprzedawca może zmienić Regulamin.
      Do zamówień złożonych przed zmianą stosuje się dotychczasowe postanowienia.</p>`,
  },

  /* ============================ ПОЛИТИКА / POLITYKA PRYWATNOŚCI ============================ */
  privacy: {
    title: { ru: 'Политика конфиденциальности', pl: 'Polityka prywatności' },
    ru: () => `
      <h3>1. Администратор данных</h3>
      <p>Администратором ваших персональных данных является:</p>${sellerBlock()}
      <p>По всем вопросам о данных пишите на ${S('email')}.</p>

      <h3>2. Какие данные мы обрабатываем и зачем</h3>
      <div class="table-wrap"><table>
        <tr><th>Цель</th><th>Данные</th><th>Основание (RODO/GDPR)</th></tr>
        <tr><td>Оформление и доставка заказа, связь с вами по заказу</td><td>имя, телефон, e-mail, адрес доставки, состав заказа, комментарий</td><td>ст. 6 п. 1 «b» — исполнение договора</td></tr>
        <tr><td>Личный кабинет</td><td>имя, e-mail, телефон, пароль (хранится только в виде хэша)</td><td>ст. 6 п. 1 «b» — договор об оказании услуги</td></tr>
        <tr><td>Бухгалтерский и налоговый учёт</td><td>данные заказов и платежей</td><td>ст. 6 п. 1 «c» — обязанность по закону</td></tr>
        <tr><td>Рассмотрение жалоб, защита от претензий</td><td>данные заказа и переписки</td><td>ст. 6 п. 1 «f» — законный интерес</td></tr>
        <tr><td>Безопасность сайта (защита от взлома и спама)</td><td>IP-адрес, технические журналы</td><td>ст. 6 п. 1 «f» — законный интерес</td></tr>
      </table></div>
      <p>Указать данные добровольно, но без имени, телефона и адреса мы не сможем выполнить заказ.
      Мы не используем данные для автоматизированного принятия решений и профилирования, не продаём их и не рассылаем рекламу без вашего согласия.</p>

      <h3>3. Кому мы передаём данные</h3>
      <ul>
        <li>курьерам и службам доставки — в объёме, нужном для доставки;</li>
        <li>хостинг-провайдеру, на серверах которого работает сайт;</li>
        <li>OpenStreetMap Foundation (сервис Nominatim): при оформлении доставки ему передаётся только адрес (без имени и телефона), чтобы проверить расстояние до зоны доставки;</li>
        <li>Google Ireland Ltd. (Google Workspace / Google Таблицы): там ведётся учёт заказов и склада.
          Google может обрабатывать данные за пределами ЕЭЗ на основании стандартных договорных условий ЕС;</li>
        <li>бухгалтерии и, по законному требованию, государственным органам.</li>
      </ul>
      <p>Шрифты сайта загружаются с серверов Google Fonts. При этом Google получает IP-адрес вашего устройства.</p>

      <h3>4. Сколько мы храним данные</h3>
      <ul>
        <li>данные аккаунта — пока вы его не удалите;</li>
        <li>данные заказов — 5 лет с конца календарного года, в котором был заказ (требования налогового законодательства), и до истечения сроков исковой давности;</li>
        <li>технические журналы — до 90 дней.</li>
      </ul>

      <h3>5. Ваши права</h3>
      <p>Вы имеете право на доступ к данным, их исправление, удаление, ограничение обработки, перенос данных,
      а также право возразить против обработки, основанной на законном интересе. Чтобы воспользоваться правом, напишите на ${S('email')}.
      Аккаунт можно удалить самостоятельно в личном кабинете. Данные уже оформленных заказов при этом сохраняются на срок,
      требуемый законом, но перестают быть связаны с аккаунтом.</p>
      <p>Вы вправе подать жалобу в надзорный орган: <b>Prezes Urzędu Ochrony Danych Osobowych</b>, ul. Stawki 2, 00-193 Warszawa, uodo.gov.pl.</p>

      <h3>6. Безопасность</h3>
      <p>Соединение с сайтом защищено (HTTPS). Пароли хранятся только в виде криптографического хэша. Доступ к данным заказов есть только
      у сотрудников, которым он нужен для работы, и каждое их действие записывается в журнал.</p>

      <h3>7. Cookies</h3>
      <p>Подробнее — на странице ${gold('/cookies', 'Cookies')}.</p>`,
    pl: () => `
      <h3>1. Administrator danych</h3>
      <p>Administratorem Twoich danych osobowych jest:</p>${sellerBlock()}
      <p>We wszystkich sprawach dotyczących danych osobowych możesz kontaktować się pod adresem ${S('email')}.</p>

      <h3>2. Jakie dane przetwarzamy i w jakim celu</h3>
      <div class="table-wrap"><table>
        <tr><th>Cel</th><th>Dane</th><th>Podstawa prawna (RODO)</th></tr>
        <tr><td>Realizacja i dostawa zamówienia, kontakt w sprawie zamówienia</td><td>imię, telefon, e-mail, adres dostawy, skład zamówienia, komentarz</td><td>art. 6 ust. 1 lit. b — wykonanie umowy</td></tr>
        <tr><td>Prowadzenie konta Klienta</td><td>imię, e-mail, telefon, hasło (przechowywane wyłącznie jako skrót kryptograficzny)</td><td>art. 6 ust. 1 lit. b — umowa o świadczenie usługi</td></tr>
        <tr><td>Księgowość i rozliczenia podatkowe</td><td>dane zamówień i płatności</td><td>art. 6 ust. 1 lit. c — obowiązek prawny</td></tr>
        <tr><td>Rozpatrywanie reklamacji, obrona przed roszczeniami</td><td>dane zamówienia i korespondencji</td><td>art. 6 ust. 1 lit. f — prawnie uzasadniony interes</td></tr>
        <tr><td>Bezpieczeństwo serwisu (ochrona przed włamaniami i spamem)</td><td>adres IP, logi techniczne</td><td>art. 6 ust. 1 lit. f — prawnie uzasadniony interes</td></tr>
      </table></div>
      <p>Podanie danych jest dobrowolne, ale bez imienia, numeru telefonu i adresu nie możemy zrealizować zamówienia.
      Nie podejmujemy wobec Ciebie zautomatyzowanych decyzji, nie stosujemy profilowania, nie sprzedajemy danych
      i nie wysyłamy reklam bez Twojej zgody.</p>

      <h3>3. Odbiorcy danych</h3>
      <ul>
        <li>kurierzy i firmy dostawcze — w zakresie niezbędnym do doręczenia;</li>
        <li>dostawca hostingu, na którego serwerach działa Sklep;</li>
        <li>OpenStreetMap Foundation (usługa Nominatim): przy zamówieniu z dostawą przekazywany jest wyłącznie adres (bez imienia i telefonu), aby sprawdzić odległość od strefy dostawy;</li>
        <li>Google Ireland Ltd. (Google Workspace / Arkusze Google), w których prowadzona jest ewidencja zamówień i magazynu.
          Google może przetwarzać dane poza EOG na podstawie standardowych klauzul umownych zatwierdzonych przez Komisję Europejską;</li>
        <li>biuro rachunkowe oraz — na podstawie przepisów prawa — uprawnione organy państwowe.</li>
      </ul>
      <p>Czcionki strony są pobierane z serwerów Google Fonts, w związku z czym Google otrzymuje adres IP Twojego urządzenia.</p>

      <h3>4. Okres przechowywania danych</h3>
      <ul>
        <li>dane konta — do czasu jego usunięcia;</li>
        <li>dane zamówień — przez 5 lat od końca roku kalendarzowego, w którym złożono zamówienie (przepisy podatkowe),
          oraz do upływu terminu przedawnienia roszczeń;</li>
        <li>logi techniczne — do 90 dni.</li>
      </ul>

      <h3>5. Twoje prawa</h3>
      <p>Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia danych
      oraz prawo wniesienia sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie. Aby skorzystać z tych praw,
      napisz na adres ${S('email')}. Konto możesz usunąć samodzielnie w panelu „Moje konto”. Dane złożonych zamówień są wówczas
      przechowywane przez okres wymagany przepisami, ale nie są już powiązane z kontem.</p>
      <p>Przysługuje Ci prawo wniesienia skargi do organu nadzorczego: <b>Prezes Urzędu Ochrony Danych Osobowych</b>,
      ul. Stawki 2, 00-193 Warszawa, uodo.gov.pl.</p>

      <h3>6. Bezpieczeństwo</h3>
      <p>Połączenie ze Sklepem jest szyfrowane (HTTPS). Hasła przechowujemy wyłącznie w postaci skrótu kryptograficznego.
      Dostęp do danych zamówień mają tylko pracownicy, którym jest on niezbędny do pracy, a każda ich czynność jest rejestrowana.</p>

      <h3>7. Cookies</h3>
      <p>Szczegóły znajdziesz na stronie ${gold('/cookies', 'Polityka cookies')}.</p>`,
  },

  /* ============================ COOKIES ============================ */
  cookies: {
    title: { ru: 'Политика cookies', pl: 'Polityka cookies' },
    ru: () => `
      <p>Сайт использует только то, без чего он не может работать. Мы <b>не используем</b> рекламные или аналитические cookies
      и не отслеживаем вас на других сайтах. Поэтому согласие на такие cookies не требуется.</p>
      <div class="table-wrap"><table>
        <tr><th>Название</th><th>Тип</th><th>Зачем</th><th>Срок</th></tr>
        <tr><td><code>sid</code></td><td>cookie, необходимый</td><td>держит вас в аккаунте после входа</td><td>14 дней или до выхода</td></tr>
        <tr><td><code>sf_cart</code></td><td>локальное хранилище браузера</td><td>запоминает корзину</td><td>пока вы её не очистите</td></tr>
        <tr><td><code>sf_lang</code></td><td>локальное хранилище браузера</td><td>запоминает выбранный язык сайта</td><td>бессрочно</td></tr>
        <tr><td><code>sf_cookie_ok</code></td><td>локальное хранилище браузера</td><td>запоминает, что вы закрыли уведомление о cookies</td><td>бессрочно</td></tr>
      </table></div>
      <p>Cookies можно удалить или заблокировать в настройках браузера. Если заблокировать <code>sid</code>, войти в аккаунт будет невозможно.</p>`,
    pl: () => `
      <p>Sklep korzysta wyłącznie z mechanizmów niezbędnych do jego działania. <b>Nie używamy</b> reklamowych ani analitycznych
      plików cookies i nie śledzimy Cię na innych stronach, dlatego zgoda na takie pliki nie jest wymagana.</p>
      <div class="table-wrap"><table>
        <tr><th>Nazwa</th><th>Rodzaj</th><th>Cel</th><th>Okres</th></tr>
        <tr><td><code>sid</code></td><td>plik cookie niezbędny</td><td>utrzymanie zalogowania na konto</td><td>14 dni lub do wylogowania</td></tr>
        <tr><td><code>sf_cart</code></td><td>pamięć lokalna przeglądarki</td><td>zapamiętanie zawartości koszyka</td><td>do wyczyszczenia koszyka</td></tr>
        <tr><td><code>sf_lang</code></td><td>pamięć lokalna przeglądarki</td><td>zapamiętanie wybranego języka strony</td><td>bezterminowo</td></tr>
        <tr><td><code>sf_cookie_ok</code></td><td>pamięć lokalna przeglądarki</td><td>zapamiętanie zamknięcia komunikatu o cookies</td><td>bezterminowo</td></tr>
      </table></div>
      <p>Pliki cookies możesz usunąć lub zablokować w ustawieniach przeglądarki. Zablokowanie pliku <code>sid</code> uniemożliwi zalogowanie się na konto.</p>`,
  },
};

function viewLegal(kind) {
  const page = LEGAL[kind];
  app.innerHTML = `<article class="legal" lang="${LANG}">
    <h1>${page.title[LANG]}</h1>
    <p class="muted">${t('legal.effective', { date: S('updated') })} · ${S('domain')}</p>
    ${legalIncomplete() ? `<div class="panel" style="border-color:var(--warn);margin-bottom:18px">${t('legal.incomplete')}</div>` : ''}
    <div class="panel legal-body">${page[LANG]()}</div>
    <p class="muted" style="margin-top:14px">${t('legal.other')}
      ${Object.entries(LEGAL).filter(([k]) => k !== kind).map(([k, v]) => gold('/' + k, v.title[LANG])).join(' · ')}</p>
  </article>`;
}

// Информационное уведомление (cookies только необходимые — согласие не нужно, но сообщить честно)
function cookieNotice() {
  let seen = false;
  try { seen = localStorage.getItem('sf_cookie_ok') === '1'; } catch { /* приватный режим */ }
  if (seen) return;
  const bar = document.createElement('div');
  bar.className = 'cookie-bar';
  bar.innerHTML = `<span>${t('cookie.text')} <a href="/cookies">${t('cookie.more')}</a></span><button class="btn sm primary">${t('cookie.ok')}</button>`;
  bar.querySelector('button').addEventListener('click', () => {
    try { localStorage.setItem('sf_cookie_ok', '1'); } catch { /* ничего */ }
    bar.remove();
  });
  document.body.append(bar);
}
