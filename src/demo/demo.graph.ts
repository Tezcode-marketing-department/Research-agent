/**
 * Engine tekshiruvi: draft → review(interrupt) → send.
 * LLM va DB'siz ishlaydi — maqsad to'xtash/davom etish va shartli qaytishni isbotlash.
 */
import { graph } from '../engine/graph';
import { END, interrupt } from '../engine/types';

export interface DemoState {
  topic: string;
  draft?: string;
  /** Sardorning tuzatishlari — reducer bilan yig'iladi. */
  revisions: string[];
  decision?: 'approved' | 'rejected';
  sent?: boolean;
  attempts: number;
}

const MAX_ATTEMPTS = 3;

export type Intent = 'approve' | 'reject' | 'edit';

/** Haqiqiy tizimda bu arzon LLM chaqiruvi bo'ladi; demoda — oddiy qoidalar. */
export function parseIntent(answer: string): Intent {
  const text = answer.trim().toLowerCase();
  if (/^(ha|xa|yubor|mayli|bo'ldi|ok)\b/.test(text)) return 'approve';
  if (/^(yo'q|yoq|kerak emas|rad)\b/.test(text)) return 'reject';
  return 'edit';
}

export const demoGraph = graph<DemoState>('demo')
  .reducer('revisions', (prev, next) =>
    ([] as string[]).concat((prev as string[]) ?? [], next as string[]),
  )

  .node('draft', async (state, ctx) => {
    const notes = state.revisions.length
      ? ` (tuzatish: ${state.revisions[state.revisions.length - 1]})`
      : '';
    const draft = await ctx.llm.text(`"${state.topic}" uchun qisqa xabar yoz${notes}`, {
      purpose: 'draft',
    });
    return { draft, attempts: state.attempts + 1 };
  })

  .node('review', async (state, ctx) => {
    if (ctx.resume === undefined) {
      // Run shu yerda muzlaydi. Javob kelmaguncha hech narsa bajarilmaydi.
      return interrupt(`Draft tayyor:\n\n${state.draft}\n\nYuboraymi?`, {
        draft: state.draft,
      });
    }
    const intent = parseIntent(ctx.resume);
    if (intent === 'approve') return { decision: 'approved' as const };
    if (intent === 'reject') return { decision: 'rejected' as const };
    // Tahrir: izoh saqlanadi, qaror qo'yilmaydi → router "draft" ga qaytaradi.
    return { revisions: [ctx.resume] as unknown as DemoState['revisions'] };
  })

  .node('send', async (state, ctx) => {
    // Qayta ishga tushsa ikki marta ketmasin.
    await ctx.idem('send-message', async () => {
      ctx.log(`yuborildi: ${state.draft}`);
      return { ok: true };
    });
    return { sent: true };
  })

  .node('dead', async (_state, ctx) => {
    ctx.log('to\'xtatildi');
    return {};
  })

  .edge('draft', 'review')
  .route('review', (state) => {
    if (state.decision === 'approved') return 'send';
    if (state.decision === 'rejected') return 'dead';
    return state.attempts < MAX_ATTEMPTS ? 'draft' : 'dead';
  })
  .edge('send', END)
  .edge('dead', END)
  .compile();
