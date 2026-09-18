-- 194_one_size_stock_rows.sql — the 29 one-size products keep ONE shelf row
-- (migration range 190–199)
--
-- WHAT WENT WRONG.
--
-- tools/build-catalogue-variants.mjs was written as a *price* table and
-- skipped any product with fewer than two rungs: "67 of the 220 products are
-- sold in several sizes at very different prices". Since then
-- src/data/catalogue.variants.json has quietly become the server's size
-- LADDER of record — catalogueUniverse() in src/lib/inventory.ts builds
-- «Склад» out of it, variantOf() in src/lib/orders.ts prices and validates an
-- order line against it — and twenty-nine curated products are sold in
-- exactly ONE named size. Touchable is «250 мл»; its product page has always
-- printed «Размеры · 250 мл · 27 €». The skip told the server all twenty-nine
-- had no sizes at all.
--
-- So the two halves of the shop wrote their counts under two different keys
-- for the same bottle:
--
--   · the panel binds barcodes and writes counts against the BROWSER's label
--     (public/shop/catalogue2.js → `p.sizes`), so a scan or a «Остаток» on
--     «Склад» lands on ('touchable', '250 мл');
--   · the shelf universe, the stock seeder (tools/seed-stock.mjs) and a web
--     sale all went through the server's ladder, which had no rung to name,
--     so they land on ('touchable', '').
--
-- «Склад» drew both — one empty «один объём» row from the universe and the
-- real one under the label, carried only by the orphan-row rescue in
-- getLevels() — which is where the 351 rows for 322 barcodes came from. And
-- stockStates()'s rule that a whole ladder must be counted before the shop
-- may say «нет в наличии» was being computed against a ladder the shop does
-- not have.
--
-- The generator is fixed and the file now carries all 96 ladders, so from
-- here on both halves key on the label. This migration is for what the two of
-- them already wrote.
--
-- WHAT IT DOES, AND WHY THAT ARITHMETIC.
--
-- Everything the '' row holds moves onto the labelled one. The qtys are
-- ADDED, not replaced: 090_inventory.sql's own words are that
-- «stock_levels.qty is always the sum of every delta ever applied to that
-- (product_id, variant)», and the two rows are the sums of two disjoint sets
-- of moves for one physical product — the panel's counts on one side, the
-- seeder's zero and the web's sales on the other. Their sum is the sum of all
-- of them, which is what the one surviving row has to be. Where there is no
-- labelled row the '' row simply becomes it, count, threshold, barcode and
-- all.
--
-- stock_moves is re-keyed with it. The ledger is what explains the count, and
-- trackedKeys() reads it to decide whether a row is «учитывается» at all — a
-- history left behind under '' would leave a row that has been sold from
-- reading as never counted.
--
-- THE BARCODE, WHERE BOTH ROWS HAVE ONE.
--
-- stock_levels_ean_idx (090_inventory.sql) is unique over the non-null eans,
-- so the two rows cannot be carrying the SAME code — the second binding would
-- already have been refused. Two DIFFERENT codes for one bottle is a genuine
-- ambiguity that no migration can resolve, and the labelled row's wins: that
-- is the one Renat bound by scanning the goods in front of him, while the ''
-- row's is whatever tools/seed-stock.mjs read out of tools/harvest. The
-- losing code is unbound, not reassigned, and re-scanning the bottle binds it
-- again in one move. In every other case — one row has a code, or neither
-- does — nothing is lost.
--
-- WHAT IT LEAVES ALONE.
--
-- A product the owner has given a size ladder of his own in «Товары →
-- Размеры и цены» (product_overrides.sizes, 147_override_sizes_hidden.sql).
-- knownLadder() reads that ladder FIRST and always has, so the universe key
-- for such a product was his rung before this change and is his rung after
-- it: there is nothing to move, and moving it would be this migration
-- inventing a rung he did not type.
--
-- A no-op on a shop where the panel never wrote a labelled row and the '' row
-- never existed, which is most of them — every statement below is driven by
-- rows that are actually there.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

-- ---------- the twenty-nine, and their one rung -----------------------------

-- A real temporary table rather than a `values` list repeated in four
-- statements: the list IS the migration's claim about the world, and it
-- should be written down once where it can be read. Dropped explicitly at the
-- end — `on commit drop` would depend on how the runner batches this file
-- (tools/migrate.mjs sends it as one multi-statement query), and this does
-- not need to.
drop table if exists _m194_one_rung;
create temporary table _m194_one_rung (
  product_id text primary key,
  size       text not null
);

