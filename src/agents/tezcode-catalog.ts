/**
 * Tezcode (tezcode.dev) haqiqiy xizmatlar/mahsulotlar katalogi — HUNT promptiga
 * "yechim taklifi" (solution) uchun asos sifatida beriladi. Manba: tezcode.dev/llms.txt
 * (2026-10-02 da olingan). Narxlar va mahsulot ro'yxati o'zgarsa, shu faylni
 * qayta sinxronlash kerak.
 */
export const TEZCODE_CATALOG = `
Tezcode (tezcode.dev) — Toshkentdagi AI Software Factory, asoschisi Bekzod Mirzaaliyev, 16 kishilik jamoa, IT Park rezidenti.

XIZMATLAR VA NARXLAR (dan boshlab):
- AI chatbot (Telegram/Instagram/WhatsApp/sayt, CRM bilan integratsiya) — $339 dan
- AI agent (sotuv, qo'llab-quvvatlash, lid saralash, ichki avtomatizatsiya) — $400 dan
- AI avtomatizatsiya (jarayonlarni AI bilan avtomatlashtirish) — $200/oy dan
- Biznes avtomatlashtirish (savdo/ombor/hisobot) — $400 dan
- CRM integratsiya (amoCRM, Bitrix24, HubSpot, 1C, Sales Doctor ulash/sozlash/migratsiya) — $700 dan
- AI video analitika (mavjud IP kameralar bilan: odam sanash, yuzni tanish orqali davomat, ish xavfsizligi/kaska-forma nazorati, avto raqam tanish ANPR) — $990 dan
- Telegram bot + Mini App do'kon (Click/Payme to'lov) — $279 dan
- POS tizimi — RAOS (do'kon/restoran: kassa, ombor, mijoz, hisobot, offline-first) — 249 000 so'm/oy dan
- Klinika CRM — ClinicaGo (qabul, navbat, bemor bazasi, moliya, xodim jadvali) — $25/oy dan
- Xodim nazorati — WorkControl (vazifa, davomat, samaradorlik) — $35/oy dan
- Buyurtma dastur (custom web/mobil/desktop) — MVP $1000 dan

TAYYOR MAHSULOTLAR (vertikal bo'yicha to'g'ridan-to'g'ri taklif qilish uchun):
- Do'kon/market/chakana savdo → RAOS POS (kassa, ombor, hisobot)
- Restoran/kafe → RAOS POS + Telegram bot + AI video analitika (xavfsizlik/band stol nazorati)
- Klinika/shifoxona/stomatologiya → ClinicaGo (qabul, navbat, bemor bazasi) ± HamshiraGo (uyga chaqiriladigan hamshira)
- Ishlab chiqarish/ombor/qurilish/ofis (ko'p xodimli) → WorkControl (xodim nazorati) ± AI video analitika (kaska/forma, xavfsizlik)
- Savdo markazi/avtoturargoh/ishlab chiqarish (kameralar bor joy) → AI video analitika (odam sanash, ANPR, xavfsizlik)
- Istalgan biznes — mijoz bilan ko'p yozishadigan (sotuv, qo'llab-quvvatlash) → AI chatbot / AI agent
- CRM ishlatadigan lekin kanallarga ulanmagan (amoCRM/Bitrix24/1C) → CRM integratsiya

QOIDA: Yuqoridagi ro'yxatdan eng mos xizmat(lar)ni tanla. Agar nomzodning biznes turi ro'yxatda aniq yo'q bo'lsa, shu katalogdagi yondashuvga asoslanib (AI chatbot/agent, avtomatlashtirish, CRM, video analitika kabi umumiy toifalardan) ENG MANTIQIY yechimni o'zing taklif qil — lekin Tezcode qila olmaydigan narsani (masalan apparat ishlab chiqarish, yuridik xizmat) taklif qilma.
`.trim();
