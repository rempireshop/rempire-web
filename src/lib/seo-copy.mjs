/* The words a search result is made of — the <title>, the meta description
   and the link-preview pair of the home page, the eight sections, every brand
   page, the blog list and the product-title rule — in one place, for all
   three renderers of a page's head:

     tools/prerender-shop2.mjs   the static pages a crawler is served
     src/lib/*-page.ts           the pages written at request time (the blog
                                 list, a product the owner made in the panel)
     public/shop2/app.js         setHead(), once the shop has booted — the
                                 rendered page, which is what Google indexes

   Until 09.10.2026 those were three tables that said three different things:
   the static section page read «Habemehooldus — osta Rempire'ist», the same
   page after boot «Habemehooldus — REMPIRE», and the English home page had
   one title static and another rendered (SEO audit 08.10.2026, W4/T2). The
   words are the audit's §1A, approved by Dim on 08.10.2026
   (Rempire/seo/seo-competitive-intelligence-audit-2026-10-08.md).

   ---- one block, two files ------------------------------------------------
   app.js is a plain ES5 script in the browser and cannot import this file,
   so everything between the two `seo-copy` marker lines below is copied into
   app.js byte for byte by `node tools/sync-seo-copy.mjs`. That is why the
   block is written the way app.js is — `var` and `function`, no arrow, no
   template literal, two spaces of indent — and why it reads nothing from its
   surroundings: every fact it needs (the language, the free-delivery
   thresholds from settings.shipping_rules, the product's own name) is an
   argument. tests/seo-copy.test.ts fails when the two copies differ, and so
   does the prerender, before it writes a page.

   EDIT HERE, then run `node tools/sync-seo-copy.mjs`. Never edit the copy in
   app.js by hand.

   ---- the rules (audit §1A) -----------------------------------------------
   · A title is at most 60 characters, a description at most 155.
   · No «— купить в Rempire / osta Rempire'ist / buy at Rempire» filler: Google
     prints the site's name beside every result already (og:site_name and the
     WebSite block). Home, brand and blog titles keep the brand; section and
     product titles spend those characters on what people type. A trailing
     «| REMPIRE» is written in the house form, «— REMPIRE» (seoHouse()).
   · A figure — the free-delivery threshold — is never typed here. It comes
     from the rules the checkout bills with (settings.shipping_rules), and a
     threshold the owner switched off drops the clause instead of printing a
     promise.
   · A Russian alias only where Search Console shows Russians typing it. */

