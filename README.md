# Tezcode AI Agents

Sardorning ichki agent platformasi. Agentlar: **Sales**, **Research**, **Content**,
ularni birlashtiruvchi **Orchestrator**. Har agentga alohida Telegram bot, lekin
bitta jarayon.

Holat: **1–2-qadam tugadi** — graph engine, kuzatuv, xarajat hisobi va Telegram botlar.

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

3. Research Agent — dalilli dossier
4. Sales: diagnoz + draft + guardrails
5. `hunt` (Chrome) + Orchestrator
6. Content Agent — Hermes v3 pipeline ustiga
