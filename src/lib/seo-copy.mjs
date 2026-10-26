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
          d: "Kevin.Murphy, System 4, Davines, Proraso, Korean skincare and niche perfume from our salon. Pickup at Mardi 1; EU delivery, free in the Baltics from {free}.",
          dNoFree: "Kevin.Murphy, System 4, Davines, Proraso, Korean skincare and niche perfume, chosen by our salon team. Pickup at Mardi 1, Tallinn; EU-wide delivery.",
          ogT: "REMPIRE — salon hair, beard & skin care, Tallinn",
          ogD: "Kevin.Murphy, System 4, Davines, Proraso, Korean skincare and niche perfume, chosen by our Tallinn salon team. Pickup at Mardi 1 or delivery across Europe."
        },
        ET: {
          t: "REMPIRE — juukse-, habeme- ja nahahooldus Tallinnas",
          d: "Kevin.Murphy, System 4, Davines, Proraso, Korea nahahooldus ja nišiparfüümid salongist. Järeletulek Mardi 1, tarne üle ELi, Baltikumis tasuta alates {free}.",
          dNoFree: "Kevin.Murphy, System 4, Davines, Proraso, Korea nahahooldus ja nišiparfüümid meie salongi valikust. Järeletulek Mardi 1 või tarne üle Euroopa.",
          ogT: "REMPIRE — salongi juukse-, habeme- ja nahahooldus",
          ogD: "Kevin.Murphy, System 4, Davines, Proraso, Korea nahahooldus ja nišiparfüümid meie Tallinna salongi valikust. Järeletulek Mardi 1 või tarne üle Euroopa."
        },
        RU: {
          t: "REMPIRE — уход за волосами, бородой и кожей в Таллинне",
          d: "Kevin.Murphy, System 4, Davines, Proraso, корейский уход и нишевая парфюмерия от салона. Самовывоз на Mardi 1, доставка по ЕС, по Балтии бесплатно от {free}.",
          dNoFree: "Kevin.Murphy, System 4, Davines, Proraso, корейская косметика и нишевая парфюмерия от салона REMPIRE. Самовывоз на Mardi 1, доставка по Эстонии и ЕС.",
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
      /* A brand page: its own title, meta description and the visible intro
         under its heading, where the owner has approved them — the eight
         below, word for word from Rempire/seo/brand-intros.json (Dim,
         09.10.2026; the intros with the history trimmed). Every other brand
         keeps the line it always had under its heading (catIntro() in app.js)
         and the description it always carried (brandGeneric), under the
         template's fallback title «{brand} in Tallinn | REMPIRE» (audit §1A).
         The intro is the shop's own paragraph, not a snippet: seoBrandIntro().
         `metaFree` (System 4, Kevin.Murphy, Captain Fawcett — Dim, 23.10.2026)
         is the description with «in stock in Tallinn», pickup and the free
         Baltic delivery threshold, filled from the rules like the home page's;
         `meta` stays as the text for when free delivery is switched off.
         ChatGPT and Perplexity quote exactly these facts (search report
         23.10.2026); the page itself does not change. */
      brand: {
        "System 4": {
          RU: {
            title: "System 4 (Sim Sensitive): шампуни №1–4 и сыворотка | REMPIRE",
            meta: "System 4 (Sim Sensitive): шампуни №1–4 для жирной, сухой и чувствительной кожи головы, тоник T, маска O и сыворотка Bio Botanical. Самовывоз на Mardi 1.",
            metaFree: "System 4 в наличии в Таллинне: шампуни №1–4 для жирной, сухой и чувствительной кожи головы. Самовывоз на Mardi 1, доставка по Балтии бесплатно от {free}.",
            intro: "System 4 — финская линия Sim Sensitive для кожи головы. Номер на шампуне подсказывает тип кожи головы: №1 — жирная и склонная к перхоти, №2 — сухая с перхотью, №3 — для ежедневного ухода, №4 — очень жирная и чувствительная. К ним — тоник T, маска O и сыворотка Bio Botanical. Подобрать номер поможем в салоне на Mardi 1."
          },
          ET: {
            title: "System 4 (Sim Sensitive): šampoonid ja seerum | REMPIRE",
            meta: "Sim Sensitive'i System 4: šampoonid 1–4 rasusele, kuivale ja tundlikule peanahale, toonik T, mask O ja Bio Botanical seerum. Järeletulek Mardi 1, Tallinn.",
            metaFree: "Sim Sensitive'i System 4 laos Tallinnas: šampoonid 1–4 rasusele, kuivale ja tundlikule peanahale. Järeletulek Mardi 1, tasuta tarne Baltikumis alates {free}.",
            intro: "System 4 on Sim Sensitive'i Soome peanahahoolduse sari. Šampooni number näitab peanaha tüüpi: 1 – rasune ja kõõmale kalduv, 2 – kuiv ja kõõmale kalduv, 3 – igapäevaseks hoolduseks, 4 – väga rasune ja tundlik. Lisaks toonik T, mask O ja Bio Botanical seerum. Õige numbri aitame valida meie salongis aadressil Mardi 1."
          },
          EN: {
            title: "System 4 by Sim Sensitive: Scalp Shampoos & Serum | REMPIRE",
            meta: "System 4 by Sim Sensitive: shampoos 1–4 for oily, dry or sensitive scalps, T tonic, O scalp mask and Bio Botanical serum. Pickup at Mardi 1, Tallinn.",
            metaFree: "System 4 by Sim Sensitive in stock in Tallinn: shampoos 1–4 for oily, dry or sensitive scalps. Pickup at Mardi 1, free Baltic delivery from {free}.",
            intro: "System 4 is Sim Sensitive's Finnish scalp-care range. The number on each shampoo tells you which scalp it suits: 1 for oily, dandruff-prone, 2 for dry, dandruff-prone, 3 for everyday care and 4 for very oily, sensitive scalps. Alongside them: T tonic, O scalp mask and Bio Botanical serum. We'll help you pick yours at Mardi 1."
          }
        },
        "Kevin.Murphy": {
          RU: {
            title: "Kevin.Murphy — шампуни, маски и стайлинг | REMPIRE",
            meta: "Kevin.Murphy в Таллинне: шампуни и маски Angel, Hydrate-Me, Repair-Me, Young.Again и стайлинг Night.Rider, Session.Spray. Самовывоз на Mardi 1.",
            metaFree: "Kevin.Murphy в наличии в Таллинне: шампуни и маски Angel и Hydrate-Me, стайлинг Night.Rider. Самовывоз на Mardi 1, доставка по Балтии бесплатно от {free}.",
            intro: "Kevin.Murphy — австралийская марка салонного ухода за волосами. У нас шампуни и маски Angel, Hydrate-Me, Repair-Me и Young.Again, стайлинг Night.Rider, Rough.Rider, Session.Spray и Anti.Gravity. Что подойдёт вашим волосам, подскажем в салоне на Mardi 1."
          },
          ET: {
            title: "Kevin.Murphy juuksehooldus ja viimistlus | REMPIRE",
            meta: "Kevin.Murphy Tallinnas: Angel, Hydrate-Me, Repair-Me ja Young.Again šampoonid ja maskid ning Night.Rider ja Session.Spray viimistlus. Järeletulek Mardi 1.",
            metaFree: "Kevin.Murphy laos Tallinnas: Angel ja Hydrate-Me šampoonid ja maskid, Night.Rider viimistlus. Järeletulek Mardi 1, tasuta tarne Baltikumis alates {free}.",
            intro: "Kevin.Murphy on Austraalia salongi juuksehoolduse bränd. Meil on Angel, Hydrate-Me, Repair-Me ja Young.Again šampoonid ja maskid ning viimistlustooted Night.Rider, Rough.Rider, Session.Spray ja Anti.Gravity. Aitame valida, mis sinu juustele sobib — meie salongis aadressil Mardi 1."
          },
          EN: {
            title: "Kevin.Murphy: Shampoos, Masks & Styling | REMPIRE",
            meta: "Kevin Murphy products in Tallinn: Angel, Hydrate-Me, Repair-Me and Young.Again care, Night.Rider and Session.Spray styling. Pickup at Mardi 1.",
            metaFree: "Kevin.Murphy in stock in Tallinn: Angel and Hydrate-Me shampoos and masks, Night.Rider styling. Pickup at Mardi 1, free Baltic delivery from {free}.",
            intro: "Kevin.Murphy is an Australian salon hair-care brand. We carry Angel, Hydrate-Me, Repair-Me and Young.Again shampoos and masks, plus Night.Rider, Rough.Rider, Session.Spray and Anti.Gravity styling. We'll help you choose what suits your hair at the salon on Mardi 1."
          }
        },
        "Davines": {
          RU: {
            title: "Davines — шампуни, маски и масло для бороды | REMPIRE",
            meta: "Davines из Пармы: шампуни Naturaltech, маски The Circle Chronicles, масло для бороды и гели для бритья Pasta & Love. Самовывоз на Mardi 1.",
            intro: "Davines — итальянская марка из Пармы. У нас шампуни Naturaltech для разных задач волос и кожи головы, маски The Circle Chronicles и мужская линия Pasta & Love: масло для бороды, которое подходит и перед бритьём, гели для бритья, паста и глина для укладки."
          },
          ET: {
            title: "Davines: šampoonid, juuksemaskid ja habemeõli | REMPIRE",
            meta: "Davines Itaaliast: Naturaltechi šampoonid, The Circle Chronicles maskid, Pasta & Love habemeõli ja raseerimisgeelid. Järeletulek Mardi 1, Tallinn.",
            intro: "Davines on Itaalia bränd Parmast. Meil on Naturaltechi šampoonid juuste ja peanaha eri vajadusteks, The Circle Chronicles juuksemaskid ning meeste sari Pasta & Love: habemeõli, mis sobib ka enne raseerimist, raseerimisgeelid, viimistluspasta ja -savi."
          },
          EN: {
            title: "Davines: Shampoos, Hair Masks & Beard Oil | REMPIRE",
            meta: "Davines from Parma: Naturaltech shampoos, The Circle Chronicles masks, Pasta & Love beard oil and shaving gels. Pickup at Mardi 1, Tallinn.",
            intro: "Davines is an Italian brand from Parma. We carry Naturaltech shampoos for different hair and scalp needs, The Circle Chronicles hair masks and the Pasta & Love men's line: a beard oil that doubles as a pre-shave oil, shaving gels, styling paste and clay."
          }
        },
        "Captain Fawcett": {
          RU: {
            title: "Captain Fawcett: масло для бороды, бальзам и воск | REMPIRE",
            meta: "Британский Captain Fawcett: масла и бальзамы для бороды, воск для усов серий Nebula (John Petrucci), Booze & Baccy, Barberism. Самовывоз на Mardi 1.",
            metaFree: "Captain Fawcett в наличии в Таллинне: масла и бальзамы для бороды, воск для усов. Самовывоз на Mardi 1, доставка по Балтии бесплатно от {free}.",
            intro: "Captain Fawcett — британская марка ухода за бородой и усами. У нас масла и бальзамы для бороды и воск для усов серий Nebula, Booze & Baccy и Barberism — у каждой серии свой аромат. Аромат и фиксацию поможем подобрать в салоне на Mardi 1."
          },
          ET: {
            title: "Captain Fawcett: habemeõli, -palsam ja vuntsivaha | REMPIRE",
            meta: "Briti Captain Fawcett: habemeõlid, habemepalsamid ja vuntsivaha sarjadest Nebula (John Petrucci), Booze & Baccy ja Barberism. Järeletulek Mardi 1, Tallinn.",
            metaFree: "Captain Fawcett laos Tallinnas: habemeõlid, habemepalsamid ja vuntsivaha (Nebula, Barberism). Järeletulek Mardi 1, tasuta tarne Baltikumis alates {free}.",
            intro: "Captain Fawcett on Briti habeme- ja vuntsihoolduse bränd. Meil on habemeõlid, habemepalsamid ja vuntsivaha sarjadest Nebula, Booze & Baccy ja Barberism – igal sarjal oma lõhn. Lõhna ja hoidvuse aitame valida meie salongis aadressil Mardi 1."
          },
          EN: {
            title: "Captain Fawcett: Beard Oil, Balm & Moustache Wax | REMPIRE",
            meta: "Captain Fawcett, UK: beard oils, beard balms and moustache wax from the Nebula (John Petrucci), Booze & Baccy and Barberism series. Pickup at Mardi 1.",
            metaFree: "Captain Fawcett in stock in Tallinn: beard oils, beard balms and moustache wax from Nebula and Barberism. Pickup at Mardi 1, free Baltic delivery from {free}.",
            intro: "Captain Fawcett is a British beard and moustache care brand. We carry beard oils, beard balms and moustache wax from the Nebula, Booze & Baccy and Barberism series, each with its own scent. We'll help you pick the scent and the hold at Mardi 1."
          }
        },
        "Proraso": {
          RU: {
            title: "Proraso — масло для бороды и средства после бритья | REMPIRE",
            meta: "Proraso из Флоренции: масла для бороды Azur Lime, Cypress & Vetyver, Wood & Spice, бальзамы и лосьоны после бритья. Самовывоз на Mardi 1, Таллинн.",
            intro: "Proraso — итальянская марка из Флоренции, классика барбершопов. У нас бальзамы и лосьоны после бритья (зелёная линия — с эвкалиптом и ментолом), масла для бороды Azur Lime, Cypress & Vetyver и Wood & Spice и бальзам Wood & Spice для первых недель роста бороды."
          },
          ET: {
            title: "Proraso: habemeõli ja raseerimisjärgne hooldus | REMPIRE",
            meta: "Itaalia Proraso: habemeõlid Azur Lime, Cypress & Vetyver ja Wood & Spice, raseerimisjärgsed palsamid ja losjoonid. Järeletulek Mardi 1, Tallinn.",
            intro: "Proraso on Itaalia bränd Firenzest, barbershopide klassika. Meil on raseerimisjärgsed palsamid ja losjoonid (roheline sari eukalüpti ja mentooliga), habemeõlid Azur Lime, Cypress & Vetyver ja Wood & Spice ning Wood & Spice habemepalsam habeme esimesteks kasvunädalateks."
          },
          EN: {
            title: "Proraso: Beard Oil, Aftershave Balm & Lotion | REMPIRE",
            meta: "Proraso from Florence: Azur Lime, Cypress & Vetyver and Wood & Spice beard oils, aftershave balms and lotions. Pickup at Mardi 1, Tallinn.",
            intro: "Proraso is an Italian barbershop classic from Florence. We carry its aftershave balms and lotions (the green line with eucalyptus and menthol), Azur Lime, Cypress & Vetyver and Wood & Spice beard oils, and the Wood & Spice balm for the first weeks of beard growth."
          }
        },
        "Creed": {
          RU: {
            title: "Creed: Aventus, Aventus Cologne и Original Vetiver | REMPIRE",
            meta: "Creed Aventus (бергамот, ананас, берёза), Aventus Cologne с имбирём и Original Vetiver в Таллинне. Самовывоз на Mardi 1, доставка по ЕС.",
            intro: "Creed — нишевый парфюмерный дом. У нас Creed Aventus с бергамотом, ананасом и дымной берёзой, более свежий Aventus Cologne с имбирём и Original Vetiver с лимоном, зелёными нотами и ветивером. Выбрать между ними поможем на Mardi 1."
          },
          ET: {
            title: "Creed: Aventus, Aventus Cologne, Original Vetiver | REMPIRE",
            meta: "Creed Aventus (bergamott, ananass, kask), ingveriga Aventus Cologne ja Original Vetiver Tallinnas. Järeletulek Mardi 1, tarne üle ELi.",
            intro: "Creed on nišiparfüümide maja. Meil on Creed Aventus bergamoti, ananassi ja suitsuse kasepuuga, värskem Aventus Cologne ingveriga ning Original Vetiver sidruni, roheliste nootide ja vetiveriga. Mardi 1 poes aitame neist valida."
          },
          EN: {
            title: "Creed: Aventus, Aventus Cologne & Original Vetiver | REMPIRE",
            meta: "Creed Aventus (bergamot, pineapple, birch), the ginger-led Aventus Cologne and Original Vetiver in Tallinn. Pickup at Mardi 1, EU-wide delivery.",
            intro: "Creed is a niche fragrance house. We carry Creed Aventus with bergamot, pineapple and smoky birch, the brighter Aventus Cologne with ginger, and Original Vetiver with lemon, green notes and vetiver. We'll help you choose at Mardi 1."
          }
        },
        "Xerjoff": {
          RU: {
            title: "Xerjoff (Ксерджофф): 1861 Naxos и Monkey Special | REMPIRE",
            meta: "Xerjoff Naxos (Ксерджофф Наксос) из коллекции 1861: лаванда, мёд, табак, ваниль, а также Tony Iommi Monkey Special с ромом и кожей. Самовывоз на Mardi 1.",
            intro: "Xerjoff (Ксерджофф) — парфюмерный дом из Турина. Xerjoff Naxos из коллекции 1861 — лаванда, бергамот, мёд, табачный лист и ваниль; Tony Iommi Monkey Special — ром, кожа, корица и карамель. Оба аромата тёплые и сладковатые, выбрать поможем на Mardi 1."
          },
          ET: {
            title: "Xerjoff: 1861 Naxos ja Tony Iommi Monkey Special | REMPIRE",
            meta: "Xerjoff Naxos kollektsioonist 1861 (lavendel, mesi, tubakas, vanill) ja Tony Iommi Monkey Special. Järeletulek Mardi 1, tarne üle ELi.",
            intro: "Xerjoff on Torino parfümeeriamaja. Kollektsiooni 1861 Xerjoff Naxos: lavendel, bergamott, mesi, tubakaleht ja vanill; Tony Iommi Monkey Special: rumm, nahk, kaneel ja karamell. Mõlemad on soojad, magusapoolsed lõhnad – valida aitame Mardi 1 poes."
          },
          EN: {
            title: "Xerjoff: 1861 Naxos & Tony Iommi Monkey Special | REMPIRE",
            meta: "Xerjoff Naxos from the 1861 collection (lavender, honey, tobacco, vanilla) and Tony Iommi Monkey Special in Tallinn. Pickup at Mardi 1, EU delivery.",
            intro: "Xerjoff is a perfume house from Turin. Xerjoff Naxos from the 1861 collection: lavender, bergamot, honey, tobacco leaf and vanilla; Tony Iommi Monkey Special: rum, leather, cinnamon and caramel. Both are warm, sweet-leaning scents; we'll help you choose at Mardi 1."
          }
        },
        "Byredo": {
          RU: {
            title: "Byredo — Blanche, Mojave Ghost и гель для душа | REMPIRE",
            meta: "Byredo Blanche — альдегиды, роза и мускус, аромат чистого белья; гель для душа Blanche и Mojave Ghost. Самовывоз на Mardi 1, доставка по ЕС.",
            intro: "Byredo — парфюмерный дом из Стокгольма. Byredo Blanche — аромат чистого белья: альдегиды, роза, пион, мускус и сандал; к нему есть гель для душа Blanche. Mojave Ghost — амбретта, магнолия, сандал и кедр."
          },
          ET: {
            title: "Byredo: Blanche, Mojave Ghost ja dušigeel | REMPIRE",
            meta: "Byredo Blanche (aldehüüdid, roos, muskus – puhta pesu lõhn), Blanche'i dušigeel ja Mojave Ghost. Järeletulek Mardi 1, tarne üle ELi.",
            intro: "Byredo on Stockholmi parfümeeriamaja. Byredo Blanche lõhnab nagu puhas pesu: aldehüüdid, roos, pojeng, muskus ja sandlipuu; sellele lisaks Blanche'i dušigeel. Mojave Ghost: ambretiseeme, magnoolia, sandlipuu ja seeder."
          },
          EN: {
            title: "Byredo: Blanche, Mojave Ghost & Blanche Body Wash | REMPIRE",
            meta: "Byredo Blanche (aldehydes, rose, musk: the scent of clean linen), Blanche body wash and Mojave Ghost. Pickup at Mardi 1, EU-wide delivery.",
            intro: "Byredo is a perfume house from Stockholm. Byredo Blanche smells of clean linen: aldehydes, rose, peony, musk and sandalwood, with a matching Blanche body wash. Mojave Ghost: ambrette, magnolia, sandalwood and cedarwood."
          }
        }
      },
      /* A subcollection — a section's chip with a page of its own (SUB_HANDLES
         in src/lib/shop-paths.mjs, /et/collections/habemeolid): its title and
         meta, its name (the page's <h1> and its name in the structured data),
         and the line under the heading (seoSub()). The section stays one step
         back, in the crumb. `h1`, where there is one, is a shorter heading than
         the full name — the display face is large and set in capitals (Dim,
         09.10.2026: the subcollection's own heading, not the section's). */
      sub: {
        "beard/oi": {
          RU: {
            title: "Масло для бороды: Proraso, Captain Fawcett, Davines",
            meta: "Масло для бороды Proraso, Captain Fawcett и Davines: пара капель в день делает бороду мягкой и ухаживает за кожей под ней. Самовывоз в Таллинне.",
            name: "Масло для бороды",
            intro: "Масло для бороды — ежедневный шаг ухода: пара капель после мытья смягчает волоски, помогает уложить бороду и ухаживает за кожей под ней. Этими маслами работают наши барберы — Proraso и Captain Fawcett в разных ароматах и масло Davines, которое подходит и перед бритьём."
          },
          ET: {
            title: "Habemeõlid: Proraso, Captain Fawcett, Davines | REMPIRE",
            meta: "Proraso, Captain Fawcetti ja Davinesi habemeõlid: paar tilka päevas teeb habeme pehmeks ja hooldab ka nahka selle all. Järeletulek Tallinnas.",
            name: "Habemeõlid",
            intro: "Habemeõli on habemehoolduse igapäevane samm: paar tilka pärast pesu teeb habeme pehmeks ja kergesti kammitavaks ning hooldab ka nahka selle all. Neid õlisid kasutavad meie barberid — Proraso ja Captain Fawcett mitmes lõhnas ning Davinesi õli, mis sobib ka enne raseerimist."
          },
          EN: {
            title: "Beard Oil: Proraso, Captain Fawcett, Davines | REMPIRE",
            meta: "Beard oils by Proraso, Captain Fawcett and Davines: a few drops a day keep the beard soft and care for the skin beneath it. Pickup in Tallinn, EU delivery.",
            name: "Beard oil",
            intro: "Beard oil is the everyday step of beard care: a few drops after washing soften the beard, make it easier to shape and care for the skin beneath it. These are the oils our barbers use — Proraso and Captain Fawcett in several scents, and a Davines oil that also works as a pre-shave."
          }
        },
        "beard/ba": {
          RU: {
            title: "Бальзамы для бороды и после бритья: Proraso, Captain Fawcett",
            meta: "Бальзамы для бороды Captain Fawcett и Proraso смягчают и укладывают бороду, бальзамы Proraso после бритья успокаивают кожу. Самовывоз в Таллинне.",
            name: "Бальзамы для бороды и после бритья",
            intro: "Бальзам для бороды ухаживает как масло, но ещё и слегка фиксирует, так что длинная борода весь день держит форму. Здесь же бальзамы Proraso после бритья — от мягкого White для чувствительной кожи до освежающего Green с ментолом."
          },
          ET: {
            title: "Habemepalsamid ja raseerimisjärgsed palsamid | REMPIRE",
            meta: "Captain Fawcetti ja Proraso habemepalsamid pehmendavad ja vormivad habet, Proraso raseerimisjärgsed palsamid rahustavad nahka. Järeletulek Tallinnas.",
            name: "Habemepalsamid ja raseerimisjärgsed palsamid",
            intro: "Habemepalsam hooldab nagu õli, kuid annab ka kerge fikseerimise, nii et pikem habe püsib terve päeva vormis. Siin on ka Proraso raseerimisjärgsed palsamid, nii tundlikule nahale mõeldud kui ka jahutava mentooliga."
          },
          EN: {
            title: "Beard & Aftershave Balms: Proraso, Captain Fawcett",
            meta: "Captain Fawcett and Proraso beard balms soften and shape the beard; Proraso aftershave balms calm the skin after a shave. Pickup in Tallinn.",
            name: "Beard and aftershave balms",
            intro: "A beard balm cares for the beard like an oil and adds a light hold, so a longer beard keeps its shape all day. Proraso's aftershave balms are here too — from the gentle White for sensitive skin to the cooling, menthol Green."
          }
        },
        "beard/af": {
          RU: {
            title: "Средства после бритья: бальзамы и лосьоны Proraso | REMPIRE",
            meta: "Бальзамы и лосьоны после бритья Proraso: мягкий White для чувствительной кожи, освежающий Green с ментолом, Azur Lime, Blue и Red. Самовывоз в Таллинне.",
            name: "Средства после бритья",
            intro: "После бритья коже нужен уход: бальзам смягчает и успокаивает, лосьон освежает. Здесь бальзамы и лосьоны Proraso, которыми работают наши барберы, — от мягкого White для чувствительной кожи до освежающего Green с ментолом."
          },
          ET: {
            title: "Raseerimisjärgne hooldus: Proraso palsamid ja losjoonid",
            meta: "Proraso raseerimisjärgsed palsamid ja losjoonid: õrn White tundlikule nahale, värskendav mentooliga Green, Azur Lime, Blue ja Red. Järeletulek Tallinnas.",
            name: "Raseerimisjärgne hooldus",
            intro: "Pärast raseerimist vajab nahk hoolt: palsam pehmendab ja rahustab, losjoon värskendab. Siin on Proraso palsamid ja losjoonid, mida kasutavad meie barberid — nii tundlikule nahale mõeldud kui ka jahutava mentooliga."
          },
          EN: {
            title: "Aftershave Balms & Lotions: Proraso | REMPIRE",
            meta: "Proraso aftershave balms and lotions: gentle White for sensitive skin, refreshing menthol Green, Azur Lime, Blue and Red. Pickup in Tallinn, EU delivery.",
            name: "Aftershave",
            intro: "After a shave the skin needs care: a balm softens and calms, a lotion refreshes. These are the Proraso balms and lotions our barbers use — from the gentle White for sensitive skin to the cooling, menthol Green."
          }
        },
        "hair/sh": {
          RU: {
            title: "Шампуни: Kevin.Murphy, Davines, System 4, Paul Mitchell",
            meta: "Kevin.Murphy, Davines, System 4 и Paul Mitchell: салонные шампуни для сухих, жирных, окрашенных, кудрявых и тонких волос. Самовывоз в Таллинне.",
            name: "Шампуни для волос",
            intro: "Шампунь подбирают и под кожу головы, и под волосы: жирные корни, сухость, окрашенные или кудрявые волосы требуют разного шампуня. Здесь салонные шампуни, которые выбрала наша команда, — Kevin.Murphy, Davines, System 4 и Paul Mitchell."
          },
          ET: {
            title: "Šampoonid: Kevin.Murphy, Davines, System 4, Paul Mitchell",
            meta: "Kevin.Murphy, Davines, System 4 ja Paul Mitchell: salongišampoonid kuivadele, rasustele, värvitud, lokkis või õhukestele juustele. Järeletulek Tallinnas.",
            name: "Šampoonid",
            intro: "Šampoon valitakse nii peanaha kui ka juuste järgi: rasused juuksejuured, kuivus, värvitud juuksed ja lokid vajavad igaüks erinevat šampooni. Siin on salongišampoonid, mille on valinud meie meeskond — Kevin.Murphy, Davines, System 4 ja Paul Mitchell."
          },
          EN: {
            title: "Shampoo: Kevin.Murphy, Davines, System 4, Paul Mitchell",
            meta: "Kevin.Murphy, Davines, System 4 and Paul Mitchell: salon shampoos for dry, oily, coloured, curly or fine hair. Pickup in Tallinn, EU delivery.",
            name: "Shampoo",
            intro: "A shampoo is chosen for the scalp as much as for the hair: oily roots, dryness, colour and curls each want a different one. These are the salon shampoos our team has picked — Kevin.Murphy, Davines, System 4 and Paul Mitchell."
          }
        },
        "hair/co": {
          RU: {
            title: "Кондиционеры: Kevin.Murphy, Paul Mitchell, System 4",
            meta: "Kevin.Murphy, Paul Mitchell, System 4, Lumin и CBD Daily: кондиционеры для сухих, окрашенных, кудрявых и тонких волос. Самовывоз в Таллинне.",
            name: "Кондиционеры для волос",
            intro: "Кондиционер — второй шаг после шампуня: он разглаживает волосы, облегчает расчёсывание и помогает цвету держаться дольше. У большинства наших шампуней есть кондиционер из той же линии — Kevin.Murphy, Paul Mitchell, System 4 и другие."
          },
          ET: {
            title: "Juuksepalsamid: Kevin.Murphy, Paul Mitchell, System 4",
            meta: "Kevin.Murphy, Paul Mitchell, System 4, Lumin ja CBD Daily: juuksepalsamid kuivadele, värvitud, lokkis ja õhukestele juustele. Järeletulek Tallinnas.",
            name: "Juuksepalsamid",
            intro: "Juuksepalsam on šampooni järel teine samm: see silub juukseid, teeb need kergesti kammitavaks ja aitab värvil kauem püsida. Enamikule meie šampoonidest leiab samast sarjast sobiva palsami — Kevin.Murphy, Paul Mitchell, System 4 ja teised."
          },
          EN: {
            title: "Conditioner: Kevin.Murphy, Paul Mitchell, System 4",
            meta: "Kevin.Murphy, Paul Mitchell, System 4, Lumin and CBD Daily conditioners for dry, coloured, curly or fine hair — the step after shampoo. Pickup in Tallinn.",
            name: "Conditioner",
            intro: "Conditioner is the second step after shampoo: it smooths the hair, makes it easier to comb and helps colour last longer. Most of our shampoos have a matching conditioner from the same line — Kevin.Murphy, Paul Mitchell, System 4 and more."
          }
        },
        "styling/pw": {
          RU: {
            title: "Воск для волос, паста и глина: Gatsby, Davines | REMPIRE",
            meta: "Пасты и глина Kevin.Murphy, воск Gatsby Moving Rubber, Davines Pasta&Love и MITCH от Paul Mitchell — фиксация и текстура. Самовывоз в Таллинне.",
            name: "Воск, паста и глина для волос",
            intro: "Воск даёт блеск и фиксацию, которую можно поправить в течение дня, паста — более мягкий и естественный результат, глина — сильную матовую фиксацию с текстурой. Пасты и глина Kevin.Murphy, японские воски Gatsby, Davines Pasta&Love и MITCH от Paul Mitchell закрывают все три варианта."
          },
          ET: {
            title: "Juuksevaha, pasta ja savi: Gatsby, Davines | REMPIRE",
            meta: "Kevin.Murphy pastad ja savi, Gatsby Moving Rubber vahad, Davinesi Pasta&Love ja Paul Mitchelli MITCH — fikseerimine ja tekstuur. Järeletulek Tallinnas.",
            name: "Juuksevaha, pasta ja savi",
            intro: "Juuksevaha annab läike ja fikseerimise, mida saab päeva jooksul ümber sättida, pasta pehmema ja loomulikuma tulemuse, savi tugeva ja mati fikseerimise koos tekstuuriga. Kevin.Murphy pastad ja savi, Jaapani Gatsby vahad, Davinesi Pasta&Love ja Paul Mitchelli MITCH katavad kõik kolm."
          },
          EN: {
            title: "Hair Wax, Paste & Clay: Gatsby, Davines, Paul Mitchell",
            meta: "Kevin.Murphy pastes and clay, Gatsby Moving Rubber waxes, Davines Pasta&Love and Paul Mitchell MITCH — hold and texture. Pickup in Tallinn.",
            name: "Hair wax, paste & clay",
            intro: "Wax gives shine and a hold you can rework through the day, paste a softer, more natural finish, and clay a strong matte hold with texture. Kevin.Murphy's pastes and clay, Gatsby's Japanese waxes, Davines Pasta&Love and Paul Mitchell's MITCH cover all three."
          }
        },
        "styling/cr": {
          RU: {
            title: "Кремы и лосьоны для укладки волос | REMPIRE",
            meta: "Кремы, лосьоны, мусс и сыворотка для укладки Kevin.Murphy и Paul Mitchell: объём, плотность, пляжная текстура, гладкость без пушения. Самовывоз в Таллинне.",
            name: "Кремы и лосьоны для укладки",
            intro: "Крем, лосьон или мусс наносят до сушки: они дают объём, плотность, текстуру или гладкость без пушения. Здесь средства для укладки Kevin.Murphy и Paul Mitchell, которые выбрала наша команда."
          },
          ET: {
            title: "Juuksekreemid ja losjoonid soengule | REMPIRE",
            meta: "Kevin.Murphy ja Paul Mitchelli kreemid, losjoonid, vaht ja seerum soengule: kohevus, tihedus, rannatekstuur, sile juus ilma kahuta. Järeletulek Tallinnas.",
            name: "Juuksekreemid ja losjoonid",
            intro: "Kreem, losjoon või vaht kantakse juustele enne föönitamist: need annavad kohevust, tihedust, tekstuuri või siledust ilma kahuta. Siin on Kevin.Murphy ja Paul Mitchelli soenguvahendid, mille valis meie meeskond."
          },
          EN: {
            title: "Hair Creams & Lotions for Styling | REMPIRE",
            meta: "Kevin.Murphy and Paul Mitchell styling creams, lotions, mousse and serum: volume, thickness, beach texture and frizz-free smoothness. Pickup in Tallinn.",
            name: "Hair creams & lotions",
            intro: "A cream, lotion or mousse goes on before blow-drying: it gives volume, thickness, texture or frizz-free smoothness. These are the Kevin.Murphy and Paul Mitchell stylers our team picked."
          }
        },
        "beard/mw": {
          RU: {
            title: "Воск для усов Captain Fawcett | REMPIRE",
            meta: "Воск для усов Captain Fawcett: Nebula Джона Петруччи, Ricki Hall Booze & Baccy и Barberism — чтобы усы держали форму. Самовывоз в Таллинне.",
            name: "Воск для усов",
            intro: "Воск держит форму усов весь день и укрощает непослушные волоски. Здесь воски для усов Captain Fawcett: Nebula Джона Петруччи, Ricki Hall Booze & Baccy и Barberism."
          },
          ET: {
            title: "Vuntsivahad: Captain Fawcett | REMPIRE",
            meta: "Captain Fawcetti vuntsivahad: John Petrucci Nebula, Ricki Hall Booze & Baccy ja Barberism — et vuntsid püsiksid vormis. Järeletulek Tallinnas.",
            name: "Vuntsivahad",
            intro: "Vaha hoiab vuntse terve päeva vormis ja taltsutab sõnakuulmatuid karvu. Siin on Captain Fawcetti vuntsivahad: John Petrucci Nebula, Ricki Hall Booze & Baccy ja Barberism."
          },
          EN: {
            title: "Moustache Wax: Captain Fawcett | REMPIRE",
            meta: "Captain Fawcett moustache wax: John Petrucci's Nebula, Ricki Hall Booze & Baccy and Barberism — to keep a moustache in shape. Pickup in Tallinn.",
            name: "Moustache wax",
            intro: "A wax keeps a moustache in shape all day and tames stray hairs. These are Captain Fawcett's moustache waxes: John Petrucci's Nebula, Ricki Hall Booze & Baccy and Barberism."
          }
        },
        "face/ma": {
          RU: {
            title: "Маски для лица: тканевые и ночные | REMPIRE",
            meta: "Тканевые маски Gummy с мадекассосидом и Nature Republic с зелёным чаем, ночная маска LANEIGE Cica. Самовывоз в Таллинне.",
            name: "Маски для лица",
            intro: "Маска — быстрый уход за кожей: тканевая работает за один вечер, ночная — пока вы спите. Здесь тканевые маски Gummy и Nature Republic и ночная маска LANEIGE Cica."
          },
          ET: {
            title: "Näomaskid: kangas- ja öömaskid | REMPIRE",
            meta: "Gummy madekassosiidiga ja Nature Republicu rohelise teega kangasmaskid, LANEIGE Cica öömask. Järeletulek Tallinnas.",
            name: "Näomaskid",
            intro: "Mask on kiire hoolitsus nahale: kangasmask mõjub ühe õhtuga, öömask töötab sel ajal, kui magate. Siin on Gummy ja Nature Republicu kangasmaskid ning LANEIGE Cica öömask."
          },
          EN: {
            title: "Face Masks: Sheet & Sleeping Masks | REMPIRE",
            meta: "Gummy madecassoside and Nature Republic green tea sheet masks, LANEIGE Cica sleeping mask. Pickup in Tallinn, EU delivery.",
            name: "Face masks",
            intro: "A mask is quick care for the skin: a sheet mask works in an evening, a sleeping mask while you sleep. These are the Gummy and Nature Republic sheet masks and the LANEIGE Cica sleeping mask."
          }
        },
        "face/ey": {
          RU: {
            title: "Уход за кожей вокруг глаз: патчи и крем | REMPIRE",
            meta: "Гидрогелевые патчи COSRX Advanced Snail с муцином улитки и крем для век Lumin Dark Circle Defense Balm. Самовывоз в Таллинне.",
            name: "Уход за кожей вокруг глаз",
            intro: "Кожа вокруг глаз тоньше и суше, поэтому ей нужен свой уход. Здесь гидрогелевые патчи COSRX Advanced Snail и крем для век Lumin Dark Circle Defense Balm."
          },
          ET: {
            title: "Silmaümbruse hooldus: padjad ja kreem | REMPIRE",
            meta: "COSRX Advanced Snail hüdrogeelsed silmapadjad tigulimaga ja Lumin Dark Circle Defense Balm silmaümbruse kreem. Järeletulek Tallinnas.",
            name: "Silmaümbruse hooldus",
            intro: "Silmaümbruse nahk on õhem ja kuivem, seepärast vajab see omaette hoolt. Siin on COSRX Advanced Snail hüdrogeelsed silmapadjad ja Lumini silmaümbruse kreem Dark Circle Defense Balm."
          },
          EN: {
            title: "Eye Care: Eye Patches & Eye Balm | REMPIRE",
            meta: "COSRX Advanced Snail hydrogel eye patches with snail mucin and the Lumin Dark Circle Defense Balm for the eye area. Pickup in Tallinn.",
            name: "Eye care",
            intro: "The skin around the eyes is thinner and drier, so it needs care of its own. These are the COSRX Advanced Snail hydrogel eye patches and Lumin's Dark Circle Defense Balm."
          }
        }
      },
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
      /* A product's meta description, written by hand (Dim, 09.10.2026) for
         the products people actually search for: the whole System 4 range,
         three Kevin.Murphy pastes, the grey Gatsby Grunge Mat, Proraso's Azur
         Lime balm and both Creed Aventus. Each one says what the product is,
         who it is for and one fact from its own text (the sizes, a key
         ingredient, the notes) — cosmetic effects only, never a treatment.
         Each is complete at 155 characters or less, so no delivery line is
         added after it. The owner's own pair for the product still wins
         (seoFor() in app.js, `seoDesc` in productSpec()); every other product
         is described by seoLead() from its text. seoProductMeta(). */
      productMeta: {
        "system-4-special-shampoo-1": {
          RU: "Шампунь System 4 номер 1 (Special Shampoo 1) для жирной кожи головы, склонной к перхоти. С салициловой кислотой и климбазолом, без отдушек. 75–500 мл.",
          ET: "System 4 šampoon nr 1 (Special Shampoo 1) rasusele, kõõmale kalduvale peanahale. Salitsüülhappe ja klimbasooliga, lõhnaainevaba. 75–500 ml.",
          EN: "System 4 Special Shampoo 1 (No. 1) for an oily, dandruff-prone scalp. With salicylic acid and climbazole, fragrance-free. 75, 250 or 500 ml."
        },
        "system-4-balancing-shampoo-2": {
          RU: "Шампунь System 4 номер 2 (Balancing Shampoo 2) для сухой кожи головы, склонной к перхоти, и окрашенных волос. Бережёт цвет, без отдушек. 75–500 мл.",
          ET: "System 4 šampoon nr 2 (Balancing Shampoo 2) kuivale, kõõmale kalduvale peanahale ja värvitud juustele. Kaitseb värvi, lõhnaainevaba. 75–500 ml.",
          EN: "System 4 Balancing Shampoo 2 (No. 2) for a dry, dandruff-prone scalp and colour-treated hair. Helps protect colour, fragrance-free. 75–500 ml."
        },
        "system-4-mild-shampoo-3": {
          RU: "Шампунь System 4 номер 3 (Mild Shampoo 3) — мягкий шампунь на каждый день: бережно очищает и предотвращает появление перхоти. Без отдушек, 75–500 мл.",
          ET: "System 4 šampoon nr 3 (Mild Shampoo 3) – mahe šampoon igapäevaseks pesuks: puhastab õrnalt ja ennetab kõõma. Lõhnaainevaba, 75–500 ml.",
          EN: "System 4 Mild Shampoo 3 (No. 3), a gentle everyday shampoo: cleans softly and helps keep dandruff away. Fragrance-free, 75, 250 or 500 ml."
        },
        "system-4-shale-oil-shampoo-4": {
          RU: "Шампунь System 4 номер 4 (Shale Oil Shampoo 4) для очень жирных волос и чувствительной кожи головы. Сланцевое масло и ментол, без отдушек. 75–500 мл.",
          ET: "System 4 šampoon nr 4 (Shale Oil Shampoo 4) väga rasustele juustele ja tundlikule peanahale. Põlevkiviõli ja mentooliga, lõhnaainevaba. 75–500 ml.",
          EN: "System 4 Shale Oil Shampoo 4 (No. 4) for very oily hair and a sensitive scalp. With shale oil and menthol, fragrance-free. 75, 250 or 500 ml."
        },
        "system-4-bio-botanical-shampoo": {
          RU: "Шампунь System 4 Bio Botanical для тонких и ослабленных волос: растительные экстракты, ментол и салициловая кислота для кожи головы. 75–500 мл.",
          ET: "System 4 Bio Botanical šampoon peenikestele ja nõrgenenud juustele: taimeekstraktid, mentool ja salitsüülhape peanahale. 75–500 ml.",
          EN: "System 4 Bio Botanical Shampoo for fine, weakened hair: plant extracts, menthol and salicylic acid for the scalp. 75, 250 or 500 ml."
        },
        "system-4-bio-botanical-serum": {
          RU: "Несмываемая сыворотка System 4 Bio Botanical для кожи головы — уход за тонкими и ослабленными волосами. Ментол и растительные экстракты, 50–500 мл.",
          ET: "System 4 Bio Botanical pähejäetav peanahaseerum peenikestele ja nõrgenenud juustele: mentool ja taimeekstraktid värskendavad peanahka. 50–500 ml.",
          EN: "System 4 Bio Botanical leave-in scalp serum for fine, weakened hair. Menthol and plant extracts refresh the scalp; use daily. 50, 150 or 500 ml."
        },
        "system-4-bio-botanical-vital-cure": {
          RU: "Кондиционер System 4 Bio Botanical для тонких и ослабленных волос: мягко отшелушивает кожу головы, можно оставить как маску. 150 и 500 мл.",
          ET: "System 4 Bio Botanical palsam peenikestele ja nõrgenenud juustele: koorib õrnalt peanahka, sobib ka peanahamaskiks. 150 ja 500 ml.",
          EN: "System 4 Bio Botanical conditioner for fine, weakened hair: gently exfoliates the scalp and can be left on as a scalp mask. 150 or 500 ml."
        },
        "sim-sensitive-system-4-scalp-tonic-t": {
          RU: "Тоник System 4 T для жирной кожи головы: освежает ментолом, не смывается, подходит для ежедневного ухода между мытьём. Без отдушек, 50–500 мл.",
          ET: "System 4 peanahatoonik T rasusele peanahale: värskendab mentooliga, ei vaja loputamist, sobib pesukordade vahele. Lõhnaainevaba, 50–500 ml.",
          EN: "System 4 Scalp Tonic T for an oily scalp: a no-rinse menthol tonic for daily use or between washes. Fragrance-free, 50, 150 or 500 ml."
        },
        "sim-sensitive-system-4-oil-cure-scalp-treatment-o": {
          RU: "Маска System 4 O для кожи головы: мягко отшелушивает, убирает перхоть, кожное сало и остатки средств. Подходит и как кондиционер. 75–500 мл.",
          ET: "System 4 peanahamask O: koorib õrnalt peanahka, eemaldab kõõma, rasu ja hooldusvahendite jäägid, sobib ka palsamiks. 75–500 ml.",
          EN: "System 4 scalp mask O: gently exfoliates, lifting dandruff, oil and product build-up, and doubles as a conditioner. 75, 150 or 500 ml."
        },
        "system-4-hydro-care-conditioner-h": {
          RU: "Кондиционер System 4 H (Hydro Care) для сухих и окрашенных волос: увлажняет, бережёт цвет и придаёт блеск. Без отдушек, 75–500 мл.",
          ET: "System 4 palsam H (Hydro Care) kuivadele ja värvitud juustele: niisutab, kaitseb värvi tuhmumise eest ja annab läiget. 75–500 ml.",
          EN: "System 4 Hydro Care Conditioner H for dry, colour-treated hair: moisturises, helps keep colour from fading and adds shine. 75–500 ml."
        },
        "system-4-moisture-scalp-lotion-m": {
          RU: "Лосьон System 4 M для чувствительной кожи головы, которой не хватает влаги: несмываемый, без отдушек. Подходит также для лица и шеи после бритья.",
          ET: "System 4 losjoon M tundlikule peanahale, mis vajab niiskust: pähejäetav ja lõhnaainevaba. Sobib ka näole ja kaelale pärast raseerimist.",
          EN: "System 4 Moisture Scalp Lotion M for a sensitive scalp that needs moisture: leave-in and fragrance-free. Also suits face and neck after shaving."
        },
        "sim-sensitive-system-4-chitosan-hair-repair-r": {
          RU: "Спрей System 4 R (Chitosan Hair Repair) для сухих и повреждённых волос: хитозан и кератин, защита от УФ, не смывается. 50 и 150 мл.",
          ET: "System 4 hooldussprei R (Chitosan Hair Repair) kuivadele ja kahjustatud juustele: kitosaan ja keratiin, UV-kaitse, ei vaja loputamist. 50 ja 150 ml.",
          EN: "System 4 Chitosan Hair Repair R, a leave-in spray for dry, damaged hair: chitosan and keratin, with UV protection. 50 or 150 ml."
        },
        "free-hold": {
          RU: "Kevin.Murphy Free.Hold — паста для укладки эластичной средней фиксации с естественным блеском, для всех типов волос. Без сульфатов, 30 и 100 г.",
          ET: "Kevin.Murphy Free.Hold – paindliku keskmise hoiuga viimistluspasta loomuliku läikega, kõikidele juuksetüüpidele. Sulfaadivaba, 30 ja 100 g.",
          EN: "Kevin.Murphy Free.Hold: a flexible, medium-hold styling paste with natural shine, for all hair types. Sulphate- and paraben-free, 30 or 100 g."
        },
        "night-rider": {
          RU: "Kevin.Murphy Night.Rider — самая сильная из моделирующих паст бренда: выразительная матовая текстура для коротких и рваных стрижек. 30 и 100 г.",
          ET: "Kevin.Murphy Night.Rider – brändi vormimispastadest kõige tugevam: jõuline matt tekstuur lühikestele ja astmelistele lõikustele. 30 ja 100 g.",
          EN: "Kevin.Murphy Night.Rider, the strongest of the brand's moulding pastes: rough, matte texture for short or choppy cuts. Sulphate-free, 30 or 100 g."
        },
        "rough-rider": {
          RU: "Kevin.Murphy Rough.Rider — глина для укладки сильной фиксации: плотная, слегка зернистая текстура и матовый образ, который держится долго. 30 и 100 г.",
          ET: "Kevin.Murphy Rough.Rider – tugeva hoiuga viimistlussavi: tihke, kergelt sõmer tekstuur ja matt soeng, mis püsib kaua. 30 ja 100 g.",
          EN: "Kevin.Murphy Rough.Rider: a strong-hold styling clay with a dense, slightly gritty texture for a matte, defined look that lasts. 30 or 100 g."
        },
        /* Kevin.Murphy — the twelve most-shown products in Search Console with no line of
           their own yet (16.10.2026, approved by Dim the same day) */
        "kevin-murphy-hydrate-me-masque": {
          RU: "Маска Kevin.Murphy Hydrate-Me.Masque для сухих волос: интенсивно увлажняет, делает волосы мягкими и блестящими. Нанести после шампуня, смыть. 40 и 200 мл.",
          ET: "Kevin.Murphy Hydrate-Me.Masque – niisutav mask kuivadele juustele: teeb juuksed pehmeks ja läikivaks. Kanna peale pärast šampooni, loputa. 40 ja 200 ml.",
          EN: "Kevin.Murphy Hydrate-Me.Masque: an intensive moisture mask for dry, thirsty hair that leaves it soft and shiny. Apply after shampoo, rinse. 40 or 200 ml."
        },
        "heated-defense": {
          RU: "Термозащитная пенка Kevin.Murphy Heated.Defense: невесомая, не смывается, защищает волосы от нагрева до 232 °C. Разглаживает и облегчает расчёсывание.",
          ET: "Kevin.Murphy Heated.Defense – kerge pähejäetav kuumakaitsevaht, mis kaitseb juukseid kuni 232 °C kuumuse eest. Silub ja teeb kammimise lihtsaks.",
          EN: "Kevin.Murphy Heated.Defense: a weightless leave-in foam that protects hair from heat up to 232 °C. Smooths and detangles, for all hair types."
        },
        "touchable": {
          RU: "Kevin.Murphy Touchable — спрей-воск: эффект воска с лёгкостью спрея. Подвижная фиксация, сатиновый блеск, не липнет. 250 мл.",
          ET: "Kevin.Murphy Touchable – vahasprei, mis annab vaha viimistluse sprei kergusega. Painduv fikseerimine, satiinjas läige, ei kleebi. 250 ml.",
          EN: "Kevin.Murphy Touchable: a spray wax with the finish of a wax and the lightness of a spray. Flexible hold, satin sheen, never sticky. 250 ml."
        },
        "repair-me-wash": {
          RU: "Шампунь Kevin.Murphy Repair-Me.Wash для сухих, ломких и повреждённых волос: протеины и аминокислоты помогают их укрепить. Без сульфатов. 40 и 250 мл.",
          ET: "Kevin.Murphy Repair-Me.Wash – tugevdav šampoon kuivadele, rabedatele ja kahjustatud juustele, proteiinide ja aminohapetega. Sulfaadivaba. 40 ja 250 ml.",
          EN: "Kevin.Murphy Repair-Me.Wash: a strengthening shampoo for dry, brittle or damaged hair, with proteins and amino acids. Sulphate-free. 40 or 250 ml."
        },
        "super-goo": {
          RU: "Гель Kevin.Murphy Super.Goo: эластичный моделирующий гель с сильной, но гибкой фиксацией и гладким естественным финишем. Не шелушится. 100 г.",
          ET: "Kevin.Murphy Super.Goo – elastne modelleerimisgeel: tugev, kuid painduv fikseerimine ja sile loomulik viimistlus. Ei jäta helbeid, pestav veega. 100 g.",
          EN: "Kevin.Murphy Super.Goo: a rubbery sculpting gel with firm but flexible hold and a slick, natural finish. No flakes, washes out with water. 100 g."
        },
        "kevin-murphy-un-tangled-spray": {
          RU: "Спрей Kevin.Murphy Un.Tangled — несмываемый кондиционер для лёгкого расчёсывания, с экстрактами австралийских фруктов и термозащитой. 40 и 150 мл.",
          ET: "Kevin.Murphy Un.Tangled – pähejäetav palsamsprei kergemaks kammimiseks, Austraalia puuviljaekstraktide ja kuumakaitsega. 40 ja 150 ml.",
          EN: "Kevin.Murphy Un.Tangled: a leave-in detangling spray with Australian fruit extracts and heat protection. Spray on wet hair and comb. 40 or 150 ml."
        },
        "bedroom-hair": {
          RU: "Kevin.Murphy Bedroom.Hair — лёгкий текстурирующий лак: небрежная текстура и подвижная фиксация на весь день, волосы остаются мягкими. 100 и 250 мл.",
          ET: "Kevin.Murphy Bedroom.Hair – kerge tekstuuri andev juukselakk sassis soenguks: painduv fikseerimine terveks päevaks, juuksed jäävad pehmeks. 100 ja 250 ml.",
          EN: "Kevin.Murphy Bedroom.Hair: a lightweight texturising hairspray for touchable, tousled hair, with a flexible hold that lasts all day. 100 or 250 ml."
        },
        "kevin-murphy-motion-lotion": {
          RU: "Лосьон Kevin.Murphy Motion.Lotion для локонов на тонких и длинных волосах: подчёркивает кудри, убирает пушистость, даёт гибкую фиксацию. 150 мл.",
          ET: "Kevin.Murphy Motion.Lotion – lokke esile toov losjoon peenikestele ja pikkadele juustele: vähendab kahusust, annab painduva fikseerimise ja läike. 150 ml.",
          EN: "Kevin.Murphy Motion.Lotion: a curl-enhancing lotion for fine or long hair that defines curls, tames frizz and adds flexible hold and shine. 150 ml."
        },
        "anti-gravity-spray": {
          RU: "Kevin.Murphy Anti.Gravity.Spray — невесомый лак без аэрозоля для объёма и блеска без жирности, дольше держит укладку. 40 и 150 мл.",
          ET: "Kevin.Murphy Anti.Gravity.Spray – kaalutu aerosoolivaba juukselakk kohevuse ja läike jaoks, hoiab soengut kauem. 40 ja 150 ml.",
          EN: "Kevin.Murphy Anti.Gravity.Spray: a weightless non-aerosol hairspray for volume and oil-free shine that holds your style for longer. 40 or 150 ml."
        },
        "hair-resort-spray": {
          RU: "Kevin.Murphy Hair.Resort.Spray — текстурирующий спрей для пляжных локонов: мёд и цитрусы, лёгкая фиксация, термозащита до 220 °C. 40 и 150 мл.",
          ET: "Kevin.Murphy Hair.Resort.Spray – rannasoengu tekstuurisprei mee ja tsitrusega: kerge fikseerimine, kuumakaitse kuni 220 °C. 40 ja 150 ml.",
          EN: "Kevin.Murphy Hair.Resort.Spray: a beach-texture spray with honey and citrus for tousled, surfer-style hair. Heat protection to 220 °C. 40 or 150 ml."
        },
        "powder-puff": {
          RU: "Пудра Kevin.Murphy Powder.Puff для объёма тонких и плоских волос: мгновенный прикорневой объём, сухая матовая текстура, стойкая фиксация. 14 г.",
          ET: "Kevin.Murphy Powder.Puff – kohevust andev juuksepuuder peenikestele ja lamedatele juustele: kohene kohevus juurtel, kuiv matt tekstuur. 14 g.",
          EN: "Kevin.Murphy Powder.Puff: a volumising powder for fine or flat hair with instant root lift, a dry matte texture and lasting hold. 14 g."
        },
        "kevin-murphy-angel-wash": {
          RU: "Шампунь Kevin.Murphy Angel.Wash для тонких окрашенных волос: мягко очищает, придаёт объём, помогает сохранить цвет. Без сульфатов. 40 и 250 мл.",
          ET: "Kevin.Murphy Angel.Wash – õrn kohevust andev šampoon peenikestele värvitud juustele, aitab värvi säilitada. Sulfaadivaba. 40 ja 250 ml.",
          EN: "Kevin.Murphy Angel.Wash: a gentle volumising shampoo for fine, colour-treated hair that helps keep colour and reduce breakage. Sulphate-free. 40 or 250 ml."
        },
        "gatsby-moving-rubber-grunge-mat-grey-hair-wax": {
          RU: "Воск Gatsby Moving Rubber Grunge Mat (серый): матовая укладка без блеска, сильная фиксация, легко переуложить. Для коротких и средних волос.",
          ET: "Gatsby Moving Rubber Grunge Mat (hall) – matt juuksevaha ilma läiketa: tugev hoid, soengut saab kergesti ümber teha. Lühikestele ja keskmistele juustele.",
          EN: "Gatsby Moving Rubber Grunge Mat (grey) wax: a matte, no-shine finish with strong hold you can restyle any time. For very short to medium hair."
        },
        "proraso-azur-lime-after-shave-balm-100-ml": {
          RU: "Бальзам после бритья Proraso Azur Lime, 100 мл: масло ши и глицерин, лёгкая нежирная текстура, быстро впитывается и успокаивает кожу.",
          ET: "Proraso Azur Lime raseerimisjärgne palsam, 100 ml: sheavõi ja glütseriin, kerge mitterasvane tekstuur, imendub kiiresti ja rahustab nahka.",
          EN: "Proraso Azur Lime after shave balm, 100 ml: shea butter and glycerin in a light, non-greasy balm that absorbs fast and calms the skin."
        },
        "creed-aventus-eau-de-parfum-for-men-50ml": {
          RU: "Creed Aventus, мужская парфюмерная вода 50 мл: ананас, чёрная смородина и бергамот, в сердце берёза, в базе мускус, дубовый мох и ваниль.",
          ET: "Creed Aventus, meeste parfüümvesi 50 ml: ananass, mustsõstar ja bergamott, südames kask, põhjas muskus, tammesammal ja vanill.",
          EN: "Creed Aventus eau de parfum for men, 50 ml: pineapple, blackcurrant and bergamot over birch, with a base of musk, oakmoss and vanilla."
        },
        "creed-creed-aventus-cologne-50ml": {
          RU: "Creed Aventus Cologne, унисекс-аромат 50 мл: мандарин, имбирь и розовый перец, пачули и сандал, в базе берёза, мускус и бобы тонка.",
          ET: "Creed Aventus Cologne, unisex-lõhn 50 ml: mandariin, ingver ja roosa pipar, patšuli ja sandlipuu, põhjas kask, muskus ja tonkauba.",
          EN: "Creed Aventus Cologne, a 50 ml unisex eau de parfum: tangerine, ginger and pink pepper, patchouli and sandalwood over birch, musk and tonka."
        }
      },
      from: { EN: "from ", ET: "alates ", RU: "от " },
      /* The words after a product snippet — seoProductTail(). `free` takes the
         threshold from the rules; `delivery` is the line where delivery is
         never free. */
      productTail: {
        RU: { inStock: "в наличии", free: "бесплатная доставка от {free}", delivery: "доставка по Эстонии и Балтии", pickup: "самовывоз в Таллинне" },
        ET: { inStock: "laos", free: "tasuta tarne alates {free}", delivery: "tarne Eestis ja Baltikumis", pickup: "järeletulek Tallinnas" },
        EN: { inStock: "in stock", free: "free Baltic delivery from {free}", delivery: "delivery across Estonia and the Baltics", pickup: "pickup in Tallinn" }
      },
      /* Where the shop delivers, in the sentences search engines and AI
         answers read: the static home text, the info pages' and the sets
         page's descriptions — seoShipLine() and the three below it. Until
         25.10.2026 they named Estonia, Latvia, Lithuania and Finland only,
         and a customer in Spain took it to mean «not to Spain». The count
         and the amounts come from the rules; no figure is typed here. */
      ship: {
        RU: {
          head: "Доставка в {n} {countries} Европы", any: "Доставка по Европе", countries: ["страну", "страны", "стран"],
          free: "Бесплатно: {parts}.", baltic: "по Балтии от {free}", estonia: "по Эстонии от {free}",
          both: "в Финляндию и остальную Европу от {free}", fi: "в Финляндию от {free}", eu: "в остальную Европу от {free}",
          shop: "магазин Rempire, Таллинн.", pickup: "Самовывоз на Mardi 1.",
          intro: "Профессиональный уход, стайлинг, парфюмерия и мерч из салона Rempire в Таллинне.",
          sets: "Готовые наборы Rempire — уход, стайлинг и бритьё комплектом. Те же товары, что и поштучно, только дешевле. Таллинн, доставка по ЕС."
        },
        ET: {
          head: "Tarne {n} Euroopa {countries}", any: "Tarne üle Euroopa", countries: ["riiki", "riiki", "riiki"],
          free: "Tasuta: {parts}.", baltic: "Baltikumis alates {free}", estonia: "Eestis alates {free}",
          both: "Soome ja mujale Euroopasse alates {free}", fi: "Soome alates {free}", eu: "mujale Euroopasse alates {free}",
          shop: "Rempire'i pood, Tallinn.", pickup: "Järeletulek Mardi 1.",
          intro: "Professionaalne juukse- ja habemehooldus, viimistlus, parfüümid ja merch Rempire'i salongist Tallinnas.",
          sets: "Rempire'i valmiskomplektid — hooldus, viimistlus ja habemeajamine ühes pakis. Samad tooted mis eraldi, ainult soodsamalt. Tallinn, tarne üle ELi."
        },
        EN: {
          head: "Delivery to {n} {countries} in Europe", any: "Delivery across Europe", countries: ["country", "countries", "countries"],
          free: "Free: {parts}.", baltic: "in the Baltics from {free}", estonia: "in Estonia from {free}",
          both: "to Finland and the rest of Europe from {free}", fi: "to Finland from {free}", eu: "to the rest of Europe from {free}",
          shop: "Rempire shop, Tallinn.", pickup: "Pickup at Mardi 1.",
          intro: "Professional hair and beard care, styling, fragrance and merch from the Rempire salon in Tallinn.",
          sets: "Rempire ready-made sets — care, styling and shaving in one box. The same products the shop sells separately, only cheaper. Tallinn, EU-wide delivery."
        }
      }
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

  /* ---- a product text as a search snippet (09.10.2026) ---------------------

     The meta description of a product nobody has written one for is cut from
     its own text, and until now that cut fell wherever 104 characters ended:
     «Scalp circulatory stimulating serum. Serum that stimulates the
     superficial circulation of the… · delivery across Estonia…» (SEO pack,
     09.10.2026). These three functions are the whole of the rule, here so the
     static page (descFrom() in src/lib/seo-head.mjs) and the page after the
     shop boots (descFromText() in app.js) cannot cut the same text two ways. */

  var SEO_ENTITY = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " ",
    ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…"
  };
  var SEO_INLINE = /^(?:span|b|i|strong|em|a|u|sup|sub)$/i;

  /**
   * A product's HTML as plain text, every block boundary a sentence break: a
   * heading line above the copy keeps its own full stop instead of running
   * into the next sentence («Шампунь для редеющих волос Шампунь
   * поддерживает…»), an inline tag inside a word leaves the word whole, and
   * the entities are decoded once. textForSnippet() in src/lib/seo-head.mjs
   * IS this function; app.js used to strip the tags its own way and joined the
   * heading to the copy with a space.
   */
  function seoSnippetText(h) {
    /* a sentinel, not a space — the text is full of spaces; written as an
       escape, never as the character (a raw NUL makes grep call a file binary) */
    var MARK = "\u0000";
    return String(h || "")
      .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, function (m, tag) { return SEO_INLINE.test(tag) ? "" : MARK; })
      .replace(/<[^>]+>/g, MARK)
      .replace(/&(amp|lt|gt|quot|apos|#39|nbsp|ndash|mdash|rsquo|lsquo|rdquo|ldquo|hellip);/g, function (m, e) { return SEO_ENTITY[e]; })
      .replace(/&#(\d+);/g, function (m, n) { return String.fromCodePoint(Number(n)); })
      .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCodePoint(parseInt(n, 16)); })
      .split(MARK)
      .map(function (x) { return x.replace(/\s+/g, " ").trim(); })
      .filter(Boolean)
      .reduce(function (out, part) { return out ? out + (/[.!?…:;,)»—–-]$/.test(out) ? " " : ". ") + part : part; }, "")
      .trim();
  }

  /* The capitals of the languages the shop writes in — the same classes as
     dropShout() in src/lib/seo-head.mjs and app.js. */
  var SEO_UPPER = "A-ZÀ-ÖØ-ÞŠŽА-ЯЁ";
  /* A sentence ends at . ! ? or … followed by a space and something that can
     open one: a capital, a digit, №, an opening quote or bracket. «pH 4.7»,
     «e.g. after» and «2–5 мин.» stay inside their sentence. */
  var SEO_STOP = new RegExp("[.!?…]+[\"»”’)]*\\s+(?=[\"«„“(№]?[" + SEO_UPPER + "0-9])", "g");
  /* A label in capitals — «BENEFITS:», «HOW TO USE.», «ПРЕИМУЩЕСТВА:»,
     «СПОСОБ ПРИМЕНЕНИЯ.», «KASUTAMINE:», «SPECIAL SHAMPOO 1 BY SYSTEM 4.» */
  var SEO_LABEL = new RegExp("^[" + SEO_UPPER + "][" + SEO_UPPER + "0-9 &/'’.+-]{1,48}[:.](?=\\s|$)");

  function seoSentences(text) {
    var s = String(text == null ? "" : text).replace(/\s+/g, " ").trim(), out = [], from = 0, m;
    SEO_STOP.lastIndex = 0;
    while ((m = SEO_STOP.exec(s))) {
      out.push(s.slice(from, m.index + m[0].length).trim());
      from = m.index + m[0].length;
    }
    if (from < s.length) out.push(s.slice(from).trim());
    // «…образ» .» — a stray space before the stop
    return out.map(function (x) { return x.replace(/\s+([.!?…]+)$/, "$1"); }).filter(Boolean);
  }

  /** Mostly capitals — a heading or a shouted label, not copy. */
  function seoShouty(s) {
    var letters = s.replace(new RegExp("[^" + SEO_UPPER + "a-zà-öø-ÿšžа-яё]", "g"), "");
    var caps = letters.replace(new RegExp("[^" + SEO_UPPER + "]", "g"), "");
    return letters.length >= 6 && caps.length >= letters.length * 0.7;
  }

  /* Where a clause can end cleanly: a colon, a semicolon, an opening bracket,
     or a comma before a word that opens a clause of its own — который / в
     котором / что / а, mis / et / kuid, which / while, a gerund (защищая,
     kaitstes, leaving). A bare comma or «и / and / ja» is far more often the
     middle of a list — «сухие, повреждённые и…», «weightless, volumising» —
     and a cut there reads as broken, so neither counts. A dash is the weaker
     kind: in Russian it is as often «X — это Y» as an aside, so it is used
     only where none of the others is. */
  var SEO_OPENS = "(?:в|во|на|с|со|из|для|при|по|к|о|об|благодаря)\\s+котор[а-яё]*|котор[а-яё]*|что|чтобы|где|когда|поэтому|благодаря|а|но|включая|" +
    "придавая|создавая|обеспечивая|сохраняя|защищая|снижая|оставляя|делая|подчёркивая|подчеркивая|" +
    "укрепляя|увлажняя|питая|очищая|разглаживая|предотвращая|помогая|" +
    "созданн[а-яё]*|подходящ[а-яё]*|идеально|предназначенн[а-яё]*|разработанн[а-яё]*|обогащённ[а-яё]*|обогащенн[а-яё]*|" +
    "mis|mille[a-zõäöü]*|kes|et|kuid|sest|[a-zõäöüšž]+des|loodud|mõeldud|rikastatud|sobib|" +
    "which|that|while|whilst|so|but|without|including|leaving|giving|helping|making|adding|creating|keeping|providing|" +
    "reducing|diminishing|protecting|delivering|ensuring|allowing|lending|offering|combining|" +
    "suitable|ideal|perfect|designed|made|created|crafted|formulated|developed|enriched|infused|inspired";
  var SEO_CUT = new RegExp("\\s?[;:]\\s|\\s\\(|,\\s(?=(?:" + SEO_OPENS + ")(?![a-zа-яёõäöüšž]))", "g");
  var SEO_DASH = /\s[—–]\s/g;

  /** The last match of `rx` in `head` at `min` or beyond, or -1. */
  function seoLastCut(rx, head, min) {
    var best = -1, m;
    rx.lastIndex = 0;
    while ((m = rx.exec(head))) if (m.index >= min) best = m.index;
    return best;
  }

  /**
   * One sentence too long for `room`: the longest clean clause that fits
   * (SEO_CUT, else a dash), and only when there is none of at least thirty
   * characters — shorter is a bare noun with nothing said about it — a cut at
   * a word with «…» (seoClip()). A clause that would end on one word after a
   * dash — «…секрета улитки — ингредиента» — ends at the dash instead.
   */
  function seoClause(s, room) {
    s = String(s).trim();
    if (s.length <= room) return s;
    var min = Math.min(30, Math.floor(room / 2)), head = s.slice(0, room + 1);
    var best = seoLastCut(SEO_CUT, head, min);
    if (best < 0) best = seoLastCut(SEO_DASH, head, min);
    if (best < 0) return seoClip(s, room);
    var out = s.slice(0, best).replace(/[\s,;:—–-]+$/, "");
    var dash = seoLastCut(SEO_DASH, out, min);
    if (dash >= 0 && !/\s/.test(out.slice(dash + 3).trim())) out = out.slice(0, dash);
    return out;
  }

  /**
   * The words of a product text a snippet has room for: whole sentences from
   * the start, as many as fit in `room`, never half of one. A shouted heading
   * or a label in capitals before the copy is skipped; one after it ends the
   * copy, because what follows «BENEFITS:» / «ПРЕИМУЩЕСТВА:» / «KASUTAMINE:»
   * is a list, the usage or the ingredients. When even the first sentence is
   * longer than the room, its longest clean clause (seoClause()). Plain text
   * in, plain text out — the shouted run at the very start is dropShout()'s,
   * which the callers apply first.
   */
  function seoLead(text, room) {
    var parts = seoSentences(text), out = "", i, s;
    for (i = 0; i < parts.length; i++) {
      s = parts[i];
      if (SEO_LABEL.test(s) || seoShouty(s)) {
        if (out) break;
        s = s.replace(SEO_LABEL, "").trim();
        if (!s || seoShouty(s)) continue;
      }
      if (!out) {
        if (s.length > room) return seoClause(s, room);
        out = s;
      } else if (out.length + 1 + s.length <= room) out += " " + s;
      else break;
    }
    return out || seoClause(text, room);
  }

  /**
   * The hand-written meta description of a product in one language, or "" —
   * the productMeta table above. The owner's own pair wins over it, and it
   * wins over the description cut from the product's text.
   */
  function seoProductMeta(id, lang) {
    var m = seoCopy().productMeta[id];
    return (m && m[lang]) || "";
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

  /* The countries the «Другие страны Европы» row prices — EUROPE in
     src/lib/shipping.ts, copied because this block reads nothing from its
     surroundings (tests/seo-ship-line.test.ts holds the two equal). */
  var SEO_EUROPE = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "FR", "DE", "GR", "HU", "IE", "IT", "LU", "MT", "NL", "PL",
    "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB"];

  /**
   * How many countries the checkout delivers to: Estonia, Latvia, Lithuania,
   * Finland and Europe, minus the ones the owner switched off — the list the
   * Merchant Center feed ships to. null when the rules carry no
   * «countriesOff» to count against.
   */
  function seoShipCount(rules) {
    if (!rules || !Array.isArray(rules.countriesOff)) return null;
    var off = {};
    rules.countriesOff.forEach(function (c) { off[String(c).toUpperCase()] = true; });
    return ["EE", "LV", "LT", "FI"].concat(SEO_EUROPE).filter(function (c) { return !off[c]; }).length;
  }

  /** «Доставка в 25 стран Европы» — or «Доставка по Европе» without a count. */
  function seoShipHead(lang, rules) {
    var w = seoCopy().ship[lang] || seoCopy().ship.EN;
    var n = seoShipCount(rules);
    if (n === null) return w.any;
    var k = lang === "RU"
      ? (n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 1 : 2)
      : n === 1 ? 0 : 1;
    return seoFill(w.head, { n: String(n), countries: w.countries[k] });
  }

  /**
   * Where the shop delivers and from what it is free, in one or two
   * sentences: «Доставка в 25 стран Европы. Бесплатно: по Балтии от 70 €, в
   * Финляндию и остальную Европу от 200 €.» Latvia and Lithuania fold into
   * «Балтия» only while they share Estonia's floor, Finland into «остальная
   * Европа» only while it shares Europe's; a floor the owner cleared drops
   * its clause.
   */
  function seoShipLine(lang, rules) {
    var w = seoCopy().ship[lang] || seoCopy().ship.EN;
    var eur = function (v) { return seoEur(v, lang); };
    var ee = seoFreeFrom(rules, "EE"), lv = seoFreeFrom(rules, "LV"), lt = seoFreeFrom(rules, "LT");
    var fi = seoFreeFrom(rules, "FI"), eu = seoFreeFrom(rules, "EU");
    var parts = [];
    if (ee !== null) parts.push(seoFill(lv === ee && lt === ee ? w.baltic : w.estonia, { free: eur(ee) }));
    if (fi !== null && fi === eu) parts.push(seoFill(w.both, { free: eur(fi) }));
    else {
      if (fi !== null) parts.push(seoFill(w.fi, { free: eur(fi) }));
      if (eu !== null) parts.push(seoFill(w.eu, { free: eur(eu) }));
    }
    var head = seoShipHead(lang, rules) + ".";
    return parts.length ? head + " " + seoFill(w.free, { parts: parts.join(", ") }) : head;
  }

  /** The home page's static paragraph under its heading — what a crawler reads before the script draws the page. */
  function seoHomeIntro(lang, rules) {
    var w = seoCopy().ship[lang] || seoCopy().ship.EN;
    return w.intro + " " + seoShipLine(lang, rules) + " " + w.pickup;
  }

  /** What follows «Доставка и оплата —» in an info page's description. */
  function seoInfoTail(lang, rules) {
    var w = seoCopy().ship[lang] || seoCopy().ship.EN;
    return w.shop + " " + seoShipLine(lang, rules);
  }

  /** The sets page's description — «EU», not the count: the sentence is
      at Google's length already, and every country the shop can switch on
      is in Europe. `rules` is taken so the three callers read alike. */
  function seoSetsDesc(lang, rules) {
    var w = seoCopy().ship[lang] || seoCopy().ship.EN;
    return w.sets;
  }

  /** «… | REMPIRE» in the shop's house form, «… — REMPIRE» — what fitTitle()
      writes everywhere else, so a title ends the same way on every page. */
  function seoHouse(t) {
    return String(t).replace(/\s*\|\s*REMPIRE$/, " — REMPIRE");
  }

  /* ---- the owner's own words over the copy above -------------------------
     settings.page_texts (src/lib/page-texts.mjs), written in «Настройки →
     Тексты страниц» or by his Claude (Dim, 26.10.2026): per section and
     brand page and per language, { title, desc, intro } — only the fields he
     wrote. Everything he did not write stays the copy above. The prerender
     sets it from the database before it writes a page, the shop from
     /api/overrides at boot. */
  var SEO_OWN = null;
  function seoOwnSet(v) {
    SEO_OWN = v && typeof v === "object" && !Array.isArray(v) ? v : null;
  }
  /** One field the owner wrote — "" when he wrote none. */
  function seoOwn(kind, key, lang, field) {
    var all = SEO_OWN && SEO_OWN[kind];
    var page = all && Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null;
    var v = page && page[lang] && page[lang][field];
    return typeof v === "string" ? v.replace(/^\s+|\s+$/g, "") : "";
  }
  /* The line under a section's heading, as the shop has printed it since
     launch — until 26.10.2026 a Russian line in app.js (CAT_INTROS) and its
     two translations in the dictionary, word for word these. Here so the
     prerender, the shop and the owner's Claude read the one copy the owner's
     own line replaces. */
  function seoCatLines() {
    return {
      all: {
        RU: "Весь ассортимент Rempire: шампуни, стайлинг, уход за бородой, корейская косметика, парфюмерия и мерч.",
        ET: "Kogu Rempire'i valik: šampoonid, viimistlus, habemehooldus, Korea nahahooldus, parfüümid ja merch.",
        EN: "The whole Rempire range: shampoos, styling, beard care, Korean skincare, perfume and merch."
      },
      hair: {
        RU: "Шампуни, кондиционеры, маски и уход за кожей головы — то, чем работает салон Rempire.",
        ET: "Juuksehooldus Rempire'i salongist Mardi 1: šampoonid, palsamid, juuksemaskid ja peanahahooldus. System 4 rasusele, kuivale või hõrenevale peanahale, Kevin.Murphy, Davines ja Paul Mitchell igapäevaseks hoolduseks — järeletulek Tallinnas või tarne üle Eesti.",
        EN: "Shampoos, conditioners, hair masks and scalp care — what the Rempire salon works with."
      },
      styling: {
        RU: "Воск для волос, паста, глина, спреи и пудра — то, чем укладывают наши барберы.",
        ET: "Juuksevaha, pasta, savi, juukselakk ja puuder — viimistlustooted meie barberite valikust.",
        EN: "Hair wax, paste, clay, hairspray and powder — the styling our barbers work with."
      },
      beard: {
        RU: "Масло для бороды, бальзамы, воск для усов и средства для бритья — выбор наших барберов.",
        ET: "Habemehooldusvahendid, mida kasutavad meie barberid Mardi 1 salongis: habemeõlid igapäevaseks hoolduseks, habemepalsamid kuju ja pehmuse jaoks, vuntsivaha ning raseerimisgeelid ja -järgsed palsamid. Captain Fawcett, Proraso ja Davines — järeletulek Tallinnas või tarne üle Eesti.",
        EN: "Beard oil, beard balm, moustache wax and shaving products — our barbers' own pick."
      },
      face: {
        RU: "Корейская косметика и мужской уход: тонеры, средства для умывания, сыворотки, маски и SPF.",
        ET: "Korea nahahooldus ja meeste näohooldus: toonikud, näopesuvahendid, seerumid, maskid ja SPF.",
        EN: "Korean skincare and men's face care: toners, cleansers, serums, masks and SPF."
      },
      body: {
        RU: "Уход за татуировкой, гели для душа и мыло — включая мыло ручной работы Rempire.",
        ET: "Tätoveeringu järelhooldus, dušigeelid ja seep — sealhulgas Rempire'i enda käsitööseep.",
        EN: "Tattoo aftercare, body wash and soap — including Rempire's own handmade soap."
      },
      perfume: {
        RU: "Нишевая и классическая парфюмерия — оригинальные ароматы в наличии в Таллинне.",
        ET: "Nišiparfüümid ja klassika — originaaltooted, mida hoiame Tallinnas laos.",
        EN: "Niche and classic perfume — original fragrances in stock in Tallinn."
      },
      merch: {
        RU: "Футболки Rempire с принтами наших художников — печатаем малыми тиражами.",
        ET: "Rempire'i T-särgid meie kunstnike trükistega — trükime väikestes tiraažides.",
        EN: "Rempire T-shirts with prints by our own artists, made in small runs."
      }
    };
  }
  /**
   * What a section or brand page says when the owner has written nothing —
   * { title, desc, intro }, the copy above alone (the title as Google is
   * served it). The grey text in an empty box of «Тексты страниц», and the
   * standard his Claude is shown (get_page_texts).
   */
  function seoStandard(kind, key, lang, ctx) {
    var keep = SEO_OWN;
    SEO_OWN = null;
    try {
      var h = seoHead(kind, key, lang, ctx);
      return { title: h.t, desc: h.d, intro: kind === "cat" ? seoCatIntro(key, lang) : seoBrandIntro(key, lang) };
    } finally {
      SEO_OWN = keep;
    }
  }
  /** The line under a section's heading — the owner's own, else the shop's; "" for a key with neither. */
  function seoCatIntro(cat, lang) {
    var line = seoCatLines()[cat];
    return seoOwn("cat", cat, lang, "intro") || (line && line[lang]) || "";
  }

  /**
   * The paragraph under a brand page's heading, in the page's language — the
   * owner's own, else the approved one, else "" for a brand with neither,
   * whose page keeps the shop's generic line (catIntro() in app.js). Plain
   * text, not HTML.
   */
  function seoBrandIntro(brand, lang) {
    var b = seoCopy().brand[brand];
    return seoOwn("brand", brand, lang, "intro") || (b && b[lang] && b[lang].intro) || "";
  }

  /**
   * A subcollection's words in one language — { title, meta, name, h1?, intro } —
   * or null for a key with none. Plain text, not HTML.
   */
  function seoSub(key, lang) {
    var s = seoCopy().sub[key];
    return (s && s[lang]) || null;
  }

  /** «от 7,90 €» / «alates 7,90 €» / «from €7.90» — a product's price as its title prints it. */
  function seoPriceText(price, from, lang) {
    return (from ? seoCopy().from[lang] || "" : "") + seoEur(price, lang);
  }

  /**
   * What a product snippet ends with: the price, «in stock» when it is, the
   * free-delivery threshold from the rules (the delivery line where delivery
   * is never free) and pickup. The price and stock left the snippet on
   * 21.09.2026 because the title carried the price; on 25.10.2026 Estonian
   * results showed Google cutting it off our titles while competitors'
   * snippets printed theirs, so it is back (Dim). «Out of stock» is still
   * never written — that line only stops the click.
   */
  function seoProductTail(priceText, inStock, lang, rules) {
    var w = seoCopy().productTail[lang] || seoCopy().productTail.EN;
    var free = seoFreeFrom(rules, "EE");
    var parts = [];
    if (priceText) parts.push(priceText);
    if (inStock) parts.push(w.inStock);
    parts.push(free === null ? w.delivery : seoFill(w.free, { free: seoEur(free, lang) }));
    parts.push(w.pickup);
    return parts.join(" · ");
  }

  /**
   * A hand-written product line (productMeta) keeps every word it has; the
   * price — and «in stock» — follow only where they still fit in `max`.
   */
  function seoMetaWithPrice(meta, priceText, inStock, lang, max) {
    var w = seoCopy().productTail[lang] || seoCopy().productTail.EN;
    var base = String(meta).replace(/\.$/, "");
    if (!priceText) return meta;
    var both = base + " · " + priceText + (inStock ? " · " + w.inStock : "");
    if (both.length <= max) return both;
    var price = base + " · " + priceText;
    return price.length <= max ? price : meta;
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
   *   kind  "home" | "cat" | "brand" | "sub" | "blog"
   *   key   the section ("hair" … "all"), the brand's name, the subcollection
   *         ("beard/oi"); "" otherwise
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
      t = seoOwn("cat", key, lang, "title") || c[0];
      d = seoOwn("cat", key, lang, "desc") || c[1];
    } else if (kind === "brand") {
      var b = C.brand[key] && C.brand[key][lang];
      if (b) {
        var bFree = b.metaFree ? seoFreeFrom(rules, "EE") : null;
        t = b.title;
        d = bFree === null ? b.meta : seoFill(b.metaFree, { free: seoEur(bFree, lang) });
      } else {
        t = seoFill(C.brandFallback[lang] || C.brandFallback.EN, { brand: key });
        d = seoFill(C.brandGeneric[lang] || C.brandGeneric.EN, { brand: key });
      }
      t = seoOwn("brand", key, lang, "title") || t;
      d = seoOwn("brand", key, lang, "desc") || d;
      /* the house's name once: a brand that IS the house (Rempire's own
         soap and merch) needs no second one, and a long brand name keeps its
         words rather than the suffix */
      var bare = t.replace(/\s*\|\s*REMPIRE$/, "");
      if (/rempire/i.test(bare) || seoHouse(t).length > SEO_TITLE_MAX) t = bare;
    } else if (kind === "sub") {
      var u = seoSub(key, lang) || seoSub(key, "EN");
      if (u) {
        t = u.title;
        d = u.meta;
      }
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
  seoCopy, seoEur, seoClip, seoFreeFrom, seoHouse, seoBrandIntro, seoSub, seoPriceText, seoProductCore, seoProductTitle, seoHead,
  seoOwnSet, seoOwn, seoCatIntro, seoCatLines, seoStandard,
  seoProductTail, seoMetaWithPrice,
  seoSnippetText, seoLead, seoProductMeta,
  SEO_EUROPE, seoShipCount, seoShipLine, seoHomeIntro, seoInfoTail, seoSetsDesc,
};
