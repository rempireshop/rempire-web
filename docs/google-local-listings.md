# Google free local listings: «in stock at the salon»

The shop's stock sits on the shelf of the salon at **Mardi 1, Tallinn**, which
is also the checkout's pickup point. Google can show that on Maps and in local
search («In stock · Rempire, Mardi 1»), at no cost. These are **free local
listings**, and they need two things the shop did not have before:

1. the salon's **Google Business Profile** linked to Merchant Center
   **5819586565** (done 02.11.2026: Renat approved the link);
2. a **local inventory feed**: one line per product size, saying which store
   has it and whether it is on the shelf.

The feed is **built and switched off**. This page says how to switch it on.
Where it says **(check the wording)**, the Merchant Center or Business Profile
button may be named a little differently. Google renames things often, so look
for the nearest match.

---

## What was built

| | |
|---|---|
| Address | `https://rempireshop.com/feed/google-local.xml` |
| Switch | the setting `gbp_store_code`, which holds the salon's store code |
| While the setting is empty | the address answers **404**, so Google fetches nothing |
| Code | `src/lib/local-inventory.ts`, `src/app/feed/[file]/route.ts` |
| Tests | `tests/local-inventory-feed.test.ts` |

Each line of the feed carries:

- `store_code`: the salon's code, exactly as stored;
- `id`: the **same id as the product feeds** (`google-en.xml`,
  `google-ru.xml`), one per size, plus the sets (`set-…`). Google joins the
  two feeds on this id;
- `availability`: `in_stock` or `out_of_stock`, **the same answer as the
  product feed**. It comes from the counted shelf in «Склад», a manual «нет в
  наличии», and a size counted to zero. The online shop and the salon sell
  from one shelf, so there is no second stock number;
- `price`: the shop's price, VAT included;
- `pickup_method` = `buy` and `pickup_sla` = `same day`. The checkout sells
  the item online, and the customer collects it at Mardi 1. That is what the
  shipping page promises: «we write when the order is ready, usually on the day
  of payment».

Hidden products, switched-off products and products without a photo are
missing here, just as they are missing from the product feed. The feed is
cached for one hour, like the product feeds.

---

## What Dim does, in order

### 1. The Business Profile (Renat or Dim)

1. Make sure the salon **has** a Google Business Profile at Mardi 1, 10145
   Tallinn, and that it is **verified**. Without verification nothing below
   works.
2. Give the profile a **store code**. In Google Search, the profile's panel
   «Ваша компания в Google» → the **⋮** right of «Качество профиля» →
   **Настройки профиля компании** → **Расширенные настройки** → **Код
   магазина** ✏️ → Save (English: ⋮ → Business Profile settings → Advanced
   settings → Shop code). It is **not** under «Изменить профиль» — that
   editor has no such field. On a laptop the panel's photo can cover the ⋮.
   Google may already have given the profile a long numeric code; then use
   that one. The code can be any short text. Write it down **exactly**:
   Google compares it letter for letter, and upper and lower case count.
   **Done 03.11.2026: Renat set `MARDI1`** (the field was empty).

### 2. Link the profile to Merchant Center

1. Merchant Center 5819586565 → the cogwheel → **Business info** →
   **Stores**, or **Apps and services** → **Business Profile** → **Link**
   (check the wording). Choose the salon's profile or its business group.
2. The salon should now show under **Stores**, with the same store code.
3. **Wait about 24 hours.** Google asks for this after a new link or a
   changed store code, before the first inventory is sent.

### 3. Switch the feed on in the shop

Store the code in the shop's settings, exactly as it shows in the profile.
There is no field in the panel for it. You set it once, in one of two ways:

- **From a signed-in admin tab** (`rempireshop.com/admin`): open the browser
  console and run

  ```js
  await fetch("/api/admin/settings/", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gbp_store_code: "RMP-MARDI1" }),
  }).then((r) => r.json());
  ```

  It answers `{ ok: true, … }`, and the change shows in the panel's journal.

- **Or in the database:**

  ```sql
  insert into settings (key, value, updated_at) values ('gbp_store_code', '"RMP-MARDI1"'::jsonb, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  ```

Then open `https://rempireshop.com/feed/google-local.xml`. It should now be a
list rather than a 404, and every line should carry your store code.

To switch the feed **off** again, store an empty code (`""`).

### 4. Add the feed to Merchant Center

1. Merchant Center → the cogwheel → **Data sources** → **Add product source**
   → **Add local product inventory**. It can also appear under
   **Supplemental sources** (check the wording).
2. Choose **Add products from a file** → **Enter a link to your file**
   (scheduled fetch).
3. Paste `https://rempireshop.com/feed/google-local.xml`.
4. Fetch **daily**, time zone **Europe/Tallinn**, at an hour after the
   morning stock work. The feed itself is at most one hour old.
5. If Merchant Center asks for a **country, language or feed label**, pick
   the ones of the product feed it belongs to: **Estonia**, English, feed
   label **REMPIRE-EN**. If it offers more than one product source to attach
   to, add the Russian one (**REMPIRE-RU**) too. The ids are the same in
   both.
6. Save, then run **Fetch now** once.

### 5. Turn on free local listings

1. Merchant Center → **Growth** / **Marketing methods** → **Free local
   listings** → **Turn on** (check the wording).
2. In the product sources (**REMPIRE-EN**, **REMPIRE-RU**), make sure the
   destination **Free local listings** is ticked next to **Free listings**.
3. If Google asks for the **store's product page** («local storefront»),
   keep the default, which is Google's own hosted page. The shop's product
   pages show the price and the delivery, but not «in stock at Mardi 1».
4. If Google asks for **in-store pickup**, say yes, free, same day. The feed
   already sends this.
5. Google may ask for **inventory verification**: a person or a video call
   checks that a few products are really on the salon's shelf. Renat answers
   that.

### 6. Check after a day or two

- Merchant Center → **Products** → filter by **Free local listings**. The
  products should show the salon.
- **Diagnostics** → the local inventory source. Typical problems:
  - «Store code not found»: the code in the shop differs from the profile's
    by a letter, a case or a space.
  - «Item not found»: an id in the local feed is not in the product feed.
    That should not happen, because both lists come from the same function.
  - «Missing price»: the feed always sends one, so this would point to a
    changed spec.

---

## Things to know

- **Stock is shared.** When the shop sells the last bottle online, the salon
  shelf is empty too, and the feed says `out_of_stock` within the hour. A
  bottle sold over the counter at the salon only counts if Renat books it in
  «Склад».
- **No quantities are sent.** Google treats `quantity` as optional, and the
  product feed sends availability only too. The «мало» word (one left) still
  reads as `in_stock`.
- **Opening hours** come from the Business Profile, not from the shop. Keep
  them right there, or «Pick up today» will show on a day the salon is closed.
- **A second store** (a new salon) would need its own code and its own lines.
  The feed writes one store today.
