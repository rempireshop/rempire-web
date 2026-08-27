/* Catalogue built from the live rempireshop.com data. Images are local and
   background-stripped — see tools/build-catalogue.mjs. Prototype use. */
const CAT_NAMES = {
  "hair": "Уход за волосами",
  "styling": "Стайлинг",
  "beard": "Уход за бородой",
  "face": "Уход за лицом",
  "body": "Уход за телом",
  "perfume": "Парфюмерия",
  "merch": "Мерч"
};
const CATALOGUE = [
  {
    "id": "system-4-bio-botanical-shampoo",
    "brand": "System 4",
    "name": "Bio Botanical Shampoo — шампунь",
    "cat": "hair",
    "price": 9,
    "priceFrom": true,
    "img": "img/system-4-bio-botanical-shampoo-0.webp",
    "img2": "img/system-4-bio-botanical-shampoo-1.webp",
    "gallery": [
      "img/system-4-bio-botanical-shampoo-0.webp",
      "img/system-4-bio-botanical-shampoo-1.webp",
      "img/system-4-bio-botanical-shampoo-2.webp"
    ],
    "sizes": [
      "75 мл",
      "250 мл",
      "500 мл"
    ],
    "varImg": [
      0,
      1,
      2
    ],
    "prices": [
      9,
      16,
      25
    ],
    "stock": "in"
  },
  {
    "id": "system-4-bio-botanical-serum",
    "brand": "System 4",
    "name": "Bio Botanical Serum",
    "cat": "hair",
    "price": 8,
    "priceFrom": true,
    "img": "img/system-4-bio-botanical-serum-0.webp",
    "img2": "img/system-4-bio-botanical-serum-1.webp",
    "gallery": [
      "img/system-4-bio-botanical-serum-0.webp",
      "img/system-4-bio-botanical-serum-1.webp",
      "img/system-4-bio-botanical-serum-2.webp"
    ],
    "sizes": [
      "50 мл",
      "150 мл",
      "500 мл"
    ],
    "varImg": [
      0,
      1,
      2
    ],
    "prices": [
      8,
      16,
      25
    ],
    "stock": "in"
  },
  {
    "id": "sim-sensitive-system-4-oil-cure-scalp-treatment-o",
    "brand": "System 4",
    "name": "Oil Cure Scalp Treatment O",
    "cat": "hair",
    "price": 7.9,
    "priceFrom": true,
    "img": "img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-0.webp",
    "img2": "img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-1.webp",
    "gallery": [
      "img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-0.webp",
      "img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-1.webp",
      "img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-2.webp"
    ],
    "sizes": [
      "75 мл",
      "150 мл",
      "500 мл"
    ],
    "varImg": [
      0,
      1,
      2
    ],
    "prices": [
      7.9,
      13.9,
      19.9
    ],
    "stock": "in"
  },
  {
    "id": "touchable",
    "brand": "Kevin.Murphy",
    "name": "Touchable",
    "cat": "hair",
    "price": 27,
    "priceFrom": false,
    "img": "img/touchable-0.webp",
    "img2": "img/touchable-0.webp",
    "gallery": [
      "img/touchable-0.webp"
    ],
    "sizes": [
      "250 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "repair-me-wash",
    "brand": "Kevin.Murphy",
    "name": "Repair-Me.Wash — шампунь",
    "cat": "hair",
    "price": 7,
    "priceFrom": true,
    "img": "img/repair-me-wash-0.webp",
    "img2": "img/repair-me-wash-1.webp",
    "gallery": [
      "img/repair-me-wash-0.webp",
      "img/repair-me-wash-1.webp"
    ],
    "sizes": [
      "250 мл",
      "40 мл"
    ],
    "varImg": [
      0,
      1
    ],
    "prices": [
      27,
      7
    ],
    "stock": "in"
  },
  {
    "id": "kevin-murphy-un-tangled-spray",
    "brand": "Kevin.Murphy",
    "name": "Un.Tangled Spray — спрей для волос",
    "cat": "hair",
    "price": 8,
    "priceFrom": true,
    "img": "img/kevin-murphy-un-tangled-spray-0.webp",
    "img2": "img/kevin-murphy-un-tangled-spray-1.webp",
    "gallery": [
      "img/kevin-murphy-un-tangled-spray-0.webp",
      "img/kevin-murphy-un-tangled-spray-1.webp"
    ],
    "sizes": [
      "150 мл",
      "40 мл"
    ],
    "varImg": [
      0,
      0
    ],
    "prices": [
      28,
      8
    ],
    "stock": "in"
  },
  {
    "id": "night-rider",
    "brand": "Kevin.Murphy",
    "name": "Night.Rider — паста для укладки",
    "cat": "hair",
    "price": 11,
    "priceFrom": true,
    "img": "img/night-rider-0.webp",
    "img2": "img/night-rider-1.webp",
    "gallery": [
      "img/night-rider-0.webp",
      "img/night-rider-1.webp"
    ],
    "sizes": [
      "100g",
      "30g"
    ],
    "varImg": [
      0,
      1
    ],
    "prices": [
      28,
      11
    ],
    "stock": "in"
  },
  {
    "id": "free-hold",
    "brand": "Kevin.Murphy",
    "name": "Free.Hold",
    "cat": "hair",
    "price": 11,
    "priceFrom": true,
    "img": "img/free-hold-0.webp",
    "img2": "img/free-hold-1.webp",
    "gallery": [
      "img/free-hold-0.webp",
      "img/free-hold-1.webp"
    ],
    "sizes": [
      "100g",
      "30g"
    ],
    "varImg": [
      0,
      1
    ],
    "prices": [
      28,
      11
    ],
    "stock": "in"
  },
  {
    "id": "killer-curls-rinse",
    "brand": "Kevin.Murphy",
    "name": "Killer.Curls Rinse — кондиционер",
    "cat": "hair",
    "price": 6,
    "priceFrom": true,
    "img": "img/killer-curls-rinse-0.webp",
    "img2": "img/killer-curls-rinse-1.webp",
    "gallery": [
      "img/killer-curls-rinse-0.webp",
      "img/killer-curls-rinse-1.webp"
    ],
    "sizes": [
      "250 мл",
      "40 мл"
    ],
    "varImg": [
      0,
      0
    ],
    "prices": [
      27,
      6
    ],
    "stock": "in"
  },
  {
    "id": "killer-curls-wash",
    "brand": "Kevin.Murphy",
    "name": "Killer.Curls Wash — шампунь",
    "cat": "hair",
    "price": 6,
    "priceFrom": true,
    "img": "img/killer-curls-wash-0.webp",
    "img2": "img/killer-curls-wash-1.webp",
    "gallery": [
      "img/killer-curls-wash-0.webp",
      "img/killer-curls-wash-1.webp"
    ],
    "sizes": [
      "250 мл",
      "40 мл"
    ],
    "varImg": [
      0,
      0
    ],
    "prices": [
      27,
      6
    ],
    "stock": "in"
  },
  {
    "id": "system-4-mild-shampoo-3",
    "brand": "System 4",
    "name": "Mild Shampoo 3 — шампунь",
    "cat": "hair",
    "price": 7.9,
    "priceFrom": true,
    "img": "img/system-4-mild-shampoo-3-0.webp",
    "img2": "img/system-4-mild-shampoo-3-1.webp",
    "gallery": [
      "img/system-4-mild-shampoo-3-0.webp",
      "img/system-4-mild-shampoo-3-1.webp",
      "img/system-4-mild-shampoo-3-2.webp"
    ],
    "sizes": [
      "75 мл",
      "250 мл",
      "500 мл"
    ],
    "varImg": [
      0,
      1,
      2
    ],
    "prices": [
      7.9,
      13.9,
      19.9
    ],
    "stock": "in"
  },
  {
    "id": "sim-sensitive-system-4-scalp-tonic-t",
    "brand": "System 4",
    "name": "Scalp Tonic T",
    "cat": "hair",
    "price": 7.9,
    "priceFrom": true,
    "img": "img/sim-sensitive-system-4-scalp-tonic-t-0.webp",
    "img2": "img/sim-sensitive-system-4-scalp-tonic-t-1.webp",
    "gallery": [
      "img/sim-sensitive-system-4-scalp-tonic-t-0.webp",
      "img/sim-sensitive-system-4-scalp-tonic-t-1.webp",
      "img/sim-sensitive-system-4-scalp-tonic-t-2.webp"
    ],
    "sizes": [
      "50 мл",
      "150 мл",
      "500 мл"
    ],
    "varImg": [
      0,
      1,
      2
    ],
    "prices": [
      7.9,
      13.9,
      19.9
    ],
    "stock": "in"
  },
  {
    "id": "system-4-hydro-care-conditioner-h",
    "brand": "System 4",
    "name": "Hydro Care Conditioner H",
    "cat": "hair",
    "price": 6.9,
    "priceFrom": true,
    "img": "img/system-4-hydro-care-conditioner-h-0.webp",
    "img2": "img/system-4-hydro-care-conditioner-h-1.webp",
    "gallery": [
      "img/system-4-hydro-care-conditioner-h-0.webp",
      "img/system-4-hydro-care-conditioner-h-1.webp"
    ],
    "sizes": [
      "75 мл",
      "150 мл",
      "500 мл"
    ],
    "varImg": [
      0,
      0,
      0
    ],
    "prices": [
      6.9,
      13.9,
      19.9
    ],
    "stock": "in"
  },
  {
    "id": "kevin-murphy-motion-lotion",
    "brand": "Kevin.Murphy",
    "name": "Motion.Lotion",
    "cat": "hair",
    "price": 26,
    "priceFrom": false,
    "img": "img/kevin-murphy-motion-lotion-0.webp",
    "img2": "img/kevin-murphy-motion-lotion-0.webp",
    "gallery": [
      "img/kevin-murphy-motion-lotion-0.webp"
    ],
    "sizes": [
      "150 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "sim-sensitive-system-4-chitosan-hair-repair-r",
    "brand": "System 4",
    "name": "Chitosan Hair Repair R — спрей для волос",
    "cat": "hair",
    "price": 7.9,
    "priceFrom": true,
    "img": "img/sim-sensitive-system-4-chitosan-hair-repair-r-0.webp",
    "img2": "img/sim-sensitive-system-4-chitosan-hair-repair-r-1.webp",
    "gallery": [
      "img/sim-sensitive-system-4-chitosan-hair-repair-r-0.webp",
      "img/sim-sensitive-system-4-chitosan-hair-repair-r-1.webp"
    ],
    "sizes": [
      "50 мл",
      "150 мл"
    ],
    "varImg": [
      0,
      1
    ],
    "prices": [
      7.9,
      13.9
    ],
    "stock": "in"
  },
  {
    "id": "kevin-murphy-blow-dry-wash",
    "brand": "Kevin.Murphy",
    "name": "Blow.Dry Wash — шампунь",
    "cat": "hair",
    "price": 6,
    "priceFrom": true,
    "img": "img/kevin-murphy-blow-dry-wash-0.webp",
    "img2": "img/kevin-murphy-blow-dry-wash-1.webp",
    "gallery": [
      "img/kevin-murphy-blow-dry-wash-0.webp",
      "img/kevin-murphy-blow-dry-wash-1.webp"
    ],
    "sizes": [
      "40 мл",
      "250 мл"
    ],
    "varImg": [
      0,
      1
    ],
    "prices": [
      6,
      28
    ],
    "stock": "in"
  },
  {
    "id": "hair-resort-spray",
    "brand": "Kevin.Murphy",
    "name": "Hair.Resort.Spray",
    "cat": "hair",
    "price": 8,
    "priceFrom": true,
    "img": "img/hair-resort-spray-0.webp",
    "img2": "img/hair-resort-spray-1.webp",
    "gallery": [
      "img/hair-resort-spray-0.webp",
      "img/hair-resort-spray-1.webp"
    ],
    "sizes": [
      "150 мл",
      "40 мл"
    ],
    "varImg": [
      0,
      0
    ],
    "prices": [
      26,
      8
    ],
    "stock": "in"
  },
  {
    "id": "rough-rider",
    "brand": "Kevin.Murphy",
    "name": "Rough.Rider",
    "cat": "hair",
    "price": 11,
    "priceFrom": true,
    "img": "img/rough-rider-0.webp",
    "img2": "img/rough-rider-1.webp",
    "gallery": [
      "img/rough-rider-0.webp",
      "img/rough-rider-1.webp"
    ],
    "sizes": [
      "100g",
      "30g"
    ],
    "varImg": [
      0,
      1
    ],
    "prices": [
      28,
      11
    ],
    "stock": "in"
  },
  {
    "id": "maxi-wash",
    "brand": "Kevin.Murphy",
    "name": "Maxi.Wash — шампунь",
    "cat": "hair",
    "price": 7,
    "priceFrom": true,
    "img": "img/maxi-wash-0.webp",
    "img2": "img/maxi-wash-1.webp",
    "gallery": [
      "img/maxi-wash-0.webp",
      "img/maxi-wash-1.webp"
    ],
    "sizes": [
      "250 мл",
      "40 мл"
    ],
    "varImg": [
      0,
      1
    ],
    "prices": [
      26,
      7
    ],
    "stock": "in"
  },
  {
    "id": "system-4-bio-botanical-vital-cure",
    "brand": "System 4",
    "name": "Bio Botanical Vital Cure — кондиционер",
    "cat": "hair",
    "price": 16,
    "priceFrom": true,
    "img": "img/system-4-bio-botanical-vital-cure-0.webp",
    "img2": "img/system-4-bio-botanical-vital-cure-1.webp",
    "gallery": [
      "img/system-4-bio-botanical-vital-cure-0.webp",
      "img/system-4-bio-botanical-vital-cure-1.webp"
    ],
    "sizes": [
      "150 мл",
      "500 мл"
    ],
    "varImg": [
      0,
      1
    ],
    "prices": [
      16,
      26
    ],
    "stock": "in"
  },
  {
    "id": "system-4-balancing-shampoo-2",
    "brand": "System 4",
    "name": "Balancing Shampoo 2 — шампунь",
    "cat": "hair",
    "price": 7.9,
    "priceFrom": true,
    "img": "img/system-4-balancing-shampoo-2-0.webp",
    "img2": "img/system-4-balancing-shampoo-2-1.webp",
    "gallery": [
      "img/system-4-balancing-shampoo-2-0.webp",
      "img/system-4-balancing-shampoo-2-1.webp",
      "img/system-4-balancing-shampoo-2-2.webp"
    ],
    "sizes": [
      "75 мл",
      "250 мл",
      "500 мл"
    ],
    "varImg": [
      0,
      1,
      2
    ],
    "prices": [
      7.9,
      13.9,
      19.9
    ],
    "stock": "in"
  },
  {
    "id": "system-4-special-shampoo-1",
    "brand": "System 4",
    "name": "Special Shampoo 1 — шампунь",
    "cat": "hair",
    "price": 7.9,
    "priceFrom": true,
    "img": "img/system-4-special-shampoo-1-0.webp",
    "img2": "img/system-4-special-shampoo-1-1.webp",
    "gallery": [
      "img/system-4-special-shampoo-1-0.webp",
      "img/system-4-special-shampoo-1-1.webp",
      "img/system-4-special-shampoo-1-2.webp"
    ],
    "sizes": [
      "75 мл",
      "250 мл",
      "500 мл"
    ],
    "varImg": [
      0,
      1,
      2
    ],
    "prices": [
      7.9,
      13.9,
      19.9
    ],
    "stock": "in"
  },
  {
    "id": "gatsby-moving-rubber-grunge-mat-grey-hair-wax",
    "brand": "Gatsby",
    "name": "Moving Rubber Grunge Mat (Grey) Hair Wax — паста для укладки",
    "cat": "styling",
    "price": 15,
    "priceFrom": false,
    "img": "img/gatsby-moving-rubber-grunge-mat-grey-hair-wax-0.webp",
    "img2": "img/gatsby-moving-rubber-grunge-mat-grey-hair-wax-0.webp",
    "gallery": [
      "img/gatsby-moving-rubber-grunge-mat-grey-hair-wax-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "out"
  },
  {
    "id": "kevin-murphy-killer-twirls",
    "brand": "Kevin.Murphy",
    "name": "Killer.Twirls",
    "cat": "styling",
    "price": 26,
    "priceFrom": false,
    "img": "img/kevin-murphy-killer-twirls-0.webp",
    "img2": "img/kevin-murphy-killer-twirls-0.webp",
    "gallery": [
      "img/kevin-murphy-killer-twirls-0.webp"
    ],
    "sizes": [
      "150 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "easy-rider",
    "brand": "Kevin.Murphy",
    "name": "Easy.Rider",
    "cat": "styling",
    "price": 28,
    "priceFrom": false,
    "img": "img/easy-rider-0.webp",
    "img2": "img/easy-rider-0.webp",
    "gallery": [
      "img/easy-rider-0.webp"
    ],
    "sizes": [
      "100g"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "gatsby-moving-rubber-wild-shake-15g",
    "brand": "Gatsby",
    "name": "Moving Rubber Wild Shake",
    "cat": "styling",
    "price": 15,
    "priceFrom": false,
    "img": "img/gatsby-moving-rubber-wild-shake-15g-0.webp",
    "img2": "img/gatsby-moving-rubber-wild-shake-15g-0.webp",
    "gallery": [
      "img/gatsby-moving-rubber-wild-shake-15g-0.webp"
    ],
    "sizes": [
      "80G"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "mandom-gatsby-moving-rubber",
    "brand": "Mandom",
    "name": "Gatsby Moving Rubber — паста для укладки",
    "cat": "styling",
    "price": 15,
    "priceFrom": false,
    "img": "img/mandom-gatsby-moving-rubber-0.webp",
    "img2": "img/mandom-gatsby-moving-rubber-0.webp",
    "gallery": [
      "img/mandom-gatsby-moving-rubber-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "killer-curls",
    "brand": "Kevin.Murphy",
    "name": "Killer.Curls",
    "cat": "styling",
    "price": 33,
    "priceFrom": false,
    "img": "img/killer-curls-0.webp",
    "img2": "img/killer-curls-0.webp",
    "gallery": [
      "img/killer-curls-0.webp"
    ],
    "sizes": [
      "200 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "super-goo",
    "brand": "Kevin.Murphy",
    "name": "Super.Goo",
    "cat": "styling",
    "price": 28,
    "priceFrom": false,
    "img": "img/super-goo-0.webp",
    "img2": "img/super-goo-0.webp",
    "gallery": [
      "img/super-goo-0.webp"
    ],
    "sizes": [
      "100g"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "body-builder",
    "brand": "Kevin.Murphy",
    "name": "Body.Builder",
    "cat": "styling",
    "price": 18,
    "priceFrom": true,
    "img": "img/body-builder-0.webp",
    "img2": "img/body-builder-1.webp",
    "gallery": [
      "img/body-builder-0.webp",
      "img/body-builder-1.webp"
    ],
    "sizes": [
      "400",
      "100"
    ],
    "varImg": [
      0,
      1
    ],
    "prices": [
      27,
      18
    ],
    "stock": "in"
  },
  {
    "id": "paul-mitchell-mitch-construction-paste-flexible-styling-paste",
    "brand": "Paul Mitchell",
    "name": "MITCH Construction Paste Flexible Styling Paste — паста для укладки",
    "cat": "styling",
    "price": 23,
    "priceFrom": false,
    "img": "img/paul-mitchell-mitch-construction-paste-flexible-styling-paste-0.webp",
    "img2": "img/paul-mitchell-mitch-construction-paste-flexible-styling-paste-0.webp",
    "gallery": [
      "img/paul-mitchell-mitch-construction-paste-flexible-styling-paste-0.webp"
    ],
    "sizes": [
      "75 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "paul-mitchell-super-skinny-serum",
    "brand": "Paul Mitchell",
    "name": "Super Skinny Serum — сыворотка для волос",
    "cat": "styling",
    "price": 35,
    "priceFrom": false,
    "img": "img/paul-mitchell-super-skinny-serum-0.webp",
    "img2": "img/paul-mitchell-super-skinny-serum-0.webp",
    "gallery": [
      "img/paul-mitchell-super-skinny-serum-0.webp"
    ],
    "sizes": [
      "150 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "paul-mitchell-clear-styling-glaze",
    "brand": "Paul Mitchell",
    "name": "Clear Styling Glaze — глазурь для волос",
    "cat": "styling",
    "price": 26,
    "priceFrom": false,
    "img": "img/paul-mitchell-clear-styling-glaze-0.webp",
    "img2": "img/paul-mitchell-clear-styling-glaze-0.webp",
    "gallery": [
      "img/paul-mitchell-clear-styling-glaze-0.webp"
    ],
    "sizes": [
      "150 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "paul-mitchell-mitch-steady-grip-styling-gel",
    "brand": "Paul Mitchell",
    "name": "MITCH Steady Grip Styling Gel — гель для укладки",
    "cat": "styling",
    "price": 23,
    "priceFrom": false,
    "img": "img/paul-mitchell-mitch-steady-grip-styling-gel-0.webp",
    "img2": "img/paul-mitchell-mitch-steady-grip-styling-gel-0.webp",
    "gallery": [
      "img/paul-mitchell-mitch-steady-grip-styling-gel-0.webp"
    ],
    "sizes": [
      "150 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "powder-puff",
    "brand": "Kevin.Murphy",
    "name": "Powder.Puff — пудра для волос",
    "cat": "styling",
    "price": 30,
    "priceFrom": false,
    "img": "img/powder-puff-0.webp",
    "img2": "img/powder-puff-0.webp",
    "gallery": [
      "img/powder-puff-0.webp"
    ],
    "sizes": [
      "14g"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "kevin-murphy-full-again",
    "brand": "Kevin.Murphy",
    "name": "Full.Again",
    "cat": "styling",
    "price": 27,
    "priceFrom": false,
    "img": "img/kevin-murphy-full-again-0.webp",
    "img2": "img/kevin-murphy-full-again-0.webp",
    "gallery": [
      "img/kevin-murphy-full-again-0.webp"
    ],
    "sizes": [
      "150 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "hair-resort",
    "brand": "Kevin.Murphy",
    "name": "Hair.Resort",
    "cat": "styling",
    "price": 26,
    "priceFrom": false,
    "img": "img/hair-resort-0.webp",
    "img2": "img/hair-resort-0.webp",
    "gallery": [
      "img/hair-resort-0.webp"
    ],
    "sizes": [
      "150 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "davines-pasta-love-strong-hold-mat-clay",
    "brand": "Davines",
    "name": "Pasta&Love Strong Hold Mat Clay",
    "cat": "styling",
    "price": 24.5,
    "priceFrom": false,
    "img": "img/davines-pasta-love-strong-hold-mat-clay-0.webp",
    "img2": "img/davines-pasta-love-strong-hold-mat-clay-0.webp",
    "gallery": [
      "img/davines-pasta-love-strong-hold-mat-clay-0.webp"
    ],
    "sizes": [
      "50 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "proraso-wood-spice-beard-balm-100ml",
    "brand": "Proraso",
    "name": "Wood & Spice Beard Balm — лосьон после бритья",
    "cat": "beard",
    "price": 16,
    "priceFrom": false,
    "img": "img/proraso-wood-spice-beard-balm-100ml-0.webp",
    "img2": "img/proraso-wood-spice-beard-balm-100ml-0.webp",
    "gallery": [
      "img/proraso-wood-spice-beard-balm-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "captain-fawcett-beard-oil-cf-332-private-stock",
    "brand": "Captain Fawcett",
    "name": "(CF.332) Private Stock Beard Oil — масло для бороды",
    "cat": "beard",
    "price": 17,
    "priceFrom": false,
    "img": "img/captain-fawcett-beard-oil-cf-332-private-stock-0.webp",
    "img2": "img/captain-fawcett-beard-oil-cf-332-private-stock-1.webp",
    "gallery": [
      "img/captain-fawcett-beard-oil-cf-332-private-stock-0.webp",
      "img/captain-fawcett-beard-oil-cf-332-private-stock-1.webp"
    ],
    "sizes": [
      "10 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "out"
  },
  {
    "id": "proraso-azur-lime-after-shave-balm-100-ml",
    "brand": "Proraso",
    "name": "Azur Lime After Shave Balm — лосьон после бритья",
    "cat": "beard",
    "price": 16,
    "priceFrom": false,
    "img": "img/proraso-azur-lime-after-shave-balm-100-ml-0.webp",
    "img2": "img/proraso-azur-lime-after-shave-balm-100-ml-0.webp",
    "gallery": [
      "img/proraso-azur-lime-after-shave-balm-100-ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml",
    "brand": "Proraso",
    "name": "White Aftershave Balm | Soothing For Sensitive Skin — лосьон после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "img/proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml-0.webp",
    "img2": "img/proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml-0.webp",
    "gallery": [
      "img/proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml",
    "brand": "Proraso",
    "name": "Blue Protect Aftershave Balm | Aloe and Vitamin E — лосьон после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "img/proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml-0.webp",
    "img2": "img/proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml-0.webp",
    "gallery": [
      "img/proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-aftershave-balm-green-refreshing-alcohol-free-mentholated-100ml",
    "brand": "Proraso",
    "name": "Aftershave Balm - Green Refreshing | Alcohol Free Mentholated — лосьон после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "img/proraso-aftershave-balm-green-refreshing-alcohol-free-mentholated-100ml-0.webp",
    "img2": "img/proraso-aftershave-balm-green-refreshing-alcohol-free-mentholated-100ml-0.webp",
    "gallery": [
      "img/proraso-aftershave-balm-green-refreshing-alcohol-free-mentholated-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-red-nourishing-aftershave-lotion-100ml",
    "brand": "Proraso",
    "name": "Red Nourishing Aftershave Lotion — лосьон после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "img/proraso-red-nourishing-aftershave-lotion-100ml-0.webp",
    "img2": "img/proraso-red-nourishing-aftershave-lotion-100ml-0.webp",
    "gallery": [
      "img/proraso-red-nourishing-aftershave-lotion-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml",
    "brand": "Proraso",
    "name": "Green Refreshing Aftershave Lotion | Menthol Splash — лосьон после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "img/proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml-0.webp",
    "img2": "img/proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml-0.webp",
    "gallery": [
      "img/proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-beard-oil-azur-lime-30ml",
    "brand": "Proraso",
    "name": "Beard Oil Azur Lime — масло для бороды",
    "cat": "beard",
    "price": 15,
    "priceFrom": false,
    "img": "img/proraso-beard-oil-azur-lime-30ml-0.webp",
    "img2": "img/proraso-beard-oil-azur-lime-30ml-0.webp",
    "gallery": [
      "img/proraso-beard-oil-azur-lime-30ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-beard-oil-green-refreshing-30ml",
    "brand": "Proraso",
    "name": "Beard Oil Green Refreshing — масло для бороды",
    "cat": "beard",
    "price": 15,
    "priceFrom": false,
    "img": "img/proraso-beard-oil-green-refreshing-30ml-0.webp",
    "img2": "img/proraso-beard-oil-green-refreshing-30ml-0.webp",
    "gallery": [
      "img/proraso-beard-oil-green-refreshing-30ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-beard-oil-cypress-vetyver-30ml",
    "brand": "Proraso",
    "name": "Beard Oil Cypress Vetyver — масло для бороды",
    "cat": "beard",
    "price": 15,
    "priceFrom": false,
    "img": "img/proraso-beard-oil-cypress-vetyver-30ml-0.webp",
    "img2": "img/proraso-beard-oil-cypress-vetyver-30ml-0.webp",
    "gallery": [
      "img/proraso-beard-oil-cypress-vetyver-30ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml",
    "brand": "Proraso",
    "name": "Beard Oil Wood Spice | Cedar Wood Citrus Fragrance — масло для бороды",
    "cat": "beard",
    "price": 15,
    "priceFrom": false,
    "img": "img/proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml-0.webp",
    "img2": "img/proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml-0.webp",
    "gallery": [
      "img/proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "davines-pre-shaving-beard-oil",
    "brand": "Davines",
    "name": "Pasta&Love Pre-Shaving & Beard Oil",
    "cat": "beard",
    "price": 22,
    "priceFrom": false,
    "img": "img/davines-pre-shaving-beard-oil-0.webp",
    "img2": "img/davines-pre-shaving-beard-oil-0.webp",
    "gallery": [
      "img/davines-pre-shaving-beard-oil-0.webp"
    ],
    "sizes": [
      "50 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "davines-softening-shaving-gel",
    "brand": "Davines",
    "name": "Pasta&Love Softening Shaving Gel — гель для бритья",
    "cat": "beard",
    "price": 23.5,
    "priceFrom": false,
    "img": "img/davines-softening-shaving-gel-0.webp",
    "img2": "img/davines-softening-shaving-gel-0.webp",
    "gallery": [
      "img/davines-softening-shaving-gel-0.webp"
    ],
    "sizes": [
      "200 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "davines-non-foaming-transparent-shaving-gel",
    "brand": "Davines",
    "name": "Pasta&Love Non-Foaming Transparent Shaving Gel — гель для бритья",
    "cat": "beard",
    "price": 24.5,
    "priceFrom": false,
    "img": "img/davines-non-foaming-transparent-shaving-gel-0.webp",
    "img2": "img/davines-non-foaming-transparent-shaving-gel-0.webp",
    "gallery": [
      "img/davines-non-foaming-transparent-shaving-gel-0.webp"
    ],
    "sizes": [
      "150 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "davines-medium-hold-styling-paste",
    "brand": "Davines",
    "name": "Pasta&Love Medium Hold Styling Paste",
    "cat": "beard",
    "price": 24.5,
    "priceFrom": false,
    "img": "img/davines-medium-hold-styling-paste-0.webp",
    "img2": "img/davines-medium-hold-styling-paste-0.webp",
    "gallery": [
      "img/davines-medium-hold-styling-paste-0.webp"
    ],
    "sizes": [
      "125 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "cosrx-full-fit-propolis-synergy-toner",
    "brand": "Cosrx",
    "name": "Full Fit Propolis Synergy Toner — тоник",
    "cat": "face",
    "price": 16.75,
    "priceFrom": false,
    "img": "img/cosrx-full-fit-propolis-synergy-toner-0.webp",
    "img2": "img/cosrx-full-fit-propolis-synergy-toner-0.webp",
    "gallery": [
      "img/cosrx-full-fit-propolis-synergy-toner-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "anua-heartleaf-pore-control-cleansing-oil",
    "brand": "Anua",
    "name": "Heartleaf Pore Control Cleansing Oil",
    "cat": "face",
    "price": 22.8,
    "priceFrom": false,
    "img": "img/anua-heartleaf-pore-control-cleansing-oil-0.webp",
    "img2": "img/anua-heartleaf-pore-control-cleansing-oil-0.webp",
    "gallery": [
      "img/anua-heartleaf-pore-control-cleansing-oil-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "cosrx-aha-bha-clarifying-treatment-toner",
    "brand": "Cosrx",
    "name": "AHA/BHA Clarifying Treatment Toner — тоник",
    "cat": "face",
    "price": 16.75,
    "priceFrom": false,
    "img": "img/cosrx-aha-bha-clarifying-treatment-toner-0.webp",
    "img2": "img/cosrx-aha-bha-clarifying-treatment-toner-0.webp",
    "gallery": [
      "img/cosrx-aha-bha-clarifying-treatment-toner-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "cosrx-low-ph-good-morning-gel-cleanser",
    "brand": "Cosrx",
    "name": "Low Ph Good Morning Gel Cleanser",
    "cat": "face",
    "price": 11.15,
    "priceFrom": false,
    "img": "img/cosrx-low-ph-good-morning-gel-cleanser-0.webp",
    "img2": "img/cosrx-low-ph-good-morning-gel-cleanser-0.webp",
    "gallery": [
      "img/cosrx-low-ph-good-morning-gel-cleanser-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "anua-bha-2-gentle-exfoliating-toner-150ml",
    "brand": "Anua",
    "name": "BHA 2% Gentle Exfoliating Toner — тоник",
    "cat": "face",
    "price": 21.39,
    "priceFrom": false,
    "img": "img/anua-bha-2-gentle-exfoliating-toner-150ml-0.webp",
    "img2": "img/anua-bha-2-gentle-exfoliating-toner-150ml-0.webp",
    "gallery": [
      "img/anua-bha-2-gentle-exfoliating-toner-150ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "anua-niacinamide-10-txa-4-serum",
    "brand": "Anua",
    "name": "Niacinamide 10% + TXA 4% Serum — сыворотка для лица",
    "cat": "face",
    "price": 23.99,
    "priceFrom": false,
    "img": "img/anua-niacinamide-10-txa-4-serum-0.webp",
    "img2": "img/anua-niacinamide-10-txa-4-serum-0.webp",
    "gallery": [
      "img/anua-niacinamide-10-txa-4-serum-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "anua-heartleaf-quercetinol-pore-deep-cleansing-foam",
    "brand": "Anua",
    "name": "Heartleaf Quercetinol Pore Deep Cleansing Foam — пенка для умывания",
    "cat": "face",
    "price": 18,
    "priceFrom": false,
    "img": "img/anua-heartleaf-quercetinol-pore-deep-cleansing-foam-0.webp",
    "img2": "img/anua-heartleaf-quercetinol-pore-deep-cleansing-foam-0.webp",
    "gallery": [
      "img/anua-heartleaf-quercetinol-pore-deep-cleansing-foam-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "cosrx-advanced-snail-92-all-in-one-cream",
    "brand": "Cosrx",
    "name": "Advanced Snail 92 All in One Cream — крем для лица",
    "cat": "face",
    "price": 22.99,
    "priceFrom": false,
    "img": "img/cosrx-advanced-snail-92-all-in-one-cream-0.webp",
    "img2": "img/cosrx-advanced-snail-92-all-in-one-cream-0.webp",
    "gallery": [
      "img/cosrx-advanced-snail-92-all-in-one-cream-0.webp"
    ],
    "sizes": [
      "100g"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "cosrx-advanced-snail-96-mucin-power-essence",
    "brand": "Cosrx",
    "name": "Advanced Snail 96 Mucin Power Essence — крем для лица",
    "cat": "face",
    "price": 21.99,
    "priceFrom": false,
    "img": "img/cosrx-advanced-snail-96-mucin-power-essence-0.webp",
    "img2": "img/cosrx-advanced-snail-96-mucin-power-essence-0.webp",
    "gallery": [
      "img/cosrx-advanced-snail-96-mucin-power-essence-0.webp"
    ],
    "sizes": [
      "100 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "lumin-skin-recovery-oil",
    "brand": "Lumin Skin",
    "name": "Recovery Oil",
    "cat": "face",
    "price": 21.95,
    "priceFrom": false,
    "img": "img/lumin-skin-recovery-oil-0.webp",
    "img2": "img/lumin-skin-recovery-oil-1.webp",
    "gallery": [
      "img/lumin-skin-recovery-oil-0.webp",
      "img/lumin-skin-recovery-oil-1.webp"
    ],
    "sizes": [
      "8 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "lumin-skin-wrinkle-defense-serum",
    "brand": "Lumin Skin",
    "name": "Wrinkle Defense Serum — сыворотка для лица",
    "cat": "face",
    "price": 21.95,
    "priceFrom": false,
    "img": "img/lumin-skin-wrinkle-defense-serum-0.webp",
    "img2": "img/lumin-skin-wrinkle-defense-serum-1.webp",
    "gallery": [
      "img/lumin-skin-wrinkle-defense-serum-0.webp",
      "img/lumin-skin-wrinkle-defense-serum-1.webp"
    ],
    "sizes": [
      "15 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "lumin-skin-charcoal-scrub-deep-detox",
    "brand": "Lumin Skin",
    "name": "Charcoal Scrub Deep Detox",
    "cat": "face",
    "price": 18.95,
    "priceFrom": false,
    "img": "img/lumin-skin-charcoal-scrub-deep-detox-0.webp",
    "img2": "img/lumin-skin-charcoal-scrub-deep-detox-1.webp",
    "gallery": [
      "img/lumin-skin-charcoal-scrub-deep-detox-0.webp",
      "img/lumin-skin-charcoal-scrub-deep-detox-1.webp"
    ],
    "sizes": [
      "30 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "lumin-skin-charcoal-face-wash-daily-detox",
    "brand": "Lumin Skin",
    "name": "Charcoal Face Wash Daily Detox",
    "cat": "face",
    "price": 18.95,
    "priceFrom": false,
    "img": "img/lumin-skin-charcoal-face-wash-daily-detox-0.webp",
    "img2": "img/lumin-skin-charcoal-face-wash-daily-detox-1.webp",
    "gallery": [
      "img/lumin-skin-charcoal-face-wash-daily-detox-0.webp",
      "img/lumin-skin-charcoal-face-wash-daily-detox-1.webp"
    ],
    "sizes": [
      "100 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "out"
  },
  {
    "id": "lumin-skin-dark-circle-defense-balm",
    "brand": "Lumin Skin",
    "name": "Dark Circle Defense Balm — крем для век",
    "cat": "face",
    "price": 32.95,
    "priceFrom": false,
    "img": "img/lumin-skin-dark-circle-defense-balm-0.webp",
    "img2": "img/lumin-skin-dark-circle-defense-balm-1.webp",
    "gallery": [
      "img/lumin-skin-dark-circle-defense-balm-0.webp",
      "img/lumin-skin-dark-circle-defense-balm-1.webp"
    ],
    "sizes": [
      "20 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "gummy-sheet-mask-madecassoside-sticker",
    "brand": "Gummy",
    "name": "sheet mask Madecassoside sticker",
    "cat": "face",
    "price": 3,
    "priceFrom": false,
    "img": "img/gummy-sheet-mask-madecassoside-sticker-0.webp",
    "img2": "img/gummy-sheet-mask-madecassoside-sticker-0.webp",
    "gallery": [
      "img/gummy-sheet-mask-madecassoside-sticker-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "anua-heartleaf-77-soothing-toner",
    "brand": "Anua",
    "name": "Heartleaf 77% Soothing Toner — тоник",
    "cat": "face",
    "price": 6.99,
    "priceFrom": false,
    "img": "img/anua-heartleaf-77-soothing-toner-0.webp",
    "img2": "img/anua-heartleaf-77-soothing-toner-0.webp",
    "gallery": [
      "img/anua-heartleaf-77-soothing-toner-0.webp"
    ],
    "sizes": [
      "40 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "davines-hair-beard-body-wash",
    "brand": "Davines",
    "name": "Pasta&Love Hair, Beard & Body Wash",
    "cat": "body",
    "price": 24.5,
    "priceFrom": false,
    "img": "img/davines-hair-beard-body-wash-0.webp",
    "img2": "img/davines-hair-beard-body-wash-0.webp",
    "gallery": [
      "img/davines-hair-beard-body-wash-0.webp"
    ],
    "sizes": [
      "300 мл"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "handmade-soap-666",
    "brand": "Rempire",
    "name": "Handmade black soap - 666",
    "cat": "body",
    "price": 9,
    "priceFrom": false,
    "img": "img/handmade-soap-666-0.webp",
    "img2": "img/handmade-soap-666-1.webp",
    "gallery": [
      "img/handmade-soap-666-0.webp",
      "img/handmade-soap-666-1.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "handmade-soap-rule-nr-1",
    "brand": "Rempire",
    "name": "Handmade pink soap - Rule Nr 1",
    "cat": "body",
    "price": 9,
    "priceFrom": false,
    "img": "img/handmade-soap-rule-nr-1-0.webp",
    "img2": "img/handmade-soap-rule-nr-1-1.webp",
    "gallery": [
      "img/handmade-soap-rule-nr-1-0.webp",
      "img/handmade-soap-rule-nr-1-1.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "xerjoff-tony-iommi-monkey-special-50ml",
    "brand": "Xerjoff",
    "name": "Tony Iommi Monkey Special — парфюм",
    "cat": "perfume",
    "price": 190,
    "priceFrom": false,
    "img": "img/xerjoff-tony-iommi-monkey-special-50ml-0.webp",
    "img2": "img/xerjoff-tony-iommi-monkey-special-50ml-0.webp",
    "gallery": [
      "img/xerjoff-tony-iommi-monkey-special-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "xerjoff-1861-naxos-eau-de-parfum-100ml",
    "brand": "Xerjoff",
    "name": "1861 Naxos Eau de Parfum — парфюм",
    "cat": "perfume",
    "price": 190,
    "priceFrom": false,
    "img": "img/xerjoff-1861-naxos-eau-de-parfum-100ml-0.webp",
    "img2": "img/xerjoff-1861-naxos-eau-de-parfum-100ml-0.webp",
    "gallery": [
      "img/xerjoff-1861-naxos-eau-de-parfum-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "creed-aventus-eau-de-parfum-for-men-50ml",
    "brand": "Creed",
    "name": "Aventus Eau de Parfum for Men — парфюм",
    "cat": "perfume",
    "price": 199,
    "priceFrom": false,
    "img": "img/creed-aventus-eau-de-parfum-for-men-50ml-0.webp",
    "img2": "img/creed-aventus-eau-de-parfum-for-men-50ml-0.webp",
    "gallery": [
      "img/creed-aventus-eau-de-parfum-for-men-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "creed-creed-aventus-cologne-50ml",
    "brand": "Creed",
    "name": "Aventus Cologne — парфюм",
    "cat": "perfume",
    "price": 185,
    "priceFrom": false,
    "img": "img/creed-creed-aventus-cologne-50ml-0.webp",
    "img2": "img/creed-creed-aventus-cologne-50ml-0.webp",
    "gallery": [
      "img/creed-creed-aventus-cologne-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "tom-ford-tobacco-vanille-eau-de-parfum-50ml",
    "brand": "Tom Ford",
    "name": "Tobacco Vanille Eau de Parfum — парфюм",
    "cat": "perfume",
    "price": 185,
    "priceFrom": false,
    "img": "img/tom-ford-tobacco-vanille-eau-de-parfum-50ml-0.webp",
    "img2": "img/tom-ford-tobacco-vanille-eau-de-parfum-50ml-0.webp",
    "gallery": [
      "img/tom-ford-tobacco-vanille-eau-de-parfum-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "versace-man-fraiche-eau-de-toilette-for-men-100ml",
    "brand": "Versace",
    "name": "Man Fraiche Eau de Toilette for Men — парфюм",
    "cat": "perfume",
    "price": 65,
    "priceFrom": false,
    "img": "img/versace-man-fraiche-eau-de-toilette-for-men-100ml-0.webp",
    "img2": "img/versace-man-fraiche-eau-de-toilette-for-men-100ml-0.webp",
    "gallery": [
      "img/versace-man-fraiche-eau-de-toilette-for-men-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "guerlain-habit-rouge-eau-de-parfum-100ml",
    "brand": "Guerlain",
    "name": "Habit Rouge Eau de Parfum — парфюм",
    "cat": "perfume",
    "price": 96,
    "priceFrom": false,
    "img": "img/guerlain-habit-rouge-eau-de-parfum-100ml-0.webp",
    "img2": "img/guerlain-habit-rouge-eau-de-parfum-100ml-0.webp",
    "gallery": [
      "img/guerlain-habit-rouge-eau-de-parfum-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "guerlain-aqua-allegoria-forte-bosca-vanilla-edp-125ml",
    "brand": "Guerlain",
    "name": "Aqua Allegoria Forte Bosca Vanilla EDP — парфюм",
    "cat": "perfume",
    "price": 100,
    "priceFrom": false,
    "img": "img/guerlain-aqua-allegoria-forte-bosca-vanilla-edp-125ml-0.webp",
    "img2": "img/guerlain-aqua-allegoria-forte-bosca-vanilla-edp-125ml-0.webp",
    "gallery": [
      "img/guerlain-aqua-allegoria-forte-bosca-vanilla-edp-125ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "christian-dior-homme-intense-eau-de-parfum-50ml",
    "brand": "Christian Dior",
    "name": "Homme Intense Eau de Parfum — парфюм",
    "cat": "perfume",
    "price": 78.79,
    "priceFrom": false,
    "img": "img/christian-dior-homme-intense-eau-de-parfum-50ml-0.webp",
    "img2": "img/christian-dior-homme-intense-eau-de-parfum-50ml-0.webp",
    "gallery": [
      "img/christian-dior-homme-intense-eau-de-parfum-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "roja-scandal-parfum-pour-femme-50ml",
    "brand": "Roja",
    "name": "Scandal Parfum Pour Femme — парфюм",
    "cat": "perfume",
    "price": 198,
    "priceFrom": false,
    "img": "img/roja-scandal-parfum-pour-femme-50ml-0.webp",
    "img2": "img/roja-scandal-parfum-pour-femme-50ml-0.webp",
    "gallery": [
      "img/roja-scandal-parfum-pour-femme-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "tom-ford-neroli-port-eau-de-parfum-spray-50ml",
    "brand": "Tom Ford",
    "name": "Neroli Port Eau De Parfum Spray — парфюм",
    "cat": "perfume",
    "price": 207.79,
    "priceFrom": false,
    "img": "img/tom-ford-neroli-port-eau-de-parfum-spray-50ml-0.webp",
    "img2": "img/tom-ford-neroli-port-eau-de-parfum-spray-50ml-0.webp",
    "gallery": [
      "img/tom-ford-neroli-port-eau-de-parfum-spray-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "tom-ford-black-orchid-eau-de-perfume-spray-100ml",
    "brand": "Tom Ford",
    "name": "Black Orchid Eau De Perfume Spray — парфюм",
    "cat": "perfume",
    "price": 133,
    "priceFrom": false,
    "img": "img/tom-ford-black-orchid-eau-de-perfume-spray-100ml-0.webp",
    "img2": "img/tom-ford-black-orchid-eau-de-perfume-spray-100ml-0.webp",
    "gallery": [
      "img/tom-ford-black-orchid-eau-de-perfume-spray-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "creed-original-vetiver-eau-de-parfum-50ml",
    "brand": "Creed",
    "name": "Original Vetiver Eau de Parfum — парфюм",
    "cat": "perfume",
    "price": 204,
    "priceFrom": false,
    "img": "img/creed-original-vetiver-eau-de-parfum-50ml-0.webp",
    "img2": "img/creed-original-vetiver-eau-de-parfum-50ml-0.webp",
    "gallery": [
      "img/creed-original-vetiver-eau-de-parfum-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "byredo-blanche-50ml",
    "brand": "Byredo",
    "name": "Blanche — парфюм",
    "cat": "perfume",
    "price": 165,
    "priceFrom": false,
    "img": "img/byredo-blanche-50ml-0.webp",
    "img2": "img/byredo-blanche-50ml-0.webp",
    "gallery": [
      "img/byredo-blanche-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "oversized-t-shirt-unisex",
    "brand": "Rempire",
    "name": "Your Pretty Face Is Going To Hell — оверсайз футболка",
    "cat": "merch",
    "price": 35,
    "priceFrom": false,
    "img": "img/oversized-t-shirt-unisex-0.webp",
    "img2": "img/oversized-t-shirt-unisex-1.webp",
    "gallery": [
      "img/oversized-t-shirt-unisex-0.webp",
      "img/oversized-t-shirt-unisex-1.webp"
    ],
    "sizes": [
      "white / S",
      "white / M",
      "white / L",
      "white / XL",
      "white / XXL",
      "yellow / S",
      "yellow / M",
      "yellow / L",
      "yellow / XL",
      "yellow / XXL"
    ],
    "varImg": [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "prices": [
      35,
      35,
      35,
      35,
      35,
      35,
      35,
      35,
      35,
      35
    ],
    "stock": "in",
    "fill": "cover"
  },
  {
    "id": "three-kings",
    "brand": "Rempire",
    "name": "Three Kings — футболка",
    "cat": "merch",
    "price": 27,
    "priceFrom": false,
    "img": "img/three-kings-0.webp",
    "img2": "img/three-kings-1.webp",
    "gallery": [
      "img/three-kings-0.webp",
      "img/three-kings-1.webp"
    ],
    "sizes": [
      "Graphite Grey / S-M",
      "Graphite Grey / M-L",
      "Graphite Grey / L-XL"
    ],
    "varImg": [
      0,
      0,
      0
    ],
    "prices": [
      27,
      27,
      27
    ],
    "stock": "low",
    "fill": "cover"
  },
  {
    "id": "king-of-the-night-deep-cut-t-shirt-with-an-extended-back",
    "brand": "Rempire",
    "name": "King Of The Night — футболка",
    "cat": "merch",
    "price": 27,
    "priceFrom": false,
    "img": "img/king-of-the-night-deep-cut-t-shirt-with-an-extended-back-0.webp",
    "img2": "img/king-of-the-night-deep-cut-t-shirt-with-an-extended-back-1.webp",
    "gallery": [
      "img/king-of-the-night-deep-cut-t-shirt-with-an-extended-back-0.webp",
      "img/king-of-the-night-deep-cut-t-shirt-with-an-extended-back-1.webp"
    ],
    "sizes": [
      "S-M",
      "M-L",
      "L-XL"
    ],
    "varImg": [
      0,
      0,
      0
    ],
    "prices": [
      27,
      27,
      27
    ],
    "stock": "low",
    "fill": "cover"
  },
  {
    "id": "siim-hanikat-x-rempire",
    "brand": "Rempire",
    "name": "Siim Hanikat × Rempire — оверсайз футболка",
    "cat": "merch",
    "price": 34.99,
    "priceFrom": false,
    "img": "img/siim-hanikat-x-rempire-0.webp",
    "img2": "img/siim-hanikat-x-rempire-1.webp",
    "gallery": [
      "img/siim-hanikat-x-rempire-0.webp",
      "img/siim-hanikat-x-rempire-1.webp"
    ],
    "sizes": [
      "S",
      "M",
      "L",
      "XL",
      "XXL"
    ],
    "varImg": [
      0,
      0,
      0,
      0,
      0
    ],
    "prices": [
      34.99,
      34.99,
      34.99,
      34.99,
      34.99
    ],
    "stock": "in",
    "fill": "cover"
  },
  {
    "id": "oversized-t-shirt-unisex-with-print-love-is-the-gun",
    "brand": "Rempire",
    "name": "Love Is The Gun — оверсайз футболка",
    "cat": "merch",
    "price": 39,
    "priceFrom": false,
    "img": "img/oversized-t-shirt-unisex-with-print-love-is-the-gun-0.webp",
    "img2": "img/oversized-t-shirt-unisex-with-print-love-is-the-gun-1.webp",
    "gallery": [
      "img/oversized-t-shirt-unisex-with-print-love-is-the-gun-0.webp",
      "img/oversized-t-shirt-unisex-with-print-love-is-the-gun-1.webp"
    ],
    "sizes": [
      "L",
      "S",
      "M",
      "XL",
      "XXL"
    ],
    "varImg": [
      0,
      0,
      0,
      0,
      0
    ],
    "prices": [
      39,
      39,
      39,
      39,
      39
    ],
    "stock": "low",
    "fill": "cover"
  },
  {
    "id": "deep-cut-t-shirt-with-an-extended-back",
    "brand": "Rempire",
    "name": "King Of The Ink — футболка",
    "cat": "merch",
    "price": 27,
    "priceFrom": false,
    "img": "img/deep-cut-t-shirt-with-an-extended-back-0.webp",
    "img2": "img/deep-cut-t-shirt-with-an-extended-back-1.webp",
    "gallery": [
      "img/deep-cut-t-shirt-with-an-extended-back-0.webp",
      "img/deep-cut-t-shirt-with-an-extended-back-1.webp"
    ],
    "sizes": [
      "S-M / Pink",
      "M-L / Pink",
      "L-XL / Pink"
    ],
    "varImg": [
      0,
      0,
      0
    ],
    "prices": [
      27,
      27,
      27
    ],
    "stock": "low",
    "fill": "cover"
  },
  {
    "id": "oversized-t-shirt-unisex-with-print-t-shirt-three-elements-water",
    "brand": "Rempire",
    "name": "Three Elements Water — оверсайз футболка",
    "cat": "merch",
    "price": 35,
    "priceFrom": false,
    "img": "img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-water-0.webp",
    "img2": "img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-water-1.webp",
    "gallery": [
      "img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-water-0.webp",
      "img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-water-1.webp"
    ],
    "sizes": [
      "S",
      "M",
      "L",
      "XL",
      "XXL"
    ],
    "varImg": [
      0,
      0,
      0,
      0,
      0
    ],
    "prices": [
      35,
      35,
      35,
      35,
      35
    ],
    "stock": "in",
    "fill": "cover"
  },
  {
    "id": "oversized-t-shirt-unisex-with-print-t-shirt-three-elements-fire",
    "brand": "Rempire",
    "name": "Three Elements Fire — оверсайз футболка",
    "cat": "merch",
    "price": 35,
    "priceFrom": false,
    "img": "img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-fire-0.webp",
    "img2": "img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-fire-1.webp",
    "gallery": [
      "img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-fire-0.webp",
      "img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-fire-1.webp"
    ],
    "sizes": [
      "S",
      "M",
      "L",
      "XL",
      "XXL"
    ],
    "varImg": [
      0,
      0,
      0,
      0,
      0
    ],
    "prices": [
      35,
      35,
      35,
      35,
      35
    ],
    "stock": "in",
    "fill": "cover"
  }
];
