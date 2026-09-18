-- 196_one_volume_ladder_rows.sql — the rows 194 had to leave behind
-- (migration range 190–199)
--
-- WHAT THIS IS ABOUT.
--
-- db/migrations/194_one_size_stock_rows.sql folded the '' shelf row onto the
-- named one for the twenty-nine products sold in a single named volume, so
-- that both halves of the shop would key on the same label. It deliberately
-- skipped any product the owner had given a ladder of his own in «Товары →
-- Размеры и цены» (product_overrides.sizes), on the stated grounds that
-- knownLadder() reads his ladder FIRST and always has, «so their counts were
-- never under '' to begin with».
--
-- That is true of every saved ladder but one. «Один объём» — a single rung
-- with no label, which is what the editor leaves behind when «×» takes the
-- last named row away (public/shop2/app.js) — was read two different ways by
-- the two halves:
--
--   · ladderLabels() in src/lib/inventory.ts answered [""] , so «Склад»
--     offered an unlabelled row and that is where a count landed;
--   · overrideLadder() in src/lib/orders.ts answered null — «that is not a
--     ladder» — so the cart fell through to the catalogue file, whose one
--     rung IS named, and wrote «250 мл» on the line.
--
-- So the shelf said '' and the order said «250 мл» about one bottle. move()
-- found no tracking rows under the name, skipped the paid sale in silence,
-- and the count under '' never moved: a web sale that took nothing off
-- «Склад» and a refund that put nothing back (audit 18.09.2026, F35).
--
-- ladderLabels() now answers null for that shape too, so from here on both
-- halves read the file's rung and there is one key again. This migration is
-- for what the split already wrote.
--
-- WHAT IT DOES.
--
-- Exactly what 194 did, and for the same reason, on exactly the products 194
-- left out: the '' row's count is ADDED to the labelled row (090_inventory.sql
-- — «stock_levels.qty is always the sum of every delta ever applied to that
-- (product_id, variant)», and the two rows are the sums of two disjoint sets
-- of moves for one bottle); where there is no labelled row the '' row simply
-- becomes it; stock_moves is re-keyed with it, because trackedKeys() reads
-- the ledger to decide whether a row is «учитывается» at all; and the
-- labelled row's barcode wins where both have one, the loser being unbound
-- rather than reassigned (stock_levels_ean_idx is unique over the non-null
-- eans, so the two cannot be carrying the same code).
--
-- WHAT IT LEAVES ALONE.
--
-- Every product whose saved ladder names its rungs — his labels were, and
-- remain, the key both halves use. Products outside the twenty-nine: their
-- '' row is the right row and always was. And the saved ladder itself is not
-- touched: «один объём» is what the owner typed, the shop goes on showing the
-- product without a size picker, and the only thing that changed is which
-- shelf row the bottle is counted on.
--
-- A no-op on a shop where nobody saved «один объём» over one of the
-- twenty-nine, which is most of them — every statement below is driven by
-- rows that are actually there.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

-- ---------- the twenty-nine, and their one rung -----------------------------

-- The same list 194 carries, for the same reason it wrote it down rather than
-- repeating a `values` clause four times: the list IS the claim about the
-- world. src/data/catalogue.variants.json is where it comes from — every
-- product whose ladder is exactly one NAMED rung.
drop table if exists _m196_one_rung;
create temporary table _m196_one_rung (
  product_id text primary key,
  size       text not null
);

insert into _m196_one_rung (product_id, size) values
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

-- …narrowed to the ones 194 skipped AND whose saved ladder is «один объём»:
-- one rung, and that rung has no label. A ladder that names its rungs is the
-- owner's own key and stays exactly where it is — nothing here may invent a
-- rung he did not type, or move a count off one he did.
--
-- `->>` rather than `->`: a rung saved as {"size": null} and one saved as
-- {"size": ""} are the same «один объём» to cleanSizes() (src/lib/orders.ts,
-- which normalises a non-string label to ''), and both must be caught.
delete from _m196_one_rung r
 where not exists (
   select 1 from product_overrides o
    where o.product_id = r.product_id
      and o.sizes is not null
      and jsonb_typeof(o.sizes) = 'array'
      and jsonb_array_length(o.sizes) = 1
      and coalesce(trim(o.sizes -> 0 ->> 'size'), '') = ''
 );

-- ---------- the '' row, carried across ---------------------------------------

-- Saved before it is deleted, because the barcode has to outlive it: the
-- unique index refuses a code that is on two rows at once, so the '' row must
-- be gone before the labelled one may take it.
drop table if exists _m196_carried;
create temporary table _m196_carried as
  select l.product_id, r.size, l.qty, l.low_threshold, l.ean
    from stock_levels l
    join _m196_one_rung r on r.product_id = l.product_id
   where l.variant = '';

delete from stock_levels l
 using _m196_one_rung r
 where r.product_id = l.product_id
   and l.variant = '';

update stock_levels l
   set qty        = l.qty + c.qty,
       ean        = coalesce(l.ean, c.ean),
       updated_at = now()
  from _m196_carried c
 where l.product_id = c.product_id
   and l.variant    = c.size;

insert into stock_levels (product_id, variant, qty, low_threshold, ean, updated_at)
select c.product_id, c.size, c.qty, c.low_threshold, c.ean, now()
  from _m196_carried c
 where not exists (
   select 1 from stock_levels l
    where l.product_id = c.product_id and l.variant = c.size
 );

-- ---------- and the ledger that explains the count ---------------------------

update stock_moves m
   set variant = r.size
  from _m196_one_rung r
 where r.product_id = m.product_id
   and m.variant    = '';

drop table _m196_carried;
drop table _m196_one_rung;
