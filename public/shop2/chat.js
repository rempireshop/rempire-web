/* Rempire shop assistant — the customer-facing chat (demo).
   Rule-based on purpose: it shows the PRODUCT experience (find, suggest,
   add to cart, assemble a set) while the real brain arrives with the
   backend. Reuses the shop's own delegated actions: a click on [data-add]
   or [data-go-product] inside the chat is handled by app.js like any other,
   so the cart, the toast and the badge all behave identically. */
(function () {
  "use strict";
  if (typeof CATALOGUE === "undefined") return;

  var LS = "rempire-shop-proto";
  function lang() {
    try { return (JSON.parse(localStorage.getItem(LS)) || {}).lang || "RU"; } catch (e) { return "RU"; }
  }

  /* When /api/assistant/ has an OpenAI key behind it, the chat talks to the
     real model; without one, the rule-based demo below answers. The probe is
     lazy (first open) and a network failure just means rules. */
  var aiEnabled = null, convo = [];
  function probeAI() {
    if (aiEnabled !== null) return;
    aiEnabled = false;
    fetch("/api/assistant/", { method: "GET" })
      .then(function (r) { return r.json(); })
      .then(function (j) { aiEnabled = !!j.enabled; refreshHint(); })
      .catch(function () {});
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
      set: "Собрал набор — вместе:", cart: "Открываю корзину…",
      placeholder: "Например: масло для бороды…"
    },
    ET: {
      title: "Rempire abiline", hint: "Demo: saan aru lihtsatest fraasidest",
      hello: "Tere! Aitan valida. Ütle, mida otsid — näiteks „kohevust andev šampoon“, „kingitus kuni 50 €“ või „midagi habemele“.",
      chips: ["Midagi habemele", "Šampoon", "Kingitus kuni 50 €", "Hoolduskomplekt", "Parfüüm"],
      add: "Lisa ostukorvi", open: "Ava", addAll: "Lisa kõik ostukorvi",
      found: "Need sobivad:", none: "Täpset vastet ei leidnud — siin on populaarsed:",
      set: "Panin komplekti kokku — koos:", cart: "Avan ostukorvi…",
      placeholder: "Näiteks: habemeõli…"
    },
    EN: {
      title: "Rempire assistant", hint: "Demo: I understand simple phrases",
      hello: "Hi! I'll help you choose. Tell me what you're after — e.g. “volume shampoo”, “gift under €50” or “something for the beard”.",
      chips: ["Something for the beard", "Shampoo", "Gift under €50", "Care set", "Perfume"],
      add: "Add to cart", open: "Open", addAll: "Add all to cart",
      found: "Here's what fits:", none: "No exact match — here are the popular ones:",
      set: "Here's a set — together:", cart: "Opening the cart…",
      placeholder: "e.g. beard oil…"
    }
  };

  var CATS_KW = [
    [/бород|habe|beard|shav|брить/i, "beard"],
    [/волос|шампун|кондиционер|juuks|šampoon|palsam|hair|shampoo|conditioner/i, "hair"],
    [/стайлинг|уклад|паст|воск|гел|пудр|soeng|stiliseer|styling|wax|paste|clay|pomade/i, "styling"],
    [/лиц|кож[аи]|тоник|nägu|näo|face|skin|toner/i, "face"],
    [/тел|мыл|keha|seep|body|soap/i, "body"],
    [/парфюм|аромат|духи|parfüüm|lõhn|perfume|fragrance|cologne|edp/i, "perfume"],
    [/футболк|мерч|särk|merch|shirt|tee/i, "merch"]
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

  function money(s) {
    var m = String(s).match(/(?:до|kuni|under|alla)\s*(\d+)/i);
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
  /* The chat lives in the SHOP: hidden inside the admin, and the owner can
     switch it off entirely from Настройки (the admin demo store). */
  function chatAllowed() {
    try {
      var adm = JSON.parse(localStorage.getItem("rempire-admin-demo"));
      if (adm && adm.chatbot === false) return false;
    } catch (e) {}
    return document.body.dataset.screen !== "admin";
  }

  var root = document.createElement("div");
  root.className = "sbot";
  root.innerHTML =
    '<button class="sbot__fab" aria-label="Чат с помощником" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>' +
    "</button>" +
    '<section class="sbot__panel" hidden aria-label="Чат с помощником">' +
      '<header class="sbot__head"><b data-bt></b><span class="sbot__hint" data-bh></span>' +
        '<button class="sbot__x" aria-label="Закрыть">✕</button></header>' +
      '<div class="sbot__log" data-log></div>' +
      '<div class="sbot__chips" data-chips></div>' +
      '<form class="sbot__form"><input data-in autocomplete="off"><button class="sbot__send" aria-label="Отправить">→</button></form>' +
    "</section>";
  document.body.appendChild(root);

  var fab = root.querySelector(".sbot__fab"), panel = root.querySelector(".sbot__panel"),
    log = root.querySelector("[data-log]"), chipsEl = root.querySelector("[data-chips]"),
    input = root.querySelector("[data-in]"), form = root.querySelector("form");

  function tt() { return T[lang()] || T.RU; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function eur(n) { return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €"; }

  function bubble(cls, html) {
    var d = document.createElement("div");
    d.className = "sbot__msg sbot__msg--" + cls;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  function productRow(p) {
    return '<div class="sbot__prod">' +
      '<span class="sbot__ph" style="background-image:url(\'' + (p.img || "") + '\')"></span>' +
      '<span class="sbot__pn">' + esc(p.brand) + " " + esc(p.name) +
        '<span class="sbot__pp">' + (p.priceFrom ? "от " : "") + eur(p.price) + "</span></span>" +
      '<span class="sbot__pact"><button class="sbot__mini" data-add="' + p.id + '">' + tt().add + "</button>" +
      '<button class="sbot__mini sbot__mini--ghost" data-go-product="' + p.id + '">' + tt().open + "</button></span>" +
      "</div>";
  }
  function rulesReply(q) {
    var r = match(q), t = tt();
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
    if (!aiEnabled) { rulesReply(q); return; }
    var wait = document.createElement("div");
    wait.className = "sbot__msg sbot__msg--bot";
    wait.textContent = "…";
    log.appendChild(wait); log.scrollTop = log.scrollHeight;
    fetch("/api/assistant/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: convo.slice(-8), lang: lang() })
    })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        wait.remove();
        convo.push({ role: "assistant", content: j.reply || "" });
        var cards = (j.product_ids || []).map(function (id) { return byIdMap[id]; })
          .filter(Boolean).map(productRow).join("");
        bubble("bot", esc(j.reply || "") + cards);
        runAction(j.action);
      })
      .catch(function () { wait.remove(); rulesReply(q); });
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
  function openPanel(open) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    if (open) probeAI();
    if (open) {
      // the chrome follows the site language on EVERY open, not only the
      // first — switching the site to ET used to leave a Russian chat
      var t = tt();
      root.querySelector("[data-bt]").textContent = t.title;
      root.querySelector("[data-bh]").textContent = t.hint;
      input.placeholder = t.placeholder;
      chipsEl.innerHTML = t.chips.map(function (c) {
        return '<button class="sbot__chip" data-q="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("");
      refreshHint();
      if (!log.childNodes.length || uiLang !== lang()) {
        if (uiLang !== null && uiLang !== lang()) { log.innerHTML = ""; convo = []; }
        bubble("bot", t.hello);
      }
      uiLang = lang();
    }
    if (open) input.focus();
  }
  function refreshVisibility() {
    var ok = chatAllowed();
    root.style.display = ok ? "" : "none";
    if (!ok && !panel.hidden) openPanel(false);
  }
  refreshVisibility();
  new MutationObserver(refreshVisibility)
    .observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });

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
