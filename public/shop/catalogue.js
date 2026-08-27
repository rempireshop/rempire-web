// Real catalogue data from rempireshop.com. Prototype use.
const CATALOGUE = [
  {
    "id": "km-repair-me-wash",
    "brand": "Kevin.Murphy",
    "name": "Repair-Me.Wash — шампунь",
    "cat": "hair",
    "price": 27,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/photo-6.jpg?v=1688742837&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/photo-5.jpg?v=1688742837&width=533",
    "sizes": [
      "250 мл",
      "40 мл"
    ],
    "stock": "in",
    "prices": [
      27,
      7
    ]
  },
  {
    "id": "km-repair-me-rinse",
    "brand": "Kevin.Murphy",
    "name": "Repair-Me.Rinse — кондиционер",
    "cat": "hair",
    "price": 27,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/photo-3.jpg?v=1688742341&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/photo-4.jpg?v=1688742341&width=533",
    "sizes": [
      "250 мл",
      "40 мл"
    ],
    "stock": "in",
    "prices": [
      27,
      7
    ]
  },
  {
    "id": "km-hydrate-me-masque",
    "brand": "Kevin.Murphy",
    "name": "Hydrate-Me.Masque — увлажняющая маска",
    "cat": "hair",
    "price": 34,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/hydrate-me.wash_250ml-01-1-scaled-1copy.jpg?v=1703518795&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/MINITUBEHYDRATE-ME.MASQUE40ML_1_1024x1024_d06923f6-8b25-4f90-81ec-44bcf0b49aed.webp?v=1703518795&width=533",
    "sizes": [
      "200 мл",
      "40 мл"
    ],
    "stock": "in",
    "prices": [
      34,
      8
    ]
  },
  {
    "id": "km-young-again-wash",
    "brand": "Kevin.Murphy",
    "name": "Young.Again.Wash — восстанавливающий шампунь",
    "cat": "hair",
    "price": 28,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/hydrate-me.wasfffh_250ml-01-1-scaled-1copy.jpg?v=1703519251&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/kevin-murphy-young-again-wash-rebuilding-hair-shampoo-40ml-130632_1000x1000_lisella.jpg?v=1703519251&width=533",
    "sizes": [
      "250 мл",
      "40 мл"
    ],
    "stock": "in",
    "prices": [
      28,
      6
    ]
  },
  {
    "id": "km-fresh-hair",
    "brand": "Kevin.Murphy",
    "name": "Fresh.Hair — сухой шампунь",
    "cat": "hair",
    "price": 28,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/kuivsampoon-kevin-murphy-fresh-hair-250ml-9b508_original.jpg?v=1716122783&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/2024-05-19_154651329.png?v=1716122814&width=533",
    "sizes": [
      "250 мл",
      "100 мл"
    ],
    "stock": "in",
    "prices": [
      28,
      18
    ]
  },
  {
    "id": "s4-bio-botanical-shampoo",
    "brand": "System 4",
    "name": "Bio Botanical Shampoo — шампунь для кожи головы",
    "cat": "hair",
    "price": 9,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/6417150024437.jpg?v=1689780757&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/6417150024536.jpg?v=1689780757&width=533",
    "sizes": [
      "75 мл",
      "250 мл",
      "500 мл"
    ],
    "stock": "in",
    "prices": [
      9,
      16,
      25
    ]
  },
  {
    "id": "s4-bio-botanical-serum",
    "brand": "System 4",
    "name": "Bio Botanical Serum — сыворотка для кожи головы",
    "cat": "hair",
    "price": 8,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/6417150024451.jpg?v=1689780618&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/6417150024338.jpg?v=1689780618&width=533",
    "sizes": [
      "50 мл",
      "150 мл",
      "500 мл"
    ],
    "stock": "in",
    "prices": [
      8,
      16,
      25
    ]
  },
  {
    "id": "s4-hydro-care-conditioner",
    "brand": "System 4",
    "name": "Hydro Care Conditioner H — кондиционер",
    "cat": "hair",
    "price": 6.9,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/6417150024383.jpg?v=1689778916&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/6417150024277.jpg?v=1689778915&width=533",
    "sizes": [
      "75 мл",
      "150 мл",
      "500 мл"
    ],
    "stock": "in",
    "prices": [
      6.9,
      13.9,
      19.9
    ]
  },
  {
    "id": "dav-renewing-shampoo",
    "brand": "Davines",
    "name": "Renewing Shampoo — омолаживающий шампунь",
    "cat": "hair",
    "price": 17.4,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/f376e6c4ae3213be5458649fd56c83ee5a6204e0_2000x_835d2eb6-e6d7-4963-8002-49a6773001e4.jpg?v=1716121836&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/f376e6c4ae3213be5458649fd56c83ee5a6204e0_2000x_835d2eb6-e6d7-4963-8002-49a6773001e4.jpg?v=1716121836&width=533",
    "sizes": [
      "250 мл",
      "100 мл"
    ],
    "stock": "in",
    "prices": [
      17.4,
      9
    ]
  },
  {
    "id": "dav-nourishing-shampoo",
    "brand": "Davines",
    "name": "Nourishing Shampoo — питательный шампунь",
    "cat": "hair",
    "price": 17.4,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/71300_NATURALTECH_NOURISHING_SHAMPOO_250ML_2019_2000x_00fbd5a4-7913-4696-a8a0-7bb05388f8fb.jpg?v=1716120700&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/71300_NATURALTECH_NOURISHING_SHAMPOO_250ML_2019_2000x_00fbd5a4-7913-4696-a8a0-7bb05388f8fb.jpg?v=1716120700&width=533",
    "sizes": [
      "250 мл",
      "100 мл"
    ],
    "stock": "in",
    "prices": [
      17.4,
      9
    ]
  },
  {
    "id": "pm-tea-tree-lavender-mint",
    "brand": "Paul Mitchell",
    "name": "Tea Tree Lavender Mint — увлажняющий шампунь",
    "cat": "hair",
    "price": 25,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/24_TT_LVM_LavenderMintMoisturizingShampoo_10.14oz_RGB.psd-JPG-PPT_804d46c3-7b2b-4c5e-aa87-0d02277d7acb.jpg?v=1776620124&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/24_TT_LVM_LavenderMintMoisturizingShampoo_10.14oz_RGB.psd-JPG-PPT_804d46c3-7b2b-4c5e-aa87-0d02277d7acb.jpg?v=1776620124&width=533",
    "sizes": [
      "300 мл"
    ],
    "stock": "in",
    "prices": [
      25
    ]
  },
  {
    "id": "cbd-daily-shampoo",
    "brand": "CBD Daily",
    "name": "Shampoo — шампунь с CBD",
    "cat": "hair",
    "price": 19,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/photo-4-2_399ab5ca-939c-4762-b0d5-3347d4f1fe05.jpg?v=1689596397&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/photo-4-2_399ab5ca-939c-4762-b0d5-3347d4f1fe05.jpg?v=1689596397&width=533",
    "sizes": [
      "473 мл"
    ],
    "stock": "in",
    "prices": [
      19
    ]
  },
  {
    "id": "km-touchable",
    "brand": "Kevin.Murphy",
    "name": "Touchable — спрей-воск",
    "cat": "styling",
    "price": 27,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/photo-18.jpg?v=1688742664&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/photo-18.jpg?v=1688742664&width=533",
    "sizes": [
      "250 мл"
    ],
    "stock": "in",
    "prices": [
      27
    ]
  },
  {
    "id": "km-rough-rider",
    "brand": "Kevin.Murphy",
    "name": "Rough.Rider — моделирующая паста",
    "cat": "styling",
    "price": 28,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/photo-15.jpg?v=1688741168&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/photo-14.jpg?v=1688741168&width=533",
    "sizes": [
      "100 г",
      "30 г"
    ],
    "stock": "in",
    "prices": [
      28,
      11
    ]
  },
  {
    "id": "km-session-spray",
    "brand": "Kevin.Murphy",
    "name": "Session.Spray — лак сильной фиксации",
    "cat": "styling",
    "price": 28,
    "priceFrom": true,
    "img": "https://rempireshop.com/cdn/shop/files/hydrate-me.washfdfdsfsdf_250ml-01-1-scaled-1copy.webp?v=1703519894&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/session.spray100mlEU-Shdw.png?v=1703519894&width=533",
    "sizes": [
      "400 мл",
      "100 мл"
    ],
    "stock": "in",
    "prices": [
      28,
      18
    ]
  },
  {
    "id": "dav-pasta-love-paste",
    "brand": "Davines",
    "name": "Pasta&Love — паста средней фиксации",
    "cat": "styling",
    "price": 24.5,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/8004608276463_PastaLove-medium-hold-styling-paste-125ml_-93012-UUS.webp?v=1699798133&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/8004608276463_PastaLove-medium-hold-styling-paste-125ml_-93012-UUS.webp?v=1699798133&width=533",
    "sizes": [
      "125 мл"
    ],
    "stock": "in",
    "prices": [
      24.5
    ]
  },
  {
    "id": "cf-sea-salt-spray",
    "brand": "Captain Fawcett",
    "name": "Sea Salt Spray — солевой спрей",
    "cat": "styling",
    "price": 25,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/www.captainfawcett.com-2564_1.jpg?v=1696924601&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/www.captainfawcett.com-2567.jpg?v=1696924601&width=533",
    "sizes": [
      "250 мл"
    ],
    "stock": "out",
    "prices": [
      25
    ]
  },
  {
    "id": "cf-barberism-beard-oil",
    "brand": "Captain Fawcett",
    "name": "Barberism — масло для бороды",
    "cat": "beard",
    "price": 18,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/low-res-www.captainfawcett.com_barberism_beard_oil_10ml_02.jpg?v=1696923498&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/low-res-www.captainfawcett.com_barberism_beard_oil_10ml_01.jpg?v=1696923498&width=533",
    "sizes": [
      "10 мл"
    ],
    "stock": "in",
    "prices": [
      18
    ]
  },
  {
    "id": "cf-booze-baccy-balm",
    "brand": "Captain Fawcett",
    "name": "Ricki Hall Booze & Baccy — бальзам для бороды",
    "cat": "beard",
    "price": 24,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/CaptainFawcettRickiHallBeardBalm-highres-2-Copy_6a3c3d87-b9ee-4da8-9681-51612b45f9f2.jpg?v=1696926484&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/CaptainFawcettRickiHallBeardBalm-highres-4-Copy_f70701e8-b624-43b6-beee-7f48077ba2a2.jpg?v=1696926485&width=533",
    "sizes": [
      "60 мл"
    ],
    "stock": "in",
    "prices": [
      24
    ]
  },
  {
    "id": "cf-barberism-moustache-wax",
    "brand": "Captain Fawcett",
    "name": "Barberism — воск для усов",
    "cat": "beard",
    "price": 15,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/CaptainFawcettSidSottungMoustacheWax-highres-3.jpg?v=1696925306&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/CaptainFawcettSidSottungMoustacheWaxBacklowres.jpg?v=1696925305&width=533",
    "sizes": [
      "15 мл"
    ],
    "stock": "in",
    "prices": [
      15
    ]
  },
  {
    "id": "dav-pre-shaving-oil",
    "brand": "Davines",
    "name": "Pasta&Love — масло до бритья и для бороды",
    "cat": "beard",
    "price": 22,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/PL-pre-shaving_epood-01-scaled-1.webp?v=1699802869&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/PL-pre-shaving_epood-01-scaled-1.webp?v=1699802869&width=533",
    "sizes": [
      "50 мл"
    ],
    "stock": "in",
    "prices": [
      22
    ]
  },
  {
    "id": "dav-shaving-gel",
    "brand": "Davines",
    "name": "Pasta&Love — прозрачный гель для бритья",
    "cat": "beard",
    "price": 24.5,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/8004608276456_PastaLove-transparent-shaving-gel-150ml_93011-UUS.webp?v=1699800517&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/8004608276456_PastaLove-transparent-shaving-gel-150ml_93011-UUS.webp?v=1699800517&width=533",
    "sizes": [
      "150 мл"
    ],
    "stock": "in",
    "prices": [
      24.5
    ]
  },
  {
    "id": "kc-anua-heartleaf-toner",
    "brand": "Korean Cosmetics",
    "name": "Anua Heartleaf 77% — успокаивающий тонер",
    "cat": "face",
    "price": 6.99,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/2024-05-19_173029306.png?v=1716129033&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/2024-05-19_173029306.png?v=1716129033&width=533",
    "sizes": [
      "40 мл"
    ],
    "stock": "in",
    "prices": [
      6.99
    ]
  },
  {
    "id": "kc-cosrx-snail-essence",
    "brand": "Korean Cosmetics",
    "name": "COSRX Advanced Snail 96 — эссенция с муцином",
    "cat": "face",
    "price": 21.99,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/cosrx_advanced_snail_96_mucin_power_essence_100ml_jpg.webp?v=1716123702&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/cosrx_advanced_snail_96_mucin_power_essence_100ml_jpg.webp?v=1716123702&width=533",
    "sizes": [
      "100 мл"
    ],
    "stock": "in",
    "prices": [
      21.99
    ]
  },
  {
    "id": "lum-wrinkle-serum",
    "brand": "Lumin",
    "name": "Wrinkle Defense Serum — сыворотка от морщин",
    "cat": "face",
    "price": 21.95,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/lumin-v2-ecommerce-wrinkle_defense_closed_1611.png?v=1695584003&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/lumin-v2-ecommerce-texture_wrinkle_serum_1899.png?v=1695584004&width=533",
    "sizes": [
      "15 мл"
    ],
    "stock": "in",
    "prices": [
      21.95
    ]
  },
  {
    "id": "lum-dark-circle-balm",
    "brand": "Lumin",
    "name": "Dark Circle Defense Balm — бальзам от тёмных кругов",
    "cat": "face",
    "price": 32.95,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/lumin-v2-ecommerce-dark_circle_defense_1630.png?v=1695577057&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/lumin-v2-ecommerce-dark_circle_defense-detail_1776.png?v=1695577057&width=533",
    "sizes": [
      "20 мл"
    ],
    "stock": "in",
    "prices": [
      32.95
    ]
  },
  {
    "id": "rmp-soap-666",
    "brand": "REMPIRE",
    "name": "666 — чёрное мыло ручной работы",
    "cat": "body",
    "price": 9,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/products/IMG_3511.jpg?v=1666089711&width=533",
    "img2": "https://rempireshop.com/cdn/shop/products/IMG_6799.jpg?v=1666089711&width=533",
    "sizes": [
      "1 шт"
    ],
    "stock": "in",
    "prices": [
      9
    ]
  },
  {
    "id": "dav-hair-beard-body-wash",
    "brand": "Davines",
    "name": "Pasta&Love — гель для волос, бороды и тела",
    "cat": "body",
    "price": 24.5,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/Pastalove-1.webp?v=1699802914&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/Pastalove-1.webp?v=1699802914&width=533",
    "sizes": [
      "300 мл"
    ],
    "stock": "in",
    "prices": [
      24.5
    ]
  },
  {
    "id": "rmp-tee-air",
    "brand": "REMPIRE",
    "name": "Three Elements AIR — оверсайз футболка",
    "cat": "merch",
    "price": 35,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/IMG_2878.jpg?v=1764194446&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/IMG_2875.jpg?v=1764194446&width=533",
    "sizes": [
      "S",
      "M",
      "L",
      "XL",
      "XXL"
    ],
    "stock": "in",
    "prices": [
      35,
      35,
      35,
      35,
      35
    ]
  },
  {
    "id": "rmp-tee-siim-hanikat",
    "brand": "REMPIRE",
    "name": "SIIM HANIKAT × REMPIRE — оверсайз футболка",
    "cat": "merch",
    "price": 34.99,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/IMG_2891.jpg?v=1764195111&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/IMG_2889.jpg?v=1764195111&width=533",
    "sizes": [
      "S",
      "M",
      "L",
      "XL",
      "XXL"
    ],
    "stock": "in",
    "prices": [
      34.99,
      34.99,
      34.99,
      34.99,
      34.99
    ]
  },
  {
    "id": "rmp-tee-king-of-the-night",
    "brand": "REMPIRE",
    "name": "King Of The Night — футболка с удлинённой спинкой",
    "cat": "merch",
    "price": 27,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/f3475e1a-1fdd-460e-b5eb-ba03b0949e29.png?v=1724879541&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/f5e9d0d6-46ef-4132-a8ea-772df284f768.png?v=1724879556&width=533",
    "sizes": [
      "S-M",
      "M-L",
      "L-XL"
    ],
    "stock": "low",
    "prices": [
      27,
      27,
      27
    ]
  },
  {
    "id": "rmp-tee-three-kings",
    "brand": "REMPIRE",
    "name": "Three Kings — футболка",
    "cat": "merch",
    "price": 27,
    "priceFrom": false,
    "img": "https://rempireshop.com/cdn/shop/files/51e46477-2bc8-4e2e-b325-9568528cd4cc.png?v=1724879726&width=533",
    "img2": "https://rempireshop.com/cdn/shop/files/c136b1e6-de05-4e37-8e4f-5a5a9273af19.png?v=1724879770&width=533",
    "sizes": [
      "S-M",
      "M-L",
      "L-XL"
    ],
    "stock": "low",
    "prices": [
      27,
      27,
      27
    ]
  }
];
