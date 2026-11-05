# Offline-sale barcode scanning — feasibility

Question (Dmitri, 23.08): are we sure we can build the scan-to-sell flow for
the Mardi 1 shop? **Yes — two proven paths, both cheap, no native app.**

Context: Renat confirmed nearly all packaging carries a scannable EAN
(round 2, q3) and the till has no software. The flow is: scan → admin finds
the variant by barcode → −1 stock (with an editable qty), logged as
«продажа в магазине» in stock history.

## Path 1 — hardware scanner (recommended as primary)

A USB or Bluetooth handheld scanner (€20–40, e.g. any Netum/Tera-class
1D/2D unit) acts as a **keyboard**: point, click, and it types the EAN plus
Enter into whatever field is focused. Zero drivers, zero integration — the
admin's offline-sale screen just keeps an input focused and handles Enter.
Works with the shop's existing computer/tablet/phone (BT). This is how
every small shop does it; nothing to be unsure about.

## Path 2 — phone camera (companion, always available)

Browser-based scanning in the admin PWA, no app store:

- **`BarcodeDetector` API** where available (Chrome/Android: native,
  fast, supports EAN-13/EAN-8/Code-128).
- **`@zxing/browser` fallback** (mature MIT library, wasm) covers Safari/iOS
  and anything without the native API. EAN-13 on cosmetics packaging is the
  easiest possible target — large, high-contrast, standardized.
- Requirements we already meet: HTTPS (camera access requires it) and a
  getUserMedia permission prompt.

Detection code is ~50 lines around either engine; the real work is the same
admin endpoint both paths share: `lookup by barcode → adjust stock →
movement record`. That endpoint is core inventory functionality regardless
of scanning.

## Risks, honestly

- A few products may share one EAN across variants or have none (merch) —
  the lookup screen needs a manual search fallback. Planned anyway.
- iOS camera scanning is the flakiest corner (autofocus on glossy foil);
  the hardware scanner path is immune, which is why it is primary.
- Barcode VALUES are not in the public Shopify data — captured via Shopify
  Admin API if filled there, otherwise one scanning session at the shop
  populates them (using this very feature in "assign" mode).

Verdict: low-risk, commodity tech. Do not promise less than this to the
client; do not promise a POS — this is stock deduction, not receipts/cash
handling (that stays on the existing till).
