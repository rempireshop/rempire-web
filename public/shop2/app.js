/* REMPIRE — standalone prototype (direction К).
   Vanilla JS, no build step. State → render → DOM. Screens are pure
   functions returning HTML strings; events are delegated from document.

   The header and the bottom nav live in their own slots and are NOT rebuilt
   on every render. Two reasons: an innerHTML swap restarts CSS animations
   (the logo could never finish its draw) and it destroys the focused input
   (typing in the header search lost the caret on the first keystroke).

   Depends on catalogue.js (CATALOGUE, CAT_NAMES) and paylogos.js (PAYLOGOS). */

(function () {
  "use strict";

  var TOWER_D = "M541.42,377.53l-18.69,10.82s11.14,130.41,11.54,135.02c-.23,7.19-11.13,15.39-28.52,21.44-20.85,7.24-49.58,11.23-80.91,11.23s-59.98-3.98-80.82-11.21c-17.37-6.02-28.29-14.2-28.6-21.39.67-7.94,14-157.47,15.72-177.3,6.37-6.37,30.14-20.91,95.48-18.91,72.13,2.21,93.63,19.61,93.88,19.75l16.98-11.55-12.38-117.42c-.91-14.04-12.92-23.77-33.91-33.43h0c-1.28-.59-2.76-.48-3.94.28l-8.63,5.58c-1.17.76-1.88,2.05-1.88,3.45v22.14c-6.08-1.56-13.19-3.4-19.85-4.35l-.52-32.33c-.05-3.02-2.31-5.55-5.31-5.93l-3.33-.42c-15.83-1.78-31.85-1.73-47.62.16l-3.82.46c-3.02.36-5.31,2.9-5.35,5.94l-.52,32.29c-6.72.99-12.86,3.08-18.9,4.68v-22.4c0-1.25-.57-2.44-1.55-3.22l-7.71-6.16c-1.22-.97-2.88-1.18-4.29-.53h0c-1.16.53-2.3,1.07-3.4,1.62-19.74,9.8-30.84,19.65-31.12,33.52l-7.12,64.63,5.48,16.43s32.05-29.18,102.06-26.35c39.67.51,59.56,11.01,59.56,11.01l11.75-15.24s-31.68-13.66-73.8-13.66c-59.49,0-86.24,15.83-86.24,15.83,0,0,5.09-51.57,5.11-51.87,0,0-.58,6.05.01-.28.87-9.26,15.42-13.93,15.42-13.93l-1.08,34.17s28.19-12.25,53.12-12.25l.6-37.37c0-2.19,30.62-2.27,30.63-.09l.6,37.39c24.34,0,53.11,11.72,53.11,11.72v-31.59s15.68,5.68,16.2,14.85l9.32,102.14c-9.24-2.87-25.63-14.19-93.35-16.33-69.08-2.19-111.82,15.96-113.22,30.02l-.45,4.28c-18.92,186.41-18.92,181.8-18.92,182.08,0,16.85,15.11,31.77,42.54,42.03,24.21,9.05,56.19,14.04,90.05,14.04s65.84-4.99,90.05-14.04c27.43-10.26,42.54-25.18,42.54-42.03,0-.3-16.02-147.42-16.02-147.42Z";
  var VB = "292.24 171.22 265.18 409.8";

  function tower(cls) {
    return '<svg viewBox="' + VB + '" role="img" aria-label="REMPIRE" class="' + (cls || "") + '"><path d="' + TOWER_D + '" fill="currentColor"/></svg>';
  }
  function towerDraw(cls) {
    return '<svg viewBox="' + VB + '" aria-hidden="true" class="' + (cls || "") + '">' +
      '<path class="tw-draw" pathLength="1" d="' + TOWER_D + '"/>' +
      '<path class="tw-fill" fill="currentColor" d="' + TOWER_D + '"/></svg>';
  }

  var ICON = {
    chart: '<path d="M4 20V10M10 20V4M16 20v-8M20 20H4"/>',
    mail: '<path d="M3 6h18v12H3z"/><path d="M3 7l9 6 9-6"/>',
    plug: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5.4v-6H9.4v6H4z"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    search: '<path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16.2 16.2L21 21"/>',
    user: '<path d="M12 4a3.6 3.6 0 1 1 0 7.2A3.6 3.6 0 0 1 12 4zM4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/>',
    bag: '<path d="M5.5 8.5h13l-.9 11a1.8 1.8 0 0 1-1.8 1.6H8.2a1.8 1.8 0 0 1-1.8-1.6zM8.8 8.5V7a3.2 3.2 0 0 1 6.4 0v1.5"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    share: '<path d="M12 3.5v12M12 3.5 8.2 7.3M12 3.5l3.8 3.8"/><path d="M6.5 11.5H5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5 20.5h14a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5h-1.5"/>',
    instagram: '<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.2" cy="6.8" r="1.15" fill="currentColor" stroke="none"/>',
    facebook: '<path d="M14.6 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H17.8V3.6A21 21 0 0 0 15.4 3.5c-2.4 0-4 1.45-4 4.1v2.3H8.7V13h2.7v8z" fill="currentColor" stroke="none"/>',
    tiktok: '<path d="M15.6 3.5c.4 2.15 1.6 3.4 3.7 3.55v2.4c-1.2.12-2.3-.28-3.55-1.05v4.65c0 5.9-6.45 7.75-9.05 3.52-1.67-2.72-.65-7.5 4.68-7.69v2.53c-.4.07-.84.17-1.24.3-1.2.4-1.87 1.15-1.68 2.48.36 2.55 5.04 3.3 4.65-1.68V3.5z" fill="currentColor" stroke="none"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' + ICON[name] + "</svg>";
  }

  /* Inline SVG rather than flagcdn.com — a decorative flag is not worth a
     third-party request, and the prototype otherwise talks to nobody. */
  function flagSVG(bars) {
    /* Single quotes inside url(): this value also goes into a style="..."
       attribute in the language menu, and double quotes there closed the
       attribute early — which is why the menu flags rendered blank while the
       header one (set via JS) was fine. */
    return "url('data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">' + bars + "</svg>") + "')";
  }
  var FLAG = {
    RU: flagSVG('<rect width="30" height="20" fill="#fff"/><rect y="6.67" width="30" height="6.67" fill="#0039a6"/><rect y="13.33" width="30" height="6.67" fill="#d52b1e"/>'),
    ET: flagSVG('<rect width="30" height="6.67" fill="#0072ce"/><rect y="6.67" width="30" height="6.67" fill="#000"/><rect y="13.33" width="30" height="6.67" fill="#fff"/>'),
    EN: flagSVG('<rect width="30" height="20" fill="#012169"/><path d="M0 0l30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0l30 20M30 0L0 20" stroke="#c8102e" stroke-width="2.4"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6.7"/><path d="M15 0v20M0 10h30" stroke="#c8102e" stroke-width="4"/>')
  };
  var LANGS = [["RU", "Русский"], ["ET", "Eesti"], ["EN", "English"]];

  var CATS = Object.keys(CAT_NAMES).map(function (k) { return { id: k, name: CAT_NAMES[k] }; });

  /* ---------- interface translation -------------------------------------
     Russian is the source of truth: every template renders RU, and when the
     switcher is on ET/EN a dictionary pass rewrites the DOM after each
     render. One hook instead of four hundred template edits; a phrase the
     dictionary misses stays Russian instead of breaking. Keys are the full
     trimmed text of a node; RX handles strings with numbers in them. */
  var UI = {
    ET: {
      "Все товары": "Kõik tooted", "Бренды": "Brändid", "Все": "Kõik",
      "Уход за волосами": "Juuksehooldus", "Стайлинг": "Viimistlus",
      "Уход за бородой": "Habemehooldus", "Уход за лицом": "Näohooldus",
      "Уход за телом": "Kehahooldus", "Парфюмерия": "Parfüümid", "Мерч": "Merch",
      "Шампуни": "Šampoonid", "Кондиционеры": "Palsamid", "Маски и уход": "Maskid ja hooldus",
      "Спреи": "Spreid", "Пасты и воски": "Pastad ja vahad", "Гели": "Geelid",
      "Пудры": "Puudrid", "Масла": "Õlid", "Бальзамы": "Palsamid",
      "После бритья": "Habemeajamisjärgne", "Тоники": "Toonikud", "Очищение": "Puhastus",
      "Кремы и сыворотки": "Kreemid ja seerumid",
      "В корзину": "Lisa ostukorvi", "мало": "vähe", "нет в наличии": "pole saadaval",
      "Главная": "Avaleht", "Каталог": "Kataloog", "Поиск": "Otsi", "Корзина": "Ostukorv",
      "Кабинет": "Konto", "Описание": "Kirjeldus", "Доставка и возврат": "Tarne ja tagastus",
      "Похожие товары": "Sarnased tooted", "Вместе лучше": "Sobivad kokku",
      "Оформить заказ": "Vormista ost", "Продолжить покупки": "Jätka ostlemist",
      "Убрать": "Eemalda", "Итого": "Kokku", "Оплатить": "Maksa",
      "Фильтры": "Filtrid", "Сортировка": "Järjesta", "Сбросить": "Lähtesta",
      "Сбросить всё": "Lähtesta kõik", "Сбросить фильтры": "Lähtesta filtrid",
      "Наличие": "Saadavus", "Бренд": "Bränd", "В наличии": "Laos",
      "Закрыть": "Sule", "Меньше": "Vähem", "Больше": "Rohkem", "Размер": "Suurus",
      "Пока пусто.": "Ostukorv on tühi.", "К товарам": "Toodete juurde",
      "Хиты продаж": "Populaarsemad enne", "Цена ↑": "Hind ↑", "Цена ↓": "Hind ↓", "Новинки": "Uuemad",
      "Покупателю": "Ostjale", "Правовое": "Õigusinfo", "Контакты": "Kontakt",
      "Доставка и оплата": "Kohaletoimetamine ja maksmine", "Возврат товара": "Kauba tagastamine",
      "Условия продажи": "Müügitingimused", "Конфиденциальность": "Privaatsus",
      "Правовая информация": "Õigusinfo", "Споры онлайн (ODR)": "Vaidlused veebis (ODR)",
      "Оформление заказа": "Ostu vormistamine",
      "Контакт": "Kliendi info", "Доставка": "Tarne", "Оплата": "Maksmine",
      "Далее — доставка": "Edasi — tarne", "Далее — оплата": "Edasi — maksmine",
      "Имя": "Nimi", "Телефон": "Telefon", "Страна": "Riik", "Город": "Linn",
      "Адрес": "Aadress", "Промокод": "Sooduskood", "Применить": "Rakenda",
      "Заказ оформлен": "Tellimus vormistatud", "На главную": "Avalehele",
      "Поиск: шампунь, Davines, паста…": "Otsi: šampoon, Davines, pasta…",
      "Что ищете?": "Mida otsite?", "Язык интерфейса": "Keel",
      "Добавлено в корзину": "Lisatud korvi", "Товар снова в наличии — напишем!": "Anname teada, kui toode on taas laos!",
      "Сообщить": "Teata mulle", "Получить код": "Saada kood", "Выйти": "Logi välja",
      "Мои заказы": "Minu tellimused", "Мои данные": "Minu andmed", "Мои промокоды": "Minu sooduskoodid",
      "Повторить заказ": "Korda tellimust", "Сохранить": "Salvesta",
      "Страница не найдена": "Lehte ei leitud",
      "Аккаунт не нужен — оформляйте как гость.": "Kontot pole vaja — vormistage külalisena.",
      "Налоги включены. Доставка рассчитается при оформлении.": "Hinnad sisaldavad makse. Tarne arvutatakse vormistamisel.",
      "Каталог, товары и инфостраницы — на трёх языках.": "Kataloog, tooted ja infolehed on kolmes keeles.",
      "Текст перенесён с текущего сайта; перед запуском пройдёт проверку юристом.": "Tekst on üle toodud praeguselt saidilt; enne käivitamist vaatab selle üle jurist.",
      "Эстония": "Eesti", "Латвия": "Läti", "Литва": "Leedu", "Финляндия": "Soome",
      "Европа": "Euroopa", "Таллинн": "Tallinn",
      "Профессиональный уход": "Professionaalne hooldus",
      "Kevin.Murphy, Davines, System 4 — то, чем работает команда Rempire в салоне.": "Kevin.Murphy, Davines, System 4 — sellega töötab Rempire'i meeskond salongis.",
      "В каталог": "Kataloogi", "Смотреть": "Vaata", "Новинки": "Uued",
      "Свежая поставка": "Värske saadetis",
      "Уход и стайлинг, которые только приехали.": "Hooldus ja stiliseerimine, mis just saabusid.",
      "Борода": "Habe", "Всё для формы": "Kõik vormi jaoks",
      "Масла, бальзамы и воски для ухода за бородой.": "Õlid, palsamid ja vahad habemehoolduseks.",
      "Ниша и классика": "Nišš ja klassika",
      "Creed, Tom Ford, Xerjoff, Byredo — то, что держим в наличии.": "Creed, Tom Ford, Xerjoff, Byredo — see, mida hoiame laos.",
      "Сделано в Rempire": "Valminud Rempire'is", "Мыло ручной работы": "Käsitööseep",
      "Чёрное 666 и розовое Rule Nr 1 — варим сами, маленькими партиями.": "Must 666 ja roosa Rule Nr 1 — keedame ise, väikeste partiidena.",
      "Таллинн · Mardi 1 · est 2018": "Tallinn · Mardi 1 · est 2018",
      "Популярные товары": "Populaarsed tooted", "Новые товары": "Uued tooted",
      "Салонная косметика для лица, тела и волос — то, чем команда Rempire работает каждый день.": "Salongikosmeetika näole, kehale ja juustele — sellega töötab Rempire'i meeskond iga päev.",
      "Свежие поступления: уход и стайлинг, парфюмерия и новый мерч.": "Värsked saabumised: hooldus ja stiliseerimine, parfüümid ja uus merch.",
      "Категории": "Kategooriad",
      "Профессиональные средства, которыми команда Rempire работает в салоне.": "Professionaalsed tooted, millega Rempire'i meeskond salongis töötab.",
      "Фирменные футболки Rempire — принты наших художников, печатаем небольшими тиражами.": "Rempire'i särgid — meie kunstnike pildid, trükime väikeste tiraažidena.",
      "Ниша и классика, которые держим в наличии в Таллинне.": "Nišš ja klassika, mida hoiame Tallinnas laos.",
      "Гели, мыло и уход за телом — включая мыло собственной варки.": "Geelid, seep ja kehahooldus — sealhulgas oma keedetud seep.",
      "Весь ассортимент Rempire: уход, стайлинг, борода, лицо, тело, парфюмерия и мерч.": "Kogu Rempire'i valik: hooldus, stiliseerimine, habe, nägu, keha, parfüümid ja merch.",
      "Под эти фильтры ничего не подошло.": "Nende filtritega ei sobinud midagi.",
      "Сначала дешевле": "Soodsamad enne", "Сначала дороже": "Kallimad enne",
      "Поделиться": "Jaga", "Купить через": "Osta kohe —", "Другие способы оплаты": "Teised makseviisid",
      "С этим покупают": "Sellega ostetakse koos",
      "Самовывоз": "Järeletulek", "Реквизиты": "Rekvisiidid", "Связаться": "Võta ühendust",
      "Банковская ссылка (Swedbank, SEB, LHV, Luminor, Coop), карта, Apple Pay / Google Pay, счёт для компаний.": "Pangalink (Swedbank, SEB, LHV, Luminor, Coop), kaart, Apple Pay / Google Pay, arve ettevõtetele.",
      "Mardi 1, Таллинн · бесплатно · заказ ждёт 7 дней, дальше 1,50 € в день. Нужен документ.": "Mardi 1, Tallinn · tasuta · tellimus ootab 7 päeva, edasi 1,50 € päevas. Vaja on dokumenti.",
      "Mardi 1, 10145 Таллинн": "Mardi 1, 10145 Tallinn",
      "Админка — демо": "Admin — demo",
      "Банковская ссылка": "Pangalink", "Банковская карта": "Pangakaart",
      "По счёту — для компаний": "Arvega — ettevõtetele",
      "Swedbank, SEB, LHV, Luminor, Coop — оплата в своём банке": "Swedbank, SEB, LHV, Luminor, Coop — makse oma pangas",
      "Оплата в одно касание": "Makse ühe puudutusega",
      "Счёт на почту, оплата в течение 7 дней": "Arve e-postile, maksmine 7 päeva jooksul",
      "Самовывоз — Mardi 1, Таллинн": "Järeletulek — Mardi 1, Tallinn",
      "Курьер до двери (DPD)": "Kuller ukseni (DPD)", "Курьер DPD": "Kuller DPD",
      "Курьер SmartPosti": "Kuller SmartPosti", "Курьер Omniva": "Kuller Omniva",
      "Хочу получать новости и скидки": "Soovin uudiseid ja soodustusi",
      "E-mail для подтверждения заказа": "E-post tellimuse kinnituseks",
      "Имя и фамилия": "Ees- ja perekonnanimi", "Индекс": "Postiindeks",
      "улица, дом": "tänav, maja", "Имя Фамилия": "Eesnimi Perenimi",
      "Ваш заказ": "Tellimuse kokkuvõte", "Корзина пуста.": "Ostukorv on tühi.",
      "Бесплатно": "Tasuta", "Бесплатная доставка применена ✓": "Tasuta tarne rakendatud ✓",
      "Забрать бесплатно на Mardi 1. Нужен документ. Заказ ждёт 7 дней, дальше 1,50 € в день.": "Tasuta järeletulek Mardi 1. Vaja on dokumenti. Tellimus ootab 7 päeva, edasi 1,50 € päevas.",
      "Оплата через банк — данные карты магазин не видит": "Makse läbi panga — pood kaardiandmeid ei näe",
      "14 дней на возврат по закону ЕС": "14 päeva tagastusõigust EL-i seaduse järgi",
      "Вопросы — 56237237 или rempireshopinfo@gmail.com": "Küsimused — 56237237 või rempireshopinfo@gmail.com",
      "Нажимая «Оплатить», вы соглашаетесь с условиями и политикой возврата.": "Vajutades «Maksa» nõustute tingimuste ja tagastuspoliitikaga.",
      "14 дней на возврат по закону ЕС. Вскрытая косметика возврату не подлежит по гигиеническим причинам.": "14 päeva tagastusõigust EL-i seaduse järgi. Avatud kosmeetika ei kuulu hügieeni tõttu tagastamisele.",
      "14 дней на возврат по закону ЕС. Футболку можно примерить и вернуть, если не подошла.": "14 päeva tagastusõigust EL-i seaduse järgi. Särki võib proovida ja tagastada, kui ei sobinud.",
      "Это демонстрация — настоящий заказ не создан. В рабочем магазине сюда придёт номер заказа, счёт на почту и трекинг посылки.": "See on demo — päris tellimust ei loodud. Töötavas poes tuleb siia tellimuse number, arve e-postile ja paki jälgimine.",
      "Тарифы — прайс-листы перевозчиков 2025–2026, с НДС 24 %. От 40 посылок в месяц Omniva и DPD дают скидку 3–20 % — итоговые цены уточним при подключении.": "Tariifid — vedajate hinnakirjad 2025–2026, koos 24% käibemaksuga. Alates 40 pakist kuus annavad Omniva ja DPD 3–20% allahindlust — lõplikud hinnad täpsustame liitumisel.",
      "Добавлено в корзину ✓": "Lisatud ostukorvi ✓",
      "Код не найден — проверьте написание.": "Koodi ei leitud — kontrollige kirjapilti.",
      "Город": "Linn",
      "Рег. 12216136 · KMKR EE102723858": "Reg 12216136 · KMKR EE102723858",
      "← В магазин": "← Poodi", "изменить": "muuda"
    },
    EN: {
      "Все товары": "All products", "Бренды": "Brands", "Все": "All",
      "Уход за волосами": "Hair care", "Стайлинг": "Styling",
      "Уход за бородой": "Beard care", "Уход за лицом": "Face care",
      "Уход за телом": "Body care", "Парфюмерия": "Fragrance", "Мерч": "Merch",
      "Шампуни": "Shampoos", "Кондиционеры": "Conditioners", "Маски и уход": "Masks & care",
      "Спреи": "Sprays", "Пасты и воски": "Pastes & waxes", "Гели": "Gels",
      "Пудры": "Powders", "Масла": "Oils", "Бальзамы": "Balms",
      "После бритья": "Aftershave", "Тоники": "Toners", "Очищение": "Cleansing",
      "Кремы и сыворотки": "Creams & serums",
      "В корзину": "Add to cart", "мало": "low stock", "нет в наличии": "out of stock",
      "Главная": "Home", "Каталог": "Catalogue", "Поиск": "Search", "Корзина": "Cart",
      "Кабинет": "Account", "Описание": "Description", "Доставка и возврат": "Shipping & returns",
      "Похожие товары": "Similar products", "Вместе лучше": "Better together",
      "Оформить заказ": "Checkout", "Продолжить покупки": "Continue shopping",
      "Убрать": "Remove", "Итого": "Total", "Оплатить": "Pay",
      "Фильтры": "Filters", "Сортировка": "Sort", "Сбросить": "Reset",
      "Сбросить всё": "Reset all", "Сбросить фильтры": "Reset filters",
      "Наличие": "Availability", "Бренд": "Brand", "В наличии": "In stock",
      "Закрыть": "Close", "Меньше": "Less", "Больше": "More", "Размер": "Size",
      "Пока пусто.": "Your cart is empty.", "К товарам": "Browse products",
      "Хиты продаж": "Bestsellers", "Цена ↑": "Price ↑", "Цена ↓": "Price ↓", "Новинки": "New in",
      "Покупателю": "For customers", "Правовое": "Legal", "Контакты": "Contact",
      "Доставка и оплата": "Shipping & payment", "Возврат товара": "Returns",
      "Условия продажи": "Terms of sale", "Конфиденциальность": "Privacy",
      "Правовая информация": "Legal information", "Споры онлайн (ODR)": "Online dispute resolution (ODR)",
      "Оформление заказа": "Checkout",
      "Контакт": "Contact", "Доставка": "Shipping", "Оплата": "Payment",
      "Далее — доставка": "Next — shipping", "Далее — оплата": "Next — payment",
      "Имя": "Name", "Телефон": "Phone", "Страна": "Country", "Город": "City",
      "Адрес": "Address", "Промокод": "Promo code", "Применить": "Apply",
      "Заказ оформлен": "Order placed", "На главную": "Back to home",
      "Поиск: шампунь, Davines, паста…": "Search: shampoo, Davines, paste…",
      "Что ищете?": "What are you looking for?", "Язык интерфейса": "Language",
      "Добавлено в корзину": "Added to cart", "Товар снова в наличии — напишем!": "We'll email you when it's back!",
      "Сообщить": "Notify me", "Получить код": "Send code", "Выйти": "Log out",
      "Мои заказы": "My orders", "Мои данные": "My details", "Мои промокоды": "My promo codes",
      "Повторить заказ": "Repeat order", "Сохранить": "Save",
      "Страница не найдена": "Page not found",
      "Аккаунт не нужен — оформляйте как гость.": "No account needed — check out as a guest.",
      "Налоги включены. Доставка рассчитается при оформлении.": "Taxes included. Shipping is calculated at checkout.",
      "Каталог, товары и инфостраницы — на трёх языках.": "The catalogue, products and info pages are in three languages.",
      "Текст перенесён с текущего сайта; перед запуском пройдёт проверку юристом.": "Text carried over from the current site; a lawyer reviews it before launch.",
      "Эстония": "Estonia", "Латвия": "Latvia", "Литва": "Lithuania", "Финляндия": "Finland",
      "Европа": "Europe", "Таллинн": "Tallinn",
      "Профессиональный уход": "Professional care",
      "Kevin.Murphy, Davines, System 4 — то, чем работает команда Rempire в салоне.": "Kevin.Murphy, Davines, System 4 — what the Rempire team works with in the salon.",
      "В каталог": "To catalogue", "Смотреть": "View", "Новинки": "New in",
      "Свежая поставка": "Fresh delivery",
      "Уход и стайлинг, которые только приехали.": "Care and styling that just arrived.",
      "Борода": "Beard", "Всё для формы": "Everything for shape",
      "Масла, бальзамы и воски для ухода за бородой.": "Oils, balms and waxes for beard care.",
      "Ниша и классика": "Niche and classics",
      "Creed, Tom Ford, Xerjoff, Byredo — то, что держим в наличии.": "Creed, Tom Ford, Xerjoff, Byredo — what we keep in stock.",
      "Сделано в Rempire": "Made at Rempire", "Мыло ручной работы": "Handmade soap",
      "Чёрное 666 и розовое Rule Nr 1 — варим сами, маленькими партиями.": "Black 666 and pink Rule Nr 1 — made in-house, in small batches.",
      "Таллинн · Mardi 1 · est 2018": "Tallinn · Mardi 1 · est 2018",
      "Популярные товары": "Popular products", "Новые товары": "New products",
      "Салонная косметика для лица, тела и волос — то, чем команда Rempire работает каждый день.": "Salon-grade cosmetics for face, body and hair — what the Rempire team uses every day.",
      "Свежие поступления: уход и стайлинг, парфюмерия и новый мерч.": "Fresh arrivals: care and styling, fragrance and new merch.",
      "Категории": "Categories",
      "Профессиональные средства, которыми команда Rempire работает в салоне.": "Professional products the Rempire team works with in the salon.",
      "Фирменные футболки Rempire — принты наших художников, печатаем небольшими тиражами.": "Rempire tees — prints by our artists, small runs.",
      "Ниша и классика, которые держим в наличии в Таллинне.": "Niche and classics we keep in stock in Tallinn.",
      "Гели, мыло и уход за телом — включая мыло собственной варки.": "Gels, soap and body care — including our own handmade soap.",
      "Весь ассортимент Rempire: уход, стайлинг, борода, лицо, тело, парфюмерия и мерч.": "The full Rempire range: care, styling, beard, face, body, fragrance and merch.",
      "Под эти фильтры ничего не подошло.": "Nothing matched these filters.",
      "Сначала дешевле": "Price: low to high", "Сначала дороже": "Price: high to low",
      "Поделиться": "Share", "Купить через": "Buy now with", "Другие способы оплаты": "Other payment methods",
      "С этим покупают": "Bought together",
      "Самовывоз": "Pickup", "Реквизиты": "Company details", "Связаться": "Get in touch",
      "Банковская ссылка (Swedbank, SEB, LHV, Luminor, Coop), карта, Apple Pay / Google Pay, счёт для компаний.": "Bank link (Swedbank, SEB, LHV, Luminor, Coop), card, Apple Pay / Google Pay, invoice for companies.",
      "Mardi 1, Таллинн · бесплатно · заказ ждёт 7 дней, дальше 1,50 € в день. Нужен документ.": "Mardi 1, Tallinn · free · your order waits 7 days, then 1.50 € per day. ID required.",
      "Mardi 1, 10145 Таллинн": "Mardi 1, 10145 Tallinn",
      "Админка — демо": "Admin — demo",
      "Банковская ссылка": "Bank link", "Банковская карта": "Bank card",
      "По счёту — для компаний": "By invoice — for companies",
      "Swedbank, SEB, LHV, Luminor, Coop — оплата в своём банке": "Swedbank, SEB, LHV, Luminor, Coop — pay in your own bank",
      "Оплата в одно касание": "One-tap payment",
      "Счёт на почту, оплата в течение 7 дней": "Invoice by e-mail, payment within 7 days",
      "Самовывоз — Mardi 1, Таллинн": "Pickup — Mardi 1, Tallinn",
      "Курьер до двери (DPD)": "Courier to the door (DPD)", "Курьер DPD": "DPD courier",
      "Курьер SmartPosti": "SmartPosti courier", "Курьер Omniva": "Omniva courier",
      "Хочу получать новости и скидки": "Send me news and discounts",
      "E-mail для подтверждения заказа": "E-mail for the order confirmation",
      "Имя и фамилия": "Full name", "Индекс": "Postcode",
      "улица, дом": "street, house", "Имя Фамилия": "Name Surname",
      "Ваш заказ": "Your order", "Корзина пуста.": "Your cart is empty.",
      "Бесплатно": "Free", "Бесплатная доставка применена ✓": "Free shipping applied ✓",
      "Забрать бесплатно на Mardi 1. Нужен документ. Заказ ждёт 7 дней, дальше 1,50 € в день.": "Free pickup at Mardi 1. ID required. Your order waits 7 days, then 1.50 € per day.",
      "Оплата через банк — данные карты магазин не видит": "Payment goes through the bank — the shop never sees card details",
      "14 дней на возврат по закону ЕС": "14-day returns under EU law",
      "Вопросы — 56237237 или rempireshopinfo@gmail.com": "Questions — 56237237 or rempireshopinfo@gmail.com",
      "Нажимая «Оплатить», вы соглашаетесь с условиями и политикой возврата.": "By pressing “Pay” you agree to the terms and the return policy.",
      "14 дней на возврат по закону ЕС. Вскрытая косметика возврату не подлежит по гигиеническим причинам.": "14-day returns under EU law. Opened cosmetics cannot be returned for hygiene reasons.",
      "14 дней на возврат по закону ЕС. Футболку можно примерить и вернуть, если не подошла.": "14-day returns under EU law. You can try the tee on and return it if it doesn't fit.",
      "Это демонстрация — настоящий заказ не создан. В рабочем магазине сюда придёт номер заказа, счёт на почту и трекинг посылки.": "This is a demo — no real order was created. In the live shop this page shows the order number, an e-mailed invoice and parcel tracking.",
      "Тарифы — прайс-листы перевозчиков 2025–2026, с НДС 24 %. От 40 посылок в месяц Omniva и DPD дают скидку 3–20 % — итоговые цены уточним при подключении.": "Rates — carrier price lists 2025–2026, incl. 24% VAT. From 40 parcels a month Omniva and DPD give 3–20% off — final prices to be confirmed on connection.",
      "Добавлено в корзину ✓": "Added to cart ✓",
      "Код не найден — проверьте написание.": "Code not found — check the spelling.",
      "Город": "City",
      "Рег. 12216136 · KMKR EE102723858": "Reg 12216136 · KMKR EE102723858",
      "← В магазин": "← Back to shop", "изменить": "edit"
    }
  };
  /* Strings with numbers or sums inside. $1 keeps the captured piece; a
     captured piece that is itself a dictionary term (a country, a carrier
     label) is translated too. */
  var UI_RX = [
    [/^Показаны все (\d+) товар(?:|а|ов)$/, { ET: "Kuvatud kõik $1 toodet", EN: "All $1 products shown" }],
    [/^(\d+) товар(?:|а|ов)$/, { ET: "$1 toodet", EN: "$1 products" }],
    [/^Корзина \((\d+)\)$/, { ET: "Ostukorv ($1)", EN: "Cart ($1)" }],
    [/^До бесплатной доставки \((.+), от (.+)\) — ещё (.+)$/, { ET: "Tasuta tarneni ($1, alates $2) — veel $3", EN: "$3 more to free shipping ($1, from $2)" }],
    [/^Бесплатная доставка — порог (.+) достигнут ✓$/, { ET: "Tasuta tarne — $1 lävi käes ✓", EN: "Free shipping — $1 threshold reached ✓" }],
    [/^Бесплатная доставка по Эстонии от (.+)$/, { ET: "Tasuta tarne Eestis alates $1", EN: "Free shipping in Estonia from $1" }],
    [/^Бесплатная доставка от (.+) — не хватает (.+)$/, { ET: "Tasuta tarne alates $1 — puudu $2", EN: "Free shipping from $1 — $2 to go" }],
    [/^Бесплатная доставка от (.+)$/, { ET: "Tasuta tarne alates $1", EN: "Free shipping from $1" }],
    [/^Бесплатная доставка: Эстония от (.+) · LV, LT от (.+) · Финляндия от (.+)$/,
      { ET: "Tasuta tarne: Eesti alates $1 · LV, LT alates $2 · Soome alates $3", EN: "Free shipping: Estonia from $1 · LV, LT from $2 · Finland from $3" }],
    [/^от (\d.*)$/, { ET: "alates $1", EN: "from $1" }],
    [/^Доставка — (.+)$/, { ET: "Tarne — $1", EN: "Shipping — $1" }],
    [/^Доставка 1–3 дня: DPD, Omniva, SmartPosti, курьер · по Эстонии бесплатно от (.+) · самовывоз на Mardi 1$/,
      { ET: "Tarne 1–3 päeva: DPD, Omniva, SmartPosti, kuller · Eestis tasuta alates $1 · järeletulek Mardi 1", EN: "Delivery 1–3 days: DPD, Omniva, SmartPosti, courier · free in Estonia from $1 · pickup at Mardi 1" }],
    [/^(.+) × (\d+)$/, { ET: "$1 × $2", EN: "$1 × $2" }],
    [/^DPD, Omniva, SmartPosti и курьер · 1–3 дня · по Эстонии бесплатно от (.+) · 230 пакоматов в 4 странах$/,
      { ET: "DPD, Omniva, SmartPosti ja kuller · 1–3 päeva · Eestis tasuta alates $1 · 230 pakiautomaati 4 riigis", EN: "DPD, Omniva, SmartPosti and courier · 1–3 days · free in Estonia from $1 · 230 parcel lockers in 4 countries" }],
    [/^Пакомат (DPD|Omniva|SmartPosti)$/, { ET: "Pakiautomaat $1", EN: "$1 parcel locker" }],
    [/^Пакомат — (\d+) (?:точка|точки|точек)$/, { ET: "Pakiautomaat — $1 punkti", EN: "Parcel locker — $1 locations" }],
    [/^Всё, что есть в наличии от (.+) — во всех разделах магазина\.$/,
      { ET: "Kõik, mis on laos brändilt $1 — kõigist osakondadest.", EN: "Everything in stock from $1 — across every section." }],
    [/^По запросу «(.+)» ничего не нашлось\.$/, { ET: "Otsingule «$1» ei leidunud midagi.", EN: "Nothing found for “$1”." }],
    [/^\/ (.+)$/, { ET: "/ $1", EN: "/ $1" }],
    [/^Найдено: (\d+)$/, { ET: "Leitud: $1", EN: "Found: $1" }]
  ];
  /* Product names keep their Latin line names; only the Russian type tail
     and the common Russian descriptors are localised. */
  var NAME_TAILS = {
    "шампунь": ["šampoon", "shampoo"], "кондиционер": ["palsam", "conditioner"],
    "маска": ["mask", "mask"], "сыворотка": ["seerum", "serum"],
    "тоник": ["toonik", "toner"], "спрей": ["sprei", "spray"],
    "масло": ["õli", "oil"], "бальзам": ["palsam", "balm"],
    "паста": ["pasta", "paste"], "воск": ["vaha", "wax"],
    "пудра": ["puuder", "powder"], "гель": ["geel", "gel"],
    "крем": ["kreem", "cream"], "пенка": ["vaht", "foam"],
    "лосьон": ["losjoon", "lotion"], "патчи": ["plaastrid", "patches"]
  };
  var NAME_FRAGS = [
    [/ для волос/g, { ET: " juustele", EN: " for hair" }],
    [/ для кожи головы/g, { ET: " peanahale", EN: " for scalp" }],
    [/ для укладки/g, { ET: " soengu jaoks", EN: " for styling" }],
    [/ для лица/g, { ET: " näole", EN: " for face" }],
    [/ для бороды/g, { ET: " habemele", EN: " for beard" }],
    [/ для бритья/g, { ET: " raseerimiseks", EN: " for shaving" }],
    [/(\d) мл\b/g, { ET: "$1 ml", EN: "$1 ml" }]
  ];
  var TAIL_EXACT = {
    "футболка оверсайз": ["oversized T-särk", "oversized tee"],
    "парфюм": ["parfüüm", "perfume"]
  };
  /* Product names only — the fragment rules would turn an ordinary sentence
     into franglais, so this never runs outside name-bearing elements. */
  function trName(s, lang) {
    var i = lang === "ET" ? 0 : 1;
    return s.replace(/ — ([а-яё][а-яё \-]*)$/i, function (m, tail) {
      var low = tail.toLowerCase();
      if (TAIL_EXACT[low]) return " — " + TAIL_EXACT[low][i];
      var parts = low.split(" ");
      var head = NAME_TAILS[parts[0]];
      if (!head) return m;
      var rest = " " + parts.slice(1).join(" ");
      if (rest !== " ") {
        NAME_FRAGS.forEach(function (fr) { rest = rest.replace(fr[0], fr[1][lang]); });
        if (/[а-яё]/.test(rest)) return " — " + head[i]; // untranslatable remainder — drop it
      } else rest = "";
      return " — " + head[i] + rest;
    });
  }
  function trText(s, lang, allowName) {
    var d = UI[lang];
    if (d[s]) return d[s];
    for (var i = 0; i < UI_RX.length; i++) {
      var m = s.match(UI_RX[i][0]);
      if (m) {
        return UI_RX[i][1][lang].replace(/\$(\d)/g, function (_, n) {
          var piece = m[+n];
          return d[piece] || (allowName ? trName(piece, lang) : piece) || piece;
        });
      }
    }
    if (allowName && /[А-Яа-яЁё]/.test(s)) {
      var n2 = trName(s, lang);
      if (n2 !== s) return n2;
    }
    return s;
  }
  var TR_ATTRS = ["placeholder", "aria-label", "title"];
  var NAME_CTX = ".card__name,.cline__nm,.cosum__nm,.crumbs,.pdp,.rail,h1,option,.adm__nm";
  function translateTree(root) {
    if (S.lang === "RU" || !root) return;
    var lang = S.lang;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = w.nextNode())) {
      var raw = node.nodeValue;
      var t = raw.trim();
      if (!t || !/[А-Яа-яЁё]/.test(t)) continue;
      var el = node.parentElement;
      var allowName = !!(el && el.closest && el.closest(NAME_CTX));
      var tr = trText(t, lang, allowName);
      if (tr !== t) node.nodeValue = raw.replace(t, tr);
    }
    var els = root.querySelectorAll ? root.querySelectorAll("[placeholder],[aria-label],[title]") : [];
    for (var i = 0; i < els.length; i++) {
      for (var a = 0; a < TR_ATTRS.length; a++) {
        var v = els[i].getAttribute(TR_ATTRS[a]);
        if (v && /[А-Яа-яЁё]/.test(v)) {
          var tv = trText(v, S.lang, false);
          if (tv !== v) els[i].setAttribute(TR_ATTRS[a], tv);
        }
      }
    }
  }
  function translatePage() {
    translateTree(hdrSlot); translateTree(bodySlot); translateTree(navSlot); translateTree(ovl);
  }

  var BANNERS = [
    { eyebrow: "Таллинн · Mardi 1 · est 2018", t: "Профессиональный уход", s: "Kevin.Murphy, Davines, System 4 — то, чем работает команда Rempire в салоне.", c: "В каталог", cat: "hair" },
    { eyebrow: "Новинки", t: "Свежая поставка", s: "Уход и стайлинг, которые только приехали.", c: "Смотреть", cat: "styling" },
    { eyebrow: "Борода", t: "Всё для формы", s: "Масла, бальзамы и воски для ухода за бородой.", c: "В каталог", cat: "beard" },
    { eyebrow: "Парфюмерия", t: "Ниша и классика", s: "Creed, Tom Ford, Xerjoff, Byredo — то, что держим в наличии.", c: "Смотреть", cat: "perfume" },
    // no merch here: the model shots don't cut out (vignette backdrop), and a
    // cropped print in the hero read badly — the soaps are the house-made
    // product that photographs like the rest of the catalogue
    { eyebrow: "Сделано в Rempire", t: "Мыло ручной работы", s: "Чёрное 666 и розовое Rule Nr 1 — варим сами, маленькими партиями.", c: "Смотреть", cat: "body", pid: "handmade-soap-666" }
  ];
  function bannerProduct(b) {
    if (b.pid) {
      for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === b.pid) return CATALOGUE[i];
    }
    var l = CATALOGUE.filter(function (x) { return x.cat === b.cat && x.stock !== "out"; });
    return l[0] || CATALOGUE[0];
  }

  /* Delivery prices are the carriers' own published rates (shipping-data.js:
     Omniva business list valid 21.02.2025, SmartPosti business-prepaid
     11.03.2026, DPD business list 2025), converted to VAT-inclusive at 24% and
     rounded to ten cents. They are list prices for a shop under ~40 parcels a
     month — Omniva and DPD both discount above that — so read them as a
     ceiling, not as Rempire's eventual contract rate.
     `pm` names the carrier whose real parcel-machine list to offer. Only
     carriers with a verified location list are offered per country: Omniva has
     no machines in Finland at all, and DPD publishes no open list for LV/LT. */
  function shipPrice(carrier, service, dest, fallback) {
    try {
      var rows = SHIPPING_DATA.prices.parcelRef.rows;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.carrier === carrier && r.service === service &&
            String(r.dest).indexOf(dest) === 0 && typeof r.incVat === "number") {
          return Math.round(r.incVat * 10) / 10;
        }
      }
    } catch (e) {}
    return fallback;
  }
  var SHIP = {
    EE: [
      { l: "Самовывоз — Mardi 1, Таллинн", p: 0, pickup: true },
      { l: "Пакомат DPD", p: shipPrice("DPD", "Pickup", "EE", 4.5), pm: "dpd" },
      { l: "Пакомат Omniva", p: shipPrice("Omniva", "pakiautomaat", "EE", 5.5), pm: "omniva" },
      { l: "Пакомат SmartPosti", p: shipPrice("SmartPosti", "pakiautomaat", "EE", 5.5), pm: "smartpost" },
      { l: "Курьер до двери (DPD)", p: shipPrice("DPD", "kuller", "EE", 9) }
    ],
    LV: [
      { l: "Пакомат Omniva", p: shipPrice("Omniva", "pakiautomaat", "LV", 10.6), pm: "omniva" },
      { l: "Курьер DPD", p: shipPrice("DPD", "kuller", "LV", 13.6) }
    ],
    LT: [
      { l: "Пакомат Omniva", p: shipPrice("Omniva", "pakiautomaat", "LT", 11.8), pm: "omniva" },
      { l: "Курьер DPD", p: shipPrice("DPD", "kuller", "LT", 15.6) }
    ],
    FI: [
      { l: "Пакомат SmartPosti", p: shipPrice("SmartPosti", "pakiautomaat", "FI", 15.7), pm: "smartpost" },
      { l: "Курьер DPD", p: shipPrice("DPD", "kuller", "FI", 26) }
    ],
    /* DPD's rest-of-Europe band is 26–56 € incl. VAT depending on country
       (shipping-data.js restOfEuropeAt10kg); a flat 33 sits mid-band for the
       common destinations (DE 37, PL 30, SE 29 incl. VAT). */
    EU: [{ l: "Курьер DPD по Европе", p: 33 }]
  };
  /* Free-shipping floors per country. 50 € everywhere was the questionnaire
     answer, but the real carrier rates make it a giveaway outside Estonia:
     FI courier alone is ~26 € incl. VAT. These floors keep the promise
     sensible; the final numbers are Renat's call and trivially editable. */
  var THRESH = { EE: 50, LV: 75, LT: 75, FI: 100, EU: 200 };
  function machinesFor(m) {
    if (!m || !m.pm) return [];
    try {
      var byCarrier = SHIPPING_DATA.machines[S.country];
      if (byCarrier && byCarrier[m.pm] && byCarrier[m.pm].length) return byCarrier[m.pm];
    } catch (e) {}
    return [];
  }
  var COUNTRIES = [["EE", "Эстония"], ["LV", "Латвия"], ["LT", "Литва"], ["FI", "Финляндия"], ["EU", "Другая страна Европы"]];

  var PAYS = [
    { l: "Банковская ссылка", h: "Swedbank, SEB, LHV, Luminor, Coop — оплата в своём банке", k: "bank" },
    { l: "Банковская карта", h: "Visa, Mastercard", k: "card" },
    { l: "Apple Pay / Google Pay", h: "Оплата в одно касание", k: "wallet" },
    { l: "По счёту — для компаний", h: "Счёт на почту, оплата в течение 7 дней", k: "invoice" }
  ];
  var BANKS = ["Swedbank", "SEB", "LHV", "Luminor", "Coop"];

  // ---------- state ----------
  var S = {
    screen: "home",
    cat: "hair",
    productId: null,
    slide: 0,
    lang: "RU",
    langOpen: false,
    cart: [],           // {id, size, qty}
    cartOpen: false,
    filterOpen: false,
    query: "",
    shown: 12,          // catalog infinite scroll
    loading: false,
    country: "EE",
    method: 0,
    machine: 0,
    promo: "",
    promoOk: false,
    promoErr: false,
    email: "",
    emailTouched: false,
    shipTouched: false,   // delivery errors stay quiet until they try to continue
    loggedIn: false,
    acctMethod: 1,
    acctMachine: 0,
    toast: null,
    coStep: 1,
    sumOpen: null,      // checkout summary; null = follow the breakpoint
    ship: { name: "", addr: "", zip: "", city: "", phone: "" },
    newsletter: false,
    invoiceCo: "",
    acctName: "",
    pay: 0,
    bank: 0,
    adminTab: "over",
    adminAsk: "",
    admNav: true,       // admin side panes collapse to rails
    admAi: true,
    size: 0,
    qty: 1,
    gallery: 0,
    sort: "hit",
    subcat: "",         // one honest level below the category (v2)
    infoSlug: "",       // which legal/info page is open
    onlyInStock: false,
    brand: "",          // brand-scoped catalogue view (the Бренды section)
    brandFilter: []
  };

  var LS = "rempire-shop-proto";
  try {
    var saved = JSON.parse(localStorage.getItem(LS) || "{}");
    // Drop lines whose product no longer exists — byId() falls back to the
    // first product, which would silently show the wrong item at the wrong
    // price after a catalogue change.
    if (saved.cart) S.cart = saved.cart.filter(function (l) {
      for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === l.id) return true;
      return false;
    });
    if (saved.lang) { S.lang = saved.lang; savedHadLang = true; }
    else S.lang = guessLang();
  } catch (e) {}
  var savedHadLang = false;
  /* First visit: follow the browser's language. Estonian browsers get ET,
     English get EN, everything else stays RU — the shop's core audience.
     A generic-English browser is then refined by the visitor's country
     (/api/geo/, from Vercel's IP header) after the first paint; an explicit
     choice from the switcher always wins and is never overridden. */
  function guessLang() {
    try {
      var ls = navigator.languages || [navigator.language || ""];
      for (var i = 0; i < ls.length; i++) {
        var l = String(ls[i]).toLowerCase();
        if (l.indexOf("et") === 0) return "ET";
        if (l.indexOf("ru") === 0) return "RU";
        if (l.indexOf("en") === 0) return "EN";
      }
    } catch (e) {}
    return "RU";
  }
  function persist() {
    try { localStorage.setItem(LS, JSON.stringify({ cart: S.cart, lang: S.lang })); } catch (e) {}
  }

  // ---------- helpers ----------
  function eur(n) {
    return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";
  }
  function byId(id) { for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i]; return CATALOGUE[0]; }
  function sizePrice(p, i) {
    if (p.prices && p.prices.length) return p.prices[Math.min(i, p.prices.length - 1)];
    return p.price;
  }
  function gal(p) { return p.gallery && p.gallery.length ? p.gallery : [p.img]; }
  function cartCount() { var n = 0; S.cart.forEach(function (l) { n += l.qty; }); return n; }
  function cartSum() { var s = 0; S.cart.forEach(function (l) { s += sizePrice(byId(l.id), l.size || 0) * l.qty; }); return s; }
  function threshold() { return THRESH[S.country] || 200; }
  // deliberately pre-discount: the industry norm is that a promo code does
  // not revoke free shipping the cart already earned
  function freeShip() { return cartSum() >= threshold(); }
  function methods() { return SHIP[S.country]; }
  /* Clamp the stored index rather than clamping only on read: the radio
     markup compares `i === S.method` exactly, so an out-of-range index left
     every radio unchecked while the summary still billed a method. */
  function methodIdx() { S.method = Math.min(S.method, methods().length - 1); return S.method; }
  function acctIdx() { S.acctMethod = Math.min(S.acctMethod, methods().length - 1); return S.acctMethod; }
  function method() { return methods()[methodIdx()]; }
  function shipCost() { return freeShip() ? 0 : method().p; }
  function discount() { return S.promoOk ? Math.round(cartSum() * 10) / 100 : 0; }
  function total() { return cartSum() - discount() + shipCost(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function emailBad() { return S.emailTouched && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(S.email); }
  /* One regex, but not one message: "there is a typo in the domain" is simply
     wrong for an empty field, which is the most common failure. */
  function emailMsg() {
    if (!S.email.trim()) return "Введите e-mail — на него придёт подтверждение заказа.";
    if (S.email.indexOf("@") < 0) return "В адресе не хватает знака @.";
    return "Проверьте адрес — похоже, в нём опечатка.";
  }
  function wide() { try { return matchMedia("(min-width: 768px)").matches; } catch (e) { return true; } }

  /* Brands are how this shop is actually shopped — Renat's customers come for
     Kevin.Murphy or Davines, not for "hair care". A brand view scopes the
     catalogue across every category. */
  /* Brand marks lifted from the live shop's own collection covers (black on
     white, flood-filled to alpha — see tools/build-brandlogos.mjs). Renat has
     covers for these five only; every other brand falls back to its name set
     in the display face, which keeps the tile grid consistent. */
  var BRAND_LOGOS = {
    "Captain Fawcett": "/shop/brands/captain-fawcett.webp",
    "Davines": "/shop/brands/davines.webp",
    "Kevin.Murphy": "/shop/brands/kevin-murphy.webp",
    "System 4": "/shop/brands/system-4.webp",
    "Lumin Skin": "/shop/brands/lumin-skin.webp"
  };
  function brandMark(name, cls) {
    return BRAND_LOGOS[name]
      ? '<span class="' + cls + '__logo" style="background-image:url(\'' + BRAND_LOGOS[name] + '\')" role="img" aria-label="' + esc(name) + '"></span>'
      : '<span class="' + cls + '__word">' + esc(name) + "</span>";
  }
  function brands() {
    var seen = {}, out = [];
    CATALOGUE.forEach(function (p) {
      if (!seen[p.brand]) { seen[p.brand] = { name: p.brand, n: 0, p: p }; out.push(seen[p.brand]); }
      seen[p.brand].n++;
    });
    return out.sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  }
  /* Subcategories are read out of the product names, so a chip never claims
     a shelf the data cannot fill — chips render only with a non-zero count.
     A second scrollable chip row, not a dropdown: the category bar already
     scrolls sideways on a phone, and a dropdown hanging off a moving bar is
     exactly the interaction Renat flagged as awkward. */
  var SUBCATS = {
    hair: [
      { id: "sh", name: "Шампуни", re: /шампунь/i },
      { id: "co", name: "Кондиционеры", re: /кондиционер/i },
      { id: "ca", name: "Маски и уход", re: /маск|сыворотк|тоник|уход/i },
      { id: "sp", name: "Спреи", re: /спрей/i }
    ],
    styling: [
      { id: "pw", name: "Пасты и воски", re: /паста|воск/i },
      { id: "sp", name: "Спреи", re: /спрей/i },
      { id: "ge", name: "Гели", re: /гель/i },
      { id: "pu", name: "Пудры", re: /пудр/i }
    ],
    beard: [
      { id: "oi", name: "Масла", re: /масло/i },
      { id: "ba", name: "Бальзамы", re: /бальзам/i },
      { id: "af", name: "После бритья", re: /лосьон|после бритья/i },
      { id: "ge", name: "Гели", re: /гель/i }
    ],
    face: [
      { id: "to", name: "Тоники", re: /тоник/i },
      { id: "cl", name: "Очищение", re: /очища|пенка|мыло/i },
      { id: "cs", name: "Кремы и сыворотки", re: /крем|сыворотк/i },
      { id: "oi", name: "Масла", re: /масло/i }
    ]
  };
  function subcatsFor(list) {
    var defs = !S.brand && SUBCATS[S.cat];
    if (!defs) return [];
    return defs.map(function (d) {
      return { id: d.id, name: d.name, n: list.filter(function (p) { return d.re.test(p.name); }).length, re: d.re };
    }).filter(function (d) { return d.n > 0; });
  }

  function filtered() {
    if (S.brand) {
      var b = CATALOGUE.filter(function (p) { return p.brand === S.brand; });
      if (S.onlyInStock) b = b.filter(function (p) { return p.stock !== "out"; });
      if (S.sort === "new") b = b.slice().reverse();
      if (S.sort === "asc") b = b.slice().sort(function (x, y) { return x.price - y.price; });
      if (S.sort === "desc") b = b.slice().sort(function (x, y) { return y.price - x.price; });
      return b;
    }
    var list = S.cat === "all" ? CATALOGUE.slice() : CATALOGUE.filter(function (p) { return p.cat === S.cat; });
    if (S.subcat) {
      var sdef = (SUBCATS[S.cat] || []).filter(function (d) { return d.id === S.subcat; })[0];
      if (sdef) list = list.filter(function (p) { return sdef.re.test(p.name); });
    }
    if (S.onlyInStock) list = list.filter(function (p) { return p.stock !== "out"; });
    if (S.brandFilter.length) list = list.filter(function (p) { return S.brandFilter.indexOf(p.brand) >= 0; });
    if (S.sort === "new") list = list.slice().reverse();
    if (S.sort === "asc") list = list.slice().sort(function (a, b) { return a.price - b.price; });
    if (S.sort === "desc") list = list.slice().sort(function (a, b) { return b.price - a.price; });
    return list;
  }
  /* Russian inflects, so a literal substring match fails on the obvious
     queries: "борода" never appears inside "Уход за бородой". Trimming up to
     two trailing letters (never below four) is enough of a stem for a
     catalogue this size, and it keeps short brand names intact. */
  function stem(w) {
    return w.length > 5 ? w.slice(0, w.length - 2) : w.length > 4 ? w.slice(0, w.length - 1) : w;
  }
  function searchResults() {
    var q = S.query.trim().toLowerCase();
    if (!q) return [];
    var words = q.split(/\s+/).map(stem);
    return CATALOGUE.filter(function (p) {
      var hay = (p.name + " " + p.brand + " " + CAT_NAMES[p.cat]).toLowerCase();
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      return true;
    });
  }

  // ---------- components ----------
  /* Product photos are local and background-stripped, so no blend mode is
     needed to hide a white backing — which also means nothing breaks when a
     parent picks up an opacity transition. Merch is a model shot: it keeps
     its frame and fills the tile edge to edge instead. */
  function media(p, i, cls) {
    var g = gal(p), src = g[Math.min(i || 0, g.length - 1)];
    return '<span class="' + (cls || "ph") + (p.fill === "cover" ? " ph--cover" : "") +
      '" style="background-image:url(\'' + src + '\')"></span>';
  }

  function cardHTML(p) {
    var price = (p.priceFrom ? "от " : "") + eur(p.price);
    var stock = p.stock === "low" ? '<span class="chip chip--low">мало</span>'
      : p.stock === "out" ? '<span class="chip chip--out">нет в наличии</span>' : "";
    var g = gal(p);
    // card and add are siblings: a button inside a button is invalid markup
    // and left the add link unreachable from the keyboard.
    return '<div class="card' + (g.length > 1 ? " card--dual" : "") + '">' +
      '<button class="card__go" data-go-product="' + p.id + '">' +
        '<span class="card__media">' +
          media(p, 0, "ph card__img") +
          (g.length > 1 ? media(p, 1, "ph card__img2") : "") +
          '<span class="card__wm"></span>' +
        "</span>" +
        '<span class="card__brand">' + esc(p.brand) + "</span>" +
        '<span class="card__name">' + esc(p.name) + "</span>" +
        '<span class="card__price num">' + price + " " + stock + "</span>" +
      "</button>" +
      (p.stock === "out" ? "" : '<button class="link card__add" data-add="' + p.id + '">В корзину</button>') +
      "</div>";
  }

  function gpayOnDark() {
    if (typeof PAYLOGOS === "undefined" || !PAYLOGOS.gpay) return "G Pay";
    return '<span class="gpay-mark">' + PAYLOGOS.gpay + "</span>";
  }

  function payLogosHTML(keys) {
    var order = keys || ["bank", "visa", "mastercard", "applepay", "gpay"];
    return '<span class="paylogos">' + order.map(function (k) {
      return '<span class="paylogos__item paylogos__item--' + k + '">' +
        (typeof PAYLOGOS !== "undefined" && PAYLOGOS[k] ? PAYLOGOS[k] : k) + "</span>";
    }).join("") + "</span>";
  }

  // ---------- header (persistent) ----------
  function headerHTML() {
    return '<header class="hdr">' +
      '<div class="hdr__announce"><span class="wide-only">Бесплатная доставка: Эстония от ' + THRESH.EE + " € · LV, LT от " + THRESH.LV + " € · Финляндия от " + THRESH.FI + " €</span>" +
        '<span class="narrow-only">Бесплатная доставка по Эстонии от ' + THRESH.EE + " €</span></div>" +
      '<div class="hdr__row">' +
        '<button class="hdr__logo" data-go="home" data-ident title="На главную" aria-label="REMPIRE — на главную">' +
          towerDraw("hdr__tower") + '<span class="hdr__word">Rempire</span></button>' +
        '<div class="hdr__searchwrap">' +
          '<span class="hdr__searchicon">' + icon("search") + "</span>" +
          '<input class="hdr__search" data-search placeholder="Поиск: шампунь, Davines, паста…" aria-label="Поиск по магазину">' +
        "</div>" +
        '<span class="hdr__tools">' +
          '<span class="lang"><button class="lang__btn" data-langtoggle aria-label="Язык" aria-haspopup="listbox" aria-controls="langmenu" aria-expanded="false">' +
            '<span class="lang__flag" data-langflag></span><span class="lang__caret" aria-hidden="true">▾</span></button>' +
            '<div class="lang__menuslot"></div></span>' +
          '<button class="iconbtn" data-go="account" aria-label="Кабинет">' + icon("user") + "</button>" +
          '<button class="iconbtn" data-cart aria-label="Корзина">' + icon("bag") + '<span data-cartbadge></span></button>' +
        "</span>" +
      "</div>" +
      '<nav class="hdr__nav" aria-label="Категории">' +
        '<button data-go-cat="all">Все товары</button>' +
        CATS.map(function (c) { return '<button data-go-cat="' + c.id + '">' + c.name + "</button>"; }).join("") +
        '<button data-go="brands" data-nav-brands>Бренды</button>' +
      "</nav></header>";
  }

  function patchHeader() {
    var h = hdrSlot;
    if (!h.firstChild) return;
    var badge = h.querySelector("[data-cartbadge]");
    badge.outerHTML = cartCount()
      ? '<span class="badge num" data-cartbadge>' + cartCount() + "</span>"
      : '<span data-cartbadge hidden></span>';
    h.querySelector("[data-langflag]").style.backgroundImage = FLAG[S.lang];
    h.querySelector("[data-langtoggle]").setAttribute("aria-expanded", String(S.langOpen));
    h.querySelector(".lang__menuslot").innerHTML = S.langOpen
      ? '<div class="lang__menu" id="langmenu" role="listbox" aria-label="Язык интерфейса">' + LANGS.map(function (l) {
          return '<button class="lang__item" role="option" aria-selected="' + (S.lang === l[0]) + '" data-lang="' + l[0] + '">' +
            '<span class="lang__flag" style="background-image:' + FLAG[l[0]] + '"></span>' +
            '<span style="flex:1">' + l[1] + "</span>" + (S.lang === l[0] ? "<span>✓</span>" : "") + "</button>";
        }).join("") +
        '<p class="lang__note">Каталог, товары и инфостраницы — на трёх языках.</p></div>'
      : "";
    var srch = h.querySelector("[data-search]");
    if (document.activeElement !== srch) srch.value = S.query;
    h.querySelectorAll(".hdr__nav button").forEach(function (b) {
      if (b.dataset.navBrands !== undefined) {
        b.setAttribute("aria-current", String(S.screen === "brands" || (S.screen === "catalog" && !!S.brand)));
      } else {
        b.setAttribute("aria-current", String(S.screen === "catalog" && !S.brand && S.cat === b.dataset.goCat));
      }
    });
    // the language menu is re-created above in Russian on every patch
    translateTree(h);
  }

  // ---------- bottom nav (persistent) ----------
  var NAVITEMS = [
    ["home", "home", "Главная"],
    ["catalog", "grid", "Каталог"],
    ["search", "search", "Поиск"],
    ["account", "user", "Кабинет"],
    ["cart", "bag", "Корзина"]
  ];
  function botnavHTML() {
    return '<nav class="botnav" aria-label="Основная навигация">' + NAVITEMS.map(function (it) {
      return '<button data-' + (it[0] === "cart" ? "cart" : "go") + '="' + (it[0] === "cart" ? "1" : it[0]) + '" data-nav="' + it[0] + '">' +
        '<span class="botnav__ico">' + icon(it[1]) +
        (it[0] === "cart" ? '<span data-navbadge="cart"></span>' : "") + "</span>" + it[2] + "</button>";
    }).join("") + "</nav>";
  }
  function patchNav() {
    if (!navSlot.firstChild) return;
    navSlot.querySelectorAll("[data-nav]").forEach(function (b) {
      var k = b.dataset.nav;
      // the cart button opens a drawer, it is not a location — aria-expanded,
      // not aria-current
      if (k === "cart") b.setAttribute("aria-expanded", String(S.cartOpen));
      else b.setAttribute("aria-current", String(S.screen === k));
    });
    var nb = navSlot.querySelector('[data-navbadge="cart"]');
    nb.outerHTML = cartCount()
      ? '<span class="badge num" data-navbadge="cart">' + cartCount() + "</span>"
      : '<span data-navbadge="cart" hidden></span>';
  }

  /* Feedback #5: everything the old footer and the home info block carried,
     as seven collapsed sections. Closed by default, so the page ends in a
     short list instead of a wall; the pay logos live inside «Оплата» now and
     the bottom line keeps only the signature and the admin link. */
  function ftrSec(title, body) {
    return '<details class="ftr__acc"><summary>' + title + "</summary><div>" + body + "</div></details>";
  }
  function footer() {
    return '<footer class="ftr"><div class="wrap">' +
      '<div class="ftr__accs">' +
      ftrSec("Доставка", "DPD, Omniva, SmartPosti и курьер · 1–3 дня · по Эстонии бесплатно от " + THRESH.EE + " € · 230 пакоматов в 4 странах") +
      ftrSec("Оплата", payLogosHTML(["bank", "visa", "mastercard", "applepay", "gpay"]) + '<span class="ftr__pay">Банковская ссылка (Swedbank, SEB, LHV, Luminor, Coop), карта, Apple Pay / Google Pay, счёт для компаний.</span>') +
      ftrSec("Самовывоз", "Mardi 1, Таллинн · бесплатно · заказ ждёт 7 дней, дальше 1,50 € в день. Нужен документ.") +
      ftrSec("Реквизиты", "Rempire Store OÜ<br>Рег. 12216136 · KMKR EE102723858<br>Mardi 1, 10145 Таллинн") +
      ftrSec("Связаться", '<a href="tel:+37256237237">56237237</a> · <a href="mailto:rempireshopinfo@gmail.com">rempireshopinfo@gmail.com</a>') +
      ftrSec("Покупателю", '<button class="link" data-page="shipping">Доставка и оплата</button> · <button class="link" data-page="returns">Возврат товара</button> · <button class="link" data-page="terms">Условия продажи</button> · <button class="link" data-page="contact">Контакты</button>') +
      ftrSec("Правовое", '<button class="link" data-page="privacy">Конфиденциальность</button> · <button class="link" data-page="terms">Правовая информация</button> · <a href="https://ec.europa.eu/consumers/odr">Споры онлайн (ODR)</a>') +
      "</div>" +
      '<div class="ftr__bottom"><span class="ftr__sig">' + tower("ftr__mark") + "© 2026 Rempire Store OÜ</span>" +
        '<span class="socials socials--bottom">' +
          '<a class="social" href="https://www.instagram.com/rempire.shop/" aria-label="Rempire в Instagram" title="Instagram">' + icon("instagram") + "</a>" +
          '<a class="social" href="https://www.facebook.com/Rempire.Official.Tallinn" aria-label="Rempire в Facebook" title="Facebook">' + icon("facebook") + "</a>" +
          '<a class="social" href="https://www.tiktok.com/@rempire.official" aria-label="Rempire в TikTok" title="TikTok">' + icon("tiktok") + "</a>" +
        "</span>" +
        '<button class="link ftr__admin" data-go="admin">Админка — демо</button></div>' +
    "</div></footer>";
  }

  // ---------- screens ----------
  function screenHome() {
    var pop = spread(8, false), fresh = spread(8, true);
    return '<section class="hero" aria-label="Баннеры" aria-roledescription="карусель">' +
      BANNERS.map(function (b, i) {
        var p = bannerProduct(b);
        return '<div class="hero__slide" data-on="' + (i === S.slide ? 1 : 0) + '" aria-hidden="' + (i !== S.slide) + '">' +
          '<div class="hero__box">' +
            '<div class="hero__inner"><div class="hero__eyebrow">' + b.eyebrow + "</div>" +
            '<h2 class="hero__title">' + b.t + "</h2>" +
            '<p class="hero__sub">' + b.s + "</p>" +
            '<button class="btn" data-go-cat="' + b.cat + '">' + b.c + "</button></div>" +
            media(p, 0, "hero__art") +
          "</div></div>";
      }).join("") +
      '<button class="hero__arrow hero__arrow--prev" data-slide="-1" aria-label="Предыдущий баннер">‹</button>' +
      '<button class="hero__arrow hero__arrow--next" data-slide="1" aria-label="Следующий баннер">›</button>' +
      "</section>" +
      /* Brand strip in place of the dots' old neighbourhood: one scrollable
         line under the hero, D-urban style — every name clickable, logos
         where the brand has one (feedback #4). */
      '<nav class="brandstrip" aria-label="Бренды"><div class="brandstrip__row">' +
        brands().slice().sort(function (a, b) {
          return (BRAND_LOGOS[b.name] ? 1 : 0) - (BRAND_LOGOS[a.name] ? 1 : 0);
        }).map(function (b) {
          // wordmarks only, as in the urban sample — one typographic voice,
          // no logo/text zigzag along the line
          return '<button class="brandstrip__it" data-go-brand="' + esc(b.name) + '">' + esc(b.name) + "</button>";
        }).join("") + "</div></nav>" +
      '<div class="wrap">' +
        rail("Популярные товары", "Салонная косметика для лица, тела и волос — то, чем команда Rempire работает каждый день.", pop) +
        rail("Новые товары", "Свежие поступления: уход и стайлинг, парфюмерия и новый мерч.", fresh) +

        '<section class="sec"><div class="sec__head"><h2 class="sec__title">Категории</h2></div>' +
        '<div class="cattiles">' + CATS.map(function (c) {
          var p = bannerProduct({ cat: c.id });
          return '<button class="cattile" data-go-cat="' + c.id + '">' +
            '<span class="cattile__shot">' + media(p, 0, "ph cattile__img") + "</span>" +
            '<span class="cattile__name">' + c.name + "</span>" +
            '<span class="cattile__n num">' + (function (n) { return n + " " + plural(n); })(CATALOGUE.filter(function (x) { return x.cat === c.id; }).length) + "</span></button>";
        }).join("") + "</div></section>" +

      "</div>";
  }
  /* Both home rails take one product per category before taking a second, so
     neither ends up being eight shampoos or eight t-shirts. `fromEnd` is the
     "new in" pass; the catalogue is built in shop order. */
  function spread(n, fromEnd) {
    var byCat = {};
    CATALOGUE.forEach(function (p) { (byCat[p.cat] = byCat[p.cat] || []).push(p); });
    var keys = Object.keys(byCat), out = [];
    for (var round = 0; out.length < n && round < 10; round++) {
      for (var i = 0; i < keys.length && out.length < n; i++) {
        var list = byCat[keys[i]];
        var p = fromEnd ? list[list.length - 1 - round] : list[round];
        if (p && out.indexOf(p) < 0) out.push(p);
      }
    }
    return out;
  }

  function rail(title, intro, list) {
    return '<section class="sec"><div class="sec__head"><h2 class="sec__title">' + title +
      '</h2><button class="link" data-go-cat="all">Все товары</button></div>' +
      '<p class="sec__intro">' + intro + "</p>" +
      '<div class="grid">' + list.map(cardHTML).join("") + "</div></section>";
  }

  /* Descriptions and info pages exist in three languages; the source text is
     the shop's own English, RU/ET are its translations. UI chrome stays
     Russian in this round — only the content follows the switcher. */
  function descFor(p) {
    if (S.lang === "RU" && typeof CONTENT_RU !== "undefined" && CONTENT_RU[p.id]) return CONTENT_RU[p.id];
    if (S.lang === "ET" && typeof CONTENT_ET !== "undefined" && CONTENT_ET[p.id]) return CONTENT_ET[p.id];
    return (typeof CONTENT !== "undefined" && CONTENT[p.id]) || "";
  }
  function legalFor(slug) {
    if (S.lang === "RU" && typeof LEGAL_RU !== "undefined" && LEGAL_RU[slug]) return LEGAL_RU[slug];
    if (S.lang === "ET" && typeof LEGAL_ET !== "undefined" && LEGAL_ET[slug]) return LEGAL_ET[slug];
    return typeof LEGAL !== "undefined" ? LEGAL[slug] : null;
  }

  /* The old shop's own policy texts, served as real pages — placeholders
     until the lawyer pass, but real placeholders. */
  function screenInfo() {
    var pg = legalFor(S.infoSlug);
    if (!pg) { return '<div class="wrap"><section class="sec"><h1 class="display h1">Страница не найдена</h1><p><button class="link" data-go="home">На главную</button></p></section></div>'; }
    return '<div class="wrap wrap--mid">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / ' + esc(pg.title) + "</div>" +
      '<section class="sec"><h1 class="display h1">' + esc(pg.title) + "</h1>" +
      '<div class="legal">' + pg.html + "</div>" +
      '<p class="note" style="margin-top:22px">Текст перенесён с текущего сайта; перед запуском пройдёт проверку юристом.</p>' +
      "</section></div>";
  }

  function screenBrands() {
    return '<div class="wrap">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / Бренды</div>' +
      '<section class="sec" style="padding-top:14px">' +
      '<h1 class="display h1">Бренды</h1>' +
      '<p class="sec__intro">Марки, с которыми работает салон Rempire. Нажмите на бренд — покажем всё, что есть в наличии.</p>' +
      '<div class="brandtiles">' + brands().map(function (b) {
        return '<button class="brandtile" data-go-brand="' + esc(b.name) + '">' +
          '<span class="brandtile__mark">' + brandMark(b.name, "brandtile") + "</span>" +
          '<span class="brandtile__n num">' + b.n + " " + plural(b.n) + "</span></button>";
      }).join("") + "</div></section></div>";
  }

  function screenCatalog() {
    var list = filtered(), visible = list.slice(0, S.shown);
    var CAT_INTROS = {
      merch: "Фирменные футболки Rempire — принты наших художников, печатаем небольшими тиражами.",
      perfume: "Ниша и классика, которые держим в наличии в Таллинне.",
      body: "Гели, мыло и уход за телом — включая мыло собственной варки."
    };
    var name = S.brand ? S.brand : S.cat === "all" ? "Все товары" : CAT_NAMES[S.cat];
    var intro = S.brand
      ? "Всё, что есть в наличии от " + esc(S.brand) + " — во всех разделах магазина."
      : S.cat === "all"
        ? "Весь ассортимент Rempire: уход, стайлинг, борода, лицо, тело, парфюмерия и мерч."
        : CAT_INTROS[S.cat] || "Профессиональные средства, которыми команда Rempire работает в салоне.";
    return '<div class="wrap">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / ' +
        (S.brand ? '<button data-go="brands">Бренды</button> / ' + esc(S.brand) : name) + "</div>" +
      '<section class="sec" style="padding-top:14px">' +
        (S.brand && BRAND_LOGOS[S.brand]
          ? '<div class="brandhead">' + brandMark(S.brand, "brandhead") + "</div>"
          : '<h1 class="display h1">' + esc(name) + "</h1>") +
        '<p class="sec__intro">' + intro + "</p>" +
        (function () {
          var defs = subcatsFor(S.cat === "all" || S.brand ? [] : CATALOGUE.filter(function (p) { return p.cat === S.cat; }));
          if (!defs.length) return "";
          return '<div class="subcats" role="group" aria-label="Подкатегории">' +
            '<button class="scchip" data-subcat="" aria-current="' + (!S.subcat) + '">Все</button>' +
            defs.map(function (d) {
              return '<button class="scchip" data-subcat="' + d.id + '" aria-current="' + (S.subcat === d.id) + '">' +
                d.name + ' <span class="num">' + d.n + "</span></button>";
            }).join("") + "</div>";
        })() +
        '<div class="toolbar">' +
          (S.brand ? "" : '<button class="btn btn--ghost toolbar__filter" data-filter>Фильтры<span data-fcount>' + fcountLabel() + "</span></button>") +
          '<span class="toolbar__count num" data-count>' + list.length + " " + plural(list.length) + "</span>" +
          '<label class="toolbar__sort"><span class="toolbar__sortlbl">Сортировка</span>' +
          '<span class="sel"><select data-sort>' +
            '<option value="hit"' + (S.sort === "hit" ? " selected" : "") + ">Хиты продаж</option>" +
            '<option value="new"' + (S.sort === "new" ? " selected" : "") + ">Новинки</option>" +
            '<option value="asc"' + (S.sort === "asc" ? " selected" : "") + ">Сначала дешевле</option>" +
            '<option value="desc"' + (S.sort === "desc" ? " selected" : "") + ">Сначала дороже</option>" +
          "</select></span></label>" +
        "</div>" +
        activeChips() +
        (list.length
          ? '<div class="grid" id="catgrid">' + visible.map(cardHTML).join("") + "</div>" +
            '<div id="catmore">' + moreHTML(visible.length, list.length) + "</div>"
          : '<div class="empty"><p>Под эти фильтры ничего не подошло.</p>' +
            '<button class="btn btn--ghost" data-clearfilter>Сбросить фильтры</button></div>') +
      "</section></div>";
  }
  /* Russian counts take three forms; "12 товаров / 22 товара / 21 товар". */
  function pl(n, one, few, many) {
    var a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
    return many;
  }
  function plural(n) { return pl(n, "товар", "товара", "товаров"); }
  function points(n) { return n + " " + pl(n, "точка", "точки", "точек"); }
  function fcountLabel() {
    var n = S.brandFilter.length + (S.onlyInStock ? 1 : 0);
    return n ? " · " + n : "";
  }
  function moreHTML(shown, tot) {
    return shown < tot
      ? '<div id="sentinel"></div><div class="spinner" data-on="0"></div>'
      : '<p class="allshown">Показаны все ' + tot + " " + plural(tot) + "</p>";
  }
  function activeChips() {
    var out = [];
    if (S.onlyInStock) out.push('<button class="fchip" data-unstock>В наличии ✕</button>');
    S.brandFilter.forEach(function (b) {
      out.push('<button class="fchip" data-unbrand="' + esc(b) + '">' + esc(b) + " ✕</button>");
    });
    if (!out.length) return '<div class="fchips" data-chips hidden></div>';
    return '<div class="fchips" data-chips>' + out.join("") +
      '<button class="link" data-clearfilter>Сбросить всё</button></div>';
  }

  function screenProduct() {
    var p = byId(S.productId);
    var g = gal(p);
    var sizes = p.sizes && p.sizes.length ? p.sizes : [];
    return '<div class="wrap">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / <button data-go-cat="' + p.cat + '">' + CAT_NAMES[p.cat] + "</button> / " + esc(p.brand) + "</div>" +
      '<div class="pdp">' +
        "<div>" +
          // no watermark here: the stage is far larger than the product on a
          // desktop, so the mark floated in empty white and read as an artefact
          '<div class="pdp__stage">' + media(p, S.gallery, "ph pdp__img") + "</div>" +
          (g.length > 1 ? '<div class="pdp__thumbs">' + g.map(function (im, i) {
            return '<button data-gal="' + i + '" aria-label="Фото ' + (i + 1) + '" aria-current="' + (i === S.gallery) + '" class="pdp__thumb">' +
              media(p, i, "ph") + "</button>";
          }).join("") + "</div>" : "") +
        "</div>" +
        "<div>" +
          // brand line and share on one byline row: the brand label is a short
          // micro-caption with the whole row empty to its right, and sharing is
          // metadata about the product rather than a step in buying it
          '<div class="pdp__idrow">' +
            '<button class="card__brand pdp__brand" data-go-brand="' + esc(p.brand) + '">' + esc(p.brand) + " →</button>" +
            '<button class="pdp__share" data-share="' + p.id + '">' + icon("share") + "<span>Поделиться</span></button>" +
          "</div>" +
          '<h1 class="pdp__title">' + esc(p.name) + "</h1>" +
          '<div class="num pdp__price"><span data-price>' + eur(sizePrice(p, S.size)) + "</span>" +
            (p.stock === "out" ? ' <span class="chip chip--out">нет в наличии</span>'
              : p.stock === "low" ? ' <span class="chip chip--low">мало</span>' : "") + "</div>" +
          '<div class="pdp__tax">Налоги включены. Доставка рассчитается при оформлении.</div>' +
          variantPicker(p, sizes) +
          // the card hides its add button for stock:"out" — the product page
          // must agree, or a shopper "pays" for an item the shop cannot ship
          (p.stock === "out"
            ? '<div class="pdp__oos"><p>Товара сейчас нет. Оставьте почту — напишем, когда появится.</p>' +
              '<div class="pdp__oosrow"><input class="input input--box" type="email" inputmode="email" autocomplete="email" aria-label="E-mail для уведомления" placeholder="you@example.com">' +
              '<button class="btn btn--ghost" data-notify>Сообщить</button></div></div>'
            : '<div class="pdp__buy">' +
                '<span class="stepper"><button data-qty="-1" aria-label="Меньше">−</button><span class="num" data-qtynum>' + S.qty + '</span><button data-qty="1" aria-label="Больше">+</button></span>' +
                '<button class="btn pdp__add" data-add="' + p.id + '">В корзину</button>' +
              "</div>" +
              '<button class="btn btn--wide btn--express" data-buynow="' + p.id + '">Купить через ' + gpayOnDark() + "</button>" +
              // must add the product first — this used to jump to an empty cart
              // and toast «Корзина пуста» at someone standing on a product page
              '<div class="pdp__alt"><button class="link" data-buynow="' + p.id + '">Другие способы оплаты</button></div>') +
          '<div class="pdp__ship">Доставка 1–3 дня: DPD, Omniva, SmartPosti, курьер · по Эстонии бесплатно от ' + THRESH.EE + " € · самовывоз на Mardi 1</div>" +
          /* The live shop's own description when we have it (harvested — all
             95 products); the old placeholder text only where we somehow
             don't. Its images are stripped: cdn.shopify.com dies with the
             store, and the gallery already shows the product. */
          (descFor(p)
            ? acc("Описание", '<div class="acc__rich">' + descFor(p) + "</div>") +
              (p.cat === "merch"
                ? acc("Доставка и возврат", "14 дней на возврат по закону ЕС. Футболку можно примерить и вернуть, если не подошла.")
                : acc("Доставка и возврат", "14 дней на возврат по закону ЕС. Вскрытая косметика возврату не подлежит по гигиеническим причинам."))
            : p.cat === "merch"
            ? acc("Описание", "Фирменная футболка Rempire с принтом нашего художника. Плотный хлопок, печать держит стирку.") +
              acc("Размеры и уход", "Стирать при 30° наизнанку, не сушить в машине, гладить не по принту. Сомневаетесь в размере — берите больший.") +
              acc("Доставка и возврат", "14 дней на возврат по закону ЕС. Футболку можно примерить и вернуть, если не подошла.")
            : acc("Описание", "Профессиональное средство из салонного ассортимента Rempire. Подходит для регулярного ухода.") +
              acc("Применение", "Нанести на влажные волосы, вспенить, оставить на 2–5 минут, тщательно смыть.") +
              acc("Состав (INCI)", '<span class="muted">Полный состав будет заполнен при переносе каталога.</span>') +
              acc("Доставка и возврат", "14 дней на возврат по закону ЕС. Вскрытая косметика возврату не подлежит по гигиеническим причинам.")) +
        "</div>" +
      "</div>" +
      '<section class="sec"><div class="sec__head"><h2 class="sec__title">С этим покупают</h2></div><div class="grid">' +
        complementsFor(p).map(cardHTML).join("") +
      "</div></section></div>" +
      (p.stock === "out" ? "" :
        '<div class="stickybar"><span class="num stickybar__sum" data-stickysum>' + eur(sizePrice(p, S.size) * S.qty) + '</span><button class="btn" data-add="' + p.id + '">В корзину</button></div>');
  }
  function acc(title, body) {
    return '<details class="acc"><summary>' + title + "</summary><div class=\"acc__body\">" + body + "</div></details>";
  }

  /* Merch variants arrive as one flat "colour / size" list — ten buttons where
     the shopper makes two decisions. Split them into a Цвет row and a Размер
     row when the grid is complete; anything else falls back to one row. */
  var COLOUR_RU = {
    white: "белый", yellow: "жёлтый", black: "чёрный", pink: "розовый",
    grey: "серый", gray: "серый", red: "красный", blue: "синий", green: "зелёный"
  };
  function colourRu(c) { return COLOUR_RU[c.toLowerCase()] || c; }
  function splitVariants(sizes) {
    if (!sizes.length || sizes[0].indexOf(" / ") < 0) return null;
    var colours = [], szs = [], pairs = [];
    for (var i = 0; i < sizes.length; i++) {
      var parts = sizes[i].split(" / ");
      if (parts.length !== 2) return null;
      if (colours.indexOf(parts[0]) < 0) colours.push(parts[0]);
      if (szs.indexOf(parts[1]) < 0) szs.push(parts[1]);
      pairs.push(parts);
    }
    if (colours.length < 2 || colours.length * szs.length !== sizes.length) return null;
    return { colours: colours, sizes: szs, pairs: pairs };
  }
  function variantIndex(sizes, colour, size) {
    for (var i = 0; i < sizes.length; i++) if (sizes[i] === colour + " / " + size) return i;
    return 0;
  }

  /* ---------- «с этим покупают» — real pairing, not a category slice.
     A shampoo's best offer is ITS OWN line's conditioner (YOUNG.AGAIN.WASH →
     YOUNG.AGAIN.RINSE), then line-mates, then brand-mates of a complementary
     type. Scoring: shared name tokens weigh most, complementary product type
     next, same brand after that; in-stock beats out-of-stock. */
  var TYPE_MATES = {
    "шампунь": ["кондиционер", "маска"], "кондиционер": ["шампунь", "маска"],
    "маска": ["шампунь", "кондиционер"], "паста": ["шампунь", "спрей"],
    "воск": ["шампунь"], "гель": ["шампунь"], "пудра": ["спрей"],
    "масло": ["бальзам", "шампунь"], "бальзам": ["масло", "воск"]
  };
  function nameType(p) {
    var m = p.name.match(/ — ([а-яё]+)/i);
    return m ? m[1].toLowerCase() : "";
  }
  function nameTokens(p) {
    return p.name.split(/[^A-Za-z0-9]+/).filter(function (t) {
      return t.length > 2 && !/^(the|and|for|with|мл|ml)$/i.test(t);
    }).map(function (t) { return t.toUpperCase(); });
  }
  function complementsFor(p) {
    var mine = nameTokens(p), myType = nameType(p), mates = TYPE_MATES[myType] || [];
    var scored = [];
    for (var i = 0; i < CATALOGUE.length; i++) {
      var x = CATALOGUE[i];
      if (x.id === p.id) continue;
      var s = 0;
      var toks = nameTokens(x);
      for (var t = 0; t < mine.length; t++) if (toks.indexOf(mine[t]) >= 0) s += 3;
      var xt = nameType(x);
      if (xt && mates.indexOf(xt) >= 0) s += 4;
      if (x.brand === p.brand) s += 2;
      if (x.cat === p.cat) s += 1;
      if (x.stock !== "out") s += 1;
      if (s > 1) scored.push([s, x]);
    }
    scored.sort(function (a, b) { return b[0] - a[0]; });
    var out = scored.slice(0, 4).map(function (e) { return e[1]; });
    // thin categories fall back to neighbours so the shelf is never empty
    for (var j = 0; out.length < 4 && j < CATALOGUE.length; j++) {
      var c = CATALOGUE[j];
      if (c.id !== p.id && c.cat === p.cat && out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }
  function variantPicker(p, sizes) {
    // a single-variant volume still matters: 27 € for 10 мл is not 27 € for
    // 100 мл — show it as static text where the picker would sit
    if (sizes.length === 1) {
      return '<div class="pdp__vol">' + (p.cat === "merch" ? "Размер — " : "Объём — ") + esc(sizes[0]) + "</div>";
    }
    if (sizes.length < 2) return "";
    var sv = splitVariants(sizes);
    if (!sv) {
      return '<div class="field"><span class="field__label">' + (p.cat === "merch" ? "Размер" : "Объём") +
        '</span><div class="sizes">' + sizes.map(function (sz, i) {
          return '<button class="size" data-size="' + i + '" aria-current="' + (i === S.size) + '">' + esc(sz) + "</button>";
        }).join("") + "</div></div>";
    }
    var cur = sizes[Math.min(S.size, sizes.length - 1)].split(" / ");
    return '<div class="field"><span class="field__label">Цвет принта — <span data-colourname>' + esc(colourRu(cur[0])) +
      '</span></span><div class="sizes">' + sv.colours.map(function (c) {
        return '<button class="size" data-vcolour="' + esc(c) + '" aria-current="' + (c === cur[0]) + '">' + esc(colourRu(c)) + "</button>";
      }).join("") + "</div></div>" +
      '<div class="field"><span class="field__label">Размер</span><div class="sizes">' + sv.sizes.map(function (s2) {
        return '<button class="size" data-vsize="' + esc(s2) + '" aria-current="' + (s2 === cur[1]) + '">' + esc(s2) + "</button>";
      }).join("") + "</div></div>";
  }

  function screenSearch() {
    var res = searchResults();
    return '<div class="wrap"><section class="sec">' +
      '<h1 class="display h1">Поиск</h1>' +
      '<input class="input input--box searchbox" data-search2 value="' + esc(S.query) + '" placeholder="Что ищете?" aria-label="Поиск">' +
      (!S.query.trim()
        // every chip must actually return something — «воск» returned nothing
        // because the catalogue has no wax
        ? '<p class="muted">Популярные запросы: ' + ["шампунь", "борода", "Davines", "парфюм", "футболка"].map(function (q) { return '<button class="link" data-q="' + q + '">' + q + "</button>"; }).join(" · ") + "</p>"
        : res.length
          ? '<p class="muted num" style="margin-bottom:16px">' + res.length + " " + plural(res.length) + '</p><div class="grid">' + res.map(cardHTML).join("") + "</div>"
          : '<div class="empty"><p>По запросу «' + esc(S.query) + '» ничего не нашлось.</p>' +
            '<p class="muted">Проверьте написание или посмотрите категории:</p>' +
            '<div class="empty__cats">' + CATS.slice(0, 4).map(function (c) { return '<button class="btn btn--ghost btn--sm" data-go-cat="' + c.id + '">' + c.name + "</button>"; }).join("") + "</div>" +
            '<p class="muted">Напишите нам — поможем подобрать замену: <a class="link" href="tel:+37256237237">56237237</a> · <a class="link" href="mailto:rempireshopinfo@gmail.com">rempireshopinfo@gmail.com</a></p></div>') +
      "</section></div>";
  }

  function screenAccount() {
    if (!S.loggedIn) {
      return '<div class="wrap wrap--narrow"><section class="sec">' +
        '<h1 class="display h1">Кабинет</h1>' +
        '<p class="muted" style="margin-bottom:20px">Вход без пароля — пришлём код на почту. Покупать можно и без аккаунта.</p>' +
        '<label class="field"><span class="field__label">E-mail</span><input class="input" type="email" autocomplete="email" inputmode="email" data-email placeholder="you@example.com" value="' + esc(S.email) + '" aria-invalid="' + emailBad() + '"></label>' +
        (emailBad() ? '<div class="err" role="alert">' + emailMsg() + "</div>" : "") +
        '<button class="btn btn--wide" data-login>Получить код</button>' +
        "</section></div>";
    }
    var m = methods(), ai = acctIdx();
    return '<div class="wrap wrap--mid"><section class="sec">' +
      '<div class="acct__top"><h1 class="display h1">Кабинет</h1><button class="link" data-logout>Выйти</button></div>' +

      '<div class="sec__head sec__head--sub"><h2 class="sec__title">Мои данные</h2></div>' +
      '<label class="field"><span class="field__label">Имя</span><input class="input" data-acctname value="' + esc(S.acctName) + '" placeholder="Имя" autocomplete="given-name"></label>' +
      '<label class="field"><span class="field__label">E-mail</span><input class="input" type="email" data-email value="' + esc(S.email) + '" autocomplete="email"></label>' +
      '<button class="btn btn--ghost btn--sm" data-save>Сохранить</button>' +

      '<div class="sec__head sec__head--sub"><h2 class="sec__title">Доставка по умолчанию</h2></div>' +
      '<p class="muted" style="margin:0 0 12px">Подставим это при следующем заказе — менять можно в любой момент.</p>' +
      '<label class="field"><span class="field__label">Страна</span><span class="sel sel--box"><select data-acctcountry>' +
        COUNTRIES.map(function (c) { return '<option value="' + c[0] + '"' + (S.country === c[0] ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") +
      "</select></span></label>" +
      '<div class="optlist">' + m.map(function (x, i) {
        return '<label class="opt"><input type="radio" name="acctm" ' + (i === ai ? "checked" : "") + ' data-acctm="' + i + '"><span>' + x.l + "</span>" +
          '<span class="opt__price num">' + (x.p ? eur(x.p) : "Бесплатно") + "</span></label>";
      }).join("") + "</div>" +
      (machinesFor(m[ai]).length
        ? '<label class="field" style="margin-top:14px"><span class="field__label">Пакомат по умолчанию — ' + points(machinesFor(m[ai]).length) + '</span><span class="sel sel--box"><select data-acctmachine>' +
          machinesFor(m[ai]).map(function (n, i) { return "<option" + (i === Math.min(S.acctMachine, machinesFor(m[ai]).length - 1) ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + "</select></span></label>"
        : "") +

      '<div class="sec__head sec__head--sub"><h2 class="sec__title">Мои заказы</h2></div>' +
      '<div class="rowcard"><span class="num rowcard__id">#1042</span><span class="muted">12.08.2026 · 54 €</span>' +
        '<span class="chip chip--ok">доставлен</span>' +
        '<button class="link rowcard__act" data-repeat>Повторить заказ</button></div>' +

      '<div class="sec__head sec__head--sub"><h2 class="sec__title">Мои промокоды</h2></div>' +
      '<div class="rowcard"><span class="display rowcard__code">REMPIRE10</span>' +
        '<span class="muted">−10% ко дню рождения · до 30.09</span>' +
        '<span class="chip chip--ok rowcard__act">активен</span></div>' +
      "</section></div>";
  }

  // ---------- checkout ----------
  /* Which delivery fields matter depends on how the parcel travels: a parcel
     machine needs a name for the label but no street, a courier needs the
     lot, and both need a phone — the courier rings it, the machine texts it.
     A pickup needs nothing: they are coming to the counter, and the order in
     the confirmation e-mail is enough to hand it over. The phone is still
     offered there, just not demanded. */
  var SHIP_MSG = {
    name: "Впишите имя и фамилию — их напечатают на посылке.",
    addr: "Впишите улицу и дом.",
    zip: "Впишите индекс.",
    city: "Впишите город.",
    phone: "Впишите телефон — по нему звонит курьер и приходит смс от пакомата."
  };
  function shipRequired(key) {
    var sel = method();
    if (sel.pickup) return false;
    if (key === "name" || key === "phone") return true;
    return !sel.pm;
  }
  function phoneOk() { return S.ship.phone.replace(/\D/g, "").length >= 7; }
  function shipEmpty(key) { return key === "phone" ? !phoneOk() : !S.ship[key].trim(); }
  function shipMissing() {
    return ["name", "addr", "zip", "city", "phone"].filter(function (k) {
      return shipRequired(k) && shipEmpty(k);
    });
  }
  function shipBad(key) { return S.shipTouched && shipRequired(key) && shipEmpty(key); }
  function shipMsg(key) {
    if (key === "phone" && S.ship.phone.trim()) return "Проверьте номер — похоже, в нём не хватает цифр.";
    return SHIP_MSG[key];
  }

  function shipField(key, label, ph, auto, mode) {
    var bad = shipBad(key);
    // the note lives inside the label so the two-column индекс/город row keeps
    // each message in its own cell
    return '<label class="field"><span class="field__label">' + label + "</span>" +
      '<input class="input" data-shipf="' + key + '" value="' + esc(S.ship[key]) + '" placeholder="' + ph + '"' +
      (auto ? ' autocomplete="' + auto + '"' : "") + (mode ? ' inputmode="' + mode + '"' : "") +
      ' aria-invalid="' + bad + '">' +
      (bad ? '<div class="err" role="alert">' + shipMsg(key) + "</div>" : "") + "</label>";
  }
  /* Open the step that is wrong, draw its errors and put the caret in the
     first field that needs a hand. */
  function failStep(n, msg) {
    S.coStep = n;
    render();
    if (msg) toast(msg);
    refocus('.costep__body [aria-invalid="true"]');
  }
  function coHead(n, title, value) {
    var open = S.coStep === n, done = S.coStep > n;
    return '<button class="costep__head" data-step="' + n + '" aria-expanded="' + open + '"' + (open ? ' aria-current="true"' : "") + '>' +
      '<span class="costep__n' + (done ? " costep__n--done" : "") + '">' + (done ? "✓" : n) + "</span>" +
      '<span class="costep__t">' + title + "</span>" +
      (open ? "" : '<span class="costep__v">' + (value || "") + "</span>") +
      (open ? "" : '<span class="costep__edit">изменить</span>') + "</button>";
  }

  function screenCheckout() {
    var m = methods(), mi = methodIdx(), sel = m[mi], step = S.coStep;
    // The summary follows the breakpoint until the shopper touches it; after
    // that their choice wins, so applying a promo can't slam it shut.
    var summaryOpen = S.sumOpen === null ? wide() : S.sumOpen;
    return '<div class="cohdr"><div class="wrap wrap--co">' +
        '<button class="hdr__logo" data-go="home" data-ident aria-label="REMPIRE — на главную">' + tower("hdr__tower") + '<span class="hdr__word">Rempire</span></button>' +
        '<span class="cohdr__t">Оформление заказа</span>' +
        '<span class="cohdr__langs" role="group" aria-label="Язык интерфейса">' + LANGS.map(function (l) {
          return '<button class="cohdr__lang" data-lang="' + l[0] + '" aria-current="' + (S.lang === l[0]) + '">' + l[0] + "</button>";
        }).join("") + "</span>" +
        '<button class="link" data-go="home">← В магазин</button></div></div>' +
      '<div class="wrap wrap--co"><div class="co">' +

        '<div class="co__steps">' +
          '<section class="costep' + (step === 1 ? " is-open" : "") + '">' +
            coHead(1, "Контакт", esc(S.email || "—")) +
            (step === 1 ? '<div class="costep__body">' +
              '<label class="field"><span class="field__label">E-mail для подтверждения заказа</span>' +
              '<input class="input" type="email" autocomplete="email" data-email value="' + esc(S.email) + '" aria-invalid="' + emailBad() + '" placeholder="you@example.com" inputmode="email"></label>' +
              (emailBad() ? '<div class="err" role="alert">' + emailMsg() + "</div>" : '<div class="hint">Аккаунт не нужен — оформляйте как гость.</div>') +
              '<label class="opt opt--plain"><input type="checkbox" data-news' + (S.newsletter ? " checked" : "") + '><span>Хочу получать новости и скидки</span></label>' +
              '<button class="btn btn--wide" data-step="2">Далее — доставка</button></div>' : "") +
          "</section>" +

          '<section class="costep' + (step === 2 ? " is-open" : "") + '">' +
            coHead(2, "Доставка", sel.l + (S.ship.name ? " · " + esc(S.ship.name) : "")) +
            (step === 2 ? '<div class="costep__body">' +
              '<label class="field"><span class="field__label">Страна</span><span class="sel sel--box"><select data-country>' +
                COUNTRIES.map(function (c) { return '<option value="' + c[0] + '"' + (S.country === c[0] ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + "</select></span></label>" +
              '<div class="optlist">' + m.map(function (x, i) {
                return '<label class="opt"><input type="radio" name="ship" ' + (i === mi ? "checked" : "") + ' data-method="' + i + '"><span>' + x.l + "</span>" +
                  '<span class="opt__price num">' + (!x.p || freeShip() ? "Бесплатно" : eur(x.p)) + "</span></label>";
              }).join("") + "</div>" +
              (sel.pickup ? '<div class="hint">Забрать бесплатно на Mardi 1. Нужен документ. Заказ ждёт 7 дней, дальше 1,50 € в день.</div>' : "") +
              (machinesFor(sel).length ? '<label class="field"><span class="field__label">Пакомат — ' + points(machinesFor(sel).length) + '</span><span class="sel sel--box"><select data-machine>' +
                machinesFor(sel).map(function (n, i) { return "<option" + (i === Math.min(S.machine, machinesFor(sel).length - 1) ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + "</select></span></label>" : "") +
              '<div class="hint">' + (freeShip() ? "Бесплатная доставка применена ✓" : "Бесплатная доставка от " + threshold() + " € — не хватает " + eur(threshold() - cartSum())) + "</div>" +
              // every field is bound to S.ship — a render (promo, blur, resize)
              // used to wipe whatever the shopper had typed here
              (sel.pickup ? "" :
                shipField("name", "Имя и фамилия", "Имя Фамилия", "name", "") +
                (sel.pm ? "" : shipField("addr", "Адрес", "улица, дом", "street-address", "") +
                  '<div class="co__zip">' + shipField("zip", "Индекс", "12345", "postal-code", "numeric") +
                  shipField("city", "Город", "Город", "address-level2", "") + "</div>")) +
              shipField("phone", "Телефон", "+372…", "tel", "tel") +
              '<p class="cosrc">Тарифы — прайс-листы перевозчиков 2025–2026, с НДС 24 %. От 40 посылок в месяц Omniva и DPD дают скидку 3–20 % — итоговые цены уточним при подключении.' +
              (S.country === "FI" ? " Тариф курьера DPD в Финляндию — предварительный, ждёт подтверждения перевозчика." : "") +
              (S.country === "EU" ? " Точная цена по Европе зависит от страны — 26–56 € по прайсу DPD." : "") + "</p>" +
              '<button class="btn btn--wide" data-step="3">Далее — оплата</button></div>' : "") +
          "</section>" +

          '<section class="costep' + (step === 3 ? " is-open" : "") + '">' +
            coHead(3, "Оплата", "") +
            (step === 3 ? '<div class="costep__body">' +
              '<div class="optlist">' + PAYS.map(function (o, i) {
                return '<label class="opt opt--pay"><input type="radio" name="pay" ' + (i === S.pay ? "checked" : "") + ' data-paym="' + i + '">' +
                  '<span class="opt__txt"><span>' + o.l + "</span><span class=\"opt__hint\">" + o.h + "</span></span>" +
                  '<span class="opt__logos">' + payMark(o.k) + "</span></label>";
              }).join("") + "</div>" +
              (S.pay === 0 ? '<div class="banks">' + BANKS.map(function (b, i) {
                return '<button class="bank" data-bank="' + i + '" aria-current="' + (i === S.bank) + '">' + b + "</button>";
              }).join("") + "</div>" : "") +
              (S.pay === 3 ? '<label class="field" style="margin-top:14px"><span class="field__label">Название фирмы и рег. номер</span><input class="input" data-invoiceco value="' + esc(S.invoiceCo) + '" placeholder="OÜ Näidis · 12345678"></label>' : "") +
              "</div>" : "") +
          "</section>" +
          '<ul class="cotrust">' +
            "<li>Оплата через банк — данные карты магазин не видит</li>" +
            "<li>14 дней на возврат по закону ЕС</li>" +
            "<li>Вопросы — 56237237 или rempireshopinfo@gmail.com</li>" +
          "</ul>" +
        "</div>" +

        '<div class="co__sum"><details class="cosum" data-sum' + (summaryOpen ? " open" : "") + '>' +
          '<summary class="cosum__head"><span class="sec__title">Ваш заказ</span>' +
            '<span class="cosum__tot num">' + eur(total()) + "</span></summary>" +
          '<div class="cosum__body">' +
          (S.cart.length ? S.cart.map(function (l) {
            var p = byId(l.id);
            return '<div class="cosum__line"><span class="cosum__ph">' + media(p, 0, "ph") + "</span>" +
              '<span class="cosum__nm">' + esc(p.name) + lineLabel(l) + " × " + l.qty +
                ' <button class="link cosum__rm" data-remove="' + S.cart.indexOf(l) + '" aria-label="Убрать из заказа">Убрать</button></span>' +
              '<span class="num cosum__pr">' + eur(sizePrice(p, l.size || 0) * l.qty) + "</span></div>";
          }).join("") : '<p class="muted">Корзина пуста.</p>') +
          '<div class="cosum__promo"><input class="input input--box" data-promo aria-label="Промокод" placeholder="Промокод" value="' + esc(S.promo) + '"><button class="btn btn--ghost btn--sm" data-applypromo>Применить</button></div>' +
          (S.promoErr ? '<div class="err" role="alert">Код не найден — проверьте написание.</div>' : "") +
          (S.promoOk ? '<div class="cosum__row"><span>REMPIRE10 — скидка 10%</span><span class="num">−' + eur(discount()) + "</span></div>" : "") +
          '<div class="cosum__row cosum__row--rule"><span>Доставка — ' + sel.l + '</span><span class="num">' + (shipCost() ? eur(shipCost()) : "Бесплатно") + "</span></div>" +
          '<div class="cosum__row cosum__row--tot"><span>Итого</span><span class="num">' + eur(total()) + "</span></div>" +
          /* Both pay buttons wait for the payment step. Offered from step one
             they compete with «Далее» for the same tap and invite a shopper to
             pay before choosing how the parcel travels or how they are paying. */
          (step === 3
            ? '<button class="btn btn--wide co__pay" data-pay>Оплатить ' + eur(total()) + "</button>" +
              '<p class="cosum__legal">Нажимая «Оплатить», вы соглашаетесь с условиями и политикой возврата.</p>'
            : "") +
          "</div></details></div>" +

      "</div></div>" +
      (step === 3
        ? '<div class="stickybar"><span class="stickybar__tot"><span>Итого</span><span class="num">' + eur(total()) + '</span></span><button class="btn" data-pay>Оплатить</button></div>'
        : "");
  }
  function payMark(k) {
    if (typeof PAYLOGOS === "undefined") return "";
    if (k === "bank") return PAYLOGOS.bank;
    if (k === "card") return PAYLOGOS.visa + PAYLOGOS.mastercard;
    if (k === "wallet") return PAYLOGOS.applepay + PAYLOGOS.gpay;
    return "";
  }

  /* ---------- admin (demo) ----------
     Shop-owner side, so Renat can see what he would actually work in every
     day. Numbers are derived from the catalogue with a fixed seed rather than
     Math.random, so nothing jitters between renders. Clearly labelled demo. */
  var ORDER_STATES = [
    ["new", "новый", "--error"],
    ["packing", "собирается", "--muted"],
    ["sent", "отправлен", "--muted"],
    ["done", "доставлен", "--ok"]
  ];
  function fakeOrders() {
    var out = [];
    for (var i = 0; i < 14; i++) {
      var p1 = CATALOGUE[(i * 7 + 3) % CATALOGUE.length];
      var p2 = CATALOGUE[(i * 13 + 11) % CATALOGUE.length];
      var n = (i % 3) + 1;
      var sum = Math.round((p1.price * n + p2.price) * 100) / 100;
      out.push({
        id: 1042 + i,
        date: (27 - i) + ".08.2026",
        who: ["М. Тамм", "K. Saar", "А. Иванов", "L. Kask", "Д. Петров", "R. Lepik", "J. Mägi"][i % 7],
        items: n + 1,
        sum: sum,
        ship: SHIP.EE[(i % 4) + 1].l,
        state: ORDER_STATES[i === 0 ? 0 : i < 3 ? 1 : i < 6 ? 2 : 3]
      });
    }
    return out;
  }
  function lowStock() {
    return CATALOGUE.filter(function (p) { return p.stock !== "in"; });
  }

  var ADM_NAV = [
    ["over", "Обзор", "grid"],
    ["orders", "Заказы", "bag"],
    ["goods", "Товары", "grid"],
    ["people", "Клиенты", "user"],
    ["stats", "Аналитика", "chart"],
    ["mail", "Письма", "mail"],
    ["apps", "Подключения", "plug"],
    ["setup", "Настройки", "home"]
  ];
  function fakeCustomers() {
    var orders = fakeOrders(), by = {};
    orders.forEach(function (o) {
      if (!by[o.who]) by[o.who] = { who: o.who, n: 0, sum: 0, last: o.date };
      by[o.who].n++; by[o.who].sum += o.sum;
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return b.sum - a.sum; });
  }

  /* Three panes, the way a shop owner actually works: sections down the left,
     the work in the middle, the assistant always in view on the right. On a
     phone the nav becomes a scrolling strip and the assistant a sheet you
     open from the bar. */
  function screenAdmin() {
    var orders = fakeOrders();
    var week = orders.slice(0, 7).reduce(function (a, o) { return a + o.sum; }, 0);
    var tab = S.adminTab;
    // the admin header shares the full-width panes' column, not the 1020px
    // checkout column — otherwise the logo aligns with nothing below it
    return '<div class="cohdr cohdr--adm"><div class="cohdr__row">' +
        '<button class="hdr__logo" data-go="home" data-ident aria-label="REMPIRE — в магазин">' + tower("hdr__tower") + '<span class="hdr__word">Rempire</span></button>' +
        '<span class="cohdr__t">Админка</span>' +
        '<button class="link" data-go="home">← В магазин</button></div></div>' +
      '<div class="adm' + (S.admNav ? "" : " adm--navmin") + (S.admAi ? "" : " adm--aimin") + '">' +

      '<aside class="adm__side">' +
        '<button class="adm__toggle" data-admnav aria-expanded="' + S.admNav + '" ' +
          'aria-label="' + (S.admNav ? "Свернуть меню" : "Развернуть меню") + '" title="' +
          (S.admNav ? "Свернуть меню" : "Развернуть меню") + '">' + (S.admNav ? "«" : "»") + "</button>" +
        '<nav class="adm__nav" aria-label="Разделы админки">' +
        ADM_NAV.map(function (t) {
          return '<button data-admtab="' + t[0] + '" aria-current="' + (tab === t[0]) + '" title="' + t[1] + '">' +
            icon(t[2]) + '<span class="adm__navlbl">' + t[1] + "</span></button>";
        }).join("") + "</nav>" +
        '<div class="adm__who"><span class="adm__whoname">Renat</span>' +
          '<span class="adm__sub">Rempire Store OÜ · владелец</span></div></aside>' +

      '<main class="adm__main">' +
      '<div class="adm__note">Демонстрация. Заказы, клиенты и цифры вымышленные, товары — настоящие, из вашего каталога.</div>' +

      (tab === "over" ?
        '<div class="adm__kpis">' +
          kpi("Заказы сегодня", "3", "вчера — 5") +
          kpi("Выручка за 7 дней", eur(week), "в среднем " + eur(week / 7) + " в день") +
          kpi("Товаров в каталоге", String(CATALOGUE.length), CATS.length + " " + pl(CATS.length, "раздел", "раздела", "разделов")) +
          kpi("Заканчиваются", String(lowStock().length), "нужно дозаказать") +
        "</div>" +
        '<div class="sec__head sec__head--sub"><h2 class="sec__title">Последние заказы</h2><button class="link" data-admtab="orders">Все заказы</button></div>' +
        orderTable(orders.slice(0, 5)) +
        '<div class="sec__head sec__head--sub"><h2 class="sec__title">Заканчиваются на складе</h2></div>' +
        '<div class="adm__list">' + lowStock().slice(0, 6).map(function (p) {
          return '<div class="adm__row"><span class="adm__ph">' + media(p, 0, "ph") + "</span>" +
            '<span class="adm__nm">' + esc(p.brand) + " — " + esc(p.name) + "</span>" +
            '<span class="chip ' + (p.stock === "out" ? "chip--out" : "chip--low") + '">' + (p.stock === "out" ? "нет" : "мало") + "</span>" +
            '<span class="num adm__pr">' + eur(p.price) + "</span></div>";
        }).join("") + "</div>" : "") +

      (tab === "orders" ?
        '<p class="muted" style="margin:16px 0">Здесь заказ открывается в один клик: адрес, состав, оплата, наклейка на посылку и письмо клиенту с трекингом — всё на одной странице.</p>' +
        orderTable(orders) : "") +

      (tab === "goods" ?
        '<p class="muted" style="margin:16px 0">Цены, остатки и тексты правятся прямо здесь. Штрихкод со сканера ищет товар за секунду — приход и списание без ручного ввода.</p>' +
        '<div class="adm__list">' + CATALOGUE.slice(0, 24).map(function (p) {
          return '<div class="adm__row"><span class="adm__ph">' + media(p, 0, "ph") + "</span>" +
            '<span class="adm__nm">' + esc(p.brand) + " — " + esc(p.name) +
              '<span class="adm__sub">' + CAT_NAMES[p.cat] + (p.sizes && p.sizes.length ? " · " + p.sizes.join(", ") : "") + "</span></span>" +
            '<span class="chip ' + (p.stock === "out" ? "chip--out" : p.stock === "low" ? "chip--low" : "chip--ok") + '">' +
              (p.stock === "out" ? "нет" : p.stock === "low" ? "мало" : "в наличии") + "</span>" +
            '<span class="num adm__pr">' + eur(p.price) + "</span>" +
            '<button class="link" data-admedit>Править</button></div>';
        }).join("") + "</div>" +
        '<p class="muted" style="margin-top:16px">Показаны первые 24 из ' + CATALOGUE.length + ".</p>" : "") +

      (tab === "people" ?
        '<p class="muted" style="margin:16px 0">Кто покупает, как часто и на сколько. Отсюда же — письмо ко дню рождения и личный промокод.</p>' +
        '<div class="adm__table" role="table"><div class="adm__th adm__th--ppl" role="row">' +
          "<span>Клиент</span><span>Заказов</span><span>Потратил</span><span>Последний</span><span></span></div>" +
        fakeCustomers().map(function (c) {
          return '<div class="adm__tr adm__tr--ppl" role="row"><span>' + c.who + "</span>" +
            '<span class="num">' + c.n + "</span>" +
            '<span class="num">' + eur(c.sum) + "</span>" +
            '<span class="muted">' + c.last + "</span>" +
            '<button class="link" data-admedit>Промокод</button></div>';
        }).join("") + "</div>" : "") +

      (tab === "stats" ?
        '<p class="muted" style="margin:16px 0">Что происходит с магазином — простыми словами. Цифры вымышленные, вид настоящий.</p>' +
        '<div class="adm__kpis">' +
          kpi("Посетителей за 7 дней", "412", "+18% к прошлой неделе") +
          kpi("Оформили заказ", "2,2%", "из 100 посетителей — 2 заказа") +
          kpi("Средний чек", "43 €", "по последним 20 заказам") +
          kpi("Выручка за 30 дней", "486 €", "12 заказов") +
        "</div>" +
        '<div class="sec__head sec__head--sub"><h2 class="sec__title">Google — по каким словам находят</h2></div>' +
        '<div class="adm__table" role="table"><div class="adm__th adm__th--ppl" role="row"><span>Запрос</span><span>Место</span><span>Показы</span><span>Клики</span><span></span></div>' +
        [["kevin murphy tallinn", "4", "320", "38"], ["давинес шампунь", "7", "210", "16"],
         ["барбершоп мыло 666", "1", "95", "41"], ["system 4 шампунь купить", "9", "180", "9"]].map(function (r) {
          return '<div class="adm__tr adm__tr--ppl" role="row"><span>' + r[0] + '</span><span class="num">' + r[1] + '</span><span class="num">' + r[2] + '</span><span class="num">' + r[3] + "</span><span></span></div>";
        }).join("") + "</div>" +
        '<div class="sec__head sec__head--sub"><h2 class="sec__title">Откуда приходят</h2></div>' +
        '<div class="adm__list">' + [
          ["Google (поиск)", "44%"], ["Instagram", "27%"], ["Напрямую / закладки", "19%"], ["TikTok", "7%"], ["Рассылка", "3%"]
        ].map(function (r) {
          return '<div class="adm__row"><span class="adm__nm">' + r[0] + '</span><span class="num adm__pr">' + r[1] + "</span></div>";
        }).join("") + "</div>" +
        '<p class="muted" style="margin-top:16px">В рабочей версии сюда подключаются Google Search Console и аналитика посещений — всё настраивает Дмитрий, вам ничего делать не нужно.</p>' : "") +

      (tab === "mail" ?
        '<p class="muted" style="margin:16px 0">Письма, которые магазин шлёт сам. Включаются и выключаются одной кнопкой; текст можно менять через помощника.</p>' +
        '<div class="adm__list">' + [
          ["Заказ принят", "сразу после оплаты — номер заказа и состав", true],
          ["Заказ отправлен", "трек-номер и кнопка отслеживания", true],
          ["Товар снова в наличии", "тем, кто оставил почту на странице товара", true],
          ["Брошенная корзина", "напоминание через 24 часа, если заказ не завершён", false],
          ["Скидка ко дню рождения", "личный промокод за 3 дня до даты", false]
        ].map(function (f) {
          return '<div class="adm__row"><span class="adm__nm">' + f[0] + '<span class="adm__sub">' + f[1] + "</span></span>" +
            '<span class="chip ' + (f[2] ? "chip--ok" : "chip--low") + '">' + (f[2] ? "включено" : "выключено") + "</span>" +
            '<button class="link" data-admedit>' + (f[2] ? "Выключить" : "Включить") + "</button></div>";
        }).join("") + "</div>" +
        '<p style="margin-top:16px"><a class="link" href="/shop/emails/" target="_blank" rel="noopener">Открыть превью всех писем →</a></p>' : "") +

      (tab === "apps" ?
        '<p class="muted" style="margin:16px 0">Что к магазину подключено. Зелёное работает само; серое появится на следующих шагах — всё настраивает Дмитрий.</p>' +
        '<div class="adm__list">' + [
          ["Приём оплат", "банковские ссылки, карты, Apple/Google Pay", "после выбора провайдера", false],
          ["Доставка", "наклейки DPD / Omniva / SmartPosti и трекинг — через платёжного провайдера", "после выбора провайдера", false],
          ["Письма клиентам", "info@rempireshop.com через Resend", "после переноса домена", false],
          ["Google Search Console", "позиции в поиске и ошибки индексации", "настраивается", false],
          ["Аналитика посещений", "откуда приходят и что покупают", "настраивается", false],
          ["ИИ-помощник", "этот чат справа — умеет менять всё в магазине", "работает", true],
          ["Касса в салоне", "работает отдельно от сайта — переезд её не трогает", "работает", true]
        ].map(function (a) {
          return '<div class="adm__row"><span class="adm__nm">' + a[0] + '<span class="adm__sub">' + a[1] + "</span></span>" +
            '<span class="chip ' + (a[3] ? "chip--ok" : "chip--low") + '">' + a[2] + "</span></div>";
        }).join("") + "</div>" : "") +

      (tab === "setup" ?
        '<p class="muted" style="margin:16px 0">Всё, что можно настроить без программиста.</p>' +
        setupBlock("Доставка", SHIP.EE.map(function (x) {
          return x.l + " — " + (x.p ? eur(x.p) : "бесплатно");
        }).concat(["Бесплатно: Эстония от " + THRESH.EE + " € · LV, LT от " + THRESH.LV + " € · FI от " + THRESH.FI + " € · Европа от " + THRESH.EU + " €"])) +
        setupBlock("Оплата", PAYS.map(function (p) { return p.l; })) +
        setupBlock("Языки магазина", ["Русский — основной", "Eesti", "English"]) +
        setupBlock("Письма клиенту", [
          "Заказ принят", "Заказ отправлен + трекинг", "Товар снова в наличии",
          "Скидка ко дню рождения", "Брошенная корзина"
        ]) +
        setupBlock("Реквизиты", [
          "Rempire Store OÜ · рег. 12216136", "KMKR EE102723858", "Mardi 1, 10145 Таллинн"
        ]) : "") +
      "</main>" +

      '<aside class="adm__ai" aria-label="Помощник">' +
        '<div class="adm__aihead">' +
          '<button class="adm__toggle" data-admai aria-expanded="' + S.admAi + '" ' +
            'aria-label="' + (S.admAi ? "Свернуть помощника" : "Открыть помощника") + '" title="' +
            (S.admAi ? "Свернуть помощника" : "Открыть помощника") + '">' + (S.admAi ? "»" : "«") + "</button>" +
          '<span class="sec__title adm__ailbl">Помощник</span></div>' +
        '<div class="adm__aibody">' +
          (S.adminAsk
            ? '<div class="adm__q">' + esc(S.adminAsk) + "</div>" +
              '<div class="adm__a">' + adminAnswer(S.adminAsk) + "</div>"
            : '<p class="adm__aiintro">Я вижу ваш каталог, заказы и остатки. Спрашивайте обычными словами.</p>') +
          '<div class="adm__chips">' + [
            "Что заканчивается и что дозаказать?",
            "Сколько заработали на Kevin.Murphy?",
            "Добавь новый товар — вот фото",
            "Покажи аналитику за неделю",
            "Какие письма получают клиенты?",
            "Какие заказы ждут отправки?"
          ].map(function (q) { return '<button class="fchip" data-admask="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + "</div>" +
        "</div>" +
        '<div class="adm__aifoot"><input class="input input--box" placeholder="Спросить…" aria-label="Вопрос помощнику">' +
          '<button class="btn btn--sm" data-admedit>→</button></div>' +
      "</aside></div>";
  }
  function setupBlock(title, rows) {
    return '<div class="sec__head sec__head--sub"><h2 class="sec__title">' + title + "</h2></div>" +
      '<div class="adm__list">' + rows.map(function (r) {
        return '<div class="adm__row"><span class="adm__nm">' + r + "</span>" +
          '<button class="link" data-admedit>Изменить</button></div>';
      }).join("") + "</div>";
  }
  function kpi(label, value, sub) {
    return '<div class="kpi"><span class="kpi__l">' + label + '</span><span class="kpi__v num">' + value + '</span><span class="kpi__s">' + sub + "</span></div>";
  }
  function orderTable(list) {
    return '<div class="adm__table" role="table">' +
      '<div class="adm__th" role="row"><span>Заказ</span><span>Клиент</span><span>Доставка</span><span>Сумма</span><span>Статус</span></div>' +
      list.map(function (o) {
        return '<div class="adm__tr" role="row"><span class="num">#' + o.id + '<span class="adm__sub">' + o.date + "</span></span>" +
          "<span>" + o.who + '<span class="adm__sub">' + o.items + " " + plural(o.items) + "</span></span>" +
          '<span class="adm__ship">' + o.ship + "</span>" +
          '<span class="num">' + eur(o.sum) + "</span>" +
          '<span><span class="chip" style="color:var(' + o.state[2] + ')">' + o.state[1] + "</span></span></div>";
      }).join("") + "</div>";
  }
  // the assistant's answers end with a button that OPENS the right tab —
  // «где это?» answered by taking the owner there, not by describing a path
  function aiGo(tab, label) {
    return '<div style="margin-top:10px"><button class="btn btn--ghost btn--sm" data-admtab="' + tab + '">' + label + " →</button></div>";
  }
  function adminAnswer(q) {
    var low = lowStock();
    if (/заканчива|дозаказ/i.test(q)) {
      return "Заканчиваются " + low.length + " " + plural(low.length) + ". Срочно: " +
        low.slice(0, 3).map(function (p) { return esc(p.brand) + " " + esc(p.name); }).join(", ") +
        ". Могу собрать заказ поставщику и отправить его вам на подпись.";
    }
    if (/заработал|выручк|месяц/i.test(q)) {
      var km = CATALOGUE.filter(function (p) { return p.brand === "Kevin.Murphy"; });
      return "Kevin.Murphy: " + km.length + " " + plural(km.length) + " в каталоге, средняя цена " +
        eur(km.reduce(function (a, p) { return a + p.price; }, 0) / km.length) +
        ". В рабочей версии здесь будет выручка за месяц по бренду и сравнение с прошлым.";
    }
    if (/описан|текст/i.test(q)) {
      return "Готово — черновик на русском, эстонском и английском, с составом и способом применения. Заголовок и описание для Google подобраны автоматически. Останется прочитать и нажать «Опубликовать».";
    }
    if (/добав|новый товар|фото|загруз/i.test(q)) {
      return "Пришлите фото и цену — остальное сделаю сам: уберу фон с фотографии, поставлю фирменный водяной знак Rempire, напишу описание на трёх языках с SEO-заголовками и предложу раздел. Вы только проверите и подтвердите." + aiGo("goods", "Открыть товары");
    }
    if (/аналитик|статист|посещ|сколько людей|конверси/i.test(q)) {
      return "За неделю 412 посетителей, из них 2,2% оформили заказ. Лучше всего находят по «kevin murphy tallinn». Открыть подробности?" + aiGo("stats", "Открыть аналитику");
    }
    if (/письм|почт|рассылк|email|мейл/i.test(q)) {
      return "Письма магазин шлёт сам: «заказ принят», «отправлен» с трек-номером, «снова в наличии». Могу включить напоминание о брошенной корзине и поздравление со скидкой ко дню рождения." + aiGo("mail", "Открыть письма");
    }
    if (/подключ|интеграц|google|гугл/i.test(q)) {
      return "Вот что подключено к магазину и что появится на следующих шагах — всё настраивается без вас." + aiGo("apps", "Открыть подключения");
    }
    return "Отправки ждут 2 заказа: #1043 и #1044. Наклейки уже готовы — распечатать?" + aiGo("orders", "Открыть заказы");
  }

  function screenDone() {
    return '<div class="wrap wrap--narrow" style="text-align:center"><section class="sec">' +
      '<div class="done__tick">' + icon("check") + "</div>" +
      '<h1 class="display h1">Заказ оформлен</h1>' +
      '<p class="muted" style="margin-bottom:22px">Это демонстрация — настоящий заказ не создан. В рабочем магазине сюда придёт номер заказа, счёт на почту и трекинг посылки.</p>' +
      '<button class="btn" data-go="home">На главную</button></section></div>';
  }

  // ---------- overlays ----------
  function cartBody() {
    var sum = cartSum(), thr = threshold(), pct = Math.min(100, sum / thr * 100);
    return (S.cart.length ? S.cart.map(function (l, li) {
      var p = byId(l.id);
      return '<div class="cline" data-cline="' + li + '"><span class="cline__ph">' + media(p, 0, "ph") + "</span>" +
        '<span class="cline__mid"><span class="cline__nm">' + esc(p.brand) + " " + esc(p.name) + lineLabel(l) + "</span>" +
        '<span class="stepper stepper--sm"><button data-line="' + li + '" data-d="-1" aria-label="Меньше">−</button><span class="num" data-qtyval>' + l.qty + '</span><button data-line="' + li + '" data-d="1" aria-label="Больше">+</button></span>' +
        '<button class="link cline__rm" data-remove="' + li + '">Убрать</button></span>' +
        '<span class="num cline__pr" data-linepr>' + eur(sizePrice(p, l.size || 0) * l.qty) + "</span></div>";
    }).join("") : '<p class="muted">Пока пусто. <button class="link" data-go-cat="all">К товарам</button></p>') +
      (S.cart.length ? '<div class="freebar"><div class="freebar__track"><div class="freebar__fill" style="width:' + pct + '%"></div></div>' +
        '<p class="muted">' + freebarText(sum, thr) + "</p></div>" : "");
  }
  function cartFoot() {
    if (!S.cart.length) return "";
    return '<div class="drawer__tot"><span>Итого</span><span class="num">' + eur(cartSum()) + "</span></div>" +
      '<button class="btn btn--wide" data-checkout>Оформить заказ</button>' +
      '<button class="link drawer__cont" data-closecart>Продолжить покупки</button>';
  }
  function cartDrawer() {
    return '<div class="scrim" data-closecart></div>' +
      '<aside class="drawer drawer--right" role="dialog" aria-modal="true" aria-label="Корзина">' +
      '<div class="drawer__head"><span class="display drawer__t">Корзина (' + cartCount() + ')</span>' +
      '<button class="iconbtn" data-closecart aria-label="Закрыть">✕</button></div>' +
      '<div class="drawer__body">' + cartBody() + "</div>" +
      '<div class="drawer__foot"' + (S.cart.length ? "" : " hidden") + ">" + cartFoot() + "</div>" +
      "</aside>";
  }

  function filterDrawer() {
    var brands = [];
    CATALOGUE.forEach(function (p) { if ((S.cat === "all" || p.cat === S.cat) && brands.indexOf(p.brand) < 0) brands.push(p.brand); });
    brands.sort();
    function count(b) { return CATALOGUE.filter(function (p) { return (S.cat === "all" || p.cat === S.cat) && p.brand === b; }).length; }
    var inStock = CATALOGUE.filter(function (p) { return (S.cat === "all" || p.cat === S.cat) && p.stock !== "out"; }).length;
    return '<div class="scrim" data-closefilter></div>' +
      '<aside class="drawer drawer--left" role="dialog" aria-modal="true" aria-label="Фильтры">' +
      '<div class="drawer__head"><span class="display drawer__t">Фильтры</span><button class="iconbtn" data-closefilter aria-label="Закрыть">✕</button></div>' +
      '<div class="drawer__body">' +
        '<div class="field__label">Наличие</div><label class="opt"><input type="checkbox" data-instock ' + (S.onlyInStock ? "checked" : "") + '><span>В наличии</span><span class="opt__price num opt__n">' + inStock + "</span></label>" +
        '<div class="field__label" style="margin-top:20px">Бренд</div>' +
        brands.map(function (b) {
          return '<label class="opt"><input type="checkbox" data-brand="' + esc(b) + '" ' + (S.brandFilter.indexOf(b) >= 0 ? "checked" : "") + "><span>" + esc(b) + '</span><span class="opt__price num opt__n">' + count(b) + "</span></label>";
        }).join("") +
      "</div>" +
      '<div class="drawer__foot"><button class="btn btn--wide" data-closefilter data-showbtn>' + showLabel() + "</button>" +
      '<button class="link drawer__cont" data-clearfilter="keep">Сбросить</button></div></aside>';
  }
  /* The whole label is patched, not just the number — «Показать 1 товаров» was
     what you got when only the count was swapped in place. */
  function showLabel() {
    var n = filtered().length;
    return "Показать " + n + " " + plural(n);
  }

  // ---------- render ----------
  var app = document.getElementById("app");
  app.innerHTML = '<div id="hdrslot"></div><div id="bodyslot"></div><div id="navslot"></div>' +
    '<div id="ovl"></div><div id="toastslot"></div>';
  var hdrSlot = document.getElementById("hdrslot");
  var bodySlot = document.getElementById("bodyslot");
  var navSlot = document.getElementById("navslot");
  var ovl = document.getElementById("ovl");
  var toastSlot = document.getElementById("toastslot");
  var ovlKey = "";
  var lastFocus = null;

  /* ---------- SEO head: title, description, Product JSON-LD --------------
     The static build will prerender these; the demo sets them live so every
     screen already carries an honest title and a product page carries
     schema.org markup. SEO Title/Description exported from the old shop are
     used when present. */
  function stripTags(h) { return String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
  function setMetaTag(name, content) {
    var el = document.querySelector('meta[name="' + name + '"]');
    if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); }
    el.setAttribute("content", content);
  }
  function setHead() {
    var base = { RU: "REMPIRE — магазин косметики в Таллинне", ET: "REMPIRE — kosmeetikapood Tallinnas", EN: "REMPIRE — grooming shop in Tallinn" }[S.lang];
    var buy = { RU: "купить в Rempire", ET: "osta Rempire'ist", EN: "buy at Rempire" }[S.lang];
    var t = base, d = "";
    if (S.screen === "product") {
      var p = byId(S.productId);
      t = p.brand + " " + trText(p.name, S.lang, true) + " — " + buy + " · " + (p.priceFrom ? trText("от " + eur(p.price), S.lang, false) : eur(p.price));
      if (S.lang === "EN" && p.seo && p.seo.t) t = p.seo.t;
      d = (S.lang === "EN" && p.seo && p.seo.d) ? p.seo.d : stripTags(descFor(p)).slice(0, 155);
      var ld = {
        "@context": "https://schema.org", "@type": "Product",
        name: p.brand + " " + p.name, brand: { "@type": "Brand", name: p.brand },
        image: location.origin + p.img,
        description: stripTags(descFor(p)).slice(0, 500),
        offers: {
          "@type": "Offer", priceCurrency: "EUR",
          price: String(p.price),
          availability: "https://schema.org/" + (p.stock === "out" ? "OutOfStock" : "InStock"),
          url: location.origin + "/shop2/p/" + p.id + "/"
        }
      };
      var s = document.getElementById("ldjson");
      if (!s) { s = document.createElement("script"); s.type = "application/ld+json"; s.id = "ldjson"; document.head.appendChild(s); }
      s.textContent = JSON.stringify(ld);
    } else {
      var s2 = document.getElementById("ldjson");
      if (s2) s2.remove();
      if (S.screen === "catalog") t = (S.brand || trText(S.cat === "all" ? "Все товары" : CAT_NAMES[S.cat] || "", S.lang, false)) + " — REMPIRE";
      else if (S.screen === "info") { var pg = legalFor(S.infoSlug); if (pg) t = pg.title + " — REMPIRE"; }
      else if (S.screen === "brands") t = trText("Бренды", S.lang, false) + " — REMPIRE";
    }
    document.title = t;
    if (d) setMetaTag("description", d);
  }

  function render() {
    var body;
    if (S.screen === "home") body = screenHome();
    else if (S.screen === "catalog") body = screenCatalog();
    else if (S.screen === "product") body = screenProduct();
    else if (S.screen === "search") body = screenSearch();
    else if (S.screen === "account") body = screenAccount();
    else if (S.screen === "checkout") body = screenCheckout();
    else if (S.screen === "done") body = screenDone();
    else if (S.screen === "brands") body = screenBrands();
    else if (S.screen === "info") body = screenInfo();
    else if (S.screen === "admin") body = screenAdmin();

    var chromeless = S.screen === "checkout" || S.screen === "done" || S.screen === "admin";
    if (!hdrSlot.firstChild) hdrSlot.innerHTML = headerHTML();
    hdrSlot.hidden = chromeless;
    patchHeader();

    bodySlot.innerHTML = '<main class="screen' + (chromeless ? " screen--co" : "") + '">' + body + "</main>" +
      (chromeless ? "" : footer());

    if (!navSlot.firstChild) navSlot.innerHTML = botnavHTML();
    navSlot.hidden = S.screen === "admin";
    measureHdr();
    paintTint();
    patchNav();

    /* The overlay is re-mounted only when the *kind* of overlay changes, so an
       open drawer never replays its slide-in — and the toast lives in its own
       slot so showing one cannot re-mount a drawer either. */
    var key = (S.cartOpen ? "c" : "") + (S.filterOpen ? "f" : "");
    if (key !== ovlKey) {
      var opening = !ovlKey && key;
      if (!ovlKey && key) lastFocus = document.activeElement;
      ovlKey = key;
      ovl.innerHTML = (S.cartOpen ? cartDrawer() : "") + (S.filterOpen ? filterDrawer() : "");
      var close = ovl.querySelector(".drawer .iconbtn");
      if (opening && close) close.focus();
      if (!key && lastFocus && document.contains(lastFocus)) { lastFocus.focus(); lastFocus = null; }
    }
    paintToast();
    document.body.classList.toggle("is-locked", S.cartOpen || S.filterOpen);
    translatePage();
    setHead();

    if (S.screen === "catalog") observeSentinel();
  }

  /* Size, colour, gallery and quantity clicks on the product page patch in
     place — a full render destroyed the focused button, so a keyboard user
     could not press «+» twice (the same bug the cart stepper had). */
  function patchPdp() {
    if (S.screen !== "product") { render(); return; }
    var p = byId(S.productId);
    var price = document.querySelector("[data-price]");
    if (!price) { render(); return; }
    price.textContent = eur(sizePrice(p, S.size));
    var qn = document.querySelector("[data-qtynum]");
    if (qn) qn.textContent = S.qty;
    var ss = document.querySelector("[data-stickysum]");
    if (ss) ss.textContent = eur(sizePrice(p, S.size) * S.qty);
    var g = gal(p);
    var stage = document.querySelector(".pdp__img");
    if (stage) stage.style.backgroundImage = "url('" + g[Math.min(S.gallery, g.length - 1)] + "')";
    document.querySelectorAll(".pdp__thumb").forEach(function (b) {
      b.setAttribute("aria-current", String(Number(b.dataset.gal) === S.gallery));
    });
    var sizes = p.sizes || [];
    var cur = sizes.length ? sizes[Math.min(S.size, sizes.length - 1)].split(" / ") : [];
    document.querySelectorAll("[data-size]").forEach(function (b) {
      b.setAttribute("aria-current", String(Number(b.dataset.size) === S.size));
    });
    document.querySelectorAll("[data-vcolour]").forEach(function (b) {
      b.setAttribute("aria-current", String(b.dataset.vcolour === cur[0]));
    });
    document.querySelectorAll("[data-vsize]").forEach(function (b) {
      b.setAttribute("aria-current", String(b.dataset.vsize === cur[1]));
    });
    var cn = document.querySelector("[data-colourname]");
    if (cn && cur.length === 2) cn.textContent = colourRu(cur[0]);
  }

  /* Quantity steppers patch the numbers in place. Rebuilding the drawer would
     replay its slide-in and destroy the focused +/− button, so a keyboard user
     could not press + twice. */
  function patchCart() {
    var d = ovl.querySelector(".drawer--right");
    if (!d) { render(); return; }
    d.querySelector(".drawer__t").textContent = trText("Корзина (" + cartCount() + ")", S.lang);
    S.cart.forEach(function (l, i) {
      var row = d.querySelector('[data-cline="' + i + '"]');
      if (!row) return;
      row.querySelector("[data-qtyval]").textContent = l.qty;
      row.querySelector("[data-linepr]").textContent = eur(sizePrice(byId(l.id), l.size || 0) * l.qty);
    });
    var sum = cartSum(), thr = threshold();
    var fill = d.querySelector(".freebar__fill");
    if (fill) fill.style.width = Math.min(100, sum / thr * 100) + "%";
    var note = d.querySelector(".freebar p");
    if (note) note.textContent = trText(freebarText(sum, thr), S.lang);
    var tot = d.querySelector(".drawer__tot .num");
    if (tot) tot.textContent = eur(sum);
    patchHeader(); patchNav();
  }

  /* Redraws the cart list when the line indices change, without re-mounting
     the drawer — replacing the whole overlay replays the slide-in, which is
     what read as a flicker on every «Убрать». */
  function rebuildCart() {
    var d = ovl.querySelector(".drawer--right");
    if (!d) { render(); return; }
    d.querySelector(".drawer__t").textContent = trText("Корзина (" + cartCount() + ")", S.lang);
    d.querySelector(".drawer__body").innerHTML = cartBody();
    var foot = d.querySelector(".drawer__foot");
    foot.innerHTML = cartFoot();
    foot.hidden = !S.cart.length;
    translateTree(d);
    patchHeader(); patchNav();
  }

  /* Filtering re-renders only the grid. A full render would rebuild the open
     filter drawer under the user's finger — that was the flicker. */
  /* Leaving the e-mail field used to re-render the whole screen so the
     validation note could appear. That ate the first click on «Далее»:
     pressing the button blurs the field, the render replaces the button under
     the pointer, and a mouseup on an element that was not the one moused down
     on is not a click — so the shopper had to press twice. Only two things
     ever change here, so change those and leave the rest of the DOM, and the
     button being pressed, where they are. */
  function patchEmail(input) {
    // the account screen's plain e-mail row carries no aria-invalid and takes
    // no note; that attribute is what marks the two validated fields
    if (!input || !input.hasAttribute("aria-invalid")) return;
    var field = input.closest(".field");
    if (!field) return;
    input.setAttribute("aria-invalid", String(emailBad()));
    var note = emailBad()
      ? '<div class="err" role="alert">' + emailMsg() + "</div>"
      : S.screen === "checkout"
        ? '<div class="hint">Аккаунт не нужен — оформляйте как гость.</div>'
        : "";
    var next = field.nextElementSibling;
    var isNote = next && (next.classList.contains("err") || next.classList.contains("hint"));
    if (isNote) { if (note) next.outerHTML = note; else next.remove(); }
    else if (note) field.insertAdjacentHTML("afterend", note);
  }

  /* Same rule as the e-mail field: change the two things that change and
     leave the rest of the DOM alone, or the re-render swallows the click that
     caused the blur. */
  function patchShip(input) {
    var key = input.dataset.shipf, bad = shipBad(key);
    input.setAttribute("aria-invalid", String(bad));
    var err = input.parentNode.querySelector(".err");
    if (bad) {
      if (err) err.innerHTML = shipMsg(key);
      else input.insertAdjacentHTML("afterend", '<div class="err" role="alert">' + shipMsg(key) + "</div>");
    } else if (err) err.remove();
  }

  function patchCatalog() {
    // The drawer footer must update on every path, including the ones that
    // fall through to a full render — otherwise it freezes at a stale count.
    var showBtn = ovl.querySelector("[data-showbtn]");
    if (showBtn) showBtn.textContent = showLabel();

    var list = filtered();
    var grid = S.screen === "catalog" ? document.getElementById("catgrid") : null;
    // No grid to patch: either we are off the catalogue, or the last render
    // produced the "nothing matched" block, or this change empties the list —
    // all of which need the full screen back.
    if (!grid || !list.length) { render(); return; }

    var visible = list.slice(0, S.shown);
    /* Loading the next batch used to rebuild the WHOLE grid's innerHTML —
       every card re-created, the scroll anchor lost, the page visibly
       jumping at each load. When the already-rendered cards are the same
       prefix, only the new ones are appended. */
    var kids = grid.children, samePrefix = kids.length <= visible.length;
    if (samePrefix) {
      for (var ci = 0; ci < kids.length; ci++) {
        var a = kids[ci].querySelector("[data-go-product]");
        if (!a || a.dataset.goProduct !== visible[ci].id) { samePrefix = false; break; }
      }
    }
    if (samePrefix && kids.length) {
      var addHTML = visible.slice(kids.length).map(cardHTML).join("");
      if (addHTML) {
        var frag = document.createElement("template");
        frag.innerHTML = addHTML;
        translateTree(frag.content);
        grid.appendChild(frag.content);
      }
    } else {
      grid.innerHTML = visible.map(cardHTML).join("");
    }
    var more = document.getElementById("catmore");
    if (more) more.innerHTML = moreHTML(visible.length, list.length);
    var c = document.querySelector("[data-count]");
    if (c) c.textContent = list.length + " " + plural(list.length);
    var fc = document.querySelector("[data-fcount]");
    if (fc) fc.textContent = fcountLabel();
    var chips = document.querySelector("[data-chips]");
    if (chips) chips.outerHTML = activeChips();
    translateTree(bodySlot);
    observeSentinel();
  }

  /* ---------- history ----------
     Screen changes used to be state only, with the URL frozen at /shop/, so
     the phone's Back gesture left the shop from wherever the shopper had got
     to — and a category could not be linked to at all. Every navigation now
     writes a path that names the screen, and Back reads that path back into
     the state. */
  var BRAND_BY_SLUG = {};
  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  CATALOGUE.forEach(function (p) { BRAND_BY_SLUG[slugify(p.brand)] = p.brand; });

  function pathFor() {
    if (S.screen === "product" && S.productId) return "/shop2/p/" + encodeURIComponent(S.productId) + "/";
    if (S.screen === "catalog") return S.brand ? "/shop2/b/" + slugify(S.brand) + "/" : "/shop2/c/" + S.cat + "/";
    if (S.screen === "search") return "/shop2/search/" + (S.query ? "?q=" + encodeURIComponent(S.query) : "");
    if (S.screen === "info" && S.infoSlug) return "/shop2/info/" + S.infoSlug + "/";
    if (S.screen === "home") return "/shop2/";
    return "/shop2/" + S.screen + "/";
  }
  function here() { return location.pathname + location.search; }
  /* Stamp the live scroll onto the entry being left, so Back returns to the
     place on the page rather than to the top of it. */
  function stamp() {
    try {
      var st = history.state || {};
      history.replaceState({ y: window.scrollY, shown: S.shown, drawer: st.drawer }, "");
    } catch (e) {}
  }
  function navTo(replace) {
    var p = pathFor();
    try {
      /* Leaving an open drawer consumes the drawer's entry rather than
         stacking on top of it — otherwise Back from the next screen lands on
         a marker for a drawer that is no longer open and appears to do
         nothing. Re-picking the screen you are already on replaces too. */
      if (replace || S.histDrawer || p === here()) {
        history.replaceState({ y: 0, shown: S.shown }, "", p);
      } else {
        stamp();
        history.pushState({ y: 0, shown: 12 }, "", p);
      }
    } catch (e) {}
    S.histDrawer = false;
  }

  /* An open drawer parks one entry on the stack, so Back closes it instead of
     leaving the shop. On a phone the cart is a full-screen overlay, and Back
     is the gesture people reach for to dismiss one. */
  function openDrawer(which) {
    if (which === "cart") S.cartOpen = true; else S.filterOpen = true;
    if (!S.histDrawer) {
      stamp();
      try { history.pushState({ y: window.scrollY, shown: S.shown, drawer: which }, "", here()); } catch (e) {}
      S.histDrawer = true;
    }
    render();
  }
  function closeDrawers() {
    S.cartOpen = false; S.filterOpen = false;
    // popstate does the rendering when there is a marker to spend
    if (S.histDrawer) { S.histDrawer = false; history.back(); return; }
    render();
  }

  window.addEventListener("popstate", function (e) {
    var st = e.state || {};
    S.histDrawer = !!st.drawer;
    S.langOpen = false;
    routeFromPath();
    S.cartOpen = st.drawer === "cart";
    S.filterOpen = st.drawer === "filter";
    if (st.shown) S.shown = st.shown;
    render();
    window.scrollTo(0, st.y || 0);
  });

  function go(screen) {
    S.screen = screen; S.cartOpen = false; S.filterOpen = false; S.langOpen = false;
    if (screen === "catalog") S.shown = 12;
    if (screen === "checkout") S.coStep = 1;
    // the receipt replaces the checkout it came from: Back from it belongs on
    // the shop, not on a payment form for an order already placed
    navTo(screen === "done");
    window.scrollTo({ top: 0 });
    render();
  }
  /* Brands differ per category, so a Davines filter left over from Уход за
     волосами would silently empty Парфюмерия. Category change clears them. */
  function goCat(cat) {
    if (cat !== S.cat || S.brand) { S.brandFilter = []; S.onlyInStock = false; }
    S.subcat = "";
    S.brand = ""; S.cat = cat; go("catalog");
  }
  function goBrand(name) {
    S.brand = name; S.brandFilter = []; S.onlyInStock = false; S.subcat = ""; go("catalog");
  }

  /* The toast lives in its own slot and never triggers a full render — a
     toast after «В корзину» must not destroy the button under the finger. */
  function paintToast() {
    toastSlot.innerHTML = S.toast
      ? '<div class="toast" role="status"><span>' + S.toast + '</span><button class="iconbtn toast__x" data-closetoast aria-label="Закрыть">✕</button></div>'
      : "";
    translateTree(toastSlot);
  }
  function refocus(sel) {
    var n = document.querySelector(sel);
    if (n) n.focus();
  }
  function toast(msg) {
    S.toast = msg; paintToast(); patchHeader(); patchNav();
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { S.toast = null; paintToast(); }, 2600);
  }

  function addToCart(id, sizeIdx) {
    // backstop: nothing out of stock enters the cart, whatever button sent it
    if (byId(id).stock === "out") { toast("Товара нет в наличии"); return; }
    var si = sizeIdx === undefined ? (S.productId === id && S.screen === "product" ? S.size : 0) : sizeIdx;
    var qty = S.screen === "product" && S.productId === id ? S.qty : 1;
    var line = null;
    S.cart.forEach(function (l) { if (l.id === id && l.size === si) line = l; });
    if (line) line.qty = Math.min(9, line.qty + qty);
    else S.cart.push({ id: id, size: si, qty: Math.min(9, qty) });
    persist();
    toast("Добавлено в корзину ✓");
  }
  var COUNTRY_SHORT = { EE: "Эстония", LV: "Латвия", LT: "Литва", FI: "Финляндия", EU: "Европа" };
  function freebarText(sum, thr) {
    return sum >= thr
      ? "Бесплатная доставка — порог " + thr + " € достигнут ✓"
      : "До бесплатной доставки (" + COUNTRY_SHORT[S.country] + ", от " + thr + " €) — ещё " + eur(thr - sum);
  }
  function lineLabel(l) {
    var p = byId(l.id);
    if (!p.sizes || !p.sizes.length) return "";
    var s = p.sizes[Math.min(l.size || 0, p.sizes.length - 1)];
    // "white / S" → "белый · S" in the cart and the checkout summary
    var parts = s.split(" / ");
    return " · " + (parts.length === 2 ? colourRu(parts[0]) + " · " + parts[1] : s);
  }

  // infinite scroll
  var io = null;
  function observeSentinel() {
    if (io) io.disconnect();
    var el = document.getElementById("sentinel");
    if (!el) return;
    io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting || S.loading) return;
      S.loading = true;
      var sp = document.querySelector("#catmore .spinner");
      if (sp) sp.setAttribute("data-on", "1");
      setTimeout(function () {
        S.shown += 12; S.loading = false;
        if (S.screen === "catalog") patchCatalog();
      }, 320);
    }, { rootMargin: "300px" });
    io.observe(el);
  }

  // ---------- hero ----------
  var heroTimer = null;
  function paintSlide() {
    var slides = document.querySelectorAll(".hero__slide");
    if (!slides.length) return false;
    slides.forEach(function (s, i) {
      s.setAttribute("data-on", i === S.slide ? "1" : "0");
      s.setAttribute("aria-hidden", String(i !== S.slide));
    });
    document.querySelectorAll(".hero__dots button").forEach(function (b, i) {
      b.setAttribute("aria-current", String(i === S.slide));
    });
    return true;
  }
  function setSlide(n, manual) {
    S.slide = (n + BANNERS.length) % BANNERS.length;
    if (!paintSlide()) render();
    if (manual) restartHero();
  }
  function restartHero() {
    clearInterval(heroTimer);
    heroTimer = setInterval(function () {
      if (S.screen !== "home" || document.hidden || S.cartOpen || S.filterOpen) return;
      try { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
      setSlide(S.slide + 1);
    }, 6000);
  }

  /* Swipe. Two swipeable surfaces — the home banner and the product gallery —
     so the handler resolves which one the finger started on rather than
     assuming the hero. A horizontal move of 40px+ that is clearly more
     horizontal than vertical counts; anything else is a scroll. */
  var swX = 0, swY = 0, swTarget = null;
  document.addEventListener("touchstart", function (e) {
    swTarget = null;
    if (e.touches.length !== 1 || !e.target.closest) return;
    var el = e.target.closest(".hero, .pdp__stage");
    if (!el) return;
    swTarget = el.classList.contains("hero") ? "hero" : "gallery";
    swX = e.touches[0].clientX; swY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", function (e) {
    if (!swTarget) return;
    var which = swTarget;
    swTarget = null;
    var t = e.changedTouches[0], dx = t.clientX - swX, dy = t.clientY - swY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    var dir = dx < 0 ? 1 : -1;
    if (which === "hero") { setSlide(S.slide + dir, true); return; }
    var p = byId(S.productId), g = gal(p);
    if (g.length < 2) return;
    S.gallery = (S.gallery + dir + g.length) % g.length;
    patchPdp();
  }, { passive: true });

  // ---------- events ----------
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-admnav],[data-admai],[data-vcolour],[data-vsize],[data-notify],[data-share],[data-go],[data-go-cat],[data-go-brand],[data-go-product],[data-add],[data-cart],[data-closecart],[data-filter],[data-closefilter],[data-clearfilter],[data-unbrand],[data-unstock],[data-subcat],[data-page],[data-slide],[data-dot],[data-langtoggle],[data-lang],[data-line],[data-remove],[data-checkout],[data-pay],[data-step],[data-method],[data-acctm],[data-size],[data-qty],[data-gal],[data-login],[data-logout],[data-save],[data-repeat],[data-applypromo],[data-q],[data-buynow],[data-closetoast],[data-paym],[data-bank],[data-admtab],[data-admask],[data-admedit]");
    if (!t) {
      if (S.langOpen) { S.langOpen = false; patchHeader(); }
      return;
    }
    var d = t.dataset;
    // any handled action dismisses the language menu — it used to stay open
    // while you carried on shopping behind it
    if (S.langOpen && d.langtoggle === undefined && d.lang === undefined) {
      S.langOpen = false; patchHeader();
    }

    if (d.ident !== undefined) identLogo(t);
    if (d.go) { if (d.go !== "catalog") S.brand = ""; go(d.go); return; }
    if (d.goCat !== undefined) { goCat(d.goCat); return; }
    if (d.goBrand) { goBrand(d.goBrand); return; }
    if (d.goProduct) {
      S.productId = d.goProduct; S.size = 0; S.qty = 1;
      var np = byId(d.goProduct);
      S.gallery = np.varImg && np.varImg.length ? np.varImg[0] : 0;
      go("product"); return;
    }
    if (d.add) { e.stopPropagation(); addToCart(d.add); return; }
    if (d.buynow) {
      if (byId(d.buynow).stock === "out") { toast("Товара нет в наличии"); return; }
      addToCart(d.buynow); go("checkout"); return;
    }
    if (d.cart !== undefined) { openDrawer("cart"); return; }
    if (d.closecart !== undefined) { closeDrawers(); return; }
    if (d.filter !== undefined) { openDrawer("filter"); return; }
    if (d.closefilter !== undefined) { closeDrawers(); return; }
    if (d.clearfilter !== undefined) {
      S.brandFilter = []; S.onlyInStock = false; S.shown = 12;
      // «Сбросить» inside the drawer keeps the drawer open so you can keep
      // filtering; the chip row's version closes nothing because none is open.
      if (d.clearfilter !== "keep") S.filterOpen = false;
      if (S.filterOpen) { ovlKey = ""; render(); } else render();
      return;
    }
    if (d.unbrand !== undefined) {
      S.brandFilter = S.brandFilter.filter(function (x) { return x !== d.unbrand; });
      S.shown = 12; patchCatalog(); return;
    }
    if (d.page !== undefined) { S.infoSlug = d.page; go("info"); return; }
    if (d.subcat !== undefined) {
      S.subcat = d.subcat; S.shown = 12;
      render();
      refocus('[data-subcat="' + d.subcat + '"]');
      /* Tapping a chip while scrolled deep left the shopper below the now
         shorter list — a white page that read as a bug. Bring the first row
         of products up under the sticky chip row; never move someone who is
         already above the grid. */
      /* iOS cancels a programmatic scroll that lands during momentum, and the
         page shrinking under the shopper clamps scrollY on its own schedule —
         one scrollTo fired synchronously sometimes just lost. Re-assert the
         position twice; the scroll is idempotent, so the repeats are free. */
      var subcatScroll = function () {
        var grid = document.getElementById("catgrid");
        if (!grid) return;
        var chips = document.querySelector(".subcats");
        var off = (chips ? chips.offsetHeight + 10 : 10) + (hideOn ? 0 : hdrH);
        var top = Math.max(0, grid.getBoundingClientRect().top + window.scrollY - off);
        if (window.scrollY > top + 4) window.scrollTo({ top: top });
      };
      subcatScroll();
      setTimeout(subcatScroll, 120);
      setTimeout(subcatScroll, 400);
      return;
    }
    if (d.unstock !== undefined) { S.onlyInStock = false; S.shown = 12; patchCatalog(); return; }
    if (d.slide) { setSlide(S.slide + Number(d.slide), true); return; }
    if (d.dot !== undefined) { setSlide(Number(d.dot), true); return; }
    if (d.langtoggle !== undefined) { S.langOpen = !S.langOpen; patchHeader(); return; }
    // full render, not just the header: descriptions, legal pages and the
    // whole chrome follow the language. The persistent slots are rebuilt from
    // their Russian templates — translateTree only converts FROM Russian, so
    // an already-translated header would otherwise stick on the old language.
    if (d.lang) {
      S.lang = d.lang; S.langOpen = false; savedHadLang = true; persist();
      hdrSlot.innerHTML = ""; navSlot.innerHTML = ""; ovlKey = "";
      render(); return;
    }
    if (d.line !== undefined) {
      var li = Number(d.line);
      if (S.cart[li]) S.cart[li].qty = Math.max(1, Math.min(9, S.cart[li].qty + Number(d.d)));
      persist(); patchCart(); return;
    }
    if (d.remove !== undefined) {
      S.cart.splice(Number(d.remove), 1); persist();
      // an emptied checkout has nothing left to pay for — back to the shop
      if (!S.cart.length && S.screen === "checkout") { go("home"); return; }
      /* Taking out the last line closes the drawer — leaving it open on an
         empty cart, which is what the old code did, looked like a flicker:
         it tore the drawer down and slid an empty one back in. */
      if (!S.cart.length) { S.cartOpen = false; render(); return; }
      rebuildCart();                   // line indices shift, so redraw the list
      return;
    }
    if (d.checkout !== undefined) { if (!S.cart.length) { toast("Корзина пуста"); return; } go("checkout"); return; }
    if (d.pay !== undefined) {
      S.emailTouched = true; S.shipTouched = true;
      /* Nothing was checked here before: an order went through with no
         address, no phone and no company for an invoice. Send the shopper to
         the step that is short, with the fields marked, rather than refusing
         with a toast and leaving them to hunt. */
      if (emailBad()) { return failStep(1, "Проверьте e-mail — на него придёт подтверждение заказа"); }
      if (shipMissing().length) { return failStep(2, "Заполните данные доставки"); }
      if (S.pay === 3 && !S.invoiceCo.trim()) { return failStep(3, "Укажите фирму и регистрационный номер"); }
      // a finished order must not leave its promo, address or step state
      // behind for the next one
      S.cart = []; S.promo = ""; S.promoOk = false; S.promoErr = false; S.sumOpen = null;
      S.ship = { name: "", addr: "", zip: "", city: "", phone: "" };
      S.emailTouched = false; S.shipTouched = false;
      persist(); go("done"); return;
    }
    if (d.step) {
      var n = Number(d.step);
      // forward only — going back to change something is always allowed
      if (n > S.coStep) {
        if (S.coStep === 1) { S.emailTouched = true; if (emailBad()) { return failStep(1); } }
        if (S.coStep === 2) { S.shipTouched = true; if (shipMissing().length) { return failStep(2); } }
      }
      S.coStep = n; render(); return;
    }
    // checkout selections re-render the step, which destroys the clicked
    // control — put keyboard focus back on its replacement
    if (d.method !== undefined) { S.method = Number(d.method); S.machine = 0; render(); refocus('[data-method="' + d.method + '"]'); return; }
    if (d.paym !== undefined) { S.pay = Number(d.paym); render(); refocus('[data-paym="' + d.paym + '"]'); return; }
    if (d.bank !== undefined) { S.bank = Number(d.bank); render(); refocus('[data-bank="' + d.bank + '"]'); return; }
    // machine index must reset too — carriers have different-length lists, so
    // the stored index pointed at a place the shopper never chose
    if (d.acctm !== undefined) { S.acctMethod = Number(d.acctm); S.acctMachine = 0; render(); return; }
    if (d.admnav !== undefined) { S.admNav = !S.admNav; render(); refocus("[data-admnav]"); return; }
    if (d.admai !== undefined) { S.admAi = !S.admAi; render(); refocus("[data-admai]"); return; }
    if (d.admtab) { S.adminTab = d.admtab; window.scrollTo({ top: 0 }); render(); return; }
    if (d.admask) { S.adminAsk = d.admask; render(); return; }
    if (d.admedit !== undefined) { toast("В демо правка не сохраняется"); return; }
    if (d.size !== undefined) {
      S.size = Number(d.size);
      var sp = byId(S.productId);
      if (sp.varImg && sp.varImg.length > S.size) S.gallery = sp.varImg[S.size];
      patchPdp(); return;
    }
    if (d.vcolour !== undefined || d.vsize !== undefined) {
      var vp = byId(S.productId), vs = vp.sizes || [];
      var cur2 = vs[Math.min(S.size, vs.length - 1)].split(" / ");
      S.size = variantIndex(vs, d.vcolour !== undefined ? d.vcolour : cur2[0],
                                d.vsize !== undefined ? d.vsize : cur2[1]);
      if (vp.varImg && vp.varImg.length > S.size) S.gallery = vp.varImg[S.size];
      patchPdp(); return;
    }
    if (d.notify !== undefined) { toast("Записали — сообщим, когда появится ✓"); return; }
    if (d.share) { shareProduct(d.share); return; }
    if (d.qty) { S.qty = Math.max(1, Math.min(9, S.qty + Number(d.qty))); patchPdp(); return; }
    if (d.gal !== undefined) { S.gallery = Number(d.gal); patchPdp(); return; }
    if (d.login !== undefined) {
      S.emailTouched = true;
      if (emailBad()) { render(); toast("Введите e-mail — на него придёт код"); return; }
      S.loggedIn = true; render(); return;
    }
    if (d.logout !== undefined) { S.loggedIn = false; render(); return; }
    if (d.save !== undefined) { toast("Сохранено ✓"); return; }
    if (d.repeat !== undefined) {
      // the fake order #1042 must put plausible things in the cart, not
      // whatever happens to be first in the catalogue
      addToCart("km-repair-me-wash", 0);
      addToCart("proraso-wood-spice-beard-balm-100ml", 0);
      toast("Товары заказа #1042 в корзине ✓");
      return;
    }
    if (d.applypromo !== undefined) {
      var ok = S.promo.trim().toUpperCase() === "REMPIRE10";
      S.promoOk = ok; S.promoErr = !ok; render(); refocus("[data-applypromo]"); return;
    }
    if (d.q) { S.query = d.q; go("search"); return; }
    if (d.closetoast !== undefined) { S.toast = null; render(); return; }
  });

  /* The header is persistent, so typing there no longer loses the caret —
     the search screen is rendered underneath while the field keeps focus. */
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.matches("[data-search]")) {
      var wasSearch = S.screen === "search";
      S.query = t.value;
      if (!wasSearch) { S.screen = "search"; S.cartOpen = false; S.filterOpen = false; }
      // one entry for the search, then the query rides along on it: a push per
      // keystroke would bury the previous screen under a dozen entries
      navTo(wasSearch);
      render();
    } else if (t.matches("[data-search2]")) {
      S.query = t.value;
      var pos = t.selectionStart;
      navTo(true);
      render();
      var n = document.querySelector("[data-search2]");
      if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    } else if (t.matches("[data-email]")) { S.email = t.value; }
    else if (t.matches("[data-acctname]")) { S.acctName = t.value; }
    else if (t.matches("[data-shipf]")) { S.ship[t.dataset.shipf] = t.value; }
    else if (t.matches("[data-news]")) { S.newsletter = t.checked; }
    else if (t.matches("[data-invoiceco]")) { S.invoiceCo = t.value; }
    // editing the code must drop the applied discount, not just the error
    else if (t.matches("[data-promo]")) { S.promo = t.value; S.promoErr = false; S.promoOk = false; }
    else if (t.matches("[data-instock]")) { S.onlyInStock = t.checked; S.shown = 12; patchCatalog(); }
    else if (t.matches("[data-brand]")) {
      var b = t.dataset.brand;
      if (t.checked) S.brandFilter.push(b);
      else S.brandFilter = S.brandFilter.filter(function (x) { return x !== b; });
      S.shown = 12; patchCatalog();
    }
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches("[data-country]")) { S.country = t.value; S.method = 0; S.machine = 0; render(); }
    else if (t.matches("[data-acctcountry]")) { S.country = t.value; S.acctMethod = 0; S.acctMachine = 0; render(); }
    else if (t.matches("[data-sort]")) { S.sort = t.value; S.shown = 12; patchCatalog(); }
    else if (t.matches("[data-machine]")) { S.machine = t.selectedIndex; }
    else if (t.matches("[data-acctmachine]")) { S.acctMachine = t.selectedIndex; }
  });

  // the shopper's own open/closed choice for the summary wins from then on
  document.addEventListener("toggle", function (e) {
    if (e.target.matches && e.target.matches("[data-sum]")) S.sumOpen = e.target.open;
  }, true);

  document.addEventListener("blur", function (e) {
    if (e.target.matches("[data-email]")) {
      S.emailTouched = true;
      if (S.screen === "checkout" || S.screen === "account") patchEmail(e.target);
    } else if (e.target.matches("[data-shipf]") && S.shipTouched) {
      // only once they have tried to continue: marking fields red at someone
      // who is still working down the form is nagging, not helping
      patchShip(e.target);
    }
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (S.cartOpen || S.filterOpen) { closeDrawers(); }
      else if (S.langOpen) { S.langOpen = false; patchHeader(); }
      return;
    }
    // drawers declare aria-modal — keep Tab inside them
    if (e.key === "Tab" && (S.cartOpen || S.filterOpen)) {
      var drawer = ovl.querySelector(".drawer");
      if (!drawer) return;
      var focusables = drawer.querySelectorAll("button, input, select, a[href]");
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      var inside = drawer.contains(document.activeElement);
      if (!inside) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ---------- logo motion ----------
  /* The mark draws itself once per session, then answers taps. Kept short and
     never on a loop — it must not compete with the product grid. */
  function identLogo(btn) {
    var svg = btn.querySelector("svg");
    if (!svg) return;
    svg.classList.remove("is-ident");
    void svg.offsetWidth;
    svg.classList.add("is-ident");
  }

  /* Every product has a real page at /shop/p/<id>/ carrying its own link
     preview, so sharing one shares that product rather than the shop. */
  function productUrl(id) {
    return location.origin + "/shop2/p/" + id + "/";
  }
  function shareProduct(id) {
    var p = byId(id), url = productUrl(id);
    var title = p.brand + " — " + p.name;
    if (navigator.share) {
      navigator.share({ title: title, text: title, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        toast("Ссылка скопирована ✓");
      }).catch(function () { toast(url); });
      return;
    }
    toast(url);
  }

  /* The shop is one page served from several paths. Read the path into the
     state so a deep link, a reload and the Back button all land on the same
     screen — this is the only thing that turns a URL back into a view. */
  function routeFromPath() {
    var p = location.pathname.replace(/\/+$/, "");
    var m;
    if ((m = p.match(/\/shop2\/p\/([^/]+)$/))) {
      var id = decodeURIComponent(m[1]), found = null;
      CATALOGUE.forEach(function (x) { if (x.id === id) found = x; });
      if (found) {
        S.productId = found.id;
        S.size = 0; S.qty = 1;
        S.gallery = found.varImg && found.varImg.length ? found.varImg[0] : 0;
        S.screen = "product";
        return true;
      }
    }
    if ((m = p.match(/\/shop2\/c\/([^/]+)$/)) && (m[1] === "all" || CAT_NAMES[m[1]])) {
      S.brand = ""; S.cat = m[1]; S.shown = 12; S.screen = "catalog";
      return true;
    }
    if ((m = p.match(/\/shop2\/b\/([^/]+)$/)) && BRAND_BY_SLUG[decodeURIComponent(m[1])]) {
      S.brand = BRAND_BY_SLUG[decodeURIComponent(m[1])]; S.shown = 12; S.screen = "catalog";
      return true;
    }
    if (/\/shop2\/search$/.test(p)) {
      var q = location.search.match(/[?&]q=([^&]*)/);
      S.query = q ? decodeURIComponent(q[1].replace(/\+/g, " ")) : "";
      S.screen = "search";
      return true;
    }
    if ((m = p.match(/\/shop2\/info\/([a-z]+)$/)) && typeof LEGAL !== "undefined" && LEGAL[m[1]]) {
      S.infoSlug = m[1]; S.screen = "info"; return true;
    }
    if ((m = p.match(/\/shop2\/(brands|account|admin)$/))) { S.screen = m[1]; return true; }
    /* A receipt and a payment form are not places to land cold: /shop/done/
       has no order behind it on a fresh load, and checkout with an empty
       basket only bounces the shopper straight back out. */
    if (/\/shop2\/checkout$/.test(p) && S.cart.length) { S.screen = "checkout"; S.coStep = 1; return true; }
    S.screen = "home";
    return true;
  }

  function intro() {
    var reduce = false;
    try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var seen = false;
    try { seen = sessionStorage.getItem("rempire-intro") === "1"; } catch (e) {}
    if (reduce || seen) return;
    var el = document.createElement("button");
    el.className = "intro";
    el.type = "button";
    el.setAttribute("aria-label", "Пропустить заставку");
    el.innerHTML = towerDraw() + '<div class="intro__word">Rempire</div>';
    document.body.appendChild(el);
    try { sessionStorage.setItem("rempire-intro", "1"); } catch (e) {}
    var kill = function () {
      el.classList.add("intro--out");
      setTimeout(function () { el.remove(); }, 500);
    };
    el.addEventListener("click", kill);
    setTimeout(kill, 2400);
  }

  /* Some markup differs by breakpoint — the checkout summary ships `open` on a
     desktop and collapsed on a phone. Without this, rotating the device left
     the summary shut with its toggle disabled. */
  try {
    var mq = matchMedia("(min-width: 768px)");
    var onMQ = function () { render(); };
    if (mq.addEventListener) mq.addEventListener("change", onMQ);
    else if (mq.addListener) mq.addListener(onMQ);
  } catch (e) {}

  /* Feedback #6, na-kd style: over the hero the header wears the hero's
     ground and turns white under the cursor; one scroll past the hero (or any
     other screen) it is simply white. Feedback #1 rides on the same class —
     the header bleeds its background upward (see CSS), so the hole iOS Safari
     leaves while its address bar collapses shows header colour, not a gap. */
  /* Scroll work is what made the iPhone stutter: the first version read
     offsetHeight (forced layout) and wrote a CSS variable on every scroll
     event, and iOS momentum scrolling fires hundreds of them. Now the
     handler only reads scrollY, writes to the DOM only when a state actually
     flips, runs at most once per frame, and the header is measured on
     render/resize instead of on scroll. */
  var lastY = 0, hdrH = 0, tintOn = null, hideOn = null, tickQueued = false;
  function measureHdr() {
    var h = document.querySelector(".hdr");
    if (!h) return;
    var v = h.offsetHeight;
    if (v !== hdrH) { hdrH = v; document.documentElement.style.setProperty("--hdrh", v + "px"); }
  }
  function paintTint() {
    var y = window.scrollY;
    var tint = S.screen === "home" && y < 340;
    if (tint !== tintOn) { tintOn = tint; document.documentElement.toggleAttribute("data-tint", tint); }
    /* The phone's chrome was eating half the screen, so the header gets the
       standard mobile contract: scrolling down puts it away, any scroll up
       brings it back, and near the top it always shows. CSS applies this
       below 768px only — the desktop has room and keeps everything. */
    var hide = hideOn;
    if (y > 160 && y > lastY + 4) hide = true;
    else if (y < 160 || y < lastY - 4) hide = false;
    if (hide !== hideOn) {
      hideOn = hide;
      if (hide) document.documentElement.setAttribute("data-hidenav", "");
      else document.documentElement.removeAttribute("data-hidenav");
    }
    lastY = y;
  }
  window.addEventListener("scroll", function () {
    if (tickQueued) return;
    tickQueued = true;
    requestAnimationFrame(function () { tickQueued = false; paintTint(); });
  }, { passive: true });
  window.addEventListener("resize", measureHdr, { passive: true });

  routeFromPath();
  /* Scroll is restored from the entry's own record; letting the browser also
     try leaves it fighting a page that has not been rendered yet. */
  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    history.replaceState({ y: 0, shown: S.shown }, "", here());
  } catch (e) {}
  render();
  restartHero();
  intro();

  /* Country refinement for the first visit only: an English-language browser
     physically in Estonia gets the Estonian shop, in a Russian-speaking
     country the Russian one. A shopper who has ever touched the switcher is
     left alone. */
  if (!savedHadLang) {
    fetch("/api/geo/").then(function (r) { return r.json(); }).then(function (j) {
      var want = S.lang;
      if (S.lang === "EN") {
        if (j.country === "EE") want = "ET";
        else if (j.country === "RU" || j.country === "BY" || j.country === "UA") want = "RU";
      }
      if (want !== S.lang && !savedHadLang) {
        S.lang = want;
        hdrSlot.innerHTML = ""; navSlot.innerHTML = ""; ovlKey = "";
        render();
      }
    }).catch(function () {});
  }
})();
