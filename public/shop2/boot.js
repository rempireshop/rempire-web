/* Who is this? — asked before the shop's own program has finished arriving.
 *
 * Renat, 13.09.2026: «the loading of the user data when you go to checkout».
 * The checkout cannot fill in a name, a phone or an address until
 * GET /api/account/me has answered, so every millisecond before that request
 * LEAVES is a millisecond of empty fields on his phone.
 *
 * It used to leave as late as app.js could make it: the previous round moved
 * the call from the render of the checkout screen up to the top of app.js
 * itself, which is as early as a program can ask for anything — and app.js is
 * the last of twelve blocking <script> tags, behind ~1.2 MB of catalogue and
 * copy and 1.5 MB of app.min.js. The browser had to download and execute all
 * of that before the question was even asked. Measured on the dev server, with
 * every asset warm on the local disk, that was still 100–290 ms; on a phone
 * over mobile data it is the download of the whole shop.
 *
 * So the question is asked here instead, from a file small enough to arrive in
 * the first round trip, marked `async` in the <head> so it holds nothing up.
 * app.js finds the answer already on its way and uses it as its own — see
 * ACCT_BOOT in public/shop2/app.js, which reads and writes the very same
 * window property, so whichever of the two files runs first asks and the other
 * one waits. A browser that has never signed in asks nothing at all: the flag
 * below is written by app.js only after an answer that carried a customer
 * (acctHint / ACCT_SEEN_LS), which is what has always kept this off the
 * critical path of an ordinary visitor.
 *
 * Deliberately plain, deliberately tiny, and NOT built from anything: it is
 * hand-maintained, and its ?v= token joins the shared set by itself because
 * its tag wears the same one (tools/lib/asset-token.mjs). Nothing here may
 * throw — a private-mode browser refuses localStorage outright, and the shop
 * has to open regardless.
 */
(function () {
  "use strict";
  try {
    var w = window;
    // app.js may have got here first (it guards on the same property)
    if (w.__rempireAcct) return;
    // the same key as ACCT_SEEN_LS in app.js — keep the two in step
    if (localStorage.getItem("rempire-shop-account") !== "1") return;
    w.__rempireAcct = fetch("/api/account/me/", { headers: { accept: "application/json" } })
      .then(function (r) {
        /* A 401 is the normal answer for a cookie that has expired, and it is
           what tells this browser to stop asking at boot — acctFetch() in
           app.js does exactly this, and the two must not disagree. */
        if (r.status === 401) {
          try { localStorage.removeItem("rempire-shop-account"); } catch (e) {}
          return null;
        }
        return r.ok ? r.json() : null;
      })
      /* Never a rejection: nobody is awaiting this yet, and an unhandled one
         would be a console error on every load with a bad connection. */
      .catch(function () { return null; });
  } catch (e) { /* no localStorage, no fetch — app.js asks for itself */ }
})();
