# Tezcode AI Agents

Sardorning ichki agent platformasi. Agentlar: **Sales**, **Research**, **Content**,
ularni birlashtiruvchi **Orchestrator**. Har agentga alohida Telegram bot, lekin
bitta jarayon.

Holat: graph engine, kuzatuv, xarajat hisobi va Telegram botlar bor. Research Agent ochiq manbalardan mijoz nomzodlarini ovlaydi, Postgres'ga (Lead/Fact/Pain) yozadi va Sales navbatiga qo'yadi. Sales va Content uchun ish graph'lari hali vaqtinchalik.

## Ishga tushirish

```bash
pnpm install
pnpm demo          # engine tekshiruvi — DB va API kalitisiz ishlaydi
pnpm typecheck

pnpm docker:up     # Postgres
pnpm db:migrate
pnpm dev           # botlar bilan birga ishga tushadi
```

> Ilovani `tsx` bilan ishga tushirmang — esbuild dekorator metadatasini
> chiqarmaydi va Nest DI sinadi. Ilova uchun `nest` (tsc), alohida
> skriptlar uchun `tsx`.

DB kerak bo'lganda (Docker Desktop ochiq bo'lsin):

```bash
cp .env.example .env
pnpm docker:up
pnpm db:migrate
```

## Research Agent — mijoz ovlash

Research botida `/vazifa <ov mavzusi>` yuborilganda (masalan: "IT/AI kerak bo'lgan restoranlar Toshkentda") agent DuckDuckGo'dan dastlabki natijalarni qidiradi, o'n ikkitagacha ochiq sahifani o'qiydi va LLM orqali konkret biznes nomzodlarini ajratadi. Har nomzod uchun manba bilan tasdiqlangan bitta fakt va bitta og'riq gipotezasi bo'lishi shart — manbasiz nomzod yoki dalilsiz og'riq saqlanmaydi.

Umumiy qidiruvga qo'shimcha ravishda har bir ov quyidagi frilanser/ish topshiriq platformalarini `site:` operatori bilan alohida qidiradi: UzITHub (uzithub.uz), Dowork (dowork.uz), GigLancer (giglancer.uz), Worklance (worklance.uz), Freelancer Mehnat (freelancer.mehnat.uz), Kwork (kwork.ru), Habr Freelance (freelance.habr.com). Bitta sayt bloklansa yoki bo'sh natija bersa, faqat o'sha sayt o'tkazib yuboriladi. Barcha manbalar bitta ro'yxatga URL bo'yicha takrorsiz birlashtiriladi va LLM promptining hajmini (xarajatni) nazorat qilish uchun umumiy songa chegaralanadi. Bu saytlardan topilgan nomzod uchun topshiriq egasining profili (`person`/`role`) ham hisobotda ko'rsatiladi.

Har nomzod Postgres'ga yoziladi: `tezcode-outbound` loyihasi ostida Lead upsert qilinadi (kompaniya nomi bo'yicha — takror ov qilinsa yangilanadi, xato bermaydi), Fact va Pain qatorlari qo'shiladi, so'ng Lead holati `researched`ga o'tkaziladi va qisqa izoh yoziladi. Bu — Sales agentga uzatish: Sales hozircha `Lead` jadvalidan `status="researched"` bo'yicha so'raydi (Sales'ning o'z graph mantig'i hali yo'q).

Sahifa yuklashda `http(s)` manzillariga ruxsat beriladi; localhost, xususiy IP va ichki redirect manzillari rad etiladi. Web sahifa matni ishonchsiz ma'lumot sifatida LLM'ga uzatiladi. Bitta nomzodni saqlashda xato bo'lsa, faqat o'sha nomzod o'tkazib yuboriladi — butun ov to'xtamaydi.

`pnpm test:research` manba filtri, sahifa matni ajratish va manba raqamini tekshirishni sinaydi.

## Arxitektura

**Graph engine** (`src/engine/`) — LangGraph o'rniga o'zimizniki, ~600 qator.

| Fayl | Vazifasi |
|---|---|
| `types.ts` | `interrupt()`, `RunCtx`, reducerlar |
| `graph.ts` | Quruvchi: `node` / `edge` / `route` / `reducer`, `compile()` da tekshiruv |
| `runner.ts` | Ijro sikli: checkpoint, interrupt, chegara (qadam va xarajat) |
| `checkpointer.ts` | Saqlash interfeysi |
| `memory.checkpointer.ts` | DB'siz variant (demo/test) |

Ikki kafolat:

1. **Checkpoint har tugundan keyin** — jarayon yiqilsa ish yo'qolmaydi.
2. **Interrupt runni muzlatadi** — `resume(runId, "javob")` o'sha tugunni odamning
   javobi bilan qayta ishga tushiradi. Javob faqat o'sha tugunga beriladi.

Marshrut **deterministik**: `route()` oddiy funksiya, LLM emas. LLM faqat tugun
ichida chaqiriladi. Sabab: Hermes v2 da agent-sikl har videoga 150–300k token yegan.

**LLM qatlami** (`src/llm/`) — `claude-opus-5`, adaptive thinking, `effort`.
`llm.json(schema, prompt)` Zod sxemasi bo'yicha tipli javob qaytaradi
(`messages.parse` + `zodOutputFormat`). Har chaqiruv `LlmCall` jadvaliga narxi
bilan yoziladi. `stop_reason: "refusal"` javob o'qilishidan oldin tekshiriladi.

**Kuzatuv** (`prisma/schema.prisma`) — `Run`, `Checkpoint`, `Step`, `ToolCall`,
`LlmCall`. Har run qayta o'ynatiladi, har tugunning vaqti va narxi ko'rinadi.

## Qoidalar

- Orchestrator LLM emas — router.
- Tashqariga chiqadigan har harakat odam tasdig'idan o'tadi (`interrupt`).
- Nojo'ya ta'sirli ish `ctx.idem(key, fn)` ichida — qayta ishga tushganda takrorlanmaydi.
- Inline tugma yo'q: tasdiq Telegram'da tabiiy tilda beriladi.

## Telegram qatlami

Har agentga alohida bot, lekin **bitta jarayon**. Ikkinchi nusxa ishga tushsa
Postgres advisory lock uni to'xtatadi — Telegram 409 Conflict bo'lmaydi.

| Bot | Agent |
|---|---|
| `@InstaClonee_bot` | Sales |
| `@sardor_response_chat_bot` | Research |
| `@savedInstaa_bot` | Content |
| (token kutilmoqda) | Dispetcher |

Buyruqlar: `/start`, `/holat` (kutayotgan ish + 24 soatlik xarajat), `/bekor`.
Inline tugma yo'q — tasdiq tabiiy tilda: `ha` / `yo'q` / nima o'zgartirishni yozasiz.
Faqat `TG_OWNER_CHAT_ID` javob oladi, boshqalar jim qoldiriladi.

Bitta suhbatda bir vaqtda **bitta** kutayotgan run bo'ladi — shuning uchun "ha"
nimaga tegishli ekani doim aniq.

Har javobingiz `Outcome` jadvaliga yorliq bo'lib tushadi (`approved` /
`edited` / `rejected`) — ML shu yerdan o'qitiladi.

## Keyingi qadamlar

3. Sales: diagnoz + draft + guardrails
4. `hunt` (Chrome) + Orchestrator
5. Content Agent — Hermes v3 pipeline ustiga
