-- 071_blog_samples.sql — blog agent (migration range 070–079)
--
-- Three real, finished articles, published, in all three languages. They
-- exist so that /shop2/blog/ is never an empty shelf: the first thing Renat
-- (and anyone showing the shop to someone) sees is what a good post looks
-- like — a cover, an excerpt, headings, a list, an inline product card and
-- two products under the article — rather than «Статей пока нет».
--
-- Bodies are HTML, the same shape the visual editor in the admin panel
-- writes and the same allowlist src/lib/blog.ts sanitises against (p, h2,
-- ul/li, a[data-product]). Opening one of these in the editor and saving it
-- round-trips unchanged.
--
-- The covers are catalogue photos this repository already ships
-- (public/shop/img/…), not R2 uploads — a fresh checkout with no bucket
-- configured still shows the pictures. `products` are real catalogue ids
-- (public/shop/catalogue.js), so «Товары из статьи» renders real cards.
--
-- Idempotent: `on conflict (slug) do nothing`. Re-running the migrations, or
-- running them against a database that already has these three slugs, adds
-- nothing and overwrites nothing — an edited sample keeps the edits.
--
-- TO REMOVE THEM (they are ordinary posts, so any of the three works):
--   * in the panel — Блог → open one → «Удалить» (it becomes a draft), or
--     «Снять с публикации» to hide it and keep it;
--   * in SQL, for good:
--       delete from posts where slug in (
--         'uhod-za-borodoy-zimoy',
--         'kak-vybrat-shampun-po-tipu-kozhi-golovy',
--         'pasta-vosk-ili-glina');
--     (this migration will not put them back — it is recorded in
--      _migrations and never runs a second time).
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

/* ---------- 1. Уход за бородой зимой ------------------------------------ */

insert into posts (slug, status, title, excerpt, body, cover_url, cover_alt,
                   tags, products, seo_title, seo_desc, author, published_at)