/* seo-copy:start */
  var SEO_TITLE_MAX = 60;
  var SEO_DESC_MAX = 155;

  /** The copy itself — a function, not a var, so the shop can call it from
      anywhere in its script whatever order the lines run in. */
  function seoCopy() {
    return {
      home: {
        EN: {
          t: "REMPIRE — Hair, Beard & Skin Care from a Tallinn Salon",
          d: "Kevin.Murphy, System 4, Davines, Proraso, Korean skincare and niche perfume, chosen by our salon team. Pickup at Mardi 1, Tallinn; EU-wide delivery.",
          ogT: "REMPIRE — salon hair, beard & skin care, Tallinn",
          ogD: "Kevin.Murphy, System 4, Davines, Proraso, Korean skincare and niche perfume, chosen by our Tallinn salon team. Pickup at Mardi 1 or delivery across Europe."
        },
        ET: {
          t: "REMPIRE — juukse-, habeme- ja nahahooldus Tallinnas",
          d: "Kevin.Murphy, System 4, Davines, Proraso, Korea nahahooldus ja nišiparfüümid meie salongi valikust. Järeletulek Mardi 1, tasuta tarne alates {free}.",
          dNoFree: "Kevin.Murphy, System 4, Davines, Proraso, Korea nahahooldus ja nišiparfüümid meie salongi valikust. Järeletulek Mardi 1 või tarne üle Euroopa.",
          ogT: "REMPIRE — salongi juukse-, habeme- ja nahahooldus",
          ogD: "Kevin.Murphy, System 4, Davines, Proraso, Korea nahahooldus ja nišiparfüümid meie Tallinna salongi valikust. Järeletulek Mardi 1 või tarne üle Euroopa."
        },
        RU: {
          t: "REMPIRE — уход за волосами, бородой и кожей в Таллинне",
          d: "Kevin.Murphy, System 4, Davines, Proraso, корейская косметика и нишевая парфюмерия от салона REMPIRE. Самовывоз на Mardi 1, доставка по Эстонии и ЕС.",
          ogT: "REMPIRE — салонный уход для волос, бороды и кожи",
          ogD: "Kevin.Murphy, System 4, Davines, Proraso, корейская косметика и нишевая парфюмерия от салона в Таллинне. Самовывоз на Mardi 1 или доставка по Европе."
        }
      },
      /* [title, description] per section and language — «all» is «Все товары». */
      cat: {
        hair: {
          EN: ["Hair Care: Shampoos, Conditioners, Masks & Scalp Care", "System 4, Kevin.Murphy, Davines and Paul Mitchell: shampoos, conditioners, masks and scalp treatments for oily, dry or thinning hair. Pickup in Tallinn."],
          ET: ["Juuksehooldus: šampoonid, palsamid ja juuksemaskid", "System 4, Kevin.Murphy, Davines ja Paul Mitchell: šampoonid, palsamid, juuksemaskid ja peanahahooldus rasustele, kuivadele või hõrenevatele juustele."],
          RU: ["Уход за волосами: шампуни, кондиционеры, маски", "System 4, Kevin.Murphy, Davines и Paul Mitchell: шампуни, кондиционеры, маски и средства для кожи головы — от жирности, сухости и выпадения."]
        },
        styling: {
          EN: ["Hair Styling: Wax, Paste, Clay, Hairspray & Powder", "Kevin.Murphy, Davines, Gatsby and Paul Mitchell styling: matte paste, wax, clay, texture spray and volume powder, plus our paste-vs-wax guide."],
          ET: ["Viimistlus: juuksevaha, pasta, savi ja juukselakk", "Kevin.Murphy, Davines, Gatsby ja Paul Mitchell: juuksevaha, matt pasta, savi, tekstuurisprei ja puuder. Pasta, vaha või savi? Vaata meie juhendit."],
          RU: ["Стайлинг: воск, паста, глина и спреи для волос", "Kevin.Murphy, Davines, Gatsby и Paul Mitchell: воск, матовая паста, глина, текстурирующие спреи и пудра для объёма. Что выбрать — в нашем разборе."]
        },
        beard: {
          EN: ["Beard Care & Shaving: Beard Oil, Balm & Aftershave", "Captain Fawcett, Proraso and Davines beard oils, balms, moustache wax, shaving gels and aftershave — the products our Tallinn barbers use. EU delivery."],
          ET: ["Habemehooldus: habemeõli, habemepalsam, raseerimine", "Captain Fawcett, Proraso ja Davines: habemeõlid, habemepalsamid, vuntsivaha, raseerimisgeelid ja raseerimisjärgne hooldus. Järeletulek Mardi 1."],
          RU: ["Уход за бородой: масло, бальзам, воск, бритьё", "Captain Fawcett, Proraso и Davines: масла и бальзамы для бороды, воск для усов, гели для бритья и лосьоны после бритья. Самовывоз на Mardi 1."]
        },
        face: {
          EN: ["Face Care: Korean Skincare, Toners, Serums & Masks", "Anua, Cosrx, Laneige, Nature Republic and Gummy Korean skincare plus Lumin for men: toners, cleansers, serums, masks and SPF. Pickup in Tallinn."],
          ET: ["Näohooldus: Korea kosmeetika, toonikud ja seerumid", "Anua, Cosrx, Laneige, Nature Republic, Gummy ja Lumin meestele: toonikud, puhastusvahendid, seerumid, maskid ja päikesekreem. Järeletulek Mardi 1."],
          RU: ["Уход за лицом: корейская косметика, тонеры, сыворотки", "Anua, Cosrx, Laneige, Nature Republic, Gummy и мужская косметика Lumin: тонеры, умывалки, сыворотки, маски и SPF. Самовывоз на Mardi 1, Таллинн."]
        },
        body: {
          EN: ["Body Care: Tattoo Aftercare, Handmade Soap & Body Wash", "Yumain tattoo aftercare (numbing serum, balm, cleansing foam), REMPIRE's own handmade soap and Davines and Byredo body wash. Pickup at Mardi 1, Tallinn."],
          ET: ["Kehahooldus: tätoveeringu hooldus, käsitööseep, dušigeel", "Yumaini tätoveeringu järelhooldus (seerum, palsam, puhastusvaht), REMPIRE'i käsitööseep ning Davinesi ja Byredo dušigeelid. Järeletulek Mardi 1."],
          RU: ["Уход за телом: уход за тату, мыло ручной работы", "Yumain для ухода за татуировкой (сыворотка, бальзам, пенка), мыло ручной работы REMPIRE, гели для душа Davines и Byredo. Самовывоз на Mardi 1."]
        },
        perfume: {
          EN: ["Niche & Designer Perfume: Creed, Xerjoff, Byredo, Kilian", "Creed Aventus, Xerjoff Naxos, Byredo, Tom Ford, Kilian, MFK Baccarat Rouge 540 and Roja: original perfume, in stock in Tallinn. Pickup at Mardi 1."],
          ET: ["Nišiparfüümid: Creed, Xerjoff, Byredo, Tom Ford, Kilian", "Creed Aventus, Xerjoff Naxos, Byredo, Tom Ford, Kilian, MFK Baccarat Rouge 540 ja Roja: originaalparfüümid, laos Tallinnas. Järeletulek Mardi 1."],
          RU: ["Нишевая парфюмерия: Creed, Xerjoff, Byredo, Tom Ford", "Creed Aventus, Xerjoff Naxos, Byredo, Tom Ford, Kilian, MFK Baccarat Rouge 540 и Roja — оригинальная парфюмерия в наличии в Таллинне. Самовывоз на Mardi 1."]
        },
        merch: {
          EN: ["REMPIRE Merch: Artist T-Shirts in Small Runs", "Oversized and deep-cut T-shirts with prints by REMPIRE's artists, in small runs — including the Siim Hanikat × REMPIRE collab. EU delivery."],
          ET: ["REMPIRE merch: kunstnike disainiga T-särgid", "Oversized ja sügava kaelusega T-särgid REMPIRE'i kunstnike trükistega, väikestes tiraažides, sh Siim Hanikat × REMPIRE. Järeletulek Tallinnas."],
          RU: ["Мерч REMPIRE: футболки с принтами художников", "Оверсайз-футболки и футболки с глубоким вырезом с принтами художников REMPIRE, малыми тиражами, включая коллаб Siim Hanikat × REMPIRE."]
        },
        all: {
          EN: ["All Products: Hair, Beard, Skin Care & Perfume | REMPIRE", "Every product on the REMPIRE shelf: salon hair care and styling, beard care, Korean skincare, body care and niche perfume. Pickup in Tallinn, EU delivery."],
          ET: ["Kõik tooted: juuksed, habe, nahk ja parfüümid | REMPIRE", "Kogu REMPIRE'i valik: salongi juuksehooldus ja viimistlus, habemehooldus, Korea nahahooldus, kehahooldus ja nišiparfüümid. Järeletulek Tallinnas."],
          RU: ["Все товары: волосы, борода, кожа, парфюмерия | REMPIRE", "Весь ассортимент REMPIRE: салонный уход и стайлинг для волос, уход за бородой, корейская косметика, уход за телом и парфюмерия. Самовывоз в Таллинне."]
        }
      },
      /* A brand page: its own [title, meta description] where the owner has
         approved a text for it, otherwise the template's fallback title
         «{brand} in Tallinn | REMPIRE» (audit §1A) over the description the
         brand pages have always carried. */
      brand: {},
      brandFallback: { EN: "{brand} in Tallinn | REMPIRE", ET: "{brand} Tallinnas | REMPIRE", RU: "{brand} в Таллинне | REMPIRE" },
      brandGeneric: {
        EN: "{brand} in stock at Rempire, Tallinn — the brand's full range across every section of the shop.",
        ET: "{brand} laos Rempire'is, Tallinn — kogu brändi valik kõigist poe osakondadest.",
        RU: "{brand} в наличии в Rempire, Таллинн — весь ассортимент бренда во всех разделах магазина."
      },
      blog: {
        EN: ["Hair, Beard & Skin Care Guides — REMPIRE Blog", "Practical guides from the REMPIRE salon in Tallinn: how to choose a shampoo for your scalp, paste vs wax vs clay, beard care in winter, and more."],
        ET: ["Juukse-, habeme- ja nahahoolduse nõuanded — REMPIRE", "Praktilised juhendid REMPIRE'i salongist Tallinnas: kuidas valida šampooni peanaha järgi, pasta, vaha või savi, habemehooldus talvel ja muud."],
        RU: ["Советы по уходу за волосами, бородой и кожей — REMPIRE", "Разборы от салона REMPIRE в Таллинне: как выбрать шампунь по типу кожи головы, паста, воск или глина, уход за бородой зимой и другое."]
      },
      /* The words Russians type for two products, from Search Console (audit
         §1A): «шампунь номер 1» and «ксерджофф наксос». `tail` goes after the
         type, `name` in brackets after the maker's name. Nothing else gets
         one — an alias nobody searches for is a longer title for nothing. */
      ruAlias: {
        "system-4-special-shampoo-1": { tail: "№1" },
        "xerjoff-1861-naxos-eau-de-parfum-100ml": { name: "Ксерджофф Наксос" }
      },
      from: { EN: "from ", ET: "alates ", RU: "от " }
    };
  }

  /** «70 €» / «€70» — the shop's money, whole euros without decimals (eur() in app.js). */
  function seoEur(n, lang) {
    var v = (Math.round(n * 100) / 100).toFixed(2);
    return lang === "EN" ? "€" + v.replace(".00", "") : v.replace(".", ",").replace(",00", "") + " €";
  }

  /** Cut at a word with «…», never mid-word — clip() in src/lib/seo-head.mjs. */
  function seoClip(s, max) {
    var t = String(s == null ? "" : s).trim();
    if (t.length <= max) return t;
    var cut = t.slice(0, max - 1), sp = cut.lastIndexOf(" ");
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:·—–-]+$/, "") + "…";
  }

  function seoFill(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m;
    });
  }

  /**
   * The free-delivery threshold for one country, from the rules the checkout
   * bills with: the country's own key, then the shop-wide «freeFrom» — the
   * steps threshold() in app.js and quoteFromRules() on the server take (no
   * Baltic country has a zone key of its own). null where delivery to it is
   * never free.
   */
  function seoFreeFrom(rules, cc) {
    var by = (rules && rules.freeFromByCountry) || {};
    var v = Object.prototype.hasOwnProperty.call(by, cc) ? by[cc] : rules ? rules.freeFrom : null;
    return typeof v === "number" && isFinite(v) && v >= 0 ? v : null;
  }

  /** «… | REMPIRE» in the shop's house form, «… — REMPIRE» — what fitTitle()
      writes everywhere else, so a title ends the same way on every page. */
  function seoHouse(t) {
    return String(t).replace(/\s*\|\s*REMPIRE$/, " — REMPIRE");
  }

  /** «от 7,90 €» / «alates 7,90 €» / «from €7.90» — a product's price as its title prints it. */
  function seoPriceText(price, from, lang) {
    return (from ? seoCopy().from[lang] || "" : "") + seoEur(price, lang);
  }

  /** «brand + name — type», with the one alias Russians type for it, if any. */
  function seoProductCore(id, core, lang) {
    var a = lang === "RU" ? seoCopy().ruAlias[id] : null;
    if (!a) return core;
    var cut = core.lastIndexOf(" — ");
    if (a.name) return cut > 0 ? core.slice(0, cut) + " (" + a.name + ")" + core.slice(cut) : core + " (" + a.name + ")";
    return core + " " + a.tail;
  }

  /**
   * A product's title: brand, the maker's name and the type, with the price
   * when it still fits — and never «— купить в Rempire» or «— REMPIRE» to
   * fill the line (audit §1A). Too long even bare, it is cut at a word.
   */
  function seoProductTitle(core, priceText) {
    var full = core + " · " + priceText;
    if (priceText && full.length <= SEO_TITLE_MAX) return full;
    return seoClip(core, SEO_TITLE_MAX);
  }

  /**
   * The head of one page: { t, d, ogT, ogD } — title, meta description and the
   * link-preview pair (the same two, except on the home page).
   *
   *   kind  "home" | "cat" | "brand" | "blog"
   *   key   the section ("hair" … "all") or the brand's name; "" otherwise
   *   lang  "RU" | "ET" | "EN"
   *   ctx   { rules } — settings.shipping_rules as the checkout bills them
   */
  function seoHead(kind, key, lang, ctx) {
    var C = seoCopy();
    var rules = ctx && ctx.rules;
    var t = "", d = "", ogT = "", ogD = "";
    if (kind === "home") {
      var h = C.home[lang] || C.home.EN;
      var free = seoFreeFrom(rules, "EE");
      t = h.t;
      d = h.dNoFree && free === null ? h.dNoFree : seoFill(h.d, { free: free === null ? "" : seoEur(free, lang) });
      ogT = h.ogT;
      ogD = h.ogD;
    } else if (kind === "cat") {
      var c = (C.cat[key] || C.cat.all)[lang] || C.cat.all.EN;
      t = c[0];
      d = c[1];
    } else if (kind === "brand") {
      var b = C.brand[key] && C.brand[key][lang];
      if (b) {
        t = b.title;
        d = b.meta;
      } else {
        t = seoFill(C.brandFallback[lang] || C.brandFallback.EN, { brand: key });
        d = seoFill(C.brandGeneric[lang] || C.brandGeneric.EN, { brand: key });
      }
      /* the house's name once: a brand that IS the house (Rempire's own
         soap and merch) needs no second one, and a long brand name keeps its
         words rather than the suffix */
      var bare = t.replace(/\s*\|\s*REMPIRE$/, "");
      if (/rempire/i.test(bare) || seoHouse(t).length > SEO_TITLE_MAX) t = bare;
    } else if (kind === "blog") {
      var g = C.blog[lang] || C.blog.EN;
      t = g[0];
      d = g[1];
    }
    t = seoClip(seoHouse(t), SEO_TITLE_MAX);
    d = seoClip(d, SEO_DESC_MAX);
    return { t: t, d: d, ogT: ogT ? seoClip(ogT, SEO_TITLE_MAX) : t, ogD: ogD ? seoClip(ogD, SEO_DESC_MAX) : d };
  }
/* seo-copy:end */

export {
  SEO_TITLE_MAX, SEO_DESC_MAX,
  seoCopy, seoEur, seoClip, seoFreeFrom, seoHouse, seoPriceText, seoProductCore, seoProductTitle, seoHead,
};
