/* bundles.config.mjs — the curated sets («Наборы»).
   THIS is the file Renat (or Dmitri on his word) edits. Nothing else about a
   set is written by hand: prices, photos and availability are computed from
   the catalogue by tools/build-bundles.mjs.

   One entry:
     id     — short latin slug, becomes the URL /shop2/set/<id>/ and the cart
              line id «bundle:<id>». Never reuse an id for a different set:
              old carts and old orders point at it.
     cat    — which catalogue section the set belongs with (hair, styling,
              beard, face, body, perfume, merch). Used for sorting only.
     title  — the name, in three languages.
     desc   — two or three plain sentences, in three languages.
     items  — the real products inside, by catalogue id. `size` is the index
              of the volume in that product's own size list (0 = the first
              one); leave it out when the product has a single size.

   Rules the generator enforces, so a typo cannot reach the shop:
     · every id must exist in public/shop/catalogue2.js;
     · a set holds 2–4 items and no product twice;
     · the price is the sum of the items minus DISCOUNT, rounded DOWN to the
       nearest «,90» — so the shopper always saves at least the 12 %.

   After editing: node tools/build-bundles.mjs
*/

export const DISCOUNT = 0.12;

export const BUNDLES = [
  {
    id: "beard-start",
    cat: "beard",
    title: {
      RU: "Борода — стартовый набор",
      ET: "Habe — stardikomplekt",
      EN: "Beard starter kit",
    },
    desc: {
      RU: "Масло, бальзам и мыло — всё, с чего начинается уход за бородой. Масло смягчает волос, бальзам держит форму, мыло моет и не пересушивает кожу под бородой.",
      ET: "Õli, palsam ja seep — kõik, millest habemehooldus algab. Õli pehmendab karva, palsam hoiab kuju, seep peseb ega kuivata habemealust nahka.",
      EN: "Oil, balm and soap — everything beard care starts with. The oil softens, the balm holds the shape, the soap cleans without drying the skin underneath.",
    },
    items: [
      { id: "proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml" },
      { id: "proraso-wood-spice-beard-balm-100ml" },
      { id: "handmade-soap-666" },
    ],
  },
  {
    id: "shave-smooth",
    cat: "beard",
    title: {
      RU: "Гладкое бритьё",
      ET: "Sile raseerimine",
      EN: "Smooth shave",
    },
    desc: {
      RU: "Масло до бритья, мягкий гель и успокаивающий бальзам после. Три шага, после которых кожа не горит и не краснеет.",
      ET: "Õli enne raseerimist, pehme geel ja rahustav palsam pärast. Kolm sammu, mille järel nahk ei kipitse ega punetu.",
      EN: "Pre-shave oil, a soft gel and a soothing balm after. Three steps that leave the skin calm instead of burning.",
    },
    items: [
      { id: "davines-pre-shaving-beard-oil" },
      { id: "davines-softening-shaving-gel" },
      { id: "proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml" },
    ],
  },
  {
    id: "tattoo-care",
    cat: "body",
    title: {
      RU: "Уход за татуировкой",
      ET: "Tätoveeringu hooldus",
      EN: "Tattoo aftercare",
    },
    desc: {
      RU: "Пенка для мытья, бальзам и крем Yumain — то, чем закрывают свежую работу первые две недели. Мастера студии дают тот же список.",
      ET: "Pesuvaht, palsam ja kreem Yumainilt — sellega hoolitsetakse värske töö eest esimesed kaks nädalat. Stuudio meistrid annavad sama nimekirja.",
      EN: "Washing foam, balm and cream by Yumain — what a fresh piece needs for its first two weeks. The same list our artists hand out.",
    },
    items: [
      { id: "yumain-aftercare-washing-foam-expert-care-for-your-tattoos" },
      { id: "yumain-tattoo-balm-the-ultimate-care-for-your-tattoos" },
      { id: "yumain-tattoo-cream" },
    ],
  },
  {
    id: "styling-duo",
    cat: "styling",
    title: {
      RU: "Стайлинг — паста и спрей",
      ET: "Viimistlus — pasta ja sprei",
      EN: "Styling duo — paste and spray",
    },
    desc: {
      RU: "Паста Night.Rider даёт форму, спрей SESSION.SPRAY её держит. Пара, которую в салоне собирают чаще всего.",
      ET: "Pasta Night.Rider annab kuju, sprei SESSION.SPRAY hoiab seda. Paar, mida salongis kõige sagedamini kokku pannakse.",
      EN: "Night.Rider paste gives the shape, SESSION.SPRAY holds it. The pairing the salon reaches for most often.",
    },
    items: [
      { id: "night-rider", size: 0 },
      { id: "kevin-murphy-session-spray", size: 1 },
    ],
  },
  {
    id: "gift-rempire",
    cat: "body",
    title: {
      RU: "Подарочный набор Rempire",
      ET: "Rempire kinkekomplekt",
      EN: "Rempire gift set",
    },
    desc: {
      RU: "Два мыла нашей собственной варки и масло для бороды — готовый подарок тому, кто следит за собой.",
      ET: "Kaks meie enda keedetud seepi ja habemeõli — valmis kingitus sellele, kes enda eest hoolitseb.",
      EN: "Two of our own handmade soaps and a beard oil — a ready gift for someone who takes care of themselves.",
    },
    items: [
      { id: "handmade-soap-666" },
      { id: "handmade-soap-rule-nr-1" },
      { id: "proraso-beard-oil-azur-lime-30ml" },
    ],
  },
  {
    id: "hair-young-again",
    cat: "hair",
    title: {
      RU: "Kevin.Murphy YOUNG.AGAIN — уход целиком",
      ET: "Kevin.Murphy YOUNG.AGAIN — täielik hooldus",
      EN: "Kevin.Murphy YOUNG.AGAIN — the full routine",
    },
    desc: {
      RU: "Шампунь, кондиционер и масло одной линии. Для длинных и повреждённых волос — в салоне их ставят вместе.",
      ET: "Ühe seeria šampoon, palsam ja õli. Pikkadele ja kahjustatud juustele — salongis pannakse need kokku.",
      EN: "Shampoo, conditioner and oil from one line. For long and damaged hair — the salon uses them together.",
    },
    items: [
      { id: "kevin-murphy-young-again-wash", size: 1 },
      { id: "kevin-murphy-young-again-rinse", size: 1 },
      { id: "kevin-murphy-young-again-oil" },
    ],
  },
  {
    id: "face-basic",
    cat: "face",
    title: {
      RU: "Лицо — три шага",
      ET: "Nägu — kolm sammu",
      EN: "Face — three steps",
    },
    desc: {
      RU: "Гидрофильное масло смывает день, крем восстанавливает, солнцезащитный закрывает утро. Базовый корейский уход без лишнего.",
      ET: "Hüdrofiilne õli peseb päeva maha, kreem taastab, päikesekaitse lõpetab hommiku. Korea baashooldus ilma liigseta.",
      EN: "The cleansing oil takes the day off, the cream repairs, the SPF finishes the morning. A Korean basic routine, nothing extra.",
    },
    items: [
      { id: "anua-heartleaf-pore-control-cleansing-oil" },
      { id: "cosrx-advanced-snail-92-all-in-one-cream" },
      { id: "cosrx-aloe-sun-cream" },
    ],
  },
  {
    id: "barberism",
    cat: "beard",
    title: {
      RU: "Captain Fawcett Barberism — борода и усы",
      ET: "Captain Fawcett Barberism — habe ja vuntsid",
      EN: "Captain Fawcett Barberism — beard and moustache",
    },
    desc: {
      RU: "Масло, бальзам и воск для усов из линии Barberism — один аромат на всю бороду, ничего не спорит между собой.",
      ET: "Õli, palsam ja vuntsivaha Barberismi seeriast — üks lõhn kogu habemele, miski ei lähe omavahel tülli.",
      EN: "Oil, balm and moustache wax from the Barberism line — one scent across the whole beard, nothing clashing.",
    },
    items: [
      { id: "captain-fawcett-barberism-beard-oil" },
      { id: "captain-fawcett-sid-sottung-barberism-beard-balm" },
      { id: "captain-fawcett-barberism-moustache-wax" },
    ],
  },
];

export default BUNDLES;
