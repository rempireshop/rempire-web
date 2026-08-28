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
    "img": "/shop/img/system-4-bio-botanical-shampoo-0.webp",
    "img2": "/shop/img/system-4-bio-botanical-shampoo-1.webp",
    "gallery": [
      "/shop/img/system-4-bio-botanical-shampoo-0.webp",
      "/shop/img/system-4-bio-botanical-shampoo-1.webp",
      "/shop/img/system-4-bio-botanical-shampoo-2.webp"
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
    "name": "Bio Botanical Serum — сыворотка для кожи головы",
    "cat": "hair",
    "price": 8,
    "priceFrom": true,
    "img": "/shop/img/system-4-bio-botanical-serum-0.webp",
    "img2": "/shop/img/system-4-bio-botanical-serum-1.webp",
    "gallery": [
      "/shop/img/system-4-bio-botanical-serum-0.webp",
      "/shop/img/system-4-bio-botanical-serum-1.webp",
      "/shop/img/system-4-bio-botanical-serum-2.webp"
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
    "name": "Oil Cure Scalp Treatment O — маска для кожи головы",
    "cat": "hair",
    "price": 7.9,
    "priceFrom": true,
    "img": "/shop/img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-0.webp",
    "img2": "/shop/img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-1.webp",
    "gallery": [
      "/shop/img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-0.webp",
      "/shop/img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-1.webp",
      "/shop/img/sim-sensitive-system-4-oil-cure-scalp-treatment-o-2.webp"
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
    "img": "/shop/img/touchable-0.webp",
    "img2": "/shop/img/touchable-0.webp",
    "gallery": [
      "/shop/img/touchable-0.webp"
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
    "img": "/shop/img/repair-me-wash-0.webp",
    "img2": "/shop/img/repair-me-wash-1.webp",
    "gallery": [
      "/shop/img/repair-me-wash-0.webp",
      "/shop/img/repair-me-wash-1.webp"
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
    "img": "/shop/img/kevin-murphy-un-tangled-spray-0.webp",
    "img2": "/shop/img/kevin-murphy-un-tangled-spray-1.webp",
    "gallery": [
      "/shop/img/kevin-murphy-un-tangled-spray-0.webp",
      "/shop/img/kevin-murphy-un-tangled-spray-1.webp"
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
    "img": "/shop/img/night-rider-0.webp",
    "img2": "/shop/img/night-rider-1.webp",
    "gallery": [
      "/shop/img/night-rider-0.webp",
      "/shop/img/night-rider-1.webp"
    ],
    "sizes": [
      "100 г",
      "30 г"
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
    "img": "/shop/img/free-hold-0.webp",
    "img2": "/shop/img/free-hold-1.webp",
    "gallery": [
      "/shop/img/free-hold-0.webp",
      "/shop/img/free-hold-1.webp"
    ],
    "sizes": [
      "100 г",
      "30 г"
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
    "img": "/shop/img/killer-curls-rinse-0.webp",
    "img2": "/shop/img/killer-curls-rinse-1.webp",
    "gallery": [
      "/shop/img/killer-curls-rinse-0.webp",
      "/shop/img/killer-curls-rinse-1.webp"
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
    "img": "/shop/img/killer-curls-wash-0.webp",
    "img2": "/shop/img/killer-curls-wash-1.webp",
    "gallery": [
      "/shop/img/killer-curls-wash-0.webp",
      "/shop/img/killer-curls-wash-1.webp"
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
    "img": "/shop/img/system-4-mild-shampoo-3-0.webp",
    "img2": "/shop/img/system-4-mild-shampoo-3-1.webp",
    "gallery": [
      "/shop/img/system-4-mild-shampoo-3-0.webp",
      "/shop/img/system-4-mild-shampoo-3-1.webp",
      "/shop/img/system-4-mild-shampoo-3-2.webp"
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
    "name": "Scalp Tonic T — тоник для кожи головы",
    "cat": "hair",
    "price": 7.9,
    "priceFrom": true,
    "img": "/shop/img/sim-sensitive-system-4-scalp-tonic-t-0.webp",
    "img2": "/shop/img/sim-sensitive-system-4-scalp-tonic-t-1.webp",
    "gallery": [
      "/shop/img/sim-sensitive-system-4-scalp-tonic-t-0.webp",
      "/shop/img/sim-sensitive-system-4-scalp-tonic-t-1.webp",
      "/shop/img/sim-sensitive-system-4-scalp-tonic-t-2.webp"
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
    "name": "Hydro Care Conditioner H — кондиционер",
    "cat": "hair",
    "price": 6.9,
    "priceFrom": true,
    "img": "/shop/img/system-4-hydro-care-conditioner-h-0.webp",
    "img2": "/shop/img/system-4-hydro-care-conditioner-h-1.webp",
    "gallery": [
      "/shop/img/system-4-hydro-care-conditioner-h-0.webp",
      "/shop/img/system-4-hydro-care-conditioner-h-1.webp"
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
    "img": "/shop/img/kevin-murphy-motion-lotion-0.webp",
    "img2": "/shop/img/kevin-murphy-motion-lotion-0.webp",
    "gallery": [
      "/shop/img/kevin-murphy-motion-lotion-0.webp"
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
    "img": "/shop/img/sim-sensitive-system-4-chitosan-hair-repair-r-0.webp",
    "img2": "/shop/img/sim-sensitive-system-4-chitosan-hair-repair-r-1.webp",
    "gallery": [
      "/shop/img/sim-sensitive-system-4-chitosan-hair-repair-r-0.webp",
      "/shop/img/sim-sensitive-system-4-chitosan-hair-repair-r-1.webp"
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
    "img": "/shop/img/kevin-murphy-blow-dry-wash-0.webp",
    "img2": "/shop/img/kevin-murphy-blow-dry-wash-1.webp",
    "gallery": [
      "/shop/img/kevin-murphy-blow-dry-wash-0.webp",
      "/shop/img/kevin-murphy-blow-dry-wash-1.webp"
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
    "img": "/shop/img/hair-resort-spray-0.webp",
    "img2": "/shop/img/hair-resort-spray-1.webp",
    "gallery": [
      "/shop/img/hair-resort-spray-0.webp",
      "/shop/img/hair-resort-spray-1.webp"
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
    "img": "/shop/img/rough-rider-0.webp",
    "img2": "/shop/img/rough-rider-1.webp",
    "gallery": [
      "/shop/img/rough-rider-0.webp",
      "/shop/img/rough-rider-1.webp"
    ],
    "sizes": [
      "100 г",
      "30 г"
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
    "img": "/shop/img/maxi-wash-0.webp",
    "img2": "/shop/img/maxi-wash-1.webp",
    "gallery": [
      "/shop/img/maxi-wash-0.webp",
      "/shop/img/maxi-wash-1.webp"
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
    "img": "/shop/img/system-4-bio-botanical-vital-cure-0.webp",
    "img2": "/shop/img/system-4-bio-botanical-vital-cure-1.webp",
    "gallery": [
      "/shop/img/system-4-bio-botanical-vital-cure-0.webp",
      "/shop/img/system-4-bio-botanical-vital-cure-1.webp"
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
    "img": "/shop/img/system-4-balancing-shampoo-2-0.webp",
    "img2": "/shop/img/system-4-balancing-shampoo-2-1.webp",
    "gallery": [
      "/shop/img/system-4-balancing-shampoo-2-0.webp",
      "/shop/img/system-4-balancing-shampoo-2-1.webp",
      "/shop/img/system-4-balancing-shampoo-2-2.webp"
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
    "img": "/shop/img/system-4-special-shampoo-1-0.webp",
    "img2": "/shop/img/system-4-special-shampoo-1-1.webp",
    "gallery": [
      "/shop/img/system-4-special-shampoo-1-0.webp",
      "/shop/img/system-4-special-shampoo-1-1.webp",
      "/shop/img/system-4-special-shampoo-1-2.webp"
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
    "name": "Moving Rubber Grunge Mat — воск для укладки",
    "cat": "styling",
    "price": 15,
    "priceFrom": false,
    "img": "/shop/img/gatsby-moving-rubber-grunge-mat-grey-hair-wax-0.webp",
    "img2": "/shop/img/gatsby-moving-rubber-grunge-mat-grey-hair-wax-0.webp",
    "gallery": [
      "/shop/img/gatsby-moving-rubber-grunge-mat-grey-hair-wax-0.webp"
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
    "img": "/shop/img/kevin-murphy-killer-twirls-0.webp",
    "img2": "/shop/img/kevin-murphy-killer-twirls-0.webp",
    "gallery": [
      "/shop/img/kevin-murphy-killer-twirls-0.webp"
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
    "img": "/shop/img/easy-rider-0.webp",
    "img2": "/shop/img/easy-rider-0.webp",
    "gallery": [
      "/shop/img/easy-rider-0.webp"
    ],
    "sizes": [
      "100 г"
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
    "img": "/shop/img/gatsby-moving-rubber-wild-shake-15g-0.webp",
    "img2": "/shop/img/gatsby-moving-rubber-wild-shake-15g-0.webp",
    "gallery": [
      "/shop/img/gatsby-moving-rubber-wild-shake-15g-0.webp"
    ],
    "sizes": [
      "80 г"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "mandom-gatsby-moving-rubber",
    "brand": "Gatsby",
    "name": "Moving Rubber — паста для укладки",
    "cat": "styling",
    "price": 15,
    "priceFrom": false,
    "img": "/shop/img/mandom-gatsby-moving-rubber-0.webp",
    "img2": "/shop/img/mandom-gatsby-moving-rubber-0.webp",
    "gallery": [
      "/shop/img/mandom-gatsby-moving-rubber-0.webp"
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
    "img": "/shop/img/killer-curls-0.webp",
    "img2": "/shop/img/killer-curls-0.webp",
    "gallery": [
      "/shop/img/killer-curls-0.webp"
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
    "img": "/shop/img/super-goo-0.webp",
    "img2": "/shop/img/super-goo-0.webp",
    "gallery": [
      "/shop/img/super-goo-0.webp"
    ],
    "sizes": [
      "100 г"
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
    "img": "/shop/img/body-builder-0.webp",
    "img2": "/shop/img/body-builder-1.webp",
    "gallery": [
      "/shop/img/body-builder-0.webp",
      "/shop/img/body-builder-1.webp"
    ],
    "sizes": [
      "400 мл",
      "100 мл"
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
    "name": "MITCH Construction Paste — паста для укладки",
    "cat": "styling",
    "price": 23,
    "priceFrom": false,
    "img": "/shop/img/paul-mitchell-mitch-construction-paste-flexible-styling-paste-0.webp",
    "img2": "/shop/img/paul-mitchell-mitch-construction-paste-flexible-styling-paste-0.webp",
    "gallery": [
      "/shop/img/paul-mitchell-mitch-construction-paste-flexible-styling-paste-0.webp"
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
    "img": "/shop/img/paul-mitchell-super-skinny-serum-0.webp",
    "img2": "/shop/img/paul-mitchell-super-skinny-serum-0.webp",
    "gallery": [
      "/shop/img/paul-mitchell-super-skinny-serum-0.webp"
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
    "img": "/shop/img/paul-mitchell-clear-styling-glaze-0.webp",
    "img2": "/shop/img/paul-mitchell-clear-styling-glaze-0.webp",
    "gallery": [
      "/shop/img/paul-mitchell-clear-styling-glaze-0.webp"
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
    "img": "/shop/img/paul-mitchell-mitch-steady-grip-styling-gel-0.webp",
    "img2": "/shop/img/paul-mitchell-mitch-steady-grip-styling-gel-0.webp",
    "gallery": [
      "/shop/img/paul-mitchell-mitch-steady-grip-styling-gel-0.webp"
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
    "img": "/shop/img/powder-puff-0.webp",
    "img2": "/shop/img/powder-puff-0.webp",
    "gallery": [
      "/shop/img/powder-puff-0.webp"
    ],
    "sizes": [
      "14 г"
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
    "img": "/shop/img/kevin-murphy-full-again-0.webp",
    "img2": "/shop/img/kevin-murphy-full-again-0.webp",
    "gallery": [
      "/shop/img/kevin-murphy-full-again-0.webp"
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
    "img": "/shop/img/hair-resort-0.webp",
    "img2": "/shop/img/hair-resort-0.webp",
    "gallery": [
      "/shop/img/hair-resort-0.webp"
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
    "img": "/shop/img/davines-pasta-love-strong-hold-mat-clay-0.webp",
    "img2": "/shop/img/davines-pasta-love-strong-hold-mat-clay-0.webp",
    "gallery": [
      "/shop/img/davines-pasta-love-strong-hold-mat-clay-0.webp"
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
    "name": "Wood & Spice — бальзам для бороды",
    "cat": "beard",
    "price": 16,
    "priceFrom": false,
    "img": "/shop/img/proraso-wood-spice-beard-balm-100ml-0.webp",
    "img2": "/shop/img/proraso-wood-spice-beard-balm-100ml-0.webp",
    "gallery": [
      "/shop/img/proraso-wood-spice-beard-balm-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "captain-fawcett-beard-oil-cf-332-private-stock",
    "brand": "Captain Fawcett",
    "name": "Private Stock — масло для бороды",
    "cat": "beard",
    "price": 17,
    "priceFrom": false,
    "img": "/shop/img/captain-fawcett-beard-oil-cf-332-private-stock-0.webp",
    "img2": "/shop/img/captain-fawcett-beard-oil-cf-332-private-stock-1.webp",
    "gallery": [
      "/shop/img/captain-fawcett-beard-oil-cf-332-private-stock-0.webp",
      "/shop/img/captain-fawcett-beard-oil-cf-332-private-stock-1.webp"
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
    "name": "Azur Lime — бальзам после бритья",
    "cat": "beard",
    "price": 16,
    "priceFrom": false,
    "img": "/shop/img/proraso-azur-lime-after-shave-balm-100-ml-0.webp",
    "img2": "/shop/img/proraso-azur-lime-after-shave-balm-100-ml-0.webp",
    "gallery": [
      "/shop/img/proraso-azur-lime-after-shave-balm-100-ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml",
    "brand": "Proraso",
    "name": "White — бальзам после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "/shop/img/proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml-0.webp",
    "img2": "/shop/img/proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml-0.webp",
    "gallery": [
      "/shop/img/proraso-white-aftershave-balm-soothing-for-sensitive-skin-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml",
    "brand": "Proraso",
    "name": "Blue Protect — бальзам после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "/shop/img/proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml-0.webp",
    "img2": "/shop/img/proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml-0.webp",
    "gallery": [
      "/shop/img/proraso-blue-protect-aftershave-balm-aloe-and-vitamin-e-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-aftershave-balm-green-refreshing-alcohol-free-mentholated-100ml",
    "brand": "Proraso",
    "name": "Green Refreshing — бальзам после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "/shop/img/proraso-aftershave-balm-green-refreshing-alcohol-free-mentholated-100ml-0.webp",
    "img2": "/shop/img/proraso-aftershave-balm-green-refreshing-alcohol-free-mentholated-100ml-0.webp",
    "gallery": [
      "/shop/img/proraso-aftershave-balm-green-refreshing-alcohol-free-mentholated-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-red-nourishing-aftershave-lotion-100ml",
    "brand": "Proraso",
    "name": "Red Nourishing — лосьон после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "/shop/img/proraso-red-nourishing-aftershave-lotion-100ml-0.webp",
    "img2": "/shop/img/proraso-red-nourishing-aftershave-lotion-100ml-0.webp",
    "gallery": [
      "/shop/img/proraso-red-nourishing-aftershave-lotion-100ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml",
    "brand": "Proraso",
    "name": "Green Refreshing — лосьон после бритья",
    "cat": "beard",
    "price": 14,
    "priceFrom": false,
    "img": "/shop/img/proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml-0.webp",
    "img2": "/shop/img/proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml-0.webp",
    "gallery": [
      "/shop/img/proraso-green-refreshing-aftershave-lotion-menthol-splash-100ml-0.webp"
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
    "img": "/shop/img/proraso-beard-oil-azur-lime-30ml-0.webp",
    "img2": "/shop/img/proraso-beard-oil-azur-lime-30ml-0.webp",
    "gallery": [
      "/shop/img/proraso-beard-oil-azur-lime-30ml-0.webp"
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
    "img": "/shop/img/proraso-beard-oil-green-refreshing-30ml-0.webp",
    "img2": "/shop/img/proraso-beard-oil-green-refreshing-30ml-0.webp",
    "gallery": [
      "/shop/img/proraso-beard-oil-green-refreshing-30ml-0.webp"
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
    "img": "/shop/img/proraso-beard-oil-cypress-vetyver-30ml-0.webp",
    "img2": "/shop/img/proraso-beard-oil-cypress-vetyver-30ml-0.webp",
    "gallery": [
      "/shop/img/proraso-beard-oil-cypress-vetyver-30ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml",
    "brand": "Proraso",
    "name": "Beard Oil Wood Spice — масло для бороды",
    "cat": "beard",
    "price": 15,
    "priceFrom": false,
    "img": "/shop/img/proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml-0.webp",
    "img2": "/shop/img/proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml-0.webp",
    "gallery": [
      "/shop/img/proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml-0.webp"
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
    "img": "/shop/img/davines-pre-shaving-beard-oil-0.webp",
    "img2": "/shop/img/davines-pre-shaving-beard-oil-0.webp",
    "gallery": [
      "/shop/img/davines-pre-shaving-beard-oil-0.webp"
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
    "img": "/shop/img/davines-softening-shaving-gel-0.webp",
    "img2": "/shop/img/davines-softening-shaving-gel-0.webp",
    "gallery": [
      "/shop/img/davines-softening-shaving-gel-0.webp"
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
    "img": "/shop/img/davines-non-foaming-transparent-shaving-gel-0.webp",
    "img2": "/shop/img/davines-non-foaming-transparent-shaving-gel-0.webp",
    "gallery": [
      "/shop/img/davines-non-foaming-transparent-shaving-gel-0.webp"
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
    "cat": "styling",
    "price": 24.5,
    "priceFrom": false,
    "img": "/shop/img/davines-medium-hold-styling-paste-0.webp",
    "img2": "/shop/img/davines-medium-hold-styling-paste-0.webp",
    "gallery": [
      "/shop/img/davines-medium-hold-styling-paste-0.webp"
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
    "img": "/shop/img/cosrx-full-fit-propolis-synergy-toner-0.webp",
    "img2": "/shop/img/cosrx-full-fit-propolis-synergy-toner-0.webp",
    "gallery": [
      "/shop/img/cosrx-full-fit-propolis-synergy-toner-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "anua-heartleaf-pore-control-cleansing-oil",
    "brand": "Anua",
    "name": "Heartleaf Pore Control Cleansing Oil — гидрофильное масло",
    "cat": "face",
    "price": 22.8,
    "priceFrom": false,
    "img": "/shop/img/anua-heartleaf-pore-control-cleansing-oil-0.webp",
    "img2": "/shop/img/anua-heartleaf-pore-control-cleansing-oil-0.webp",
    "gallery": [
      "/shop/img/anua-heartleaf-pore-control-cleansing-oil-0.webp"
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
    "img": "/shop/img/cosrx-aha-bha-clarifying-treatment-toner-0.webp",
    "img2": "/shop/img/cosrx-aha-bha-clarifying-treatment-toner-0.webp",
    "gallery": [
      "/shop/img/cosrx-aha-bha-clarifying-treatment-toner-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "cosrx-low-ph-good-morning-gel-cleanser",
    "brand": "Cosrx",
    "name": "Low pH Good Morning Gel Cleanser — гель для умывания",
    "cat": "face",
    "price": 11.15,
    "priceFrom": false,
    "img": "/shop/img/cosrx-low-ph-good-morning-gel-cleanser-0.webp",
    "img2": "/shop/img/cosrx-low-ph-good-morning-gel-cleanser-0.webp",
    "gallery": [
      "/shop/img/cosrx-low-ph-good-morning-gel-cleanser-0.webp"
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
    "img": "/shop/img/anua-bha-2-gentle-exfoliating-toner-150ml-0.webp",
    "img2": "/shop/img/anua-bha-2-gentle-exfoliating-toner-150ml-0.webp",
    "gallery": [
      "/shop/img/anua-bha-2-gentle-exfoliating-toner-150ml-0.webp"
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
    "img": "/shop/img/anua-niacinamide-10-txa-4-serum-0.webp",
    "img2": "/shop/img/anua-niacinamide-10-txa-4-serum-0.webp",
    "gallery": [
      "/shop/img/anua-niacinamide-10-txa-4-serum-0.webp"
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
    "img": "/shop/img/anua-heartleaf-quercetinol-pore-deep-cleansing-foam-0.webp",
    "img2": "/shop/img/anua-heartleaf-quercetinol-pore-deep-cleansing-foam-0.webp",
    "gallery": [
      "/shop/img/anua-heartleaf-quercetinol-pore-deep-cleansing-foam-0.webp"
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
    "img": "/shop/img/cosrx-advanced-snail-92-all-in-one-cream-0.webp",
    "img2": "/shop/img/cosrx-advanced-snail-92-all-in-one-cream-0.webp",
    "gallery": [
      "/shop/img/cosrx-advanced-snail-92-all-in-one-cream-0.webp"
    ],
    "sizes": [
      "100 г"
    ],
    "varImg": [
      0
    ],
    "stock": "in"
  },
  {
    "id": "cosrx-advanced-snail-96-mucin-power-essence",
    "brand": "Cosrx",
    "name": "Advanced Snail 96 Mucin Power Essence — эссенция для лица",
    "cat": "face",
    "price": 21.99,
    "priceFrom": false,
    "img": "/shop/img/cosrx-advanced-snail-96-mucin-power-essence-0.webp",
    "img2": "/shop/img/cosrx-advanced-snail-96-mucin-power-essence-0.webp",
    "gallery": [
      "/shop/img/cosrx-advanced-snail-96-mucin-power-essence-0.webp"
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
    "name": "Recovery Oil — масло для лица",
    "cat": "face",
    "price": 21.95,
    "priceFrom": false,
    "img": "/shop/img/lumin-skin-recovery-oil-0.webp",
    "img2": "/shop/img/lumin-skin-recovery-oil-1.webp",
    "gallery": [
      "/shop/img/lumin-skin-recovery-oil-0.webp",
      "/shop/img/lumin-skin-recovery-oil-1.webp"
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
    "img": "/shop/img/lumin-skin-wrinkle-defense-serum-0.webp",
    "img2": "/shop/img/lumin-skin-wrinkle-defense-serum-1.webp",
    "gallery": [
      "/shop/img/lumin-skin-wrinkle-defense-serum-0.webp",
      "/shop/img/lumin-skin-wrinkle-defense-serum-1.webp"
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
    "name": "Charcoal Scrub Deep Detox — скраб для лица",
    "cat": "face",
    "price": 18.95,
    "priceFrom": false,
    "img": "/shop/img/lumin-skin-charcoal-scrub-deep-detox-0.webp",
    "img2": "/shop/img/lumin-skin-charcoal-scrub-deep-detox-1.webp",
    "gallery": [
      "/shop/img/lumin-skin-charcoal-scrub-deep-detox-0.webp",
      "/shop/img/lumin-skin-charcoal-scrub-deep-detox-1.webp"
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
    "name": "Charcoal Face Wash Daily Detox — гель для умывания",
    "cat": "face",
    "price": 18.95,
    "priceFrom": false,
    "img": "/shop/img/lumin-skin-charcoal-face-wash-daily-detox-0.webp",
    "img2": "/shop/img/lumin-skin-charcoal-face-wash-daily-detox-1.webp",
    "gallery": [
      "/shop/img/lumin-skin-charcoal-face-wash-daily-detox-0.webp",
      "/shop/img/lumin-skin-charcoal-face-wash-daily-detox-1.webp"
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
    "img": "/shop/img/lumin-skin-dark-circle-defense-balm-0.webp",
    "img2": "/shop/img/lumin-skin-dark-circle-defense-balm-1.webp",
    "gallery": [
      "/shop/img/lumin-skin-dark-circle-defense-balm-0.webp",
      "/shop/img/lumin-skin-dark-circle-defense-balm-1.webp"
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
    "name": "Sheet Mask Madecassoside — тканевая маска",
    "cat": "face",
    "price": 3,
    "priceFrom": false,
    "img": "/shop/img/gummy-sheet-mask-madecassoside-sticker-0.webp",
    "img2": "/shop/img/gummy-sheet-mask-madecassoside-sticker-0.webp",
    "gallery": [
      "/shop/img/gummy-sheet-mask-madecassoside-sticker-0.webp"
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
    "img": "/shop/img/anua-heartleaf-77-soothing-toner-0.webp",
    "img2": "/shop/img/anua-heartleaf-77-soothing-toner-0.webp",
    "gallery": [
      "/shop/img/anua-heartleaf-77-soothing-toner-0.webp"
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
    "img": "/shop/img/davines-hair-beard-body-wash-0.webp",
    "img2": "/shop/img/davines-hair-beard-body-wash-0.webp",
    "gallery": [
      "/shop/img/davines-hair-beard-body-wash-0.webp"
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
    "name": "Чёрное мыло 666 — ручная работа",
    "cat": "body",
    "price": 9,
    "priceFrom": false,
    "img": "/shop/img/handmade-soap-666-0.webp",
    "img2": "/shop/img/handmade-soap-666-1.webp",
    "gallery": [
      "/shop/img/handmade-soap-666-0.webp",
      "/shop/img/handmade-soap-666-1.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "handmade-soap-rule-nr-1",
    "brand": "Rempire",
    "name": "Розовое мыло Rule Nr 1 — ручная работа",
    "cat": "body",
    "price": 9,
    "priceFrom": false,
    "img": "/shop/img/handmade-soap-rule-nr-1-0.webp",
    "img2": "/shop/img/handmade-soap-rule-nr-1-1.webp",
    "gallery": [
      "/shop/img/handmade-soap-rule-nr-1-0.webp",
      "/shop/img/handmade-soap-rule-nr-1-1.webp"
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
    "img": "/shop/img/xerjoff-tony-iommi-monkey-special-50ml-0.webp",
    "img2": "/shop/img/xerjoff-tony-iommi-monkey-special-50ml-0.webp",
    "gallery": [
      "/shop/img/xerjoff-tony-iommi-monkey-special-50ml-0.webp"
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
    "img": "/shop/img/xerjoff-1861-naxos-eau-de-parfum-100ml-0.webp",
    "img2": "/shop/img/xerjoff-1861-naxos-eau-de-parfum-100ml-0.webp",
    "gallery": [
      "/shop/img/xerjoff-1861-naxos-eau-de-parfum-100ml-0.webp"
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
    "img": "/shop/img/creed-aventus-eau-de-parfum-for-men-50ml-0.webp",
    "img2": "/shop/img/creed-aventus-eau-de-parfum-for-men-50ml-0.webp",
    "gallery": [
      "/shop/img/creed-aventus-eau-de-parfum-for-men-50ml-0.webp"
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
    "img": "/shop/img/creed-creed-aventus-cologne-50ml-0.webp",
    "img2": "/shop/img/creed-creed-aventus-cologne-50ml-0.webp",
    "gallery": [
      "/shop/img/creed-creed-aventus-cologne-50ml-0.webp"
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
    "img": "/shop/img/tom-ford-tobacco-vanille-eau-de-parfum-50ml-0.webp",
    "img2": "/shop/img/tom-ford-tobacco-vanille-eau-de-parfum-50ml-0.webp",
    "gallery": [
      "/shop/img/tom-ford-tobacco-vanille-eau-de-parfum-50ml-0.webp"
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
    "img": "/shop/img/versace-man-fraiche-eau-de-toilette-for-men-100ml-0.webp",
    "img2": "/shop/img/versace-man-fraiche-eau-de-toilette-for-men-100ml-0.webp",
    "gallery": [
      "/shop/img/versace-man-fraiche-eau-de-toilette-for-men-100ml-0.webp"
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
    "img": "/shop/img/guerlain-habit-rouge-eau-de-parfum-100ml-0.webp",
    "img2": "/shop/img/guerlain-habit-rouge-eau-de-parfum-100ml-0.webp",
    "gallery": [
      "/shop/img/guerlain-habit-rouge-eau-de-parfum-100ml-0.webp"
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
    "img": "/shop/img/guerlain-aqua-allegoria-forte-bosca-vanilla-edp-125ml-0.webp",
    "img2": "/shop/img/guerlain-aqua-allegoria-forte-bosca-vanilla-edp-125ml-0.webp",
    "gallery": [
      "/shop/img/guerlain-aqua-allegoria-forte-bosca-vanilla-edp-125ml-0.webp"
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
    "img": "/shop/img/christian-dior-homme-intense-eau-de-parfum-50ml-0.webp",
    "img2": "/shop/img/christian-dior-homme-intense-eau-de-parfum-50ml-0.webp",
    "gallery": [
      "/shop/img/christian-dior-homme-intense-eau-de-parfum-50ml-0.webp"
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
    "img": "/shop/img/roja-scandal-parfum-pour-femme-50ml-0.webp",
    "img2": "/shop/img/roja-scandal-parfum-pour-femme-50ml-0.webp",
    "gallery": [
      "/shop/img/roja-scandal-parfum-pour-femme-50ml-0.webp"
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
    "img": "/shop/img/tom-ford-neroli-port-eau-de-parfum-spray-50ml-0.webp",
    "img2": "/shop/img/tom-ford-neroli-port-eau-de-parfum-spray-50ml-0.webp",
    "gallery": [
      "/shop/img/tom-ford-neroli-port-eau-de-parfum-spray-50ml-0.webp"
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
    "img": "/shop/img/tom-ford-black-orchid-eau-de-perfume-spray-100ml-0.webp",
    "img2": "/shop/img/tom-ford-black-orchid-eau-de-perfume-spray-100ml-0.webp",
    "gallery": [
      "/shop/img/tom-ford-black-orchid-eau-de-perfume-spray-100ml-0.webp"
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
    "img": "/shop/img/creed-original-vetiver-eau-de-parfum-50ml-0.webp",
    "img2": "/shop/img/creed-original-vetiver-eau-de-parfum-50ml-0.webp",
    "gallery": [
      "/shop/img/creed-original-vetiver-eau-de-parfum-50ml-0.webp"
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
    "img": "/shop/img/byredo-blanche-50ml-0.webp",
    "img2": "/shop/img/byredo-blanche-50ml-0.webp",
    "gallery": [
      "/shop/img/byredo-blanche-50ml-0.webp"
    ],
    "sizes": [],
    "varImg": [],
    "stock": "in"
  },
  {
    "id": "oversized-t-shirt-unisex",
    "brand": "Rempire",
    "name": "Your Pretty Face Is Going To Hell — футболка оверсайз",
    "cat": "merch",
    "price": 35,
    "priceFrom": false,
    "img": "/shop/img/oversized-t-shirt-unisex-0.webp",
    "img2": "/shop/img/oversized-t-shirt-unisex-1.webp",
    "gallery": [
      "/shop/img/oversized-t-shirt-unisex-0.webp",
      "/shop/img/oversized-t-shirt-unisex-1.webp"
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
      1,
      1,
      1,
      1,
      1
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
    "img": "/shop/img/three-kings-0.webp",
    "img2": "/shop/img/three-kings-1.webp",
    "gallery": [
      "/shop/img/three-kings-0.webp",
      "/shop/img/three-kings-1.webp"
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
    "id": "king-of-the-night-deep-cut-t-shirt-with-an-extended-back",
    "brand": "Rempire",
    "name": "King Of The Night — футболка",
    "cat": "merch",
    "price": 27,
    "priceFrom": false,
    "img": "/shop/img/king-of-the-night-deep-cut-t-shirt-with-an-extended-back-0.webp",
    "img2": "/shop/img/king-of-the-night-deep-cut-t-shirt-with-an-extended-back-1.webp",
    "gallery": [
      "/shop/img/king-of-the-night-deep-cut-t-shirt-with-an-extended-back-0.webp",
      "/shop/img/king-of-the-night-deep-cut-t-shirt-with-an-extended-back-1.webp"
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
    "name": "Siim Hanikat × Rempire — футболка оверсайз",
    "cat": "merch",
    "price": 34.99,
    "priceFrom": false,
    "img": "/shop/img/siim-hanikat-x-rempire-0.webp",
    "img2": "/shop/img/siim-hanikat-x-rempire-1.webp",
    "gallery": [
      "/shop/img/siim-hanikat-x-rempire-0.webp",
      "/shop/img/siim-hanikat-x-rempire-1.webp"
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
    "name": "Love Is The Gun — футболка оверсайз",
    "cat": "merch",
    "price": 39,
    "priceFrom": false,
    "img": "/shop/img/oversized-t-shirt-unisex-with-print-love-is-the-gun-0.webp",
    "img2": "/shop/img/oversized-t-shirt-unisex-with-print-love-is-the-gun-1.webp",
    "gallery": [
      "/shop/img/oversized-t-shirt-unisex-with-print-love-is-the-gun-0.webp",
      "/shop/img/oversized-t-shirt-unisex-with-print-love-is-the-gun-1.webp"
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
    "img": "/shop/img/deep-cut-t-shirt-with-an-extended-back-0.webp",
    "img2": "/shop/img/deep-cut-t-shirt-with-an-extended-back-1.webp",
    "gallery": [
      "/shop/img/deep-cut-t-shirt-with-an-extended-back-0.webp",
      "/shop/img/deep-cut-t-shirt-with-an-extended-back-1.webp",
      "/shop/img/deep-cut-t-shirt-with-an-extended-back-2.webp"
    ],
    "sizes": [
      "S-M",
      "M-L",
      "L-XL"
    ],
    "varImg": [
      0,
      1,
      2
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
    "name": "Three Elements Water — футболка оверсайз",
    "cat": "merch",
    "price": 35,
    "priceFrom": false,
    "img": "/shop/img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-water-0.webp",
    "img2": "/shop/img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-water-1.webp",
    "gallery": [
      "/shop/img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-water-0.webp",
      "/shop/img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-water-1.webp"
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
    "name": "Three Elements Fire — футболка оверсайз",
    "cat": "merch",
    "price": 35,
    "priceFrom": false,
    "img": "/shop/img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-fire-0.webp",
    "img2": "/shop/img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-fire-1.webp",
    "gallery": [
      "/shop/img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-fire-0.webp",
      "/shop/img/oversized-t-shirt-unisex-with-print-t-shirt-three-elements-fire-1.webp"
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