values (
  'uhod-za-borodoy-zimoy',
  'published',
  jsonb_build_object(
    'RU', 'Борода зимой: как не дать ей пересохнуть',
    'ET', 'Habe talvel: kuidas hoida seda kuivamise eest',
    'EN', 'A beard in winter: how to keep it from drying out'),
  jsonb_build_object(
    'RU', 'Мороз на улице, батареи дома — и борода становится жёсткой, а кожа под ней шелушится. Разбираем, что делать каждый день, а что раз в неделю.',
    'ET', 'Väljas pakane, kodus radiaatorid — habe muutub karedaks ja nahk selle all ketendab. Vaatame, mida teha iga päev ja mida kord nädalas.',
    'EN', 'Frost outside, radiators inside — and the beard turns coarse while the skin under it flakes. Here is what to do daily, and what once a week.'),
  jsonb_build_object(
    'RU', $ru$<p>Зимой борода живёт сразу в двух режимах: минус и ветер на улице, сухой горячий воздух дома. От такого перепада волос теряет влагу, топорщится и ломается, а кожа под бородой начинает шелушиться — и чешется даже у тех, кто летом об этом не вспоминает.</p>
<h2>Мыть — реже, чем кажется</h2>
<p>Каждый день борода мыться не должна. Обычный шампунь для волос смывает с кожи всё подряд, и зимой это заметно сильнее. Двух-трёх раз в неделю достаточно, в остальные дни хватит тёплой воды. Именно тёплой: горячая сушит кожу быстрее любого мороза.</p>
<h2>Масло — каждый день</h2>
<p>Масло делает то, чего кожа зимой не успевает сама: возвращает волосу мягкость и снимает стянутость под бородой. Две-три капли на ладонь, растереть, пройти сначала по коже, а потом уже по волосу. Утром после умывания и вечером после душа — это вся процедура, полминуты.</p>
<p>Хороший пример — густое масло, которое расходуется медленно, а пахнет спокойно и не спорит с парфюмом:</p>
<p><a data-product="captain-fawcett-beard-oil-cf-332-private-stock" href="/shop2/p/captain-fawcett-beard-oil-cf-332-private-stock/">Captain Fawcett Private Stock</a></p>
<h2>Бальзам — если борода длиннее сантиметра</h2>
<p>Масло питает, бальзам держит форму и прикрывает волос от ветра. Короткой бороде он не нужен, длинной — очень: без него кончики за зиму секутся заметно быстрее.</p>
<h2>Четыре мелочи, которые решают больше, чем средства</h2>
<ul><li>Расчёсывайте после масла, а не до — так средство расходится по всей длине, а не остаётся у корней.</li><li>Не выходите на мороз с мокрой бородой: лёд в волосе ломает его.</li><li>Шарф — поверх ухода, а не вместо него: шерсть трёт и путает волос.</li><li>Раз в месяц подравнивайте кончики, даже если отращиваете.</li></ul>
<h2>Если кожа всё равно шелушится</h2>
<p>Значит, ей не хватает не масла, а воды. Увлажнитель дома или хотя бы миска с водой на батарее меняют дело сильнее, чем ещё одна баночка. Если через две недели ничего не изменилось, это уже вопрос к дерматологу, а не к полке с уходом.</p>
<p>Не уверены, что подойдёт именно вам, — спросите у нас в салоне, подберём на месте.</p>$ru$,
    'ET', $et$<p>Talvel elab habe korraga kahes režiimis: väljas pakane ja tuul, kodus kuiv ja soe radiaatoriõhk. Sellest vahetusest kaotab karv niiskust, läheb turri ja murdub ning nahk habeme all hakkab ketendama — ja sügeleb ka neil, kes suvel sellele ei mõtle.</p>
<h2>Pese harvemini, kui tundub</h2>
<p>Habet ei pea iga päev pesema. Tavaline juuksešampoon võtab nahalt kõik ära ja talvel on see eriti tunda. Kaks-kolm korda nädalas piisab, ülejäänud päevadel aitab soe vesi. Just soe: kuum vesi kuivatab nahka kiiremini kui pakane.</p>
<h2>Õli — iga päev</h2>
<p>Õli teeb seda, millega nahk talvel ise hakkama ei saa: annab karvale pehmuse tagasi ja võtab habemealuse pinguldustunde ära. Kaks-kolm tilka peopessa, hõõru laiali, tööta esmalt nahka ja alles siis karvadesse. Hommikul pärast pesemist ja õhtul pärast dušši — kogu protseduur võtab pool minutit.</p>
<p>Hea näide on paks õli, mis kulub aeglaselt ja mille lõhn on rahulik ega vaidle parfüümiga:</p>
<p><a data-product="captain-fawcett-beard-oil-cf-332-private-stock" href="/shop2/et/p/captain-fawcett-beard-oil-cf-332-private-stock/">Captain Fawcett Private Stock</a></p>
<h2>Palsam — kui habe on pikem kui sentimeeter</h2>
<p>Õli toidab, palsam hoiab kuju ja katab karva tuule eest. Lühikesele habemele pole seda vaja, pikale aga küll: ilma selleta lõhenevad otsad talve jooksul tunduvalt kiiremini.</p>
<h2>Neli pisiasja, mis loevad rohkem kui tooted</h2>
<ul><li>Kammi pärast õli, mitte enne — nii jaotub toode kogu pikkuses, mitte ainult juurte juures.</li><li>Ära mine märja habemega pakasesse: jää karvas murrab selle.</li><li>Sall käib hoolduse peale, mitte selle asemel: vill hõõrub ja sasib karva.</li><li>Lõika otsad kord kuus üle, ka siis, kui kasvatad habet pikaks.</li></ul>
<h2>Kui nahk ikka ketendab</h2>
<p>Siis ei ole puudu õlist, vaid veest. Õhuniisutaja kodus või kas või kausitäis vett radiaatoril muudab olukorda rohkem kui järjekordne purk. Kui kahe nädalaga midagi ei muutu, on see juba küsimus nahaarstile, mitte hooldusriiulile.</p>
<p>Kui sa ei ole kindel, mis just sulle sobib, küsi meilt salongis — valime koha peal välja.</p>$et$,
    'EN', $en$<p>In winter a beard lives in two climates at once: frost and wind outside, dry radiator air indoors. The swing pulls moisture out of the hair, so it sticks out and snaps, and the skin underneath starts to flake — and itches even for people who never think about it in summer.</p>
<h2>Wash it less often than you think</h2>
<p>A beard does not need washing every day. Ordinary hair shampoo strips the skin of everything at once, and in winter that shows. Two or three times a week is enough; warm water does for the rest of the days. Warm, not hot — hot water dries skin faster than any frost.</p>
<h2>Oil, every day</h2>
<p>Oil does what the skin cannot keep up with in winter: it softens the hair and takes away the tight feeling underneath. Two or three drops in your palm, rub them together, work the skin first and the hair second. After washing in the morning and after the shower at night — the whole thing takes half a minute.</p>
<p>A good example is a thick oil, slow to use up, with a quiet scent that does not argue with your cologne:</p>
<p><a data-product="captain-fawcett-beard-oil-cf-332-private-stock" href="/shop2/en/p/captain-fawcett-beard-oil-cf-332-private-stock/">Captain Fawcett Private Stock</a></p>
<h2>Balm, once the beard is over a centimetre</h2>
<p>Oil feeds, balm holds the shape and shields the hair from the wind. A short beard does not need it; a long one does — without it the ends split noticeably faster over a winter.</p>
<h2>Four small things that matter more than products</h2>
<ul><li>Comb after the oil, not before — that spreads it down the whole length instead of leaving it at the roots.</li><li>Never go out into the frost with a wet beard: ice in the hair breaks it.</li><li>A scarf goes over the care, not instead of it — wool rubs and tangles the hair.</li><li>Trim the ends once a month, even while you are growing it out.</li></ul>
<h2>If the skin still flakes</h2>
<p>Then it is short of water, not oil. A humidifier at home — or just a bowl of water on the radiator — changes more than another jar will. If nothing shifts in two weeks, that is a question for a dermatologist, not for the shelf.</p>
<p>Not sure what suits you? Ask us in the salon and we will pick something on the spot.</p>$en$),
  '/shop/img/captain-fawcett-beard-oil-cf-332-private-stock-0.webp',
  jsonb_build_object(
    'RU', 'Масло для бороды Captain Fawcett Private Stock',
    'ET', 'Captain Fawcetti habemeõli Private Stock',
    'EN', 'Captain Fawcett Private Stock beard oil'),
  array['борода', 'зима', 'уход']::text[],
  array['captain-fawcett-beard-oil-cf-332-private-stock',
        'proraso-wood-spice-beard-balm-100ml']::text[],
  jsonb_build_object(
    'RU', 'Уход за бородой зимой: масло, бальзам и мытьё',
    'ET', 'Habemehooldus talvel: õli, palsam ja pesemine',
    'EN', 'Winter beard care: oil, balm and washing'),
  jsonb_build_object(
    'RU', 'Мороз и сухой воздух в квартире сушат бороду и кожу под ней. Что делать каждый день, чем мыть и когда нужен бальзам — коротко и по делу.',
    'ET', 'Pakane ja kuiv toaõhk kuivatavad habet ja nahka selle all. Mida teha iga päev, millega pesta ja millal on vaja palsamit — lühidalt ja asjalikult.',
    'EN', 'Frost and dry indoor air dry out a beard and the skin under it. What to do daily, what to wash with and when a balm is needed.'),
  'Rempire',
  now() - interval '21 days'
)
on conflict (slug) do nothing;

