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
 * the location is a decision and not a detail. Since 08.10.2026 the panel is
 * at /admin (it was /shop2/admin/), while this file stays where every asset
 * stayed, /shop2/admin-sw.js. Its scope, `{ scope: "/admin" }`, is therefore
 * OUTSIDE its own folder, which a browser allows only when the script is
 * served with `Service-Worker-Allowed: /admin` — next.config.ts sends exactly
 * that, for this one file. "/admin" without a slash, because the panel's
 * address has none and a scope is the start of an address; it covers the
 * scanner at /admin/scan too, which is harmless (there is no fetch handler).
 * That scope is the panel — `scope` and `start_url` in
 * public/shop2/admin.webmanifest, the «Админка» Renat has on his Home Screen,
 * and the only address pathFor() in app.js ever pushes for the admin screen.
 * A registration left at the old /shop2/admin/ scope is unsubscribed and
 * removed by the panel itself (pushRetireOld() in app.js), or the phone would
 * get every notice twice.
 *
 * The obvious alternative — a public/admin/ folder for this file — was not
 * taken: it would put a real directory at /admin, the one URL the owner
 * opens twenty times a day, which reaches the panel only because NOTHING is
 * on disk there and the catch-all route hands it the shell.
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

var PANEL = "/admin";
var ICON = "/shop2/icons/icon-192.png";
/* NOT the same file as ICON. Android draws the badge — the little mark in the
   status bar — from the ALPHA CHANNEL alone: it silhouettes what it is given
   and tints the result. An app icon is opaque across the whole square, so its
   silhouette is the square, and Renat's first push showed a white block that
   only became a tower when he opened it (21.09.2026). badge-96.png is the
   tower on nothing, which is the only shape that survives that treatment. */
var BADGE = "/shop2/icons/badge-96.png";

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
    badge: BADGE,
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

/* How long an open panel has to say «понял» before it is reloaded instead. */
var ASK_MS = 1500;

/**
 * Hand the tapped address to a panel that is already open, and answer
 * whether it took it. The panel (app.js, pushOpenFrom) opens the order card in
 * place and replies on the port; a tab still running code from before this
 * existed never replies, and the timer answers false for it.
 */
function tell(client, href) {
  return new Promise(function (resolve) {
    var done = false;
    function end(v) {
      if (done) return;
      done = true;
      resolve(v);
    }
    try {
      var ch = new MessageChannel();
      ch.port1.onmessage = function (e) {
        end(!!(e.data && e.data.ok));
      };
      client.postMessage({ type: "rempire:open", url: href }, [ch.port2]);
    } catch (e) {
      end(false);
      return;
    }
    setTimeout(function () {
      end(false);
    }, ASK_MS);
  });
}

/**
 * He tapped it.
 *
 * Focus the panel he already has open before opening a second one — on a
 * phone a duplicate window is confusing, and on the counter Mac it would lose
 * whatever he was in the middle of. `includeUncontrolled` catches a tab that
 * was loaded before this worker took over.
 *
 * Dim, 24.09.2026: «When I click on the phone notification of a completed
 * order, then it should bring me to that order — currently it just logs me in
 * to admin». An open panel used to be navigate()d — a reload that loses a
 * half-typed note — and on iOS, which has no navigate(), merely focused on
 * whatever screen it was left on. Now it is focused first (while the tap still
 * allows it) and told the address; only a panel that does not answer is
 * reloaded onto it. A closed panel opens on the address itself, and the panel
 * opens the card once its order list is in (app.js pushOpenWanted).
 */
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || PANEL;
  var target = new URL(url, self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i++) {
        var client = windows[i];
        /* The panel itself — /admin, with or without its query — and not the
           scanner at /admin/scan, which the same scope also covers. */
        var at;
        try {
          at = new URL(client.url);
        } catch (e) {
          continue;
        }
        if (at.origin !== target.origin || at.pathname !== PANEL) continue;
        return Promise.resolve(client.focus ? client.focus() : client)
          .catch(function () {
            return client;
          })
          .then(function () {
            return tell(client, target.href);
          })
          .then(function (heard) {
            if (heard || !client.navigate) return;
            return client.navigate(target.href).catch(function () {});
          });
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
