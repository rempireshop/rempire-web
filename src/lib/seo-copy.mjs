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
      /* A brand page: its own title, meta description and the visible intro
         under its heading, where the owner has approved them — the eight
         below, word for word from Rempire/seo/brand-intros.json (Dim,
         09.10.2026; the intros with the history trimmed). Every other brand
         keeps the line it always had under its heading (catIntro() in app.js)
         and the description it always carried (brandGeneric), under the
         template's fallback title «{brand} in Tallinn | REMPIRE» (audit §1A).
         The intro is the shop's own paragraph, not a snippet: seoBrandIntro(). */
      brand: {
        "System 4": {
          RU: {
            title: "System 4 (Sim Sensitive): шампуни №1–4 и сыворотка | REMPIRE",
            meta: "System 4 (Sim Sensitive): шампуни №1–4 для жирной, сухой и чувствительной кожи головы, тоник T, маска O и сыворотка Bio Botanical. Самовывоз на Mardi 1.",
            intro: "System 4 — финская линия Sim Sensitive для кожи головы. Номер на шампуне подсказывает тип кожи головы: №1 — жирная и склонная к перхоти, №2 — сухая с перхотью, №3 — для ежедневного ухода, №4 — очень жирная и чувствительная. К ним — тоник T, маска O и сыворотка Bio Botanical. Подобрать номер поможем в салоне на Mardi 1."
          },
          ET: {
            title: "System 4 (Sim Sensitive): šampoonid ja seerum | REMPIRE",
            meta: "Sim Sensitive'i System 4: šampoonid 1–4 rasusele, kuivale ja tundlikule peanahale, toonik T, mask O ja Bio Botanical seerum. Järeletulek Mardi 1, Tallinn.",
            intro: "System 4 on Sim Sensitive'i Soome peanahahoolduse sari. Šampooni number näitab peanaha tüüpi: 1 – rasune ja kõõmale kalduv, 2 – kuiv ja kõõmale kalduv, 3 – igapäevaseks hoolduseks, 4 – väga rasune ja tundlik. Lisaks toonik T, mask O ja Bio Botanical seerum. Õige numbri aitame valida meie salongis Mardi 1."
          },
          EN: {
            title: "System 4 by Sim Sensitive: Scalp Shampoos & Serum | REMPIRE",
            meta: "System 4 by Sim Sensitive: shampoos 1–4 for oily, dry or sensitive scalps, T tonic, O scalp mask and Bio Botanical serum. Pickup at Mardi 1, Tallinn.",
            intro: "System 4 is Sim Sensitive's Finnish scalp-care range. The number on each shampoo tells you which scalp it suits: 1 for oily, dandruff-prone, 2 for dry, dandruff-prone, 3 for everyday care and 4 for very oily, sensitive scalps. Alongside them: T tonic, O scalp mask and Bio Botanical serum. We'll help you pick yours at Mardi 1."
          }
        },
        "Kevin.Murphy": {
          RU: {
            title: "Kevin.Murphy — шампуни, маски и стайлинг | REMPIRE",
            meta: "Kevin.Murphy в Таллинне: шампуни и маски Angel, Hydrate-Me, Repair-Me, Young.Again и стайлинг Night.Rider, Session.Spray. Самовывоз на Mardi 1.",
            intro: "Kevin.Murphy — австралийская марка салонного ухода за волосами. У нас шампуни и маски Angel, Hydrate-Me, Repair-Me и Young.Again, стайлинг Night.Rider, Rough.Rider, Session.Spray и Anti.Gravity. Что подойдёт вашим волосам, подскажем в салоне на Mardi 1."
          },
          ET: {
            title: "Kevin.Murphy juuksehooldus ja viimistlus | REMPIRE",
            meta: "Kevin.Murphy Tallinnas: Angel, Hydrate-Me, Repair-Me ja Young.Again šampoonid ja maskid ning Night.Rider ja Session.Spray viimistlus. Järeletulek Mardi 1.",
            intro: "Kevin.Murphy on Austraalia salongi juuksehoolduse bränd. Meil on Angel, Hydrate-Me, Repair-Me ja Young.Again šampoonid ja maskid ning viimistlustooted Night.Rider, Rough.Rider, Session.Spray ja Anti.Gravity. Mis sinu juustele sobib, aitame valida meie salongis Mardi 1."
          },
          EN: {
            title: "Kevin.Murphy: Shampoos, Masks & Styling | REMPIRE",
            meta: "Kevin Murphy products in Tallinn: Angel, Hydrate-Me, Repair-Me and Young.Again care, Night.Rider and Session.Spray styling. Pickup at Mardi 1.",
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
            intro: "Captain Fawcett — британская марка ухода за бородой и усами. У нас масла и бальзамы для бороды и воск для усов серий Nebula, Booze & Baccy и Barberism — у каждой серии свой аромат. Аромат и фиксацию поможем подобрать в салоне на Mardi 1."
          },
          ET: {
            title: "Captain Fawcett: habemeõli, -palsam ja vuntsivaha | REMPIRE",
            meta: "Briti Captain Fawcett: habemeõlid, habemepalsamid ja vuntsivaha sarjadest Nebula (John Petrucci), Booze & Baccy ja Barberism. Järeletulek Mardi 1, Tallinn.",
            intro: "Captain Fawcett on Briti habeme- ja vuntsihoolduse bränd. Meil on habemeõlid, habemepalsamid ja vuntsivaha sarjadest Nebula, Booze & Baccy ja Barberism – igal sarjal oma lõhn. Lõhna ja hoidvuse aitame valida meie salongis Mardi 1."
          },
          EN: {
            title: "Captain Fawcett: Beard Oil, Balm & Moustache Wax | REMPIRE",
            meta: "Captain Fawcett, UK: beard oils, beard balms and moustache wax from the Nebula (John Petrucci), Booze & Baccy and Barberism series. Pickup at Mardi 1.",
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
            meta: "Creed Aventus (бергамот, ананас, берёза), Aventus Cologne с имбирём и Original Vetiver в Таллинне. Самовывоз на Mardi 1, доставка по Эстонии и Балтии.",
            intro: "Creed — нишевый парфюмерный дом. У нас Creed Aventus с бергамотом, ананасом и дымной берёзой, более свежий Aventus Cologne с имбирём и Original Vetiver с лимоном, зелёными нотами и ветивером. Выбрать между ними поможем на Mardi 1."
          },
          ET: {
            title: "Creed: Aventus, Aventus Cologne, Original Vetiver | REMPIRE",
            meta: "Creed Aventus (bergamott, ananass, kask), ingveriga Aventus Cologne ja Original Vetiver Tallinnas. Järeletulek Mardi 1, tarne Eestis ja Baltikumis.",
            intro: "Creed on nišiparfüümide maja. Meil on Creed Aventus bergamoti, ananassi ja suitsuse kasepuuga, värskem Aventus Cologne ingveriga ning Original Vetiver sidruni, roheliste nootide ja vetiveriga. Mardi 1 poes aitame neist valida."
          },
          EN: {
            title: "Creed: Aventus, Aventus Cologne & Original Vetiver | REMPIRE",
            meta: "Creed Aventus (bergamot, pineapple, birch), the ginger-led Aventus Cologne and Original Vetiver in Tallinn. Pickup at Mardi 1, delivery across the Baltics.",
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
            meta: "Xerjoff Naxos kollektsioonist 1861 (lavendel, mesi, tubakas, vanill) ja Tony Iommi Monkey Special. Järeletulek Mardi 1, tarne Eestis ja Baltikumis.",
            intro: "Xerjoff on Torino parfümeeriamaja. Kollektsiooni 1861 Xerjoff Naxos: lavendel, bergamott, mesi, tubakaleht ja vanill; Tony Iommi Monkey Special: rumm, nahk, kaneel ja karamell. Mõlemad on soojad, magusapoolsed lõhnad – valida aitame Mardi 1 poes."
          },
          EN: {
            title: "Xerjoff: 1861 Naxos & Tony Iommi Monkey Special | REMPIRE",
            meta: "Xerjoff Naxos from the 1861 collection (lavender, honey, tobacco, vanilla) and Tony Iommi Monkey Special in Tallinn. Pickup at Mardi 1, Baltic delivery.",
            intro: "Xerjoff is a perfume house from Turin. Xerjoff Naxos from the 1861 collection: lavender, bergamot, honey, tobacco leaf and vanilla; Tony Iommi Monkey Special: rum, leather, cinnamon and caramel. Both are warm, sweet-leaning scents; we'll help you choose at Mardi 1."
          }
        },
        "Byredo": {
          RU: {
            title: "Byredo — Blanche, Mojave Ghost и гель для душа | REMPIRE",
            meta: "Byredo Blanche — альдегиды, роза и мускус, аромат чистого белья; гель для душа Blanche и Mojave Ghost. Самовывоз на Mardi 1, доставка по Эстонии и Балтии.",
            intro: "Byredo — парфюмерный дом из Стокгольма. Byredo Blanche — аромат чистого белья: альдегиды, роза, пион, мускус и сандал; к нему есть гель для душа Blanche. Mojave Ghost — амбретта, магнолия, сандал и кедр."
          },
          ET: {
            title: "Byredo: Blanche, Mojave Ghost ja dušigeel | REMPIRE",
            meta: "Byredo Blanche (aldehüüdid, roos, muskus – puhta pesu lõhn), Blanche'i dušigeel ja Mojave Ghost. Järeletulek Mardi 1, tarne Eestis ja Baltikumis.",
            intro: "Byredo on Stockholmi parfümeeriamaja. Byredo Blanche lõhnab nagu puhas pesu: aldehüüdid, roos, pojeng, muskus ja sandlipuu; sellele lisaks Blanche'i dušigeel. Mojave Ghost: ambretiseeme, magnoolia, sandlipuu ja seeder."
          },
          EN: {
            title: "Byredo: Blanche, Mojave Ghost & Blanche Body Wash | REMPIRE",
            meta: "Byredo Blanche (aldehydes, rose, musk: the scent of clean linen), Blanche body wash and Mojave Ghost. Pickup at Mardi 1, delivery across the Baltics.",
            intro: "Byredo is a perfume house from Stockholm. Byredo Blanche smells of clean linen: aldehydes, rose, peony, musk and sandalwood, with a matching Blanche body wash. Mojave Ghost: ambrette, magnolia, sandalwood and cedarwood."
          }
        }
      },
      /* A subcollection — a section's chip with a page of its own (SUB_HANDLES
         in src/lib/shop-paths.mjs, /et/collections/habemeolid): its title and
         meta, its name in the structured data, and the line under the
         heading (seoSub()). The heading itself stays the section's, as it
         always was on tapping the chip (Dim, 09.10.2026). */
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
            title: "Habemepalsamid: Proraso, Captain Fawcett | REMPIRE",
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
            title: "Palsamid: Kevin.Murphy, Paul Mitchell, System 4 | REMPIRE",
            meta: "Kevin.Murphy, Paul Mitchell, System 4, Lumin ja CBD Daily: palsamid kuivadele, värvitud, lokkis ja õhukestele juustele. Järeletulek Tallinnas.",
            name: "Palsamid",
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
            meta: "Воск Gatsby Moving Rubber, паста и глина Davines Pasta&Love, паста MITCH от Paul Mitchell — фиксация и текстура для коротких стрижек. Самовывоз в Таллинне.",
            name: "Воск, паста и глина для волос",
            intro: "Воск даёт блеск и фиксацию, которую можно поправить в течение дня, паста — более мягкий и естественный результат, глина — сильную матовую фиксацию с текстурой. Японские воски Gatsby, Davines Pasta&Love и MITCH от Paul Mitchell закрывают все три варианта."
          },
          ET: {
            title: "Juuksevaha, pasta ja savi: Gatsby, Davines | REMPIRE",
            meta: "Gatsby Moving Rubber juuksevahad, Davinesi Pasta&Love pasta ja matt savi ning Paul Mitchell MITCH pasta — fikseerimine ja tekstuur lühikestele soengutele.",
            name: "Juuksevaha, pasta ja savi",
            intro: "Juuksevaha annab läike ja fikseerimise, mida saab päeva jooksul ümber sättida, pasta pehmema ja loomulikuma tulemuse, savi tugeva ja mati fikseerimise koos tekstuuriga. Jaapani Gatsby vahad, Davinesi Pasta&Love ja Paul Mitchelli MITCH katavad kõik kolm."
          },
          EN: {
            title: "Hair Wax, Paste & Clay: Gatsby, Davines, Paul Mitchell",
            meta: "Gatsby Moving Rubber waxes, Davines Pasta&Love paste and matte clay, Paul Mitchell MITCH paste — hold and texture for short styles. Pickup in Tallinn.",
            name: "Hair wax, paste & clay",
            intro: "Wax gives shine and a hold you can rework through the day, paste a softer, more natural finish, and clay a strong matte hold with texture. Gatsby's Japanese waxes, Davines Pasta&Love and Paul Mitchell's MITCH cover all three."
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

  /**
   * The paragraph under a brand page's heading, in the page's language — or
   * "" for a brand with no approved text, whose page keeps the shop's
   * generic line (catIntro() in app.js). Plain text, not HTML.
   */
  function seoBrandIntro(brand, lang) {
    var b = seoCopy().brand[brand];
    return (b && b[lang] && b[lang].intro) || "";
  }

  /**
   * A subcollection's words in one language — { title, meta, name, intro } —
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
};
