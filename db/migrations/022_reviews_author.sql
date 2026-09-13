-- 022_reviews_author.sql — features agent (migration range 020–029)
--
-- Who wrote the review, as opposed to what they called themselves.
--
-- Dim, 13.09.2026: «dim.novare@gmail.com and info@diipsolutions.eu seem to be
-- able to see same reviews». Two of his own mailboxes, one display name on
-- both — and the customer card matched a review to a person by that name
-- (reviewsByAuthor in src/lib/reviews.ts), so each card showed the other's
-- reviews, and a stranger who signs «Дмитрий» landed on every Дмитрий's card.
--
-- `email` is the author's proven address: the shop writes it only from the
-- signed `rmp_cust` session cookie the shopper already holds (src/lib/
-- customers.ts), never from anything the review form sent. A review left
-- signed out keeps it null and belongs to nobody — it stays in «Отзывы», the
-- moderation queue, where every review is, and appears on no customer's card.
--
-- Nothing is back-filled. Every review written before this migration has only
-- a name on it, and a name is exactly what turned out not to identify anyone:
-- guessing those rows into a customer would re-create the leak by hand. They
-- keep email null on purpose.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

alter table reviews add column if not exists email text;

-- The customer card reads one address's reviews, newest first.
create index if not exists reviews_email_idx on reviews (email, created_at desc);