insert into _m194_one_rung (product_id, size) values
    ('touchable'                                                    , '250 мл'),
    ('kevin-murphy-motion-lotion'                                   , '150 мл'),
    ('kevin-murphy-killer-twirls'                                   , '150 мл'),
    ('easy-rider'                                                   , '100 г'),
    ('gatsby-moving-rubber-wild-shake-15g'                          , '80 г'),
    ('killer-curls'                                                 , '200 мл'),
    ('super-goo'                                                    , '100 г'),
    ('paul-mitchell-mitch-construction-paste-flexible-styling-paste', '75 мл'),
    ('paul-mitchell-super-skinny-serum'                             , '150 мл'),
    ('paul-mitchell-clear-styling-glaze'                            , '150 мл'),
    ('paul-mitchell-mitch-steady-grip-styling-gel'                  , '150 мл'),
    ('powder-puff'                                                  , '14 г'),
    ('kevin-murphy-full-again'                                      , '150 мл'),
    ('hair-resort'                                                  , '150 мл'),
    ('davines-pasta-love-strong-hold-mat-clay'                      , '50 мл'),
    ('captain-fawcett-beard-oil-cf-332-private-stock'               , '10 мл'),
    ('davines-pre-shaving-beard-oil'                                , '50 мл'),
    ('davines-softening-shaving-gel'                                , '200 мл'),
    ('davines-non-foaming-transparent-shaving-gel'                  , '150 мл'),
    ('davines-medium-hold-styling-paste'                            , '125 мл'),
    ('cosrx-advanced-snail-92-all-in-one-cream'                     , '100 г'),
    ('cosrx-advanced-snail-96-mucin-power-essence'                  , '100 мл'),
    ('lumin-skin-recovery-oil'                                      , '8 мл'),
    ('lumin-skin-wrinkle-defense-serum'                             , '15 мл'),
    ('lumin-skin-charcoal-scrub-deep-detox'                         , '30 мл'),
    ('lumin-skin-charcoal-face-wash-daily-detox'                    , '100 мл'),
    ('lumin-skin-dark-circle-defense-balm'                          , '20 мл'),
    ('anua-heartleaf-77-soothing-toner'                             , '40 мл'),
    ('davines-hair-beard-body-wash'                                 , '300 мл');

-- The owner's own ladder outranks the file's and always did — see «WHAT IT
-- LEAVES ALONE» above. Such a product is taken off the list rather than
-- guarded four times below.
delete from _m194_one_rung r
 using product_overrides o
 where o.product_id = r.product_id
   and o.sizes is not null
   and jsonb_typeof(o.sizes) = 'array'
   and jsonb_array_length(o.sizes) > 0;

-- ---------- the '' row, carried across ---------------------------------------

-- Saved before it is deleted, because the barcode has to outlive it: the
-- unique index refuses a code that is on two rows at once, so the '' row must
-- be gone before the labelled one may take it.
drop table if exists _m194_carried;
create temporary table _m194_carried as
  select l.product_id, r.size, l.qty, l.low_threshold, l.ean
    from stock_levels l
    join _m194_one_rung r on r.product_id = l.product_id
   where l.variant = '';

delete from stock_levels l
 using _m194_one_rung r
 where r.product_id = l.product_id
   and l.variant = '';

-- Where the panel had already written a labelled row: fold the count in, and
-- take the barcode only if that row has none of its own.
update stock_levels l
   set qty        = l.qty + c.qty,
       ean        = coalesce(l.ean, c.ean),
       updated_at = now()
  from _m194_carried c
 where l.product_id = c.product_id
   and l.variant    = c.size;

-- Where it had not: the '' row simply becomes the labelled one, unchanged.
insert into stock_levels (product_id, variant, qty, low_threshold, ean, updated_at)
select c.product_id, c.size, c.qty, c.low_threshold, c.ean, now()
  from _m194_carried c
 where not exists (
   select 1 from stock_levels l
    where l.product_id = c.product_id and l.variant = c.size
 );

-- ---------- and the ledger that explains the count ---------------------------

update stock_moves m
   set variant = r.size
  from _m194_one_rung r
 where r.product_id = m.product_id
   and m.variant    = '';

drop table _m194_carried;
drop table _m194_one_rung;
