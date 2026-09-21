/**
 * The admin panel's service worker — the first one this repository has.
 *
 * It exists for one reason: a Web Push message is delivered to a service
 * worker, never to a page, so «новый заказ» on Renat's phone is impossible
 * without one (Renat, 20.09.2026, through Dim). src/lib/push.ts sends,
 * db/migrations/200_push_subscriptions.sql remembers the devices, and this
 * file is the half that runs on the phone.
 *
 * ---- where this file lives, and why it is not in an admin/ folder ---------
 *
 * A worker may only control pages at or below the path it is SERVED from, so
 * the location is a decision and not a detail. Served from /shop2/, this file
 * could control the whole shop; it is registered with an explicit
 * `{ scope: "/shop2/admin/" }` instead, which is narrower than its own path
 * and therefore needs no `Service-Worker-Allowed` header from next.config.ts.
 * That scope is exactly the panel — it is `scope` and `start_url` in
 * public/shop2/admin.webmanifest, the «Админка» Renat has on his Home Screen,
 * and the only address pathFor() in app.js ever pushes for the admin screen.
 *
 * The obvious alternative — public/shop2/admin/sw.js, which would get that
 * scope by default — was not taken. It would put a real directory at
 * /shop2/admin/, the one URL the owner opens twenty times a day, and that URL
 * reaches the panel today only because NOTHING is on disk there and the
 * fallback rewrite in next.config.ts hands it the shell. A storefront is not
 * the place to find out whether Vercel's static layer agrees.
 *
 * ---- what it deliberately does NOT do ------------------------------------
 *
 * There is no `fetch` handler, and that is the point. A worker that caches
 * would serve yesterday's app.js from an address that looks current — the
 * exact failure this repository already paid for once and answered with a
 * content-derived ?v= token (tools/lib/asset-token.mjs, 06.09.2026). This one
 * sees no requests at all.
 *
 * There is no `pushsubscriptionchange` handler either. A browser may rotate a
 * subscription, and re-subscribing from in here would need the VAPID public
 * key, which this file does not have and could only get with the admin cookie
 * from a worker that may be running hours after the panel was last open. The
 * panel re-subscribes on every boot instead and POSTs the result; the endpoint
 * is the key, so doing that a hundred times leaves one row
 * (src/lib/push.ts saveSubscription). A rotation is repaired the next time
 * Renat opens the panel, which is the same morning he would have noticed.
 */

/* Take over at once rather than waiting for every panel tab to be closed.
   The owner keeps the panel open on the counter Mac for a whole day: without
   these two, a fixed worker would sit in `waiting` until he remembered to
   close it, and the FIRST registration would not control the page it was
   registered from at all. */
self.addEventListener("install", function (event) {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

var PANEL = "/shop2/admin/";
var ICON = "/shop2/icons/icon-192.png";

/**
 * A push arrived.
 *
 * iOS will not deliver a second one if this handler fails to show a
 * notification, so every branch below ends in showNotification() — including
 * the one where the payload is unreadable. A line saying «новый заказ» that
 * Renat has to open the panel to understand is worth more than silence and a
 * subscription the phone has quietly dropped.
 */
self.addEventListener("push", function (event) {
  var msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch (e) {
    /* Not ours, or truncated. Fall through to the defaults below. */
  }

  var title = msg.title || "REMPIRE";
  var options = {
    body: msg.body || "Новое событие в магазине",
    icon: ICON,
    badge: ICON,
    /* One line per order, not per delivery attempt: a second push carrying the
       same tag replaces the first in the shade instead of stacking beside it.
       src/lib/push.ts gives every order its own tag. */
    tag: msg.tag || "rempire",
    renotify: !!msg.tag,
    /* The tap target travels in `data` because that is the only field that
       survives into the notificationclick event below. */
    data: { url: msg.url || PANEL },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * He tapped it.
 *
 * Focus the panel he already has open before opening a second one — on a
 * phone a duplicate window is confusing, and on the counter Mac it would lose
 * whatever he was in the middle of. `includeUncontrolled` catches a tab that
 * was loaded before this worker took over.
 */
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || PANEL;
  var target = new URL(url, self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i++) {
        var client = windows[i];
        if (client.url.indexOf(target.origin + PANEL) !== 0) continue;
        /* Same panel, different order: move it before focusing, so the card he
           was sent to is what he sees. navigate() is not implemented
           everywhere (iOS), hence the fallback to a plain focus — he is then
           on the panel, one tap from the order. */
        return (client.navigate ? client.navigate(target.href).catch(function () { return client; }) : Promise.resolve(client))
          .then(function (c) {
            return (c || client).focus();
          });
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
