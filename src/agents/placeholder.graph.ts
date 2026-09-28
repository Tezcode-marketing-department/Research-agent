/**
 * Vaqtinchalik graph — LLM'siz.
 * Maqsad: Telegram ↔ engine zanjirini bugun to'liq sinab ko'rish
 * (to'xtash → tabiiy tilda tuzatish → tasdiq). 3–4 qadamda haqiqiy
 * Research va Sales graphlari shuni almashtiradi.
 */
import { graph } from '../engine/graph';
import { END, interrupt } from '../engine/types';

export interface PlaceholderState {
  agent: string;
  input: string;
  draft?: string;
  revisions: string[];
  decision?: 'approved' | 'rejected';
  attempts: number;
}

const MAX_ATTEMPTS = 3;

export type Intent = 'approve' | 'reject' | 'edit';

/**
 * Hozircha qoidalar. Keyin: arzon model + `Outcome` jadvalidan o'qitilgan klassifikator
 * (har javobingiz yorliq bo'lib yig'iladi).
 */
export function parseIntent(answer: string): Intent {
  const text = answer.trim().toLowerCase();
  if (/^(ha\b|xa\b|yubor|mayli|bo'?ldi|zo'?r|ok\b|to'?g'?ri)/.test(text)) return 'approve';
  if (/^(yo'?q|kerak emas|rad|bekor|to'?xta)/.test(text)) return 'reject';
  return 'edit';
}

export const placeholderGraph = graph<PlaceholderState>('placeholder')
  .reducer('revisions', (prev, next) =>
    ([] as string[]).concat((prev as string[]) ?? [], next as string[]),
  )

  .node('draft', async (state) => {
    const last = state.revisions.at(-1);
    const draft = last
      ? `${state.input}\n\n(tuzatish hisobga olindi: ${last})`
      : state.input;
    return { draft, attempts: state.attempts + 1 };
  })

  .node('review', async (state, ctx) => {
    if (ctx.resume === undefined) {
      return interrupt(
        `${state.agent} — natija:\n\n${state.draft}\n\nMa'qulmi? ("ha" / "yo'q" / nima o'zgartirishni yozing)`,
        { draft: state.draft, attempts: state.attempts },
      );
    }
    const intent = parseIntent(ctx.resume);
    if (intent === 'approve') return { decision: 'approved' as const };
    if (intent === 'reject') return { decision: 'rejected' as const };
    return { revisions: [ctx.resume] as unknown as PlaceholderState['revisions'] };
  })

  .node('done', async (_state, ctx) => {
    ctx.log('tasdiqlandi');
    return {};
  })

  .node('dead', async (_state, ctx) => {
    ctx.log('rad etildi yoki urinishlar tugadi');
    return {};
  })

  .edge('draft', 'review')
  .route('review', (state) => {
    if (state.decision === 'approved') return 'done';
    if (state.decision === 'rejected') return 'dead';
    return state.attempts < MAX_ATTEMPTS ? 'draft' : 'dead';
  })
  .edge('done', END)
  .edge('dead', END)
  .compile();
