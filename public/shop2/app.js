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
      "Включить": "Lülita sisse", "Выключить": "Lülita välja", "включён": "sees", "выключен": "väljas",
      "Наборы на сайте": "Komplektid poes",
      "готовые комплекты со скидкой 12 % — в меню, на главной и в каталоге; пока не согласовано с владельцем": "valmis komplektid 12 % soodsamalt — menüüs, avalehel ja kataloogis; omanikuga veel kooskõlastamata",
      "показаны": "näidatakse", "скрыты": "peidetud", "Скрыть": "Peida", "Показать": "Näita",
      "Наборы показаны ✓": "Komplektid näidatakse ✓", "Наборы скрыты ✓": "Komplektid peidetud ✓",
      "Все товары": "Kõik tooted", "Бренды": "Brändid", "Все": "Kõik",
      "Уход за волосами": "Juuksehooldus", "Стайлинг": "Viimistlus",
      "Уход за бородой": "Habemehooldus", "Уход за лицом": "Näohooldus",
      "Уход за телом": "Kehahooldus", "Парфюмерия": "Parfüümid", "Мерч": "Merch",
      "Шампуни": "Šampoonid", "Кондиционеры": "Palsamid", "Маски и уход": "Maskid ja hooldus",
      "Спреи": "Spreid", "Пасты и воски": "Pastad ja vahad", "Гели": "Geelid",
      "Пудры": "Puudrid", "Масла": "Õlid", "Бальзамы": "Palsamid",
      "После бритья": "Pärast raseerimist", "Тоники": "Toonikud", "Очищение": "Puhastus",
      "Кремы и сыворотки": "Kreemid ja seerumid",
      "В корзину": "Lisa ostukorvi", "мало": "viimased", "нет в наличии": "otsas",
      "Главная": "Avaleht", "Каталог": "Kataloog", "Поиск": "Otsi", "Корзина": "Ostukorv",
      "Кабинет": "Konto", "Описание": "Kirjeldus", "Доставка и возврат": "Tarne ja tagastus",
      "Похожие товары": "Sarnased tooted", "Вместе лучше": "Sobivad kokku",
      "Оформить заказ": "Vormista tellimus", "Продолжить покупки": "Jätka ostlemist",
      "Убрать": "Eemalda", "Итого": "Kokku", "Оплатить": "Maksa",
      "Фильтры": "Filtrid", "Сортировка": "Järjesta", "Сбросить": "Lähtesta",
      "Сбросить всё": "Lähtesta kõik", "Сбросить фильтры": "Lähtesta filtrid",
      "Наличие": "Saadavus", "Бренд": "Bränd", "В наличии": "Laos",
      "Закрыть": "Sule", "Меньше": "Vähem", "Больше": "Rohkem", "Размер": "Suurus",
      "Пока пусто.": "Ostukorv on tühi.", "К товарам": "Toodete juurde",
      "Хиты продаж": "Populaarsemad ees", "Цена ↑": "Hind ↑", "Цена ↓": "Hind ↓", "Новинки": "Uued",
      "Покупателю": "Ostjale", "Правовое": "Õigusinfo", "Контакты": "Kontakt",
      "Доставка и оплата": "Tarne ja maksmine", "Возврат товара": "Kauba tagastamine",
      "Условия продажи": "Müügitingimused", "Конфиденциальность": "Privaatsus",
      "Правовая информация": "Õigusinfo", "Споры онлайн (ODR)": "Vaidlused veebis (ODR)",
      "Оформление заказа": "Tellimuse vormistamine",
      "Контакт": "Kontaktandmed", "Доставка": "Tarne", "Оплата": "Maksmine",
      "Далее — доставка": "Edasi — tarne", "Далее — оплата": "Edasi — maksmine",
      "Имя": "Nimi", "Телефон": "Telefon", "Страна": "Riik", "Город": "Linn",
      "Адрес": "Aadress", "Промокод": "Sooduskood", "Применить": "Rakenda",
      "Заказ оформлен": "Tellimus vormistatud", "На главную": "Avalehele",
      "Поиск: шампунь, Davines, паста…": "Otsi: šampoon, Davines, pasta…",
      "Что ищете?": "Mida otsid?", "Язык интерфейса": "Keel",
      "Добавлено в корзину": "Lisatud ostukorvi", "Товар снова в наличии — напишем!": "Anname teada, kui toode on taas laos!",
      "Сообщить": "Teata mulle", "Получить код": "Saada kood", "Выйти": "Logi välja",
      "Мои заказы": "Minu tellimused", "Мои данные": "Minu andmed", "Мои промокоды": "Minu sooduskoodid",
      "Повторить заказ": "Korda tellimust", "Сохранить": "Salvesta",
      "Страница не найдена": "Lehte ei leitud",
      "Аккаунт не нужен — оформляйте как гость.": "Kontot pole vaja — vormista tellimus külalisena.",
      "Налоги включены. Доставка рассчитается при оформлении.": "Hinnad sisaldavad käibemaksu. Tarnehind arvutatakse tellimuse vormistamisel.",
      "Каталог, товары и инфостраницы — на трёх языках.": "Kataloog, tooted ja infolehed on kolmes keeles.",
      "Текст перенесён с текущего сайта; перед запуском пройдёт проверку юристом.": "Tekst on üle toodud praeguselt saidilt; enne poe avamist vaatab selle üle jurist.",
      "Эстония": "Eesti", "Латвия": "Läti", "Литва": "Leedu", "Финляндия": "Soome",
      "Европа": "Euroopa", "Таллинн": "Tallinn",
      "Профессиональный уход": "Professionaalne hooldus",
      "Kevin.Murphy, Davines, System 4 — то, чем работает команда Rempire в салоне.": "Kevin.Murphy, Davines, System 4 — sellega töötab Rempire'i meeskond salongis.",
      "В каталог": "Kataloogi", "Смотреть": "Vaata", "Новинки": "Uued",
      "Свежая поставка": "Värske kaup",
      "Уход и стайлинг, которые только приехали.": "Hooldus ja viimistlus, mis just kohale jõudsid.",
      "Борода": "Habe", "Всё для формы": "Kõik habeme kuju jaoks",
      "Масла, бальзамы и воски для ухода за бородой.": "Õlid, palsamid ja vahad habemehoolduseks.",
      "Ниша и классика": "Nišš ja klassika",
      "Creed, Tom Ford, Xerjoff, Byredo — то, что держим в наличии.": "Creed, Tom Ford, Xerjoff, Byredo — see, mida hoiame laos.",
      "Сделано в Rempire": "Valminud Rempire'is", "Мыло ручной работы": "Käsitööseep",
      "Чёрное 666 и розовое Rule Nr 1 — варим сами, маленькими партиями.": "Must 666 ja roosa Rule Nr 1 — keedame ise, väikeste partiidena.",
      "Таллинн · Mardi 1 · est 2018": "Tallinn · Mardi 1 · est 2018",
      "Популярные товары": "Populaarsed tooted", "Новые товары": "Uued tooted",
      "Салонная косметика для лица, тела и волос — то, чем команда Rempire работает каждый день.": "Salongikosmeetika näole, kehale ja juustele — sellega töötab Rempire'i meeskond iga päev.",
      "Свежие поступления: уход и стайлинг, парфюмерия и новый мерч.": "Värske kaup: hooldus ja viimistlus, parfüümid ja uus merch.",
      "Категории": "Kategooriad",
      "Профессиональные средства, которыми команда Rempire работает в салоне.": "Professionaalsed tooted, millega Rempire'i meeskond salongis töötab.",
      "Фирменные футболки Rempire — принты наших художников, печатаем небольшими тиражами.": "Rempire'i firmasärgid — meie kunstnike kavandid, trükime väikestes kogustes.",
      "Ниша и классика, которые держим в наличии в Таллинне.": "Nišš ja klassika, mida hoiame Tallinnas laos.",
      "Гели, мыло и уход за телом — включая мыло собственной варки.": "Geelid, seep ja kehahooldus — sealhulgas ise keedetud seep.",
      "Весь ассортимент Rempire: уход, стайлинг, борода, лицо, тело, парфюмерия и мерч.": "Kogu Rempire'i valik: hooldus, viimistlus, habe, nägu, keha, parfüümid ja merch.",
      "Под эти фильтры ничего не подошло.": "Nende filtritega ei leidnud ühtegi toodet.",
      "Сначала дешевле": "Soodsamad ees", "Сначала дороже": "Kallimad ees",
      "Поделиться": "Jaga", "Купить через": "Osta kohe —", "Другие способы оплаты": "Teised makseviisid",
      "С этим покупают": "Sellega ostetakse koos",
      "Самовывоз": "Järeletulek", "Реквизиты": "Ettevõtte andmed", "Связаться": "Võta ühendust",
      "Банковская ссылка (Swedbank, SEB, LHV, Luminor, Coop), карта, Apple Pay / Google Pay, счёт для компаний.": "Pangalink (Swedbank, SEB, LHV, Luminor, Coop), kaart, Apple Pay / Google Pay, arve ettevõtetele.",
      "Mardi 1, Таллинн · бесплатно · заказ ждёт 7 дней, дальше 1,50 € в день. Нужен документ.": "Mardi 1, Tallinn · tasuta · tellimus ootab 7 päeva, seejärel 1,50 € päevas. Vaja on isikut tõendavat dokumenti.",
      "Mardi 1, 10145 Таллинн": "Mardi 1, 10145 Tallinn",
      "Админка — демо": "Admin — demo",
      "Банковская ссылка": "Pangalink", "Банковская карта": "Pangakaart",
      "По счёту — для компаний": "Arvega — ettevõtetele",
      "Swedbank, SEB, LHV, Luminor, Coop — оплата в своём банке": "Swedbank, SEB, LHV, Luminor, Coop — maksa oma pangas",
      "Оплата в одно касание": "Makse ühe puudutusega",
      "Счёт на почту, оплата в течение 7 дней": "Arve e-postile, maksmine 7 päeva jooksul",
      "Самовывоз — Mardi 1, Таллинн": "Järeletulek — Mardi 1, Tallinn",
      "Курьер до двери (DPD)": "Kuller uksele (DPD)", "Курьер DPD": "DPD kuller",
      "Курьер SmartPosti": "SmartPosti kuller", "Курьер Omniva": "Omniva kuller",
      "Хочу получать новости и скидки": "Soovin uudiseid ja soodustusi",
      "E-mail для подтверждения заказа": "E-post tellimuse kinnituseks",
      "Имя и фамилия": "Ees- ja perekonnanimi", "Индекс": "Postiindeks",
      "улица, дом": "tänav, maja number", "Имя Фамилия": "Eesnimi Perekonnanimi",
      "Ваш заказ": "Tellimuse kokkuvõte", "Корзина пуста.": "Ostukorv on tühi.",
      "Бесплатно": "Tasuta", "Бесплатная доставка применена ✓": "Tasuta tarne rakendatud ✓",
      "Забрать бесплатно на Mardi 1. Нужен документ. Заказ ждёт 7 дней, дальше 1,50 € в день.": "Tasuta järeletulek aadressil Mardi 1. Vaja on isikut tõendavat dokumenti. Tellimus ootab 7 päeva, seejärel 1,50 € päevas.",
      "Оплата через банк — данные карты магазин не видит": "Makse toimub panga kaudu — pood ei näe kaardiandmeid",
      "14 дней на возврат по закону ЕС": "14-päevane tagastusõigus EL-i seaduse järgi",
      "Вопросы — 56237237 или rempireshopinfo@gmail.com": "Küsimused — 56237237 või rempireshopinfo@gmail.com",
      "Нажимая «Оплатить», вы соглашаетесь с условиями и политикой возврата.": "Vajutades „Maksa“ nõustud tingimuste ja tagastuspoliitikaga.",
      "14 дней на возврат по закону ЕС. Вскрытая косметика возврату не подлежит по гигиеническим причинам.": "14-päevane tagastusõigus EL-i seaduse järgi. Avatud kosmeetikat ei saa hügieenilistel põhjustel tagastada.",
      "14 дней на возврат по закону ЕС. Футболку можно примерить и вернуть, если не подошла.": "14-päevane tagastusõigus EL-i seaduse järgi. Särki võib proovida ja tagastada, kui see ei sobi.",
      "Это демонстрация — настоящий заказ не создан. В рабочем магазине сюда придёт номер заказа, счёт на почту и трекинг посылки.": "See on demo — päris tellimust ei loodud. Päris poes tuleb siia tellimuse number, arve e-postile ja paki jälgimisnumber.",
      "Тарифы — прайс-листы перевозчиков 2025–2026, с НДС 24 %. От 40 посылок в месяц Omniva и DPD дают скидку 3–20 % — итоговые цены уточним при подключении.": "Hinnad — vedajate hinnakirjad 2025–2026, koos 24 % käibemaksuga. Alates 40 pakist kuus annavad Omniva ja DPD 3–20 % allahindlust — lõplikud hinnad täpsustame lepingu sõlmimisel.",
      "Добавлено в корзину ✓": "Lisatud ostukorvi ✓",
      "Код не найден — проверьте написание.": "Koodi ei leitud — kontrolli kirjapilti.",
      "Город": "Linn",
      "Рег. 12216136 · KMKR EE102723858": "Reg-kood 12216136 · KMKR EE102723858",
      "← В магазин": "← Poodi", "изменить": "muuda",
      "Добавьте — и доставка бесплатно:": "Lisa juurde — ja tarne on tasuta:",
      "Демо-отзывы. Настоящие появятся после запуска — письмом «оцените заказ» через 10 дней.": "Demo-arvustused. Päris arvustused tulevad pärast poe avamist — 10 päeva pärast saadetava kirjaga „Hinda tellimust“.",
      "из 5": "/ 5",
      "Объём": "Maht", "Количество": "Kogus", "Цвет принта — ": "Trüki värv — ",
      "Обзор": "Ülevaade", "Заказы": "Tellimused", "Товары": "Tooted", "Клиенты": "Kliendid",
      "Аналитика": "Analüütika", "Письма": "Kirjad", "Подключения": "Liidestused", "Настройки": "Seaded",
      "Админка": "Admin", "Помощник": "Abiline", "Журнал изменений": "Muudatuste logi",
      "Все заказы": "Kõik tellimused", "Править": "Muuda", "Отменить": "Võta tagasi",
      "Применить": "Rakenda", "Отмена": "Tühista", "Сохранить": "Salvesta",
      "Найти товар: название, бренд…": "Otsi toodet: nimi, bränd…",
      /* вход в админку и настоящие заказы (backend) */
      "Вход в админку": "Admini sisselogimine", "Пароль": "Parool", "Войти": "Logi sisse",
      "Проверяем…": "Kontrollime…", "Неверный пароль": "Vale parool", "Введите пароль": "Sisestage parool",
      "Пароль владельца. Магазин работает и без входа — здесь только управление.":
        "Omaniku parool. Pood töötab ka ilma sisselogimiseta — siin on ainult haldus.",
      "Слишком много попыток — подождите минуту.": "Liiga palju katseid — oodake minut.",
      "Пароль ещё не настроен на сервере.": "Parool pole serveris veel seadistatud.",
      "Сервер не отвечает": "Server ei vasta",
      "Заказы — настоящие, с сервера. Клиенты и аналитика пока демонстрационные.":
        "Tellimused on päris, serverist. Kliendid ja analüütika on veel näidisandmed.",
      "Сервер заказов не отвечает — показан демонстрационный список.":
        "Tellimuste server ei vasta — näidatakse näidisnimekirja.",
      "новый": "uus", "оплачен": "makstud", "не оплачен": "maksmata", "отправлен": "teele saadetud",
      "отменён": "tühistatud", "возврат": "tagasimakse",
      "Оформлен": "Vormistatud", "Оплачен": "Makstud", "Отправлен": "Teele saadetud",
      "Состав": "Koosseis", "Статус": "Staatus", "Покупатель": "Ostja", "Скидка": "Soodustus",
      "Заметка": "Märkus", "Видна только вам": "Näete ainult teie", "Сохранить заметку": "Salvesta märkus",
      "Сохранено ✓": "Salvestatud ✓", "Не удалось сохранить": "Salvestamine ebaõnnestus",
      "Пакомат": "Pakiautomaat", "Курьер": "Kuller", "Доставка": "Tarne",
      /* оформление: доставка, выбор пакомата, оплата, чек */
      "Курьер до двери": "Kuller ukseni", "Перевозчик": "Vedaja",
      "Выберите пакомат": "Vali pakiautomaat", "выбрать": "vali",
      "Поиск по адресу и городу": "Otsi aadressi või linna järgi",
      "Загружаем список…": "Laadime nimekirja…",
      "Выберите пакомат — туда приедет посылка.": "Vali pakiautomaat — sinna pakk saabubki.",
      "Загружаем список пакоматов…": "Laadime pakiautomaatide nimekirja…",
      "Для этой страны список пока пуст — выберите курьера.": "Selle riigi kohta nimekirja veel pole — vali kuller.",
      "Ничего не нашли. Попробуйте название города или улицы.": "Midagi ei leitud. Proovi linna või tänava nime.",
      "Выбор пакомата": "Pakiautomaadi valik",
      "Город, улица или название": "Linn, tänav või nimi",
      "Поиск пакомата": "Pakiautomaadi otsing",
      "Готовим оплату…": "Valmistame makset…", "Готовим…": "Valmistame…",
      "Заказ оплачен": "Tellimus makstud",
      "Спасибо! Подтверждение и чек уже летят на почту. Когда посылку передадут перевозчику, пришлём трек-номер.": "Aitäh! Kinnitus ja arve on juba teel e-postile. Kui pakk läheb vedajale, saadame jälgimisnumbri.",
      "Оплата не прошла": "Makse ebaõnnestus",
      "Деньги не списаны. Заказ сохранён — попробуйте оплатить ещё раз или выберите другой способ.": "Raha ei võetud. Tellimus on alles — proovi uuesti maksta või vali teine makseviis.",
      "Платёж обрабатывается": "Makset töödeldakse",
      "Банк ещё не подтвердил оплату. Как только он ответит, мы пришлём письмо — обычно это занимает пару минут.": "Pank ei ole makset veel kinnitanud. Niipea kui ta vastab, saadame kirja — tavaliselt võtab see paar minutit.",
      "Вернуться в магазин": "Tagasi poodi",
      "Корзина пуста": "Ostukorv on tühi",
      "Слишком много попыток — подождите минуту": "Liiga palju katseid — oota minut",
      "Проверьте e-mail": "Kontrolli e-posti aadressi",
      "Товара не хватает на складе": "Laos ei ole piisavalt kaupa",
      "Магазин временно недоступен — попробуйте позже": "Pood on ajutiselt kättesaamatu — proovi hiljem",
      "Не получилось оформить заказ — попробуйте ещё раз": "Tellimuse vormistamine ebaõnnestus — proovi uuesti",
      "Не получилось оформить заказ": "Tellimuse vormistamine ebaõnnestus",
      "Оплата пока недоступна — попробуйте позже": "Maksmine ei ole hetkel võimalik — proovi hiljem",
      /* «Письма» — предпросмотр и тестовая отправка */
      "Письма — предпросмотр и тест": "Kirjad — eelvaade ja test",
      "Выберите письмо и язык — покажем его ровно таким, каким его получит покупатель. Ниже можно отправить образец себе на почту.": "Vali kiri ja keel — näitame seda täpselt sellisena, nagu klient selle saab. Allpool saab näidise endale saata.",
      "Заказ принят": "Tellimus vastu võetud", "Заказ отправлен": "Tellimus teele saadetud",
      "Брошенная корзина": "Pooleli jäänud ostukorv", "Товар снова в наличии": "Toode on taas laos",
      "Скидка ко дню рождения": "Sünnipäevasoodustus",
      "Письмо": "Kiri", "Язык письма": "Kirja keel", "Предпросмотр письма": "Kirja eelvaade",
      "Отправить тест на…": "Saada test aadressile…", "Отправить тест": "Saada test",
      "В письме будут вымышленный заказ и товары — это образец вёрстки, не настоящий заказ.": "Kirjas on väljamõeldud tellimus ja tooted — see on kujunduse näidis, mitte päris tellimus.",
      "Тест отправлен ✓": "Test saadetud ✓", "Нужен вход в админку": "Logi administraatorina sisse",
      "Отправка писем ещё не подключена": "Kirjade saatmine pole veel ühendatud",
      "Слишком много писем — попробуйте позже": "Liiga palju kirju — proovi hiljem",
      "Введите e-mail — на него придёт образец": "Sisesta e-posti aadress — sellele saadame näidise",
      /* toasts and filter chips — text nodes the dictionary used to miss */
      "Товара нет в наличии": "Toode on otsas", "Корзина пуста": "Ostukorv on tühi",
      "В наличии ✕": "Laos ✕", "Ссылка скопирована ✓": "Link kopeeritud ✓",
      "Записали — сообщим, когда появится ✓": "Kirja pandud — anname teada, kui toode on taas laos ✓",
      "Введите e-mail — на него придёт код": "Sisesta e-posti aadress — sellele saadame koodi",
      "Товары заказа #1042 в корзине ✓": "Tellimuse #1042 tooted on ostukorvis ✓",
      "Сохранено ✓": "Salvestatud ✓",
      /* ---- features: наборы, подарочная карта, отзывы, видео ---- */
      "Наборы": "Komplektid", "Набор": "Komplekt", "Все наборы": "Kõik komplektid",
      "Готовые наборы из тех же товаров, что стоят в магазине по отдельности. Вместе — дешевле.":
        "Valmis komplektid samadest toodetest, mis on poes ka eraldi. Koos on soodsam.",
      "Наборы скоро появятся.": "Komplektid tulevad varsti.",
      "Что внутри": "Mis on sees",
      "Одного из товаров сейчас нет — соберём набор, как только он приедет.":
        "Üks toode on otsas — paneme komplekti kokku niipea, kui see saabub.",
      "Набор сейчас не собрать — товар закончился": "Komplekti ei saa praegu kokku panna — toode on otsas",
      "Набор в корзине ✓": "Komplekt on ostukorvis ✓",
      "Подарочная карта": "Kinkekaart", "Выбрать сумму": "Vali summa", "Сумма": "Summa",
      "25, 50 или 100 € — придёт письмом получателю. Если не знаете, что выбрать, это всегда подходит.":
        "25, 50 või 100 € — saadame kirjaga saajale. Kui ei tea, mida valida, sobib see alati.",
      "Работает на весь магазин и не сгорает. После оплаты придёт письмо с кодом — вам или сразу получателю.":
        "Kehtib kogu poes ega aegu kohe. Pärast maksmist tuleb kirjaga kood — sulle või kohe saajale.",
      "Кому — имя": "Kellele — nimi", "Имя получателя": "Saaja nimi",
      "E-mail получателя — не обязательно": "Saaja e-post — pole kohustuslik",
      "Оставьте пустым — пришлём карту вам, подарите сами.": "Jäta tühjaks — saadame kaardi sulle ja kingid ise.",
      "Короткое поздравление": "Lühike õnnesoov", "С днём рождения!": "Palju õnne sünnipäevaks!",
      "Карта действует год со дня покупки. Остаток сохраняется: можно потратить за несколько заказов.":
        "Kaart kehtib aasta ostupäevast. Jääk säilib: seda saab kulutada mitme tellimusega.",
      "Подарочная карта в корзине ✓": "Kinkekaart on ostukorvis ✓",
      "Проверьте e-mail получателя": "Kontrolli saaja e-posti aadressi",
      "Проверьте адрес — похоже, в нём опечатка.": "Kontrolli aadressi — tundub, et seal on trükiviga.",
      "Промокод или подарочная карта": "Sooduskood või kinkekaart",
      "убрать": "eemalda", "Останется на карте": "Kaardile jääb",
      "На этой карте не осталось денег.": "Sellel kaardil pole enam raha.",
      "Карта не найдена — проверьте код.": "Kaarti ei leitud — kontrolli koodi.",
      "Сейчас не получилось проверить карту. Попробуйте позже.": "Praegu ei õnnestunud kaarti kontrollida. Proovi hiljem.",
      "Проверенный отзыв": "Kontrollitud arvustus", "Оставить отзыв": "Jäta arvustus",
      "Ваш отзыв": "Sinu arvustus", "Как вас зовут": "Kuidas sind kutsuda", "Оценка": "Hinnang",
      "Что понравилось, что нет — от 20 знаков": "Mis meeldis, mis mitte — vähemalt 20 tähemärki",
      "Пользуюсь месяц…": "Olen kasutanud kuu aega…",
      "Согласен(на) опубликовать отзыв и имя на этой странице": "Nõustun arvustuse ja nime avaldamisega sellel lehel",
      "Отправить отзыв": "Saada arvustus", "Отправляем…": "Saadame…",
      "Публикуем после проверки — обычно в тот же день.": "Avaldame pärast ülevaatamist — tavaliselt samal päeval.",
      "Спасибо! Отзыв отправлен — он появится на странице после проверки.":
        "Aitäh! Arvustus on saadetud — see ilmub lehele pärast ülevaatamist.",
      "Не получилось отправить — попробуйте ещё раз.": "Saatmine ebaõnnestus — proovi uuesti.",
      "Напишите, как вас зовут.": "Kirjuta, kuidas sind kutsuda.",
      "Поставьте оценку от 1 до 5.": "Anna hinnang 1 kuni 5.",
      "Напишите хотя бы 20 знаков — так отзыв поможет другим.": "Kirjuta vähemalt 20 tähemärki — nii on arvustusest teistele kasu.",
      "Слишком длинно — до 1500 знаков.": "Liiga pikk — kuni 1500 tähemärki.",
      "Ссылки и адреса почты в отзывах не публикуем.": "Linke ja e-posti aadresse me arvustustes ei avalda.",
      "Уберите, пожалуйста, грубые слова.": "Palun eemalda ropud sõnad.",
      "Отметьте согласие на публикацию.": "Märgi nõusolek avaldamiseks.",
      "Слишком много отзывов подряд — попробуйте через час.": "Liiga palju arvustusi järjest — proovi tunni pärast.",
      "Сейчас не получилось сохранить. Попробуйте позже.": "Praegu ei õnnestunud salvestada. Proovi hiljem.",
      "Видео": "Video", "Смотреть видео": "Vaata videot",
      "Видео (YouTube/Vimeo ссылка)": "Video (YouTube'i või Vimeo link)",
      "https://youtu.be/… или https://vimeo.com/…": "https://youtu.be/… või https://vimeo.com/…",
      "Вставьте ссылку — на странице товара появится видео. Пусто — блока нет.":
        "Kleebi link — toote lehele tekib video. Tühi väli — plokki ei ole.",
      "Отзывы": "Arvustused", "Новые": "Uued", "Опубликованные": "Avaldatud", "Отклонённые": "Tagasi lükatud",
      "Загружаем…": "Laadime…", "Здесь пусто.": "Siin pole midagi.",
      "Опубликовать": "Avalda", "Отклонить": "Lükka tagasi",
      "Отзывы покупателей. Ничего не появляется в магазине само — сначала вы читаете, потом публикуете. Отклонённый отзыв просто не показывается.":
        "Klientide arvustused. Poodi ei ilmu midagi iseenesest — kõigepealt loed, siis avaldad. Tagasi lükatud arvustust lihtsalt ei näidata.",
      "Отзывы пока недоступны — база подключается. Как только она заработает, новые отзывы появятся здесь сами.":
        "Arvustused pole veel saadaval — andmebaasi ühendatakse. Kui see tööle hakkab, ilmuvad uued arvustused siia ise.",
      "Отзыв опубликован ✓": "Arvustus avaldatud ✓", "Отзыв отклонён ✓": "Arvustus tagasi lükatud ✓",
      "Не получилось — попробуйте ещё раз": "Ei õnnestunud — proovi uuesti",
      // главный баннер (hero) — витрина и редактор в админке
      "Баннеры": "Bännerid", "Выбрать баннер": "Vali bänner",
      "Предыдущий баннер": "Eelmine bänner", "Следующий баннер": "Järgmine bänner",
      "Главный баннер": "Avalehe bänner",
      "Большая картинка на главной. Слайды показываются по кругу; один слайд — просто картинка без стрелок. Тексты — на трёх языках: пустой эстонский или английский заменяем русским.":
        "Suur pilt avalehel. Slaidid vahetuvad ringiratast; üks slaid on lihtsalt pilt, ilma nooolteta. Tekstid on kolmes keeles: tühja eesti- või ingliskeelse teksti asendame venekeelsega.",
      "Слайдов нет — баннер на главной не показывается.": "Slaide pole — avalehel bännerit ei näidata.",
      "Без заголовка": "Pealkirjata", "показан": "näidatakse", "скрыт": "peidetud",
      "Выше": "Kõrgemale", "Ниже": "Madalamale",
      "Изменить": "Muuda", "Удалить": "Kustuta", "Готово": "Valmis",
      "Добавить слайд": "Lisa slaid", "Сбросить к стандартному": "Taasta tavaline",
      "Смена слайдов, секунд": "Slaidivahetus, sekundit",
      "Больше пяти слайдов не нужно": "Rohkem kui viit slaidi pole vaja",
      "Язык баннера": "Bänneri keel",
      "Строка сверху": "Rida ülal", "Заголовок": "Pealkiri",
      "Подзаголовок": "Alapealkiri", "Надпись на кнопке": "Nupu tekst",
      "Пусто — покажем русский текст.": "Tühi — näitame venekeelset teksti.",
      "Куда ведёт кнопка": "Kuhu nupp viib",
      "Разделы": "Osakonnad", "Страницы магазина": "Poe lehed", "Информация": "Info",
      "Один товар": "Üks toode", "Товар — выберите ниже": "Toode — vali allpool",
      "Картинка": "Pilt", "Найти товар": "Otsi toodet", "Найти фото товара": "Otsi toote fotot",
      "Ссылка на картинку — или выберите фото товара ниже": "Pildi link — või vali allpool toote foto",
      "https://… или /shop/img/…": "https://… või /shop/img/…",
      "Предпросмотр": "Eelvaade", "Баннер: стандартный": "Bänner: tavaline",
      "Ничего не нашлось — попробуйте другое слово.": "Midagi ei leitud — proovi teist sõna.",
      "Есть несохранённые изменения — нажмите «Сохранить».": "Salvestamata muudatused — vajuta „Salvesta“."
    },
    EN: {
      "Включить": "Turn on", "Выключить": "Turn off", "включён": "on", "выключен": "off",
      "Наборы на сайте": "Sets on the site",
      "готовые комплекты со скидкой 12 % — в меню, на главной и в каталоге; пока не согласовано с владельцем": "ready-made sets at 12 % off — in the menu, on the home page and in the catalogue; not yet approved by the owner",
      "показаны": "shown", "скрыты": "hidden", "Скрыть": "Hide", "Показать": "Show",
      "Наборы показаны ✓": "Sets shown ✓", "Наборы скрыты ✓": "Sets hidden ✓",
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
      "Кабинет": "Account", "Описание": "Description", "Доставка и возврат": "Delivery & returns",
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
      "Доставка и оплата": "Delivery & payment", "Возврат товара": "Returns",
      "Условия продажи": "Terms of sale", "Конфиденциальность": "Privacy",
      "Правовая информация": "Legal information", "Споры онлайн (ODR)": "Online dispute resolution (ODR)",
      "Оформление заказа": "Checkout",
      "Контакт": "Contact", "Доставка": "Delivery", "Оплата": "Payment",
      "Далее — доставка": "Next — delivery", "Далее — оплата": "Next — payment",
      "Имя": "Name", "Телефон": "Phone", "Страна": "Country", "Город": "City",
      "Адрес": "Address", "Промокод": "Promo code", "Применить": "Apply",
      "Заказ оформлен": "Order placed", "На главную": "Back to home",
      "Поиск: шампунь, Davines, паста…": "Search: shampoo, Davines, paste…",
      "Что ищете?": "What are you looking for?", "Язык интерфейса": "Language",
      "Добавлено в корзину": "Added to cart", "Товар снова в наличии — напишем!": "We'll e-mail you when it's back in stock!",
      "Сообщить": "Notify me", "Получить код": "Send code", "Выйти": "Log out",
      "Мои заказы": "My orders", "Мои данные": "My details", "Мои промокоды": "My promo codes",
      "Повторить заказ": "Repeat order", "Сохранить": "Save",
      "Страница не найдена": "Page not found",
      "Аккаунт не нужен — оформляйте как гость.": "No account needed — check out as a guest.",
      "Налоги включены. Доставка рассчитается при оформлении.": "Taxes included. Delivery is calculated at checkout.",
      "Каталог, товары и инфостраницы — на трёх языках.": "The catalogue, products and info pages are in three languages.",
      "Текст перенесён с текущего сайта; перед запуском пройдёт проверку юристом.": "Text carried over from the current site; a lawyer reviews it before launch.",
      "Эстония": "Estonia", "Латвия": "Latvia", "Литва": "Lithuania", "Финляндия": "Finland",
      "Европа": "Europe", "Таллинн": "Tallinn",
      "Профессиональный уход": "Professional care",
      "Kevin.Murphy, Davines, System 4 — то, чем работает команда Rempire в салоне.": "Kevin.Murphy, Davines, System 4 — what the Rempire team works with in the salon.",
      "В каталог": "To catalogue", "Смотреть": "View", "Новинки": "New in",
      "Свежая поставка": "Just arrived",
      "Уход и стайлинг, которые только приехали.": "Care and styling that has just landed.",
      "Борода": "Beard", "Всё для формы": "Everything to keep it in shape",
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
      "Фирменные футболки Rempire — принты наших художников, печатаем небольшими тиражами.": "Rempire tees — prints by our own artists, made in small runs.",
      "Ниша и классика, которые держим в наличии в Таллинне.": "Niche and classics we keep in stock in Tallinn.",
      "Гели, мыло и уход за телом — включая мыло собственной варки.": "Gels, soap and body care — including our own handmade soap.",
      "Весь ассортимент Rempire: уход, стайлинг, борода, лицо, тело, парфюмерия и мерч.": "The full Rempire range: care, styling, beard, face, body, fragrance and merch.",
      "Под эти фильтры ничего не подошло.": "Nothing matched these filters.",
      "Сначала дешевле": "Price: low to high", "Сначала дороже": "Price: high to low",
      "Поделиться": "Share", "Купить через": "Buy now with", "Другие способы оплаты": "Other payment methods",
      "С этим покупают": "Bought together",
      "Самовывоз": "Pickup", "Реквизиты": "Company details", "Связаться": "Get in touch",
      "Банковская ссылка (Swedbank, SEB, LHV, Luminor, Coop), карта, Apple Pay / Google Pay, счёт для компаний.": "Bank link (Swedbank, SEB, LHV, Luminor, Coop), card, Apple Pay / Google Pay, invoice for companies.",
      "Mardi 1, Таллинн · бесплатно · заказ ждёт 7 дней, дальше 1,50 € в день. Нужен документ.": "Mardi 1, Tallinn · free · your order waits 7 days, then €1.50 per day. Photo ID required.",
      "Mardi 1, 10145 Таллинн": "Mardi 1, 10145 Tallinn",
      "Админка — демо": "Admin — demo",
      "Банковская ссылка": "Bank link", "Банковская карта": "Bank card",
      "По счёту — для компаний": "By invoice — for companies",
      "Swedbank, SEB, LHV, Luminor, Coop — оплата в своём банке": "Swedbank, SEB, LHV, Luminor, Coop — pay via your own bank",
      "Оплата в одно касание": "One-tap payment",
      "Счёт на почту, оплата в течение 7 дней": "Invoice by e-mail, payment within 7 days",
      "Самовывоз — Mardi 1, Таллинн": "Pickup — Mardi 1, Tallinn",
      "Курьер до двери (DPD)": "Courier to the door (DPD)", "Курьер DPD": "DPD courier",
      "Курьер SmartPosti": "SmartPost courier", "Курьер Omniva": "Omniva courier",
      "Хочу получать новости и скидки": "Send me news and discounts",
      "E-mail для подтверждения заказа": "E-mail for the order confirmation",
      "Имя и фамилия": "Full name", "Индекс": "Postcode",
      "улица, дом": "street and house number", "Имя Фамилия": "First name Last name",
      "Ваш заказ": "Your order", "Корзина пуста.": "Your cart is empty.",
      "Бесплатно": "Free", "Бесплатная доставка применена ✓": "Free delivery applied ✓",
      "Забрать бесплатно на Mardi 1. Нужен документ. Заказ ждёт 7 дней, дальше 1,50 € в день.": "Free pickup at Mardi 1. Photo ID required. Your order waits 7 days, then €1.50 per day.",
      "Оплата через банк — данные карты магазин не видит": "Payment goes through the bank — the shop never sees card details",
      "14 дней на возврат по закону ЕС": "14-day returns under EU law",
      "Вопросы — 56237237 или rempireshopinfo@gmail.com": "Questions — 56237237 or rempireshopinfo@gmail.com",
      "Нажимая «Оплатить», вы соглашаетесь с условиями и политикой возврата.": "By pressing “Pay” you agree to the terms and the return policy.",
      "14 дней на возврат по закону ЕС. Вскрытая косметика возврату не подлежит по гигиеническим причинам.": "14-day returns under EU law. Opened cosmetics cannot be returned for hygiene reasons.",
      "14 дней на возврат по закону ЕС. Футболку можно примерить и вернуть, если не подошла.": "14-day returns under EU law. You can try the tee on and return it if it doesn't fit.",
      "Это демонстрация — настоящий заказ не создан. В рабочем магазине сюда придёт номер заказа, счёт на почту и трекинг посылки.": "This is a demo — no real order was created. In the live shop this page shows the order number, an e-mailed invoice and parcel tracking.",
      "Тарифы — прайс-листы перевозчиков 2025–2026, с НДС 24 %. От 40 посылок в месяц Omniva и DPD дают скидку 3–20 % — итоговые цены уточним при подключении.": "Rates — carrier price lists 2025–2026, incl. 24% VAT. From 40 parcels a month Omniva and DPD give 3–20% off — final prices to be confirmed once the contracts are signed.",
      "Добавлено в корзину ✓": "Added to cart ✓",
      "Код не найден — проверьте написание.": "Code not found — check the spelling.",
      "Город": "City",
      "Рег. 12216136 · KMKR EE102723858": "Reg. no 12216136 · VAT EE102723858",
      "← В магазин": "← Back to shop", "изменить": "edit",
      "Добавьте — и доставка бесплатно:": "Add one more — and delivery is free:",
      "Демо-отзывы. Настоящие появятся после запуска — письмом «оцените заказ» через 10 дней.": "Demo reviews. Real ones arrive after launch, via a “rate your order” e-mail sent 10 days later.",
      "из 5": "out of 5",
      "Объём": "Size", "Количество": "Quantity", "Цвет принта — ": "Print colour — ",
      "Обзор": "Overview", "Заказы": "Orders", "Товары": "Products", "Клиенты": "Customers",
      "Аналитика": "Analytics", "Письма": "E-mails", "Подключения": "Integrations", "Настройки": "Settings",
      "Админка": "Admin", "Помощник": "Assistant", "Журнал изменений": "Change log",
      "Все заказы": "All orders", "Править": "Edit", "Отменить": "Undo",
      "Применить": "Apply", "Отмена": "Cancel", "Сохранить": "Save",
      "Найти товар: название, бренд…": "Find a product: name, brand…",
      /* вход в админку и настоящие заказы (backend) */
      "Вход в админку": "Admin sign-in", "Пароль": "Password", "Войти": "Sign in",
      "Проверяем…": "Checking…", "Неверный пароль": "Wrong password", "Введите пароль": "Enter the password",
      "Пароль владельца. Магазин работает и без входа — здесь только управление.":
        "The owner's password. The shop runs without signing in — this is only the admin side.",
      "Слишком много попыток — подождите минуту.": "Too many attempts — wait a minute.",
      "Пароль ещё не настроен на сервере.": "No admin password is set on the server yet.",
      "Сервер не отвечает": "The server is not responding",
      "Заказы — настоящие, с сервера. Клиенты и аналитика пока демонстрационные.":
        "Orders are real, from the server. Customers and analytics are still demo data.",
      "Сервер заказов не отвечает — показан демонстрационный список.":
        "The orders server is not responding — showing the demo list.",
      "новый": "new", "оплачен": "paid", "не оплачен": "unpaid", "отправлен": "shipped",
      "отменён": "cancelled", "возврат": "refunded",
      "Оформлен": "Placed", "Оплачен": "Paid", "Отправлен": "Shipped",
      "Состав": "Items", "Статус": "Status", "Покупатель": "Customer", "Скидка": "Discount",
      "Заметка": "Note", "Видна только вам": "Only you see it", "Сохранить заметку": "Save note",
      "Сохранено ✓": "Saved ✓", "Не удалось сохранить": "Could not save",
      "Пакомат": "Parcel locker", "Курьер": "Courier", "Доставка": "Delivery",
      /* checkout: delivery, machine picker, payment, receipt */
      "Курьер до двери": "Courier to your door", "Перевозчик": "Carrier",
      "Выберите пакомат": "Choose a parcel locker", "выбрать": "choose",
      "Поиск по адресу и городу": "Search by address or city",
      "Загружаем список…": "Loading the list…",
      "Выберите пакомат — туда приедет посылка.": "Choose a parcel locker — that is where the parcel goes.",
      "Загружаем список пакоматов…": "Loading parcel lockers…",
      "Для этой страны список пока пуст — выберите курьера.": "No lockers listed for this country yet — pick the courier.",
      "Ничего не нашли. Попробуйте название города или улицы.": "Nothing found. Try a town or street name.",
      "Выбор пакомата": "Parcel locker picker",
      "Город, улица или название": "Town, street or name",
      "Поиск пакомата": "Search parcel lockers",
      "Готовим оплату…": "Preparing payment…", "Готовим…": "Preparing…",
      "Заказ оплачен": "Order paid",
      "Спасибо! Подтверждение и чек уже летят на почту. Когда посылку передадут перевозчику, пришлём трек-номер.": "Thank you. The confirmation and receipt are on their way to your inbox; you will get a tracking number when the parcel is handed to the carrier.",
      "Оплата не прошла": "Payment did not go through",
      "Деньги не списаны. Заказ сохранён — попробуйте оплатить ещё раз или выберите другой способ.": "No money was taken. The order is saved — try paying again or choose another method.",
      "Платёж обрабатывается": "Payment is being processed",
      "Банк ещё не подтвердил оплату. Как только он ответит, мы пришлём письмо — обычно это занимает пару минут.": "The bank has not confirmed the payment yet. We will e-mail you as soon as it does — usually a couple of minutes.",
      "Вернуться в магазин": "Back to the shop",
      "Корзина пуста": "The cart is empty",
      "Слишком много попыток — подождите минуту": "Too many attempts — wait a minute",
      "Проверьте e-mail": "Check the e-mail address",
      "Товара не хватает на складе": "Not enough stock",
      "Магазин временно недоступен — попробуйте позже": "The shop is temporarily unavailable — try again later",
      "Не получилось оформить заказ — попробуйте ещё раз": "Could not place the order — please try again",
      "Не получилось оформить заказ": "Could not place the order",
      "Оплата пока недоступна — попробуйте позже": "Payment is not available right now — try again later",
      /* «Письма» — предпросмотр и тестовая отправка */
      "Письма — предпросмотр и тест": "E-mails — preview and test",
      "Выберите письмо и язык — покажем его ровно таким, каким его получит покупатель. Ниже можно отправить образец себе на почту.": "Pick a letter and a language — we show it exactly as the customer receives it. Below you can send yourself a sample.",
      "Заказ принят": "Order confirmed", "Заказ отправлен": "Order shipped",
      "Брошенная корзина": "Abandoned cart", "Товар снова в наличии": "Back in stock",
      "Скидка ко дню рождения": "Birthday discount",
      "Письмо": "Letter", "Язык письма": "Letter language", "Предпросмотр письма": "Letter preview",
      "Отправить тест на…": "Send a test to…", "Отправить тест": "Send a test",
      "В письме будут вымышленный заказ и товары — это образец вёрстки, не настоящий заказ.": "The letter uses a made-up order and products — it is a layout sample, not a real order.",
      "Тест отправлен ✓": "Test sent ✓", "Нужен вход в админку": "Sign in to the admin first",
      "Отправка писем ещё не подключена": "E-mail sending is not connected yet",
      "Слишком много писем — попробуйте позже": "Too many e-mails — try again later",
      "Введите e-mail — на него придёт образец": "Enter an e-mail — we'll send the sample there",
      /* toasts and filter chips — text nodes the dictionary used to miss */
      "Товара нет в наличии": "This product is out of stock", "Корзина пуста": "Your cart is empty",
      "В наличии ✕": "In stock ✕", "Ссылка скопирована ✓": "Link copied ✓",
      "Записали — сообщим, когда появится ✓": "Noted — we'll let you know when it's back ✓",
      "Введите e-mail — на него придёт код": "Enter your e-mail — we'll send the code there",
      "Товары заказа #1042 в корзине ✓": "Items from order #1042 are in your cart ✓",
      "Сохранено ✓": "Saved ✓",
      /* ---- features: sets, gift card, reviews, video ---- */
      "Наборы": "Sets", "Набор": "Set", "Все наборы": "All sets",
      "Готовые наборы из тех же товаров, что стоят в магазине по отдельности. Вместе — дешевле.":
        "Ready-made sets of the same products the shop sells separately. Together they cost less.",
      "Наборы скоро появятся.": "Sets are coming soon.",
      "Что внутри": "What's inside",
      "Одного из товаров сейчас нет — соберём набор, как только он приедет.":
        "One of the products is out of stock — we'll put the set together as soon as it arrives.",
      "Набор сейчас не собрать — товар закончился": "The set can't be made up right now — a product is out of stock",
      "Набор в корзине ✓": "Set added to your cart ✓",
      "Подарочная карта": "Gift card", "Выбрать сумму": "Choose an amount", "Сумма": "Amount",
      "25, 50 или 100 € — придёт письмом получателю. Если не знаете, что выбрать, это всегда подходит.":
        "€25, €50 or €100 — sent to the recipient by e-mail. When you don't know what to pick, this always works.",
      "Работает на весь магазин и не сгорает. После оплаты придёт письмо с кодом — вам или сразу получателю.":
        "Valid across the whole shop and it doesn't expire on you. After payment the code arrives by e-mail — to you or straight to the recipient.",
      "Кому — имя": "To — name", "Имя получателя": "Recipient's name",
      "E-mail получателя — не обязательно": "Recipient's e-mail — optional",
      "Оставьте пустым — пришлём карту вам, подарите сами.": "Leave it empty and we'll send the card to you to give in person.",
      "Короткое поздравление": "A short message", "С днём рождения!": "Happy birthday!",
      "Карта действует год со дня покупки. Остаток сохраняется: можно потратить за несколько заказов.":
        "The card is valid for a year from purchase. The balance is kept: it can be spent over several orders.",
      "Подарочная карта в корзине ✓": "Gift card added to your cart ✓",
      "Проверьте e-mail получателя": "Check the recipient's e-mail",
      "Проверьте адрес — похоже, в нём опечатка.": "Check the address — it looks like a typo.",
      "Промокод или подарочная карта": "Promo code or gift card",
      "убрать": "remove", "Останется на карте": "Left on the card",
      "На этой карте не осталось денег.": "There is nothing left on this card.",
      "Карта не найдена — проверьте код.": "Card not found — check the code.",
      "Сейчас не получилось проверить карту. Попробуйте позже.": "We couldn't check the card just now. Please try later.",
      "Проверенный отзыв": "Verified review", "Оставить отзыв": "Write a review",
      "Ваш отзыв": "Your review", "Как вас зовут": "Your name", "Оценка": "Rating",
      "Что понравилось, что нет — от 20 знаков": "What worked and what didn't — at least 20 characters",
      "Пользуюсь месяц…": "I've been using it for a month…",
      "Согласен(на) опубликовать отзыв и имя на этой странице": "I agree to publish this review and my name on this page",
      "Отправить отзыв": "Send review", "Отправляем…": "Sending…",
      "Публикуем после проверки — обычно в тот же день.": "We publish after a check — usually the same day.",
      "Спасибо! Отзыв отправлен — он появится на странице после проверки.":
        "Thank you! Your review has been sent — it appears on the page once checked.",
      "Не получилось отправить — попробуйте ещё раз.": "Sending failed — please try again.",
      "Напишите, как вас зовут.": "Tell us your name.",
      "Поставьте оценку от 1 до 5.": "Give a rating from 1 to 5.",
      "Напишите хотя бы 20 знаков — так отзыв поможет другим.": "Write at least 20 characters — that's what makes a review useful.",
      "Слишком длинно — до 1500 знаков.": "Too long — up to 1500 characters.",
      "Ссылки и адреса почты в отзывах не публикуем.": "We don't publish links or e-mail addresses in reviews.",
      "Уберите, пожалуйста, грубые слова.": "Please take out the rude words.",
      "Отметьте согласие на публикацию.": "Tick the consent box.",
      "Слишком много отзывов подряд — попробуйте через час.": "Too many reviews in a row — try again in an hour.",
      "Сейчас не получилось сохранить. Попробуйте позже.": "We couldn't save it just now. Please try later.",
      "Видео": "Video", "Смотреть видео": "Watch the video",
      "Видео (YouTube/Vimeo ссылка)": "Video (YouTube or Vimeo link)",
      "https://youtu.be/… или https://vimeo.com/…": "https://youtu.be/… or https://vimeo.com/…",
      "Вставьте ссылку — на странице товара появится видео. Пусто — блока нет.":
        "Paste a link and a video appears on the product page. Empty means no video block.",
      "Отзывы": "Reviews", "Новые": "New", "Опубликованные": "Published", "Отклонённые": "Rejected",
      "Загружаем…": "Loading…", "Здесь пусто.": "Nothing here.",
      "Опубликовать": "Publish", "Отклонить": "Reject",
      "Отзывы покупателей. Ничего не появляется в магазине само — сначала вы читаете, потом публикуете. Отклонённый отзыв просто не показывается.":
        "Customer reviews. Nothing appears in the shop by itself — you read first, then publish. A rejected review is simply not shown.",
      "Отзывы пока недоступны — база подключается. Как только она заработает, новые отзывы появятся здесь сами.":
        "Reviews aren't available yet — the database is being connected. Once it is live, new reviews show up here by themselves.",
      "Отзыв опубликован ✓": "Review published ✓", "Отзыв отклонён ✓": "Review rejected ✓",
      "Не получилось — попробуйте ещё раз": "That didn't work — please try again",
      // главный баннер (hero) — витрина и редактор в админке
      "Баннеры": "Banners", "Выбрать баннер": "Choose a banner",
      "Предыдущий баннер": "Previous banner", "Следующий баннер": "Next banner",
      "Главный баннер": "Home banner",
      "Большая картинка на главной. Слайды показываются по кругу; один слайд — просто картинка без стрелок. Тексты — на трёх языках: пустой эстонский или английский заменяем русским.":
        "The big picture on the home page. Slides rotate; a single slide is just a picture, with no arrows. Texts come in three languages: an empty Estonian or English one falls back to the Russian.",
      "Слайдов нет — баннер на главной не показывается.": "No slides — the home page shows no banner.",
      "Без заголовка": "No title", "показан": "shown", "скрыт": "hidden",
      "Выше": "Move up", "Ниже": "Move down",
      "Изменить": "Edit", "Удалить": "Delete", "Готово": "Done",
      "Добавить слайд": "Add a slide", "Сбросить к стандартному": "Reset to default",
      "Смена слайдов, секунд": "Slide change, seconds",
      "Больше пяти слайдов не нужно": "Five slides is plenty",
      "Язык баннера": "Banner language",
      "Строка сверху": "Line above", "Заголовок": "Title",
      "Подзаголовок": "Subtitle", "Надпись на кнопке": "Button text",
      "Пусто — покажем русский текст.": "Empty — we show the Russian text.",
      "Куда ведёт кнопка": "Where the button goes",
      "Разделы": "Sections", "Страницы магазина": "Shop pages", "Информация": "Information",
      "Один товар": "A single product", "Товар — выберите ниже": "Product — pick one below",
      "Картинка": "Picture", "Найти товар": "Find a product", "Найти фото товара": "Find a product photo",
      "Ссылка на картинку — или выберите фото товара ниже": "Picture link — or pick a product photo below",
      "https://… или /shop/img/…": "https://… or /shop/img/…",
      "Предпросмотр": "Preview", "Баннер: стандартный": "Banner: default",
      "Ничего не нашлось — попробуйте другое слово.": "Nothing found — try another word.",
      "Есть несохранённые изменения — нажмите «Сохранить».": "Unsaved changes — press “Save”."
    }
  };
  /* Strings with numbers or sums inside. $1 keeps the captured piece; a
     captured piece that is itself a dictionary term (a country, a carrier
     label) is translated too. */
  var UI_RX = [
    // real orders: «Заказ R-100042», «Пакомат · Kristiine keskus»
    [/^Заказ (R-\d+)$/, { ET: "Tellimus $1", EN: "Order $1" }],
    [/^Пакомат · (.+)$/, { ET: "Pakiautomaat · $1", EN: "Parcel locker · $1" }],
    [/^Курьер · (.+)$/, { ET: "Kuller · $1", EN: "Courier · $1" }],
    [/^Скидка · (.+)$/, { ET: "Soodustus · $1", EN: "Discount · $1" }],
    [/^Показаны все (\d+) товар(?:|а|ов)$/, { ET: "Kuvatud kõik $1 toodet", EN: "All $1 products shown" }],
    [/^(\d+) товар(?:|а|ов)$/, { ET: "$1 toodet", EN: "$1 products" }],
    [/^Корзина \((\d+)\)$/, { ET: "Ostukorv ($1)", EN: "Cart ($1)" }],
    [/^До бесплатной доставки \((.+), от (.+)\) — ещё (.+)$/, { ET: "Tasuta tarneni ($1, alates $2) — veel $3", EN: "$3 more to free delivery ($1, from $2)" }],
    [/^Бесплатная доставка — порог (.+) достигнут ✓$/, { ET: "Tasuta tarne — piir $1 saavutatud ✓", EN: "Free delivery — $1 threshold reached ✓" }],
    [/^Бесплатная доставка по Эстонии от (.+)$/, { ET: "Tasuta tarne Eestis alates $1", EN: "Free delivery in Estonia from $1" }],
    [/^Бесплатная доставка от (.+) — не хватает (.+)$/, { ET: "Tasuta tarne alates $1 — puudu $2", EN: "Free delivery from $1 — $2 to go" }],
    [/^Бесплатная доставка от (.+)$/, { ET: "Tasuta tarne alates $1", EN: "Free delivery from $1" }],
    [/^Бесплатная доставка: Эстония от (.+) · LV, LT от (.+) · Финляндия от (.+)$/,
      { ET: "Tasuta tarne: Eesti alates $1 · LV, LT alates $2 · Soome alates $3", EN: "Free delivery: Estonia from $1 · LV, LT from $2 · Finland from $3" }],
    [/^от (\d.*)$/, { ET: "alates $1", EN: "from $1" }],
    [/^Доставка — (.+)$/, { ET: "Tarne — $1", EN: "Delivery — $1" }],
    [/^Доставка 1–3 дня: DPD, Omniva, SmartPosti, курьер · по Эстонии бесплатно от (.+) · самовывоз на Mardi 1$/,
      { ET: "Tarne 1–3 päeva: DPD, Omniva, SmartPosti, kuller · Eestis tasuta alates $1 · järeletulek aadressil Mardi 1", EN: "Delivery 1–3 days: DPD, Omniva, SmartPosti, courier · free in Estonia from $1 · pickup at Mardi 1" }],
    [/^(.+) · (\d+(?:[.,]\d+)?) мл × (\d+)$/, { ET: "$1 · $2 ml × $3", EN: "$1 · $2 ml × $3" }],
    [/^(.+) · (\d+(?:[.,]\d+)?) г × (\d+)$/, { ET: "$1 · $2 g × $3", EN: "$1 · $2 g × $3" }],
    [/^(.+) × (\d+)$/, { ET: "$1 × $2", EN: "$1 × $2" }],
    [/^DPD, Omniva, SmartPosti и курьер · 1–3 дня · по Эстонии бесплатно от (.+) · 230 пакоматов в 4 странах$/,
      { ET: "DPD, Omniva, SmartPosti ja kuller · 1–3 päeva · Eestis tasuta alates $1 · 230 pakiautomaati 4 riigis", EN: "DPD, Omniva, SmartPosti and courier · 1–3 days · free in Estonia from $1 · 230 parcel lockers in 4 countries" }],
    [/^Пакомат (DPD|Omniva|SmartPosti)$/, { ET: "$1 pakiautomaat", EN: "$1 parcel locker" }],
    [/^Пакомат — (\d+) (?:точка|точки|точек)$/, { ET: "Pakiautomaat — $1 punkti", EN: "Parcel locker — $1 locations" }],
    // the picker sheet counts on its own line
    [/^(\d+) (?:точка|точки|точек)$/, { ET: "$1 punkti", EN: "$1 locations" }],
    [/^Всё, что есть в наличии от (.+) — во всех разделах магазина\.$/,
      { ET: "Kõik brändi $1 tooted, mis on laos — kõigist poe osadest.", EN: "Everything in stock from $1 — across every section." }],
    [/^По запросу «(.+)» ничего не нашлось\.$/, { ET: "Otsingule „$1“ ei leidnud midagi.", EN: "Nothing found for “$1”." }],
    [/^\/ (.+)$/, { ET: "/ $1", EN: "/ $1" }],
    // \d+, not \d: with reviews from the database a product can pass ten
    [/^Отзывы \((\d+)\)$/, { ET: "Arvustused ($1)", EN: "Reviews ($1)" }],
    [/^(\d+(?:[.,]\d+)?) мл$/, { ET: "$1 ml", EN: "$1 ml" }],
    [/^(\d+(?:[.,]\d+)?) г$/, { ET: "$1 g", EN: "$1 g" }],
    [/^★ ([\d,\.]+) из 5$/, { ET: "★ $1 / 5", EN: "★ $1 out of 5" }],
    [/^Найдено: (\d+)$/, { ET: "Leitud: $1", EN: "Found: $1" }],
    // features
    [/^выгода (.+)$/, { ET: "sääst $1", EN: "you save $1" }],
    [/^В корзину — (.+)$/, { ET: "Lisa ostukorvi — $1", EN: "Add to cart — $1" }],
    [/^Подарочная карта ([A-Z0-9-]+)$/, { ET: "Kinkekaart $1", EN: "Gift card $1" }],
    [/^(\d) из 5$/, { ET: "$1 / 5", EN: "$1 out of 5" }],
    // главный баннер
    [/^Баннер (\d+)$/, { ET: "Bänner $1", EN: "Banner $1" }],
    [/^Кнопка ведёт на: (.+)$/, { ET: "Nupp viib: $1", EN: "The button goes to: $1" }]
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
    "футболка оверсайз": ["oversize T-särk", "oversized tee"],
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
    // Russian is the source language — and UI has no RU table, so without
    // this guard every direct trText caller (setHead, patchCart) threw in
    // RU and took the rest of render() down with it, killing the catalogue's
    // infinite scroll until the shopper switched language.
    var d = UI[lang];
    if (!d) return s;
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
  // `label` is the <optgroup> heading — the only attribute in the shop that
  // carries visible text without being a text node
  var TR_ATTRS = ["placeholder", "aria-label", "title", "label"];
  // .cline__parts and .bitem__nm (features) list product names inside a set —
  // without them the Russian type tail survived into the Estonian cart
  var NAME_CTX = ".card__name,.cline__nm,.cline__parts,.cosum__nm,.bitem__nm,.crumbs,.pdp,.rail,h1,option,.adm__nm";
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
      /* A <textarea>'s text node is its editable value, not a label. Rewriting
         it handed the owner an English translation of his own Russian copy —
         and saved it back as the Russian when he touched the field. */
      if (el && el.tagName === "TEXTAREA") continue;
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

  /* ---------- главный баннер ----------------------------------------------
     The hero is the one piece of the home page the owner writes himself, so
     it is data, not markup: DEMO.hero = { slides: [...], interval }. Every
     slide carries its own three languages, its own link and its own picture.

     BANNERS above stays the built-in default. It is Russian-only on purpose —
     a missing ET/EN falls back to the Russian original, which the dictionary
     pass then translates, which is exactly how these five slides have always
     reached Estonian and English. Nothing changes until the owner edits. */
  var HERO_TICK = 6000;
  function heroDefault() {
    return {
      slides: BANNERS.map(function (b, i) {
        return {
          id: "b" + (i + 1),
          eyebrow: { RU: b.eyebrow }, title: { RU: b.t }, sub: { RU: b.s }, cta: { RU: b.c },
          go: "cat:" + b.cat,
          image: bannerProduct(b).id,
          on: true
        };
      }),
      interval: HERO_TICK
    };
  }
  function heroConf() {
    return DEMO.hero && Array.isArray(DEMO.hero.slides) ? DEMO.hero : heroDefault();
  }
  function heroSlides() {
    return heroConf().slides.filter(function (s) { return s && s.on !== false; });
  }
  function heroCount() { return heroSlides().length; }
  function heroInterval() {
    var n = Number(heroConf().interval);
    return n >= 2000 && n <= 30000 ? n : HERO_TICK;
  }
  /* One field of one slide in the language on screen; empty → Russian. */
  function heroT(field) {
    var v = field && typeof field === "object" ? field : {};
    return String(v[S.lang] || v.RU || "");
  }
  /* The button reuses the storefront's own data-* actions, so a banner link
     goes through the same delegated handler as every other link in the shop. */
  function heroGoAttr(go) {
    var g = String(go || "");
    if (g.indexOf("cat:") === 0) return 'data-go-cat="' + esc(g.slice(4)) + '"';
    if (g.indexOf("product:") === 0 && g.length > 8) return 'data-go-product="' + esc(g.slice(8)) + '"';
    if (g.indexOf("page:") === 0) return 'data-page="' + esc(g.slice(5)) + '"';
    if (g === "bundles" || g === "gift" || g === "brands") return 'data-go="' + g + '"';
    return 'data-go-cat="all"';
  }
  function heroProduct(image) {
    var v = String(image || "");
    for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === v) return CATALOGUE[i];
    return null;
  }
  function heroUrl(image) {
    var v = String(image || "");
    return /^(https?:\/\/|\/)/.test(v) ? v : "";
  }
  /* A picture is either a catalogue photo (by product id, drawn by the same
     media() as everywhere else) or a plain URL the owner pasted. */
  function heroArt(image, cls) {
    var u = heroUrl(image);
    if (u) {
      return '<span class="' + (cls || "hero__art") + '" style="background-image:url(\'' +
        esc(u).replace(/'/g, "%27") + '\')"></span>';
    }
    return media(heroProduct(image) || CATALOGUE[0], 0, cls || "hero__art");
  }
  /* `flat` draws the admin preview: the same markup with a dead button, so a
     click inside the panel cannot navigate the owner out of the panel. */
  function heroSlideHTML(s, i, cur, flat) {
    var cta = heroT(s.cta);
    return '<div class="hero__slide" data-on="' + (i === cur ? 1 : 0) + '" aria-hidden="' + (i !== cur) + '">' +
      '<div class="hero__box">' +
        '<div class="hero__inner"><div class="hero__eyebrow">' + esc(heroT(s.eyebrow)) + "</div>" +
        '<h2 class="hero__title">' + esc(heroT(s.title)) + "</h2>" +
        '<p class="hero__sub">' + esc(heroT(s.sub)) + "</p>" +
        (cta
          ? (flat ? '<span class="btn">' + esc(cta) + "</span>"
                  : '<button class="btn" ' + heroGoAttr(s.go) + ">" + esc(cta) + "</button>")
          : "") + "</div>" +
        heroArt(s.image) +
      "</div></div>";
  }
  function heroHTML() {
    var list = heroSlides();
    if (!list.length) return "";                       // every slide switched off
    var cur = ((S.slide % list.length) + list.length) % list.length;
    return '<section class="hero" aria-label="Баннеры" aria-roledescription="карусель">' +
      list.map(function (s, i) { return heroSlideHTML(s, i, cur, false); }).join("") +
      // one slide is a picture, not a carousel — no arrows, no dots, no autoplay
      (list.length > 1
        ? '<button class="hero__arrow hero__arrow--prev" data-slide="-1" aria-label="Предыдущий баннер">‹</button>' +
          '<button class="hero__arrow hero__arrow--next" data-slide="1" aria-label="Следующий баннер">›</button>' +
          '<div class="hero__dots" role="group" aria-label="Выбрать баннер">' + list.map(function (s, i) {
            return '<button data-dot="' + i + '" aria-current="' + (i === cur) + '" aria-label="Баннер ' + (i + 1) + '"></button>';
          }).join("") + "</div>"
        : "") +
      "</section>";
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
  /* Free-shipping floors per country, quoted by the announce bar, the footer,
     the product page and the admin.
     These are no longer a constant: whatever the shop *says* here has to be
     what the checkout *charges*, and that number now comes from the server
     (settings.shipping_rules → SHIP_RULES below, mirrored via /api/overrides).
     The values seeded here are the same defaults src/lib/shipping.ts carries,
     and refreshShipThresholds() updates them the moment the real rules land.
     Per-country floors — 50 € everywhere is a giveaway outside Estonia, where
     the FI courier alone costs ~26 € incl. VAT — are set through the rules'
     freeFromByCountry, not here. */
  var THRESH = { EE: 59, LV: 59, LT: 59, FI: 59, EU: 59 };
  function refreshShipThresholds() {
    Object.keys(THRESH).forEach(function (c) {
      var by = SHIP_RULES.freeFromByCountry;
      var v = by && Object.prototype.hasOwnProperty.call(by, c) ? by[c] : SHIP_RULES.freeFrom;
      // null means "never free" — the marketing lines have no way to say that,
      // so they keep the last real number while threshold() bills correctly
      if (typeof v === "number" && isFinite(v)) THRESH[c] = v;
    });
  }
  function machinesFor(m) {
    if (!m || !m.pm) return [];
    try {
      var byCarrier = SHIPPING_DATA.machines[S.country];
      if (byCarrier && byCarrier[m.pm] && byCarrier[m.pm].length) return byCarrier[m.pm];
    } catch (e) {}
    return [];
  }
  var COUNTRIES = [["EE", "Эстония"], ["LV", "Латвия"], ["LT", "Литва"], ["FI", "Финляндия"], ["EU", "Другая страна Европы"]];

  /* ---------- checkout delivery: rules, carriers, parcel points ------------
     The SHIP table above still prices the account screen and the admin's
     sample orders. Checkout works off the server's rules instead: three
     delivery shapes, a carrier under the parcel one, and a price mirrored
     from settings.shipping_rules through /api/overrides — so the summary the
     shopper watches is the total the server bills. Defaults below match
     src/lib/shipping.ts exactly; with no API behind the shop nothing here
     fails, it just stays on the defaults and checks out as a demo. */
  var SHIP_RULES = {
    freeFrom: 59,
    freeFromByCountry: null,
    methods: {
      parcel: { "default": 4.99, EE: 3.49, LV: 4.99, LT: 4.99 },
      courier: { "default": 9.90, EE: 5.99 },
      pickup: { "default": 0 }
    },
    carriers: null
  };
  var DELIVERY = [
    { k: "parcel", l: "Пакомат" },
    { k: "courier", l: "Курьер до двери" },
    { k: "pickup", l: "Самовывоз — Mardi 1, Таллинн" }
  ];
  var CARRIER_NAMES = { omniva: "Omniva", smartpost: "SmartPosti", dpd: "DPD" };
  /* Which carriers have machines we can actually list. Omniva's public feed
     covers EE/LV/LT and SmartPosti EE; DPD publishes no point list at all
     (contract API only), so DPD is offered as a courier, never as a pakomaat.
     Finland has none of either yet — its SmartPosti points need a Posti API
     key — so FI is courier-only and the parcel option is not offered there.
     See docs/shipping.md. */
  var CARRIERS_BY_COUNTRY = { EE: ["omniva", "smartpost"], LV: ["omniva"], LT: ["omniva"], FI: [], EU: [] };

  /* Is there a server behind this page? null until the first call answers.
     false puts the checkout back into demo mode — the prototype is hosted
     statically for Renat, and it must still walk end to end there. */
  var API = { ok: null };
  function apiSeen(ok) { if (API.ok !== ok) API.ok = ok; }

  /** Merge the owner's rules over the defaults, one key at a time. */
  function applyShipRules(raw) {
    if (!raw || typeof raw !== "object") return;
    if (raw.freeFrom === null || typeof raw.freeFrom === "number") SHIP_RULES.freeFrom = raw.freeFrom;
    if (raw.freeFromByCountry && typeof raw.freeFromByCountry === "object") SHIP_RULES.freeFromByCountry = raw.freeFromByCountry;
    if (raw.methods && typeof raw.methods === "object") {
      ["parcel", "courier", "pickup"].forEach(function (m) {
        if (raw.methods[m] && typeof raw.methods[m] === "object") {
          Object.keys(raw.methods[m]).forEach(function (c) {
            var v = Number(raw.methods[m][c]);
            if (isFinite(v) && v >= 0) SHIP_RULES.methods[m][c] = v;
          });
        }
      });
    }
    if (raw.carriers && typeof raw.carriers === "object") SHIP_RULES.carriers = raw.carriers;
    // the announce bar and the footer quote these — keep the promise and the
    // bill the same number
    refreshShipThresholds();
  }
  var shipRulesAsked = false;
  function loadShipRules() {
    if (shipRulesAsked) return;
    shipRulesAsked = true;
    fetch("/api/overrides/").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.ok) return;
      apiSeen(true);
      var s = j.settings || {};
      applyShipRules(s.shipping_rules || s.shippingRules || s.shipping);
      if (S.screen === "checkout") render();
    }).catch(function () { apiSeen(false); });
  }

  /**
   * Delivery shapes available for a country. The parcel option is offered only
   * where there is a machine to choose — including "the feed answered and had
   * nothing", which carriersFor() has already learned by then.
   */
  function deliveryFor(country) {
    return DELIVERY.filter(function (d) {
      if (d.k === "parcel") return carriersFor(country).length > 0;
      if (d.k === "pickup") return country === "EE";   // the counter is in Tallinn
      return true;
    });
  }
  function shipMethod() {
    var avail = deliveryFor(S.country);
    for (var i = 0; i < avail.length; i++) if (avail[i].k === S.ship.method) return S.ship.method;
    return avail.length ? avail[0].k : "courier";
  }
  /** Carriers worth offering: the country's list, minus any that came back empty. */
  function carriersFor(country) {
    var cc = country || S.country;
    return (CARRIERS_BY_COUNTRY[cc] || []).filter(function (c) {
      return !POINTS.empty[c + ":" + cc];
    });
  }
  function shipCarrier() {
    var list = carriersFor();
    return list.indexOf(S.ship.carrier) >= 0 ? S.ship.carrier : (list[0] || "");
  }
  function isParcel() { return shipMethod() === "parcel"; }
  function shipMethodLabel() {
    var k = shipMethod();
    for (var i = 0; i < DELIVERY.length; i++) if (DELIVERY[i].k === k) {
      return k === "parcel" && shipCarrier() ? DELIVERY[i].l + " " + CARRIER_NAMES[shipCarrier()] : DELIVERY[i].l;
    }
    return "";
  }

  /* ---------- parcel points ----------
     One list per carrier+country, fetched once and kept. A dead feed is not an
     error the shopper should see: the API falls back to its committed seed,
     and this falls back to shipping-data.js, so there is always something to
     pick from. */
  var POINTS = { by: {}, empty: {}, loading: {}, q: "" };
  function pointsKey() { return shipCarrier() + ":" + S.country; }
  function pointsList() { return POINTS.by[pointsKey()] || null; }
  function demoPoints(carrier) {
    try {
      var names = SHIPPING_DATA.machines[S.country][carrier] || [];
      return names.map(function (n, i) {
        return { id: carrier + "-demo-" + i, name: n, address: "", city: "" };
      });
    } catch (e) { return []; }
  }
  function loadPoints() {
    var carrier = shipCarrier();
    if (!carrier) return;
    var key = carrier + ":" + S.country;
    if (POINTS.by[key] || POINTS.loading[key]) return;
    POINTS.loading[key] = true;
    var done = function (list, live) {
      POINTS.loading[key] = false;
      POINTS.by[key] = list;
      if (live && !list.length) POINTS.empty[key] = true;
      pointsArrived();
    };
    fetch("/api/shipping/points/?country=" + encodeURIComponent(S.country) + "&carrier=" + encodeURIComponent(carrier))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok && j.points) { apiSeen(true); done(j.points, true); }
        else done(demoPoints(carrier), false);
      })
      .catch(function () { apiSeen(false); done(demoPoints(carrier), false); });
  }
  /** Typeahead over name, address and city — the three things people type. */
  function pointsFiltered() {
    var all = pointsList() || [];
    var q = POINTS.q.trim().toLowerCase();
    if (!q) return all.slice(0, 80);
    var words = q.split(/\s+/);
    return all.filter(function (p) {
      var hay = ((p.name || "") + " " + (p.address || "") + " " + (p.city || "")).toLowerCase();
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      return true;
    }).slice(0, 80);
  }
  function pointById(id) {
    var all = pointsList() || [];
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  var PAYS = [
    { l: "Банковская ссылка", h: "Swedbank, SEB, LHV, Luminor, Coop — оплата в своём банке", k: "bank" },
    { l: "Банковская карта", h: "Visa, Mastercard", k: "card" },
    { l: "Apple Pay / Google Pay", h: "Оплата в одно касание", k: "wallet" },
    { l: "По счёту — для компаний", h: "Счёт на почту, оплата в течение 7 дней", k: "invoice" }
  ];
  var BANKS = ["Swedbank", "SEB", "LHV", "Luminor", "Coop"];
  /* features: the three gift-card amounts. Declared HERE, not down with the
     rest of the gift-card code — the saved-cart filter below runs at load and
     needs it, and a `var` assigned further down is still undefined by then
     (which silently emptied the cart on every reload). */
  var GIFT_AMOUNTS = [25, 50, 100];

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
    // method/carrier/point drive the real checkout; the rest is the address
    ship: { name: "", addr: "", zip: "", city: "", phone: "", method: "parcel", carrier: "", point: null },
    pointOpen: false,   // the parcel-machine picker sheet
    paying: false,      // «Оплатить» is in flight — the button locks
    done: null,         // receipt state when we got here without a redirect
    newsletter: false,
    invoiceCo: "",
    acctName: "",
    pay: 0,
    bank: 0,
    adminTab: "over",
    adminAsk: "",
    adminOrder: 0,   // opened order id (0 = list)
    adminEdit: "",   // opened product id in goods
    goodsQ: "",      // admin goods search
    // ---- «Главный баннер» in the admin panel ----
    heroDraft: null, // working copy of the whole banner while it is being edited
    heroEdit: -1,    // which slide's form is open (-1 = the list)
    heroLang: "RU",  // which language pill the form shows
    heroGoQ: "",     // link picker: product search
    heroImgQ: "",    // image picker: product search
    mailTpl: "order-confirmed", // «Письма»: which letter the preview shows
    mailLang: "",    // letter language; "" follows the panel language
    mailTo: "",      // address typed into «отправить тест на…»
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
    brandFilter: [],
    // ---- наборы, подарочная карта, отзывы, видео (features) ----
    bundleId: "",       // which set is open on the set page
    giftAmount: 50,     // chosen gift-card amount
    gift: { name: "", email: "", message: "" },
    giftCard: null,     // {code, discount, remaining} once a card is applied at checkout
    giftErr: "",
    dbReviews: {},      // productId → [approved reviews from the database]
    revForm: { name: "", rating: 0, text: "", website: "", consent: false },
    revState: "",       // "" | "sending" | "sent" | an error code
    revOpen: false,
    admReviews: null,   // admin tab: {reviews, counts} once loaded
    admRevFilter: "pending",
    videoOn: false      // the product video is a click-to-play embed
  };

  var LS = "rempire-shop-proto";
  /* Declared before the block that sets it. `var` hoists the declaration but
     not the assignment, so with this line below the try{} it ran afterwards
     and reset the flag to false every time — the saved preference was never
     seen as explicit, and the geo refinement below overrode it. */
  var savedHadLang = false;

  /* ---------- the language in the URL ------------------------------------
     /shop2/ is Russian and the x-default; /shop2/et/… and /shop2/en/… are the
     same shop one language over. The prefix is the strongest signal there is —
     it is what a search engine indexed and what a shopper pasted — so it beats
     both the saved preference and the browser's languages. Paths without a
     prefix behave exactly as they did: saved choice, else browser, else RU. */
  var LANG_OF_SEG = { et: "ET", en: "EN", ru: "RU" };
  var SEG_OF_LANG = { RU: "", ET: "/et", EN: "/en" };
  function langFromPath(p) {
    var m = String(p || "").match(/^\/shop2\/(et|en|ru)(?:\/|$)/i);
    return m ? LANG_OF_SEG[m[1].toLowerCase()] : "";
  }
  /* Everything after /shop2/<lang> — the router matches on this, so one set of
     patterns serves all three languages. */
  function stripLangPrefix(p) {
    return String(p || "").replace(/^\/shop2\/(et|en|ru)(?=\/|$)/i, "/shop2");
  }
  /* What the URL itself declares, which is not always what is on screen: an
     unprefixed path stays Russian for the canonical and the hreflang cluster
     even when the visitor's browser has us rendering English. Getting that
     backwards would tell Google that /shop2/ is the English page. */
  var urlLang = langFromPath(location.pathname);
  var pathLang = urlLang || "RU";
  // the path this document was served for — what any prerendered markup in it
  // describes, and therefore what stops being true the moment we navigate
  var loadedPath = location.pathname;

  try {
    var saved = JSON.parse(localStorage.getItem(LS) || "{}");
    // Drop lines whose product no longer exists — byId() falls back to the
    // first product, which would silently show the wrong item at the wrong
    // price after a catalogue change.
    if (saved.cart) S.cart = saved.cart.filter(function (l) {
      // sets and gift cards are not catalogue products: a set survives only
      // while it is still curated, a gift card while the amount is still sold
      if (l.type === "bundle") return !!bundleById(l.id);
      if (l.type === "gift") return GIFT_AMOUNTS.indexOf(giftAmount(l.id)) >= 0;
      for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === l.id) return true;
      return false;
    });
    if (saved.lang) { S.lang = saved.lang; savedHadLang = true; }
    else S.lang = guessLang();
  } catch (e) {}
  /* Applied last so it beats both. It is deliberately not persisted: someone
     who arrives on /shop2/en/ from a search result and never touches the
     switcher keeps their own preference on the unprefixed paths. The flag is
     set because the language IS decided — the geo refinement below must not
     second-guess a URL. */
  if (urlLang) { S.lang = urlLang; savedHadLang = true; }
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
    // ET/RU: «12,90 €»; EN: «€12.90» (whole euros drop the decimals in all three)
    var v = (Math.round(n * 100) / 100).toFixed(2);
    if (S.lang === "EN") return "€" + v.replace(".00", "");
    return v.replace(".", ",").replace(",00", "") + " €";
  }
  function num1(n) {
    // one decimal, language-aware separator (ratings)
    var v = (Math.round(n * 10) / 10).toFixed(1);
    return S.lang === "EN" ? v : v.replace(".", ",");
  }
  function byId(id) { for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i]; return CATALOGUE[0]; }
  function sizePrice(p, i) {
    if (p.prices && p.prices.length) return p.prices[Math.min(i, p.prices.length - 1)];
    return p.price;
  }
  function gal(p) { return p.gallery && p.gallery.length ? p.gallery : [p.img]; }
  function cartCount() { var n = 0; S.cart.forEach(function (l) { n += l.qty; }); return n; }
  // lineUnit() knows the three line kinds — product, set, gift card
  function cartSum() { var s = 0; S.cart.forEach(function (l) { s += lineUnit(l) * l.qty; }); return s; }
  /* The free-shipping floor now comes from the same rules the server bills on
     (SHIP_RULES, mirrored from settings.shipping_rules). THRESH above is the
     old demo table and still serves the account screen. A null floor means
     delivery is never free in that country. */
  function threshold() {
    var by = SHIP_RULES.freeFromByCountry;
    var f = by && Object.prototype.hasOwnProperty.call(by, S.country) ? by[S.country] : SHIP_RULES.freeFrom;
    return f === null || f === undefined ? Infinity : f;
  }
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
  /** Delivery price for any method, straight off the rules: carrier, then method. */
  function shipPriceFor(m, carrier) {
    if (m === "pickup" || freeShip()) return 0;
    var byCarrier = SHIP_RULES.carriers && SHIP_RULES.carriers[carrier];
    var v = byCarrier ? (byCarrier[S.country] !== undefined ? byCarrier[S.country] : byCarrier["default"]) : undefined;
    if (v === undefined || v === null) {
      var table = SHIP_RULES.methods[m] || {};
      v = table[S.country] !== undefined ? table[S.country] : table["default"];
    }
    return typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }
  function shipCost() { return shipPriceFor(shipMethod(), shipCarrier()); }
  function discount() { return S.promoOk ? Math.round(cartSum() * 10) / 100 : 0; }
  /* ---- features: gift card at checkout -----------------------------------
     A card pays for goods and delivery both, but never more than the order
     costs — the remainder stays on the card for the next one. Applied after
     the promo code, so a code can still be used with a card. */
  function giftDiscount() {
    if (!S.giftCard) return 0;
    var rest = cartSum() - discount() + shipCost();
    return Math.round(Math.min(S.giftCard.balance, Math.max(0, rest)) * 100) / 100;
  }
  /* ---- /features ---------------------------------------------------------- */
  function total() { return cartSum() - discount() + shipCost() - giftDiscount(); }
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
      return { id: d.id, name: d.name, n: list.filter(function (p) { return DEMO.subcat[p.id] ? DEMO.subcat[p.id] === d.id : d.re.test(p.name); }).length, re: d.re };
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
      if (sdef) list = list.filter(function (p) { return DEMO.subcat[p.id] ? DEMO.subcat[p.id] === sdef.id : sdef.re.test(p.name); });
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

  /* ---------- наборы (bundles) --------------------------------------------
     Curated sets, generated by tools/build-bundles.mjs from
     tools/bundles.config.mjs into public/shop/bundles.js. A set is NOT a
     catalogue product: it has its own id space («bundle:<id>» in the cart and
     in the order), one fixed price, and it carries the real products it is
     made of, so the shopper — and later whoever packs the parcel — sees
     exactly what is inside. Titles and descriptions arrive in three
     languages, like the product texts, so they are picked by S.lang instead
     of going through the interface dictionary.

     The file is optional: if bundles.js fails to load the shop simply has no
     sets, rather than a blank page. */
  function allBundles() {
    if (DEMO.bundles === false) return [];   // owner switched sets off (admin → Магазин)
    return typeof BUNDLES === "undefined" ? [] : BUNDLES;
  }
  function bundleById(id) {
    var key = String(id || "").replace(/^bundle:/, "");
    var list = allBundles();
    for (var i = 0; i < list.length; i++) if (list[i].id === key) return list[i];
    return null;
  }
  function bundleTitle(b) { return (b.title && (b.title[S.lang] || b.title.RU)) || b.id; }
  function bundleDesc(b) { return (b.desc && (b.desc[S.lang] || b.desc.RU)) || ""; }
  /* The live catalogue wins over the snapshot inside the set: a renamed or
     re-priced product must not show two different names on two pages. */
  function bundleItemProduct(it) {
    for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === it.id) return CATALOGUE[i];
    return null;
  }
  function bundleItemName(it) {
    var p = bundleItemProduct(it);
    return (p ? p.brand + " " + p.name : (it.brand || "") + " " + (it.name || it.id)).trim();
  }
  /* Three product photos stacked instead of a new photo shoot: at card size
     the overlap reads as «несколько вещей», and no set needs an asset. */
  function bundleStack(b, cls) {
    var imgs = (b.images || []).slice(0, 3);
    // --n2 rebalances a two-item set: three slots with one empty read as a
    // photo that failed to load
    return '<span class="bstack bstack--n' + imgs.length + " " + (cls || "") + '">' + imgs.map(function (src, i) {
      return '<span class="bstack__i bstack__i--' + i + '" style="background-image:url(\'' + src + '\')"></span>';
    }).join("") + "</span>";
  }
  function bundleCardHTML(b) {
    var out = b.stock === "out";
    return '<div class="card card--bundle">' +
      '<button class="card__go" data-go-bundle="' + b.id + '">' +
        '<span class="card__media">' + bundleStack(b, "bstack--card") +
          '<span class="bbadge num">−' + b.pct + ' %</span></span>' +
        '<span class="card__brand">Набор</span>' +
        '<span class="card__name">' + esc(bundleTitle(b)) + "</span>" +
        '<span class="card__price num">' + eur(b.price) +
          ' <s class="bwas">' + eur(b.sum) + "</s>" +
          (out ? ' <span class="chip chip--out">нет в наличии</span>' : "") + "</span>" +
      "</button>" +
      (out ? "" : '<button class="link card__add" data-addbundle="' + b.id + '">В корзину</button>') +
      "</div>";
  }
  /* Sets belonging to the section being browsed, shown above the grid. Hidden
     the moment the shopper narrows anything down — a set cannot honour a
     brand filter or a subcategory chip, so offering one there would lie. */
  function bundlesForCatalog() {
    if (S.brand || S.subcat || S.brandFilter.length || S.onlyInStock) return [];
    return allBundles().filter(function (b) {
      return b.stock !== "out" && (S.cat === "all" || b.cat === S.cat);
    });
  }
  function bundleGridHTML(list, title) {
    if (!list.length) return "";
    return '<section class="sec sec--bundles"><div class="sec__head"><h2 class="sec__title">' + title +
      '</h2><button class="link" data-go="bundles">Все наборы</button></div>' +
      '<div class="grid">' + list.map(bundleCardHTML).join("") + "</div></section>";
  }

  function screenBundles() {
    var list = allBundles();
    return '<div class="wrap">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / Наборы</div>' +
      '<section class="sec" style="padding-top:14px">' +
        '<h1 class="display h1">Наборы</h1>' +
        '<p class="sec__intro">Готовые наборы из тех же товаров, что стоят в магазине по отдельности. Вместе — дешевле.</p>' +
        giftTileHTML() +
        (list.length
          ? '<div class="grid">' + list.map(bundleCardHTML).join("") + "</div>"
          : '<p class="muted">Наборы скоро появятся.</p>') +
      "</section></div>";
  }

  function screenBundle() {
    var b = bundleById(S.bundleId);
    if (!b) {
      return '<div class="wrap"><section class="sec"><h1 class="display h1">Страница не найдена</h1>' +
        '<p><button class="link" data-go="bundles">Все наборы</button></p></section></div>';
    }
    var out = b.stock === "out";
    return '<div class="wrap">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / <button data-go="bundles">Наборы</button> / ' +
        esc(bundleTitle(b)) + "</div>" +
      '<div class="pdp">' +
        '<div><div class="pdp__stage">' + bundleStack(b, "bstack--big") + "</div></div>" +
        "<div>" +
          '<div class="pdp__idrow"><span class="card__brand pdp__brand">Набор</span></div>' +
          '<h1 class="pdp__title">' + esc(bundleTitle(b)) + "</h1>" +
          '<div class="num pdp__price"><span>' + eur(b.price) + '</span> <s class="bwas">' + eur(b.sum) + "</s>" +
            ' <span class="chip chip--ok">выгода ' + eur(b.save) + "</span>" +
            (out ? ' <span class="chip chip--out">нет в наличии</span>' : "") + "</div>" +
          '<div class="pdp__tax">Налоги включены. Доставка рассчитается при оформлении.</div>' +
          '<p class="bdesc">' + esc(bundleDesc(b)) + "</p>" +
          '<div class="sec__head sec__head--sub"><h2 class="sec__title">Что внутри</h2></div>' +
          '<div class="bitems">' + b.items.map(function (it) {
            var p = bundleItemProduct(it);
            return '<div class="bitem"><span class="bitem__ph">' +
                '<span class="ph" style="background-image:url(\'' + (p ? p.img : it.img) + '\')"></span></span>' +
              '<button class="bitem__nm" data-go-product="' + it.id + '">' + esc(bundleItemName(it)) +
                (it.sizeLabel ? ' <span class="muted">· ' + esc(it.sizeLabel) + "</span>" : "") + "</button>" +
              '<span class="num bitem__pr">' + eur(it.price) + "</span></div>";
          }).join("") + "</div>" +
          (out
            ? '<p class="muted">Одного из товаров сейчас нет — соберём набор, как только он приедет.</p>'
            : '<button class="btn btn--wide" data-addbundle="' + b.id + '">В корзину — ' + eur(b.price) + "</button>") +
          '<div class="pdp__ship">Доставка 1–3 дня: DPD, Omniva, SmartPosti, курьер · по Эстонии бесплатно от ' + THRESH.EE + " € · самовывоз на Mardi 1</div>" +
        "</div>" +
      "</div></div>" +
      (out ? "" :
        '<div class="stickybar"><span class="num stickybar__sum">' + eur(b.price) +
        '</span><button class="btn" data-addbundle="' + b.id + '">В корзину</button></div>');
  }

  /* ---------- подарочная карта --------------------------------------------
     A virtual product: no catalogue entry, no stock, three fixed amounts. It
     travels in the cart as {type:"gift", id:"gift:50", meta:{…}} and reaches
     the order as the item id «gift:50»; the code itself is made server-side
     once the order is paid (src/lib/giftcards.ts).
     GIFT_AMOUNTS lives up with BANKS — see the note there. */
  function giftAmount(id) {
    var m = /^gift:(\d+)$/.exec(String(id || ""));
    return m ? Number(m[1]) : 0;
  }
  function giftTileHTML() {
    return '<div class="gifttile"><span class="gifttile__art" aria-hidden="true">' + tower("gifttile__mark") + "</span>" +
      '<div class="gifttile__txt"><h2 class="sec__title">Подарочная карта</h2>' +
      '<p class="muted">25, 50 или 100 € — придёт письмом получателю. Если не знаете, что выбрать, это всегда подходит.</p></div>' +
      '<button class="btn btn--ghost" data-go="gift">Выбрать сумму</button></div>';
  }
  function giftEmailBad() {
    var v = S.gift.email.trim();
    return !!v && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v);
  }
  function screenGift() {
    return '<div class="wrap wrap--mid">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / <button data-go="bundles">Наборы</button> / Подарочная карта</div>' +
      '<section class="sec" style="padding-top:14px">' +
        '<h1 class="display h1">Подарочная карта</h1>' +
        '<p class="sec__intro">Работает на весь магазин и не сгорает. После оплаты придёт письмо с кодом — вам или сразу получателю.</p>' +
        '<div class="field__label">Сумма</div>' +
        '<div class="gamts" role="group" aria-label="Сумма карты">' + GIFT_AMOUNTS.map(function (a) {
          return '<button class="gamt" data-giftamt="' + a + '" aria-current="' + (S.giftAmount === a) + '">' + a + " €</button>";
        }).join("") + "</div>" +
        '<label class="field"><span class="field__label">Кому — имя</span>' +
          '<input class="input" data-giftf="name" value="' + esc(S.gift.name) + '" placeholder="Имя получателя"></label>' +
        '<label class="field"><span class="field__label">E-mail получателя — не обязательно</span>' +
          '<input class="input" type="email" inputmode="email" data-giftf="email" value="' + esc(S.gift.email) + '" aria-invalid="' + giftEmailBad() + '" placeholder="you@example.com"></label>' +
        (giftEmailBad() ? '<div class="err" role="alert">Проверьте адрес — похоже, в нём опечатка.</div>'
          : '<div class="hint">Оставьте пустым — пришлём карту вам, подарите сами.</div>') +
        '<label class="field"><span class="field__label">Короткое поздравление</span>' +
          '<textarea class="input" rows="3" maxlength="300" data-giftf="message" placeholder="С днём рождения!">' + esc(S.gift.message) + "</textarea></label>" +
        '<button class="btn btn--wide" data-addgift="' + S.giftAmount + '">В корзину — ' + eur(S.giftAmount) + "</button>" +
        '<p class="muted" style="margin-top:14px">Карта действует год со дня покупки. Остаток сохраняется: можно потратить за несколько заказов.</p>' +
      "</section></div>";
  }

  /* ---------- cart lines of every kind ------------------------------------
     Three kinds share one list: a catalogue product, a set and a gift card.
     Everything that used to call byId(l.id) goes through these instead. */
  function lineUnit(l) {
    if (l.type === "bundle") { var b = bundleById(l.id); return b ? b.price : 0; }
    if (l.type === "gift") return giftAmount(l.id);
    return sizePrice(byId(l.id), l.size || 0);
  }
  /* The kind word is picked here rather than left to the dictionary: in the
     checkout summary the whole line is one text node («Набор · X × 1»), and
     the generic «$1 × $2» rule claims it before any set-specific rule can. */
  var LINE_KIND = {
    bundle: { RU: "Набор", ET: "Komplekt", EN: "Set" },
    gift: { RU: "Подарочная карта", ET: "Kinkekaart", EN: "Gift card" }
  };
  function lineTitle(l) {
    if (l.type === "bundle") {
      var b = bundleById(l.id);
      var word = LINE_KIND.bundle[S.lang] || LINE_KIND.bundle.RU;
      return b ? word + " · " + bundleTitle(b) : word;
    }
    if (l.type === "gift") {
      return (LINE_KIND.gift[S.lang] || LINE_KIND.gift.RU) + " · " + eur(giftAmount(l.id));
    }
    var p = byId(l.id);
    return p.brand + " " + p.name;
  }
  function lineImageHTML(l, cls) {
    if (l.type === "bundle") { var b = bundleById(l.id); return b ? bundleStack(b, "bstack--line") : ""; }
    if (l.type === "gift") return '<span class="ph giftph">' + tower("giftph__mark") + "</span>";
    return media(byId(l.id), 0, cls || "ph");
  }
  /* What sits under the name in the cart and in the checkout summary: the
     components of a set, the recipient of a gift card, nothing for a product. */
  function lineNoteHTML(l) {
    if (l.type === "bundle") {
      var b = bundleById(l.id);
      if (!b) return "";
      return '<span class="cline__parts">' + b.items.map(function (it) {
        return esc(bundleItemName(it)) + (it.sizeLabel ? " · " + esc(it.sizeLabel) : "");
      }).join("<br>") + "</span>";
    }
    if (l.type === "gift") {
      var m = l.meta || {};
      var who = [m.name, m.email].filter(Boolean).join(" · ");
      return who ? '<span class="cline__parts">' + esc(who) + "</span>" : "";
    }
    return "";
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
        (allBundles().length ? '<button data-go="bundles" data-nav-bundles>Наборы</button>' : "") +
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
      if (b.dataset.navBundles !== undefined) {
        b.setAttribute("aria-current", String(S.screen === "bundles" || S.screen === "bundle" || S.screen === "gift"));
      } else if (b.dataset.navBrands !== undefined) {
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
      ftrSec("Покупателю", (allBundles().length ? '<button class="link" data-go="bundles">Наборы</button> · ' : "") + '<button class="link" data-go="gift">Подарочная карта</button> · <button class="link" data-page="shipping">Доставка и оплата</button> · <button class="link" data-page="returns">Возврат товара</button> · <button class="link" data-page="terms">Условия продажи</button> · <button class="link" data-page="contact">Контакты</button>') +
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
    return heroHTML() +
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

        // features: sets sit between the two product rails and the categories
        bundleGridHTML(allBundles().filter(function (b) { return b.stock !== "out"; }).slice(0, 4), "Наборы") +

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
        /* features: sets for this section, in their own grid ABOVE the
           catalogue one. They deliberately do not live inside #catgrid —
           patchCatalog() matches the already-rendered prefix by
           [data-go-product], and a set card would break that match and make
           every infinite-scroll batch rebuild the whole grid. */
        bundleGridHTML(bundlesForCatalog(), "Наборы") +
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
          /* features: approved reviews from the database come first and carry
             a badge; the demo pool keeps its place underneath, and the form
             sits at the bottom of the same accordion. */
          (function () {
            var db = dbReviewsFor(p), rv = reviewsFor(p);
            var n = db.length + rv.length;
            var body = (db.length ? dbReviewsHTML(db) : "") +
              (rv.length ? reviewsHTML(rv) : "") + reviewFormHTML(p);
            // «Отзывы (0)» on every young product reads as a verdict; with
            // nothing to show yet the heading is just the invitation
            return acc(n ? "Отзывы (" + n + ")" : "Отзывы", body);
          })() +
        "</div>" +
      "</div>" +
      // features: click-to-play video, below the gallery and the buy column
      videoHTML(p) +
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
  /* Demo reviews: deterministic slice of the category pool, so a product
     always shows the same reviews and roughly a third show none (honest —
     a young shop does not have reviews under everything). */
  function hashStr(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function reviewsFor(p) {
    if (typeof REVIEWS_POOL === "undefined") return [];
    // trilingual pool ({RU:{cat:[...]}}), with fallback for the flat shape
    var byLang = REVIEWS_POOL[S.lang] || REVIEWS_POOL.RU || REVIEWS_POOL;
    var pool = byLang[p.cat] || REVIEWS_POOL[p.cat] || [];
    if (!pool.length) return [];
    var h = hashStr(p.id);
    var n = [0, 2, 3, 2, 0, 3, 2][h % 7];
    var out = [];
    for (var i = 0; i < n; i++) out.push(pool[(h + i * 3) % pool.length]);
    return out;
  }
  function reviewsHTML(list) {
    var avg = 0; list.forEach(function (r) { avg += r.r; });
    avg = Math.round(avg / list.length * 10) / 10;
    return '<div class="revs"><div class="revs__avg">★ ' + num1(avg) + " из 5</div>" +
      list.map(function (r) {
        return '<div class="rev"><div class="rev__head"><b>' + esc(r.n) + "</b>" +
          '<span class="rev__stars" aria-label="' + r.r + ' из 5">' + "★★★★★".slice(0, r.r) + "</span>" +
          '<span class="muted">' + esc(r.d) + "</span></div>" +
          '<p class="rev__t">' + esc(r.t) + "</p></div>";
      }).join("") +
      '<p class="muted" style="font-size:12px">Демо-отзывы. Настоящие появятся после запуска — письмом «оцените заказ» через 10 дней.</p></div>';
  }

  /* ---------- features: real reviews from the database ---------------------
     The demo pool above stays where it is — a young shop with nothing under
     any product looks abandoned. Rows that real customers wrote and Renat
     approved are rendered ABOVE it, each with a «Проверенный отзыв» badge, so
     the two can never be mistaken for one another.
     Read:  GET  /api/reviews/?product=<id>
     Write: POST /api/reviews/  → status «pending» until approved. */
  function loadReviews(id) {
    if (!id || S.dbReviews[id] !== undefined) return;
    S.dbReviews[id] = null;                       // in flight — never asked twice
    fetch("/api/reviews/?product=" + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        S.dbReviews[id] = (j && j.ok && j.reviews) || [];
        if (S.screen === "product" && S.productId === id && S.dbReviews[id].length) render();
      })
      .catch(function () { S.dbReviews[id] = []; });
  }
  function dbReviewsFor(p) {
    var list = S.dbReviews[p.id];
    return list && list.length ? list : [];
  }
  function dbReviewsHTML(list) {
    var avg = 0; list.forEach(function (r) { avg += r.rating; });
    avg = Math.round(avg / list.length * 10) / 10;
    return '<div class="revs revs--db"><div class="revs__avg">★ ' + num1(avg) + " из 5</div>" +
      list.map(function (r) {
        var d = String(r.createdAt || "").slice(0, 10).split("-");
        return '<div class="rev rev--db"><div class="rev__head"><b>' + esc(r.name) + "</b>" +
          '<span class="rev__stars" aria-label="' + r.rating + ' из 5">' + "★★★★★".slice(0, r.rating) + "</span>" +
          (d.length === 3 ? '<span class="muted">' + d[2] + "." + d[1] + "." + d[0] + "</span>" : "") +
          '<span class="revbadge">Проверенный отзыв</span></div>' +
          '<p class="rev__t">' + esc(r.text) + "</p></div>";
      }).join("") + "</div>";
  }
  function reviewReady() {
    return S.revForm.name.trim().length >= 2 &&
      S.revForm.rating >= 1 &&
      S.revForm.text.trim().length >= 20 &&
      !!S.revForm.consent;
  }
  var REV_ERR = {
    bot: "Не получилось отправить — попробуйте ещё раз.",
    no_name: "Напишите, как вас зовут.",
    bad_rating: "Поставьте оценку от 1 до 5.",
    short_text: "Напишите хотя бы 20 знаков — так отзыв поможет другим.",
    long_text: "Слишком длинно — до 1500 знаков.",
    links: "Ссылки и адреса почты в отзывах не публикуем.",
    profanity: "Уберите, пожалуйста, грубые слова.",
    no_consent: "Отметьте согласие на публикацию.",
    rate_limited: "Слишком много отзывов подряд — попробуйте через час.",
    unavailable: "Сейчас не получилось сохранить. Попробуйте позже."
  };
  function reviewFormHTML(p) {
    if (!S.revOpen) {
      return '<div class="revadd"><button class="btn btn--ghost" data-revopen>Оставить отзыв</button></div>';
    }
    if (S.revState === "sent") {
      return '<div class="revadd revadd--done"><p>Спасибо! Отзыв отправлен — он появится на странице после проверки.</p>' +
        '<button class="link" data-revopen>Закрыть</button></div>';
    }
    var err = S.revState && S.revState !== "sending" ? REV_ERR[S.revState] || REV_ERR.unavailable : "";
    return '<div class="revadd revadd--open">' +
      '<div class="sec__head sec__head--sub"><h3 class="sec__title">Ваш отзыв</h3>' +
        '<button class="link" data-revopen>Закрыть</button></div>' +
      '<label class="field"><span class="field__label">Как вас зовут</span>' +
        '<input class="input" data-revf="name" maxlength="60" value="' + esc(S.revForm.name) + '" placeholder="Имя"></label>' +
      '<div class="field__label">Оценка</div>' +
      '<div class="revstars" role="radiogroup" aria-label="Оценка от 1 до 5">' +
        [1, 2, 3, 4, 5].map(function (n) {
          return '<button class="revstar" role="radio" data-revstar="' + n + '" aria-checked="' +
            (n <= S.revForm.rating) + '" aria-label="' + n + ' из 5">★</button>';
        }).join("") +
        '<span class="muted" data-revrating>' + (S.revForm.rating ? S.revForm.rating + " из 5" : "") + "</span></div>" +
      '<label class="field"><span class="field__label">Что понравилось, что нет — от 20 знаков</span>' +
        '<textarea class="input" rows="4" maxlength="1500" data-revf="text" placeholder="Пользуюсь месяц…">' + esc(S.revForm.text) + "</textarea></label>" +
      // honeypot: off-screen, no label, never focusable by keyboard
      '<div class="revhp" aria-hidden="true"><input tabindex="-1" autocomplete="off" data-revf="website" value="' + esc(S.revForm.website) + '"></div>' +
      '<label class="opt opt--plain"><input type="checkbox" data-revf="consent"' + (S.revForm.consent ? " checked" : "") + ">" +
        "<span>Согласен(на) опубликовать отзыв и имя на этой странице</span></label>" +
      (err ? '<div class="err" role="alert">' + err + "</div>" : "") +
      '<button class="btn btn--wide" data-revsend' + (reviewReady() && S.revState !== "sending" ? "" : " disabled") + ">" +
        (S.revState === "sending" ? "Отправляем…" : "Отправить отзыв") + "</button>" +
      '<p class="muted" style="font-size:12.5px">Публикуем после проверки — обычно в тот же день.</p>' +
      "</div>";
  }
  function sendReview() {
    if (!reviewReady() || S.revState === "sending") return;
    S.revState = "sending"; render();
    fetch("/api/reviews/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product: S.productId, name: S.revForm.name.trim(), rating: S.revForm.rating,
        text: S.revForm.text.trim(), lang: S.lang, website: S.revForm.website, consent: !!S.revForm.consent
      })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) {
        if (j && j.ok) {
          S.revState = "sent";
          S.revForm = { name: "", rating: 0, text: "", website: "", consent: false };
        } else S.revState = (j && j.error) || "unavailable";
        render();
      })
      .catch(function () { S.revState = "unavailable"; render(); });
  }

  /* ---------- features: product video --------------------------------------
     One optional link per product (admin → Товары → Видео). Nothing from
     YouTube or Vimeo is loaded until the shopper taps: the poster is a plain
     <img>, and only then does the iframe appear — privacy-enhanced domain,
     so a page view is not a visit to Google. */
  function videoOf(p) {
    var raw = (DEMO.video && DEMO.video[p.id]) || p.video || "";
    raw = String(raw).trim();
    if (!raw) return null;
    var m;
    if ((m = raw.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/))) {
      return { kind: "yt", id: m[1],
        poster: "https://i.ytimg.com/vi/" + m[1] + "/hqdefault.jpg",
        src: "https://www.youtube-nocookie.com/embed/" + m[1] + "?autoplay=1&rel=0&modestbranding=1" };
    }
    if ((m = raw.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/))) {
      return { kind: "vimeo", id: m[1], poster: "",
        src: "https://player.vimeo.com/video/" + m[1] + "?autoplay=1&dnt=1" };
    }
    return null;
  }
  function videoHTML(p) {
    var v = videoOf(p);
    if (!v) return "";
    return '<div class="pvideo">' +
      '<div class="sec__head sec__head--sub"><h2 class="sec__title">Видео</h2></div>' +
      (S.videoOn
        ? '<div class="pvideo__frame"><iframe src="' + v.src + '" loading="lazy" title="Видео о товаре" ' +
          'allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>'
        : '<button class="pvideo__frame pvideo__play" data-playvideo aria-label="Смотреть видео">' +
          (v.poster
            ? '<img src="' + v.poster + '" alt="" loading="lazy" decoding="async">'
            : '<span class="pvideo__blank">' + tower("pvideo__mark") + "</span>") +
          '<span class="pvideo__btn" aria-hidden="true">▶</span></button>') +
      "</div>";
  }

  /* ---------- features: gift card at checkout ---------------------------- */
  function applyGiftCode(code, btn) {
    var label = btn ? btn.textContent : "";
    if (btn) { btn.textContent = "…"; btn.disabled = true; }
    fetch("/api/giftcards/check/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) {
        if (j && j.ok) {
          S.giftCard = { code: j.code, balance: j.balance };
          S.giftErr = ""; S.promo = ""; S.promoErr = false;
        } else {
          S.giftCard = null;
          var er = (j && j.error) || "";
          S.giftErr = er === "empty" ? "На этой карте не осталось денег."
            : er === "unavailable" || er === "rate_limited"
              ? "Сейчас не получилось проверить карту. Попробуйте позже."
              : "Карта не найдена — проверьте код.";
        }
        render(); refocus("[data-applypromo]");
      })
      .catch(function () {
        if (btn) { btn.textContent = label; btn.disabled = false; }
        S.giftErr = "Сейчас не получилось проверить карту. Попробуйте позже.";
        render();
      });
  }

  /* ---------- features: review moderation in the admin ------------------- */
  function loadAdminReviews(force) {
    if (S.admReviews && !force) return;
    if (loadAdminReviews._busy) return;
    loadAdminReviews._busy = true;
    fetch("/api/admin/reviews/?status=" + encodeURIComponent(S.admRevFilter))
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) {
        loadAdminReviews._busy = false;
        S.admReviews = j && j.ok ? j : { reviews: [], counts: { pending: 0, approved: 0, rejected: 0 }, error: (j && j.error) || "unavailable" };
        if (S.screen === "admin" && S.adminTab === "reviews") render();
      })
      .catch(function () {
        loadAdminReviews._busy = false;
        S.admReviews = { reviews: [], counts: { pending: 0, approved: 0, rejected: 0 }, error: "unavailable" };
        if (S.screen === "admin" && S.adminTab === "reviews") render();
      });
  }
  function moderateReview(id, status) {
    fetch("/api/admin/reviews/", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: id, status: status })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) {
        toast(j && j.ok ? (status === "approved" ? "Отзыв опубликован ✓" : "Отзыв отклонён ✓") : "Не получилось — попробуйте ещё раз");
        loadAdminReviews(true);
        render();
      })
      .catch(function () { toast("Не получилось — попробуйте ещё раз"); });
  }
  var REV_TABS = [["pending", "Новые"], ["approved", "Опубликованные"], ["rejected", "Отклонённые"]];
  function admReviewsHTML() {
    var data = S.admReviews;
    var counts = (data && data.counts) || { pending: 0, approved: 0, rejected: 0 };
    var head = '<p class="muted" style="margin:16px 0">Отзывы покупателей. Ничего не появляется в магазине само — сначала вы читаете, потом публикуете. Отклонённый отзыв просто не показывается.</p>' +
      '<div class="fchips">' + REV_TABS.map(function (tt) {
        return '<button class="fchip" data-admrevfilter="' + tt[0] + '" aria-current="' + (S.admRevFilter === tt[0]) + '">' +
          tt[1] + ' <span class="num">' + (counts[tt[0]] || 0) + "</span></button>";
      }).join("") + "</div>";
    if (!data) return head + '<p class="muted" style="margin-top:16px">Загружаем…</p>';
    if (data.error) {
      return head + '<p class="muted" style="margin-top:16px">Отзывы пока недоступны — база подключается. ' +
        "Как только она заработает, новые отзывы появятся здесь сами.</p>";
    }
    if (!data.reviews.length) {
      return head + '<p class="muted" style="margin-top:16px">Здесь пусто.</p>';
    }
    return head + '<div class="adm__list">' + data.reviews.map(function (r) {
      var p = null;
      for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === r.productId) { p = CATALOGUE[i]; break; }
      return '<div class="adm__row adm__row--rev">' +
        (p ? '<span class="adm__ph">' + media(p, 0, "ph") + "</span>" : "") +
        '<span class="adm__nm">' + esc(r.name) + ' <span class="rev__stars">' + "★★★★★".slice(0, r.rating) + "</span>" +
          '<span class="adm__sub">' + (p ? esc(p.brand + " — " + p.name) : esc(r.productId)) +
            " · " + String(r.createdAt || "").slice(0, 10) + " · " + esc(r.lang) + "</span>" +
          '<span class="adm__revtext">' + esc(r.text) + "</span></span>" +
        '<span class="adm__revacts">' +
          (r.status === "approved" ? "" : '<button class="btn btn--sm" data-admrev="' + r.id + ':approved">Опубликовать</button>') +
          (r.status === "rejected" ? "" : '<button class="btn btn--ghost btn--sm" data-admrev="' + r.id + ':rejected">Отклонить</button>') +
        "</span></div>";
    }).join("") + "</div>";
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
    var m = shipMethod();
    if (m === "pickup") return false;
    if (key === "name" || key === "phone") return true;
    return m === "courier";
  }
  function phoneOk() { return S.ship.phone.replace(/\D/g, "").length >= 7; }
  function shipEmpty(key) { return key === "phone" ? !phoneOk() : !S.ship[key].trim(); }
  function shipMissing() {
    return ["name", "addr", "zip", "city", "phone"].filter(function (k) {
      return shipRequired(k) && shipEmpty(k);
    });
  }
  /** A parcel machine has to be chosen before the order can be priced. */
  function pointMissing() { return isParcel() && !S.ship.point; }
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

  /* ---------- delivery picker ----------
     Method, then carrier, then the machine itself. The machine list is long
     (469 Omniva points in Estonia alone), so it lives behind a search rather
     than in a <select> nobody can scroll on a phone. */
  function deliveryPicker() {
    var avail = deliveryFor(S.country), cur = shipMethod(), chips = carriersFor();
    return '<div class="optlist">' + avail.map(function (d) {
        var p = shipPriceFor(d.k, d.k === "parcel" ? shipCarrier() : "");
        return '<label class="opt"><input type="radio" name="ship"' + (d.k === cur ? " checked" : "") +
          ' data-dm="' + d.k + '"><span>' + d.l + "</span>" +
          '<span class="opt__price num">' + (p ? eur(p) : "Бесплатно") + "</span></label>";
      }).join("") + "</div>" +
      (cur === "parcel" && chips.length > 1
        ? '<div class="carriers" role="group" aria-label="Перевозчик">' + chips.map(function (c) {
            return '<button class="carrier" data-carrier="' + c + '" aria-current="' + (c === shipCarrier()) + '">' +
              CARRIER_NAMES[c] + "</button>";
          }).join("") + "</div>"
        : "") +
      (cur === "parcel" ? pointField() : "") +
      (S.pointOpen ? pointSheet() : "");
  }
  /* The label is built from phrases the dictionary already knows — «Пакомат
     Omniva» matches a UI_RX rule, «Пакомат Omniva — 469 точек» would match
     nothing — so the count lives in the sheet instead. */
  function carrierLabel() {
    var c = CARRIER_NAMES[shipCarrier()];
    return c ? "Пакомат " + c : "Пакомат";
  }
  function pointField() {
    var chosen = S.ship.point, bad = S.shipTouched && !chosen;
    var list = pointsList();
    return '<div class="field"><span class="field__label">' + carrierLabel() + "</span>" +
      '<button class="pointbtn' + (chosen ? " pointbtn--set" : "") + '" data-pointopen aria-invalid="' + bad + '">' +
        (chosen
          ? '<span class="pointbtn__nm">' + esc(chosen.name) + "</span>" +
            '<span class="pointbtn__ad">' + esc([chosen.address, chosen.city].filter(Boolean).join(", ")) + "</span>"
          : '<span class="pointbtn__nm">Выберите пакомат</span>' +
            '<span class="pointbtn__ad">' + (list ? "Поиск по адресу и городу" : "Загружаем список…") + "</span>") +
        '<span class="pointbtn__go">' + (chosen ? "изменить" : "выбрать") + "</span></button>" +
      (bad ? '<div class="err" role="alert">Выберите пакомат — туда приедет посылка.</div>' : "") + "</div>";
  }
  /** The list is patched in place so typing never costs the input its focus. */
  function pointRows() {
    var list = pointsList();
    if (!list) return '<p class="muted psheet__msg">Загружаем список пакоматов…</p>';
    if (!list.length) return '<p class="muted psheet__msg">Для этой страны список пока пуст — выберите курьера.</p>';
    var found = pointsFiltered();
    if (!found.length) return '<p class="muted psheet__msg">Ничего не нашли. Попробуйте название города или улицы.</p>';
    return found.map(function (p) {
      return '<button class="prow" data-pointpick="' + esc(p.id) + '"' +
        (S.ship.point && S.ship.point.id === p.id ? ' aria-current="true"' : "") + ">" +
        '<span class="prow__nm">' + esc(p.name) + "</span>" +
        '<span class="prow__ad">' + esc([p.address, p.city].filter(Boolean).join(", ")) + "</span></button>";
    }).join("");
  }
  /* Typing patches only the list: a full render would take the search input
     down with it and the caret with the input. Everything else — the button's
     label, the carrier chips — needs the whole step redrawn. */
  function patchPointList() {
    var box = document.getElementById("pointlist");
    if (!box) return;
    box.innerHTML = pointRows();
    translateTree(box);
  }
  function pointsArrived() {
    if (S.screen !== "checkout") return;
    if (S.pointOpen) patchPointList();
    else render();
  }
  /** A bottom sheet on a phone, a centred panel on a desktop. */
  function pointSheet() {
    return '<div class="scrim" data-pointclose></div>' +
      '<aside class="psheet" role="dialog" aria-modal="true" aria-label="Выбор пакомата">' +
        '<div class="psheet__head"><span class="display drawer__t">' + carrierLabel() + "</span>" +
          '<button class="iconbtn" data-pointclose aria-label="Закрыть">✕</button></div>' +
        '<div class="psheet__search"><input class="input input--box" data-pointq value="' + esc(POINTS.q) +
          '" placeholder="Город, улица или название" aria-label="Поиск пакомата" autocomplete="off">' +
          (pointsList() ? '<div class="psheet__n muted">' + points(pointsList().length) + "</div>" : "") + "</div>" +
        '<div class="psheet__list" id="pointlist">' + pointRows() + "</div>" +
      "</aside>";
  }

  /* ---------- placing the order ----------
     Two calls. /api/orders re-prices the basket on the server — the browser's
     numbers are never trusted — and /api/payments/create turns that order into
     a payment; then the browser leaves for the bank. With no API behind the
     page (the prototype is also served statically for Renat) the same button
     finishes the demo exactly as it always did. */
  function lineVariant(l) {
    if (l.size === undefined || l.size === null) return null;
    for (var i = 0; i < CATALOGUE.length; i++) {
      if (CATALOGUE[i].id === l.id) {
        return CATALOGUE[i].prices && CATALOGUE[i].prices.length > 1 ? l.size : null;
      }
    }
    return null;
  }
  function orderPayload() {
    return {
      lang: S.lang,
      items: S.cart.map(function (l) { return { id: l.id, variant: lineVariant(l), qty: l.qty }; }),
      customer: { name: S.ship.name, email: S.email, phone: S.ship.phone },
      shipping: {
        method: shipMethod(),
        country: S.country,
        carrier: isParcel() ? shipCarrier() : "",
        pointId: S.ship.point ? S.ship.point.id : null,
        pointName: S.ship.point ? S.ship.point.name : null,
        address: shipMethod() === "courier"
          ? { addr: S.ship.addr, zip: S.ship.zip, city: S.ship.city }
          : null
      },
      discountCode: S.promoOk && S.promo ? S.promo : null
    };
  }
  /* Bank codes for Montonio's `preferredProvider`. ASSUMPTION: these are the
     banks' BICs, which is what the codes look like in Montonio's docs — the
     authoritative list is GET /stores/payment-methods and must be checked in
     sandbox before go-live (docs/payments.md). A wrong or missing code is not
     fatal: Montonio then simply asks the shopper to pick the bank itself. */
  var BANK_CODES = {
    Swedbank: "HABAEE2X", SEB: "EEUHEE2X", LHV: "LHVBEE22",
    Luminor: "RIKOEE22", Coop: "EKRDEE22"
  };
  /**
   * POST JSON and say plainly whether there is an API behind this page at all.
   * `offline` means "no server here" (a static host answers 404/HTML); a real
   * error from a real API comes back as a body with ok:false.
   */
  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 404 || r.status === 405 || r.status === 501) return { offline: true };
      return r.json().then(function (j) { return { body: j, status: r.status }; },
        function () { return { offline: true }; });
    }, function () { return { offline: true }; });
  }
  var ORDER_ERRS = {
    empty_order: "Корзина пуста",
    rate_limited: "Слишком много попыток — подождите минуту",
    bad_email: "Проверьте e-mail",
    out_of_stock: "Товара не хватает на складе",
    db_unavailable: "Магазин временно недоступен — попробуйте позже"
  };
  function orderErrText(code) {
    return ORDER_ERRS[code] || "Не получилось оформить заказ — попробуйте ещё раз";
  }
  /** A finished order must leave nothing behind for the next one. */
  function clearOrderState() {
    S.cart = []; S.promo = ""; S.promoOk = false; S.promoErr = false; S.sumOpen = null;
    S.giftCard = null; S.giftErr = "";   // features: a card applied here is spent
    S.ship = { name: "", addr: "", zip: "", city: "", phone: "", method: shipMethod(), carrier: S.ship.carrier, point: null };
    S.emailTouched = false; S.shipTouched = false; S.coStep = 1;
    persist();
  }
  function finishDemo() {
    apiSeen(false);
    S.paying = false;
    clearOrderState();
    S.done = { demo: true };
    go("done");
  }
  function payNow() {
    S.emailTouched = true; S.shipTouched = true;
    /* Send the shopper to the step that is short, with the fields marked,
       rather than refusing with a toast and leaving them to hunt. */
    if (emailBad()) { return failStep(1, "Проверьте e-mail — на него придёт подтверждение заказа"); }
    if (shipMissing().length) { return failStep(2, "Заполните данные доставки"); }
    if (pointMissing()) { return failStep(2, "Выберите пакомат"); }
    if (S.pay === 3 && !S.invoiceCo.trim()) { return failStep(3, "Укажите фирму и регистрационный номер"); }
    if (!S.cart.length) { toast("Корзина пуста"); return; }
    if (S.paying) return;
    if (API.ok === false) return finishDemo();

    S.paying = true; render();
    postJSON("/api/orders/", orderPayload()).then(function (res) {
      if (res.offline) return finishDemo();
      apiSeen(true);
      if (!res.body || !res.body.ok || !res.body.orderId) {
        throw new Error(orderErrText(res.body && res.body.error));
      }
      return postJSON("/api/payments/create/", {
        orderId: res.body.orderId,
        method: PAYS[S.pay] && PAYS[S.pay].k === "card" ? "card" : "bank",
        bank: S.pay === 0 ? BANK_CODES[BANKS[S.bank]] : undefined,
        lang: S.lang
      }).then(function (pay) {
        if (pay.offline) return finishDemo();
        if (!pay.body || !pay.body.ok || !pay.body.redirectUrl) {
          throw new Error("Оплата пока недоступна — попробуйте позже");
        }
        // the basket is cleared before leaving: coming back from the bank must
        // not find the same order still sitting in the cart
        clearOrderState();
        location.href = pay.body.redirectUrl;
      });
    }).catch(function (err) {
      S.paying = false; render();
      toast(err && err.message ? err.message : "Не получилось оформить заказ");
    });
  }

  function screenCheckout() {
    var step = S.coStep;
    // The rules and the machine list are wanted the moment the shopper lands
    // here; both are one-shot and both fail quietly.
    loadShipRules();
    if (isParcel()) loadPoints();
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
            coHead(2, "Доставка", shipMethodLabel() + (S.ship.point ? " · " + esc(S.ship.point.name) : S.ship.name ? " · " + esc(S.ship.name) : "")) +
            (step === 2 ? '<div class="costep__body">' +
              '<label class="field"><span class="field__label">Страна</span><span class="sel sel--box"><select data-country>' +
                COUNTRIES.map(function (c) { return '<option value="' + c[0] + '"' + (S.country === c[0] ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + "</select></span></label>" +
              deliveryPicker() +
              (shipMethod() === "pickup" ? '<div class="hint">Забрать бесплатно на Mardi 1. Нужен документ. Заказ ждёт 7 дней, дальше 1,50 € в день.</div>' : "") +
              '<div class="hint">' + (freeShip() ? "Бесплатная доставка применена ✓" : threshold() === Infinity ? "" : "Бесплатная доставка от " + threshold() + " € — не хватает " + eur(threshold() - cartSum())) + "</div>" +
              // every field is bound to S.ship — a render (promo, blur, resize)
              // used to wipe whatever the shopper had typed here
              (shipMethod() === "pickup" ? "" :
                shipField("name", "Имя и фамилия", "Имя Фамилия", "name", "") +
                (isParcel() ? "" : shipField("addr", "Адрес", "улица, дом", "street-address", "") +
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
            // features: a line can be a product, a set or a gift card
            return '<div class="cosum__line"><span class="cosum__ph">' + lineImageHTML(l) + "</span>" +
              '<span class="cosum__nm">' + esc(lineTitle(l)) + lineLabel(l) + " × " + l.qty +
                ' <button class="link cosum__rm" data-remove="' + S.cart.indexOf(l) + '" aria-label="Убрать из заказа">Убрать</button>' +
                lineNoteHTML(l) + "</span>" +
              '<span class="num cosum__pr">' + eur(lineUnit(l) * l.qty) + "</span></div>";
          }).join("") : '<p class="muted">Корзина пуста.</p>') +
          '<div class="cosum__promo"><input class="input input--box" data-promo aria-label="Промокод или подарочная карта" placeholder="Промокод или подарочная карта" value="' + esc(S.promo) + '"><button class="btn btn--ghost btn--sm" data-applypromo>Применить</button></div>' +
          (S.promoErr ? '<div class="err" role="alert">Код не найден — проверьте написание.</div>' : "") +
          (S.promoOk ? '<div class="cosum__row"><span>REMPIRE10 — скидка 10%</span><span class="num">−' + eur(discount()) + "</span></div>" : "") +
          /* ---- features: gift card ------------------------------------------
             Owned by the features agent. The same input above accepts a card
             code (RMP-XXXX-XXXX); the applypromo handler recognises the shape
             and calls POST /api/giftcards/check/. Everything the card adds to
             this screen is the two lines below plus giftDiscount() in total().
             ------------------------------------------------------------------ */
          (S.giftErr ? '<div class="err" role="alert">' + esc(S.giftErr) + "</div>" : "") +
          (S.giftCard
            ? '<div class="cosum__row"><span>Подарочная карта ' + esc(S.giftCard.code) +
                ' <button class="link" data-giftoff>убрать</button></span>' +
                '<span class="num">−' + eur(giftDiscount()) + "</span></div>" +
              (S.giftCard.balance - giftDiscount() > 0.004
                ? '<div class="cosum__row cosum__row--note"><span class="muted">Останется на карте</span>' +
                  '<span class="num muted">' + eur(S.giftCard.balance - giftDiscount()) + "</span></div>"
                : "")
            : "") +
          /* ---- /features ---------------------------------------------------- */
          '<div class="cosum__row cosum__row--rule"><span>Доставка — ' + shipMethodLabel() + '</span><span class="num">' + (shipCost() ? eur(shipCost()) : "Бесплатно") + "</span></div>" +
          '<div class="cosum__row cosum__row--tot"><span>Итого</span><span class="num">' + eur(total()) + "</span></div>" +
          /* Both pay buttons wait for the payment step. Offered from step one
             they compete with «Далее» for the same tap and invite a shopper to
             pay before choosing how the parcel travels or how they are paying. */
          (step === 3
            ? '<button class="btn btn--wide co__pay" data-pay' + (S.paying ? " disabled" : "") + ">" +
                (S.paying ? "Готовим оплату…" : "Оплатить " + eur(total())) + "</button>" +
              '<p class="cosum__legal">Нажимая «Оплатить», вы соглашаетесь с условиями и политикой возврата.</p>'
            : "") +
          "</div></details></div>" +

      "</div></div>" +
      (step === 3
        ? '<div class="stickybar"><span class="stickybar__tot"><span>Итого</span><span class="num">' + eur(total()) + '</span></span>' +
          '<button class="btn" data-pay' + (S.paying ? " disabled" : "") + ">" + (S.paying ? "Готовим…" : "Оплатить") + "</button></div>"
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
    ["reviews", "Отзывы", "check"],   // features
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
  /* The panel asks for the password as soon as there is a server to ask. On
     the static prototype — no API behind it — this never appears and the demo
     panel opens exactly as it always did. */
  function admHeader() {
    return '<div class="cohdr cohdr--adm"><div class="cohdr__row">' +
      '<button class="hdr__logo" data-go="home" data-ident aria-label="REMPIRE — в магазин">' + tower("hdr__tower") + '<span class="hdr__word">Rempire</span></button>' +
      '<span class="cohdr__t">Админка</span>' +
      '<span class="cohdr__langs" role="group" aria-label="Язык"> ' + LANGS.map(function (l) {
        return '<button class="cohdr__lang" data-lang="' + l[0] + '" aria-current="' + (S.lang === l[0]) + '">' + l[0] + "</button>";
      }).join("") + "</span>" +
      '<button class="link" data-go="home">← В магазин</button></div></div>';
  }
  function admWaitScreen() {
    return admHeader() +
      '<div class="adm adm--navmin adm--aimin"><main class="adm__main">' +
        '<p class="muted" style="margin:28px 0">Проверяем…</p></main></div>';
  }
  function admLoginScreen() {
    return admHeader() +
      '<div class="adm adm--navmin adm--aimin"><main class="adm__main">' +
        '<div class="adm__list" style="max-width:420px;margin:28px auto;padding:18px 16px">' +
          '<div class="sec__head sec__head--sub"><h2 class="sec__title">Вход в админку</h2></div>' +
          '<p class="muted" style="margin:0 0 12px;font-size:13px">Пароль владельца. Магазин работает и без входа — здесь только управление.</p>' +
          '<label class="field"><span class="field__label">Пароль</span>' +
            '<input class="input" type="password" data-admpw autocomplete="current-password" aria-invalid="' + (SRV.err ? "true" : "false") + '"></label>' +
          (SRV.err ? '<div class="err" role="alert">' + esc(SRV.err) + "</div>" : "") +
          '<div class="adm__acts"><button class="btn" data-admlogin' + (SRV.busy ? " disabled" : "") + ">" +
            (SRV.busy ? "Проверяем…" : "Войти") + "</button></div>" +
        "</div></main></div>";
  }

  function screenAdmin() {
    probeAdmAI();
    probeAdmin();
    if (SRV.on && SRV.admin === null) return admWaitScreen();
    if (SRV.on && SRV.admin === false) return admLoginScreen();
    // real orders when the owner is signed in and the shop has some; the demo
    // set otherwise, so the panel is never an empty room
    var live = SRV.admin === true && SRV.orders && SRV.orders.length ? SRV.orders : null;
    var orders = live || fakeOrders();
    var week = orders.slice(0, 7).reduce(function (a, o) { return a + o.sum; }, 0);
    var tab = S.adminTab;
    // the admin header shares the full-width panes' column, not the 1020px
    // checkout column — otherwise the logo aligns with nothing below it
    return '<div class="cohdr cohdr--adm"><div class="cohdr__row">' +
        '<button class="hdr__logo" data-go="home" data-ident aria-label="REMPIRE — в магазин">' + tower("hdr__tower") + '<span class="hdr__word">Rempire</span></button>' +
        '<span class="cohdr__t">Админка</span>' +
        '<span class="cohdr__langs" role="group" aria-label="Язык"> ' + LANGS.map(function (l) {
          return '<button class="cohdr__lang" data-lang="' + l[0] + '" aria-current="' + (S.lang === l[0]) + '">' + l[0] + "</button>";
        }).join("") + "</span>" +
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
          '<span class="adm__sub">Rempire Store OÜ · владелец</span>' +
          (SRV.admin === true ? '<button class="link" data-admlogout>Выйти</button>' : "") +
        "</div></aside>" +

      '<main class="adm__main">' +
      '<div class="adm__note">' + (live
        ? "Заказы — настоящие, с сервера. Клиенты и аналитика пока демонстрационные."
        : "Демонстрация. Заказы, клиенты и цифры вымышленные, товары — настоящие, из вашего каталога.") + "</div>" +

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
        (S.adminOrder
          ? admOrderDetail(orders)
          : '<p class="muted" style="margin:16px 0">Нажмите на заказ — адрес, состав, оплата, наклейка на посылку и письмо клиенту, всё на одной странице.</p>' +
            (SRV.admin === true && SRV.ordersErr ? '<div class="adm__note">Сервер заказов не отвечает — показан демонстрационный список.</div>' : "") +
            orderTable(orders)) : "") +

      (tab === "goods" ?
        (S.adminEdit
          ? goodsEditor(byId(S.adminEdit))
          : '<p class="muted" style="margin:16px 0">Цены, остатки и тексты правятся прямо здесь. Штрихкод со сканера ищет товар за секунду — приход и списание без ручного ввода.</p>' +
            '<input class="input input--box" data-goodsq value="' + esc(S.goodsQ || "") + '" placeholder="Найти товар: название, бренд…" aria-label="Поиск по товарам" style="margin-bottom:12px;max-width:420px">' +
            '<div class="adm__list" id="goodslist">' + goodsRows() + "</div>") : "") +

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

      // features: review moderation
      (tab === "reviews" ? admReviewsHTML() : "") +

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
        '<p class="muted" style="margin:16px 0">Письма, которые магазин шлёт сам. Кнопки работают: настройка сохраняется (демо) и попадает в журнал. Текст письма можно менять через помощника.</p>' +
        '<div class="adm__list">' +
        [["Заказ принят", "сразу после оплаты — номер заказа и состав"],
         ["Заказ отправлен", "трек-номер и кнопка отслеживания"]].map(function (f) {
          return '<div class="adm__row"><span class="adm__nm">' + f[0] + '<span class="adm__sub">' + f[1] + "</span></span>" +
            '<span class="chip chip--ok">всегда включено</span></div>';
        }).join("") +
        [["backstock", "Товар снова в наличии", "тем, кто оставил почту на странице товара"],
         ["abandoned", "Брошенная корзина", "напоминание через 24 часа, если заказ не завершён"],
         ["birthday", "Скидка ко дню рождения", "личный промокод за 3 дня до даты"]].map(function (f) {
          var on = !!DEMO.flows[f[0]];
          return '<div class="adm__row"><span class="adm__nm">' + f[1] + '<span class="adm__sub">' + f[2] + "</span></span>" +
            '<span class="chip ' + (on ? "chip--ok" : "chip--low") + '">' + (on ? "включено" : "выключено") + "</span>" +
            '<button class="link" data-admflow="' + f[0] + '">' + (on ? "Выключить" : "Включить") + "</button></div>";
        }).join("") + "</div>" +
        mailCard() +
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
        '<div class="sec__head sec__head--sub"><h2 class="sec__title">Магазин</h2></div>' +
        '<div class="adm__list"><div class="adm__row"><span class="adm__nm">ИИ-чат для покупателей' +
          '<span class="adm__sub">кружок-консультант в углу магазина — подбирает товары и собирает корзину</span></span>' +
          '<span class="chip ' + (DEMO.chatbot ? "chip--ok" : "chip--low") + '">' + (DEMO.chatbot ? "включён" : "выключен") + "</span>" +
          '<button class="link" data-admchatbot>' + (DEMO.chatbot ? "Выключить" : "Включить") + "</button></div>" +
          '<div class="adm__row"><span class="adm__nm">Наборы на сайте' +
          '<span class="adm__sub">готовые комплекты со скидкой 12 % — в меню, на главной и в каталоге; пока не согласовано с владельцем</span></span>' +
          '<span class="chip ' + (DEMO.bundles !== false ? "chip--ok" : "chip--low") + '">' + (DEMO.bundles !== false ? "показаны" : "скрыты") + "</span>" +
          '<button class="link" data-admbundles>' + (DEMO.bundles !== false ? "Скрыть" : "Показать") + "</button></div></div>" +
        admHeroCard() +
        setupBlock("Реквизиты", [
          "Rempire Store OÜ · рег. 12216136", "KMKR EE102723858", "Mardi 1, 10145 Таллинн"
        ]) +
        '<div class="sec__head sec__head--sub"><h2 class="sec__title">Журнал изменений</h2></div>' +
        (DEMO.log.length
          ? '<div class="adm__list">' + DEMO.log.map(function (e, i) {
              return '<div class="adm__row"><span class="adm__nm">' + esc(e.txt) +
                '<span class="adm__sub">' + esc(e.t) + " · помощник/панель</span></span>" +
                '<button class="link" data-admundo="' + i + '">Отменить</button></div>';
            }).join("") + "</div>"
          : '<p class="muted">Пока пусто. Изменения через помощника и кнопки панели попадут сюда — каждое можно отменить.</p>') : "") +
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
              '<div class="adm__a" data-aians>' + (admAI ? "…" : adminAnswer(S.adminAsk)) + "</div>"
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
        '<div class="adm__aifoot"><input class="input input--box" data-admq placeholder="Спросить…" aria-label="Вопрос помощнику">' +
          '<button class="btn btn--sm" data-admsend aria-label="Спросить">→</button></div>' +
      "</aside></div>";
  }
  /* ---------- «Письма»: preview + test send -----------------------------
     The five real templates live in src/emails and are rendered server-side;
     this card is the window onto them. The letter's language is its own
     setting — Renat reads the panel in Russian but has to be able to check
     what an Estonian customer receives. */
  var MAIL_TPL = [
    ["order-confirmed", "Заказ принят"],
    ["order-shipped", "Заказ отправлен"],
    ["abandoned-cart", "Брошенная корзина"],
    ["back-in-stock", "Товар снова в наличии"],
    ["birthday", "Скидка ко дню рождения"]
  ];
  function mailTpl() {
    for (var i = 0; i < MAIL_TPL.length; i++) if (MAIL_TPL[i][0] === S.mailTpl) return S.mailTpl;
    return MAIL_TPL[0][0];
  }
  function mailLang() { return S.mailLang || S.lang; }
  /* Keep whatever is half-typed in the address box: every chip re-renders the
     panel, and losing the address after each click made the button unusable. */
  function keepMailTo() {
    var el = document.querySelector("[data-mailto]");
    if (el) S.mailTo = el.value;
  }
  function mailCard() {
    var tpl = mailTpl(), lang = mailLang();
    return '<div class="sec__head sec__head--sub"><h2 class="sec__title">Письма — предпросмотр и тест</h2></div>' +
      '<p class="muted" style="margin:0 0 12px">Выберите письмо и язык — покажем его ровно таким, каким его получит покупатель. Ниже можно отправить образец себе на почту.</p>' +
      '<div class="adm__chips" role="group" aria-label="Письмо">' +
        MAIL_TPL.map(function (m) {
          return '<button class="scchip" data-mailtpl="' + m[0] + '" aria-current="' + (tpl === m[0]) + '">' + m[1] + "</button>";
        }).join("") + "</div>" +
      '<div class="adm__chips" role="group" aria-label="Язык письма">' +
        LANGS.map(function (l) {
          return '<button class="scchip" data-maillang="' + l[0] + '" aria-current="' + (lang === l[0]) + '">' + l[1] + "</button>";
        }).join("") + "</div>" +
      '<iframe title="Предпросмотр письма" loading="lazy" ' +
        'src="/api/admin/mail/preview/?template=' + encodeURIComponent(tpl) + "&amp;lang=" + encodeURIComponent(lang) + '" ' +
        'style="display:block;width:100%;height:520px;margin-top:14px;border:1px solid var(--rule);background:#fff"></iframe>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px">' +
        '<input class="input input--box" type="email" data-mailto value="' + esc(S.mailTo || "") + '" ' +
          'placeholder="Отправить тест на…" aria-label="Отправить тест на…" style="max-width:320px">' +
        '<button class="btn btn--sm" data-mailtest>Отправить тест</button></div>' +
      '<p class="muted" style="margin:8px 0 0;font-size:12.5px">В письме будут вымышленный заказ и товары — это образец вёрстки, не настоящий заказ.</p>';
  }

  /* ---------- «Главный баннер»: the owner's own banner editor --------------
     Everything is edited on a copy (S.heroDraft) and nothing reaches the shop
     until «Сохранить» — which goes through the same confirm card and the same
     undoable log as every other change, as one set_hero action carrying the
     whole banner. */
  var HERO_PAGES = [
    ["shipping", "Доставка и оплата"], ["returns", "Возврат товара"],
    ["terms", "Условия продажи"], ["contact", "Контакты"], ["privacy", "Конфиденциальность"]
  ];
  function heroDraft() {
    if (!S.heroDraft || !Array.isArray(S.heroDraft.slides)) {
      try { S.heroDraft = JSON.parse(JSON.stringify(heroConf())); }
      catch (e) { S.heroDraft = heroDefault(); }
    }
    return S.heroDraft;
  }
  /* The draft outlives a trip to another tab, so the card has to say when what
     it shows is not yet what the shop shows. */
  function heroDirty() {
    if (!S.heroDraft) return false;
    try { return JSON.stringify(heroClean(S.heroDraft)) !== JSON.stringify(heroClean(heroConf())); }
    catch (e) { return true; }
  }
  /* What actually gets saved: trimmed strings, no empty translations, sane
     interval. The server's own sanitiser is the strict one — this only keeps
     the stored object tidy. */
  function heroClean(d) {
    var out = { slides: [], interval: Math.max(2000, Math.min(30000, Number(d.interval) || HERO_TICK)) };
    (d.slides || []).slice(0, 5).forEach(function (s, i) {
      var o = {
        id: String(s.id || "s" + (i + 1)).slice(0, 24),
        go: String(s.go || "cat:all").slice(0, 80),
        image: String(s.image || "").slice(0, 300),
        on: s.on !== false
      };
      ["eyebrow", "title", "sub", "cta"].forEach(function (f) {
        var v = s[f] && typeof s[f] === "object" ? s[f] : {}, keep = {};
        ["RU", "ET", "EN"].forEach(function (l) {
          var txt = String(v[l] == null ? "" : v[l]).trim();
          if (txt) keep[l] = txt.slice(0, 200);
        });
        o[f] = keep;
      });
      out.slides.push(o);
    });
    return out;
  }
  function heroGoLabel(go) {
    var g = String(go || "");
    if (g.indexOf("cat:") === 0) return g === "cat:all" ? "Все товары" : (CAT_NAMES[g.slice(4)] || g.slice(4));
    if (g.indexOf("product:") === 0) {
      var p = heroProduct(g.slice(8));
      return p ? p.brand + " " + p.name : "Товар";
    }
    if (g.indexOf("page:") === 0) {
      for (var i = 0; i < HERO_PAGES.length; i++) if (HERO_PAGES[i][0] === g.slice(5)) return HERO_PAGES[i][1];
      return g.slice(5);
    }
    if (g === "bundles") return "Наборы";
    if (g === "gift") return "Подарочная карта";
    if (g === "brands") return "Бренды";
    return "Все товары";
  }
  /* Search shared by both pickers: eight matches, popular products when the
     box is empty, so the owner always has something to tap. */
  function heroFind(q) {
    var s = String(q || "").trim().toLowerCase();
    if (!s) return spread(8, false);
    return CATALOGUE.filter(function (p) {
      return (p.brand + " " + p.name).toLowerCase().indexOf(s) >= 0;
    }).slice(0, 8);
  }
  var HERO_NOHIT = '<p class="muted admhero__none">Ничего не нашлось — попробуйте другое слово.</p>';
  function heroImgRows() {
    var cur = heroDraft().slides[S.heroEdit] || {};
    var list = heroFind(S.heroImgQ);
    if (!list.length) return HERO_NOHIT;
    return list.map(function (p) {
      return '<button class="admhero__pick" data-heroimg="' + esc(p.id) + '" aria-current="' + (cur.image === p.id) +
        '" title="' + esc(p.brand + " " + p.name) + '">' + media(p, 0, "ph admhero__pickimg") +
        '<span class="admhero__pickn">' + esc(p.name) + "</span></button>";
    }).join("");
  }
  function heroGoRows() {
    var cur = heroDraft().slides[S.heroEdit] || {};
    var list = heroFind(S.heroGoQ);
    if (!list.length) return HERO_NOHIT;
    return list.map(function (p) {
      return '<button class="admhero__pick" data-herogopick="' + esc(p.id) + '" aria-current="' +
        (cur.go === "product:" + p.id) + '" title="' + esc(p.brand + " " + p.name) + '">' +
        media(p, 0, "ph admhero__pickimg") + '<span class="admhero__pickn">' + esc(p.name) + "</span></button>";
    }).join("");
  }
  function heroRowHTML(s, i, n) {
    var off = s.on === false;
    return '<div class="adm__row"><span class="adm__ph">' + heroArt(s.image, "ph") + "</span>" +
      '<span class="adm__nm">' + (esc(heroT(s.title)) || "Без заголовка") +
        '<span class="adm__sub">' + esc(heroGoLabel(s.go)) + "</span></span>" +
      '<span class="chip ' + (off ? "chip--low" : "chip--ok") + '">' + (off ? "скрыт" : "показан") + "</span>" +
      '<span class="admhero__ops">' +
        '<button class="iconbtn" data-heromove="' + i + ':-1"' + (i === 0 ? " disabled" : "") + ' aria-label="Выше">↑</button>' +
        '<button class="iconbtn" data-heromove="' + i + ':1"' + (i === n - 1 ? " disabled" : "") + ' aria-label="Ниже">↓</button>' +
        '<button class="link" data-heroon="' + i + '">' + (off ? "Показать" : "Скрыть") + "</button>" +
        '<button class="link" data-heroedit="' + i + '">Изменить</button>' +
        '<button class="link" data-herodel="' + i + '">Удалить</button>' +
      "</span></div>";
  }
  function heroFieldHTML(s, key, label, tag, max) {
    var L = S.heroLang || "RU";
    var val = (s[key] && s[key][L]) || "";
    var ru = (s[key] && s[key].RU) || "";
    var hint = L !== "RU" && !val && ru ? '<span class="admhero__hint">Пусто — покажем русский текст.</span>' : "";
    return '<label class="field"><span class="field__label">' + label + "</span>" +
      (tag === "textarea"
        ? '<textarea class="input" rows="3" maxlength="' + max + '" data-herof="' + key + '">' + esc(val) + "</textarea>"
        : '<input class="input" maxlength="' + max + '" data-herof="' + key + '" value="' + esc(val) + '">') +
      hint + "</label>";
  }
  function heroFormHTML(i) {
    var s = heroDraft().slides[i];
    if (!s) return "";
    var L = S.heroLang || "RU";
    var go = String(s.go || "cat:all");
    var isProduct = go.indexOf("product:") === 0;
    var sel = isProduct ? "product" : go;
    var opt = function (v, label) {
      return '<option value="' + esc(v) + '"' + (sel === v ? " selected" : "") + ">" + esc(label) + "</option>";
    };
    return '<div class="admhero__form">' +
      '<div class="adm__chips" role="group" aria-label="Язык баннера">' + LANGS.map(function (l) {
        return '<button class="scchip" data-herolang="' + l[0] + '" aria-current="' + (L === l[0]) + '">' + l[1] + "</button>";
      }).join("") + "</div>" +
      heroFieldHTML(s, "eyebrow", "Строка сверху", "input", 40) +
      heroFieldHTML(s, "title", "Заголовок", "input", 40) +
      heroFieldHTML(s, "sub", "Подзаголовок", "textarea", 90) +
      heroFieldHTML(s, "cta", "Надпись на кнопке", "input", 24) +

      '<label class="field"><span class="field__label">Куда ведёт кнопка</span>' +
        '<select class="input" data-herogo>' +
          '<optgroup label="Разделы">' + opt("cat:all", "Все товары") +
            CATS.map(function (c) { return opt("cat:" + c.id, c.name); }).join("") + "</optgroup>" +
          '<optgroup label="Страницы магазина">' + opt("bundles", "Наборы") + opt("gift", "Подарочная карта") +
            opt("brands", "Бренды") + "</optgroup>" +
          '<optgroup label="Информация">' + HERO_PAGES.map(function (p) { return opt("page:" + p[0], p[1]); }).join("") + "</optgroup>" +
          '<optgroup label="Один товар">' + opt("product", "Товар — выберите ниже") + "</optgroup>" +
        "</select></label>" +
      (isProduct
        ? '<p class="muted admhero__note">Кнопка ведёт на: ' + esc(heroGoLabel(go)) + "</p>" +
          '<input class="input input--box" data-heroq value="' + esc(S.heroGoQ || "") +
            '" placeholder="Найти товар: название, бренд…" aria-label="Найти товар">' +
          '<div class="admhero__picks" id="herogolist">' + heroGoRows() + "</div>"
        : "") +

      '<div class="field__label admhero__lbl">Картинка</div>' +
      '<label class="field"><span class="field__label">Ссылка на картинку — или выберите фото товара ниже</span>' +
        '<input class="input" data-heroimgurl value="' + esc(heroUrl(s.image)) +
        '" placeholder="https://… или /shop/img/…"></label>' +
      '<input class="input input--box" data-heroimgq value="' + esc(S.heroImgQ || "") +
        '" placeholder="Найти товар: название, бренд…" aria-label="Найти фото товара">' +
      '<div class="admhero__picks" id="heroimglist">' + heroImgRows() + "</div>" +

      '<div class="field__label admhero__lbl">Предпросмотр</div>' +
      '<div class="admhero__prev" id="heroprev"><section class="hero">' + heroSlideHTML(s, 0, 0, true) + "</section></div>" +
      '<div class="adm__acts"><button class="btn btn--sm" data-heroclose>Готово</button></div>' +
    "</div>";
  }
  function admHeroCard() {
    var d = heroDraft(), n = d.slides.length;
    var pending = pendingAction && pendingAction.type === "set_hero" ? confirmCard(pendingAction) : "";
    return '<div class="sec__head sec__head--sub"><h2 class="sec__title">Главный баннер</h2></div>' +
      '<p class="muted admhero__intro">Большая картинка на главной. Слайды показываются по кругу; один слайд — просто картинка без стрелок. Тексты — на трёх языках: пустой эстонский или английский заменяем русским.</p>' +
      pending +
      (heroDirty() && !pending ? '<p class="admhero__dirty">Есть несохранённые изменения — нажмите «Сохранить».</p>' : "") +
      (n ? '<div class="adm__list">' + d.slides.map(function (s, i) { return heroRowHTML(s, i, n); }).join("") + "</div>"
         : '<p class="muted">Слайдов нет — баннер на главной не показывается.</p>') +
      (S.heroEdit >= 0 && S.heroEdit < n ? heroFormHTML(S.heroEdit) : "") +
      '<label class="field admhero__tick"><span class="field__label">Смена слайдов, секунд</span>' +
        '<input class="input" type="number" min="2" max="30" step="1" data-herotick value="' +
        Math.round(heroInterval() / 1000) + '"></label>' +
      '<div class="adm__acts">' +
        '<button class="btn btn--ghost btn--sm" data-heroadd' + (n >= 5 ? " disabled" : "") + ">Добавить слайд</button>" +
        '<button class="btn btn--sm" data-herosave>Сохранить</button>' +
        '<button class="btn btn--ghost btn--sm" data-heroreset>Сбросить к стандартному</button></div>';
  }
  /* Typing must not cost the caret, so the two moving parts of the form are
     repainted on their own instead of through render(). */
  function paintHeroPreview() {
    var box = document.getElementById("heroprev");
    var s = heroDraft().slides[S.heroEdit];
    if (!box || !s) return;
    box.innerHTML = '<section class="hero">' + heroSlideHTML(s, 0, 0, true) + "</section>";
    translateTree(box);
  }
  function paintHeroPicks(id, html) {
    var box = document.getElementById(id);
    if (!box) return;
    box.innerHTML = html;
    translateTree(box);
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
        return '<button class="adm__tr adm__tr--link" role="row" data-admorder="' + esc(o.id) + '"><span class="num">' +
          (o.number ? esc(o.number) : "#" + o.id) + '<span class="adm__sub">' + o.date + "</span></span>" +
          "<span>" + esc(o.who) + '<span class="adm__sub">' + o.items + " " + plural(o.items) + "</span></span>" +
          '<span class="adm__ship">' + o.ship + "</span>" +
          '<span class="num">' + eur(o.sum) + "</span>" +
          '<span><span class="chip" style="color:var(' + o.state[2] + ')">' + o.state[1] + "</span></span></button>";
      }).join("") + "</div>";
  }

  /* Demo rows and real rows share the table, so the drill-down picks the right
     renderer instead of the table having to know which it is holding. */
  function admOrderDetail(list) {
    var o = list.filter(function (x) { return String(x.id) === String(S.adminOrder); })[0] || list[0];
    if (!o) return "";
    return o.srv ? orderDetailSrv(o) : orderDetail(o);
  }
  function srvAddrLine(s) {
    if (!s) return "";
    if (s.pointName) return s.pointName;
    var a = s.address || {};
    return [a.addr || a.street || "", a.zip || "", a.city || "", s.country || ""].filter(Boolean).join(", ");
  }
  /* A real order, drawn from what the server actually stored: the lines it
     priced itself, the address it was given, and the status the owner moves. */
  function orderDetailSrv(row) {
    var o = row.srv, s = o.shipping || {};
    var paidish = o.status === "paid" || o.status === "shipped" || o.status === "refunded";
    var steps = [["Оформлен", true], ["Оплачен", paidish], ["Отправлен", o.status === "shipped"]];
    return '<button class="link" data-admorder="">← Все заказы</button>' +
      '<div class="adm__ohead"><h2 class="sec__title" style="font-size:20px">Заказ ' + esc(o.number) + "</h2>" +
        '<span class="chip" style="color:var(' + row.state[2] + ')">' + row.state[1] + "</span>" +
        '<span class="muted">' + row.date + "</span></div>" +
      '<div class="adm__ocols"><div>' +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Состав</h3></div>' +
        '<div class="adm__list">' + (o.items || []).map(function (l) {
          return '<div class="adm__row"><span class="adm__nm">' + esc((l.brand ? l.brand + " — " : "") + (l.title || l.id)) +
            '<span class="adm__sub">' + (l.variant ? esc(l.variant) + " · " : "") + l.qty + " шт × " + eur(l.price) + "</span></span>" +
            '<span class="num adm__pr">' + eur(l.sum) + "</span></div>";
        }).join("") +
        '<div class="adm__row"><span class="adm__nm">Доставка — ' + esc(row.ship) + '</span><span class="num adm__pr">' +
          (o.shippingPrice ? eur(o.shippingPrice) : "0 €") + "</span></div>" +
        (o.discount ? '<div class="adm__row"><span class="adm__nm">Скидка' + (o.discountCode ? " · " + esc(o.discountCode) : "") +
          '</span><span class="num adm__pr">−' + eur(o.discount) + "</span></div>" : "") +
        '<div class="adm__row"><span class="adm__nm"><b>Итого</b></span><span class="num adm__pr"><b>' + eur(o.total) + "</b></span></div></div>" +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Статус</h3></div>' +
        '<div class="adm__steps">' + steps.map(function (st) {
          return '<span class="adm__step' + (st[1] ? " is-done" : "") + '">' + (st[1] ? "✓ " : "") + st[0] + "</span>";
        }).join("") + "</div>" +
        '<div class="adm__acts">' + ["paid", "shipped", "cancelled", "refunded"].map(function (k) {
          return '<button class="btn btn--ghost btn--sm" data-admstatus="' + k + '"' + (o.status === k ? " disabled" : "") +
            ">" + SRV_STATES[k][1] + "</button>";
        }).join("") + "</div>" +
      "</div><div>" +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Покупатель</h3></div>' +
        '<div class="adm__list">' +
          '<div class="adm__row"><span class="adm__nm">' + esc(o.name || "—") +
            '<span class="adm__sub">' + esc(o.email || "") + (o.phone ? " · " + esc(o.phone) : "") + "</span></span></div>" +
          '<div class="adm__row"><span class="adm__nm">' + esc(row.ship) +
            '<span class="adm__sub">' + esc(srvAddrLine(s)) + "</span></span></div></div>" +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Заметка</h3></div>' +
        '<label class="field"><span class="field__label">Видна только вам</span>' +
          '<textarea class="input" data-admnote rows="3">' + esc(o.notes || "") + "</textarea></label>" +
        '<div class="adm__acts"><button class="btn btn--sm" data-admnotesave>Сохранить заметку</button></div>' +
      "</div></div>";
  }

  /* The rows above open. A demo where nothing opens reads as a mock-up;
     one real drill-down («вот как выглядит заказ») sells the whole admin. */
  function orderDetail(o) {
    var p1 = CATALOGUE[(o.id * 7 + 3) % CATALOGUE.length];
    var p2 = CATALOGUE[(o.id * 13 + 11) % CATALOGUE.length];
    var lines = [[p1, (o.id % 3) + 1], [p2, 1]];
    var goods = lines.reduce(function (s, l) { return s + l[0].price * l[1]; }, 0);
    var shipCostD = Math.max(0, Math.round((o.sum - goods) * 100) / 100);
    var steps = [["Оплачен", true], ["Собран", o.state[0] !== "new"],
      ["Передан в доставку", o.state[0] === "sent" || o.state[0] === "done"],
      ["Доставлен", o.state[0] === "done"]];
    return '<button class="link" data-admorder="">← Все заказы</button>' +
      '<div class="adm__ohead"><h2 class="sec__title" style="font-size:20px">Заказ #' + o.id + "</h2>" +
        '<span class="chip" style="color:var(' + o.state[2] + ')">' + o.state[1] + "</span>" +
        '<span class="muted">' + o.date + "</span></div>" +
      '<div class="adm__ocols">' +
      '<div>' +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Состав</h3></div>' +
        '<div class="adm__list">' + lines.map(function (l) {
          return '<div class="adm__row"><span class="adm__ph">' + media(l[0], 0, "ph") + "</span>" +
            '<span class="adm__nm">' + esc(l[0].brand) + " — " + esc(l[0].name) +
              '<span class="adm__sub">' + l[1] + " шт × " + eur(l[0].price) + "</span></span>" +
            '<span class="num adm__pr">' + eur(l[0].price * l[1]) + "</span></div>";
        }).join("") +
        '<div class="adm__row"><span class="adm__nm">Доставка — ' + o.ship + '</span><span class="num adm__pr">' + (shipCostD ? eur(shipCostD) : "0 €") + "</span></div>" +
        '<div class="adm__row"><span class="adm__nm"><b>Итого</b></span><span class="num adm__pr"><b>' + eur(o.sum) + "</b></span></div></div>" +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Статус</h3></div>' +
        '<div class="adm__steps">' + steps.map(function (s) {
          return '<span class="adm__step' + (s[1] ? " is-done" : "") + '">' + (s[1] ? "✓ " : "") + s[0] + "</span>";
        }).join("") + "</div>" +
      "</div>" +
      '<div>' +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Покупатель</h3></div>' +
        '<div class="adm__list">' +
          '<div class="adm__row"><span class="adm__nm">' + o.who + '<span class="adm__sub">customer@example.com · +372 5• ••• •••</span></span></div>' +
          '<div class="adm__row"><span class="adm__nm">' + o.ship + '<span class="adm__sub">' + (/Самовывоз/.test(o.ship) ? "Mardi 1, Таллинн" : "Пакомат: Kristiine keskus, Таллинн") + "</span></span></div></div>" +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Действия</h3></div>' +
        '<div class="adm__acts">' +
          '<button class="btn btn--sm" data-admedit>Напечатать наклейку</button>' +
          '<button class="btn btn--ghost btn--sm" data-admedit>Письмо с трек-номером</button>' +
          '<button class="btn btn--ghost btn--sm" data-admedit>Вернуть деньги</button></div>' +
        '<p class="muted" style="font-size:12.5px;margin-top:14px">Демо: в рабочей версии наклейка печатается через платёжного провайдера, письмо уходит само при смене статуса.</p>' +
      "</div></div>";
  }

  function goodsRows() {
    var q = (S.goodsQ || "").toLowerCase().trim();
    var list = q
      ? CATALOGUE.filter(function (p) { return (p.brand + " " + p.name + " " + p.id).toLowerCase().indexOf(q) >= 0; })
      : CATALOGUE;
    var shown = list.slice(0, 24);
    return shown.map(function (p) {
      return '<div class="adm__row"><span class="adm__ph">' + media(p, 0, "ph") + "</span>" +
        '<span class="adm__nm">' + esc(p.brand) + " — " + esc(p.name) +
          '<span class="adm__sub">' + CAT_NAMES[p.cat] + (p.sizes && p.sizes.length ? " · " + p.sizes.join(", ") : "") + "</span></span>" +
        '<span class="chip ' + (p.stock === "out" ? "chip--out" : p.stock === "low" ? "chip--low" : "chip--ok") + '">' +
          (p.stock === "out" ? "нет" : p.stock === "low" ? "мало" : "в наличии") + "</span>" +
        '<span class="num adm__pr">' + eur(p.price) + "</span>" +
        '<button class="link" data-admgoods="' + p.id + '">Править</button></div>';
    }).join("") +
    '<p class="muted" style="margin-top:16px;padding:0 2px">' +
      (list.length > 24 ? "Показаны первые 24 из " + list.length : list.length + " " + plural(list.length)) +
      (q ? " по запросу «" + esc(q) + "»" : "") + "</p>";
  }

  function goodsEditor(p) {
    var subs = SUBCATS[p.cat] || [];
    var curSub = DEMO.subcat[p.id] || "";
    var g = gal(p);
    var seoT = (p.seo && p.seo.t) || "";
    var seoD = (p.seo && p.seo.d) || "";
    return '<button class="link" data-admclose>← Все товары</button>' +
      '<div class="adm__ohead"><span class="adm__ph adm__ph--big">' + media(p, 0, "ph") + "</span>" +
        '<div><h2 class="sec__title" style="font-size:18px">' + esc(p.brand) + " — " + esc(p.name) + "</h2>" +
        '<button class="link" data-go-product="' + p.id + '" style="font-size:13px">Открыть в магазине →</button></div></div>' +

      '<div class="adm__ocols">' +
      '<div>' +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Основное</h3></div>' +
        '<label class="field"><span class="field__label">Цена, €</span><input class="input" data-edprice inputmode="decimal" value="' + p.price + '"></label>' +
        '<label class="field"><span class="field__label">Наличие</span><span class="sel sel--box"><select data-edstock>' +
          [["in", "в наличии"], ["low", "мало"], ["out", "нет в наличии"]].map(function (o) {
            return '<option value="' + o[0] + '"' + (p.stock === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
          }).join("") + "</select></span></label>" +
        '<label class="field"><span class="field__label">Раздел</span><span class="sel sel--box"><select disabled>' +
          CATS.map(function (c) { return "<option" + (c.id === p.cat ? " selected" : "") + ">" + c.name + "</option>"; }).join("") + "</select></span></label>" +
        (subs.length
          ? '<label class="field"><span class="field__label">Подкатегория</span><span class="sel sel--box"><select data-edsubcat>' +
            '<option value=""' + (curSub ? "" : " selected") + '>Авто — по названию</option>' +
            subs.map(function (s2) { return '<option value="' + s2.id + '"' + (curSub === s2.id ? " selected" : "") + ">" + s2.name + "</option>"; }).join("") +
            "</select></span></label>"
          : "") +
        (p.sizes && p.sizes.length > 1 && g.length > 1
          ? '<div class="sec__head sec__head--sub"><h3 class="sec__title">Фото по объёмам</h3></div>' +
            '<p class="muted" style="font-size:12.5px;margin:2px 0 8px">Какая фотография показывается для каждого объёма. Заполняется из данных магазина автоматически; здесь можно поправить вручную.</p>' +
            p.sizes.map(function (sz, si) {
              var cur = p.varImg && p.varImg.length > si ? p.varImg[si] : -1;
              return '<div class="adm__vrow" data-vrow="' + si + '"><span class="adm__vsz">' + esc(sz) + "</span>" +
                g.map(function (u, gi) {
                  return '<button class="adm__vthumb" data-vpick="' + si + ":" + gi + '" aria-current="' + (cur === gi) + '" style="background-image:url(\'' + u + '\')" aria-label="Фото ' + (gi + 1) + '"></button>';
                }).join("") + "</div>";
            }).join("")
          : "") +
      "</div>" +

      '<div>' +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">SEO для Google</h3></div>' +
        '<label class="field"><span class="field__label">Заголовок (до 60 знаков)</span><input class="input" data-edseot maxlength="70" value="' + esc(seoT) + '" placeholder="Kevin.Murphy … купить в Таллинне | Rempire"></label>' +
        '<label class="field"><span class="field__label">Описание (до 155 знаков)</span><textarea class="input" data-edseod rows="3" maxlength="170" placeholder="Короткое продающее описание для сниппета Google">' + esc(seoD) + "</textarea></label>" +
        '<button class="btn btn--ghost btn--sm" data-admseogen="' + p.id + '">Сгенерировать с ИИ</button>' +
        /* features: one optional video per product. Stored in the demo layer
           and sent to the server as product_overrides.video_url. */
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Видео</h3></div>' +
        '<label class="field"><span class="field__label">Видео (YouTube/Vimeo ссылка)</span>' +
        '<input class="input" data-edvideo value="' + esc((DEMO.video && DEMO.video[p.id]) || p.video || "") +
        '" placeholder="https://youtu.be/… или https://vimeo.com/…"></label>' +
        '<p class="muted" style="font-size:12.5px;margin:-4px 0 12px">Вставьте ссылку — на странице товара появится видео. Пусто — блока нет.</p>' +
        '<div class="sec__head sec__head--sub"><h3 class="sec__title">Описание</h3></div>' +
        '<label class="field"><span class="field__label">Русский — эстонский и английский пишутся сами</span>' +
        '<textarea class="input" rows="5">' + esc(stripTags((typeof CONTENT_RU !== "undefined" && CONTENT_RU[p.id]) || (typeof CONTENT !== "undefined" && CONTENT[p.id]) || "").slice(0, 400)) + "</textarea></label>" +
        '<div class="adm__acts"><button class="btn" data-admsavegoods="' + p.id + '">Сохранить</button>' +
        '<button class="btn btn--ghost btn--sm" data-admclose>Отмена</button></div>' +
        '<p class="muted" style="font-size:12.5px;margin-top:12px">Цена, наличие, подкатегория, фото по объёмам и SEO сохраняются по-настоящему (демо: видно и в магазине, отмена — в журнале). Загрузка нового фото — с рабочей версией: фон снимется и водяной знак добавится сам.</p>' +
      "</div></div>";
  }
  // the assistant's answers end with a button that OPENS the right tab —
  // «где это?» answered by taking the owner there, not by describing a path
  function aiGo(tab, label) {
    return '<div style="margin-top:10px"><button class="btn btn--ghost btn--sm" data-admtab="' + tab + '">' + label + " →</button></div>";
  }
  var TAB_LABEL = { over: "Открыть обзор", orders: "Открыть заказы", goods: "Открыть товары",
    people: "Открыть клиентов", reviews: "Открыть отзывы", stats: "Открыть аналитику", mail: "Открыть письма",
    apps: "Открыть подключения", setup: "Открыть настройки" };

  /* ---------- demo changes layer ------------------------------------------
     The assistant (and the panel's own buttons) really change things: price,
     stock, SEO, mail flows. Changes live in localStorage, are applied onto
     the catalogue at boot, show up in the storefront too (a price change is
     visible on the card, a SEO change in the tab title) and every one lands
     in an undoable log. The real backend later replaces the storage, not the
     UX. */
  var ADM_LS = "rempire-admin-demo";
  var DEMO = { price: {}, stock: {}, seo: {}, subcat: {}, varimg: {}, video: {}, chatbot: true, bundles: true,
    hero: null,   // null = the built-in banner (heroDefault())
    flows: { abandoned: false, birthday: false, backstock: true }, log: [] };
  try {
    var _dj = JSON.parse(localStorage.getItem(ADM_LS));
    if (_dj && typeof _dj === "object") {
      DEMO.price = _dj.price || {}; DEMO.stock = _dj.stock || {}; DEMO.seo = _dj.seo || {};
      DEMO.subcat = _dj.subcat || {}; DEMO.varimg = _dj.varimg || {};
      DEMO.video = _dj.video || {};   // features: product video links
      if (_dj.chatbot === false) DEMO.chatbot = false;
      if (_dj.bundles === false) DEMO.bundles = false;
      if (_dj.hero && typeof _dj.hero === "object" && Array.isArray(_dj.hero.slides)) DEMO.hero = _dj.hero;
      DEMO.flows = Object.assign(DEMO.flows, _dj.flows || {});
      DEMO.log = Array.isArray(_dj.log) ? _dj.log.slice(0, 40) : [];
    }
  } catch (e) {}
  function demoSave() { try { localStorage.setItem(ADM_LS, JSON.stringify(DEMO)); } catch (e) {} }
  /* The catalogue is patched in place, so its untouched values are kept aside
     once. Undoing a change — or losing an override the server no longer has —
     has to put the original price back, not merely stop overwriting it. */
  var BASE = CATALOGUE.map(function (p) {
    return { price: p.price, prices: p.prices ? p.prices.slice() : null,
      stock: p.stock, seo: p.seo, varImg: p.varImg ? p.varImg.slice() : null };
  });
  function applyDemoOverrides() {
    for (var i = 0; i < CATALOGUE.length; i++) {
      var p = CATALOGUE[i], b = BASE[i];
      p.price = b.price;
      if (b.prices) p.prices = b.prices.slice();
      p.stock = b.stock;
      p.seo = b.seo;
      if (b.varImg) p.varImg = b.varImg.slice();
      if (DEMO.price[p.id] != null) {
        p.price = DEMO.price[p.id];
        if (p.prices && p.prices.length) p.prices[0] = DEMO.price[p.id];
      }
      if (DEMO.stock[p.id]) p.stock = DEMO.stock[p.id];
      if (DEMO.seo[p.id]) p.seo = { t: DEMO.seo[p.id].t || "", d: DEMO.seo[p.id].d || "" };
      if (DEMO.varimg[p.id] && p.sizes && DEMO.varimg[p.id].length === p.sizes.length) p.varImg = DEMO.varimg[p.id].slice();
      if (DEMO.video && DEMO.video[p.id] != null) p.video = DEMO.video[p.id];   // features
    }
  }
  applyDemoOverrides();

  /* ---------- the real backend --------------------------------------------
     The prototype has to keep working with nothing behind it — a static folder,
     no database, changes in localStorage. So the API is *detected*, never
     assumed: anything that is not a JSON answer (a 404 page, an offline phone,
     the static export) leaves the old behaviour exactly as it was.

     When the API does answer, it wins: /api/overrides/ is read at boot and its
     prices, stock, SEO and settings replace the local copy, which stays behind
     as an offline cache. And when the owner is signed in, every change the
     panel applies is written through to the server as well — including undo,
     which re-sends the previous value. */
  var SRV = { on: false, admin: null, err: "", busy: false, orders: null, ordersErr: false };
  function noop() {}

  function apiJson(url, opts) {
    return fetch(url, opts || {}).then(function (res) {
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("json") < 0) throw new Error("no-api");
      return res.json().then(function (body) { return { status: res.status, body: body || {} }; });
    });
  }
  function apiSend(url, method, body) {
    return apiJson(url, {
      method: method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {})
    });
  }

  function adoptServer(j) {
    var ov = j.overrides || {};
    DEMO.price = {}; DEMO.stock = {}; DEMO.seo = {}; DEMO.subcat = {}; DEMO.varimg = {}; DEMO.video = {};
    Object.keys(ov).forEach(function (id) {
      var o = ov[id] || {};
      if (o.price != null) DEMO.price[id] = o.price;
      if (o.stock) DEMO.stock[id] = o.stock;
      if (o.seoTitle || o.seoDesc) DEMO.seo[id] = { t: o.seoTitle || "", d: o.seoDesc || "" };
      if (o.subcat) DEMO.subcat[id] = o.subcat;
      if (o.varImg) DEMO.varimg[id] = o.varImg;
      if (o.videoUrl) DEMO.video[id] = o.videoUrl;
    });
    var s = j.settings || {};
    if (typeof s.chatbot === "boolean") DEMO.chatbot = s.chatbot;
    if (typeof s.bundles === "boolean") DEMO.bundles = s.bundles;
    // the banner: null on the server means «стандартный», and it wins over the
    // local copy exactly like every other setting
    if (s.hero === null) DEMO.hero = null;
    else if (s.hero && typeof s.hero === "object" && Array.isArray(s.hero.slides)) DEMO.hero = s.hero;
    if (s.flows && typeof s.flows === "object") DEMO.flows = Object.assign(DEMO.flows, s.flows);
  }

  function loadServerOverrides() {
    return apiJson("/api/overrides/").then(function (r) {
      SRV.on = r.status !== 404;
      if (r.status !== 200 || r.body.ok !== true) return;
      adoptServer(r.body);
      demoSave();
      applyDemoOverrides();
      render();
    }).catch(noop);
  }

  function checkAdmin() {
    return apiJson("/api/admin/me/").then(function (r) {
      SRV.on = true;
      SRV.admin = r.status === 200 && r.body.ok === true;
      return SRV.admin;
    }).catch(function () { SRV.admin = null; return null; });
  }

  /* One place where an applied change becomes a server write. Undo passes the
     previous action through the same door, so the server ends up holding what
     the panel shows. set_video is written by the features layer itself. */
  function srvPush(a) {
    if (!SRV.admin || !a) return;
    var ov = "/api/admin/overrides/", st = "/api/admin/settings/";
    if (a.type === "set_price") apiSend(ov, "PUT", { id: a.id, price: a.value }).catch(noop);
    else if (a.type === "set_stock") apiSend(ov, "PUT", { id: a.id, stock: a.value }).catch(noop);
    else if (a.type === "set_seo") apiSend(ov, "PUT", { id: a.id, seoTitle: a.title || "", seoDesc: a.description || "" }).catch(noop);
    else if (a.type === "set_subcat") apiSend(ov, "PUT", { id: a.id, subcat: a.value || null }).catch(noop);
    else if (a.type === "set_varimg") apiSend(ov, "PUT", { id: a.id, varImg: a.map }).catch(noop);
    else if (a.type === "toggle_flow") apiSend(st, "PUT", { flows: DEMO.flows }).catch(noop);
    else if (a.type === "toggle_chatbot") apiSend(st, "PUT", { chatbot: DEMO.chatbot }).catch(noop);
    else if (a.type === "toggle_bundles") apiSend(st, "PUT", { bundles: DEMO.bundles }).catch(noop);
    else if (a.type === "set_hero") apiSend(st, "PUT", { hero: DEMO.hero }).catch(noop);
  }

  function admLogin(pw) {
    if (!pw) { SRV.err = "Введите пароль"; render(); return; }
    SRV.busy = true; SRV.err = ""; render();
    apiSend("/api/admin/login/", "POST", { password: pw }).then(function (r) {
      SRV.busy = false;
      if (r.status === 200 && r.body.ok) {
        SRV.admin = true; SRV.err = "";
        loadSrvOrders(true);
      } else if (r.status === 429) SRV.err = "Слишком много попыток — подождите минуту.";
      else if (r.body.error === "not_configured") SRV.err = "Пароль ещё не настроен на сервере.";
      else SRV.err = "Неверный пароль";
      render();
      if (!SRV.admin) refocus("[data-admpw]");
    }).catch(function () {
      SRV.busy = false; SRV.err = "Сервер не отвечает"; render();
    });
  }

  function admLogout() {
    apiSend("/api/admin/logout/", "POST", {}).catch(noop).then(function () {
      SRV.admin = false; SRV.orders = null; S.adminOrder = 0; render();
    });
  }

  /* Real orders, drawn by the same table as the demo ones. */
  var SRV_STATES = {
    new: ["new", "новый", "--error"],
    paid: ["paid", "оплачен", "--ok"],
    failed: ["failed", "не оплачен", "--error"],
    shipped: ["shipped", "отправлен", "--muted"],
    cancelled: ["cancelled", "отменён", "--muted"],
    refunded: ["refunded", "возврат", "--muted"]
  };
  var SHIP_WORD = { parcel: "Пакомат", courier: "Курьер", pickup: "Самовывоз" };
  function srvShipLabel(s) {
    if (!s) return "—";
    var m = SHIP_WORD[String(s.method || "").toLowerCase()] || s.method || "Доставка";
    return s.pointName ? m + " · " + s.pointName : m;
  }
  function srvRow(o) {
    var n = 0;
    (o.items || []).forEach(function (l) { n += Number(l.qty) || 0; });
    return {
      id: o.id, number: o.number,
      date: String(o.createdAt || "").slice(0, 10).split("-").reverse().join("."),
      who: o.name || o.email || "—", items: n, sum: o.total,
      ship: srvShipLabel(o.shipping), state: SRV_STATES[o.status] || SRV_STATES.new, srv: o
    };
  }
  function loadSrvOrders(force) {
    if (!SRV.admin || (SRV.orders && !force)) return;
    apiJson("/api/admin/orders/?limit=100").then(function (r) {
      if (r.status === 401) { SRV.admin = false; SRV.orders = null; render(); return; }
      SRV.ordersErr = !(r.status === 200 && r.body.ok === true);
      SRV.orders = SRV.ordersErr ? null : (r.body.orders || []).map(srvRow);
      render();
    }).catch(function () { SRV.ordersErr = true; render(); });
  }
  function srvOrderPatch(id, patch) {
    apiSend("/api/admin/orders/" + encodeURIComponent(id) + "/", "PATCH", patch).then(function (r) {
      if (r.status === 200 && r.body.ok) { toast("Сохранено ✓"); loadSrvOrders(true); }
      else if (r.status === 401) { SRV.admin = false; render(); }
      else toast("Не удалось сохранить");
    }).catch(function () { toast("Сервер не отвечает"); });
  }

  /* Only the overrides are read for everybody — they change what the shop
     shows. Whether this browser is the owner is asked once, and only when the
     admin screen is actually opened, so a shopper never pays for that call. */
  var admProbed = false;
  function probeAdmin() {
    if (admProbed) return;
    admProbed = true;
    checkAdmin().then(function (ok) {
      if (ok) loadSrvOrders(true);
      render();
    });
  }
  loadServerOverrides();

  /* ---- features: mirror one editor change to the server ---------------------
     The demo layer is what the prototype shows; product_overrides is what the
     real shop will read. PUT /api/admin/overrides belongs to backend-core —
     this is best effort, and its absence must never break the editor. */
  function pushOverride(id, patch) {
    // only a signed-in admin can write; without a session this would just be
    // a 401 in the console. srvPush() below handles the other fields.
    if (typeof SRV === "undefined" || !SRV || SRV.admin !== true) return;
    var body = { product_id: id };
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) body[k] = patch[k];
    try {
      fetch("/api/admin/overrides/", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }).catch(function () {});
    } catch (e) {}
  }

  var FLOW_NAMES = { abandoned: "Брошенная корзина", birthday: "Скидка ко дню рождения", backstock: "Товар снова в наличии" };
  function actionText(a) {
    var p = a.id && byId(a.id);
    if (a.type === "set_price") return "Цена «" + (p ? p.brand + " " + p.name : a.id) + "»: " + eur(p ? p.price : 0) + " → " + eur(a.value);
    if (a.type === "set_stock") return "Наличие «" + (p ? p.name : a.id) + "»: " + ({ in: "в наличии", low: "мало", out: "нет" })[a.value];
    if (a.type === "set_seo") return "SEO «" + (p ? p.name : a.id) + "»: «" + (a.title || "—") + "» / «" + (a.description || "—") + "»";
    if (a.type === "toggle_flow") return "Письмо «" + (FLOW_NAMES[a.id] || a.id) + "»: " + (a.value ? "включить" : "выключить");
    if (a.type === "toggle_chatbot") return "ИИ-чат для покупателей: " + (a.value ? "включить" : "выключить");
    if (a.type === "toggle_bundles") return "Наборы на сайте: " + (a.value ? "показать" : "скрыть");
    if (a.type === "set_hero") {
      var hsl = a.value && Array.isArray(a.value.slides) ? a.value.slides : null;
      if (!hsl || !hsl.length) return "Баннер: стандартный";
      var h1 = hsl[0].title || {};
      return "Баннер: " + hsl.length + " " + pl(hsl.length, "слайд", "слайда", "слайдов") +
        ", первый — «" + (h1.RU || h1.ET || h1.EN || "—") + "»";
    }
    if (a.type === "set_subcat") return "Подкатегория «" + (p ? p.name : a.id) + "»: " + (a.value ? a.value : "авто");
    if (a.type === "set_varimg") return "Фото по объёмам «" + (p ? p.name : a.id) + "»: " + a.map.map(function (x) { return x + 1; }).join(" / ");
    if (a.type === "set_video") return "Видео «" + (p ? p.name : a.id) + "»: " + (a.value ? a.value : "убрано");   // features
    return "";
  }
  function demoApply(a) {
    var entry = { t: new Date().toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }), txt: actionText(a), a: a, prev: null };
    var p = a.id && byId(a.id);
    if (a.type === "set_price") { entry.prev = { type: "set_price", id: a.id, value: DEMO.price[a.id] != null ? DEMO.price[a.id] : p.price }; DEMO.price[a.id] = a.value; }
    else if (a.type === "set_stock") { entry.prev = { type: "set_stock", id: a.id, value: DEMO.stock[a.id] || p.stock }; DEMO.stock[a.id] = a.value; }
    else if (a.type === "set_seo") { entry.prev = { type: "set_seo", id: a.id, title: (DEMO.seo[a.id] || {}).t || (p.seo || {}).t || "", description: (DEMO.seo[a.id] || {}).d || (p.seo || {}).d || "" }; DEMO.seo[a.id] = { t: a.title, d: a.description }; }
    else if (a.type === "toggle_flow") { entry.prev = { type: "toggle_flow", id: a.id, value: !!DEMO.flows[a.id] }; DEMO.flows[a.id] = a.value; }
    else if (a.type === "toggle_chatbot") { entry.prev = { type: "toggle_chatbot", value: DEMO.chatbot }; DEMO.chatbot = a.value; }
    else if (a.type === "toggle_bundles") { entry.prev = { type: "toggle_bundles", value: DEMO.bundles !== false }; DEMO.bundles = a.value; }
    else if (a.type === "set_hero") {
      entry.prev = { type: "set_hero", value: DEMO.hero };
      DEMO.hero = a.value && Array.isArray(a.value.slides) ? a.value : null;
      S.heroDraft = null; S.heroEdit = -1; S.slide = 0; restartHero();
    }
    else if (a.type === "set_subcat") { entry.prev = { type: "set_subcat", id: a.id, value: DEMO.subcat[a.id] || "" }; if (a.value) DEMO.subcat[a.id] = a.value; else delete DEMO.subcat[a.id]; }
    else if (a.type === "set_varimg") { entry.prev = { type: "set_varimg", id: a.id, map: (DEMO.varimg[a.id] || (p.varImg || []).slice()) }; DEMO.varimg[a.id] = a.map.slice(); }
    // features
    else if (a.type === "set_video") { entry.prev = { type: "set_video", id: a.id, value: (DEMO.video[a.id] != null ? DEMO.video[a.id] : (p.video || "")) }; DEMO.video[a.id] = a.value; pushOverride(a.id, { video_url: a.value }); }
    else return;
    DEMO.log.unshift(entry);
    DEMO.log = DEMO.log.slice(0, 40);
    demoSave();
    applyDemoOverrides();
    srvPush(a);   // and through to the server when the owner is signed in
  }
  function demoUndo(i) {
    var entry = DEMO.log[i];
    if (!entry || !entry.prev) return;
    var a = entry.prev;
    if (a.type === "set_price") DEMO.price[a.id] = a.value;
    else if (a.type === "set_stock") DEMO.stock[a.id] = a.value;
    else if (a.type === "set_seo") DEMO.seo[a.id] = { t: a.title, d: a.description };
    else if (a.type === "toggle_flow") DEMO.flows[a.id] = a.value;
    else if (a.type === "toggle_chatbot") DEMO.chatbot = a.value;
    else if (a.type === "toggle_bundles") DEMO.bundles = a.value;
    else if (a.type === "set_hero") {
      DEMO.hero = a.value && Array.isArray(a.value.slides) ? a.value : null;
      S.heroDraft = null; S.heroEdit = -1; S.slide = 0; restartHero();
    }
    else if (a.type === "set_subcat") { if (a.value) DEMO.subcat[a.id] = a.value; else delete DEMO.subcat[a.id]; }
    else if (a.type === "set_varimg") DEMO.varimg[a.id] = a.map.slice();
    else if (a.type === "set_video") { DEMO.video[a.id] = a.value; pushOverride(a.id, { video_url: a.value }); }   // features
    DEMO.log.splice(i, 1);
    demoSave();
    applyDemoOverrides();
    srvPush(a);   // the previous value goes back to the server too
  }
  var pendingAction = null;
  function confirmCard(a) {
    return '<div class="adm__confirm"><b>Предпросмотр изменения</b>' + esc(actionText(a)) +
      '<div class="adm__acts"><button class="btn btn--sm" data-admapply>Применить</button>' +
      '<button class="btn btn--ghost btn--sm" data-admcancel>Отмена</button></div></div>';
  }

  /* When /api/assistant/ has a key, the owner's questions go to the real
     model (mode:"admin" — its own system prompt, demo-data caveats, tab
     routing). The canned answers below stay as the offline fallback. */
  var admAI = null, admConvo = [];
  function probeAdmAI() {
    if (admAI !== null) return;
    admAI = false;
    fetch("/api/assistant/").then(function (r) { return r.json(); })
      .then(function (j) { admAI = !!j.enabled; }).catch(function () {});
  }
  /* What the banner says right now, trimmed to what the assistant can act on —
     «поменяй второй слайд» needs to know there is a second slide. */
  function heroForAI() {
    return heroConf().slides.slice(0, 5).map(function (s) {
      return {
        id: String(s.id || ""),
        title: String((s.title && s.title.RU) || ""),
        go: String(s.go || ""),
        image: String(s.image || ""),
        on: s.on !== false
      };
    });
  }
  function askAdminAI(q) {
    admConvo.push({ role: "user", content: q });
    fetch("/api/assistant/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: admConvo.slice(-8), lang: S.lang, mode: "admin", hero: heroForAI() })
    })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        admConvo.push({ role: "assistant", content: j.reply || "" });
        var el = document.querySelector("[data-aians]");
        if (el && S.adminAsk === q) {
          pendingAction = j.action || null;
          el.innerHTML = esc(j.reply || "") +
            (pendingAction ? confirmCard(pendingAction) : "") +
            (j.tab && !pendingAction ? aiGo(j.tab, TAB_LABEL[j.tab] || "Открыть") : "");
        }
      })
      .catch(function () {
        var el = document.querySelector("[data-aians]");
        if (el && S.adminAsk === q) el.innerHTML = adminAnswer(q);
      });
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

  /* The receipt. The payment provider sends the shopper back to
     /shop2/done/?n=R-100042&s=paid|failed|pending, so this screen reads the
     query rather than any state it kept — a bank redirect is a fresh page
     load, and whatever was in memory before it is gone. */
  function doneState() {
    if (S.done) return S.done;
    var q = {};
    try {
      String(location.search || "").replace(/^\?/, "").split("&").forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf("=");
        q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? "" : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
      });
    } catch (e) {}
    var s = q.s === "paid" || q.s === "failed" || q.s === "pending" ? q.s : "";
    return { status: s, number: /^R-[0-9]+$/.test(q.n || "") ? q.n : "", demo: !s && !q.n };
  }
  function screenDone() {
    var d = doneState();
    // one text node, so the «Заказ R-100042» dictionary rule can rewrite it
    var num = d.number ? '<p class="done__num">Заказ ' + esc(d.number) + "</p>" : "";
    if (d.status === "failed") {
      return '<div class="wrap wrap--narrow" style="text-align:center"><section class="sec">' +
        '<div class="done__tick done__tick--bad">✕</div>' +
        '<h1 class="display h1">Оплата не прошла</h1>' + num +
        '<p class="muted" style="margin-bottom:22px">Деньги не списаны. Заказ сохранён — попробуйте оплатить ещё раз или выберите другой способ.</p>' +
        '<button class="btn" data-go="home">Вернуться в магазин</button></section></div>';
    }
    if (d.status === "pending") {
      return '<div class="wrap wrap--narrow" style="text-align:center"><section class="sec">' +
        '<div class="done__tick done__tick--wait">…</div>' +
        '<h1 class="display h1">Платёж обрабатывается</h1>' + num +
        '<p class="muted" style="margin-bottom:22px">Банк ещё не подтвердил оплату. Как только он ответит, мы пришлём письмо — обычно это занимает пару минут.</p>' +
        '<button class="btn" data-go="home">Вернуться в магазин</button></section></div>';
    }
    return '<div class="wrap wrap--narrow" style="text-align:center"><section class="sec">' +
      '<div class="done__tick">' + icon("check") + "</div>" +
      '<h1 class="display h1">' + (d.status === "paid" ? "Заказ оплачен" : "Заказ оформлен") + "</h1>" + num +
      '<p class="muted" style="margin-bottom:22px">' +
        (d.status === "paid"
          ? "Спасибо! Подтверждение и чек уже летят на почту. Когда посылку передадут перевозчику, пришлём трек-номер."
          : "Это демонстрация — настоящий заказ не создан. В рабочем магазине сюда придёт номер заказа, счёт на почту и трекинг посылки.") +
      "</p>" +
      '<button class="btn" data-go="home">Вернуться в магазин</button></section></div>';
  }

  // ---------- overlays ----------
  function cartBody() {
    var sum = cartSum(), thr = threshold(), pct = Math.min(100, sum / thr * 100);
    return (S.cart.length ? S.cart.map(function (l, li) {
      // a line is a product, a set or a gift card — lineTitle/lineImageHTML/
      // lineNoteHTML resolve which, so this markup stays one shape
      return '<div class="cline" data-cline="' + li + '"><span class="cline__ph">' + lineImageHTML(l) + "</span>" +
        '<span class="cline__mid"><span class="cline__nm">' + esc(lineTitle(l)) + lineLabel(l) + "</span>" +
        lineNoteHTML(l) +
        '<span class="stepper stepper--sm"><button data-line="' + li + '" data-d="-1" aria-label="Меньше">−</button><span class="num" data-qtyval>' + l.qty + '</span><button data-line="' + li + '" data-d="1" aria-label="Больше">+</button></span>' +
        '<button class="link cline__rm" data-remove="' + li + '">Убрать</button></span>' +
        '<span class="num cline__pr" data-linepr>' + eur(lineUnit(l) * l.qty) + "</span></div>";
    }).join("") : '<p class="muted">Пока пусто. <button class="link" data-go-cat="all">К товарам</button></p>') +
      (S.cart.length ? '<div class="freebar"><div class="freebar__track"><div class="freebar__fill" style="width:' + pct + '%"></div></div>' +
        '<p class="muted">' + freebarText(sum, thr) + "</p></div>" + upsellHTML(sum, thr) : "");
  }

  /* The free-shipping bar states the gap; this closes it. One product that
     bridges the gap in a single add, one cheaper alternative — both real,
     in stock, not already in the cart. */
  function upsellHTML(sum, thr) {
    if (sum >= thr || !S.cart.length) return "";
    var gap = thr - sum;
    var inCart = {};
    S.cart.forEach(function (l) { inCart[l.id] = true; });
    var pool = CATALOGUE.filter(function (p) { return p.stock !== "out" && !inCart[p.id] && p.cat !== "merch"; });
    var bridge = pool.filter(function (p) { return p.price >= gap && p.price <= gap + 25; })
      .sort(function (a, b) { return a.price - b.price; })[0];
    // the pairing is read off the last real product: a set or a gift card has
    // no complements, and byId() would have silently used CATALOGUE[0]
    var lastLine = null;
    for (var li2 = S.cart.length - 1; li2 >= 0; li2--) if (!S.cart[li2].type) { lastLine = S.cart[li2]; break; }
    var mate = lastLine
      ? complementsFor(byId(lastLine.id)).filter(function (p) { return !inCart[p.id] && p.stock !== "out" && p !== bridge; })[0]
      : null;
    var picks = [bridge, mate].filter(Boolean).slice(0, 2);
    if (!picks.length) return "";
    return '<div class="upsell"><div class="upsell__t">Добавьте — и доставка бесплатно:</div>' +
      picks.map(function (p) {
        return '<div class="upsell__row"><span class="upsell__ph">' + media(p, 0, "ph") + "</span>" +
          '<button class="upsell__nm" data-go-product="' + p.id + '">' + esc(p.brand) + " " + esc(p.name) + "</button>" +
          '<span class="num">' + (p.priceFrom ? "от " : "") + eur(p.price) + "</span>" +
          '<button class="btn btn--sm" data-add="' + p.id + '">+</button></div>';
      }).join("") + "</div>";
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
  /* A prerendered page (tools/prerender-shop2.mjs) ships the product, the
     category or the home screen as real HTML inside #app, so the page says
     something before this file has run. Append the slots next to it instead of
     replacing it, and drop it only once the first render() has filled them —
     boot is one synchronous task, so nothing is ever painted twice, and if
     this script fails on the way the static page stays up instead of blanking. */
  var preRendered = document.getElementById("prerender");
  app.insertAdjacentHTML("beforeend",
    '<div id="hdrslot"></div><div id="bodyslot"></div><div id="navslot"></div>' +
    '<div id="ovl"></div><div id="toastslot"></div>');
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
  function setMetaProp(prop, content) {
    var el = document.querySelector('meta[property="' + prop + '"]');
    if (!el) { el = document.createElement("meta"); el.setAttribute("property", prop); document.head.appendChild(el); }
    el.setAttribute("content", content);
  }
  /* The prerendered pages already carry these tags, marked with data-seo so
     this finds and rewrites them instead of appending a second set. */
  function setLinkTag(key, rel, href, hreflang) {
    var el = document.querySelector('link[data-seo="' + key + '"]');
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("data-seo", key);
      el.setAttribute("rel", rel);
      if (hreflang) el.setAttribute("hreflang", hreflang);
      document.head.appendChild(el);
    }
    el.setAttribute("href", href);
  }
  /* Google shows about sixty characters of a title. Take the longest version
     that fits — tools/prerender-shop2.mjs runs the same ladder, so the tab does
     not change under the shopper when this script takes over a static page. */
  function fitTitle(core, full) {
    if (full && full.length <= 60) return full;
    if (core.length + 10 <= 60) return core + " — REMPIRE";
    if (core.length <= 60) return core;
    return core.slice(0, 59).replace(/[\s·—–-]+$/, "") + "…";
  }
  /* One page, three URLs, one cluster: canonical plus ru/et/en/x-default. The
     addresses come from the path, never from S.lang — a German browser
     rendering /shop2/ in English must not tell a crawler that /shop2/ is the
     English page. x-default is the unprefixed path, which is what every old
     link and every legacy redirect already points at. */
  var ALT_TAGS = [["RU", "ru"], ["ET", "et"], ["EN", "en"]];
  function setAltTags() {
    var rest = stripLangPrefix(location.pathname).replace(/^\/shop2/, "") || "/";
    var origin = location.origin;
    setLinkTag("canonical", "canonical", origin + "/shop2" + SEG_OF_LANG[pathLang] + rest);
    for (var i = 0; i < ALT_TAGS.length; i++) {
      setLinkTag("alt-" + ALT_TAGS[i][1], "alternate",
        origin + "/shop2" + SEG_OF_LANG[ALT_TAGS[i][0]] + rest, ALT_TAGS[i][1]);
    }
    setLinkTag("alt-x", "alternate", origin + "/shop2" + rest, "x-default");
    setMetaProp("og:url", origin + "/shop2" + SEG_OF_LANG[pathLang] + rest);
    setMetaProp("og:locale", { RU: "ru_RU", ET: "et_EE", EN: "en_US" }[pathLang]);
    // the displayed language, not the path's: this one is read by screen
    // readers and by the browser's own translation prompt
    try { document.documentElement.lang = { RU: "ru", ET: "et", EN: "en" }[S.lang]; } catch (e) {}
  }
  function setHead() {
    var base = { RU: "REMPIRE — магазин косметики в Таллинне", ET: "REMPIRE — kosmeetikapood Tallinnas", EN: "REMPIRE — grooming shop in Tallinn" }[S.lang];
    var buy = { RU: "купить в Rempire", ET: "osta Rempire'ist", EN: "buy at Rempire" }[S.lang];
    var t = base, d = "";
    /* A prerendered page ships JSON-LD describing itself — a breadcrumb, a
       product list, the organisation. It is right until the shopper walks
       somewhere else, and then it is a description of a page they have left. */
    if (location.pathname !== loadedPath) {
      var stale = document.querySelectorAll('script[data-seo="ldjson-page"]');
      for (var si = 0; si < stale.length; si++) stale[si].remove();
    }
    if (S.screen === "product") {
      var p = byId(S.productId);
      var core = p.brand + " " + trText(p.name, S.lang, true);
      t = fitTitle(core, core + " — " + buy + " · " + (p.priceFrom ? trText("от " + eur(p.price), S.lang, false) : eur(p.price)));
      if (S.lang === "EN" && p.seo && p.seo.t) t = fitTitle(p.seo.t, "");
      d = (S.lang === "EN" && p.seo && p.seo.d) ? p.seo.d : stripTags(descFor(p)).slice(0, 155);
      var pUrl = location.origin + "/shop2" + SEG_OF_LANG[pathLang] + "/p/" + encodeURIComponent(p.id) + "/";
      // same shape the prerendered pages carry, so taking over a static page
      // does not quietly thin out its structured data
      var ld = {
        "@context": "https://schema.org", "@type": "Product",
        name: p.brand + " " + p.name, brand: { "@type": "Brand", name: p.brand },
        image: [location.origin + p.img],
        description: stripTags(descFor(p)).slice(0, 500),
        category: trText(CAT_NAMES[p.cat] || "", S.lang, false),
        sku: p.id,
        url: pUrl,
        offers: {
          "@type": "Offer", priceCurrency: "EUR",
          price: String(p.price),
          availability: "https://schema.org/" + (p.stock === "out" ? "OutOfStock" : "InStock"),
          itemCondition: "https://schema.org/NewCondition",
          url: pUrl,
          seller: { "@type": "Organization", name: "REMPIRE" }
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
      // features
      else if (S.screen === "bundles") t = trText("Наборы", S.lang, false) + " — REMPIRE";
      else if (S.screen === "bundle") {
        var bb = bundleById(S.bundleId);
        if (bb) { t = bundleTitle(bb) + " — REMPIRE"; d = bundleDesc(bb).slice(0, 155); }
      } else if (S.screen === "gift") t = trText("Подарочная карта", S.lang, false) + " — REMPIRE";
    }
    document.title = t;
    if (d) setMetaTag("description", d);
    /* Client navigation has to move the canonical and the hreflang set with
       the screen, or a crawler that runs JS reads the landing page's cluster
       on every product it walks to. */
    setAltTags();
    setMetaProp("og:title", t);
    if (d) setMetaProp("og:description", d);
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
    else if (S.screen === "bundles") body = screenBundles();   // features
    else if (S.screen === "bundle") body = screenBundle();     // features
    else if (S.screen === "gift") body = screenGift();         // features
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
    document.body.dataset.screen = S.screen; // chat.js hides itself in the admin
    translatePage();
    setHead();
    if (S.screen === "admin") {
      var coh = document.querySelector(".cohdr");
      if (coh) document.documentElement.style.setProperty("--cohdrh", coh.offsetHeight + "px");
    }

    if (S.screen === "catalog") observeSentinel();
    // features: real reviews and the moderation queue are fetched once each
    if (S.screen === "product") loadReviews(S.productId);
    if (S.screen === "admin" && S.adminTab === "reviews") loadAdminReviews(false);
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

  /* Whatever language prefix the visitor arrived on rides along on every
     internal navigation, so a link copied out of the address bar keeps its
     language and the canonical keeps agreeing with the path. Russian has no
     prefix — it is the default and the x-default. */
  function pathFor() {
    var b = "/shop2" + SEG_OF_LANG[pathLang];
    if (S.screen === "product" && S.productId) return b + "/p/" + encodeURIComponent(S.productId) + "/";
    if (S.screen === "catalog") return S.brand ? b + "/b/" + slugify(S.brand) + "/" : b + "/c/" + S.cat + "/";
    if (S.screen === "search") return b + "/search/" + (S.query ? "?q=" + encodeURIComponent(S.query) : "");
    if (S.screen === "info" && S.infoSlug) return b + "/info/" + S.infoSlug + "/";
    // features: /shop2/sets/ is the list, /shop2/set/<id>/ one set
    if (S.screen === "bundles") return b + "/sets/";
    if (S.screen === "bundle" && S.bundleId) return b + "/set/" + encodeURIComponent(S.bundleId) + "/";
    if (S.screen === "home") return b + "/";
    return b + "/" + S.screen + "/";
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
    if (screen === "checkout") { S.coStep = 1; S.pointOpen = false; }
    // leaving the receipt drops the receipt: the next one reads its own query
    if (screen !== "done") S.done = null;
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
    // adding from INSIDE the open drawer (the free-shipping upsell) must
    // redraw the lines and totals, or the tap looks like it did nothing
    if (S.cartOpen) rebuildCart();
    toast("Добавлено в корзину ✓");
  }

  /* ---- features: sets and gift cards in the cart --------------------------
     Both are one line with a price of their own. The set carries the products
     it is made of, so the order — and the person packing it — has the list
     even if the set is retired later; the gift card carries its recipient. */
  function addBundleToCart(bid) {
    var b = bundleById(bid);
    if (!b) return;
    if (b.stock === "out") { toast("Набор сейчас не собрать — товар закончился"); return; }
    var id = "bundle:" + b.id, line = null;
    S.cart.forEach(function (l) { if (l.type === "bundle" && l.id === id) line = l; });
    if (line) line.qty = Math.min(9, line.qty + 1);
    else S.cart.push({
      type: "bundle", id: id, qty: 1, price: b.price,
      components: b.items.map(function (it) { return { id: it.id, size: it.size || 0, qty: 1 }; })
    });
    persist();
    if (S.cartOpen) rebuildCart();
    toast("Набор в корзине ✓");
  }
  function addGiftToCart(amount) {
    var a = Number(amount);
    if (GIFT_AMOUNTS.indexOf(a) < 0) return;
    if (giftEmailBad()) { toast("Проверьте e-mail получателя"); return; }
    // every card is its own line: two cards for two people must not merge
    S.cart.push({
      type: "gift", id: "gift:" + a, qty: 1, price: a,
      meta: {
        name: S.gift.name.trim().slice(0, 80),
        email: S.gift.email.trim().slice(0, 120),
        message: S.gift.message.trim().slice(0, 300)
      }
    });
    S.gift = { name: "", email: "", message: "" };
    persist();
    if (S.cartOpen) rebuildCart();
    toast("Подарочная карта в корзине ✓");
  }
  /* ---- /features ---------------------------------------------------------- */

  var COUNTRY_SHORT = { EE: "Эстония", LV: "Латвия", LT: "Литва", FI: "Финляндия", EU: "Европа" };
  function freebarText(sum, thr) {
    return sum >= thr
      ? "Бесплатная доставка — порог " + thr + " € достигнут ✓"
      : "До бесплатной доставки (" + COUNTRY_SHORT[S.country] + ", от " + thr + " €) — ещё " + eur(thr - sum);
  }
  function lineLabel(l) {
    // sets and gift cards carry no size — their detail is in lineNoteHTML
    if (l.type) return "";
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
    var total = heroCount();
    if (!total) { S.slide = 0; return; }
    S.slide = ((n % total) + total) % total;
    if (!paintSlide()) render();
    if (manual) restartHero();
  }
  function restartHero() {
    clearInterval(heroTimer);
    // a single banner has nothing to rotate to
    if (heroCount() < 2) return;
    heroTimer = setInterval(function () {
      if (S.screen !== "home" || document.hidden || S.cartOpen || S.filterOpen) return;
      try { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
      setSlide(S.slide + 1);
    }, heroInterval());
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
    var t = e.target.closest("[data-admnav],[data-admai],[data-vcolour],[data-vsize],[data-notify],[data-share],[data-go],[data-go-cat],[data-go-brand],[data-go-product],[data-add],[data-cart],[data-closecart],[data-filter],[data-closefilter],[data-clearfilter],[data-unbrand],[data-unstock],[data-subcat],[data-page],[data-slide],[data-dot],[data-langtoggle],[data-lang],[data-line],[data-remove],[data-checkout],[data-pay],[data-step],[data-method],[data-acctm],[data-size],[data-qty],[data-gal],[data-login],[data-logout],[data-save],[data-repeat],[data-applypromo],[data-q],[data-buynow],[data-closetoast],[data-paym],[data-bank],[data-admtab],[data-admask],[data-admsend],[data-admorder],[data-admgoods],[data-admclose],[data-admsavegoods],[data-vpick],[data-admseogen],[data-admchatbot],[data-admbundles],[data-admapply],[data-admcancel],[data-admflow],[data-admundo],[data-admedit],[data-go-bundle],[data-addbundle],[data-giftamt],[data-addgift],[data-giftoff],[data-revopen],[data-revstar],[data-revsend],[data-admrevfilter],[data-admrev],[data-playvideo],[data-mailtpl],[data-maillang],[data-mailtest],[data-dm],[data-carrier],[data-pointopen],[data-pointclose],[data-pointpick],[data-admlogin],[data-admlogout],[data-admstatus],[data-admnotesave],[data-heroedit],[data-heroclose],[data-herolang],[data-heroadd],[data-herodel],[data-heromove],[data-heroon],[data-heroimg],[data-herogopick],[data-herosave],[data-heroreset]");
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
      // features: the video and the review form belong to the product we left
      S.videoOn = false; S.revOpen = false; S.revState = "";
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
      /* The URL is half the answer: switching language rewrites the prefix in
         place, so the address bar, the canonical and what is on screen never
         disagree, and the link the shopper copies opens in the language they
         are reading. replaceState, not push — Back should leave the shop, not
         walk back through language changes. */
      pathLang = d.lang;
      try { history.replaceState(history.state || { y: window.scrollY, shown: S.shown }, "", pathFor()); } catch (e) {}
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
    if (d.pay !== undefined) { payNow(); return; }
    if (d.step) {
      var n = Number(d.step);
      // forward only — going back to change something is always allowed
      if (n > S.coStep) {
        if (S.coStep === 1) { S.emailTouched = true; if (emailBad()) { return failStep(1); } }
        if (S.coStep === 2) {
          S.shipTouched = true;
          if (shipMissing().length || pointMissing()) { return failStep(2); }
        }
      }
      S.coStep = n; render(); return;
    }
    /* ---------- delivery picker ---------- */
    if (d.dm) {
      S.ship.method = d.dm;
      if (d.dm !== "parcel") S.ship.point = null;
      else loadPoints();
      render(); refocus('[data-dm="' + d.dm + '"]'); return;
    }
    if (d.carrier) {
      // another carrier is another set of machines — the old choice is not one
      S.ship.carrier = d.carrier; S.ship.point = null; POINTS.q = "";
      loadPoints(); render(); refocus('[data-carrier="' + d.carrier + '"]'); return;
    }
    if (d.pointopen !== undefined) {
      loadPoints(); POINTS.q = ""; S.pointOpen = true; render();
      refocus("[data-pointq]"); return;
    }
    if (d.pointclose !== undefined) { S.pointOpen = false; render(); refocus("[data-pointopen]"); return; }
    if (d.pointpick) {
      var picked = pointById(d.pointpick);
      if (picked) S.ship.point = picked;
      S.pointOpen = false; render(); refocus("[data-pointopen]"); return;
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
    if (d.admtab) { S.adminTab = d.admtab; S.adminOrder = 0; S.adminEdit = ""; window.scrollTo({ top: 0 }); render(); return; }
    // demo orders are numbered, real ones carry a uuid — keep both as they came
    if (d.admorder !== undefined) { S.adminOrder = d.admorder ? (/^\d+$/.test(d.admorder) ? Number(d.admorder) : d.admorder) : 0; S.adminTab = "orders"; window.scrollTo({ top: 0 }); render(); return; }
    if (d.admlogin !== undefined) {
      var pwEl = document.querySelector("[data-admpw]");
      admLogin(pwEl ? pwEl.value.trim() : "");
      return;
    }
    if (d.admlogout !== undefined) { admLogout(); return; }
    if (d.admstatus) { srvOrderPatch(S.adminOrder, { status: d.admstatus }); return; }
    if (d.admnotesave !== undefined) {
      var noteEl = document.querySelector("[data-admnote]");
      srvOrderPatch(S.adminOrder, { note: noteEl ? noteEl.value : "" });
      return;
    }
    if (d.admgoods !== undefined) { S.adminEdit = d.admgoods; S.adminTab = "goods"; window.scrollTo({ top: 0 }); render(); return; }
    if (d.admclose !== undefined) { S.adminEdit = ""; render(); return; }
    if (d.vpick !== undefined) {
      // select a photo for one size inside the editor (applied on Save)
      var pk = d.vpick.split(":");
      var row = document.querySelector('[data-vrow="' + pk[0] + '"]');
      if (row) row.querySelectorAll("[data-vpick]").forEach(function (b2) {
        b2.setAttribute("aria-current", String(b2 === t));
      });
      return;
    }
    if (d.admseogen !== undefined) {
      var sp2 = byId(d.admseogen);
      var genBtn = t; genBtn.textContent = "…";
      fetch("/api/assistant/", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "admin", lang: "RU", messages: [{ role: "user",
          content: "Напиши SEO title и description для товара " + sp2.id + " (" + sp2.brand + " " + sp2.name + "). Верни action set_seo." }] })
      }).then(function (r) { return r.json(); }).then(function (j) {
        genBtn.textContent = "Сгенерировать с ИИ";
        var a = j.action;
        if (a && a.type === "set_seo") {
          var ti = document.querySelector("[data-edseot]"), de = document.querySelector("[data-edseod]");
          if (ti && a.title) ti.value = a.title;
          if (de && a.description) de.value = a.description;
          toast("Черновик готов — проверьте и сохраните");
        } else toast("Не получилось — попробуйте ещё раз");
      }).catch(function () { genBtn.textContent = "Сгенерировать с ИИ"; toast("Не получилось — попробуйте ещё раз"); });
      return;
    }
    if (d.admsavegoods !== undefined) {
      var gp = byId(d.admsavegoods);
      var priceEl = document.querySelector("[data-edprice]");
      var stockEl = document.querySelector("[data-edstock]");
      var np = priceEl ? parseFloat(String(priceEl.value).replace(",", ".")) : NaN;
      var changed = false;
      if (!isNaN(np) && np >= 1 && np <= 500 && Math.abs(np - gp.price) > 0.001) {
        demoApply({ type: "set_price", id: gp.id, value: Math.round(np * 100) / 100 }); changed = true;
      }
      if (stockEl && stockEl.value !== gp.stock) {
        demoApply({ type: "set_stock", id: gp.id, value: stockEl.value }); changed = true;
      }
      var subEl = document.querySelector("[data-edsubcat]");
      if (subEl && subEl.value !== (DEMO.subcat[gp.id] || "")) {
        demoApply({ type: "set_subcat", id: gp.id, value: subEl.value }); changed = true;
      }
      var rowsV = [...document.querySelectorAll("[data-vrow]")];
      if (rowsV.length) {
        var map2 = rowsV.map(function (r2) {
          var sel2 = r2.querySelector('[data-vpick][aria-current="true"]');
          return sel2 ? Number(sel2.dataset.vpick.split(":")[1]) : -1;
        });
        if (map2.every(function (x) { return x >= 0; }) &&
            JSON.stringify(map2) !== JSON.stringify(gp.varImg || [])) {
          demoApply({ type: "set_varimg", id: gp.id, map: map2 }); changed = true;
        }
      }
      var tEl = document.querySelector("[data-edseot]"), dEl = document.querySelector("[data-edseod]");
      var nt = tEl ? tEl.value.trim() : "", nd = dEl ? dEl.value.trim() : "";
      if ((nt || nd) && (nt !== ((gp.seo || {}).t || "") || nd !== ((gp.seo || {}).d || ""))) {
        demoApply({ type: "set_seo", id: gp.id, title: nt, description: nd }); changed = true;
      }
      /* ---- features: the video link -------------------------------------- */
      var vEl = document.querySelector("[data-edvideo]");
      if (vEl) {
        var nv = vEl.value.trim();
        var curV = (DEMO.video && DEMO.video[gp.id]) || gp.video || "";
        // demoApply() writes the demo layer, the log and the server copy —
        // srvPush() deliberately leaves set_video to us
        if (nv !== curV) { demoApply({ type: "set_video", id: gp.id, value: nv }); changed = true; }
      }
      /* ---- /features ------------------------------------------------------ */
      S.adminEdit = "";
      toast(changed ? "Сохранено ✓ · отмена — в журнале" : "Изменений нет");
      render(); return;
    }
    if (d.admapply !== undefined) {
      if (pendingAction) { demoApply(pendingAction); pendingAction = null; toast("Применено ✓ · журнал в «Настройках»"); render(); }
      return;
    }
    if (d.admcancel !== undefined) { pendingAction = null; render(); return; }
    if (d.admflow !== undefined) {
      demoApply({ type: "toggle_flow", id: d.admflow, value: !DEMO.flows[d.admflow] });
      toast("Сохранено ✓"); render(); return;
    }
    if (d.mailtpl !== undefined) { keepMailTo(); S.mailTpl = d.mailtpl; render(); return; }
    if (d.maillang !== undefined) { keepMailTo(); S.mailLang = d.maillang; render(); return; }
    if (d.mailtest !== undefined) {
      keepMailTo();
      var mailAddr = (S.mailTo || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(mailAddr)) {
        toast("Введите e-mail — на него придёт образец"); refocus("[data-mailto]"); return;
      }
      if (t.disabled) return;
      t.disabled = true;
      /* trailing slash on purpose: next.config has trailingSlash:true, and a
         308 on a POST drops the body */
      fetch("/api/admin/mail/test/", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ template: mailTpl(), to: mailAddr, lang: mailLang() })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { code: r.status, j: j }; });
      }).then(function (res) {
        t.disabled = false;
        var err = res.j && res.j.error;
        if (res.j && res.j.ok) toast("Тест отправлен ✓");
        else if (res.code === 401) toast("Нужен вход в админку");
        else if (err === "no_api_key") toast("Отправка писем ещё не подключена");
        else if (err === "rate_limited") toast("Слишком много писем — попробуйте позже");
        else if (err === "bad_email") toast("Введите e-mail — на него придёт образец");
        else toast("Не получилось — попробуйте ещё раз");
      }).catch(function () {
        t.disabled = false; toast("Не получилось — попробуйте ещё раз");
      });
      return;
    }
    if (d.admchatbot !== undefined) {
      demoApply({ type: "toggle_chatbot", value: !DEMO.chatbot });
      toast(DEMO.chatbot ? "Чат включён ✓" : "Чат выключен ✓"); render(); return;
    }
    if (d.admbundles !== undefined) {
      demoApply({ type: "toggle_bundles", value: DEMO.bundles === false });
      if (DEMO.bundles === false && (S.screen === "bundles" || S.screen === "bundle")) S.screen = "home";
      toast(DEMO.bundles !== false ? "Наборы показаны ✓" : "Наборы скрыты ✓"); render(); return;
    }
    /* ---- «Главный баннер». Every button here edits the draft only; the shop
       changes on «Сохранить», through the confirm card. ------------------- */
    if (d.heroedit !== undefined) {
      S.heroEdit = Number(d.heroedit); S.heroLang = "RU"; S.heroGoQ = ""; S.heroImgQ = "";
      render(); return;
    }
    if (d.heroclose !== undefined) { S.heroEdit = -1; render(); return; }
    if (d.herolang) { S.heroLang = d.herolang; render(); return; }
    if (d.heroadd !== undefined) {
      var hAdd = heroDraft();
      if (hAdd.slides.length >= 5) { toast("Больше пяти слайдов не нужно"); return; }
      hAdd.slides.push({
        id: "s" + Date.now().toString(36),
        eyebrow: { RU: "" }, title: { RU: "Новый баннер" }, sub: { RU: "" }, cta: { RU: "Смотреть" },
        go: "cat:all", image: (CATALOGUE[0] || {}).id || "", on: true
      });
      S.heroEdit = hAdd.slides.length - 1; S.heroLang = "RU"; S.heroGoQ = ""; S.heroImgQ = "";
      render(); return;
    }
    if (d.herodel !== undefined) {
      heroDraft().slides.splice(Number(d.herodel), 1);
      S.heroEdit = -1; render(); return;
    }
    if (d.heromove) {
      var mv = d.heromove.split(":"), mi = Number(mv[0]), mj = mi + Number(mv[1]);
      var hMove = heroDraft().slides;
      if (mj >= 0 && mj < hMove.length) {
        var tmp = hMove[mi]; hMove[mi] = hMove[mj]; hMove[mj] = tmp;
        if (S.heroEdit === mi) S.heroEdit = mj;
        else if (S.heroEdit === mj) S.heroEdit = mi;
      }
      render(); return;
    }
    if (d.heroon !== undefined) {
      var hOn = heroDraft().slides[Number(d.heroon)];
      if (hOn) hOn.on = hOn.on === false;
      render(); return;
    }
    if (d.heroimg) {
      var hImg = heroDraft().slides[S.heroEdit];
      if (hImg) hImg.image = d.heroimg;
      render(); return;
    }
    if (d.herogopick) {
      var hGo = heroDraft().slides[S.heroEdit];
      if (hGo) hGo.go = "product:" + d.herogopick;
      render(); return;
    }
    if (d.herosave !== undefined) {
      pendingAction = { type: "set_hero", value: heroClean(heroDraft()) };
      render(); refocus("[data-admapply]"); return;
    }
    if (d.heroreset !== undefined) {
      pendingAction = { type: "set_hero", value: null };
      render(); refocus("[data-admapply]"); return;
    }
    if (d.admundo !== undefined) { demoUndo(Number(d.admundo)); toast("Отменено ✓"); render(); return; }
    if (d.admask) { S.adminAsk = d.admask; render(); if (admAI) askAdminAI(d.admask); return; }
    if (d.admsend !== undefined) {
      var qEl = document.querySelector("[data-admq]");
      var q = qEl && qEl.value.trim();
      if (q) { S.adminAsk = q; render(); if (admAI) askAdminAI(q); refocus("[data-admq]"); }
      return;
    }
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
      /* ---- features: the same field takes a gift-card code ----------------
         RMP- plus eight letters is a card, everything else is a promo code —
         so the shopper has one box to type into instead of two. Owned by the
         features agent; the promo branch below is the original one. */
      var typed = S.promo.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (typed.indexOf("RMP") === 0 && typed.length === 11) {
        applyGiftCode(S.promo.trim(), t);
        return;
      }
      /* ---- /features ------------------------------------------------------ */
      var ok = S.promo.trim().toUpperCase() === "REMPIRE10";
      S.promoOk = ok; S.promoErr = !ok; render(); refocus("[data-applypromo]"); return;
    }

    /* ---------- features: sets, gift card, reviews, video ---------------- */
    if (d.goBundle) {
      S.bundleId = d.goBundle; S.videoOn = false; go("bundle"); return;
    }
    if (d.addbundle) { e.stopPropagation(); addBundleToCart(d.addbundle); return; }
    if (d.giftamt) { S.giftAmount = Number(d.giftamt); render(); refocus('[data-giftamt="' + d.giftamt + '"]'); return; }
    if (d.addgift) { addGiftToCart(d.addgift); render(); return; }
    if (d.giftoff !== undefined) { S.giftCard = null; S.giftErr = ""; render(); return; }
    if (d.revopen !== undefined) {
      S.revOpen = !S.revOpen; S.revState = ""; render();
      if (S.revOpen) refocus('[data-revf="name"]');
      return;
    }
    if (d.revstar) {
      S.revForm.rating = Number(d.revstar);
      document.querySelectorAll("[data-revstar]").forEach(function (b) {
        b.setAttribute("aria-checked", String(Number(b.dataset.revstar) <= S.revForm.rating));
      });
      var live = document.querySelector("[data-revrating]");
      if (live) live.textContent = S.revForm.rating + " из 5";
      return;
    }
    if (d.revsend !== undefined) { sendReview(); return; }
    if (d.admrevfilter) { S.admRevFilter = d.admrevfilter; loadAdminReviews(true); render(); return; }
    if (d.admrev) {
      var parts = d.admrev.split(":");
      moderateReview(parts[0], parts[1]);
      return;
    }
    if (d.playvideo !== undefined) { S.videoOn = true; render(); return; }
    /* ---------- /features ------------------------------------------------ */

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
    else if (t.matches("[data-promo]")) { S.promo = t.value; S.promoErr = false; S.promoOk = false; S.giftErr = ""; }
    /* Only the list is redrawn — a full render would replace this very input
       and take the caret with it. */
    else if (t.matches("[data-pointq]")) { POINTS.q = t.value; patchPointList(); }
    // features: the gift-card form and the review form keep their own state
    else if (t.matches("[data-giftf]")) { S.gift[t.dataset.giftf] = t.value; }
    else if (t.matches("[data-revf]")) {
      S.revForm[t.dataset.revf] = t.type === "checkbox" ? t.checked : t.value;
      var send = document.querySelector("[data-revsend]");
      if (send) send.disabled = !reviewReady();
    }
    else if (t.matches("[data-goodsq]")) {
      S.goodsQ = t.value;
      var list = document.getElementById("goodslist");
      if (list) {
        list.innerHTML = goodsRows();
        translateTree(list);
      }
    }
    /* «Главный баннер»: a full render would take the caret out of the field,
       so only the live preview (or the picker list) is repainted. */
    else if (t.matches("[data-herof]")) {
      var hSl = heroDraft().slides[S.heroEdit];
      if (hSl) {
        var hF = t.dataset.herof;
        if (!hSl[hF] || typeof hSl[hF] !== "object") hSl[hF] = {};
        hSl[hF][S.heroLang || "RU"] = t.value;
        paintHeroPreview();
      }
    }
    else if (t.matches("[data-heroq]")) { S.heroGoQ = t.value; paintHeroPicks("herogolist", heroGoRows()); }
    else if (t.matches("[data-heroimgq]")) { S.heroImgQ = t.value; paintHeroPicks("heroimglist", heroImgRows()); }
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
    if (t.matches("[data-country]")) {
      S.country = t.value; S.method = 0; S.machine = 0;
      // another country is another carrier and another set of machines
      S.ship.carrier = ""; S.ship.point = null; POINTS.q = "";
      if (isParcel()) loadPoints();
      render();
    }
    else if (t.matches("[data-acctcountry]")) { S.country = t.value; S.acctMethod = 0; S.acctMachine = 0; render(); }
    else if (t.matches("[data-sort]")) { S.sort = t.value; S.shown = 12; patchCatalog(); }
    else if (t.matches("[data-machine]")) { S.machine = t.selectedIndex; }
    else if (t.matches("[data-acctmachine]")) { S.acctMachine = t.selectedIndex; }
    // «Главный баннер»: the link target, the picture URL and the timing —
    // on change, so a half-typed URL never becomes the banner's picture
    else if (t.matches("[data-herogo]")) {
      var gSl = heroDraft().slides[S.heroEdit];
      if (gSl) {
        gSl.go = t.value === "product"
          ? (String(gSl.go || "").indexOf("product:") === 0 ? gSl.go : "product:")
          : t.value;
      }
      render();
    }
    else if (t.matches("[data-heroimgurl]")) {
      var uSl = heroDraft().slides[S.heroEdit], uV = t.value.trim();
      if (uSl && uV) { uSl.image = uV; render(); }
    }
    else if (t.matches("[data-herotick]")) {
      heroDraft().interval = Math.max(2, Math.min(30, Number(t.value) || 6)) * 1000;
    }
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
      if (S.pointOpen) { S.pointOpen = false; render(); refocus("[data-pointopen]"); }
      else if (S.cartOpen || S.filterOpen) { closeDrawers(); }
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
    // in the language the sharer is reading, so the link opens that way for
    // whoever gets it — /shop2/p/… is Russian, /shop2/et/p/… Estonian
    return location.origin + "/shop2" + SEG_OF_LANG[pathLang] + "/p/" + encodeURIComponent(id) + "/";
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
    /* Read the language off the path first and strip it, so one set of
       patterns below serves all three languages. Doing it here and not only at
       boot is what makes Back work across a language switch: stepping into an
       entry written as /shop2/et/… returns to Estonian. */
    var lp = langFromPath(location.pathname);
    pathLang = lp || "RU";
    if (lp && lp !== S.lang) {
      S.lang = lp;
      // the persistent slots hold already-translated markup; translateTree only
      // converts FROM Russian, so they have to be rebuilt, not re-translated
      if (hdrSlot) hdrSlot.innerHTML = "";
      if (navSlot) navSlot.innerHTML = "";
      ovlKey = "";
    }
    var p = stripLangPrefix(location.pathname).replace(/\/+$/, "");
    var m;
    if ((m = p.match(/\/shop2\/p\/([^/]+)$/))) {
      var id = decodeURIComponent(m[1]), found = null;
      CATALOGUE.forEach(function (x) { if (x.id === id) found = x; });
      if (found) {
        S.productId = found.id;
        S.size = 0; S.qty = 1;
        S.gallery = found.varImg && found.varImg.length ? found.varImg[0] : 0;
        S.videoOn = false; S.revOpen = false; S.revState = "";   // features
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
    // features: sets and the gift card
    if ((m = p.match(/\/shop2\/set\/([^/]+)$/)) && bundleById(decodeURIComponent(m[1]))) {
      S.bundleId = decodeURIComponent(m[1]); S.screen = "bundle"; return true;
    }
    if (/\/shop2\/sets$/.test(p)) { S.screen = "bundles"; return true; }
    if (/\/shop2\/gift$/.test(p)) { S.screen = "gift"; return true; }
    if ((m = p.match(/\/shop2\/(brands|account|admin)$/))) { S.screen = m[1]; return true; }
    /* The receipt IS a place to land cold — it is where the bank sends the
       shopper back to, with ?n=&s= naming the order and how it went. Without
       that query there is no order behind it, and home is the honest answer.
       A payment form with an empty basket bounces straight back out anyway. */
    if (/\/shop2\/done$/.test(p) && /[?&]s=(paid|failed|pending)\b/.test(location.search)) {
      S.screen = "done"; return true;
    }
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
  // Enter in the admin assistant's input asks, same as the → button
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var t = e.target;
    if (t && t.matches && t.matches("[data-admq]")) {
      e.preventDefault();
      var q = t.value.trim();
      if (q) { S.adminAsk = q; render(); if (admAI) askAdminAI(q); refocus("[data-admq]"); }
    }
    // Enter in the password field signs in, same as «Войти»
    if (t && t.matches && t.matches("[data-admpw]")) {
      e.preventDefault();
      admLogin(t.value.trim());
    }
  });

  routeFromPath();
  /* Scroll is restored from the entry's own record; letting the browser also
     try leaves it fighting a page that has not been rendered yet. */
  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    history.replaceState({ y: 0, shown: S.shown }, "", here());
  } catch (e) {}
  render();
  /* The slots are filled now, so the static page underneath them has done its
     job. Still one synchronous task — the browser has not painted between the
     two, which is why the swap is invisible. */
  if (preRendered) {
    try { preRendered.remove(); } catch (e) {}
    preRendered = null;
  }
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
