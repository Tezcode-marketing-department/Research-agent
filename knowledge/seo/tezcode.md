# Tezcode (tezcode.dev) — SEO / GEO / AEO holati

Yangilangan: 2026-09-22. Manba: repo git tarixi (2026-06-01 dan beri 154 commit,
shundan 57 tasi SEO/GEO), Obsidian `PROJECTS/tezcode-landing/`, agent bazasidagi
auditlar.

---

## 1. Qisqacha holat

| Nima | Holat |
|---|---|
| Sayt | Next.js 15 app router, Railway, **www.tezcode.dev** (apex 301 → www) |
| Tillar | uz, ru, en, uk, ar (5 ta) |
| Route'lar | ~78 ta sahifa |
| Sitemap | `src/app/sitemap.ts` + `/sitemap.xml` rewrite bilan indeks beradi |
| robots | `src/app/robots.ts` — AI botlar ochiq, Applebot qo'shilgan |
| llms.txt | `src/app/llms.txt/route.ts` — har xizmat sahifasi va narxlari bilan |
| JSON-LD | 63 faylda |
| Audit ballari | /ai-agent 100 · /ai-avtomatizatsiya 86 · /biz-haqimizda 86 · /it-xizmatlar 79 · /aloqa 79 |

**Kuchli tomoni:** texnik qatlam va GEO fayllari yaxshi qurilgan.
**Zaif tomoni:** avtoritet (backlink) va o'lchov. Reyting o'lchanmagan.

---

## 2. Qilingan ishlar (commitlardan)

### Entity va Organization
- Organization sxemasi "AI" ga bog'landi, xizmat hududi va offer katalogi e'lon qilindi
- Sardor Madaliyev **xonanda bilan bir xil ismli** — schema orqali ajratildi
  (`2099b53`), Person profili AI Engineer sifatida kengaytirildi
- Sardorning maxsavdo.uz dagi profili bilan `sameAs` orqali bog'landi
- Maqolalarga aniq muallif byline qo'yildi

### Sahifa va kontent
- Soha landing'lari: restoran uchun AI, go'zallik saloni uchun AI (5 tilda)
- AI video analitika xizmati sahifasi
- amoCRM vs Bitrix24 taqqoslash sahifasi (5 tilda)
- CRM integratsiya sahifasi + ichki havolalar
- **Yupqa shahar sahifalari olib tashlandi** — sitemap 84 → 64 URL (`c79296f`)

### GEO / AEO
- `llms.txt` da har bir xizmat sahifasi ro'yxati — AI dvigatellar faqat `/` ga
  emas, aniq sahifaga havola bersin (`f78c2b0`)
- llms.txt ga xizmat narxlari qo'shildi (`d915749`)
- 10 ta xizmat sahifasiga Service schema'da Offer narxi (`f2f17c3`)
- AI Overview uchun "kameralarni AI bilan qanday avtomatlashtirish" FAQ (5 til)
- Applebot + Apple web-app meta — Safari va Siri uchun (`362474b`)
- RU sahifalarda kirilcha **"ИИ"** atamasi va so'mdagi narxlar (`bc20ff0`)

### Texnik
- `/sitemap.xml` redirect emas, **rewrite** bilan beriladi (`7dc51e8`)
- Tarjimasi yo'q sahifalar locale sitemap'idan chiqarildi (`5c9c37b`)
- Hero raqamlari SSR da real qiymat bilan chiqadi, bo'sh Offer olib tashlandi

---

## 3. Qidiruv tizimlari

| Tizim | Holat |
|---|---|
| Google Search Console | Ulangan (DNS TXT), 285 sahifa indekslangan |
| Bing Webmaster | Ulangan (GSC importi) — **ChatGPT va Copilot shuni ishlatadi** |
| Yandex Webmaster | 2FA kutyapti — tugallanmagan |

---

## 4. Raqobatchilar (2026-06-28 tahlili)

- **101digital.uz** — eng kuchli: 5 til, boy schema, GEO bo'yicha ishlaydi
- **innosoft.uz** — texnik SEO kuchli, lekin `/ru/blog` bo'sh
- **aisolution.uz** — faqat rus tilida, schema yo'q. 28 kunda atigi 90 Google
  o'tish — ya'ni **bozor hali bo'sh**
- **Parsing / ma'lumot yig'ish nishasini hech kim egallamagan** — Tezcode
  ixtisosi shu, lekin sahifa qilinmagan

---

## 5. Ochiq vazifalar (agent bazasida, hammasi `open`)

1. Bosh sahifa title'ni 65 belgigacha qisqartirish
2. `/ai-avtomatizatsiya` title (69) va description (188) uzunligini qisqartirish
3. Meta description'larni 150-160 belgigacha qisqartirish (bir nechta sahifa)
4. `/aloqa` va `/biz-haqimizda` ga FAQPage va BreadcrumbList JSON-LD
5. `/it-xizmatlar`: description qisqartirish + BreadcrumbList + AEO
6. Barcha sahifalarga savol shaklidagi H2 qo'shib AEO'ni kuchaytirish

## 6. Ochiq, lekin agentdan tashqari (Sardor qiladi)

- **Backlink** — eng muhim, reyting shu bilan ko'tariladi:
  IT Park rezident ro'yxati (rezidentmiz, oson `.uz` havola), Clutch,
  GoodFirms, LinkedIn company page, Crunchbase, Wikidata, Spot.uz / Kun.uz
  maqolasi, goldenpages.uz / yellowpages.uz
- Reddit / Quora ishtiroki — AI javoblarida eng ko'p iqtibos olinadigan manba
- "Top AI companies Tashkent 2026" listicle'larga kirish (TechBehemoths'da
  raqobatchilar bor, Tezcode yo'q)

---

## 7. O'lchanmagan narsalar (halol chegara)

- **Hech bir so'rov bo'yicha pozitsiya o'lchanmagan** — `rank_check` hali
  ishlatilmagan, boshlang'ich nuqta yo'q
- ChatGPT / Perplexity / AI Overview Tezcode'ni tilga oladimi — tekshirilmagan
- Core Web Vitals / PageSpeed — o'lchanmagan
- GSC raqamlari (impression, klik, o'rtacha pozitsiya) agent bazasida yo'q
