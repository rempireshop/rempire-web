/* ============================================================================
   shipping-data.js — real Estonian parcel-delivery data for the shop prototype
   ----------------------------------------------------------------------------
   Compiled 2026-08-27 by reading carrier price lists and public location
   endpoints directly. Every price carries its source URL, the date it was read,
   the price list's own "valid from" date, and its VAT status. Every parcel
   machine name is a verbatim string from a carrier API or official page — none
   are invented (see NOTE ON NAMES below).

   VAT: the Estonian standard rate is 24%. SmartPosti and DPD publish
   VAT-INCLUSIVE consumer prices ("Hinnad sisaldavad 24% käibemaksu"); Omniva's
   and DPD's BUSINESS price lists are VAT-EXCLUSIVE ("Hindadele lisandub
   käibemaks"). The `vatIncluded` flag on every block says which. Do not compare
   two numbers across blocks without checking it.

   REFERENCE PARCEL for this research: up to ~5 kg, ~30 x 30 x 30 cm. That maps
   to the "L" locker size at all three carriers (see `sizes` in each block); it
   does NOT fit Omniva M (19 cm max height), SmartPosti M (20 cm) or DPD M
   (17 cm). `parcelRef` below pulls out just the L-size numbers.

   *** SHOP OWNER MUST VERIFY ***
   Business/contract rates below are published LIST prices. An actual e-shop
   contract is usually cheaper. Specifically:
     - Omniva grants 3-15% (EE), 3-15% (LV), 4-20% (LT) volume discounts from
       40 parcels/month, agreed per customer.
     - DPD's published business list applies to companies under ~40 parcels or
       4 pallets a month; above that DPD quotes individually.
     - SmartPosti publishes only one business table (prepaid customers); a
       negotiated volume contract is not public.
   Treat every figure here as "what a small shop pays walking in", not as
   Rempire's eventual contract rate.
   ============================================================================ */

