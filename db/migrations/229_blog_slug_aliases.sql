-- 229_blog_slug_aliases.sql — an article's old addresses (migration range 220–229).
--
-- 09.11.2026, Search Console «Не найдено (404)»: an article whose slug was
-- changed after it went live left its old address answering 404, while
-- Google kept ranking it. /ru/blogs/news/system-4-shampoo-guide was the
-- blog's best address (position 3.8, 10 clicks in three months) and opened
-- «страница не найдена» — the article had moved to
-- shampuni-system-4-o1-o2-o3-o4-kakoy-vybrat-i-kak-uhazhivat-za-kozhey-golovy.
--
--   slug     an address the article no longer has
--   post_id  the article it belongs to — by id, not by its current slug, so a
--            second rename still lands on the article in one hop. No foreign
--            key: `truncate posts` (the test suite, tools/go-live-reset.mjs)
--            must keep working, and a row whose article is gone joins to
--            nothing, so its address answers 404 as before.
--
-- Filled by upsertPost() (src/lib/blog.ts) whenever a slug that was ever
-- published changes; read by blogPostPageResponse() (src/lib/blog-page.ts),
-- which answers 301 to the article's current address in the same language.
-- A slug here stays taken, like a deleted article's: a new article with the
-- same title becomes «…-2» and never inherits another article's Google rank.
--
-- The rows below are the addresses Search Console still showed on
-- 09.11.2026. Two are the sample articles of 071_blog_samples.sql, deleted
-- at go-live — each now goes to the live article on the same subject. A
-- target that is not in this database (the test suite, a fresh install)
-- inserts nothing.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never
-- runs twice and must never be edited once it has run anywhere. Runs on
-- Postgres 13+ and on PGlite (the test suite).

create table if not exists post_slug_aliases (
  slug        text primary key,
  post_id     uuid not null,
  created_at  timestamptz not null default now()
);

create index if not exists post_slug_aliases_post_idx on post_slug_aliases (post_id);

insert into post_slug_aliases (slug, post_id)
select a.old_slug, p.id
from (values
  ('system-4-shampoo-guide', 'shampuni-system-4-o1-o2-o3-o4-kakoy-vybrat-i-kak-uhazhivat-za-kozhey-golovy'),
  ('aha-bha-toner', 'aha-bha-toner-cosrx-ili-anua-kak-vybrat-i-polzovatsya'),
  ('vse-tovary-my-zakupaem-u-ofitsialnyh-distribyutorov-i-sami-rabotaem-s-nimi-v-stu',
   'studiya-rempire-zhivye-mastera-i-originalnaya-kosmetika-iz-ofitsialnyh-postavok'),
  ('uhod-za-borodoy-zimoy', 'maslo-dlya-borody-i-sredstva-posle-britya-kak-vybrat-proraso-i-captain-fawcett'),
  ('kak-vybrat-shampun-po-tipu-kozhi-golovy', 'shampuni-system-4-o1-o2-o3-o4-kakoy-vybrat-i-kak-uhazhivat-za-kozhey-golovy')
) as a(old_slug, new_slug)
join posts p on p.slug = a.new_slug and p.deleted_at is null
on conflict (slug) do nothing;