/* ---------- 2. Шампунь по типу кожи головы ------------------------------ */

insert into posts (slug, status, title, excerpt, body, cover_url, cover_alt,
                   tags, products, seo_title, seo_desc, author, published_at)
values (
  'kak-vybrat-shampun-po-tipu-kozhi-golovy',
  'published',
  jsonb_build_object(
    'RU', 'Как выбрать шампунь: смотрите на кожу головы, а не на длину',
    'ET', 'Kuidas šampooni valida: vaata peanahka, mitte juuste pikkust',
    'EN', 'How to choose a shampoo: look at your scalp, not your hair'),
  jsonb_build_object(
    'RU', 'Сухие кончики и жирные корни — это одна голова, и шампунь на ней работает только с корнями. Как понять свой тип кожи и что брать.',
    'ET', 'Kuivad otsad ja rasused juured on üks ja sama pea, ja šampoon töötab seal ainult juurtega. Kuidas oma peanaha tüüp ära tunda ja mida võtta.',
    'EN', 'Dry ends and greasy roots are the same head, and shampoo only ever works on the roots. How to tell your scalp type and what to buy.'),
  jsonb_build_object(
    'RU', $ru$<p>Шампунь выбирают по волосам — и почти всегда ошибаются. Шампунь моет кожу головы, а не длину: на длине он проводит секунды, пока стекает. Поэтому первый вопрос не «какие у меня волосы», а «какая у меня кожа головы».</p>
<h2>Как понять свой тип за один день</h2>
<p>Вымойте голову и не наносите ничего на корни. Посмотрите на следующий день:</p>
<ul><li>у корней блеск, волос слипается прядями — жирная кожа;</li><li>кожа стянута, есть мелкие сухие чешуйки, чешется — сухая;</li><li>корни свежие, а кончики сухие — нормальная кожа и повреждённая длина, очень частый случай;</li><li>краснеет и щиплет от многих средств — чувствительная.</li></ul>
<h2>Жирная кожа</h2>
<p>Ошибка здесь одна: мыть агрессивнее и чаще. Кожа отвечает тем, что вырабатывает ещё больше жира. Нужен мягкий шампунь, который можно использовать хоть каждый день:</p>
<p><a data-product="system-4-balancing-shampoo-2" href="/shop2/p/system-4-balancing-shampoo-2/">System 4 Balancing Shampoo 2</a></p>
<p>Наносите его только на корни, а не на всю длину — кончикам он не нужен.</p>
<h2>Сухая и чувствительная</h2>
<p>Тут работает обратное: реже, мягче, тёплой водой. Ищите шампунь без агрессивных моющих компонентов и с пометкой для чувствительной кожи. Если шелушение не проходит месяцами, дело может быть уже не в шампуне — это к врачу.</p>
<h2>Нормальные корни, сухие кончики</h2>
<p>Самый частый вариант. Шампунь берите нейтральный и мягкий, а всю работу с длиной отдайте кондиционеру — пара «шампунь и кондиционер» одной линейки как раз про это:</p>
<p><a data-product="repair-me-wash" href="/shop2/p/repair-me-wash/">Kevin.Murphy Repair-Me.Wash</a></p>
<h2>Три правила, общие для всех</h2>
<ul><li>Мойте в два захода: первый смывает пыль и укладку, второй действительно моет кожу.</li><li>Массируйте подушечками пальцев, а не ногтями, 30–60 секунд.</li><li>Смывайте дольше, чем кажется нужным: остатки шампуня — частая причина зуда.</li></ul>
<p>И последнее: тип кожи меняется с сезоном и с возрастом. Если шампунь работал год, а теперь нет, — скорее всего, изменились вы, а не он.</p>$ru$,
    'ET', $et$<p>Šampooni valitakse juuste järgi — ja eksitakse peaaegu alati. Šampoon peseb peanahka, mitte pikkust: pikkusel on ta vaid mõne sekundi, kuni alla voolab. Seepärast ei ole esimene küsimus mitte «millised on mu juuksed», vaid «milline on mu peanahk».</p>
<h2>Kuidas oma tüüp ühe päevaga ära tunda</h2>
<p>Pese pea ja ära pane juurtele midagi peale. Vaata järgmisel päeval:</p>
<ul><li>juured läigivad, juuksed kleepuvad salkudesse — rasune peanahk;</li><li>nahk on pinges, näha on peeneid kuivi helbeid, sügeleb — kuiv;</li><li>juured on värsked, aga otsad kuivad — normaalne nahk ja kahjustatud pikkus, väga sage juhtum;</li><li>paljudest toodetest läheb punaseks ja kipitab — tundlik.</li></ul>
<h2>Rasune peanahk</h2>
<p>Viga on siin üks: pesta tugevamini ja sagedamini. Nahk vastab sellele veel suurema rasueritusega. Vaja on õrna šampooni, mida võib kasutada kas või iga päev:</p>
<p><a data-product="system-4-balancing-shampoo-2" href="/shop2/et/p/system-4-balancing-shampoo-2/">System 4 Balancing Shampoo 2</a></p>
<p>Kanna seda ainult juurtele, mitte kogu pikkusele — otstele pole seda vaja.</p>
<h2>Kuiv ja tundlik</h2>
<p>Siin kehtib vastupidine: harvemini, õrnemalt, sooja veega. Otsi šampooni ilma karmide pesuaineteta ja märkega tundlikule nahale. Kui ketendus ei kao kuude kaupa, ei pruugi asi enam šampoonis olla — siis on tee arsti juurde.</p>
<h2>Normaalsed juured, kuivad otsad</h2>
<p>Kõige sagedasem variant. Võta neutraalne ja õrn šampoon ning jäta kogu töö pikkusega palsami hooleks — ühe sarja šampoon ja palsam koos on täpselt selle jaoks:</p>
<p><a data-product="repair-me-wash" href="/shop2/et/p/repair-me-wash/">Kevin.Murphy Repair-Me.Wash</a></p>
<h2>Kolm reeglit, mis kehtivad kõigile</h2>
<ul><li>Pese kaks korda: esimene kord peseb maha tolmu ja soengutooted, teine kord peseb tegelikult nahka.</li><li>Masseeri sõrmeotstega, mitte küüntega, 30–60 sekundit.</li><li>Loputa kauem, kui tundub vajalik: šampoonijäägid on sagedane sügeluse põhjus.</li></ul>
<p>Ja viimane: peanaha tüüp muutub aastaajaga ja vanusega. Kui šampoon toimis aasta ja nüüd enam mitte, oled tõenäoliselt muutunud sina, mitte tema.</p>$et$,
    'EN', $en$<p>People choose a shampoo by their hair — and almost always get it wrong. Shampoo washes the scalp, not the length: on the length it spends a few seconds while it runs off. So the first question is not «what is my hair like» but «what is my scalp like».</p>
<h2>Working out your type in a day</h2>
<p>Wash your hair and put nothing on the roots. Look again the next day:</p>
<ul><li>shine at the roots, hair sticking together in strands — an oily scalp;</li><li>tight skin, fine dry flakes, itching — dry;</li><li>fresh roots but dry ends — a normal scalp with damaged length, which is very common;</li><li>redness and stinging from many products — sensitive.</li></ul>
<h2>An oily scalp</h2>
<p>There is one mistake here: washing harder and more often. The skin answers by making even more oil. What you want is a gentle shampoo you could use every day:</p>
<p><a data-product="system-4-balancing-shampoo-2" href="/shop2/en/p/system-4-balancing-shampoo-2/">System 4 Balancing Shampoo 2</a></p>
<p>Put it on the roots only, not down the length — the ends do not need it.</p>
<h2>Dry and sensitive</h2>
<p>Here the opposite works: less often, gentler, with warm water. Look for a shampoo without harsh detergents and marked for sensitive skin. If the flaking does not clear up for months, the shampoo may no longer be the problem — that is a question for a doctor.</p>
<h2>Normal roots, dry ends</h2>
<p>The most common case of all. Keep the shampoo neutral and mild and hand the length over to a conditioner — a wash and its matching conditioner are made for exactly that:</p>
<p><a data-product="repair-me-wash" href="/shop2/en/p/repair-me-wash/">Kevin.Murphy Repair-Me.Wash</a></p>
<h2>Three rules that hold for everyone</h2>
<ul><li>Wash twice: the first pass takes off dust and styling, the second actually washes the scalp.</li><li>Massage with your fingertips, not your nails, for 30–60 seconds.</li><li>Rinse for longer than feels necessary — shampoo left behind is a common cause of itching.</li></ul>
<p>One last thing: scalp type changes with the season and with age. If a shampoo worked for a year and does not now, it is probably you that changed, not the bottle.</p>$en$),
  '/shop/img/system-4-balancing-shampoo-2-0.webp',
  jsonb_build_object(
    'RU', 'Шампунь System 4 Balancing Shampoo 2',
    'ET', 'Šampoon System 4 Balancing Shampoo 2',
    'EN', 'System 4 Balancing Shampoo 2 shampoo'),
  array['волосы', 'шампунь', 'кожа головы']::text[],
  array['system-4-balancing-shampoo-2', 'repair-me-wash']::text[],
  jsonb_build_object(
    'RU', 'Как выбрать шампунь по типу кожи головы',
    'ET', 'Kuidas valida šampooni peanaha tüübi järgi',
    'EN', 'How to choose a shampoo for your scalp type'),
  jsonb_build_object(
    'RU', 'Жирная, сухая, чувствительная или нормальная кожа головы — как определить свою за день и какой шампунь брать под каждую. Плюс три правила мытья.',
    'ET', 'Rasune, kuiv, tundlik või normaalne peanahk — kuidas oma tüüp ühe päevaga ära tunda ja millist šampooni igaühe jaoks võtta. Pluss kolm pesemisreeglit.',
    'EN', 'Oily, dry, sensitive or normal scalp — how to tell yours in a day and which shampoo to buy for each. Plus three rules for washing.'),
  'Rempire',
  now() - interval '14 days'
)
on conflict (slug) do nothing;

