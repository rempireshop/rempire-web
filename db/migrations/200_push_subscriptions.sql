-- 200_push_subscriptions.sql — «уведомление на телефон» (migration range 200–209)
--
-- Renat, 20.09.2026, through Dim: «Notifications about order on the phone,
-- through app would be nice — apple and android.» Decided: Web Push from the
-- «Админка» he already keeps on his Home Screen, not a pair of native apps.
-- Telegram and the owner's e-mail (src/lib/notify.ts) stay exactly as they
-- are — this is a third channel beside them, never a replacement, because it
-- is the one that can be revoked by a phone setting nobody remembers changing.
--
-- ONE ADMIN, MANY ROWS. This shop has exactly one administrator (src/lib/auth.ts
-- — one password, one cookie, no user table), and that is precisely why there
-- is no owner column here: every row in this table belongs to him. What it has
-- instead is several rows — his iPhone, his Android, the Mac on the counter —
-- because a Web Push subscription is minted per browser profile, not per
-- person. Anything that sends therefore fans out over every live row; anything
-- that counts «is it on?» counts rows, not a boolean.
--
-- THE ENDPOINT IS THE KEY, and it is the browser's own idea of the identity of
-- this subscription: a URL at Apple's or Google's push service which the
-- browser hands back unchanged when the same profile subscribes again. Keying
-- on it is what makes «turn notifications on» idempotent — a second tap of the
-- button, a reinstall that restores the same subscription, or the panel
-- re-registering on boot all land on the same row rather than making Renat
-- four copies of every order.
--
-- p256dh and auth are the halves of the payload's encryption key. They are
-- useless without the shop's VAPID private key (VAPID_PRIVATE_KEY, held in the
-- environment and never here), and useless on their own for reaching the
-- phone: the push service refuses a request this shop has not signed. They are
-- stored raw, base64url as the browser produced them, because web-push wants
-- them in exactly that shape.
--
-- `label` is for the owner, not for the code. «iPhone Renat», «Samsung» — the
-- panel's device list is the only place a person can tell two 300-character
-- endpoint URLs apart, and without it turning ONE device off means guessing.
-- Nothing keys on it and it may repeat.
--
-- RETIRED, NOT DELETED. A push service answers 404 or 410 for a subscription
-- that is gone for good — the app was removed from the Home Screen, the
-- browser profile was wiped, the permission was revoked. That row must stop
-- being sent to, or every order from then on spends a request proving the same
-- thing again, for ever. It is stamped rather than deleted for two reasons:
-- a row that vanished cannot tell anybody WHY the phone went quiet, which is
-- the first question Renat will ask; and the same endpoint coming back (he
-- adds the panel to the Home Screen again) has to be recognised as the device
-- it is, which the upsert in src/lib/push.ts does by clearing the stamp.
--
-- `last_ok_at` is the answer to «is this thing actually working?». A
-- subscription the push service keeps accepting while the phone shows nothing
-- is a real state — notifications muted in iOS, a Focus mode, a battery saver
-- — and nothing in this table can see it. What it CAN show is the last time
-- the shop's own send was accepted, which separates «we never sent» from «we
-- sent and it was taken», and that is the half of the question the server is
-- entitled to answer.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

create table if not exists push_subscriptions (
  -- The push service's URL for this device. Bounded because it arrives in a
  -- request body and a request body is whatever the caller felt like sending;
  -- the real ones are 100–500 characters (Apple's and Google's both).
  endpoint      text primary key check (length(endpoint) between 20 and 2000),
  -- The subscription's public key and auth secret, base64url, exactly as
  -- PushSubscription.getKey() handed them over.
  p256dh        text not null check (length(p256dh) between 1 and 255),
  auth          text not null check (length(auth) between 1 and 255),
  -- The owner's own name for the device. Never a key, may repeat, may be ''.
  label         text not null default '' check (length(label) <= 100),
  created_at    timestamptz not null default now(),
  -- The last time a push to this endpoint was ACCEPTED by the push service.
  -- Null until the first one is.
  last_ok_at    timestamptz,
  -- Set when the push service said the subscription is gone (404/410), or
  -- when the owner turned this device off from the panel. Null means live.
  retired_at    timestamptz,
  -- Why, in one word: 'gone' (the push service), 'owner' (the button).
  retired_reason text
);

-- The one question the sender asks on every paid order: which devices are
-- live. Partial, because the retired rows are exactly the ones it must never
-- read and there is no point carrying them in the index.
create index if not exists push_subscriptions_live_idx
  on push_subscriptions (created_at) where retired_at is null;
