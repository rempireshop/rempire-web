-- 120_bundles.sql — the curated sets («Наборы»), migration range 120–129.
--
-- Until now a set existed only in tools/bundles.config.mjs: Renat could not
-- touch one without a developer, a text editor and a redeploy. This table is
-- the source of truth from here on; the generated files stay in the repo as
-- the offline fallback (public/shop/bundles.js for the storefront, and
-- src/data/bundles.json for order pricing when there is no database at all).
--
-- One row is one set:
--   id            latin slug — the URL /shop2/set/<id>/ AND the cart/order
--                 line id «bundle:<id>». Never reuse an id for a different
--                 set: old carts and paid orders point at it.
--   cat           which catalogue section the set is shown with (sorting only)
--   name_*        the name, RU required, ET/EN optional (RU shows through)
--   desc_*        two or three plain sentences, same rule
--   items         [{productId, variant, qty}] — variant is the index of the
--                 volume in that product's own size list (0 = the first one)
--   price         the set price in euro. null = compute it from discount_pct
--   discount_pct  0–90, used only when price is null
--   image         a product id or a URL for the set's photo. null = the shop
--                 stacks the photos of the first three items, as it does today
--   active        false hides the set everywhere without losing its id
--   sort          smaller first
--
-- Prices are recomputed from this row on every order (src/lib/orders.ts →
-- src/lib/bundles.ts): the browser's number is never trusted.
--
-- The seed below is exactly what tools/bundles.config.mjs produced on the day
-- this migration was written — same ids, same prices, same URLs — so nothing
-- a customer has bookmarked or left in a cart changes. `on conflict do
-- nothing` makes it idempotent: a re-run never overwrites an edit Renat made
-- in the admin.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

