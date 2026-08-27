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
    home: '<path d="M4 11l8-7 8 7v9h-5.4v-6H9.4v6H4z"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    search: '<path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16.2 16.2L21 21"/>',
    user: '<path d="M12 4a3.6 3.6 0 1 1 0 7.2A3.6 3.6 0 0 1 12 4zM4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/>',
    bag: '<path d="M5.5 8.5h13l-.9 11a1.8 1.8 0 0 1-1.8 1.6H8.2a1.8 1.8 0 0 1-1.8-1.6zM8.8 8.5V7a3.2 3.2 0 0 1 6.4 0v1.5"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>'
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

  var CATS = Object.keys(CAT_NAMES).map(function (k) { return { id: k, name: CAT_NAMES[k] }; });

  var BANNERS = [
    { eyebrow: "Таллинн · Mardi 1 · est 2018", t: "Профессиональный уход", s: "Kevin.Murphy, Davines, System 4 — то, чем работает команда Rempire в салоне.", c: "В каталог", cat: "hair" },
    { eyebrow: "Новинки", t: "Свежая поставка", s: "Уход и стайлинг, которые только приехали.", c: "Смотреть", cat: "styling" },
    { eyebrow: "Борода", t: "Всё для формы", s: "Масла, бальзамы и воски для ухода за бородой.", c: "В каталог", cat: "beard" },
    { eyebrow: "Парфюмерия", t: "Ниша и классика", s: "Creed, Tom Ford, Xerjoff, Byredo — то, что держим в наличии.", c: "Смотреть", cat: "perfume" },
    { eyebrow: "Rempire", t: "Мерч 666 ways", s: "Футболки с фирменным принтом.", c: "В мерч", cat: "merch" }
  ];
  function bannerProduct(cat) {
    var l = CATALOGUE.filter(function (x) { return x.cat === cat && x.stock !== "out"; });
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
    EU: [{ l: "Курьер DPD — международная", p: 26 }]
  };
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
    { l: "По счёту — для компаний", h: "Счёт на е-мейл, оплата в течение 7 дней", k: "invoice" }
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
    loggedIn: false,
    acctMethod: 1,
    acctMachine: 0,
    toast: null,
    coStep: 1,
    pay: 0,
    bank: 0,
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
  function sizePrice(p, i) {
    if (p.prices && p.prices.length) return p.prices[Math.min(i, p.prices.length - 1)];
    return p.price;
  }
  function gal(p) { return p.gallery && p.gallery.length ? p.gallery : [p.img]; }
  function cartCount() { var n = 0; S.cart.forEach(function (l) { n += l.qty; }); return n; }
  function cartSum() { var s = 0; S.cart.forEach(function (l) { s += sizePrice(byId(l.id), l.size || 0) * l.qty; }); return s; }
  function threshold() { return S.country === "EU" ? 200 : 50; }
  function freeShip() { return cartSum() >= threshold(); }
  function methods() { return SHIP[S.country]; }
  function method() { var m = methods(); return m[Math.min(S.method, m.length - 1)]; }
  function shipCost() { return freeShip() ? 0 : method().p; }
  function discount() { return S.promoOk ? Math.round(cartSum() * 10) / 100 : 0; }
  function total() { return cartSum() - discount() + shipCost(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function emailBad() { return S.emailTouched && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(S.email); }
  function wide() { try { return matchMedia("(min-width: 768px)").matches; } catch (e) { return true; } }

  function filtered() {
    var list = S.cat === "all" ? CATALOGUE.slice() : CATALOGUE.filter(function (p) { return p.cat === S.cat; });
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
      return (p.name + " " + p.brand + " " + CAT_NAMES[p.cat]).toLowerCase().indexOf(q) >= 0;
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
    return '<button class="card" data-go-product="' + p.id + '">' +
      '<span class="card__media">' +
        media(p, 0, "ph card__img") +
        (g.length > 1 ? media(p, 1, "ph card__img2") : "") +
        '<span class="card__wm"></span>' +
      "</span>" +
      '<span class="card__brand">' + esc(p.brand) + "</span>" +
      '<span class="card__name">' + esc(p.name) + "</span>" +
      '<span class="card__price num">' + price + " " + stock + "</span>" +
      (p.stock === "out" ? "" : '<span class="link card__add" data-add="' + p.id + '">В корзину</span>') +
      "</button>";
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
      '<div class="hdr__announce"><span class="wide-only">Бесплатная доставка: EE, LV, LT, FI — от 50 € · Европа — от 200 €</span>' +
        '<span class="narrow-only">Бесплатная доставка от 50 €</span></div>' +
      '<div class="hdr__row">' +
        '<button class="hdr__logo" data-go="home" data-ident title="На главную" aria-label="REMPIRE — на главную">' +
          towerDraw("hdr__tower") + '<span class="hdr__word">Rempire</span></button>' +
        '<div class="hdr__searchwrap">' +
          '<span class="hdr__searchicon">' + icon("search") + "</span>" +
          '<input class="hdr__search" data-search placeholder="Поиск: шампунь, Davines, воск…" aria-label="Поиск по магазину">' +
        "</div>" +
        '<span class="hdr__tools">' +
          '<span class="lang"><button class="lang__btn" data-langtoggle aria-label="Язык" aria-expanded="false">' +
            '<span class="lang__flag" data-langflag></span><span class="lang__caret" aria-hidden="true">▾</span></button>' +
            '<div class="lang__menuslot"></div></span>' +
          '<button class="iconbtn" data-go="account" aria-label="Кабинет">' + icon("user") + "</button>" +
          '<button class="iconbtn" data-cart aria-label="Корзина">' + icon("bag") + '<span data-cartbadge></span></button>' +
        "</span>" +
      "</div>" +
      '<nav class="hdr__nav" aria-label="Категории">' +
        '<button data-go-cat="all">Все товары</button>' +
        CATS.map(function (c) { return '<button data-go-cat="' + c.id + '">' + c.name + "</button>"; }).join("") +
      "</nav></header>";
  }

  function patchHeader() {
    var h = hdrSlot;
    if (!h.firstChild) return;
    var badge = h.querySelector("[data-cartbadge]");
    badge.outerHTML = cartCount()
      ? '<span class="badge num" data-cartbadge>' + cartCount() + "</span>"
      : '<span data-cartbadge hidden></span>';
    h.querySelector("[data-langflag]").style.backgroundImage = "url('" + FLAG[S.lang] + "')";
    h.querySelector("[data-langtoggle]").setAttribute("aria-expanded", String(S.langOpen));
    h.querySelector(".lang__menuslot").innerHTML = S.langOpen
      ? '<div class="lang__menu" role="listbox">' + LANGS.map(function (l) {
          return '<button class="lang__item" role="option" aria-selected="' + (S.lang === l[0]) + '" data-lang="' + l[0] + '">' +
            '<span class="lang__flag" style="background-image:url(\'' + FLAG[l[0]] + '\')"></span>' +
            '<span style="flex:1">' + l[1] + "</span>" + (S.lang === l[0] ? "<span>✓</span>" : "") + "</button>";
        }).join("") + "</div>"
      : "";
    var srch = h.querySelector("[data-search]");
    if (document.activeElement !== srch) srch.value = S.query;
    h.querySelectorAll(".hdr__nav button").forEach(function (b) {
      b.setAttribute("aria-current", String(S.screen === "catalog" && S.cat === b.dataset.goCat));
    });
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
        '<span class="botnav__ico">' + icon(it[1]) + '<span data-navbadge="' + it[0] + '"></span></span>' + it[2] + "</button>";
    }).join("") + "</nav>";
  }
  function patchNav() {
    if (!navSlot.firstChild) return;
    navSlot.querySelectorAll("[data-nav]").forEach(function (b) {
      var k = b.dataset.nav;
      b.setAttribute("aria-current", String(k === "cart" ? S.cartOpen : S.screen === k));
    });
    var nb = navSlot.querySelector('[data-navbadge="cart"]');
    nb.outerHTML = cartCount()
      ? '<span class="badge num" data-navbadge="cart">' + cartCount() + "</span>"
      : '<span data-navbadge="cart" hidden></span>';
  }

  function footer() {
    return '<footer class="ftr"><div class="wrap">' +
      '<div class="ftr__cols">' +
        '<div><span class="ftr__h">Реквизиты</span>Rempire Store OÜ<br>Рег. 12216136 · KMKR EE102723858<br>Mardi 1, 10145 Таллинн</div>' +
        '<div><span class="ftr__h">Связаться</span><a href="tel:+37256237237">56237237</a><a href="mailto:rempireshopinfo@gmail.com">rempireshopinfo@gmail.com</a><a href="https://www.instagram.com/rempire.shop/">Instagram</a></div>' +
        '<div><span class="ftr__h">Покупателю</span><a href="#">Доставка и оплата</a><a href="#">Возврат товара</a><a href="#">Условия продажи</a><a href="#">Блог и советы</a></div>' +
        '<div><span class="ftr__h">Правовое</span><a href="#">Конфиденциальность</a><a href="#">Правовая информация</a><a href="#">Настройки cookie</a><a href="https://ec.europa.eu/consumers/odr">Споры онлайн (ODR)</a></div>' +
      "</div>" +
      '<div class="ftr__bottom"><span class="ftr__sig">' + tower("ftr__mark") + "© 2026 Rempire Store OÜ</span>" + payLogosHTML() + "</div>" +
    "</div></footer>";
  }

  // ---------- screens ----------
  function screenHome() {
    var pop = spread(8, false), fresh = spread(8, true);
    return '<section class="hero" aria-roledescription="карусель">' +
      BANNERS.map(function (b, i) {
        var p = bannerProduct(b.cat);
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
      '<div class="hero__dots">' + BANNERS.map(function (b, i) {
        return '<button data-dot="' + i + '" aria-current="' + (i === S.slide) + '" aria-label="Баннер ' + (i + 1) + '"></button>';
      }).join("") + "</div></section>" +
      '<div class="wrap">' +
        rail("Популярные товары", "Салонная косметика для лица, тела и волос — то, чем команда Rempire работает каждый день.", pop) +
        rail("Новые товары", "Свежие поступления: уход и стайлинг, парфюмерия и новый мерч.", fresh) +
        '<section class="sec"><div class="sec__head"><h2 class="sec__title">Категории</h2></div>' +
        '<div class="cattiles">' + CATS.map(function (c) {
          var p = bannerProduct(c.id);
          return '<button class="cattile" data-go-cat="' + c.id + '">' +
            '<span class="cattile__shot">' + media(p, 0, "ph cattile__img") + "</span>" +
            '<span class="cattile__name">' + c.name + "</span>" +
            '<span class="cattile__n num">' + CATALOGUE.filter(function (x) { return x.cat === c.id; }).length + " товаров</span></button>";
        }).join("") + "</div></section>" +
        '<section class="sec"><div class="sec__head"><h2 class="sec__title">Магазин в Таллинне</h2></div>' +
        '<div class="infogrid">' +
          '<div><span class="ftr__h">Доставка</span>DPD, Omniva, SmartPosti · 1–3 дня · бесплатно от 50 €</div>' +
          '<div><span class="ftr__h">Оплата</span>' + payLogosHTML(["bank", "visa", "mastercard", "applepay", "gpay"]) + "</div>" +
          '<div><span class="ftr__h">Самовывоз</span>Mardi 1, Таллинн · бесплатно, заказ ждёт 7 дней</div>' +
        "</div></section>" +
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

  function screenCatalog() {
    var list = filtered(), visible = list.slice(0, S.shown);
    var name = S.cat === "all" ? "Все товары" : CAT_NAMES[S.cat];
    var intro = S.cat === "all"
      ? "Весь ассортимент Rempire: уход, стайлинг, борода, лицо, тело, парфюмерия и мерч."
      : "Профессиональные средства, которыми команда Rempire работает в салоне.";
    return '<div class="wrap">' +
      '<div class="crumbs"><button data-go="home">Главная</button> / ' + name + "</div>" +
      '<section class="sec" style="padding-top:14px">' +
        '<h1 class="display h1">' + name + "</h1>" +
        '<p class="sec__intro">' + intro + "</p>" +
        '<div class="toolbar">' +
          '<button class="btn btn--ghost toolbar__filter" data-filter>Фильтры<span data-fcount>' + fcountLabel() + "</span></button>" +
          '<span class="toolbar__count num" data-count>' + list.length + " " + plural(list.length) + "</span>" +
          '<label class="toolbar__sort"><span class="toolbar__sortlbl">Сортировка</span>' +
          '<span class="sel"><select data-sort aria-label="Сортировка">' +
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
  function plural(n) {
    var a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return "товар";
    if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return "товара";
    return "товаров";
  }
  function fcountLabel() {
    var n = S.brandFilter.length + (S.onlyInStock ? 1 : 0);
    return n ? " · " + n : "";
  }
  function moreHTML(shown, tot) {
    return shown < tot
      ? '<div id="sentinel"></div><div class="spinner"></div>'
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
          '<div class="pdp__stage">' + media(p, S.gallery, "ph pdp__img") +
            '<span class="card__wm pdp__wm"></span></div>' +
          (g.length > 1 ? '<div class="pdp__thumbs">' + g.map(function (im, i) {
            return '<button data-gal="' + i + '" aria-label="Фото ' + (i + 1) + '" aria-current="' + (i === S.gallery) + '" class="pdp__thumb">' +
              media(p, i, "ph") + "</button>";
          }).join("") + "</div>" : "") +
        "</div>" +
        "<div>" +
          '<div class="card__brand pdp__brand">' + esc(p.brand) + "</div>" +
          '<h1 class="pdp__title">' + esc(p.name) + "</h1>" +
          '<div class="num pdp__price">' + eur(sizePrice(p, S.size)) + "</div>" +
          '<div class="pdp__tax">Налоги включены. Доставка рассчитается при оформлении.</div>' +
          (sizes.length > 1 ? '<div class="field"><span class="field__label">' + (p.cat === "merch" ? "Размер" : "Объём") + '</span><div class="sizes">' + sizes.map(function (sz, i) {
            return '<button class="size" data-size="' + i + '" aria-current="' + (i === S.size) + '">' + sz + "</button>";
          }).join("") + "</div></div>" : "") +
          '<div class="pdp__buy">' +
            '<span class="stepper"><button data-qty="-1" aria-label="Меньше">−</button><span class="num">' + S.qty + '</span><button data-qty="1" aria-label="Больше">+</button></span>' +
            '<button class="btn pdp__add" data-add="' + p.id + '">В корзину</button>' +
          "</div>" +
          '<button class="btn btn--wide btn--express" data-buynow="' + p.id + '">Купить через ' + gpayOnDark() + "</button>" +
          '<div class="pdp__alt"><button class="link" data-checkout>Другие способы оплаты</button></div>' +
          '<div class="pdp__ship">Доставка 1–3 дня: DPD, Omniva, SmartPosti, курьер · бесплатно от 50 € · самовывоз на Mardi 1</div>' +
          acc("Описание", "Профессиональное средство из салонного ассортимента Rempire. Подходит для регулярного ухода.") +
          acc("Применение", "Нанести на влажные волосы, вспенить, оставить на 2–5 минут, тщательно смыть.") +
          acc("Состав (INCI)", '<span class="muted">Полный состав будет заполнен при переносе каталога.</span>') +
          acc("Доставка и возврат", "14 дней на возврат по закону ЕС. Вскрытая косметика возврату не подлежит по гигиеническим причинам.") +
        "</div>" +
      "</div>" +
      '<section class="sec"><div class="sec__head"><h2 class="sec__title">С этим покупают</h2></div><div class="grid">' +
        CATALOGUE.filter(function (x) { return x.cat === p.cat && x.id !== p.id; }).slice(0, 4).map(cardHTML).join("") +
      "</div></section></div>" +
      '<div class="stickybar"><span class="num stickybar__sum">' + eur(sizePrice(p, S.size) * S.qty) + '</span><button class="btn" data-add="' + p.id + '">В корзину</button></div>';
  }
  function acc(title, body) {
    return '<details class="acc"><summary>' + title + "</summary><div class=\"acc__body\">" + body + "</div></details>";
  }

  function screenSearch() {
    var res = searchResults();
    return '<div class="wrap"><section class="sec">' +
      '<h1 class="display h1">Поиск</h1>' +
      '<input class="input input--box searchbox" data-search2 value="' + esc(S.query) + '" placeholder="Что ищете?" aria-label="Поиск">' +
      (!S.query.trim()
        ? '<p class="muted">Популярные запросы: ' + ["шампунь", "Davines", "воск", "борода", "парфюм"].map(function (q) { return '<button class="link" data-q="' + q + '">' + q + "</button>"; }).join(" · ") + "</p>"
        : res.length
          ? '<p class="muted num" style="margin-bottom:16px">' + res.length + " " + plural(res.length) + '</p><div class="grid">' + res.map(cardHTML).join("") + "</div>"
          : '<div class="empty"><p>По запросу «' + esc(S.query) + '» ничего не нашлось.</p>' +
            '<p class="muted">Проверьте написание или посмотрите категории:</p>' +
            '<div class="empty__cats">' + CATS.slice(0, 4).map(function (c) { return '<button class="btn btn--ghost btn--sm" data-go-cat="' + c.id + '">' + c.name + "</button>"; }).join("") + "</div>" +
            '<p class="muted">Напишите нам — поможем подобрать замену.</p></div>') +
      "</section></div>";
  }

  function screenAccount() {
    if (!S.loggedIn) {
      return '<div class="wrap wrap--narrow"><section class="sec">' +
        '<h1 class="display h1">Кабинет</h1>' +
        '<p class="muted" style="margin-bottom:20px">Вход без пароля — пришлём код на почту. Покупать можно и без аккаунта.</p>' +
        '<label class="field"><span class="field__label">E-mail</span><input class="input" type="email" autocomplete="email" inputmode="email" data-email placeholder="you@example.com" value="' + esc(S.email) + '" aria-invalid="' + emailBad() + '"></label>' +
        (emailBad() ? '<div class="err">Проверьте адрес — на него придёт код.</div>' : "") +
        '<button class="btn btn--wide" data-login>Получить код</button>' +
        "</section></div>";
    }
    var m = methods();
    return '<div class="wrap wrap--mid"><section class="sec">' +
      '<div class="acct__top"><h1 class="display h1">Кабинет</h1><button class="link" data-logout>Выйти</button></div>' +

      '<div class="sec__head sec__head--sub"><h2 class="sec__title">Мои данные</h2></div>' +
      '<label class="field"><span class="field__label">Имя</span><input class="input" value="" placeholder="Имя"></label>' +
      '<label class="field"><span class="field__label">E-mail</span><input class="input" value="' + esc(S.email) + '"></label>' +
      '<button class="btn btn--ghost btn--sm" data-save>Сохранить</button>' +

      '<div class="sec__head sec__head--sub"><h2 class="sec__title">Доставка по умолчанию</h2></div>' +
      '<p class="muted" style="margin:0 0 12px">Подставим это при следующем заказе — менять можно в любой момент.</p>' +
      '<label class="field"><span class="field__label">Страна</span><span class="sel sel--box"><select data-acctcountry>' +
        COUNTRIES.map(function (c) { return '<option value="' + c[0] + '"' + (S.country === c[0] ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") +
      "</select></span></label>" +
      '<div class="optlist">' + m.map(function (x, i) {
        return '<label class="opt"><input type="radio" name="acctm" ' + (i === S.acctMethod ? "checked" : "") + ' data-acctm="' + i + '"><span>' + x.l + "</span>" +
          '<span class="opt__price num">' + (x.p ? eur(x.p) : "0 €") + "</span></label>";
      }).join("") + "</div>" +
      (machinesFor(m[S.acctMethod]).length
        ? '<label class="field" style="margin-top:14px"><span class="field__label">Пакомат по умолчанию</span><span class="sel sel--box"><select data-acctmachine>' +
          machinesFor(m[S.acctMethod]).map(function (n, i) { return "<option" + (i === S.acctMachine ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + "</select></span></label>"
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
  function coHead(n, title, value) {
    var open = S.coStep === n, done = S.coStep > n;
    return '<button class="costep__head" data-step="' + n + '" aria-expanded="' + open + '"' + (open ? ' aria-current="true"' : "") + '>' +
      '<span class="costep__n' + (done ? " costep__n--done" : "") + '">' + (done ? "✓" : n) + "</span>" +
      '<span class="costep__t">' + title + "</span>" +
      (open ? "" : '<span class="costep__v">' + (value || "") + "</span>") +
      (open ? "" : '<span class="costep__edit">изменить</span>') + "</button>";
  }

  function screenCheckout() {
    var m = methods(), sel = method(), step = S.coStep;
    var summaryOpen = wide();
    return '<div class="cohdr"><div class="wrap wrap--co">' +
        '<button class="hdr__logo" data-go="home" data-ident aria-label="REMPIRE — на главную">' + tower("hdr__tower") + '<span class="hdr__word">Rempire</span></button>' +
        '<span class="cohdr__t">Оформление заказа</span>' +
        '<button class="link" data-go="home">← В магазин</button></div></div>' +
      '<div class="wrap wrap--co"><div class="co">' +

        '<div class="co__steps">' +
          '<section class="costep' + (step === 1 ? " is-open" : "") + '">' +
            coHead(1, "Контакт", esc(S.email || "—")) +
            (step === 1 ? '<div class="costep__body">' +
              '<label class="field"><span class="field__label">E-mail для подтверждения заказа</span>' +
              '<input class="input" type="email" autocomplete="email" data-email value="' + esc(S.email) + '" aria-invalid="' + emailBad() + '" placeholder="you@example.com" inputmode="email"></label>' +
              (emailBad() ? '<div class="err">Похоже, в адресе опечатка — проверьте домен.</div>' : '<div class="hint">Аккаунт не нужен — оформляйте как гость.</div>') +
              '<label class="opt opt--plain"><input type="checkbox"><span>Хочу получать новости и скидки</span></label>' +
              '<button class="btn btn--wide" data-step="2">Далее — доставка</button></div>' : "") +
          "</section>" +

          '<section class="costep' + (step === 2 ? " is-open" : "") + '">' +
            coHead(2, "Доставка", sel.l) +
            (step === 2 ? '<div class="costep__body">' +
              '<label class="field"><span class="field__label">Страна</span><span class="sel sel--box"><select data-country>' +
                COUNTRIES.map(function (c) { return '<option value="' + c[0] + '"' + (S.country === c[0] ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + "</select></span></label>" +
              '<div class="optlist">' + m.map(function (x, i) {
                return '<label class="opt"><input type="radio" name="ship" ' + (i === S.method ? "checked" : "") + ' data-method="' + i + '"><span>' + x.l + "</span>" +
                  '<span class="opt__price num">' + (!x.p ? "0 €" : freeShip() ? "Бесплатно" : eur(x.p)) + "</span></label>";
              }).join("") + "</div>" +
              (sel.pickup ? '<div class="hint">Забрать бесплатно на Mardi 1. Нужен документ. Заказ ждёт 7 дней, дальше 1,50 € в день.</div>' : "") +
              (machinesFor(sel).length ? '<label class="field"><span class="field__label">Пакомат — ' + machinesFor(sel).length + ' точек</span><span class="sel sel--box"><select data-machine>' +
                machinesFor(sel).map(function (n, i) { return "<option" + (i === S.machine ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + "</select></span></label>" : "") +
              '<div class="hint">' + (freeShip() ? "Бесплатная доставка применена ✓" : "Бесплатная доставка от " + threshold() + " € — не хватает " + eur(threshold() - cartSum())) + "</div>" +
              (sel.pickup ? "" :
                '<label class="field"><span class="field__label">Имя и фамилия</span><input class="input" placeholder="Имя Фамилия" autocomplete="name"></label>' +
                (sel.pm ? "" : '<label class="field"><span class="field__label">Адрес</span><input class="input" placeholder="улица, дом" autocomplete="street-address"></label>' +
                  '<div class="co__zip"><label class="field"><span class="field__label">Индекс</span><input class="input" placeholder="12345" inputmode="numeric" autocomplete="postal-code"></label>' +
                  '<label class="field"><span class="field__label">Город</span><input class="input" placeholder="Город" autocomplete="address-level2"></label></div>')) +
              '<label class="field"><span class="field__label">Телефон</span><input class="input" placeholder="+372…" inputmode="tel" autocomplete="tel"></label>' +
              '<p class="cosrc">Тарифы — прайс-листы перевозчиков 2025–2026, с НДС 24 %. От 40 посылок в месяц Omniva и DPD дают скидку 3–20 % — итоговые цены уточним при подключении.</p>' +
              '<button class="btn btn--wide" data-step="3">Далее — оплата</button></div>' : "") +
          "</section>" +

          '<section class="costep' + (step === 3 ? " is-open" : "") + '">' +
            coHead(3, "Оплата", PAYS[S.pay].l) +
            (step === 3 ? '<div class="costep__body">' +
              '<div class="optlist">' + PAYS.map(function (o, i) {
                return '<label class="opt opt--pay"><input type="radio" name="pay" ' + (i === S.pay ? "checked" : "") + ' data-paym="' + i + '">' +
                  '<span class="opt__txt"><span>' + o.l + "</span><span class=\"opt__hint\">" + o.h + "</span></span>" +
                  '<span class="opt__logos">' + payMark(o.k) + "</span></label>";
              }).join("") + "</div>" +
              (S.pay === 0 ? '<div class="banks">' + BANKS.map(function (b, i) {
                return '<button class="bank" data-bank="' + i + '" aria-current="' + (i === S.bank) + '">' + b + "</button>";
              }).join("") + "</div>" : "") +
              (S.pay === 3 ? '<label class="field" style="margin-top:14px"><span class="field__label">Название фирмы и рег. номер</span><input class="input" placeholder="OÜ Näidis · 12345678"></label>' : "") +
              "</div>" : "") +
          "</section>" +
          '<ul class="cotrust">' +
            "<li>Оплата через банк — данные карты магазин не видит</li>" +
            "<li>14 дней на возврат по закону ЕС</li>" +
            "<li>Вопросы — 56237237 или rempireshopinfo@gmail.com</li>" +
          "</ul>" +
        "</div>" +

        '<div class="co__sum"><details class="cosum"' + (summaryOpen ? " open" : "") + '>' +
          '<summary class="cosum__head"><span class="sec__title">Ваш заказ</span>' +
            '<span class="cosum__tot num">' + eur(total()) + "</span></summary>" +
          '<div class="cosum__body">' +
          (S.cart.length ? S.cart.map(function (l) {
            var p = byId(l.id);
            return '<div class="cosum__line"><span class="cosum__ph">' + media(p, 0, "ph") + "</span>" +
              '<span class="cosum__nm">' + esc(p.name) + lineLabel(l) + " × " + l.qty + "</span>" +
              '<span class="num cosum__pr">' + eur(sizePrice(p, l.size || 0) * l.qty) + "</span></div>";
          }).join("") : '<p class="muted">Корзина пуста.</p>') +
          '<div class="cosum__promo"><input class="input input--box" data-promo placeholder="Промокод" value="' + esc(S.promo) + '"><button class="btn btn--ghost btn--sm" data-applypromo>Применить</button></div>' +
          (S.promoErr ? '<div class="err">Код не найден — проверьте написание.</div>' : "") +
          (S.promoOk ? '<div class="cosum__row"><span>REMPIRE10 — скидка 10%</span><span class="num">−' + eur(discount()) + "</span></div>" : "") +
          '<div class="cosum__row cosum__row--rule"><span>Доставка — ' + sel.l + '</span><span class="num">' + (shipCost() ? eur(shipCost()) : "Бесплатно") + "</span></div>" +
          '<div class="cosum__row cosum__row--tot"><span>Итого</span><span class="num">' + eur(total()) + "</span></div>" +
          '<button class="btn btn--wide co__pay" data-pay>Оплатить ' + eur(total()) + "</button>" +
          '<p class="cosum__legal">Нажимая «Оплатить», вы соглашаетесь с условиями и политикой возврата.</p>' +
          "</div></details></div>" +

      "</div></div>" +
      '<div class="stickybar stickybar--co"><span class="stickybar__tot"><span>Итого</span><span class="num">' + eur(total()) + '</span></span><button class="btn" data-pay>Оплатить</button></div>';
  }
  function payMark(k) {
    if (k === "bank") return PAYLOGOS.bank;
    if (k === "card") return PAYLOGOS.visa + PAYLOGOS.mastercard;
    if (k === "wallet") return PAYLOGOS.applepay + PAYLOGOS.gpay;
    return "";
  }

  function screenDone() {
    return '<div class="wrap wrap--narrow" style="text-align:center"><section class="sec">' +
      '<div class="done__tick">' + icon("check") + "</div>" +
      '<h1 class="display h1">Заказ оформлен</h1>' +
      '<p class="muted" style="margin-bottom:22px">Это демонстрация — настоящий заказ не создан. В рабочем магазине сюда придёт номер заказа, счёт на почту и трекинг посылки.</p>' +
      '<button class="btn" data-go="home">На главную</button></section></div>';
  }

  // ---------- overlays ----------
  function cartDrawer() {
    var sum = cartSum(), thr = threshold(), pct = Math.min(100, sum / thr * 100);
    return '<div class="scrim" data-closecart></div><aside class="drawer drawer--right" aria-label="Корзина">' +
      '<div class="drawer__head"><span class="display drawer__t">Корзина (' + cartCount() + ')</span>' +
      '<button class="iconbtn" data-closecart aria-label="Закрыть">✕</button></div>' +
      '<div class="drawer__body">' +
        (S.cart.length ? S.cart.map(function (l, li) {
          var p = byId(l.id);
          return '<div class="cline"><span class="cline__ph">' + media(p, 0, "ph") + "</span>" +
            '<span class="cline__mid"><span class="cline__nm">' + esc(p.brand) + " " + esc(p.name) + lineLabel(l) + "</span>" +
            '<span class="stepper stepper--sm"><button data-line="' + li + '" data-d="-1" aria-label="Меньше">−</button><span class="num">' + l.qty + '</span><button data-line="' + li + '" data-d="1" aria-label="Больше">+</button></span>' +
            '<button class="link cline__rm" data-remove="' + li + '">Убрать</button></span>' +
            '<span class="num cline__pr">' + eur(sizePrice(p, l.size || 0) * l.qty) + "</span></div>";
        }).join("") : '<p class="muted">Пока пусто. <button class="link" data-go-cat="all">К товарам</button></p>') +
        (S.cart.length ? '<div class="freebar"><div class="freebar__track"><div class="freebar__fill" style="width:' + pct + '%"></div></div>' +
          '<p class="muted">' + (sum >= thr ? "Бесплатная доставка — порог " + thr + " € достигнут ✓" : "До бесплатной доставки (" + (S.country === "EU" ? "Европа" : "EE, LV, LT, FI") + ") — ещё " + eur(thr - sum)) + "</p></div>" : "") +
      "</div>" +
      (S.cart.length ? '<div class="drawer__foot"><div class="drawer__tot"><span>Итого</span><span class="num">' + eur(sum) + "</span></div>" +
        '<button class="btn btn--wide" data-checkout>Оформить заказ</button>' +
        '<button class="link drawer__cont" data-closecart>Продолжить покупки</button></div>' : "") +
      "</aside>";
  }

  function filterDrawer() {
    var brands = [];
    CATALOGUE.forEach(function (p) { if ((S.cat === "all" || p.cat === S.cat) && brands.indexOf(p.brand) < 0) brands.push(p.brand); });
    brands.sort();
    function count(b) { return CATALOGUE.filter(function (p) { return (S.cat === "all" || p.cat === S.cat) && p.brand === b; }).length; }
    var inStock = CATALOGUE.filter(function (p) { return (S.cat === "all" || p.cat === S.cat) && p.stock !== "out"; }).length;
    return '<div class="scrim" data-closefilter></div><aside class="drawer drawer--left" aria-label="Фильтры">' +
      '<div class="drawer__head"><span class="display drawer__t">Фильтры</span><button class="iconbtn" data-closefilter aria-label="Закрыть">✕</button></div>' +
      '<div class="drawer__body">' +
        '<div class="field__label">Наличие</div><label class="opt"><input type="checkbox" data-instock ' + (S.onlyInStock ? "checked" : "") + '><span>В наличии</span><span class="opt__price num opt__n">' + inStock + "</span></label>" +
        '<div class="field__label" style="margin-top:20px">Бренд</div>' +
        brands.map(function (b) {
          return '<label class="opt"><input type="checkbox" data-brand="' + esc(b) + '" ' + (S.brandFilter.indexOf(b) >= 0 ? "checked" : "") + "><span>" + esc(b) + '</span><span class="opt__price num opt__n">' + count(b) + "</span></label>";
        }).join("") +
      "</div>" +
      '<div class="drawer__foot"><button class="btn btn--wide" data-closefilter>Показать <span data-showcount>' + filtered().length + "</span> " + plural(filtered().length) + "</button>" +
      '<button class="link drawer__cont" data-clearfilter>Сбросить</button></div></aside>';
  }

  // ---------- render ----------
  var app = document.getElementById("app");
  app.innerHTML = '<div id="hdrslot"></div><div id="bodyslot"></div><div id="navslot"></div><div id="ovl"></div>';
  var hdrSlot = document.getElementById("hdrslot");
  var bodySlot = document.getElementById("bodyslot");
  var navSlot = document.getElementById("navslot");
  var ovl = document.getElementById("ovl");
  var ovlKey = "";

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
    if (!hdrSlot.firstChild) hdrSlot.innerHTML = headerHTML();
    hdrSlot.hidden = chromeless;
    patchHeader();

    bodySlot.innerHTML = '<main class="screen' + (chromeless ? " screen--co" : "") + '">' + body + "</main>" +
      (chromeless ? "" : footer());

    if (!navSlot.firstChild) navSlot.innerHTML = botnavHTML();
    patchNav();

    // Overlays are only re-mounted when the *kind* of overlay changes, so an
    // open drawer never replays its slide-in while you tick its checkboxes.
    var key = (S.cartOpen ? "c" : "") + (S.filterOpen ? "f" : "") + (S.toast ? "t" + S.toast : "");
    if (key !== ovlKey) {
      ovlKey = key;
      ovl.innerHTML = (S.cartOpen ? cartDrawer() : "") + (S.filterOpen ? filterDrawer() : "") +
        (S.toast ? '<div class="toast" role="status"><span>' + S.toast + '</span><button class="iconbtn toast__x" data-closetoast aria-label="Закрыть">✕</button></div>' : "");
    } else if (S.cartOpen) {
      // cart contents can change while the drawer stays mounted
      ovl.innerHTML = cartDrawer() + (S.toast ? '<div class="toast" role="status"><span>' + S.toast + '</span><button class="iconbtn toast__x" data-closetoast aria-label="Закрыть">✕</button></div>' : "");
    }
    document.body.classList.toggle("is-locked", S.cartOpen || S.filterOpen);

    if (S.screen === "catalog") observeSentinel();
  }

  /* Filtering re-renders only the grid. A full render would rebuild the open
     filter drawer under the user's finger — that was the flicker. */
  function patchCatalog() {
    if (S.screen !== "catalog") { render(); return; }
    var list = filtered(), visible = list.slice(0, S.shown);
    var grid = document.getElementById("catgrid");
    if (!grid) { render(); return; }
    grid.innerHTML = visible.map(cardHTML).join("");
    var more = document.getElementById("catmore");
    if (more) more.innerHTML = moreHTML(visible.length, list.length);
    var c = document.querySelector("[data-count]");
    if (c) c.textContent = list.length + " " + plural(list.length);
    var fc = document.querySelector("[data-fcount]");
    if (fc) fc.textContent = fcountLabel();
    var sc = document.querySelector("[data-showcount]");
    if (sc) sc.textContent = list.length;
    var chips = document.querySelector("[data-chips]");
    if (chips) chips.outerHTML = activeChips();
    observeSentinel();
  }

  function go(screen) {
    S.screen = screen; S.cartOpen = false; S.filterOpen = false; S.langOpen = false;
    if (screen === "catalog") S.shown = 12;
    if (screen === "checkout") S.coStep = 1;
    window.scrollTo({ top: 0 });
    render();
  }
  /* Brands differ per category, so a Davines filter left over from Уход за
     волосами would silently empty Парфюмерия. Category change clears them. */
  function goCat(cat) {
    if (cat !== S.cat) { S.brandFilter = []; S.onlyInStock = false; }
    S.cat = cat; go("catalog");
  }

  function toast(msg) {
    S.toast = msg; render();
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { S.toast = null; render(); }, 2600);
  }

  function addToCart(id, sizeIdx) {
    var si = sizeIdx === undefined ? (S.productId === id && S.screen === "product" ? S.size : 0) : sizeIdx;
    var qty = S.screen === "product" && S.productId === id ? S.qty : 1;
    var line = null;
    S.cart.forEach(function (l) { if (l.id === id && l.size === si) line = l; });
    if (line) line.qty = Math.min(9, line.qty + qty);
    else S.cart.push({ id: id, size: si, qty: Math.min(9, qty) });
    persist();
    toast("Добавлено в корзину ✓");
  }
  function lineLabel(l) {
    var p = byId(l.id);
    return p.sizes && p.sizes.length > 1 ? " · " + p.sizes[Math.min(l.size || 0, p.sizes.length - 1)] : "";
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

  // swipe: the hero is the one thing on the phone that looks swipeable
  var swX = 0, swY = 0, swOn = false;
  document.addEventListener("touchstart", function (e) {
    var h = e.target.closest && e.target.closest(".hero");
    if (!h || e.touches.length !== 1) { swOn = false; return; }
    swOn = true; swX = e.touches[0].clientX; swY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", function (e) {
    if (!swOn) return;
    swOn = false;
    var t = e.changedTouches[0], dx = t.clientX - swX, dy = t.clientY - swY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    setSlide(S.slide + (dx < 0 ? 1 : -1), true);
  }, { passive: true });

  // ---------- events ----------
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-go],[data-go-cat],[data-go-product],[data-add],[data-cart],[data-closecart],[data-filter],[data-closefilter],[data-clearfilter],[data-unbrand],[data-unstock],[data-slide],[data-dot],[data-langtoggle],[data-lang],[data-line],[data-remove],[data-checkout],[data-pay],[data-step],[data-method],[data-acctm],[data-size],[data-qty],[data-gal],[data-login],[data-logout],[data-save],[data-repeat],[data-applypromo],[data-q],[data-buynow],[data-closetoast],[data-paym],[data-bank]");
    if (!t) {
      if (S.langOpen) { S.langOpen = false; patchHeader(); }
      return;
    }
    var d = t.dataset;

    if (d.ident !== undefined) identLogo(t);
    if (d.go) { go(d.go); return; }
    if (d.goCat !== undefined) { goCat(d.goCat); return; }
    if (d.goProduct) {
      S.productId = d.goProduct; S.size = 0; S.qty = 1;
      var np = byId(d.goProduct);
      S.gallery = np.varImg && np.varImg.length ? np.varImg[0] : 0;
      go("product"); return;
    }
    if (d.add) { e.stopPropagation(); addToCart(d.add); return; }
    if (d.buynow) { addToCart(d.buynow); go("checkout"); return; }
    if (d.cart !== undefined) { S.cartOpen = true; render(); return; }
    if (d.closecart !== undefined) { S.cartOpen = false; render(); return; }
    if (d.filter !== undefined) { S.filterOpen = true; render(); return; }
    if (d.closefilter !== undefined) { S.filterOpen = false; render(); return; }
    if (d.clearfilter !== undefined) { S.brandFilter = []; S.onlyInStock = false; S.shown = 12; S.filterOpen = false; render(); return; }
    if (d.unbrand !== undefined) {
      S.brandFilter = S.brandFilter.filter(function (x) { return x !== d.unbrand; });
      S.shown = 12; patchCatalog(); return;
    }
    if (d.unstock !== undefined) { S.onlyInStock = false; S.shown = 12; patchCatalog(); return; }
    if (d.slide) { setSlide(S.slide + Number(d.slide), true); return; }
    if (d.dot !== undefined) { setSlide(Number(d.dot), true); return; }
    if (d.langtoggle !== undefined) { S.langOpen = !S.langOpen; patchHeader(); return; }
    if (d.lang) { S.lang = d.lang; S.langOpen = false; persist(); patchHeader(); return; }
    if (d.line !== undefined) {
      var li = Number(d.line);
      if (S.cart[li]) S.cart[li].qty = Math.max(1, Math.min(9, S.cart[li].qty + Number(d.d)));
      persist(); render(); return;
    }
    if (d.remove !== undefined) { S.cart.splice(Number(d.remove), 1); persist(); render(); return; }
    if (d.checkout !== undefined) { if (!S.cart.length) { toast("Корзина пуста"); return; } go("checkout"); return; }
    if (d.pay !== undefined) {
      S.emailTouched = true;
      if (emailBad()) { S.coStep = 1; render(); toast("Проверьте e-mail — на него придёт заказ"); return; }
      S.cart = []; persist(); go("done"); return;
    }
    if (d.step) {
      var n = Number(d.step);
      if (n > 1 && S.coStep === 1) { S.emailTouched = true; if (emailBad()) { render(); return; } }
      S.coStep = n; render(); return;
    }
    if (d.method !== undefined) { S.method = Number(d.method); S.machine = 0; render(); return; }
    if (d.paym !== undefined) { S.pay = Number(d.paym); render(); return; }
    if (d.bank !== undefined) { S.bank = Number(d.bank); render(); return; }
    if (d.acctm !== undefined) { S.acctMethod = Number(d.acctm); render(); return; }
    if (d.size !== undefined) {
      S.size = Number(d.size);
      var sp = byId(S.productId);
      if (sp.varImg && sp.varImg.length > S.size) S.gallery = sp.varImg[S.size];
      render(); return;
    }
    if (d.qty) { S.qty = Math.max(1, Math.min(9, S.qty + Number(d.qty))); render(); return; }
    if (d.gal !== undefined) { S.gallery = Number(d.gal); render(); return; }
    if (d.login !== undefined) {
      S.emailTouched = true;
      if (emailBad()) { render(); toast("Введите e-mail — на него придёт код"); return; }
      S.loggedIn = true; render(); return;
    }
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

  /* The header is persistent, so typing there no longer loses the caret —
     the search screen is rendered underneath while the field keeps focus. */
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.matches("[data-search]")) {
      S.query = t.value;
      if (S.screen !== "search") { S.screen = "search"; S.cartOpen = false; S.filterOpen = false; }
      render();
    } else if (t.matches("[data-search2]")) {
      S.query = t.value;
      var pos = t.selectionStart;
      render();
      var n = document.querySelector("[data-search2]");
      if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    } else if (t.matches("[data-email]")) { S.email = t.value; }
    else if (t.matches("[data-promo]")) { S.promo = t.value; S.promoErr = false; }
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

  document.addEventListener("blur", function (e) {
    if (e.target.matches("[data-email]")) {
      S.emailTouched = true;
      if (S.screen === "checkout" || S.screen === "account") render();
    }
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (S.cartOpen || S.filterOpen) { S.cartOpen = false; S.filterOpen = false; render(); }
    else if (S.langOpen) { S.langOpen = false; patchHeader(); }
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

  function intro() {
    var reduce = false;
    try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var seen = false;
    try { seen = sessionStorage.getItem("rempire-intro") === "1"; } catch (e) {}
    if (reduce || seen) { document.body.classList.add("drawn"); return; }
    var el = document.createElement("div");
    el.className = "intro";
    el.setAttribute("title", "Пропустить");
    el.innerHTML = towerDraw() + '<div class="intro__word">Rempire</div>';
    document.body.appendChild(el);
    try { sessionStorage.setItem("rempire-intro", "1"); } catch (e) {}
    var kill = function () {
      el.classList.add("intro--out");
      document.body.classList.add("drawn");
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

  render();
  restartHero();
  intro();
})();
