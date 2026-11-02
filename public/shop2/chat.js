/* Rempire shop assistant — the customer-facing chat (demo).
   Rule-based on purpose: it shows the PRODUCT experience (find, suggest,
   add to cart, assemble a set) while the real brain arrives with the
   backend. Reuses the shop's own delegated actions: a click on [data-add]
   or [data-go-product] inside the chat is handled by app.js like any other,
   so the cart, the toast and the badge all behave identically. */
(function () {
  "use strict";
  if (typeof CATALOGUE === "undefined") return;

  /* ---- the reminder bubble -------------------------------------------------
     Dim, 10.09.2026: a shopper who has been browsing for a while may never
     have noticed the round button, so half a minute in, a small speech
     bubble beside it says «Подобрать уход? Спросите ассистента». Catalogue-
     side screens only, once per browser session, never after the chat was
     opened, and a × keeps it away for a week. Everything about when and how
     often it appears lives here — tune it, or switch it off, in one line. */
  var NUDGE_ON = true;                  // false: the bubble never appears
  var NUDGE_DELAY_MS = 30 * 1000;       // time on the page before it shows
  var NUDGE_DISMISS_DAYS = 7;           // a × (or Escape) keeps it away this long
  // the screens it may appear on — the shopper is still choosing there;
  // never the checkout, the account, the legal pages, the blog
  var NUDGE_SCREENS = ["home", "catalog", "brands", "search", "product", "bundles", "bundle"];
  var NUDGE_SS = "rempire-nudge-done";  // sessionStorage: shown once, or the chat was opened
  var NUDGE_LS = "rempire-nudge-off";   // localStorage: when the × was pressed
  /* ---- the wide window -----------------------------------------------------
     «Развернуть» in the panel's header: ~720 px wide and 80 vh tall instead
     of the 360-px column (styles.css .sbot--wide), remembered for the
     session. A phone never loads this file at all (app.js mountChat). */
  var WIDE_SS = "rempire-chat-wide";    // sessionStorage: "1" while enlarged

  var LS = "rempire-shop-proto";
  /* The language on screen, not the saved preference: app.js writes <html
     lang> on every render (setHead), and the observer below already watches
     it. The saved choice is only ever the fallback before the first paint —
     reading it first greeted a first visit to /et in Russian, and a link
     into the English shop in whatever the shopper had once picked. */
  var LANG_OF = { ru: "RU", et: "ET", en: "EN" };
  function lang() {
    var shown = LANG_OF[String(document.documentElement.lang || "").toLowerCase()];
    if (shown) return shown;
    try { return (JSON.parse(localStorage.getItem(LS)) || {}).lang || "RU"; } catch (e) { return "RU"; }
  }

  /* When /api/assistant/ has an OpenAI key behind it, the chat talks to the
     real model; without one, the rule-based demo below answers. The probe is
     lazy (first open) and a network failure just means rules. */
  // `convoGen` counts the conversations this panel has had: bumped whenever
  // the log and `convo` are thrown away, so an answer still in flight can tell
  // that the conversation it was asked in no longer exists (reply() below).
  // `pinned` — {slug, title} of the article the chat was opened from
  // (window.openChatAbout below), for as long as this conversation lasts
  var aiEnabled = null, convo = [], convoGen = 0, pinned = null;
  function probeAI() {
    if (aiEnabled !== null) return;
    aiEnabled = false;
    fetch("/api/assistant/", { method: "GET" })
      .then(function (r) { return r.json(); })
      .then(function (j) { aiEnabled = !!j.enabled; refreshHint(); })
      /* A probe that never landed is not an answer. The flag is set to false
         BEFORE the fetch so a question asked while it is in the air is
         answered by the rules — but leaving it false afterwards meant one
         dropped request (a tunnel, a sleeping laptop, a hiccup at the edge)
         downgraded the shopper to the canned matcher for as long as the page
         stayed open, and the guard above never let it ask again. Back to
         «не спрашивали»: the next open, and the next message, re-probe. */
      .catch(function () { aiEnabled = null; });
  }
  var byIdMap = {};
  CATALOGUE.forEach(function (p) { byIdMap[p.id] = p; });
  var T = {
    RU: {
      title: "Помощник Rempire", hint: "Демо: понимаю простые фразы",
      hello: "Привет! Помогу выбрать. Скажите, что ищете — например «шампунь для объёма», «подарок до 50 €» или «что-то для бороды».",
      chips: ["Что-то для бороды", "Шампунь", "Подарок до 50 €", "Набор для ухода", "Парфюм"],
      add: "В корзину", open: "Открыть", addAll: "Добавить всё в корзину",
      found: "Вот что подходит:", none: "Точного совпадения не нашёл — вот популярное из каталога:",
      /* «Вот что подходит:» with nothing under it is a promise the widget did
         not keep — pick() drops everything that is out of stock, and a shelf
         that is empty right now left the sentence standing alone (Renat,
         17.09.2026). Said plainly instead, with what to do next. */
      empty: "Сейчас в наличии ничего подходящего нет — напишите, что нужно, и мы подскажем замену.",
      set: "Собрал набор — вместе:", cart: "Открываю корзину…",
      placeholder: "Например: масло для бороды…",
      // the chat root hangs off document.body, outside translateTree()'s four
      // slots, so the screen-reader labels and the price prefix live here too
      aria: "Чат с помощником", close: "Закрыть", send: "Отправить", from: "от ",
      // the reminder bubble and the header's size toggle (NUDGE_* / WIDE_SS above)
      nudge: "Подобрать уход? Спросите ассистента", nudgeClose: "Закрыть подсказку",
      wide: "Развернуть", narrow: "Свернуть",
      // the article card above the products (articleCard) and the pinned article (openChatAbout)
      fromBlog: "Из нашего блога", askAbout: "Спросите об этой статье — например, что из неё подойдёт вам."
    },
    ET: {
      title: "Rempire abiline", hint: "Demo: saan aru lihtsatest fraasidest",
      hello: "Tere! Aitan valida. Ütle, mida otsid — näiteks „kohevust andev šampoon“, „kingitus kuni 50 €“ või „midagi habemele“.",
      chips: ["Midagi habemele", "Šampoon", "Kingitus kuni 50 €", "Hoolduskomplekt", "Parfüüm"],
      add: "Lisa ostukorvi", open: "Ava", addAll: "Lisa kõik ostukorvi",
      found: "Need sobivad:", none: "Täpset vastet ei leidnud — siin on populaarsed:",
      empty: "Praegu pole laos midagi sobivat — kirjuta, mida vajad, ja soovitame asenduse.",
      set: "Panin komplekti kokku — koos:", cart: "Avan ostukorvi…",
      placeholder: "Näiteks: habemeõli…",
      aria: "Vestlus abilisega", close: "Sule", send: "Saada", from: "alates ",
      nudge: "Vajad abi valikul? Küsi abiliselt", nudgeClose: "Sule vihje",
      wide: "Laienda", narrow: "Ahenda",
      fromBlog: "Meie blogist", askAbout: "Küsi selle artikli kohta — näiteks, mis sellest sulle sobib."
    },
    EN: {
      title: "Rempire assistant", hint: "Demo: I understand simple phrases",
      hello: "Hi! I'll help you choose. Tell me what you're after — e.g. “volume shampoo”, “gift under €50” or “something for the beard”.",
      chips: ["Something for the beard", "Shampoo", "Gift under €50", "Care set", "Perfume"],
      add: "Add to cart", open: "Open", addAll: "Add all to cart",
      found: "Here's what fits:", none: "No exact match — here are the popular ones:",
      empty: "Nothing that fits is in stock right now — tell us what you need and we will suggest an alternative.",
      set: "Here's a set — together:", cart: "Opening the cart…",
      placeholder: "e.g. beard oil…",
      aria: "Chat with the assistant", close: "Close", send: "Send", from: "from ",
      nudge: "Need help choosing? Ask the assistant", nudgeClose: "Close the tip",
      wide: "Expand", narrow: "Shrink",
      fromBlog: "From our blog", askAbout: "Ask about this article — for example, what in it would suit you."
    }
  };

  /* The same table as CAT_KW in src/lib/catalogue-slice.ts, and it has to be:
     this copy picks the shelf when the shop answers WITHOUT an OpenAI key,
     and that one does it when there is one. They had drifted, so «маска для
     лица» landed in a different section depending on a setting the shopper
     cannot see, and «лак», «лосьон», «перхоть», «усы» and an EDT found
     nothing at all here (audit § 9.6). Keep the two in step; there is no
     build step between them. */
  var CATS_KW = [
    [/бород|habe|beard|усы|moustache|брить|raseer|shav/i, "beard"],
    [/волос|шампун|кондиционер|маск|juuks|šampoon|palsam|hair|shampoo|conditioner|scalp|перхот/i, "hair"],
    [/стайлинг|уклад|паст|воск|гел|пудр|лак|viimistl|soeng|styling|wax|paste|clay|pomade|gel/i, "styling"],
    [/лиц|кож[аеиу]|тоник|крем|сыворот|nägu|näo|nahk|face|skin|toner|serum|patch/i, "face"],
    [/тел|мыл|keha|seep|body|soap|лосьон/i, "body"],
    [/парфюм|аромат|духи|parfüüm|lõhn|perfume|fragrance|cologne|edp|edt/i, "perfume"],
    [/футболк|мерч|särk|merch|shirt|tee|декор|decor/i, "merch"]
  ];
  var TYPE_KW = [
    [/шампун|šampoon|shampoo/i, /шампунь/],
    [/кондиционер|palsam|conditioner/i, /кондиционер/],
    [/маск|mask/i, /маска/],
    [/масл|õli|oil/i, /масло/],
    [/спре|sprei|spray/i, /спрей/],
    [/воск|vaha|wax/i, /воск/],
    [/паст|pasta|paste/i, /паста/]
  ];

  /* The budget in «подарок до 50 €» — and in «Gift under €50», which is the
     widget's OWN English chip: the euro sign sits between the word and the
     number there, and `\s*(\d+)` could not step over it, so the chip that says
     «under €50» came back with four perfumes at three figures. A promise the
     shop did not keep, the same family as an answer with no rows under it
     (Renat, 17.09.2026). */
  function money(s) {
    var m = String(s).match(/(?:до|kuni|under|alla)\s*[€$]?\s*(\d+)/i);
    return m ? +m[1] : null;
  }
  function inStock(p) { return p.stock !== "out"; }
  function pick(list, n) { return list.filter(inStock).slice(0, n || 4); }

  function match(q) {
    var cap = money(q);
    var cat = null, typeRe = null;
    for (var i = 0; i < CATS_KW.length; i++) if (CATS_KW[i][0].test(q)) { cat = CATS_KW[i][1]; break; }
    for (var j = 0; j < TYPE_KW.length; j++) if (TYPE_KW[j][0].test(q)) { typeRe = TYPE_KW[j][1]; break; }

    // «набор» / set / komplekt — assemble a small kit within the budget
    if (/набор|комплект|komplekt|kit|\bset\b/i.test(q)) {
      var base = CATALOGUE.filter(function (p) { return inStock(p) && (!cat || p.cat === cat); });
      var kit = [], types = ["шампунь", "кондиционер", "масло", "паста", "бальзам"], budget = cap || 60;
      for (var t = 0; t < types.length && kit.length < 3; t++) {
        var c = base.filter(function (p) { return p.name.indexOf(types[t]) >= 0 && p.price <= budget; })
          .sort(function (a, b) { return a.price - b.price; })[0];
        if (c && kit.indexOf(c) < 0 && kit.reduce(function (s, x) { return s + x.price; }, 0) + c.price <= budget) kit.push(c);
      }
      if (kit.length >= 2) return { kind: "set", items: kit };
    }
    // gift: perfume + soap/merch under cap
    if (/подар|kingitus|gift/i.test(q)) {
      var gifts = CATALOGUE.filter(function (p) {
        return inStock(p) && (p.cat === "perfume" || p.cat === "body" || p.cat === "merch") && (!cap || p.price <= cap);
      }).sort(function (a, b) { return b.price - a.price; });
      if (gifts.length) return { kind: "list", items: pick(gifts) };
    }
    var pool = CATALOGUE.filter(function (p) {
      if (cat && p.cat !== cat) return false;
      if (typeRe && !typeRe.test(p.name)) return false;
      if (cap && p.price > cap) return false;
      return true;
    });
    // free-text tokens against name+brand
    if (pool.length === CATALOGUE.length || (!cat && !typeRe)) {
      var toks = q.toLowerCase().split(/[^a-zа-яё0-9õäöüšž.]+/i).filter(function (w) { return w.length > 2; });
      var scored = CATALOGUE.map(function (p) {
        var hay = (p.brand + " " + p.name).toLowerCase(), s = 0;
        toks.forEach(function (w) { if (hay.indexOf(w) >= 0) s++; });
        return [s, p];
      }).filter(function (e) { return e[0] > 0; }).sort(function (a, b) { return b[0] - a[0]; });
      if (scored.length) return { kind: "list", items: pick(scored.map(function (e) { return e[1]; })) };
      if (!cat && !typeRe) return { kind: "none", items: pick(CATALOGUE.slice(0, 12)) };
    }
    if (pool.length) return { kind: "list", items: pick(pool) };
    return { kind: "none", items: pick(CATALOGUE.slice(0, 12)) };
  }

  // ---------- UI ----------
  /* The chat lives in the SHOP, on a wide screen, outside the checkout.
     Dim, 07.09.2026: «checkoutis pole assistenti vaja ja mobiilis ei kasuta
     üldse poes assistenti, adminis võib jääda» — no assistant at the till,
     none anywhere in the shop on a phone; the admin keeps its own.

     app.js (mountChat) already refuses to fetch this file on a phone, so on
     a real phone none of this runs at all. The rule is repeated here because
     loading is one-way: a desktop window dragged down to phone width, or a
     shopper walking from the catalogue into the checkout, has the widget
     already in the page and it has to leave the screen by itself.

     The owner can also switch it off entirely from Настройки (the admin
     demo store). */
  var WIDE = "(min-width: 768px)";   // the shop's own phone/desktop line
  function wideEnough() {
    try { return !!(window.matchMedia && window.matchMedia(WIDE).matches); }
    catch (e) { return true; }
  }
  function chatAllowed() {
    try {
      var adm = JSON.parse(localStorage.getItem("rempire-admin-demo"));
      if (adm && adm.chatbot === false) return false;
    } catch (e) {}
    if (!wideEnough()) return false;
    var screen = document.body.dataset.screen;
    return screen !== "admin" && screen !== "checkout";
  }

  var root = document.createElement("div");
  root.className = "sbot";
  root.innerHTML =
    '<button class="sbot__fab" aria-label="Чат с помощником" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>' +
    "</button>" +
    '<section class="sbot__panel" hidden aria-label="Чат с помощником">' +
      '<header class="sbot__head"><b data-bt></b><span class="sbot__hint" data-bh></span>' +
        '<button class="sbot__wide" data-wide type="button"></button>' +
        '<button class="sbot__x" aria-label="Закрыть">✕</button></header>' +
      '<div class="sbot__log" data-log></div>' +
      '<div class="sbot__chips" data-chips></div>' +
      '<form class="sbot__form"><input data-in autocomplete="off"><button class="sbot__send" aria-label="Отправить">→</button></form>' +
    "</section>" +
    /* the reminder bubble: an EMPTY polite live region from the first paint,
       so a screen reader hears the text the moment it is put in (nudgeShow)
       and focus never moves; empty it has no box at all (styles.css) */
    '<div class="sbot__nudge" data-nudge aria-live="polite"></div>';
  document.body.appendChild(root);

  var fab = root.querySelector(".sbot__fab"), panel = root.querySelector(".sbot__panel"),
    log = root.querySelector("[data-log]"), chipsEl = root.querySelector("[data-chips]"),
    input = root.querySelector("[data-in]"), form = root.querySelector("form"),
    wideBtn = root.querySelector("[data-wide]"), nudgeEl = root.querySelector("[data-nudge]");

  function tt() { return T[lang()] || T.RU; }
  /* The markup above is written in Russian like every template in the shop,
     but translateTree() never reaches this root — so the labels are set from
     T here: once at load for the closed bubble, and again on every open. */
  function paintLabels() {
    var t = tt();
    fab.setAttribute("aria-label", t.aria);
    panel.setAttribute("aria-label", t.aria);
    root.querySelector(".sbot__x").setAttribute("aria-label", t.close);
    root.querySelector(".sbot__send").setAttribute("aria-label", t.send);
    paintWide();
    if (nudgeVisible()) nudgePaint();
  }

  /* «Развернуть» / «Свернуть»: the panel grows to ~720 px and 80 vh
     (styles.css .sbot--wide) and the choice lives for the session. The
     label is the state — «Свернуть» while wide — so the button needs no
     aria-pressed on top of it. */
  function isWide() { return root.classList.contains("sbot--wide"); }
  function setWide(on) {
    root.classList.toggle("sbot--wide", !!on);
    try { sessionStorage.setItem(WIDE_SS, on ? "1" : "0"); } catch (e) {}
    paintWide();
  }
  function paintWide() {
    var t = tt(), on = isWide();
    wideBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (on ? '<path d="M10 14H4v6M14 10h6V4M4 20l6-6M20 4l-6 6"/>' : '<path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6"/>') +
      "</svg><span>" + esc(on ? t.narrow : t.wide) + "</span>";
  }
  try { if (sessionStorage.getItem(WIDE_SS) === "1") root.classList.add("sbot--wide"); } catch (e) {}
  paintLabels();
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  // the shop's own eur(): «12,90 €» in RU/ET, «€12.90» on the English shop
  function eur(n) {
    var v = (Math.round(n * 100) / 100).toFixed(2);
    if (lang() === "EN") return "€" + v.replace(".00", "");
    return v.replace(".", ",").replace(",00", "") + " €";
  }

  function bubble(cls, html) {
    var d = document.createElement("div");
    d.className = "sbot__msg sbot__msg--" + cls;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  /* The catalogue stores one Russian name per product; the shop translates the
     descriptive tail («— шампунь») when it draws a card. This widget draws its
     own rows, so it has to ask for the same treatment — app.js publishes the
     function, and a missing one just means the Russian name, as before. */
  function pname(p) {
    var l = lang();
    if (l === "RU" || typeof window.rempireTrName !== "function") return p.name;
    try {
      return window.rempireTrName(p.name, l) || p.name;
    } catch (e) {
      return p.name;
    }
  }
  function productRow(p) {
    return '<div class="sbot__prod">' +
      '<span class="sbot__ph" style="background-image:url(\'' + (p.img || "") + '\')"></span>' +
      '<span class="sbot__pn">' + esc(p.brand) + " " + esc(pname(p)) +
        '<span class="sbot__pp">' + (p.priceFrom ? tt().from : "") + eur(p.price) + "</span></span>" +
      '<span class="sbot__pact"><button class="sbot__mini" data-add="' + p.id + '">' + tt().add + "</button>" +
      '<button class="sbot__mini sbot__mini--ghost" data-go-product="' + p.id + '">' + tt().open + "</button></span>" +
      "</div>";
  }
  /* The shop prompt asks the assistant to finish an answer with the article's
     own address — «add its link at the end of your reply as a bare relative
     path: /blogs/news/<slug>» (src/app/api/assistant/route.ts) — and the
     bubble printed it as text: a shopper reading «/blogs/news/kak-uhazhivat»
     had to retype it into the address bar. It becomes the shop's own blog link
     here, AFTER escaping, so the path stays text until this line makes it a
     link and nothing else in the reply can: the slug is [a-z0-9-] and nothing
     else, and `data-go-blog` is what a tile on /blogs/news carries, so the
     click is app.js's and stays in the SPA. The href is built in the language
     the shopper is reading, whatever prefix the model wrote. The /shop2/…
     spelling (the shop's addresses until 08.10.2026) is still read, for a
     conversation that started before the move. */
  var BLOG_SEG = { RU: "/ru", ET: "/et", EN: "" };
  var BLOG_PATH_RX = /(?:\/(?:ru|et|en))?\/blogs\/news\/([a-z0-9-]{1,80})|\/shop2\/(?:et\/|en\/|ru\/)?blog\/([a-z0-9-]{1,80})\/?/gi;
  function withBlogLinks(html) {
    return String(html).replace(BLOG_PATH_RX, function (whole, slug, oldSlug) {
      var s = String(slug || oldSlug).toLowerCase();
      return '<a href="' + (BLOG_SEG[lang()] || "") + "/blogs/news/" + encodeURIComponent(s) +
        '" data-go-blog="' + s + '">' + whole + "</a>";
    });
  }
  /* «Из нашего блога» — the article an answer is built on, as a card above the
     product rows (Dim, 02.11.2026: the blog is the source of truth for what to
     choose; the design is canvas-banner/project/Assist.dc.html). The route
     sends it as data — {slug, title in the shopper's language, cover} — only
     for an article the shop really has published (articleOfAnswer in
     src/app/api/assistant/blog-digest.ts), and it is checked again here: the
     slug is [a-z0-9-] and nothing else, the cover a plain http(s) or
     same-site address, every word escaped. The link is in the language the
     shopper reads and carries `data-go-blog`, so app.js opens the article in
     place, like a tile on /blogs/news. `link: false` draws the same card as a
     plain box — the pinned article the shopper is already reading. */
  var ART_SLUG = /^[a-z0-9-]{1,80}$/;
  function safeCover(u) {
    u = String(u || "");
    return /^https?:\/\/[^\s"'<>()\\]+$/i.test(u) || /^\/(?!\/)[^\s"'<>()\\]*$/.test(u) ? u : "";
  }
  function articleCard(a, link) {
    if (!a || typeof a !== "object" || !ART_SLUG.test(String(a.slug || ""))) return "";
    var t = tt(), slug = String(a.slug), title = typeof a.title === "string" && a.title ? a.title : slug;
    var img = safeCover(a.cover);
    var inner = (img ? '<img class="sbot__art-ph" src="' + esc(img) + '" alt="" loading="lazy" width="64" height="64">' : "") +
      '<span class="sbot__art-tx"><span class="sbot__art-eb">' + esc(t.fromBlog) + "</span>" +
      '<span class="sbot__art-t">' + esc(title) + "</span></span>";
    if (link === false) return '<div class="sbot__art">' + inner + "</div>";
    return '<a class="sbot__art" href="' + (BLOG_SEG[lang()] || "") + "/blogs/news/" + slug +
      '" data-go-blog="' + slug + '">' + inner + "</a>";
  }
  /* «Добавить всё в корзину» under the products of an article answer — the
     guide's own set, one tap. Two products or more, and only what is in stock. */
  function addAllButton(items) {
    var ok = items.filter(inStock);
    if (ok.length < 2) return "";
    return '<button class="sbot__mini sbot__all" data-addall="' + ok.map(function (p) { return p.id; }).join(",") + '">' + tt().addAll + "</button>";
  }
  function rulesReply(q) {
    var r = match(q), t = tt();
    /* Nothing to show is not «вот что подходит:» with a blank under it. Every
       branch of match() ends in pick(), which drops what is out of stock, so
       a shelf that is empty right now can empty any of them — and both of the
       sentences below promise rows. Checked here, once, where the answer is
       actually written (Renat, 17.09.2026). */
    if (!r.items || !r.items.length) { bubble("bot", t.empty); return; }
    if (r.kind === "set") {
      var sum = r.items.reduce(function (s, p) { return s + p.price; }, 0);
      bubble("bot", t.set + " " + eur(sum) + r.items.map(productRow).join("") +
        '<button class="sbot__mini sbot__all" data-addall="' + r.items.map(function (p) { return p.id; }).join(",") + '">' + t.addAll + "</button>");
      return;
    }
    bubble("bot", (r.kind === "none" ? t.none : t.found) + r.items.map(productRow).join(""));
  }
  function reply(q) {
    convo.push({ role: "user", content: q });
    // …and the re-probe (see probeAI): this one is answered by the rules, the
    // next one by the model if the shop has it after all
    probeAI();
    if (!aiEnabled) { rulesReply(q); return; }
    var wait = document.createElement("div");
    wait.className = "sbot__msg sbot__msg--bot";
    wait.textContent = "…";
    log.appendChild(wait); log.scrollTop = log.scrollHeight;
    /* Which conversation this question belongs to. paintPanel() throws the log
       and `convo` away when the shop's language changed under the widget, and
       an answer still in the air belongs to the conversation that is gone: it
       came back in the language the question was asked in, landed under a
       greeting in the new one — and ran its action, so «в корзину» or
       «оформить заказ» happened in a panel the shopper had just reset. A reply
       to a conversation that no longer exists is dropped, action and all. */
    var gen = convoGen;
    var ask = { messages: convo.slice(-8), lang: lang() };
    // the article the chat was opened from (openChatAbout) — the route always reads it first
    if (pinned) ask.article = pinned.slug;
    fetch("/api/assistant/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ask)
    })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        wait.remove();
        if (gen !== convoGen) return;
        /* A reply that is not a sentence is not a reply. The route already
           answers "" for anything that is not a string, and the admin side
           checks again on arrival (app.js askAdminAI) — this is the same door
           on this side, so a model that answered with an object can never put
           «[object Object]» in a shopper's chat the way it did in the owner's
           confirm card (Renat, 13.09.2026). */
        var text = typeof j.reply === "string" ? j.reply : "";
        convo.push({ role: "assistant", content: text });
        /* The route refuses an id the catalogue does not have, and fills
           the list from the shop's own match when the model promised options
           and named none (src/app/api/assistant/route.ts) — so a sentence
           that offers products arrives with the products under it. */
        var prods = (Array.isArray(j.product_ids) ? j.product_ids : []).map(function (id) { return byIdMap[id]; })
          .filter(Boolean);
        /* An answer built on one of the salon's articles: the article card
           first, then its products, then «Добавить всё в корзину» — the order
           of the design (Assist.dc.html). Any other answer is drawn exactly as
           before: the sentence and the product rows. */
        var art = articleCard(j.article);
        bubble("bot", withBlogLinks(esc(text)) + art + prods.map(productRow).join("") +
          (art ? addAllButton(prods) : ""));
        runAction(j.action);
      })
      .catch(function () { wait.remove(); if (gen === convoGen) rulesReply(q); });
  }
  function refreshHint() {
    var h = root.querySelector("[data-bh]");
    if (h && aiEnabled) h.textContent = { RU: "ИИ-помощник", ET: "AI-abiline", EN: "AI assistant" }[lang()] || "AI";
  }

  /* Server-validated actions: the assistant can put things in the cart and
     walk the shopper to the right page. Everything goes through the shop's
     own delegated buttons, so cart logic, toasts and history behave exactly
     as if the shopper clicked. */
  function appClick(attr, value) {
    var b = document.createElement("button");
    b.setAttribute(attr, value == null ? "1" : value);
    document.body.appendChild(b); b.click(); b.remove();
  }
  function runAction(a) {
    if (!a || !a.type) return;
    if (a.type === "add_to_cart" && Array.isArray(a.ids)) {
      a.ids.slice(0, 5).forEach(function (id) { if (byIdMap[id]) appClick("data-add", id); });
      if (a.then === "checkout") { openPanel(false); appClick("data-checkout", "1"); }
      else if (a.then === "open_cart") appClick("data-cart", "1");
      return;
    }
    if (a.type === "open_product" && byIdMap[a.id]) { appClick("data-go-product", a.id); return; }
    if (a.type === "open_category") { appClick("data-go-cat", a.id); return; }
    if (a.type === "open_cart") { appClick("data-cart", "1"); return; }
    if (a.type === "checkout") { openPanel(false); appClick("data-checkout", "1"); }
  }

  var uiLang = null;
  // the chrome follows the site language on EVERY open, not only the first —
  // switching the site to ET used to leave a Russian chat
  function paintPanel() {
    var t = tt();
    root.querySelector("[data-bt]").textContent = t.title;
    root.querySelector("[data-bh]").textContent = t.hint;
    input.placeholder = t.placeholder;
    paintLabels();
    chipsEl.innerHTML = t.chips.map(function (c) {
      return '<button class="sbot__chip" data-q="' + esc(c) + '">' + esc(c) + "</button>";
    }).join("");
    refreshHint();
    if (!log.childNodes.length || uiLang !== lang()) {
      if (uiLang !== null && uiLang !== lang()) { log.innerHTML = ""; convo = []; convoGen++; pinned = null; }
      bubble("bot", t.hello);
    }
    uiLang = lang();
  }
  function openPanel(open) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    // a chat that was opened needs no reminder — not now, not later this session
    if (open) { nudgeMarkDone(); if (nudgeVisible()) nudgeHide(false); }
    if (open) probeAI();
    if (open) paintPanel();
    if (open) input.focus();
    // analytics agent: app.js exposes track() as window.__rmpTrack for
    // exactly this — chat.js has no other way to reach it (docs/analytics.md)
    if (open && window.__rmpTrack) window.__rmpTrack("chat");
  }

  /* ---- «Спросить об этой статье» ------------------------------------------
     window.openChatAbout(slug, title) — for the blog article page, whose
     button («Спросить об этой статье») app.js draws, not this file:

       if (typeof window.openChatAbout === "function") window.openChatAbout(post.slug, post.title);

     It opens the chat and PINS that article for the rest of the conversation:
     every question then carries `article: "<slug>"` to POST /api/assistant/,
     and the route always puts that article's digest first in the prompt,
     whatever the question (shopGuides in src/app/api/assistant/blog-digest.ts)
     — so «а что из этого подойдёт мне?» is answered from the article on the
     screen and with its products. The log shows the article as a card, with a
     one-line invitation under it.

       slug   the article's address, [a-z0-9-] only; anything else → false.
       title  the article's title in the language on screen, for the card; optional.
       →      true when the chat opened; false when it may not show here — a
              narrow window, the checkout, the chat switched off in Настройки.
              On a phone this file is never loaded at all (app.js mountChat),
              so the function does not exist there: feature-detect, as above.

     Called again with another article it re-pins; with the same one it only
     opens the chat. Switching the site's language starts a new conversation
     (paintPanel) and the pin goes with it. */
  window.openChatAbout = function (slug, title) {
    var s = String(slug == null ? "" : slug).trim().toLowerCase();
    if (!ART_SLUG.test(s) || !chatAllowed()) return false;
    if (panel.hidden) openPanel(true); else input.focus();
    var same = pinned && pinned.slug === s;
    var name = typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    pinned = { slug: s, title: name };
    if (!same) {
      bubble("bot", (name ? articleCard({ slug: s, title: name }, false) : "") +
        '<span class="sbot__art-ask">' + esc(tt().askAbout) + "</span>");
    }
    return true;
  };
  function refreshVisibility() {
    var ok = chatAllowed();
    root.style.display = ok ? "" : "none";
    if (!ok && !panel.hidden) openPanel(false);
    // the bubble belongs to the catalogue side: walking on to the account
    // or a legal page takes it away (it has been shown; it does not return)
    if (nudgeVisible() && (!ok || !nudgeScreenOk())) nudgeHide(false);
  }
  refreshVisibility();
  new MutationObserver(refreshVisibility)
    .observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  // the same gate on a resize: a desktop window dragged to phone width, or a
  // tablet turned on its side, must take the widget away with it
  try {
    if (window.matchMedia) {
      var mq = window.matchMedia(WIDE);
      if (mq.addEventListener) mq.addEventListener("change", refreshVisibility);
      else if (mq.addListener) mq.addListener(refreshVisibility);
    }
  } catch (e) {}

  /* ---- the reminder bubble (NUDGE_* at the top of this file) --------------
     One timer from load. When it runs out: show the bubble if this is a
     moment for it; wait another turn if the shopper is somewhere it does not
     belong right now (the checkout, an open cart drawer, a window dragged
     narrow); stop for good once it has been shown, dismissed, or the chat
     itself was opened. Storage is read through try/catch throughout — a
     private window that refuses it simply gets the once-per-page behaviour. */
  function nudgeDismissed() {
    try {
      var at = Number(localStorage.getItem(NUDGE_LS) || 0);
      return at > 0 && Date.now() - at < NUDGE_DISMISS_DAYS * 864e5;
    } catch (e) { return false; }
  }
  function nudgeDone() { try { return sessionStorage.getItem(NUDGE_SS) === "1"; } catch (e) { return false; } }
  function nudgeMarkDone() { try { sessionStorage.setItem(NUDGE_SS, "1"); } catch (e) {} }
  function nudgeScreenOk() { return NUDGE_SCREENS.indexOf(document.body.dataset.screen) >= 0; }
  function nudgeVisible() { return !!nudgeEl.childNodes.length; }
  function nudgePaint() {
    var t = tt();
    nudgeEl.innerHTML = '<button class="sbot__nudge-go" data-nudgego>' + esc(t.nudge) + "</button>" +
      '<button class="sbot__nudge-x" data-nudgex aria-label="' + esc(t.nudgeClose) + '">✕</button>';
  }
  function nudgeShow() { nudgePaint(); nudgeMarkDone(); }
  /* `forget` — the × or Escape: not for another NUDGE_DISMISS_DAYS */
  function nudgeHide(forget) {
    nudgeEl.innerHTML = "";
    if (forget) { try { localStorage.setItem(NUDGE_LS, String(Date.now())); } catch (e) {} }
  }
  var nudgeTimer = null;
  function nudgeArm() {
    if (!NUDGE_ON || nudgeTimer) return;
    nudgeTimer = setTimeout(nudgeTick, NUDGE_DELAY_MS);
  }
  function nudgeTick() {
    nudgeTimer = null;
    if (!NUDGE_ON || nudgeDone() || nudgeDismissed() || !panel.hidden) return;
    if (!chatAllowed() || !nudgeScreenOk() || document.body.classList.contains("is-locked")) { nudgeArm(); return; }
    nudgeShow();
  }
  nudgeArm();
  /* Escape takes it away like the × does — without moving focus anywhere.
     Not while a drawer owns the screen: body.is-locked hides the whole
     widget (styles.css), so that Escape is the drawer's, and a bubble nobody
     could see must not be put away for a week by it. */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !nudgeVisible()) return;
    if (document.body.classList.contains("is-locked")) return;
    nudgeHide(true);
  });

  /* The language switch sits in the header, which stays clickable while the
     chat is open — and the chat root is outside translateTree(), so nothing
     else would repaint it. setHead() writes <html lang> on every render, so
     one observer catches every switch: the header menu and the checkout
     header alike. Closed bubble → labels only; open panel → the whole chrome. */
  new MutationObserver(function () {
    if (panel.hidden) paintLabels(); else paintPanel();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  fab.addEventListener("click", function () { openPanel(panel.hidden); });
  root.querySelector(".sbot__x").addEventListener("click", function () { openPanel(false); });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    bubble("me", esc(q));
    input.value = "";
    setTimeout(function () { reply(q); }, 250);
  });
  root.addEventListener("click", function (e) {
    if (e.target.closest("[data-wide]")) { setWide(!isWide()); return; }
    // the bubble: its text opens the chat, its × puts it away for a week
    if (e.target.closest("[data-nudgego]")) { nudgeHide(false); openPanel(true); return; }
    if (e.target.closest("[data-nudgex]")) { nudgeHide(true); return; }
    var chip = e.target.closest("[data-q]");
    if (chip && chip.closest(".sbot")) {
      bubble("me", esc(chip.dataset.q));
      setTimeout(function () { reply(chip.dataset.q); }, 250);
      e.stopPropagation(); // the shop's own [data-q] handler must not also fire
      return;
    }
    var all = e.target.closest("[data-addall]");
    if (all) {
      all.dataset.addall.split(",").forEach(function (id) {
        var b = document.createElement("button");
        b.setAttribute("data-add", id);
        document.body.appendChild(b); b.click(); b.remove();
      });
    }
  }, true);
})();