/* ---------- 3. Паста, воск или глина ------------------------------------ */

insert into posts (slug, status, title, excerpt, body, cover_url, cover_alt,
                   tags, products, seo_title, seo_desc, author, published_at)
values (
  'pasta-vosk-ili-glina',
  'published',
  jsonb_build_object(
    'RU', 'Паста, воск или глина: чем они отличаются на самом деле',
    'ET', 'Pasta, vaha või savi: mille poolest need tegelikult erinevad',
    'EN', 'Paste, wax or clay: what actually separates them'),
  jsonb_build_object(
    'RU', 'Три банки выглядят одинаково, а причёска из них получается разная. Коротко: что даёт блеск, что — фиксацию, и что брать под свои волосы.',
    'ET', 'Kolm purki näevad ühesugused välja, aga soeng tuleb neist erinev. Lühidalt: mis annab läike, mis fikseeringu ja mida oma juustele võtta.',
    'EN', 'Three tubs look identical, yet the finish is not. Briefly: what gives shine, what gives hold, and which one suits your hair.'),
  jsonb_build_object(
    'RU', $ru$<p>На полке они выглядят одинаково: три банки одного размера. Разница не в бренде, а в двух вещах — насколько крепко средство держит и насколько сильно блестит. Всё остальное подробности.</p>
<h2>Паста</h2>
<p>Средняя фиксация, полуматовый вид, волос остаётся подвижным. Это универсальный вариант: причёску видно, но она не выглядит «сделанной», и её можно поправить рукой в середине дня. Хороший пример — матовая паста для коротких и средних стрижек:</p>
<p><a data-product="night-rider" href="/shop2/p/night-rider/">Kevin.Murphy Night.Rider</a></p>
<h2>Воск</h2>
<p>Держит крепче пасты и даёт лёгкий блеск. Из воска получаются чёткие формы — пробор, зачёс назад, аккуратные бока. Расплата — вес: на тонких волосах воска нужно совсем немного, иначе причёска сядет. Вот воск как раз про плотную фиксацию без глянца:</p>
<p><a data-product="gatsby-moving-rubber-grunge-mat-grey-hair-wax" href="/shop2/p/gatsby-moving-rubber-grunge-mat-grey-hair-wax/">Gatsby Moving Rubber Grunge Mat</a></p>
<h2>Глина</h2>
<p>Самая матовая из трёх и самая сухая на ощупь. Она добавляет объём у корней и текстуру — то, чего не хватает тонким или редеющим волосам. Держит сильно, но жёстко: причёску из глины лучше сделать один раз и не трогать.</p>
<h2>Как выбрать за минуту</h2>
<ul><li>Тонкие волосы, нужен объём — глина.</li><li>Короткая стрижка, хочется естественности — паста.</li><li>Густые или непослушные волосы, нужна форма — воск.</li><li>Кудри — ни то, ни другое, ни третье: им нужны кремы и гели, а не матовая текстура.</li></ul>
<h2>Три ошибки, которые портят любую банку</h2>
<ul><li>Много средства сразу. Начинайте с горошины, добавить всегда успеете.</li><li>Нанесение прямо на корни. Растирайте между ладонями и работайте по длине, иначе волос слипнется и станет плоским.</li><li>Мокрые волосы. Паста и глина работают на подсушенных: на мокрых они просто размазываются.</li></ul>
<p>И последнее: почти всё это смывается обычным шампунем в одно мытьё. Если не смылось — средства было слишком много.</p>$ru$,
    'ET', $et$<p>Riiulil näevad nad ühesugused välja: kolm ühesuurust purki. Vahe ei ole brändis, vaid kahes asjas — kui tugevalt toode hoiab ja kui palju see läigib. Kõik ülejäänu on detailid.</p>
<h2>Pasta</h2>
<p>Keskmine fikseering, poolmatt välimus, juus jääb liikuvaks. See on universaalne valik: soeng on näha, aga see ei mõju «tehtuna» ja seda saab keset päeva käega korrigeerida. Hea näide on matt pasta lühikestele ja keskmistele lõikustele:</p>
<p><a data-product="night-rider" href="/shop2/et/p/night-rider/">Kevin.Murphy Night.Rider</a></p>
<h2>Vaha</h2>
<p>Hoiab pastast tugevamini ja annab kerge läike. Vahaga saab selged vormid — lahu, tahapoole kammitud juuksed, korralikud küljed. Hinnaks on kaal: peenikestel juustel piisab päris väikesest kogusest, muidu vajub soeng kokku. See vaha ongi just tihe fikseering ilma läiketa:</p>
<p><a data-product="gatsby-moving-rubber-grunge-mat-grey-hair-wax" href="/shop2/et/p/gatsby-moving-rubber-grunge-mat-grey-hair-wax/">Gatsby Moving Rubber Grunge Mat</a></p>
<h2>Savi</h2>
<p>Kolmest kõige matim ja katsudes kõige kuivem. See annab juurtele kohevust ja tekstuuri — täpselt seda, mida peenikesed või hõrenevad juuksed vajavad. Hoiab tugevalt, aga jäigalt: saviga tehtud soeng on parem korra teha ja siis mitte puutuda.</p>
<h2>Kuidas minutiga valida</h2>
<ul><li>Peenikesed juuksed, vaja kohevust — savi.</li><li>Lühike lõikus, tahad loomulikkust — pasta.</li><li>Tihedad või sõnakuulmatud juuksed, vaja vormi — vaha.</li><li>Lokid — ei üks, teine ega kolmas: neile sobivad kreemid ja geelid, mitte matt tekstuur.</li></ul>
<h2>Kolm viga, mis rikuvad iga purgi</h2>
<ul><li>Liiga palju korraga. Alusta hernetera suurusest, juurde jõuab alati panna.</li><li>Otse juurtele kandmine. Hõõru peopesade vahel ja tööta mööda pikkust, muidu juuksed kleepuvad ja jäävad lamedaks.</li><li>Märjad juuksed. Pasta ja savi töötavad kuivatatud juustel, märgadel määrduvad nad lihtsalt laiali.</li></ul>
<p>Ja viimane: peaaegu kõik need pesevad tavalise šampooniga ühe korraga maha. Kui ei pesenud, siis oli toodet lihtsalt liiga palju.</p>$et$,
    'EN', $en$<p>On the shelf they look the same: three tubs of the same size. The difference is not the brand but two things — how firmly the product holds, and how much it shines. Everything else is detail.</p>
<h2>Paste</h2>
<p>Medium hold, a semi-matte finish, hair that still moves. This is the all-rounder: the style shows, but it does not look «done», and you can push it back into shape with your hand halfway through the day. A good example is a matte paste for short and medium cuts:</p>
<p><a data-product="night-rider" href="/shop2/en/p/night-rider/">Kevin.Murphy Night.Rider</a></p>
<h2>Wax</h2>
<p>Holds harder than paste and leaves a light shine. Wax is what gives you crisp shapes — a parting, a slick back, tidy sides. The price is weight: on fine hair you need very little, or the style sits down flat. This wax is exactly that — firm hold, no gloss:</p>
<p><a data-product="gatsby-moving-rubber-grunge-mat-grey-hair-wax" href="/shop2/en/p/gatsby-moving-rubber-grunge-mat-grey-hair-wax/">Gatsby Moving Rubber Grunge Mat</a></p>
<h2>Clay</h2>
<p>The mattest of the three and the driest to the touch. It adds lift at the roots and texture — which is what fine or thinning hair is short of. It holds strongly but stiffly: a clay style is best made once and then left alone.</p>
<h2>Choosing in a minute</h2>
<ul><li>Fine hair, need volume — clay.</li><li>Short cut, want it to look natural — paste.</li><li>Thick or unruly hair, need a shape — wax.</li><li>Curls — none of the three: they want creams and gels, not a matte texture.</li></ul>
<h2>Three mistakes that ruin any tub</h2>
<ul><li>Too much at once. Start with a pea; you can always add more.</li><li>Putting it straight on the roots. Rub it between your palms and work down the length, or the hair clumps and goes flat.</li><li>Wet hair. Paste and clay work on towel-dried hair; on wet hair they just smear.</li></ul>
<p>One last thing: nearly all of this washes out with ordinary shampoo in a single wash. If it did not, you simply used too much.</p>$en$),
  '/shop/img/night-rider-0.webp',
  jsonb_build_object(
    'RU', 'Матовая паста для укладки Kevin.Murphy Night.Rider',
    'ET', 'Matt soengupasta Kevin.Murphy Night.Rider',
    'EN', 'Kevin.Murphy Night.Rider matte styling paste'),
  array['стайлинг', 'укладка', 'волосы']::text[],
  array['night-rider', 'gatsby-moving-rubber-grunge-mat-grey-hair-wax']::text[],
  jsonb_build_object(
    'RU', 'Паста, воск или глина: что выбрать для укладки',
    'ET', 'Pasta, vaha või savi: mida soengu jaoks valida',
    'EN', 'Paste, wax or clay: which one to style with'),
  jsonb_build_object(
    'RU', 'Чем паста отличается от воска и глины, что даёт блеск, что — объём, и какое средство подойдёт вашим волосам. Плюс три частые ошибки.',
    'ET', 'Mille poolest erineb pasta vahast ja savist, mis annab läike, mis kohevuse ja milline toode sinu juustele sobib. Pluss kolm sagedast viga.',
    'EN', 'How paste differs from wax and clay, what gives shine, what gives volume, and which one suits your hair. Plus three common mistakes.'),
  'Rempire',
  now() - interval '7 days'
)
on conflict (slug) do nothing;
