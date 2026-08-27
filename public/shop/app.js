/* REMPIRE — standalone prototype (direction К).
   Vanilla JS, no build step. State → render → DOM. Screens are pure
   functions returning HTML strings; events are delegated from #app.
   Depends on catalogue.js (CATALOGUE) and paylogos.js (PAYLOGOS). */

(function () {
  "use strict";

  var TOWER_D = "M541.42,377.53l-18.69,10.82s11.14,130.41,11.54,135.02c-.23,7.19-11.13,15.39-28.52,21.44-20.85,7.24-49.58,11.23-80.91,11.23s-59.98-3.98-80.82-11.21c-17.37-6.02-28.29-14.2-28.6-21.39.67-7.94,14-157.47,15.72-177.3,6.37-6.37,30.14-20.91,95.48-18.91,72.13,2.21,93.63,19.61,93.88,19.75l16.98-11.55-12.38-117.42c-.91-14.04-12.92-23.77-33.91-33.43h0c-1.28-.59-2.76-.48-3.94.28l-8.63,5.58c-1.17.76-1.88,2.05-1.88,3.45v22.14c-6.08-1.56-13.19-3.4-19.85-4.35l-.52-32.33c-.05-3.02-2.31-5.55-5.31-5.93l-3.33-.42c-15.83-1.78-31.85-1.73-47.62.16l-3.82.46c-3.02.36-5.31,2.9-5.35,5.94l-.52,32.29c-6.72.99-12.86,3.08-18.9,4.68v-22.4c0-1.25-.57-2.44-1.55-3.22l-7.71-6.16c-1.22-.97-2.88-1.18-4.29-.53h0c-1.16.53-2.3,1.07-3.4,1.62-19.74,9.8-30.84,19.65-31.12,33.52l-7.12,64.63,5.48,16.43s32.05-29.18,102.06-26.35c39.67.51,59.56,11.01,59.56,11.01l11.75-15.24s-31.68-13.66-73.8-13.66c-59.49,0-86.24,15.83-86.24,15.83,0,0,5.09-51.57,5.11-51.87,0,0-.58,6.05.01-.28.87-9.26,15.42-13.93,15.42-13.93l-1.08,34.17s28.19-12.25,53.12-12.25l.6-37.37c0-2.19,30.62-2.27,30.63-.09l.6,37.39c24.34,0,53.11,11.72,53.11,11.72v-31.59s15.68,5.68,16.2,14.85l9.32,102.14c-9.24-2.87-25.63-14.19-93.35-16.33-69.08-2.19-111.82,15.96-113.22,30.02l-.45,4.28c-18.92,186.41-18.92,181.8-18.92,182.08,0,16.85,15.11,31.77,42.54,42.03,24.21,9.05,56.19,14.04,90.05,14.04s65.84-4.99,90.05-14.04c27.43-10.26,42.54-25.18,42.54-42.03,0-.3-16.02-147.42-16.02-147.42Z";
  var VB = "292.24 171.22 265.18 409.8";

  function tower(cls) {
    return '<svg viewBox="' + VB + '" role="img" aria-label="REMPIRE" class="' + (cls || "") + '"><path d="' + TOWER_D + '" fill="currentColor"/></svg>';
  }
  function towerDraw() {
    return '<svg viewBox="' + VB + '" aria-hidden="true"><path class="tw-draw" pathLength="1" d="' + TOWER_D + '"/><path class="tw-fill" fill="currentColor" d="' + TOWER_D + '"/></svg>';
  }

  var ICON = {
    home: '<path d="M4 11l8-7 8 7v9h-5.4v-6H9.4v6H4z"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    search: '<path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16.2 16.2L21 21"/>',
    user: '<path d="M12 4a3.6 3.6 0 1 1 0 7.2A3.6 3.6 0 0 1 12 4zM4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/>',
    bag: '<path d="M5.5 8.5h13l-.9 11a1.8 1.8 0 0 1-1.8 1.6H8.2a1.8 1.8 0 0 1-1.8-1.6zM8.8 8.5V7a3.2 3.2 0 0 1 6.4 0v1.5"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' + ICON[name] + "</svg>";
  }

  var FLAG = {
    RU: "https://flagcdn.com/w40/ru.png",
    ET: "https://flagcdn.com/w40/ee.png",
    EN: "https://flagcdn.com/w40/gb.png"
  };
  var LANGS = [["RU", "Русский"], ["ET", "Eesti"], ["EN", "English"]];

  var CATS = [
    { id: "hair", name: "Уход за волосами" },
    { id: "styling", name: "Стайлинг" },
    { id: "beard", name: "Уход за бородой" },
    { id: "face", name: "Уход за лицом" },
    { id: "body", name: "Уход за телом" },
    { id: "merch", name: "Мерч" }
  ];

  // Slides carry a product photo, washed back so ink text keeps contrast.
  // `cat` jumps the CTA straight to the relevant catalogue section.
  var BANNERS = [
    { eyebrow: "Таллинн · Mardi 1 · est 2018", t: "Профессиональный уход", s: "Kevin.Murphy, Davines, System 4 — то, чем работает команда Rempire в салоне.", c: "В каталог", cat: "hair" },
    { eyebrow: "Новинки", t: "Свежая поставка", s: "Уход и стайлинг, которые только приехали.", c: "Смотреть", cat: "styling" },
    { eyebrow: "Борода", t: "Всё для формы", s: "Масла, бальзамы и воски для ухода за бородой.", c: "В каталог", cat: "beard" },
    { eyebrow: "Лицо", t: "Ежедневный уход", s: "Очищение, увлажнение и сыворотки для кожи.", c: "Смотреть", cat: "face" },
    { eyebrow: "Rempire", t: "Мерч 666 ways", s: "Футболки с фирменным принтом.", c: "В мерч", cat: "merch" }
  ];
  function bannerImg(cat) {
    var p = CATALOGUE.filter(function (x) { return x.cat === cat; })[0];
    return p ? p.img : "";
  }

  var SHIP = {
    EE: [
      { l: "Самовывоз — Mardi 1, Таллинн", p: 0, pickup: true },
      { l: "Пакомат Omniva", p: 3.5, pm: true },
      { l: "Пакомат SmartPosti", p: 3.5, pm: true },
      { l: "Пакомат DPD", p: 3.9, pm: true },
      { l: "Курьер до двери (DPD)", p: 5.9 }
    ],
    LV: [{ l: "Пакомат Omniva", p: 4.9, pm: true }, { l: "Курьер DPD", p: 6.9 }],
    LT: [{ l: "Пакомат Omniva", p: 4.9, pm: true }, { l: "Курьер DPD", p: 6.9 }],
    FI: [{ l: "Пакомат SmartPosti", p: 5.9, pm: true }, { l: "Курьер DPD", p: 7.9 }],
    EU: [{ l: "Курьер DPD — международная", p: 12.9 }]
  };
  var MACHINES = {
    EE: ["Tallinn — Kristiine keskus", "Tallinn — Ülemiste keskus", "Tallinn — Solaris", "Tartu — Kvartal", "Pärnu — keskus"],
    LV: ["Rīga — Origo", "Rīga — Akropole", "Jūrmala — keskus"],
    LT: ["Vilnius — Akropolis", "Kaunas — Mega"],
    FI: ["Helsinki — Kamppi", "Espoo — Iso Omena"],
    EU: []
  };
  var COUNTRIES = [["EE", "Эстония"], ["LV", "Латвия"], ["LT", "Литва"], ["FI", "Финляндия"], ["EU", "Другая страна Европы"]];

  // ---------- state ----------
  var S = {
    screen: "home",
    cat: "hair",
    productId: null,
    slide: 0,
    lang: "RU",
    langOpen: false,
    cart: [],           // {id, qty, size}
    cartOpen: false,
    filterOpen: false,
    query: "",
    shown: 8,           // catalog infinite scroll
    loading: false,
    country: "EE",
    method: 0,
    promo: "",
    promoOk: false,
    promoErr: false,
    email: "",
    emailTouched: false,
    loggedIn: false,
    acctMethod: 1,      // saved default delivery in Кабинет
    acctMachine: 0,
    toast: null,
    coStep: 1,          // checkout progressive disclosure
    size: 0,
    qty: 1,
    gallery: 0,
    sort: "hit",
    onlyInStock: false,
    brandFilter: []
  };

  var LS = "rempire-shop-proto";
  try {
    var saved = JSON.parse(localStorage.getItem(LS) || "{}");
    if (saved.cart) S.cart = saved.cart;
    if (saved.lang) S.lang = saved.lang;
  } catch (e) {}
  function persist() {
    try { localStorage.setItem(LS, JSON.stringify({ cart: S.cart, lang: S.lang })); } catch (e) {}
  }

  // ---------- helpers ----------
  function eur(n) {
    return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";
  }
  function byId(id) { for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i]; return CATALOGUE[0]; }
  /* Real per-variant prices from the live shop where the catalogue has them;
     falls back to the base price for single-variant products. */
  function sizePrice(p, i) {
    if (p.prices && p.prices.length) return p.prices[Math.min(i, p.prices.length - 1)];
    return p.price;
  }
  function cartCount() { var n = 0; S.cart.forEach(function (l) { n += l.qty; }); return n; }
  function cartSum() { var s = 0; S.cart.forEach(function (l) { s += byId(l.id).price * l.qty; }); return s; }
  function threshold() { return S.country === "EU" ? 200 : 50; }
  function freeShip() { return cartSum() >= threshold(); }
  function methods() { return SHIP[S.country]; }
  function method() { var m = methods(); return m[Math.min(S.method, m.length - 1)]; }
  function shipCost() { return freeShip() ? 0 : method().p; }
  function discount() { return S.promoOk ? Math.round(cartSum() * 10) / 100 : 0; }
  function total() { return cartSum() - discount() + shipCost(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function emailBad() { return S.emailTouched && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(S.email); }

  function filtered() {
    var list = CATALOGUE.filter(function (p) { return p.cat === S.cat; });
    if (S.onlyInStock) list = list.filter(function (p) { return p.stock !== "out"; });
    if (S.brandFilter.length) list = list.filter(function (p) { return S.brandFilter.indexOf(p.brand) >= 0; });
    if (S.sort === "new") list = list.slice().reverse();
    if (S.sort === "asc") list = list.slice().sort(function (a, b) { return a.price - b.price; });
    if (S.sort === "desc") list = list.slice().sort(function (a, b) { return b.price - a.price; });
    return list;
  }
  function searchResults() {
    var q = S.query.trim().toLowerCase();
    if (!q) return [];
    return CATALOGUE.filter(function (p) {
      return (p.name + " " + p.brand).toLowerCase().indexOf(q) >= 0;
    });
  }

  // ---------- components ----------
  function cardHTML(p) {
    var price = (p.priceFrom ? "от " : "") + eur(p.price);
    var stock = p.stock === "low" ? '<span class="chip chip--low">мало</span>'
      : p.stock === "out" ? '<span class="chip chip--out">нет в наличии</span>' : "";
    return '<button class="card" data-go-product="' + p.id + '">' +
      '<span class="card__media">' +
        '<span class="card__img" style="background-image:url(\'' + p.img + '\')"></span>' +
        '<span class="card__img2" style="background-image:url(\'' + p.img2 + '\')"></span>' +
        '<span class="card__wm"></span>' +
      "</span>" +
      '<span class="card__brand">' + esc(p.brand) + "</span>" +
      '<span class="card__name">' + esc(p.name) + "</span>" +
      '<span class="card__price num">' + price + " " + stock + "</span>" +
      (p.stock === "out" ? "" : '<span class="link card__add" data-add="' + p.id + '">В корзину</span>') +
      "</button>";
  }

  /* Google Pay's "Pay" wordmark is #5F6368 — unreadable on the black express
     button. Google publishes a reverse mark for dark surfaces; this swaps the
     grey for white and leaves the four brand colours of the G untouched. */
  function gpayOnDark() {
    if (typeof PAYLOGOS === "undefined" || !PAYLOGOS.gpay) return "G Pay";
    return '<span style="display:inline-flex;height:18px;margin-left:6px">' +
      PAYLOGOS.gpay.replace(/#5F6368/gi, "#FFFFFF") + "</span>";
  }

  function payLogosHTML() {
    var order = ["bank", "visa", "mastercard", "applepay", "gpay"];
    return '<span class="paylogos">' + order.map(function (k) {
      return '<span class="paylogos__item">' + (typeof PAYLOGOS !== "undefined" && PAYLOGOS[k] ? PAYLOGOS[k] : k) + "</span>";
    }).join("") + "</span>";
  }

  function header() {
    var langMenu = S.langOpen ? '<div class="lang__menu" role="listbox">' + LANGS.map(function (l) {
      return '<button class="lang__item" role="option" aria-selected="' + (S.lang === l[0]) + '" data-lang="' + l[0] + '">' +
        '<span class="lang__flag" style="background-image:url(\'' + FLAG[l[0]] + '\')"></span>' +
        "<span style=\"flex:1\">" + l[1] + "</span>" + (S.lang === l[0] ? "<span>✓</span>" : "") + "</button>";
    }).join("") + "</div>" : "";

    return '<header class="hdr">' +
      '<div class="hdr__announce">Бесплатная доставка: EE, LV, LT, FI — от 50 € · Европа — от 200 €</div>' +
      '<div class="hdr__row">' +
        '<button class="hdr__logo" data-go="home" title="На главную" aria-label="REMPIRE — на главную">' + tower() + '<span class="hdr__word">Rempire</span></button>' +
        '<input class="hdr__search" data-search placeholder="Поиск: шампунь, Davines, воск…" value="' + esc(S.query) + '" aria-label="Поиск по магазину">' +
        '<span class="hdr__tools">' +
          '<span class="lang"><button class="lang__btn" data-langtoggle aria-label="Язык" aria-expanded="' + S.langOpen + '">' +
            '<span class="lang__flag" style="background-image:url(\'' + FLAG[S.lang] + '\')"></span><span style="font-size:9px;opacity:.6">▾</span></button>' + langMenu + "</span>" +
          '<button class="iconbtn" data-go="account" aria-label="Кабинет">' + icon("user") + "</button>" +
          '<button class="iconbtn" data-cart aria-label="Корзина">' + icon("bag") + (cartCount() ? '<span class="badge num">' + cartCount() + "</span>" : "") + "</button>" +
        "</span>" +
      "</div>" +
      '<nav class="hdr__nav" aria-label="Категории">' + CATS.map(function (c) {
        return '<button data-go-cat="' + c.id + '" aria-current="' + (S.screen === "catalog" && S.cat === c.id) + '">' + c.name + "</button>";
      }).join("") + "</nav>" +
    "</header>";
  }

  function botnav() {
    var items = [
      ["home", "home", "Главная"],
      ["catalog", "grid", "Каталог"],
      ["search", "search", "Поиск"],
      ["account", "user", "Кабинет"],
      ["cart", "bag", "Корзина"]
    ];
    return '<nav class="botnav" aria-label="Основная навигация">' + items.map(function (it) {
      var cur = it[0] === "cart" ? S.cartOpen : S.screen === it[0];
      var badge = it[0] === "cart" && cartCount() ? '<span class="badge num">' + cartCount() + "</span>" : "";
      return '<button data-' + (it[0] === "cart" ? "cart" : "go") + '="' + (it[0] === "cart" ? "1" : it[0]) + '" aria-current="' + cur + '">' +
        '<span style="position:relative;display:inline-flex">' + icon(it[1]) + badge + "</span>" + it[2] + "</button>";
    }).join("") + "</nav>";
  }

  function footer() {
    return '<footer class="ftr"><div class="wrap">' +
      '<div class="ftr__cols">' +
        '<div><span class="ftr__h">Реквизиты</span>Rempire Store OÜ<br>Рег. 12216136 · KMKR EE102723858<br>Mardi 1, 10145 Таллинн</div>' +
        '<div><span class="ftr__h">Связаться</span><a href="tel:+37256237237">56237237</a><a href="mailto:rempireshopinfo@gmail.com">rempireshopinfo@gmail.com</a><a href="https://www.instagram.com/rempire.shop/">Instagram</a></div>' +
        '<div><span class="ftr__h">Покупателю</span><a href="#">Доставка и оплата</a><a href="#">Возврат товара</a><a href="#">Условия продажи</a><a href="#">Блог и советы</a></div>' +
        '<div><span class="ftr__h">Правовое</span><a href="#">Конфиденциальность</a><a href="#">Правовая информация</a><a href="#">Настройки cookie</a><a href="https://ec.europa.eu/consumers/odr">Споры онлайн (ODR)</a></div>' +
      "</div>" +
      '<div class="ftr__bottom"><span style="display:inline-flex;gap:9px;align-items:center;white-space:nowrap">' + tower("ftr__mark") + "© 2026 Rempire Store OÜ</span>" + payLogosHTML() + "</div>" +
    "</div></footer>";
  }

  // ---------- screens ----------
  function screenHome() {
    var pop = CATALOGUE.slice(0, 8), fresh = CATALOGUE.slice(8, 16);
    return '<section class="hero">' +
      BANNERS.map(function (b, i) {
        return '<div class="hero__slide" data-on="' + (i === S.slide ? 1 : 0) + '">' +
          '<div class="hero__inner"><div class="hero__eyebrow">' + b.eyebrow + "</div>" +
          '<h2 class="hero__title">' + b.t + "</h2>" +
          '<p class="hero__sub">' + b.s + "</p>" +
          '<button class="btn" data-go-cat="' + b.cat + '">' + b.c + "</button></div>" +
          '<div class="hero__art" style="background-image:url(\'' + bannerImg(b.cat) + '\')" aria-hidden="true"></div></div>';
      }).join("") +
      '<button class="hero__arrow hero__arrow--prev" data-slide="-1" aria-label="Предыдущий баннер">‹</button>' +
      '<button class="hero__arrow hero__arrow--next" data-slide="1" aria-label="Следующий баннер">›</button>' +
      '<div class="hero__dots">' + BANNERS.map(function (b, i) {
        return '<button data-dot="' + i + '" aria-current="' + (i === S.slide) + '" aria-label="Баннер ' + (i + 1) + '"></button>';
      }).join("") + "</div></section>" +
      '<div class="wrap">' +
        '<section class="sec"><div class="sec__head"><h2 class="sec__title">Популярные товары</h2><button class="link" data-go="catalog">Все товары</button></div>' +
        '<p class="sec__intro">Салонная косметика для лица, тела и волос — то, чем команда Rempire работает каждый день.</p>' +
        '<div class="grid">' + pop.map(cardHTML).join("") + "</div></section>" +
        '<section class="sec"><div class="sec__head"><h2 class="sec__title">Новые товары</h2><button class="link" data-go="catalog">Все товары</button></div>' +
        '<p class="sec__intro">Свежие поступления: уход и стайлинг для волос и бороды, косметика для лица и новый мерч.</p>' +
        '<div class="grid">' + fresh.map(cardHTML).join("") + "</div></section>" +
        '<section class="sec"><div class="sec__head"><h2 class="sec__title">Магазин в Таллинне</h2></div>' +
        '<div style="display:grid;gap:16px 28px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));font-size:13.5px;color:var(--muted)">' +
          '<div><span class="ftr__h">Доставка</span>DPD, Omniva, SmartPosti · 1–3 дня · бесплатно от 50 €</div>' +
          '<div><span class="ftr__h">Оплата</span>Банковская ссылка, карта, Apple Pay, Google Pay</div>' +
          '<div><span class="ftr__h">Самовывоз</span>Mardi 1, Таллинн · бесплатно, заказ ждёт 7 дней</div>' +
        "</div></section>" +
      "</div>";
  }

  function screenCatalog() {
    var list = filtered(), visible = list.slice(0, S.shown);
    var cat = CATS.filter(function (c) { return c.id === S.cat; })[0];
    return '<div class="wrap">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / ' + cat.name + "</div>" +
      '<section class="sec" style="padding-top:14px">' +
        '<h1 class="display" style="font-size:22px;margin-bottom:10px">' + cat.name + "</h1>" +
        '<p class="sec__intro">Профессиональные средства, которыми команда Rempire работает в салоне. Подберите то, что подходит вашему типу волос и образу жизни.</p>' +
        '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:20px">' +
          '<button class="btn btn--ghost" style="min-height:44px;padding:0 16px" data-filter>Фильтры' + ((S.brandFilter.length || S.onlyInStock) ? " ·&nbsp;" + (S.brandFilter.length + (S.onlyInStock ? 1 : 0)) : "") + "</button>" +
          '<span class="num" style="font-size:13px;color:var(--muted)">' + list.length + " товаров</span>" +
          '<label style="margin-left:auto;font-size:13px;color:var(--muted);display:inline-flex;gap:8px;align-items:center">Сортировка' +
          '<select data-sort style="border:none;border-bottom:1px solid rgba(28,26,0,.4);background:transparent;font:inherit;font-size:13px;padding:4px 2px;min-height:44px">' +
            '<option value="hit"' + (S.sort === "hit" ? " selected" : "") + ">Хиты продаж</option>" +
            '<option value="new"' + (S.sort === "new" ? " selected" : "") + ">Новинки</option>" +
            '<option value="asc"' + (S.sort === "asc" ? " selected" : "") + ">Цена ↑</option>" +
            '<option value="desc"' + (S.sort === "desc" ? " selected" : "") + ">Цена ↓</option>" +
          "</select></label>" +
        "</div>" +
        '<div class="grid" id="catgrid">' + visible.map(cardHTML).join("") + "</div>" +
        (visible.length < list.length
          ? '<div id="sentinel" style="height:1px"></div><div class="spinner" id="catspin"></div>'
          : '<p style="text-align:center;color:var(--muted);font-size:13px;margin-top:28px">Показаны все ' + list.length + " товаров</p>") +
      "</section></div>";
  }

  function screenProduct() {
    var p = byId(S.productId);
    var imgs = [p.img, p.img2];
    var sizes = p.sizes && p.sizes.length ? p.sizes : ["один размер"];
    return '<div class="wrap">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / <button data-go-cat="' + p.cat + '">' + CATS.filter(function (c) { return c.id === p.cat; })[0].name + "</button> / " + esc(p.brand) + "</div>" +
      '<div style="display:grid;gap:26px 40px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));padding:18px 0 30px">' +
        "<div>" +
          '<div style="position:relative;aspect-ratio:1;border:1px solid var(--rule-soft);display:flex;align-items:center;justify-content:center;background:var(--page)">' +
            '<div style="position:absolute;inset:8%;background-image:url(\'' + imgs[S.gallery] + '\');background-size:contain;background-position:center;background-repeat:no-repeat;mix-blend-mode:multiply"></div>' +
            '<span class="card__wm" style="width:16px;height:25px;right:12px;bottom:12px"></span>' +
          "</div>" +
          '<div style="display:flex;gap:8px;margin-top:10px">' + imgs.map(function (im, i) {
            return '<button data-gal="' + i + '" aria-label="Фото ' + (i + 1) + '" style="width:56px;height:56px;border:1px solid ' + (i === S.gallery ? "var(--ink)" : "var(--rule)") + ';background:var(--page);cursor:pointer;position:relative"><span style="position:absolute;inset:10%;background-image:url(\'' + im + '\');background-size:contain;background-position:center;background-repeat:no-repeat;mix-blend-mode:multiply"></span></button>';
          }).join("") + "</div>" +
        "</div>" +
        "<div>" +
          '<div class="card__brand" style="margin-bottom:6px">' + esc(p.brand) + "</div>" +
          '<h1 style="font-size:clamp(19px,3.4vw,26px);margin-bottom:10px">' + esc(p.name) + "</h1>" +
          '<div class="num" style="font-size:20px;font-weight:600;margin-bottom:4px">' + eur(sizePrice(p, S.size)) + "</div>" +
          '<div style="font-size:12px;color:var(--muted);margin-bottom:18px">Налоги включены. Доставка рассчитается при оформлении.</div>' +
          (sizes.length > 1 ? '<div class="field"><span class="field__label">Объём</span><div style="display:flex;gap:8px;flex-wrap:wrap">' + sizes.map(function (sz, i) {
            return '<button data-size="' + i + '" style="min-height:44px;padding:0 16px;border:1px solid var(--ink);cursor:pointer;background:' + (i === S.size ? "var(--ink)" : "transparent") + ";color:" + (i === S.size ? "var(--paper)" : "var(--ink)") + '">' + sz + "</button>";
          }).join("") + "</div></div>" : "") +
          '<div style="display:flex;gap:12px;align-items:center;margin:18px 0">' +
            '<span style="display:inline-flex;border:1px solid var(--ink)"><button data-qty="-1" aria-label="Меньше" style="width:44px;height:48px;border:none;background:none;cursor:pointer">−</button><span class="num" style="width:44px;height:48px;display:flex;align-items:center;justify-content:center">' + S.qty + '</span><button data-qty="1" aria-label="Больше" style="width:44px;height:48px;border:none;background:none;cursor:pointer">+</button></span>' +
            '<button class="btn" style="flex:1" data-add="' + p.id + '">В корзину</button>' +
          "</div>" +
          '<button class="btn btn--wide" style="background:#000;border-color:#000;color:#fff;margin-bottom:8px" data-buynow="' + p.id + '">Купить через ' + gpayOnDark() + "</button>" +
          '<div style="text-align:center;margin-bottom:20px"><button class="link" data-checkout>Другие способы оплаты</button></div>' +
          '<div style="font-size:13px;color:var(--muted);border-top:1px solid var(--rule);padding-top:14px">Доставка 1–3 дня: DPD, Omniva, SmartPosti, курьер · бесплатно от 50 € · самовывоз на Mardi 1</div>' +
          acc("Описание", "Профессиональное средство из салонного ассортимента Rempire. Подходит для регулярного ухода.") +
          acc("Применение", "Нанести на влажные волосы, вспенить, оставить на 2–5 минут, тщательно смыть.") +
          acc("Состав (INCI)", '<span style="color:var(--muted)">Полный состав будет заполнен при переносе каталога.</span>') +
          acc("Доставка и возврат", "14 дней на возврат по закону ЕС. Вскрытая косметика возврату не подлежит по гигиеническим причинам.") +
        "</div>" +
      "</div>" +
      '<section class="sec"><div class="sec__head"><h2 class="sec__title">С этим покупают</h2></div><div class="grid">' +
        CATALOGUE.filter(function (x) { return x.cat === p.cat && x.id !== p.id; }).slice(0, 4).map(cardHTML).join("") +
      "</div></section></div>" +
      '<div class="stickybar"><span class="num" style="font-weight:600">' + eur(sizePrice(p, S.size) * S.qty) + '</span><button class="btn" data-add="' + p.id + '">В корзину</button></div>';
  }
  function acc(title, body) {
    return '<details style="border-bottom:1px solid var(--rule)"><summary style="cursor:pointer;padding:14px 0;font-size:14px;font-weight:500;list-style:none">' + title + '</summary><div style="font-size:13.5px;color:rgba(28,26,0,.75);padding-bottom:14px">' + body + "</div></details>";
  }

  function screenSearch() {
    var res = searchResults();
    return '<div class="wrap"><section class="sec">' +
      '<h1 class="display" style="font-size:20px;margin-bottom:16px">Поиск</h1>' +
      '<input class="input input--box" data-search2 value="' + esc(S.query) + '" placeholder="Что ищете?" aria-label="Поиск" style="font-size:16px;margin-bottom:16px">' +
      (!S.query.trim()
        ? '<p style="color:var(--muted);font-size:13.5px">Популярные запросы: ' + ["шампунь", "Davines", "воск", "борода"].map(function (q) { return '<button class="link" data-q="' + q + '">' + q + "</button>"; }).join(" · ") + "</p>"
        : res.length
          ? '<p style="color:var(--muted);font-size:13px;margin-bottom:16px" class="num">' + res.length + ' товаров</p><div class="grid">' + res.map(cardHTML).join("") + "</div>"
          : '<div style="border:1px solid var(--rule);padding:22px"><p style="margin:0 0 10px">По запросу «' + esc(S.query) + '» ничего не нашлось.</p>' +
            '<p style="margin:0 0 14px;color:var(--muted);font-size:13.5px">Проверьте написание или посмотрите категории:</p>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' + CATS.slice(0, 4).map(function (c) { return '<button class="btn btn--ghost" style="min-height:40px;padding:0 14px;font-size:11px" data-go-cat="' + c.id + '">' + c.name + "</button>"; }).join("") + "</div>" +
            '<p style="margin:14px 0 0;font-size:12px;color:var(--muted)">Напишите нам — поможем подобрать замену.</p></div>') +
      "</section></div>";
  }

  function screenAccount() {
    if (!S.loggedIn) {
      return '<div class="wrap" style="max-width:520px"><section class="sec">' +
        '<h1 class="display" style="font-size:20px;margin-bottom:8px">Кабинет</h1>' +
        '<p style="color:var(--muted);font-size:13.5px;margin-bottom:20px">Вход без пароля — пришлём код на почту. Покупать можно и без аккаунта.</p>' +
        '<label class="field"><span class="field__label">E-mail</span><input class="input" type="email" autocomplete="email" inputmode="email" data-email placeholder="you@example.com" value="' + esc(S.email) + '"></label>' +
        '<button class="btn btn--wide" data-login>Получить код</button>' +
        "</section></div>";
    }
    var m = methods();
    return '<div class="wrap" style="max-width:640px"><section class="sec">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><h1 class="display" style="font-size:20px">Кабинет</h1><button class="link" data-logout>Выйти</button></div>' +
      '<div class="sec__head" style="margin-top:24px"><h2 class="sec__title">Мои данные</h2></div>' +
      '<label class="field"><span class="field__label">Имя</span><input class="input" value="Renat"></label>' +
      '<label class="field"><span class="field__label">E-mail</span><input class="input" value="' + esc(S.email || "renat@example.com") + '"></label>' +
      '<button class="btn btn--ghost" style="min-height:44px" data-save>Сохранить</button>' +

      '<div class="sec__head" style="margin-top:32px"><h2 class="sec__title">Доставка по умолчанию</h2></div>' +
      '<p style="color:var(--muted);font-size:13px;margin:0 0 10px">Подставим это при следующем заказе — менять можно в любой момент.</p>' +
      '<div style="border:1px solid var(--rule)">' + m.map(function (x, i) {
        return '<label class="opt" style="padding-inline:12px"><input type="radio" name="acctm" ' + (i === S.acctMethod ? "checked" : "") + ' data-acctm="' + i + '"><span>' + x.l + "</span>" + (x.p ? '<span class="opt__price num">' + eur(x.p) + "</span>" : '<span class="opt__price">0 €</span>') + "</label>";
      }).join("") + "</div>" +
      (m[S.acctMethod] && m[S.acctMethod].pm
        ? '<label class="field" style="margin-top:12px"><span class="field__label">Пакомат по умолчанию</span><select class="input input--box" data-acctmachine>' + MACHINES[S.country].map(function (n, i) { return '<option' + (i === S.acctMachine ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label>"
        : "") +

      '<div class="sec__head" style="margin-top:32px"><h2 class="sec__title">Мои заказы</h2></div>' +
      '<div style="border:1px solid var(--rule);padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
        '<span class="num" style="font-weight:600">#1042</span><span style="font-size:13px;color:var(--muted)">12.08.2026 · 54 €</span>' +
        '<span class="chip" style="color:var(--ok)">доставлен</span>' +
        '<button class="link" style="margin-left:auto" data-repeat>Повторить заказ</button></div>' +

      '<div class="sec__head" style="margin-top:32px"><h2 class="sec__title">Мои промокоды</h2></div>' +
      '<div style="border:1px solid var(--rule);padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
        '<span class="display" style="font-size:13px;letter-spacing:.08em">DR-RENAT10</span>' +
        '<span style="font-size:13px;color:var(--muted)">−10% ко дню рождения · до 30.09</span>' +
        '<span class="chip" style="margin-left:auto;color:var(--ok)">активен</span></div>' +
      "</section></div>";
  }

  function screenCheckout() {
    var m = methods(), sel = method();
    var step = S.coStep;
    function head(n, title, done) {
      return '<button class="sec__head" data-step="' + n + '" style="width:100%;background:none;border:none;border-bottom:1px solid var(--ink);cursor:pointer;text-align:left;padding:0 0 8px;margin-bottom:' + (step === n ? "16px" : "0") + '">' +
        '<span class="sec__title">' + n + " · " + title + "</span>" +
        '<span style="font-size:12px;color:var(--muted);font-weight:400">' + (step === n ? "" : done || "изменить") + "</span></button>";
    }
    return '<div class="wrap" style="max-width:980px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid var(--rule);margin-bottom:20px">' +
        '<button class="hdr__logo" data-go="home" aria-label="REMPIRE — на главную">' + tower() + '<span class="hdr__word">Rempire</span></button>' +
        '<button class="link" data-go="home">← В магазин</button></div>' +
      '<div style="display:grid;gap:30px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))">' +
        "<div>" +
          // 1 contact
          head(1, "Контакт", esc(S.email || "—")) +
          (step === 1 ? '<div style="margin-bottom:26px">' +
            '<label class="field"><span class="field__label">E-mail для подтверждения заказа</span>' +
            '<input class="input" type="email" autocomplete="email" data-email value="' + esc(S.email) + '" aria-invalid="' + emailBad() + '" placeholder="you@example.com" inputmode="email"></label>' +
            (emailBad() ? '<div class="err">Похоже, в адресе опечатка — проверьте домен.</div>' : '<div class="hint">Аккаунт не нужен — оформляйте как гость.</div>') +
            '<label class="opt" style="border:none;padding-left:0"><input type="checkbox"><span style="font-size:13.5px">Хочу получать новости и скидки</span></label>' +
            '<button class="btn" data-step="2" style="margin-top:8px">Далее — доставка</button></div>' : "") +

          // 2 delivery
          head(2, "Доставка", sel.l) +
          (step === 2 ? '<div style="margin-bottom:26px">' +
            '<label class="field"><span class="field__label">Страна</span><select class="input input--box" data-country>' +
              COUNTRIES.map(function (c) { return '<option value="' + c[0] + '"' + (S.country === c[0] ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + "</select></label>" +
            '<div style="border:1px solid var(--rule);margin-bottom:10px">' + m.map(function (x, i) {
              return '<label class="opt" style="padding-inline:12px"><input type="radio" name="ship" ' + (i === S.method ? "checked" : "") + ' data-method="' + i + '"><span>' + x.l + "</span>" +
                '<span class="opt__price num">' + (freeShip() || !x.p ? "0 €" : eur(x.p)) + "</span></label>";
            }).join("") + "</div>" +
            (sel.pickup ? '<div class="hint" style="margin-bottom:10px">Забрать бесплатно на Mardi 1. Нужен документ. Заказ ждёт 7 дней, дальше 1,50 € в день.</div>' : "") +
            (sel.pm ? '<label class="field"><span class="field__label">Пакомат</span><select class="input input--box">' + MACHINES[S.country].map(function (n) { return "<option>" + n + "</option>"; }).join("") + "</select></label>" : "") +
            '<div class="hint" style="margin-bottom:14px">' + (freeShip() ? "Бесплатная доставка применена ✓" : "Бесплатная доставка от " + threshold() + " € — не хватает " + eur(threshold() - cartSum())) + "</div>" +
            (sel.pickup ? "" :
              '<label class="field"><span class="field__label">Имя и фамилия</span><input class="input" placeholder="Renat Gayanov"></label>' +
              (sel.pm ? "" : '<label class="field"><span class="field__label">Адрес</span><input class="input" placeholder="Mardi 1"></label><div style="display:grid;grid-template-columns:110px 1fr;gap:12px"><label class="field"><span class="field__label">Индекс</span><input class="input" placeholder="10145"></label><label class="field"><span class="field__label">Город</span><input class="input" placeholder="Таллинн"></label></div>')) +
            '<label class="field"><span class="field__label">Телефон</span><input class="input" placeholder="+372…" inputmode="tel"></label>' +
            '<button class="btn" data-step="3">Далее — оплата</button></div>' : "") +

          // 3 payment
          head(3, "Оплата", "") +
          (step === 3 ? '<div style="margin-bottom:26px"><div style="border:1px solid var(--rule)">' +
            ["Банковская ссылка", "Банковская карта", "Apple Pay / Google Pay", "По счёту — для компаний"].map(function (o, i) {
              return '<label class="opt" style="padding-inline:12px"><input type="radio" name="pay" ' + (i === 0 ? "checked" : "") + "><span>" + o + "</span></label>";
            }).join("") + "</div>" +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' + ["Swedbank", "SEB", "LHV", "Luminor", "Coop"].map(function (b, i) {
              return '<span style="border:1px solid ' + (i === 0 ? "var(--ink)" : "var(--rule)") + ';padding:8px 12px;font-size:12.5px">' + b + "</span>";
            }).join("") + "</div></div>" : "") +
        "</div>" +

        // summary
        '<div><div style="border:1px solid var(--rule);padding:18px;position:sticky;top:20px;display:flex;flex-direction:column;gap:12px">' +
          '<h2 class="sec__title">Ваш заказ</h2>' +
          (S.cart.length ? S.cart.map(function (l) {
            var p = byId(l.id);
            return '<div style="display:flex;gap:11px;align-items:center"><span style="width:44px;height:44px;border:1px solid var(--rule-soft);flex-shrink:0;position:relative"><span style="position:absolute;inset:10%;background-image:url(\'' + p.img + '\');background-size:contain;background-position:center;background-repeat:no-repeat;mix-blend-mode:multiply"></span></span>' +
              '<span style="flex:1;font-size:13px">' + esc(p.name) + " × " + l.qty + "</span>" +
              '<span class="num" style="font-size:13px;font-weight:600">' + eur(p.price * l.qty) + "</span></div>";
          }).join("") : '<p style="color:var(--muted);font-size:13px">Корзина пуста.</p>') +
          '<div style="border-top:1px solid var(--rule);padding-top:12px"><div style="display:flex;gap:8px"><input class="input input--box" data-promo placeholder="Промокод" value="' + esc(S.promo) + '" style="flex:1;min-height:44px"><button class="btn btn--ghost" style="min-height:44px;padding:0 14px" data-applypromo>Применить</button></div>' +
          (S.promoErr ? '<div class="err">Код не найден — проверьте написание.</div>' : "") +
          (S.promoOk ? '<div style="display:flex;justify-content:space-between;font-size:13px;margin-top:8px"><span>REMPIRE10 — скидка 10%</span><span class="num" style="font-weight:600">−' + eur(discount()) + "</span></div>" : "") + "</div>" +
          '<div style="display:flex;justify-content:space-between;font-size:13px;border-top:1px solid var(--rule);padding-top:12px"><span>Доставка — ' + sel.l + '</span><span class="num">' + (shipCost() ? eur(shipCost()) : "Бесплатно") + "</span></div>" +
          '<div style="display:flex;justify-content:space-between;font-size:16px;font-weight:600;border-top:1px solid var(--ink);padding-top:12px"><span>Итого</span><span class="num">' + eur(total()) + "</span></div>" +
          '<button class="btn btn--wide" data-pay>Оплатить ' + eur(total()) + "</button>" +
          '<p style="font-size:11px;color:var(--muted);margin:0">Нажимая «Оплатить», вы соглашаетесь с условиями и политикой возврата.</p>' +
        "</div></div>" +
      "</div></div>" +
      '<div class="stickybar"><span><span style="display:block;font-size:11px;color:var(--muted)">Итого</span><span class="num" style="font-weight:600;font-size:16px">' + eur(total()) + '</span></span><button class="btn" data-pay>Оплатить</button></div>';
  }

  function screenDone() {
    return '<div class="wrap" style="max-width:520px;text-align:center"><section class="sec">' +
      '<div style="color:var(--ok);font-size:34px;margin-bottom:10px">✓</div>' +
      '<h1 class="display" style="font-size:20px;margin-bottom:10px">Заказ оформлен</h1>' +
      '<p style="color:var(--muted);font-size:14px;margin-bottom:22px">Это демонстрация — настоящий заказ не создан. В рабочем магазине сюда придёт номер заказа, счёт на почту и трекинг посылки.</p>' +
      '<button class="btn" data-go="home">На главную</button></section></div>';
  }

  function cartDrawer() {
    var sum = cartSum(), thr = threshold(), pct = Math.min(100, sum / thr * 100);
    return '<div class="scrim" data-closecart></div><aside class="drawer drawer--right" aria-label="Корзина">' +
      '<div class="drawer__head"><span class="display" style="font-size:13px">Корзина (' + cartCount() + ')</span>' +
      '<button class="iconbtn" data-closecart aria-label="Закрыть">✕</button></div>' +
      '<div class="drawer__body">' +
        (S.cart.length ? S.cart.map(function (l) {
          var p = byId(l.id);
          return '<div style="display:flex;gap:12px;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--rule)">' +
            '<span style="width:60px;height:60px;border:1px solid var(--rule-soft);flex-shrink:0;position:relative"><span style="position:absolute;inset:10%;background-image:url(\'' + p.img + '\');background-size:contain;background-position:center;background-repeat:no-repeat;mix-blend-mode:multiply"></span></span>' +
            '<span style="flex:1"><span style="display:block;font-size:13.5px;margin-bottom:6px">' + esc(p.brand) + " " + esc(p.name) + "</span>" +
            '<span style="display:inline-flex;border:1px solid var(--rule)"><button data-line="' + l.id + '" data-d="-1" aria-label="Меньше" style="width:36px;height:36px;border:none;background:none;cursor:pointer">−</button><span class="num" style="width:34px;height:36px;display:flex;align-items:center;justify-content:center;font-size:13px">' + l.qty + '</span><button data-line="' + l.id + '" data-d="1" aria-label="Больше" style="width:36px;height:36px;border:none;background:none;cursor:pointer">+</button></span> ' +
            '<button class="link" style="font-size:12px;margin-left:8px" data-remove="' + l.id + '">Убрать</button></span>' +
            '<span class="num" style="font-weight:600;font-size:13.5px">' + eur(p.price * l.qty) + "</span></div>";
        }).join("") : '<p style="color:var(--muted);font-size:14px">Пока пусто. <button class="link" data-go="catalog">К бестселлерам</button></p>') +
        (S.cart.length ? '<div style="margin-top:6px"><div style="height:3px;background:var(--shell)"><div style="height:3px;background:var(--ink);width:' + pct + '%;transition:width .3s var(--ease)"></div></div>' +
          '<p style="font-size:12px;color:var(--muted);margin:8px 0 0">' + (sum >= thr ? "Бесплатная доставка — порог " + thr + " € достигнут ✓" : "До бесплатной доставки (" + (S.country === "EU" ? "Европа" : "EE, LV, LT, FI") + ") — ещё " + eur(thr - sum)) + "</p></div>" : "") +
      "</div>" +
      (S.cart.length ? '<div class="drawer__foot"><div style="display:flex;justify-content:space-between;font-weight:600"><span>Итого</span><span class="num">' + eur(sum) + "</span></div>" +
        '<button class="btn btn--wide" data-checkout>Оформить заказ</button>' +
        '<button class="link" style="align-self:center" data-closecart>Продолжить покупки</button></div>' : "") +
      "</aside>";
  }

  function filterDrawer() {
    var brands = [];
    CATALOGUE.forEach(function (p) { if (p.cat === S.cat && brands.indexOf(p.brand) < 0) brands.push(p.brand); });
    function count(b) { return CATALOGUE.filter(function (p) { return p.cat === S.cat && p.brand === b; }).length; }
    var inStock = CATALOGUE.filter(function (p) { return p.cat === S.cat && p.stock !== "out"; }).length;
    return '<div class="scrim" data-closefilter></div><aside class="drawer drawer--left" aria-label="Фильтры">' +
      '<div class="drawer__head"><span class="display" style="font-size:13px">Фильтры</span><button class="iconbtn" data-closefilter aria-label="Закрыть">✕</button></div>' +
      '<div class="drawer__body">' +
        '<div class="field__label">Наличие</div><label class="opt"><input type="checkbox" data-instock ' + (S.onlyInStock ? "checked" : "") + '><span>В наличии</span><span class="opt__price num" style="font-weight:400;color:var(--muted)">' + inStock + "</span></label>" +
        '<div class="field__label" style="margin-top:20px">Бренд</div>' +
        brands.map(function (b) {
          return '<label class="opt"><input type="checkbox" data-brand="' + esc(b) + '" ' + (S.brandFilter.indexOf(b) >= 0 ? "checked" : "") + "><span>" + esc(b) + '</span><span class="opt__price num" style="font-weight:400;color:var(--muted)">' + count(b) + "</span></label>";
        }).join("") +
      "</div>" +
      '<div class="drawer__foot"><button class="btn btn--wide" data-closefilter>Показать ' + filtered().length + " товаров</button>" +
      '<button class="link" style="align-self:center" data-clearfilter>Сбросить</button></div></aside>';
  }

  // ---------- render ----------
  var app = document.getElementById("app");

  function render() {
    var body;
    if (S.screen === "home") body = screenHome();
    else if (S.screen === "catalog") body = screenCatalog();
    else if (S.screen === "product") body = screenProduct();
    else if (S.screen === "search") body = screenSearch();
    else if (S.screen === "account") body = screenAccount();
    else if (S.screen === "checkout") body = screenCheckout();
    else if (S.screen === "done") body = screenDone();

    var chromeless = S.screen === "checkout" || S.screen === "done";
    app.innerHTML =
      (chromeless ? "" : header()) +
      '<main class="screen">' + body + "</main>" +
      (chromeless ? "" : footer()) +
      botnav() +
      (S.cartOpen ? cartDrawer() : "") +
      (S.filterOpen ? filterDrawer() : "") +
      (S.toast ? '<div class="toast"><span style="flex:1;font-size:13px">' + S.toast + '</span><button class="iconbtn" style="color:var(--paper);min-width:32px;min-height:32px;padding:4px" data-closetoast aria-label="Закрыть">✕</button></div>' : "");

    if (S.screen === "catalog") observeSentinel();
  }

  function go(screen) {
    S.screen = screen; S.cartOpen = false; S.filterOpen = false; S.langOpen = false;
    if (screen === "catalog") S.shown = 8;
    if (screen === "checkout") S.coStep = 1;
    window.scrollTo({ top: 0 });
    render();
  }

  function toast(msg) {
    S.toast = msg; render();
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { S.toast = null; render(); }, 3000);
  }

  function addToCart(id) {
    var line = null;
    S.cart.forEach(function (l) { if (l.id === id) line = l; });
    if (line) line.qty = Math.min(9, line.qty + 1);
    else S.cart.push({ id: id, qty: 1 });
    persist();
    toast("Добавлено в корзину ✓");
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
      setTimeout(function () {
        S.shown += 8; S.loading = false; render();
      }, 400);
    }, { rootMargin: "220px" });
    io.observe(el);
  }

  // ---------- events ----------
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-go],[data-go-cat],[data-go-product],[data-add],[data-cart],[data-closecart],[data-filter],[data-closefilter],[data-clearfilter],[data-slide],[data-dot],[data-langtoggle],[data-lang],[data-line],[data-remove],[data-checkout],[data-pay],[data-step],[data-method],[data-acctm],[data-size],[data-qty],[data-gal],[data-login],[data-logout],[data-save],[data-repeat],[data-applypromo],[data-q],[data-buynow],[data-closetoast]");
    if (!t) {
      if (S.langOpen) { S.langOpen = false; render(); }
      return;
    }
    var d = t.dataset;

    if (d.go) { go(d.go); return; }
    if (d.goCat !== undefined) { S.cat = d.goCat; go("catalog"); return; }
    if (d.goProduct) { S.productId = d.goProduct; S.size = 0; S.qty = 1; S.gallery = 0; go("product"); return; }
    if (d.add) { e.stopPropagation(); addToCart(d.add); return; }
    if (d.buynow) { addToCart(d.buynow); go("checkout"); return; }
    if (d.cart !== undefined) { S.cartOpen = true; render(); return; }
    if (d.closecart !== undefined) { S.cartOpen = false; render(); return; }
    if (d.filter !== undefined) { S.filterOpen = true; render(); return; }
    if (d.closefilter !== undefined) { S.filterOpen = false; render(); return; }
    if (d.clearfilter !== undefined) { S.brandFilter = []; S.onlyInStock = false; render(); return; }
    if (d.slide) { S.slide = (S.slide + Number(d.slide) + BANNERS.length) % BANNERS.length; render(); return; }
    if (d.dot !== undefined) { S.slide = Number(d.dot); render(); return; }
    if (d.langtoggle !== undefined) { S.langOpen = !S.langOpen; render(); return; }
    if (d.lang) { S.lang = d.lang; S.langOpen = false; persist(); render(); return; }
    if (d.line) {
      S.cart.forEach(function (l) { if (l.id === d.line) l.qty = Math.max(1, Math.min(9, l.qty + Number(d.d))); });
      persist(); render(); return;
    }
    if (d.remove) { S.cart = S.cart.filter(function (l) { return l.id !== d.remove; }); persist(); render(); return; }
    if (d.checkout !== undefined) { if (!S.cart.length) { toast("Корзина пуста"); return; } go("checkout"); return; }
    if (d.pay !== undefined) {
      // A prototype still shouldn't let you "pay" with nothing filled in.
      S.emailTouched = true;
      if (emailBad()) { S.coStep = 1; render(); toast("Проверьте e-mail — на него придёт заказ"); return; }
      S.cart = []; persist(); go("done"); return;
    }
    if (d.step) { S.coStep = Number(d.step); render(); return; }
    if (d.method) { S.method = Number(d.method); render(); return; }
    if (d.acctm) { S.acctMethod = Number(d.acctm); render(); return; }
    if (d.size) { S.size = Number(d.size); render(); return; }
    if (d.qty) { S.qty = Math.max(1, Math.min(9, S.qty + Number(d.qty))); render(); return; }
    if (d.gal !== undefined) { S.gallery = Number(d.gal); render(); return; }
    if (d.login !== undefined) { S.loggedIn = true; render(); return; }
    if (d.logout !== undefined) { S.loggedIn = false; render(); return; }
    if (d.save !== undefined) { toast("Сохранено ✓"); return; }
    if (d.repeat !== undefined) { addToCart(CATALOGUE[0].id); return; }
    if (d.applypromo !== undefined) {
      var ok = S.promo.trim().toUpperCase() === "REMPIRE10";
      S.promoOk = ok; S.promoErr = !ok; render(); return;
    }
    if (d.q) { S.query = d.q; go("search"); return; }
    if (d.closetoast !== undefined) { S.toast = null; render(); return; }
  });

  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.matches("[data-search]")) { S.query = t.value; if (S.screen !== "search") { go("search"); var f = document.querySelector("[data-search2]"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } } else render(); }
    else if (t.matches("[data-search2]")) { S.query = t.value; var pos = t.selectionStart; render(); var n = document.querySelector("[data-search2]"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
    else if (t.matches("[data-email]")) { S.email = t.value; }
    else if (t.matches("[data-promo]")) { S.promo = t.value; S.promoErr = false; }
    else if (t.matches("[data-instock]")) { S.onlyInStock = t.checked; S.shown = 8; render(); }
    else if (t.matches("[data-brand]")) {
      var b = t.dataset.brand;
      if (t.checked) S.brandFilter.push(b); else S.brandFilter = S.brandFilter.filter(function (x) { return x !== b; });
      S.shown = 8; render();
    }
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches("[data-country]")) { S.country = t.value; S.method = 0; render(); }
    else if (t.matches("[data-sort]")) { S.sort = t.value; S.shown = 8; render(); }
    else if (t.matches("[data-acctmachine]")) { S.acctMachine = t.selectedIndex; }
  });

  document.addEventListener("blur", function (e) {
    if (e.target.matches("[data-email]")) { S.emailTouched = true; if (S.screen === "checkout") render(); }
  }, true);

  // intro — once per session, skippable, off under reduced motion
  function intro() {
    var reduce = false;
    try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var seen = false;
    try { seen = sessionStorage.getItem("rempire-intro") === "1"; } catch (e) {}
    if (reduce || seen) return;
    var el = document.createElement("div");
    el.className = "intro";
    el.setAttribute("title", "Пропустить");
    el.innerHTML = towerDraw() + '<div class="intro__word">Rempire</div>';
    document.body.appendChild(el);
    try { sessionStorage.setItem("rempire-intro", "1"); } catch (e) {}
    var kill = function () { el.classList.add("intro--out"); setTimeout(function () { el.remove(); }, 500); };
    el.addEventListener("click", kill);
    setTimeout(kill, 2600);
  }

  // hero autoplay — pauses on hidden tab, off under reduced motion
  setInterval(function () {
    if (S.screen !== "home" || document.hidden || S.cartOpen || S.filterOpen) return;
    try { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
    S.slide = (S.slide + 1) % BANNERS.length;
    var slides = document.querySelectorAll(".hero__slide");
    var dots = document.querySelectorAll(".hero__dots button");
    if (!slides.length) return;
    slides.forEach(function (s, i) { s.setAttribute("data-on", i === S.slide ? "1" : "0"); });
    dots.forEach(function (b, i) { b.setAttribute("aria-current", i === S.slide); });
  }, 5000);

  render();
  intro();
})();