const SHIPPING_DATA = {

  meta: {
    compiled: '2026-08-27',
    vatRateEE: 0.24,
    referenceParcel: { maxWeightKg: 5, approxDimensionsCm: [30, 30, 30] },
    currency: 'EUR'
  },

  /* ==========================================================================
     1. PRICES
     ========================================================================== */
  prices: {

    /* ---- OMNIVA -------------------------------------------------------- */

    // Omniva BUSINESS (äriklient) contract list price.
    // Source: https://old.omniva.ee/public/files/failid/hinnakiri-pakk-pakiteenus-uues-eteeninduses-ari-est-ee-2025.pdf
    //   (linked from https://old.omniva.ee/abi/arikliendile — the business
    //   documents index; www.omniva.ee/ariklient/hinnakirjad/ renders its list
    //   client-side and exposes no PDF link)
    // Read 2026-08-27. Price list header: "Kehtib alates 21.02.2025".
    // VAT: EXCLUDED — the PDF states "Hindadele lisandub käibemaks".
    omniva_machine_business: {
      carrier: 'Omniva',
      service: 'Pakiautomaat / postkontor',
      tier: 'business',
      vatIncluded: false,
      validFrom: '2025-02-21',
      readOn: '2026-08-27',
      source: 'https://old.omniva.ee/public/files/failid/hinnakiri-pakk-pakiteenus-uues-eteeninduses-ari-est-ee-2025.pdf',
      // Omniva locker sizes, max 30 kg. Source (read 2026-08-27):
      // https://www.omniva.ee/abi/pakiautomaadi-kapi-suurused
      sizes: { S: '9 x 38 x 64 cm', M: '19 x 38 x 64 cm', L: '39 x 38 x 64 cm', XL: 'longest side up to 1.5 m' },
      dest: {
        EE: { S: 2.59, M: 3.30, L: 4.40, XL: 5.78 },   // XL: post office only
        LV: { S: 6.70, M: 7.59, L: 8.56, XL: null },
        LT: { S: 7.68, M: 8.55, L: 9.51, XL: null },
        FI: null                                        // see note below
      },
      notes: [
        'Volume discount off these list prices from 40 parcels/month: EE 3-15%, LV 3-15%, LT 4-20% — agreed individually with Omniva ("Soodustused põhinevad kliendi esialgsel kokkuleppel Omnivaga").',
        'Parcels cannot be sent to a POST OFFICE in LV/LT — parcel machine or courier only.',
        'FI is null because Omniva runs NO parcel machines in Finland: the business price list has only EE-EE / EE-LV / EE-LT columns, and https://www.omniva.ee/locations.json (read 2026-08-27) returns machines for EE, LV and LT only — zero FI rows. Finland is served by Omniva only as an international POSTAL parcel (see omniva_international_business).'
      ]
    },

    // Omniva PRIVATE customer (eraklient), parcel formatted in minu.omniva.ee
    // self-service. Included because it is the only Omniva table that is
    // unambiguously public and current — useful as an upper bound.
    // Source: https://www.omniva.ee/wp-content/uploads/sites/7/2026/03/EE_Private-customer-pricelist_EE_2025-05-01.pdf
    // Read 2026-08-27. Header: "Kehtib alates 01.05.2026".
    // VAT: INCLUDED — "Hinnad sisaldavad käibemaksu".
    omniva_machine_private: {
      carrier: 'Omniva',
      service: 'Pakiautomaat / postkontor (self-service minu.omniva.ee)',
      tier: 'private',           // NOT a shop rate — private-customer price
      vatIncluded: true,
      validFrom: '2026-05-01',
      readOn: '2026-08-27',
      source: 'https://www.omniva.ee/wp-content/uploads/sites/7/2026/03/EE_Private-customer-pricelist_EE_2025-05-01.pdf',
      dest: {
        EE: { S: 3.46, M: 4.48, L: 5.49, XL: 5.89 },
        LV: { S: 7.11, M: 8.22, L: 9.24, XL: null },
        LT: { S: 8.22, M: 9.44, L: 11.58, XL: null },
        FI: null
      },
      notes: [
        'Same PDF, post-office-counter tariff is higher (EE S 4.86 / M 6.09 / L 7.01).',
        'Courier hand-over adds a 4.34 EUR pickup fee ("kulleri väljakutse teenustasu").'
      ]
    },

    // Omniva EE->FI, international POSTAL parcel for business customers.
    // Source: https://old.omniva.ee/public/files/failid/hinnakiri-rv-pakiteenused-ari-est-ee-2025.pdf
    // Read 2026-08-27. Header: "Kehtib alates 9.01.2025". VAT: EXCLUDED.
    omniva_international_business: {
      carrier: 'Omniva',
      service: 'Rahvusvaheline pakiteenus (postal parcel, NOT a parcel machine)',
      tier: 'business',
      vatIncluded: false,
      validFrom: '2025-01-09',
      readOn: '2026-08-27',
      source: 'https://old.omniva.ee/public/files/failid/hinnakiri-rv-pakiteenused-ari-est-ee-2025.pdf',
      dest: { FI: 'NOT RELIABLY EXTRACTED — see note' },
      notes: [
        'UNVERIFIED. The Finland row is priced by weight band (0-0.25 / 0.25-0.5 / 0.5-1 / 1-2 / 2-3 / 3-5 / 5-10 kg ... ) with Standard and Economy variants and 6-11 working-day transit, but the PDF table columns flatten ambiguously on text extraction and the Finland row could not be aligned to its weight headers with confidence. Do NOT quote a number from here — ask Omniva for a written EE->FI quote.',
        'For an e-shop, Omniva also sells EE->FI delivery to Matkahuolto pickup points in Finland (integration modules exist for Magento/WooCommerce), but no public price for that service was found; it is contract-only.'
      ]
    },

    /* ---- SMARTPOSTI (ex Itella SmartPOST; Posti Group) ------------------- */

    // Itella SmartPOST rebranded to "SmartPosti" in 2025 and moved to
    // smartposti.ee; both smartpost.ee and itella.ee now 301 there.
    // In Finland the same group trades as "Posti", so an EE->FI SmartPosti
    // parcel is delivered into Posti's Finnish automat network.
    //
    // Source: https://www.smartposti.ee/ariklient/klienditeenindus/ariklientide-pakkide-hinnad
    // Read 2026-08-27. Page states "Hinnad kehtivad alates 11.03.2026" and
    // "Hinnad sisaldavad 24% käibemaksu". VAT: INCLUDED.
    smartposti_machine_business: {
      carrier: 'SmartPosti',
      service: 'Pakiautomaat / pakipunkt',
      tier: 'business-prepaid',   // "ettemaksuklient" = prepaid business account
      vatIncluded: true,
      validFrom: '2026-03-11',
      readOn: '2026-08-27',
      source: 'https://www.smartposti.ee/ariklient/klienditeenindus/ariklientide-pakkide-hinnad',
      // max 35 kg (XS max 5 kg); minimum parcel 1 x 15 x 15 cm / 100 g
      sizes: {
        XS: '5 x 34 x 42 cm, max 5 kg', S: '12 x 34 x 42 cm', M: '20 x 34 x 42 cm',
        L: '34 x 36 x 42 cm', XL: '60 x 36 x 60 cm'
      },
      dest: {
        EE: { XS: 2.90, S: 3.34, M: 4.46, L: 5.47, XL: 7.26 },
        FI: { XS: 11.17, S: 12.30, M: 14.52, L: 15.65, XL: 16.76 },
        LV: { XS: 6.26, S: 7.71, M: 8.82, L: 9.94, XL: 14.52 },
        LT: { XS: 8.60, S: 8.94, M: 10.05, L: 11.17, XL: 16.76 }
      },
      notes: [
        'FI to a POST OFFICE ("postipood") instead of an automat is dearer: XS 13.41 / S 14.52 / M 16.76 / L 17.88 / XL 19.01.',
        'IMPORTANT: this published "ettemaksuklient" (prepaid business) table is IDENTICAL to the general public price list at https://www.smartposti.ee/paki-saatmine/hinnakirjad. SmartPosti does not publish a negotiated volume tariff — a real e-shop contract rate is not public and must be requested.',
        'Transit: EE 1 working day; LV/LT 2-3; Helsinki area 2-3, rest of Finland 3-5.'
      ]
    },

    // SmartPosti courier to door. Same page family, same validity/VAT.
    // Source: https://www.smartposti.ee/paki-saatmine/hinnakirjad — read 2026-08-27.
    smartposti_courier: {
      carrier: 'SmartPosti',
      service: 'Kuller (to door)',
      tier: 'published-list',
      vatIncluded: true,
      validFrom: '2026-03-11',
      readOn: '2026-08-27',
      source: 'https://www.smartposti.ee/paki-saatmine/hinnakirjad',
      dest: {
        EE: { XS: 7.81, S: 8.60, M: 9.72, L: 10.84, XL: 14.19 },
        FI: { XS: 16.75, S: 19.01, M: 20.11, L: 23.47, XL: 27.94 }
      },
      notes: [
        'LV/LT courier prices exist on the same page but were not captured per size; LV XS parcel-point is 5.69 and LT XS 7.82 per that page (differs slightly from the business table above — treat the business table as authoritative for a shop).',
        'The rest-of-Europe table on that page carries a different validity date: "kehtib alates 15.07.2026".'
      ]
    },

    /* ---- DPD ------------------------------------------------------------ */

    // DPD BUSINESS (contract) list. This is the price list DPD itself points
    // e-shops to: the page says that if your expected volume is UNDER 40
    // parcels or 4 pallets a month you use this published list, otherwise you
    // request an individual quote ("Lepingulise kliendi hinnapäring").
    // Source: https://www.dpd.com/wp-content/uploads/sites/235/2025/02/DPD-Eesti-AS-hinnakiri-2025.pdf
    //   (linked as "DPD ärikliendi hinnakiri 2025" from
    //    https://www.dpd.com/ee/et/hakka-arikliendiks/)
    // Read 2026-08-27. VAT: EXCLUDED — "Hindadele lisandub käibemaks".
    dpd_pickup_business: {
      carrier: 'DPD',
      service: 'DPD Pickup (pakiautomaat / Pickup punkt)',
      tier: 'business',
      vatIncluded: false,
      validFrom: '2025',          // PDF is titled "DPD Eesti AS hinnakiri 2025"; no day/month stated
      readOn: '2026-08-27',
      source: 'https://www.dpd.com/wp-content/uploads/sites/235/2025/02/DPD-Eesti-AS-hinnakiri-2025.pdf',
      sizes: { XS: '8 x 18 x 61 cm', S: '8 x 43 x 61 cm', M: '17 x 43 x 61 cm', L: '36 x 43 x 61 cm' },
      dest: {
        EE: { XS: 2.42, S: 2.42, M: 2.42, L: 3.63 },
        LV: { XS: 4.65, S: 4.65, M: 4.65, L: 6.50 },
        LT: { XS: 5.75, S: 5.75, M: 5.75, L: 6.95 },
        FI: { XS: 10, S: 11, M: 12, L: 15 }   // VERIFY — see note
      },
      notes: [
        'Max 31.5 kg to EE/LV/LT; 20 kg to Finland and the rest of Europe (Portugal 10 kg).',
        'XS/S/M are genuinely the same price in the EE/LV/LT table — only L steps up.',
        'VERIFY the FI row: the "Muu Euroopa" table in that PDF flattens into parallel value lists on text extraction, so FI (17th of 20 countries) was recovered by index alignment rather than read off a row. The EE/LV/LT block above was explicitly row-labelled and is high confidence.'
      ]
    },

    // DPD Classic, courier door-to-door, business contract list. Same PDF.
    // Priced by TOTAL weight of all parcels to one recipient, VAT EXCLUDED.
    dpd_courier_business: {
      carrier: 'DPD',
      service: 'DPD Classic (kuller, uksest ukseni)',
      tier: 'business',
      vatIncluded: false,
      validFrom: '2025',
      readOn: '2026-08-27',
      source: 'https://www.dpd.com/wp-content/uploads/sites/235/2025/02/DPD-Eesti-AS-hinnakiri-2025.pdf',
      // weight bands in kg, "up to"
      bands: [1, 3, 10, 20, 31.5],
      dest: {
        // EE zone 1&2 = Tallinn + suburbs, Tartu + suburbs, Jõhvi, Pärnu, Rakvere, Viljandi
        EE_zone12: { 1: 4.93, 3: 5.75, 10: 7.25, 20: 9.03, 31.5: 11.07 },
        // EE zone 3 = Elva, Haapsalu, Jõgeva, Kohtla-Järve, Kuressaare, Kärdla, Märjamaa,
        //             Narva, Otepää, Paide, Põltsamaa, Põlva, Rapla, Sillamäe, Türi, Valga, Võru
        EE_zone3:  { 1: 5.48, 3: 6.29, 10: 7.92, 20: 9.86, 31.5: 12.10 },
        EE_zone4:  { 1: 6.01, 3: 6.90, 10: 8.69, 20: 10.82, 31.5: 13.28 },  // rest of Estonia
        LV_zone1:  { 1: 8.37, 3: 8.95, 10: 10.94, 20: 14.50, 31.5: 18.59 }, // Riga
        LV_zone2:  { 1: 9.80, 3: 10.32, 10: 12.13, 20: 15.36, 31.5: 19.08 },
        LV_zone3:  { 1: 9.97, 3: 10.57, 10: 13.13, 20: 16.44, 31.5: 21.59 },
        LT_zone1:  { 1: 9.31, 3: 10.03, 10: 12.55, 20: 16.46, 31.5: 20.96 }, // Vilnius, Kaunas
        LT_zone2:  { 1: 10.25, 3: 10.97, 10: 13.49, 20: 17.40, 31.5: 21.90 },
        LT_zone3:  { 1: 10.75, 3: 11.54, 10: 14.31, 20: 18.27, 31.5: 23.69 },
        FI:        { 1: 17, 3: 18, 10: 21, 20: 24, 31.5: 26 }
      },
      // Rest of Europe, "up to 10 kg" band, EUR ex VAT, read from the same table:
      restOfEuropeAt10kg: {
        Austria: 34, Belgium: 30, Bulgaria: 45, Spain: 37, Netherlands: 29, Croatia: 42,
        Ireland: 35, Italy: 34, Greece: 39, Luxembourg: 33, Poland: 24, Portugal: 41,
        France: 40, Sweden: 23, Romania: 43, Germany: 30, Slovakia: 27, Slovenia: 33,
        Finland: 21, Denmark: 27, Czechia: 28, Hungary: 26
      },
      notes: [
        'EU range at 10 kg: cheapest Finland 21 EUR, dearest Bulgaria 45 EUR (ex VAT).',
        'Non-EU on the same table: UK 44, Norway 70, Switzerland 70 (10 kg) — customs paperwork required.',
        'Max 31.5 kg; longest side up to 175 cm and 2 x (height + width) + longest side up to 300 cm.',
        'The rest-of-Europe figures come from a country-list/value-list pair in the PDF and were aligned by index; spot-check any single country before quoting it to a customer.'
      ]
    },

    // DPD PRIVATE / walk-up price list — what you pay buying a label at
    // telli.dpd.ee or at the machine itself, with no contract.
    // Source: https://www.dpd.com/ee/et/saatmine/eraklient/hinnakiri/
    // Read 2026-08-27. VAT: INCLUDED — "Hinnad sisaldavad 24% käibemaksu".
    dpd_private: {
      carrier: 'DPD',
      service: 'Pakiautomaat / kuller (no contract)',
      tier: 'private',            // NOT a shop rate
      vatIncluded: true,
      validFrom: null,            // page states no validity date; read 2026-08-27
      readOn: '2026-08-27',
      source: 'https://www.dpd.com/ee/et/saatmine/eraklient/hinnakiri/',
      sizes: { XS: '8 x 18 x 61 cm', S: '8 x 43 x 61 cm', M: '17 x 43 x 61 cm', L: '36 x 43 x 61 cm' },
      machineToMachine: {
        EE: { XS: 2.63, S: 3.04, M: 4.45, L: 5.44 },
        LV: { XS: 5.68, S: 7.03, M: 8.06, L: 9.09 },
        LT: { XS: 7.75, S: 8.16, M: 9.20, L: 10.23 },
        FI: { XS: 21.35, S: 22.23, M: 22.78, L: 24.70 }
      },
      machineToAddress: {
        EE: { XS: 7.96, S: 8.27, M: 8.57, L: 10.02 },
        LV: { XS: 12.09, S: 12.35, M: 13.12, L: 15.49 },
        LT: { XS: 12.96, S: 13.23, M: 14.00, L: 16.38 },
        FI: { XS: 25.12, S: 26.15, M: 26.80, L: 29.05 }
      },
      addressToAddress: {
        EE: { XS: 8.99, S: 9.30, M: 9.60, L: 11.06, XL: 13.18 },
        LV: { XS: 13.12, S: 13.38, M: 14.16, L: 16.53, XL: 19.43 },
        LT: { XS: 13.99, S: 14.26, M: 15.04, L: 17.41, XL: 20.36 },
        FI: { XS: 27.18, S: 27.59, M: 28.59, L: 31.11, XL: 34.72 },
        SE: { XS: 28.54, S: 28.98, M: 30.02, L: 32.67, XL: 36.46 },
        'PL_DK': { XS: 30.96, S: 31.43, M: 32.57, L: 35.44, XL: 39.56 },
        'NL_DE_SK_CZ_HU': { XS: 28.92, S: 35.13, M: 43.39, L: 51.66, XL: 59.93 },
        'BE_IE_IT_GR': { XS: 30.08, S: 36.53, M: 45.12, L: 53.73, XL: 62.32 },
        'LU_PT_SI': { XS: 37.61, S: 45.67, M: 56.41, L: 67.16, XL: 77.91 },
        'AT_BG_ES_HR_FR_RO': { XS: 46.49, S: 48.82, M: 53.22, L: 60.44, XL: 67.88 }
      },
      notes: [
        'These prices apply only when the label is bought at telli.dpd.ee or at the parcel machine, paid immediately.',
        'Machine-to-machine max weight: 31.5 kg to EE/LV; 20 kg elsewhere in Europe (Portugal 10 kg); Sweden/Denmark machines 10 kg.',
        'Note how much dearer FI is here (24.70 for L) than on the DPD business list (15 ex VAT ~= 18.60 incl) — the contract list is the one a shop should use.'
      ]
    },

    /* ---- Quick comparison for the reference parcel ---------------------- */
    // ~5 kg, ~30 x 30 x 30 cm => "L" everywhere. Figures restated from the
    // blocks above; `incVat` is computed at 24% where the source excludes VAT.
    parcelRef: {
      note: 'L size. exVat/incVat both shown so the two conventions can be compared directly. incVat on business rows = exVat x 1.24, computed here, not quoted by the carrier.',
      rows: [
        { carrier: 'Omniva',     service: 'pakiautomaat', dest: 'EE', tier: 'business', exVat: 4.40, incVat: 5.46 },
        { carrier: 'Omniva',     service: 'pakiautomaat', dest: 'LV', tier: 'business', exVat: 8.56, incVat: 10.61 },
        { carrier: 'Omniva',     service: 'pakiautomaat', dest: 'LT', tier: 'business', exVat: 9.51, incVat: 11.79 },
        { carrier: 'Omniva',     service: 'pakiautomaat', dest: 'FI', tier: 'business', exVat: null, incVat: null, why: 'no Omniva machines in Finland' },
        { carrier: 'SmartPosti', service: 'pakiautomaat', dest: 'EE', tier: 'business-prepaid', exVat: 4.41, incVat: 5.47 },
        { carrier: 'SmartPosti', service: 'pakiautomaat', dest: 'FI', tier: 'business-prepaid', exVat: 12.62, incVat: 15.65 },
        { carrier: 'SmartPosti', service: 'pakiautomaat', dest: 'LV', tier: 'business-prepaid', exVat: 8.02, incVat: 9.94 },
        { carrier: 'SmartPosti', service: 'pakiautomaat', dest: 'LT', tier: 'business-prepaid', exVat: 9.01, incVat: 11.17 },
        { carrier: 'DPD',        service: 'Pickup',       dest: 'EE', tier: 'business', exVat: 3.63, incVat: 4.50 },
        { carrier: 'DPD',        service: 'Pickup',       dest: 'LV', tier: 'business', exVat: 6.50, incVat: 8.06 },
        { carrier: 'DPD',        service: 'Pickup',       dest: 'LT', tier: 'business', exVat: 6.95, incVat: 8.62 },
        { carrier: 'DPD',        service: 'Pickup',       dest: 'FI', tier: 'business', exVat: 15, incVat: 18.60, verify: true },
        { carrier: 'DPD',        service: 'kuller',       dest: 'EE (zone 1&2)', tier: 'business', exVat: 7.25, incVat: 8.99 },
        { carrier: 'DPD',        service: 'kuller',       dest: 'LV (Riga)', tier: 'business', exVat: 10.94, incVat: 13.57 },
        { carrier: 'DPD',        service: 'kuller',       dest: 'LT (Vilnius/Kaunas)', tier: 'business', exVat: 12.55, incVat: 15.56 },
        { carrier: 'DPD',        service: 'kuller',       dest: 'FI', tier: 'business', exVat: 21, incVat: 26.04, verify: true },
        { carrier: 'DPD',        service: 'kuller',       dest: 'rest of EU', tier: 'business', exVat: '21-45', incVat: '26.04-55.80', why: 'cheapest FI, dearest BG, at the 10 kg band' }
      ]
    }
  },

  /* ==========================================================================
     2. PARCEL MACHINES — real locations, curated for the prototype dropdown
     --------------------------------------------------------------------------
     NOTE ON NAMES: every name below is the carrier's own official string. The
     ONLY edit applied is mechanical: where the official name already began with
     the city in the genitive ("Tallinna ...", "Rīgas ...", "Vilniaus ..."), that
     duplicated prefix was removed and the city put in front of an em dash, so
     "Tallinna Kristiine Keskuse pakiautomaat" renders as
     "Tallinn — Kristiine Keskuse pakiautomaat". Nothing was reworded, expanded
     or invented. Carrier is implied by the array a name sits in.

     WHERE THE DATA CAME FROM (all read 2026-08-27):
       omniva    https://www.omniva.ee/locations.json  (1444 rows: EE 471,
                 LV 412, LT 561; TYPE 0 = parcel machine, TYPE 1 = post office.
                 Zero FI rows.)
       smartpost https://www.smartposti.ee/sitemap-locations.xml (356 location
                 pages) + each page's <title>, which is the official machine name
       dpd       https://www.dpd.com/ee/et/kattesaamine/pakiautomaadid/ —
                 server-rendered, 355 machine names in the HTML
       posti     https://www.posti.fi/sitemap-locations.xml (3335 pages) + each
                 page's <title> and schema.org addressLocality
     ========================================================================== */
  machines: {

    EE: {
      // Omniva — from locations.json, A0_NAME=EE, TYPE=0.
      omniva: [
      "Tallinn — Arsenali Keskuse pakiautomaat",
      "Tallinn — Järve Keskuse pakiautomaat",
      "Tallinn — Kristiine Keskuse pakiautomaat",
      "Tallinn — Lasnamäe Centrumi pakiautomaat",
      "Tallinn — Magistrali Keskuse pakiautomaat",
      "Tallinn — Mustamäe Keskuse pakiautomaat",
      "Tallinn — Mustika Keskuse pakiautomaat",
      "Tallinn — Nautica Keskuse pakiautomaat",
      "Tallinn — Rocca al Mare pakiautomaat",
      "Tallinn — Sikupilli pakiautomaat",
      "Tallinn — Solaris Keskuse pakiautomaat",
      "Tallinn — Stockmanni pakiautomaat",
      "Tallinn — T1 Keskuse pakiautomaat",
      "Tallinn — Viru Keskuse bussiterminali pakiautomaat",
      "Tallinn — Ülemiste City Selveri pakiautomaat",
      "Tartu — Annelinna Prisma pakiautomaat",
      "Tartu — Eedeni pakiautomaat",
      "Tartu — Kesklinna Keskuse pakiautomaat",
      "Tartu — Kvartali Keskuse pakiautomaat",
      "Tartu — Lõunakeskuse pakiautomaat",
      "Tartu — Tasku keskuse pakiautomaat",
      "Narva — Astri Keskuse pakiautomaat",
      "Narva — Fama keskuse pakiautomaat",
      "Narva — Prisma pakiautomaat",
      "Pärnu — Kaubamajaka pakiautomaat",
      "Pärnu — Port Artur 2 pakiautomaat",
      "Pärnu — Suurejõe Selveri pakiautomaat",
      "Viljandi — Bussijaama pakiautomaat",
      "Viljandi — Männimäe Selveri pakiautomaat",
      "Rakvere — Põhjakeskuse pakiautomaat",
      "Rakvere — Vaala Keskuse pakiautomaat",
      "Kohtla-Järve — Rimi pakiautomaat",
      "Kohtla-Järve — Selveri pakiautomaat",
      "Maardu — Pärli Keskuse pakiautomaat",
      "Haapsalu — Kaubamaja pakiautomaat",
      "Võru — kesklinna Circle K pakiautomaat",
      "Paide — Selveri pakiautomaat",
      "Keila — Rõõmu kaubamaja pakiautomaat"
      ],

      // SmartPosti — official page titles from smartposti.ee location pages.
      // These names carry no "pakiautomaat" suffix; that is how SmartPosti
      // writes them. "(klahvistikuga)" = the unit has a keypad.
      smartpost: [
      "Tallinn — Ülemiste keskus",
      "Tallinn — Kristiine Keskus 1.korrus",
      "Tallinn — Rocca Al Mare Keskus",
      "Tallinn — Solaris Keskus",
      "Tallinn — Kaubamaja",
      "Tallinn — Stockmann (klahvistikuga)",
      "Tallinn — T1 Kaubanduskeskus",
      "Tallinn — Mustika Prisma",
      "Tallinn — Magistrali Keskus",
      "Tallinn — Nautica Keskus",
      "Tallinn — Järve Keskus",
      "Tallinn — Sikupilli Prisma",
      "Tallinn — Lasnamäe Prisma",
      "Tallinn — Mustamäe Keskus",
      "Tallinn — Nõmme keskus (klahvistikuga)",
      "Tallinn — Pirita Keskus",
      "Tallinn — Stroomi Keskus",
      "Tallinn — Idakeskus (klahvistikuga)",
      "Tallinn — Rotermanni 8 Galerii (klahvistikuga)",
      "Tallinn — Balti Jaama Turg",
      "Tartu — Lõunakeskuse Rimi",
      "Tartu — Tasku Keskus",
      "Tartu — Kvartal",
      "Tartu — Eeden",
      "Tartu — Annelinna Prisma",
      "Tartu — Kaubamaja 0 korrus",
      "Tartu — Anne Selver",
      "Narva — Fama Keskus (klahvistikuga)",
      "Narva — Astri Keskus",
      "Narva — Prisma",
      "Pärnu — Kaubamajakas",
      "Pärnu — Port Artur 2",
      "Pärnu — Keskus",
      "Viljandi — Uku keskus",
      "Rakvere — Põhjakeskus",
      "Jõhvi — Tsentraal",
      "Kuressaare — Saare Selver",
      "Võru — Kagukeskus",
      "Haapsalu — Rimi",
      "Viimsi — Keskus (Selver)",
      "Maardu — Pärli Keskus",
      "Paide — Selver"
      ],

      // DPD — from the server-rendered public machine list on dpd.com/ee.
      dpd: [
      "Tallinn — Arsenali keskuse DPD pakiautomaat",
      "Tallinn — Idakeskuse DPD pakiautomaat",
      "Tallinn — Järve keskuse parkla DPD pakiautomaat",
      "Tallinn — Kristiine keskuse DPD pakiautomaat",
      "Tallinn — Lasnamäe Centrumi DPD pakiautomaat",
      "Tallinn — Lasnamäe Prisma DPD pakiautomaat",
      "Tallinn — Magistrali keskuse DPD pakiautomaat",
      "Tallinn — Mustamäe keskuse DPD pakiautomaat",
      "Tallinn — Mustika keskuse DPD pakiautomaat",
      "Tallinn — Nautica keskuse DPD pakiautomaat",
      "Tallinn — Nurmenuku keskuse DPD pakiautomaat",
      "Tallinn — Rocca al mare keskuse DPD pakiautomaat",
      "Tallinn — Solarise keskuse DPD pakiautomaat",
      "Tallinn — Viru keskuse bussiterminali DPD pakiautomaat",
      "Tallinn — Ülemiste keskuse DPD pakiautomaat",
      "Tartu — Aardla Selveri DPD pakiautomaat",
      "Tartu — Anne Prisma DPD pakiautomaat",
      "Tartu — Annelinna Maxima XX DPD pakiautomaat",
      "Tartu — Eedeni keskuse DPD pakiautomaat",
      "Tartu — Karete Konsumi DPD pakiautomaat",
      "Tartu — Rebase Rimi DPD pakiautomaat",
      "Narva — Astri keskuse DPD pakiautomaat",
      "Narva — Kangelaste Prisma DPD pakiautomaat",
      "Narva — Kreenholmi Maxima XX DPD pakiautomaat",
      "Pärnu — Jannseni Rimi DPD pakiautomaat",
      "Pärnu — Kaubamajaka DPD pakiautomaat",
      "Pärnu — Oja Selveri DPD pakiautomaat",
      "Viljandi — bussijaama DPD pakiautomaat",
      "Viljandi — Männimäe Rimi DPD pakiautomaat",
      "Rakvere — kesklinna Rimi DPD pakiautomaat",
      "Rakvere — Põhjakeskuse DPD pakiautomaat",
      "Kohtla-Järve — mini-Rimi DPD pakiautomaat",
      "Kohtla-Järve — Selveri DPD pakiautomaat",
      "Haapsalu — Kaubamaja Konsumi DPD pakiautomaat",
      "Kuressaare — Selveri DPD pakiautomaat",
      "Võru — Maxima XX DPD pakiautomaat"
      ]
    },

    LV: {
      // Omniva — locations.json, A0_NAME=LV, TYPE=0 (412 rows available).
      // For Latvia the city sits in A1_NAME (A2_NAME is blank for Riga).
      omniva: [
      "Rīga — A. Briāna ielas RIMI pakomāts",
      "Rīga — A. Deglava ielas 160 LIDL pakomāts",
      "Rīga — Āgenskalna Maxima X pakomāts",
      "Rīga — Autoostas pakomāts",
      "Rīga — Baltāsbaznīcas ielas MEGO pakomāts",
      "Rīga — Bolderājas Lats pakomāts",
      "Rīga — Buļļu ielas 35 Aibe pakomāts",
      "Rīga — Daugavgrīvas ielas TOP pakomāts",
      "Rīga — Nīcgales ielas 53 T/C GREEN pakomāts",
      "Rīga — T/C AKROPOLE Alfa pakomāts",
      "Rīga — T/C Dole pakomāts",
      "Rīga — T/C DOMINA pakomāts",
      "Rīga — T/C Galleria Riga pakomāts",
      "Rīga — T/C Riga Plaza pakomāts",
      "Rīga — T/C Spice pakomāts",
      "Rīga — Vecāķu ELVI pakomāts",
      "Jelgava — Rīgas ielas 50 LIDL pakomāts",
      "Jelgava — Satiksmes ielas RIMI pakomāts",
      "Jelgava — T/C Pilsētas Pasāža pakomāts",
      "Liepāja — Krūmu ielas MEGO pakomāts",
      "Liepāja — Ziemeļu ielas RIMI pakomāts",
      "Liepāja — T/C Baata pakomāts",
      "Jūrmala — Kauguru Raiņa ielas Mini RIMI pakomāts",
      "Jūrmala — Slokas T/C Liedags pakomāts",
      "Daugavpils — 18. novembra ielas RIMI pakomāts",
      "Daugavpils — Balvu ielas 1a LIDL pakomāts",
      "Daugavpils — T/C Aveņu centrs pakomāts",
      "Ventspils — Poruka ielas RIMI pakomāts",
      "Ventspils — T/C Tobago pakomāts",
      "Rēzekne — Galdnieku ielas RIMI pakomāts",
      "Valmiera — Fabrikas ielas RIMI pakomāts",
      "Valmiera — T/C Valleta pakomāts"
      ]
      // No DPD array for LV: DPD's Latvian pickup-point list is loaded client
      // side (https://www.dpd.com/lv/lv/sanemsana/pickup-tikls/pickup-punktu-saraksts/
      // returned zero "pakomat" strings in its HTML on 2026-08-27) and no public
      // JSON endpoint was found. DPD *prices* to LV are in `prices` above.
    },

    LT: {
      // Omniva — locations.json, A0_NAME=LT, TYPE=0 (561 rows available).
      // City taken from A3_NAME ("Vilniaus m." etc.) rendered in the nominative.
      omniva: [
      "Vilnius — Avižienių MAXIMA paštomatas",
      "Vilnius — Balsių ČIA MARKET paštomatas",
      "Vilnius — Balsių PPC ŽALI paštomatas",
      "Vilnius — Bendorėlių RIMI paštomatas",
      "Vilnius — Bukiškio LIDL paštomatas",
      "Vilnius — CUP paštomatas",
      "Vilnius — EXPRESS MARKET J. Balčikonio paštomatas",
      "Vilnius — IKI Antakalnio g. 42 paštomatas",
      "Vilnius — Justiniškių NORFA paštomatas",
      "Vilnius — PC AKROPOLIS paštomatas",
      "Vilnius — PC BIG paštomatas",
      "Vilnius — PC OZAS paštomatas",
      "Vilnius — PLC PANORAMA paštomatas",
      "Kaunas — Akademijos RIMI paštomatas",
      "Kaunas — Domeikavos MAXIMA paštomatas",
      "Kaunas — Garliavos IKI Lozoraičio paštomatas",
      "Kaunas — Garliavos NORFA paštomatas",
      "Kaunas — LIDL Baltų paštomatas",
      "Kaunas — PC AKROPOLIS paštomatas",
      "Kaunas — PC KALNIEČIAI paštomatas",
      "Kaunas — PLC MEGA paštomatas",
      "Klaipėda — Gindulių MAXIMA paštomatas",
      "Klaipėda — HERKAUS GALERIJA paštomatas",
      "Klaipėda — IKI Debreceno paštomatas",
      "Klaipėda — PC AKROPOLIS paštomatas",
      "Klaipėda — PC ARENA paštomatas",
      "Šiauliai — Ginkūnų MAXIMA paštomatas",
      "Šiauliai — IKI Gardino paštomatas",
      "Šiauliai — PC AKROPOLIS paštomatas",
      "Šiauliai — PC ARENA paštomatas",
      "Panevėžys — IKI Vilniaus paštomatas",
      "Panevėžys — MAXIMA LĖVUO paštomatas",
      "Panevėžys — PC BIČIULIS paštomatas",
      "Alytus — IKI Jaunimo paštomatas",
      "Alytus — PC ARENA paštomatas"
      ]
      // No DPD array for LT, same reason as LV: dpd.com/lt/lt renders its
      // pastomatai finder client-side and publishes no open list endpoint.
    },

    FI: {
      // Posti pickup points / automats in Finland.
      // Keyed `smartpost` because this is the network an EE->FI SmartPosti
      // parcel is delivered into: Itella SmartPOST rebranded to SmartPosti in
      // 2025 and the same Posti Group trades as "Posti" in Finland, so the
      // SmartPosti "Soome pakiautomaat" tariff above buys delivery to exactly
      // these units. Names and cities are from posti.fi's own location pages.
      // Omniva has no Finnish machines at all, so there is no omniva array here.
      smartpost: [
      "Helsinki — Postin automaatti, Alepa Pikku-Huopalahti",
      "Helsinki — Postin automaatti, K-Citymarket Ruoholahti",
      "Helsinki — Postin automaatti, K-Market Jätkäsaari",
      "Helsinki — Postin automaatti, K-Market Krunikka",
      "Helsinki — Postin automaatti, Kauppakeskus Arabia",
      "Helsinki — Postin automaatti, Lidl Helsinki-Töölöntulli",
      "Helsinki — Postin automaatti, Lidl Lauttasaari",
      "Helsinki — Postin automaatti, Lidl Redi K1-kerros",
      "Helsinki — Postin automaatti, Lidl Sörnäinen",
      "Helsinki — Postin automaatti, S-market Bulevardi",
      "Helsinki — Postin automaatti, S-market Hakaniemi",
      "Helsinki — Postin automaatti, S-market Kasarmitori",
      "Helsinki — Postin automaatti, S-market Pakila",
      "Helsinki — Postin automaatti, Tokmanni Ruoholahti",
      "Espoo — Postin automaatti, Alepa Kivenlahti",
      "Espoo — Postin automaatti, Lidl Espoo Olari Länsikeskus",
      "Espoo — Postin automaatti, Power Laajalahti",
      "Espoo — Postin automaatti, Prisma Espoo Olari",
      "Espoo — Postin automaatti, Puuilo Espoo Laajalahti",
      "Espoo — Postin automaatti, S-market Espoonlahti",
      "Vantaa — Postin automaatti, Lidl Vantaanportti",
      "Vantaa — Postin automaatti, St1 Vantaa Ruskeasanta",
      "Vantaa — Postin automaatti, Ulkoautomaatti Vantaa Tikkurila Peltolantie",
      "Tampere — Postin automaatti, Koskikeskus Tampere",
      "Tampere — Postin automaatti, Lidl Tampere Tesoma",
      "Tampere — Postin automaatti, Sokos Tampere 4 krs.",
      "Tampere — Postin automaatti, Stockmann Tampere",
      "Turku — Postin automaatti, Lidl Turku keskusta",
      "Turku — Postin automaatti, Lidl Turku Kärsämäki",
      "Turku — Postin automaatti, Posti Yrityspiste Turku",
      "Turku — Postin automaatti, Prisma Tampereentie",
      "Turku — Postin automaatti, St1 Turku Sata1",
      "Oulu — Postin automaatti, S-market Herkku Oulu",
      "Oulu — Postin automaatti, Sale Mäntylä Oulu",
      "Oulu — Postin automaatti, Ulkoautomaatti K-Kasarmi Oulu",
      "Lahti — Posti, K-Citymarket Lahti Paavola",
      "Lahti — Postin automaatti, Prisma Holma Lahti",
      "Lahti — Postin automaatti, Sokos Lahti",
      "Jyväskylä — Posti, K-Citymarket Jyväskylä Seppälä",
      "Palokka — Postin automaatti, Kärkkäinen Jyväskylä",
      "Kuopio — Posti, K-Citymarket Kuopio Päiväranta",
      "Kuopio — Postin automaatti, Lidl Kuopio-Inkilänmäki",
      "Pori — Postin automaatti, S-market Herkku Pori",
      "Pori — Postin automaatti, Sokos Pori",
      "Joensuu — Posti, K-Citymarket Joensuu keskusta",
      "Joensuu — Postin automaatti, Prisma Joensuu",
      "Rovaniemi — Postin automaatti, Minimani Rovaniemi"
      ]
    }
  },

  /* ==========================================================================
     3. ENDPOINTS THAT FAILED (checked 2026-08-27) — so nobody retries them
     ========================================================================== */
  deadEndpoints: [
    { url: 'https://iseteenindus.smartpost.ee/api/?request=destinations&country=EE&type=APT&responseType=json', result: 'TCP connect timeout — host no longer serves' },
    { url: 'https://locationsapi.smartpost.ee/', result: 'DNS: no such host' },
    { url: 'https://api.smartpost.ee/', result: 'DNS: no such host' },
    { url: 'https://locationservice.posti.com/api/2/location?countryCode=FI', result: 'DNS: name does not exist — Posti decommissioned the host although api.posti.fi still publishes the PDF documenting it' },
    { url: 'https://api.dpd.ee/', result: 'DNS: no such host' },
    { url: 'https://parcelshop.dpd.ee/, https://tracking.dpd.ee/', result: 'DNS: no such host' },
    { url: 'https://www.dpd.com/lv/lv/... and /lt/lt/... pickup lists', result: 'HTTP 200 but the point list is rendered client-side; no open JSON endpoint found. No API key was requested/attempted.' }
  ]
};

/* Node/bundler friendly, harmless in a plain <script> tag. */
if (typeof module !== 'undefined' && module.exports) { module.exports = SHIPPING_DATA; }