create table if not exists bundles (
  id           text primary key,
  cat          text not null default 'body',
  name_ru      text not null,
  name_et      text,
  name_en      text,
  desc_ru      text,
  desc_et      text,
  desc_en      text,
  items        jsonb not null default '[]'::jsonb,
  price        numeric(10,2) check (price is null or price >= 0),
  discount_pct numeric(5,2) check (discount_pct is null or (discount_pct >= 0 and discount_pct <= 90)),
  image        text,
  active       boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The storefront asks for «active, in order»; the admin for «all, in order».
create index if not exists bundles_sort_idx on bundles (active, sort, id);

insert into bundles
  (id, cat, name_ru, name_et, name_en, desc_ru, desc_et, desc_en, items, price, sort)
values
  ('beard-start', 'beard', 'Борода — стартовый набор', 'Habe — stardikomplekt', 'Beard starter kit', 'Масло, бальзам и мыло — всё, с чего начинается уход за бородой. Масло смягчает волос, бальзам держит форму, мыло моет и не пересушивает кожу под бородой.', 'Õli, palsam ja seep — kõik, millest habemehooldus algab. Õli pehmendab karva, palsam hoiab kuju, seep peseb ega kuivata habemealust nahka.', 'Oil, balm and soap — everything beard care starts with. The oil softens, the balm holds the shape, the soap cleans without drying the skin underneath.', '[{"productId":"proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml","variant":0,"qty":1},{"productId":"proraso-wood-spice-beard-balm-100ml","variant":0,"qty":1},{"productId":"handmade-soap-666","variant":0,"qty":1}]'::jsonb, 34.90, 10),
  ('shave-smooth', 'beard', 'Гладкое бритьё', 'Sile raseerimine', 'Smooth shave', 'Масло до бритья, мягкий гель и успокаивающий бальзам после. Три шага, после которых кожа не горит и не краснеет.', 'Õli enne raseerimist, pehme geel ja rahustav palsam pärast. Kolm sammu, mille järel nahk ei kipitse ega punetu.', 'Pre-shave oil, a soft gel and a soothing balm after. Three steps that leave the skin calm instead of burning.', '[{"productId":"davines-pre-shaving-beard-oil","variant":0,"qty":1},{"productId":"davines-softening-shaving-gel","variant":0,"qty":1},{"productId":"proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml","variant":0,"qty":1}]'::jsonb, 51.90, 20),
  ('tattoo-care', 'body', 'Уход за татуировкой', 'Tätoveeringu hooldus', 'Tattoo aftercare', 'Пенка для мытья, бальзам и крем Yumain — то, чем закрывают свежую работу первые две недели. Мастера студии дают тот же список.', 'Pesuvaht, palsam ja kreem Yumainilt — sellega hoolitsetakse värske töö eest esimesed kaks nädalat. Stuudio meistrid annavad sama nimekirja.', 'Washing foam, balm and cream by Yumain — what a fresh piece needs for its first two weeks. The same list our artists hand out.', '[{"productId":"yumain-aftercare-washing-foam-expert-care-for-your-tattoos","variant":0,"qty":1},{"productId":"yumain-tattoo-balm-the-ultimate-care-for-your-tattoos","variant":0,"qty":1},{"productId":"yumain-tattoo-cream","variant":0,"qty":1}]'::jsonb, 27.90, 30),
  ('styling-duo', 'styling', 'Стайлинг — паста и спрей', 'Viimistlus — pasta ja sprei', 'Styling duo — paste and spray', 'Паста Night.Rider даёт форму, спрей SESSION.SPRAY её держит. Пара, которую в салоне собирают чаще всего.', 'Pasta Night.Rider annab kuju, sprei SESSION.SPRAY hoiab seda. Paar, mida salongis kõige sagedamini kokku pannakse.', 'Night.Rider paste gives the shape, SESSION.SPRAY holds it. The pairing the salon reaches for most often.', '[{"productId":"night-rider","variant":0,"qty":1},{"productId":"kevin-murphy-session-spray","variant":1,"qty":1}]'::jsonb, 24.90, 40),
  ('gift-rempire', 'body', 'Подарочный набор Rempire', 'Rempire kinkekomplekt', 'Rempire gift set', 'Два мыла нашей собственной варки и масло для бороды — готовый подарок тому, кто следит за собой.', 'Kaks meie enda keedetud seepi ja habemeõli — valmis kingitus sellele, kes enda eest hoolitseb.', 'Two of our own handmade soaps and a beard oil — a ready gift for someone who takes care of themselves.', '[{"productId":"handmade-soap-666","variant":0,"qty":1},{"productId":"handmade-soap-rule-nr-1","variant":0,"qty":1},{"productId":"proraso-beard-oil-azur-lime-30ml","variant":0,"qty":1}]'::jsonb, 28.90, 50),
  ('hair-young-again', 'hair', 'Kevin.Murphy YOUNG.AGAIN — уход целиком', 'Kevin.Murphy YOUNG.AGAIN — täielik hooldus', 'Kevin.Murphy YOUNG.AGAIN — the full routine', 'Шампунь, кондиционер и масло одной линии. Для длинных и повреждённых волос — в салоне их ставят вместе.', 'Ühe seeria šampoon, palsam ja õli. Pikkadele ja kahjustatud juustele — salongis pannakse need kokku.', 'Shampoo, conditioner and oil from one line. For long and damaged hair — the salon uses them together.', '[{"productId":"kevin-murphy-young-again-wash","variant":1,"qty":1},{"productId":"kevin-murphy-young-again-rinse","variant":1,"qty":1},{"productId":"kevin-murphy-young-again-oil","variant":0,"qty":1}]'::jsonb, 39.90, 60),
  ('face-basic', 'face', 'Лицо — три шага', 'Nägu — kolm sammu', 'Face — three steps', 'Гидрофильное масло смывает день, крем восстанавливает, солнцезащитный закрывает утро. Базовый корейский уход без лишнего.', 'Hüdrofiilne õli peseb päeva maha, kreem taastab, päikesekaitse lõpetab hommiku. Korea baashooldus ilma liigseta.', 'The cleansing oil takes the day off, the cream repairs, the SPF finishes the morning. A Korean basic routine, nothing extra.', '[{"productId":"anua-heartleaf-pore-control-cleansing-oil","variant":0,"qty":1},{"productId":"cosrx-advanced-snail-92-all-in-one-cream","variant":0,"qty":1},{"productId":"cosrx-aloe-sun-cream","variant":0,"qty":1}]'::jsonb, 53.90, 70),
  ('barberism', 'beard', 'Captain Fawcett Barberism — борода и усы', 'Captain Fawcett Barberism — habe ja vuntsid', 'Captain Fawcett Barberism — beard and moustache', 'Масло, бальзам и воск для усов из линии Barberism — один аромат на всю бороду, ничего не спорит между собой.', 'Õli, palsam ja vuntsivaha Barberismi seeriast — üks lõhn kogu habemele, miski ei lähe omavahel tülli.', 'Oil, balm and moustache wax from the Barberism line — one scent across the whole beard, nothing clashing.', '[{"productId":"captain-fawcett-barberism-beard-oil","variant":0,"qty":1},{"productId":"captain-fawcett-sid-sottung-barberism-beard-balm","variant":0,"qty":1},{"productId":"captain-fawcett-barberism-moustache-wax","variant":0,"qty":1}]'::jsonb, 49.90, 80)

on conflict (id) do nothing;
