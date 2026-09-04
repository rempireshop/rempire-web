-- 131_custom_products.sql — product creation (migration range 130–139)
--
-- The owner's own products. The catalogue proper is a file
-- (src/data/catalogue.min.json + catalogue.variants.json, served to the shop
-- as /shop/catalogue2.js) and no admin route writes it; this table is what
-- «+ Товар» in the panel and the assistant's create_product write instead.
-- GET /api/overrides answers with the active rows in the catalogue's own
-- product shape (`custom: [...]`) and public/shop2/app.js merges them into
-- CATALOGUE at boot, so a row here is a product everywhere the shop looks —
-- category, search, brand page, product page, cart, checkout.
--
-- id: `c-<slug>`, made from brand + name (src/lib/custom-products.ts), the
--     prefix so the panel can tell a row from a catalogue product by the id
--     alone. product_overrides keys on it like on any other id, so a price
--     or stock override written by the assistant lands on top of the row.
-- sizes / prices: aligned lists — ["75 мл","250 мл"] / [9, 16]. A product
--     with one price has sizes [] and prices [p].
-- description / seo: the same {RU,ET,EN} shapes product_overrides carries
--     (src/lib/product-descriptions.ts, src/lib/product-seo.ts).
-- gallery: [{url, thumb, alt}] — the photos uploaded through
--     POST /api/admin/upload, same shape as product_overrides.gallery.
-- active: false is «снято с продажи» — the row stays (the journal's undo
--     puts it back), the feed leaves it out, the checkout refuses it.
create table if not exists custom_products (
  id          text primary key,
  brand       text not null,
  name        text not null,
  cat         text not null,
  subcat      text,
  sizes       jsonb not null default '[]'::jsonb,
  prices      jsonb not null default '[]'::jsonb,
  description jsonb,
  gallery     jsonb,
  seo         jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists custom_products_active_idx on custom_products (active, created_at desc);
