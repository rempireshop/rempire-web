/* Demo review pool — фиктивные отзывы для прототипа; реальные отзывы приходят после запуска через письмо «оцените заказ». Do not ship to production as-is.
   ET/EN переводы сделаны ИИ для демо (ET/EN translations are AI-made for this demo). */

var REVIEWS_POOL = {
  RU: {
    hair: [
      {n: "Марк", d: "05.2026", r: 5, t: "Волосы мягкие, но без эффекта пуха. Расход небольшой, хватило почти на три месяца."},
      {n: "Kristjan", d: "07.2026", r: 5, t: "Волосы не жирнятся к вечеру первого дня, голову стал мыть реже. Запах ненавязчивый, это плюс."},
      {n: "Андрей", d: "04.2026", r: 4, t: "Справляется даже после плотной укладки, волосы к вечеру живые. Четыре звезды из-за цены, но результат честный."},
      {n: "Liis", d: "06.2026", r: 5, t: "Купила мужу, теперь пользуемся вдвоём. Волосы послушнее, расчёсываются без мучений."},
      {n: "Rasmus", d: "08.2026", r: 5, t: "Кожа головы успокоилась, после спортзала не чешется. Смывается быстро и без следа."},
      {n: "Даниил", d: "03.2026", r: 4, t: "Ожидал вау-эффекта, получил просто хорошие волосы. Тоже неплохо, пользуюсь дальше."},
      {n: "Martin", d: "07.2026", r: 5, t: "Пользуюсь второй месяц, у корней появился объём. Раньше к обеду всё лежало, теперь держится до вечера."},
      {n: "Ольга", d: "05.2026", r: 5, t: "Заказала мужу по совету его барбера. Волосы мягче на ощупь, сам доволен."},
      {n: "Сергей", d: "06.2026", r: 3, t: "Со своей задачей справляется, но запах на любителя — слишком травяной. Терплю, потому что результат нравится."},
      {n: "Tanel", d: "04.2026", r: 4, t: "Волосы чистые, не электризуются, лежат ровно. Не пятёрка — хотелось бы, чтобы объём держался дольше."}
    ],
    styling: [
      {n: "Никита", d: "06.2026", r: 5, t: "Держит форму до вечера, не склеивает и не блестит. Наутро голова не как после лака, всё вычёсывается."},
      {n: "Priit", d: "04.2026", r: 5, t: "Наконец-то укладка выглядит естественно, а не «зализано». Хватает совсем небольшого количества."},
      {n: "Артём", d: "07.2026", r: 4, t: "Фиксация честная, переживает даже ветер у моря. Минус балл — по сухим волосам распределяется тяжеловато."},
      {n: "Karl", d: "05.2026", r: 5, t: "Каждый день перед работой, волосы ухоженные без эффекта каски. Смывается обычным шампунем с первого раза."},
      {n: "Игорь", d: "08.2026", r: 3, t: "Держит нормально, но для моих густых волос слабовато — к вечеру всё оседает. Для короткой стрижки, думаю, было бы то что надо."},
      {n: "Sander", d: "03.2026", r: 5, t: "Матовый финиш, как и хотел. Упаковки хватает надолго, потому что нужно совсем немного."},
      {n: "Максим", d: "06.2026", r: 4, t: "Удобно, что можно поправить укладку в течение дня. Запах при нанесении резковат, потом выветривается."},
      {n: "Joosep", d: "05.2026", r: 5, t: "Брал по совету барбера и не пожалел. Волосы остаются подвижными, а форма живёт до позднего вечера."}
    ],
    beard: [
      {n: "Роман", d: "05.2026", r: 5, t: "Кожа под бородой перестала чесаться уже через неделю. Борода мягче, жена заметила раньше меня."},
      {n: "Mart", d: "07.2026", r: 5, t: "Впитывается быстро, жирного блеска нет. Волос лежит ровнее, торчащих меньше."},
      {n: "Алексей", d: "04.2026", r: 4, t: "Борода стала послушнее, расчёсывать проще. Четыре звезды — объём маловат для такой цены."},
      {n: "Indrek", d: "06.2026", r: 5, t: "Пользуюсь утром после душа, хватает совсем чуть-чуть. Никакой плёнки — борода выглядит ухоженной, а не намазанной."},
      {n: "Дмитрий", d: "08.2026", r: 3, t: "Запах на любителя — довольно сладкий, ожидал более нейтральный. Само средство рабочее, кожа под бородой спокойная."},
      {n: "Erik", d: "03.2026", r: 5, t: "Отращиваю бороду впервые, первые недели замучил зуд. С этим средством стало заметно комфортнее, пользуюсь каждый день."},
      {n: "Владимир", d: "06.2026", r: 4, t: "Хорошо смягчает жёсткий волос. Хотелось бы упаковку поудобнее — легко взять лишнего."},
      {n: "Henri", d: "07.2026", r: 5, t: "Борода перестала пушиться к вечеру. Запах сдержанный, с парфюмом не спорит."}
    ],
    face: [
      {n: "Павел", d: "06.2026", r: 5, t: "Кожа после бритья не горит и не краснеет. Впитывается за минуту, без липкости."},
      {n: "Marten", d: "04.2026", r: 5, t: "Лицо к вечеру больше не блестит. Расход маленький, хватило на два месяца."},
      {n: "Егор", d: "07.2026", r: 4, t: "Кожа стала ровнее и спокойнее. Минус звезда за тугую крышку — мокрыми руками открывать неудобно."},
      {n: "Anu", d: "05.2026", r: 5, t: "Взяла мужу, который «кремами не пользуется». Пользуется. Говорит, кожа не стягивается после умывания."},
      {n: "Тимур", d: "08.2026", r: 3, t: "Дороговато, но хватает надолго. Эффект есть, просто ожидал большего за эти деньги."},
      {n: "Siim", d: "03.2026", r: 4, t: "Хорошо снимает ощущение сухости после бритвы. Текстура плотная — зимой это было плюсом, к лету беру поменьше."},
      {n: "Виктор", d: "06.2026", r: 5, t: "Простая рутина: умылся, нанёс, забыл. Раздражения после бритья заметно меньше."}
    ],
    body: [
      {n: "Кирилл", d: "05.2026", r: 5, t: "Пахнет здорово, но аромат уходит быстро и не спорит с парфюмом. Кожа после душа не стянута."},
      {n: "Kaido", d: "07.2026", r: 5, t: "После спортзала самое то — смывает всё, кожа не пересушена. Пена мягкая, уходит без остатка."},
      {n: "Анна", d: "04.2026", r: 4, t: "Купила мужу — запах мужской, но не топорный. Четыре звезды: расходуется быстрее, чем хотелось бы."},
      {n: "Tõnis", d: "06.2026", r: 5, t: "Не сушит кожу даже при душе дважды в день. Беру уже второй раз."},
      {n: "Женя", d: "08.2026", r: 3, t: "Продукт нормальный, но аромат чересчур дымный на мой вкус. Муж, впрочем, доволен."},
      {n: "Markus", d: "03.2026", r: 5, t: "Из тех средств, что незаметно становятся привычкой. Кожа не сохнет, запах в меру."},
      {n: "Олег", d: "06.2026", r: 4, t: "Плотная пена, смывается легко. Не пятёрка из-за цены — дешевле найти можно, но не такое приятное."}
    ],
    perfume: [
      {n: "Артур", d: "06.2026", r: 5, t: "Стойкость честные 6-8 часов, на одежде дольше. Комплименты были уже в первый день."},
      {n: "Kadri", d: "04.2026", r: 5, t: "Выбирала подарок мужу и угадала. Аромат взрослый, сдержанный, в офисе не душит."},
      {n: "Глеб", d: "07.2026", r: 4, t: "Раскрывается интереснее, чем звучит в первые минуты. Стойкость средняя — к вечеру остаётся только шлейф у воротника."},
      {n: "Oliver", d: "05.2026", r: 5, t: "Ношу и на работу, и на выход — везде уместен. Двух нажатий хватает, больше не нужно."},
      {n: "Станислав", d: "03.2026", r: 3, t: "Первый час звучит резковато для меня, потом смягчается. База нравится, но это открытие каждый раз надо пережить."},
      {n: "Jaan", d: "08.2026", r: 5, t: "Редкий случай, когда аромат из интернета совпал с ожиданиями. Сдержанный, чистый, без приторности."},
      {n: "Юлия", d: "06.2026", r: 4, t: "Дарила на день рождения, упаковка выглядит дороже цены. Аромат хороший, но в жару держится скромно."}
    ],
    merch: [
      {n: "Денис", d: "05.2026", r: 5, t: "Качество ткани приятно удивило — после нескольких стирок выглядит как новая. Размер совпал с таблицей."},
      {n: "Maarja", d: "07.2026", r: 5, t: "Брала как подарок — упаковано аккуратно, дарить не стыдно. Качество заметно выше ожиданий от мерча."},
      {n: "Пётр", d: "04.2026", r: 4, t: "Сделано добротно, мелочи продуманы. Четыре звезды — хотелось бы больше вариантов на выбор."},
      {n: "Mihkel", d: "06.2026", r: 5, t: "Пользуюсь почти каждый день, следов износа нет. Обычно мерч так себе, тут исключение."},
      {n: "Светлана", d: "08.2026", r: 3, t: "Дороговато для такой вещи, хотя качество нормальное. Скорее сувенир для своих, чем практичная покупка."},
      {n: "Andres", d: "03.2026", r: 4, t: "Добротная вещь, аккуратно сшито. Доставка шла на пару дней дольше обещанного, поэтому четыре."}
    ]
  },
  ET: {
    hair: [
      {n: "Марк", d: "05.2026", r: 5, t: "Juuksed on pehmed, aga ei lähe kohevile. Kulub vähe, jätkus peaaegu kolmeks kuuks."},
      {n: "Kristjan", d: "07.2026", r: 5, t: "Juuksed ei lähe esimese päeva õhtuks rasuseks, pesen pead nüüd harvem. Lõhn on tagasihoidlik, see on pluss."},
      {n: "Андрей", d: "04.2026", r: 4, t: "Saab hakkama ka pärast korralikku viimistlust, juuksed on õhtuks elusad. Neli tärni hinna pärast, aga tulemus on aus."},
      {n: "Liis", d: "06.2026", r: 5, t: "Ostsin mehele, nüüd kasutame kahekesi. Juuksed on kuulekamad ja kammimine käib ilma piinata."},
      {n: "Rasmus", d: "08.2026", r: 5, t: "Peanahk rahunes maha, pärast jõusaali enam ei sügele. Peseb kiiresti ja jäljetult maha."},
      {n: "Даниил", d: "03.2026", r: 4, t: "Ootasin vau-efekti, sain lihtsalt korralikud juuksed. Pole ka paha, kasutan edasi."},
      {n: "Martin", d: "07.2026", r: 5, t: "Kasutan teist kuud, juurte juures on tekkinud kohevus. Varem oli lõunaks kõik lössis, nüüd püsib õhtuni."},
      {n: "Ольга", d: "05.2026", r: 5, t: "Tellisin mehele tema barberi soovitusel. Juuksed on katsudes pehmemad, ta ise on rahul."},
      {n: "Сергей", d: "06.2026", r: 3, t: "Oma ülesandega saab hakkama, aga lõhn on maitseasi — minu jaoks liiga rohune. Kannatan ära, sest tulemus meeldib."},
      {n: "Tanel", d: "04.2026", r: 4, t: "Juuksed on puhtad, ei lähe elektriliseks, püsivad kenasti paigal. Viit ei pane — tahaks, et kohevus kestaks kauem."}
    ],
    styling: [
      {n: "Никита", d: "06.2026", r: 5, t: "Hoiab soengut õhtuni, ei kleebi kokku ega läigi. Hommikul pole pea nagu pärast juukselakki, kõik tuleb kammiga välja."},
      {n: "Priit", d: "04.2026", r: 5, t: "Lõpuks ometi näeb soeng loomulik välja, mitte „lakitud“. Piisab täitsa väikesest kogusest."},
      {n: "Артём", d: "07.2026", r: 4, t: "Hoiab ausalt, peab vastu isegi mere ääres tuulele. Punkt maha — kuivades juustes on raske ühtlaselt laiali ajada."},
      {n: "Karl", d: "05.2026", r: 5, t: "Iga päev enne tööd, juuksed näevad hoolitsetud välja ilma kiivriefektita. Tuleb tavalise šampooniga esimese korraga välja."},
      {n: "Игорь", d: "08.2026", r: 3, t: "Hoiab korralikult, aga minu tihedate juuste jaoks jääb nõrgaks — õhtuks on kõik ära vajunud. Lühikese lõikuse puhul oleks arvatavasti täpselt paras."},
      {n: "Sander", d: "03.2026", r: 5, t: "Matt viimistlus, täpselt nagu tahtsin. Purki jätkub kauaks, sest vaja läheb väga vähe."},
      {n: "Максим", d: "06.2026", r: 4, t: "Mugav, et soengut saab päeva jooksul kohendada. Lõhn on pealekandmisel veidi terav, aga haihtub kiiresti."},
      {n: "Joosep", d: "05.2026", r: 5, t: "Võtsin barberi soovitusel ega kahetse. Juuksed jäävad liikuvaks ja soeng püsib hilisõhtuni."}
    ],
    beard: [
      {n: "Роман", d: "05.2026", r: 5, t: "Nahk habeme all lõpetas sügelemise juba nädalaga. Habe on pehmem — naine märkas enne mind."},
      {n: "Mart", d: "07.2026", r: 5, t: "Imendub kiiresti, rasust läiget ei jää. Karvad püsivad ühtlasemalt, turritajaid on vähem."},
      {n: "Алексей", d: "04.2026", r: 4, t: "Habe on kuulekam, kammimine lihtsam. Neli tärni — kogust on selle hinna kohta vähevõitu."},
      {n: "Indrek", d: "06.2026", r: 5, t: "Kasutan hommikul pärast dušši, piisab tibatillukesest kogusest. Mingit kilet ei jää — habe näeb välja hoolitsetud, mitte kokku määritud."},
      {n: "Дмитрий", d: "08.2026", r: 3, t: "Lõhn on maitseasi — üsna magus, ootasin neutraalsemat. Toode ise töötab, nahk habeme all on rahulik."},
      {n: "Erik", d: "03.2026", r: 5, t: "Kasvatan habet esimest korda ja esimestel nädalatel piinas sügelus. Selle tootega läks tunduvalt mugavamaks, kasutan iga päev."},
      {n: "Владимир", d: "06.2026", r: 4, t: "Pehmendab karmi karva hästi. Pakend võiks mugavam olla — lihtne on liiga palju võtta."},
      {n: "Henri", d: "07.2026", r: 5, t: "Habe ei lähe enam õhtuks kohevile. Lõhn on tagasihoidlik ega vaidle parfüümiga."}
    ],
    face: [
      {n: "Павел", d: "06.2026", r: 5, t: "Nahk ei põle ega puneta pärast raseerimist. Imendub minutiga ega jää kleepuma."},
      {n: "Marten", d: "04.2026", r: 5, t: "Nägu ei läigi enam õhtuks. Kulub vähe, jätkus kaheks kuuks."},
      {n: "Егор", d: "07.2026", r: 4, t: "Nahk on ühtlasem ja rahulikum. Tärn maha jäiga korgi eest — märgade kätega on tüütu avada."},
      {n: "Anu", d: "05.2026", r: 5, t: "Võtsin mehele, kes „kreeme ei kasuta“. Kasutab. Ütleb, et nahk ei tõmba pärast pesemist pingule."},
      {n: "Тимур", d: "08.2026", r: 3, t: "Kallivõitu, aga jätkub kauaks. Mõju on olemas, lihtsalt ootasin selle raha eest rohkemat."},
      {n: "Siim", d: "03.2026", r: 4, t: "Võtab raseerimisjärgse kuivustunde hästi maha. Tekstuur on paks — talvel oli see pluss, suveks võtan vähem."},
      {n: "Виктор", d: "06.2026", r: 5, t: "Lihtne rutiin: pesed näo, kannad peale, unustad ära. Raseerimisärritust on tunduvalt vähem."}
    ],
    body: [
      {n: "Кирилл", d: "05.2026", r: 5, t: "Lõhnab ägedalt, aga aroom kaob kiiresti ega vaidle parfüümiga. Nahk pole pärast dušši pingul."},
      {n: "Kaido", d: "07.2026", r: 5, t: "Pärast jõusaali just õige — peseb kõik maha, nahka üle ei kuivata. Vaht on pehme, loputub jäägitult."},
      {n: "Анна", d: "04.2026", r: 4, t: "Ostsin mehele — lõhn on mehelik, aga mitte labane. Neli tärni: kulub kiiremini, kui tahaks."},
      {n: "Tõnis", d: "06.2026", r: 5, t: "Ei kuivata nahka isegi kaks korda päevas duši all käies. Ostan juba teist korda."},
      {n: "Женя", d: "08.2026", r: 3, t: "Toode on korralik, aga aroom on minu maitse jaoks liiga suitsune. Mees on siiski rahul."},
      {n: "Markus", d: "03.2026", r: 5, t: "Üks neist toodetest, mis muutub märkamatult harjumuseks. Nahk ei kuiva, lõhna on parasjagu."},
      {n: "Олег", d: "06.2026", r: 4, t: "Tihe vaht, loputub kergesti maha. Viis jääb hinna taha — odavamat leiab, aga mitte nii meeldivat."}
    ],
    perfume: [
      {n: "Артур", d: "06.2026", r: 5, t: "Püsib ausalt 6-8 tundi, riietel kauem. Komplimendid tulid juba esimesel päeval."},
      {n: "Kadri", d: "04.2026", r: 5, t: "Valisin mehele kingitust ja läksin täppi. Lõhn on täiskasvanulik ja vaoshoitud, kontoris ei lämmata."},
      {n: "Глеб", d: "07.2026", r: 4, t: "Avaneb huvitavamalt, kui esimestel minutitel tundub. Püsivus on keskmine — õhtuks jääb vaid kerge hõng krae juurde."},
      {n: "Oliver", d: "05.2026", r: 5, t: "Kannan nii tööle kui ka väljaminekuks — igal pool omal kohal. Kahest pihustusest piisab, rohkem pole vaja."},
      {n: "Станислав", d: "03.2026", r: 3, t: "Esimene tund on minu jaoks teravavõitu, siis muutub pehmemaks. Baas meeldib, aga see avang tuleb iga kord üle elada."},
      {n: "Jaan", d: "08.2026", r: 5, t: "Harv juhus, kus internetist tellitud lõhn vastas ootustele. Vaoshoitud, puhas, ilma imaluseta."},
      {n: "Юлия", d: "06.2026", r: 4, t: "Kinkisin sünnipäevaks, pakend näeb välja hinnast kallim. Lõhn on hea, aga kuumaga püsib tagasihoidlikult."}
    ],
    merch: [
      {n: "Денис", d: "05.2026", r: 5, t: "Kanga kvaliteet üllatas meeldivalt — pärast mitut pesu näeb välja nagu uus. Suurus klappis tabeliga."},
      {n: "Maarja", d: "07.2026", r: 5, t: "Võtsin kingituseks — korralikult pakitud, pole häbi kinkida. Kvaliteet on tunduvalt parem, kui merchi puhul ootaks."},
      {n: "Пётр", d: "04.2026", r: 4, t: "Korralikult tehtud, pisiasjad on läbi mõeldud. Neli tärni — tahaks rohkem valikuvariante."},
      {n: "Mihkel", d: "06.2026", r: 5, t: "Kasutan peaaegu iga päev, kulumisjälgi pole. Tavaliselt on merch nii ja naa, see siin on erand."},
      {n: "Светлана", d: "08.2026", r: 3, t: "Sellise asja kohta kallivõitu, kuigi kvaliteet on korralik. Pigem suveniir omadele kui praktiline ost."},
      {n: "Andres", d: "03.2026", r: 4, t: "Korralik asi, puhtalt õmmeldud. Tarne võttis lubatust paar päeva kauem, seepärast neli."}
    ]
  },
  EN: {
    hair: [
      {n: "Марк", d: "05.2026", r: 5, t: "Hair feels soft but doesn't go all fluffy. A little goes a long way — it lasted me almost three months."},
      {n: "Kristjan", d: "07.2026", r: 5, t: "Hair isn't greasy by the evening of day one, and I wash it less often now. The scent is subtle, which is a plus."},
      {n: "Андрей", d: "04.2026", r: 4, t: "Copes even after a day of heavy styling, hair still feels alive by evening. Four stars because of the price, but the result is honest."},
      {n: "Liis", d: "06.2026", r: 5, t: "Bought it for my husband, now we both use it. Hair behaves better and combs through without a struggle."},
      {n: "Rasmus", d: "08.2026", r: 5, t: "My scalp calmed down — no itching after the gym anymore. Rinses out quickly without a trace."},
      {n: "Даниил", d: "03.2026", r: 4, t: "Expected a wow effect, got just plain good hair. Which isn't bad either — still using it."},
      {n: "Martin", d: "07.2026", r: 5, t: "Two months in and there's volume at the roots now. My hair used to go flat by lunchtime — now it holds till evening."},
      {n: "Ольга", d: "05.2026", r: 5, t: "Ordered it for my husband on his barber's advice. His hair feels softer to the touch and he's happy."},
      {n: "Сергей", d: "06.2026", r: 3, t: "Does its job, but the scent is an acquired taste — too herbal. I put up with it because I like the result."},
      {n: "Tanel", d: "04.2026", r: 4, t: "Hair stays clean, no static, sits neatly. Not quite five stars — I wish the volume lasted longer."}
    ],
    styling: [
      {n: "Никита", d: "06.2026", r: 5, t: "Holds the shape till evening, no stickiness, no shine. Next morning there's no hairspray-helmet feeling — it all combs out."},
      {n: "Priit", d: "04.2026", r: 5, t: "Finally a hairstyle that looks natural instead of slicked down. A tiny amount is all it takes."},
      {n: "Артём", d: "07.2026", r: 4, t: "The hold is honest — it survives even the wind by the sea. One star off: it's a bit hard to work through dry hair."},
      {n: "Karl", d: "05.2026", r: 5, t: "Every day before work — hair looks groomed with no helmet effect. Washes out with regular shampoo in one go."},
      {n: "Игорь", d: "08.2026", r: 3, t: "Holds fine, but a bit weak for my thick hair — by evening it all sags. For a short cut I think it would be just right."},
      {n: "Sander", d: "03.2026", r: 5, t: "Matte finish, exactly what I wanted. The tub lasts ages because you need so little."},
      {n: "Максим", d: "06.2026", r: 4, t: "Handy that you can rework the style during the day. The scent is a bit sharp on application but airs out quickly."},
      {n: "Joosep", d: "05.2026", r: 5, t: "Got it on my barber's advice and don't regret it. Hair stays flexible and the shape lives on till late evening."}
    ],
    beard: [
      {n: "Роман", d: "05.2026", r: 5, t: "The skin under my beard stopped itching within a week. The beard is softer too — my wife noticed before I did."},
      {n: "Mart", d: "07.2026", r: 5, t: "Absorbs quickly, no greasy shine. The hairs lie flatter, fewer stick out."},
      {n: "Алексей", d: "04.2026", r: 4, t: "The beard is easier to manage and comb now. Four stars — the amount is a bit small for the price."},
      {n: "Indrek", d: "06.2026", r: 5, t: "I use it in the morning after the shower, the tiniest bit is enough. No film at all — the beard looks groomed, not greased."},
      {n: "Дмитрий", d: "08.2026", r: 3, t: "The scent won't suit everyone — quite sweet, I expected something more neutral. The product itself works, skin under the beard stays calm."},
      {n: "Erik", d: "03.2026", r: 5, t: "Growing a beard for the first time, and the itch drove me crazy those first weeks. With this it got noticeably more comfortable — I use it daily."},
      {n: "Владимир", d: "06.2026", r: 4, t: "Softens coarse hair well. I'd like a handier package though — it's easy to take too much."},
      {n: "Henri", d: "07.2026", r: 5, t: "My beard stopped frizzing up by evening. The scent is restrained and doesn't clash with cologne."}
    ],
    face: [
      {n: "Павел", d: "06.2026", r: 5, t: "No burning or redness after shaving. Absorbs in a minute, no stickiness."},
      {n: "Marten", d: "04.2026", r: 5, t: "My face no longer shines by evening. You need very little — mine lasted two months."},
      {n: "Егор", d: "07.2026", r: 4, t: "Skin looks smoother and calmer. One star off for the tight cap — awkward to open with wet hands."},
      {n: "Anu", d: "05.2026", r: 5, t: "Got it for my husband who 'doesn't use creams'. He uses it. Says his skin doesn't feel tight after washing."},
      {n: "Тимур", d: "08.2026", r: 3, t: "A bit pricey, but it lasts a long time. There is an effect — I just expected more for the money."},
      {n: "Siim", d: "03.2026", r: 4, t: "Really takes away that dry feeling after the razor. The texture is thick — a plus in winter, come summer I use less."},
      {n: "Виктор", d: "06.2026", r: 5, t: "Simple routine: wash, apply, forget. Noticeably less irritation after shaving."}
    ],
    body: [
      {n: "Кирилл", d: "05.2026", r: 5, t: "Smells great, but the scent fades fast and doesn't fight your cologne. Skin isn't tight after the shower."},
      {n: "Kaido", d: "07.2026", r: 5, t: "Perfect after the gym — washes everything off without over-drying the skin. Soft lather that rinses away completely."},
      {n: "Анна", d: "04.2026", r: 4, t: "Bought it for my husband — the scent is masculine but not crude. Four stars: it runs out faster than I'd like."},
      {n: "Tõnis", d: "06.2026", r: 5, t: "Doesn't dry my skin even showering twice a day. Buying it for the second time already."},
      {n: "Женя", d: "08.2026", r: 3, t: "The product is fine, but the scent is too smoky for my taste. My husband is happy with it, though."},
      {n: "Markus", d: "03.2026", r: 5, t: "One of those products that quietly becomes a habit. Skin doesn't dry out, the scent is just right."},
      {n: "Олег", d: "06.2026", r: 4, t: "Rich lather, rinses off easily. Not five stars because of the price — you can find cheaper, just not as pleasant."}
    ],
    perfume: [
      {n: "Артур", d: "06.2026", r: 5, t: "Longevity is an honest 6-8 hours, longer on clothes. Compliments started on day one."},
      {n: "Kadri", d: "04.2026", r: 5, t: "I was picking a gift for my husband and nailed it. A grown-up, restrained scent that doesn't choke the office."},
      {n: "Глеб", d: "07.2026", r: 4, t: "Opens up more interestingly than it sounds in the first minutes. Longevity is average — by evening only a trail at the collar remains."},
      {n: "Oliver", d: "05.2026", r: 5, t: "I wear it to work and on nights out — it fits everywhere. Two sprays are enough, no need for more."},
      {n: "Станислав", d: "03.2026", r: 3, t: "The first hour is a bit sharp for me, then it softens. I like the base, but you have to get through that opening every time."},
      {n: "Jaan", d: "08.2026", r: 5, t: "A rare case where a fragrance ordered online matched expectations. Restrained, clean, no cloying sweetness."},
      {n: "Юлия", d: "06.2026", r: 4, t: "Gave it as a birthday present — the packaging looks more expensive than the price. Good scent, though in the heat it doesn't last as long."}
    ],
    merch: [
      {n: "Денис", d: "05.2026", r: 5, t: "The fabric quality was a pleasant surprise — still looks new after several washes. Size matched the chart."},
      {n: "Maarja", d: "07.2026", r: 5, t: "Bought it as a gift — neatly packaged, nothing to be embarrassed about. Quality is well above what you'd expect from merch."},
      {n: "Пётр", d: "04.2026", r: 4, t: "Solidly made, the small details are thought through. Four stars — I'd like more options to choose from."},
      {n: "Mihkel", d: "06.2026", r: 5, t: "I use it almost every day, no signs of wear. Merch is usually so-so — this one is an exception."},
      {n: "Светлана", d: "08.2026", r: 3, t: "A bit expensive for what it is, though the quality is fine. More a keepsake for the fans than a practical purchase."},
      {n: "Andres", d: "03.2026", r: 4, t: "A solid piece, neatly stitched. Delivery took a couple of days longer than promised, hence the four."}
    ]
  }
};
