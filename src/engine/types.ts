/** Graph engine — asosiy tiplar. */

export const END = '__end__' as const;

export type RunStatus = 'RUNNING' | 'WAITING' | 'DONE' | 'FAILED' | 'ABORTED';

/**
 * Tugun odam javobini kutayotganini bildiradi.
 * Exception emas, QAYTARILADIGAN qiymat — oqim kodda ko'rinib tursin.
 */
export interface InterruptSignal {
  readonly kind: 'interrupt';
  /** Odamga beriladigan savol (Telegram'ga shu matn ketadi). */
  question: string;
  /** Kontekst: draft, lead id va h.k. */
  payload?: unknown;
}

export function interrupt(question: string, payload?: unknown): InterruptSignal {
  return { kind: 'interrupt', question, payload };
}

export function isInterrupt(value: unknown): value is InterruptSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as InterruptSignal).kind === 'interrupt'
  );
}

export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export const ZERO_USAGE: TokenUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

/** Tugun ichida mavjud bo'ladigan kontekst. */
export interface RunCtx {
  runId: string;
  node: string;
  seq: number;
  /** WAITING dan tiklanganda — odamning javobi. Oddiy ishda undefined. */
  resume?: string;
  /** Xarajati avtomatik yoziladigan LLM. */
  llm: NodeLlm;
  /**
   * Nojo'ya ta'sirli ishni bir martaga kafolatlaydi.
   * Run yiqilib qayta tiklansa, o'sha kalit bilan saqlangan natija qaytariladi.
   */
  idem<T>(key: string, fn: () => Promise<T>): Promise<T>;
  log(message: string): void;
}

export interface LlmOptions {
  system?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
  /** Xarajat hisobotida ko'rinadigan nom. */
  purpose?: string;
  /** Javob kutish chegarasi (ms) — og'ir chaqiruvlar uchun uzaytiriladi. */
  timeoutMs?: number;
}

/** Tugunga beriladigan LLM fasadi — chaqiruvlar runga bog'lab yoziladi. */
export interface NodeLlm {
  /** Zod sxemasi bo'yicha tipli JSON. Sxemaga tushmasa — xato. */
  json<T>(schema: import('zod').ZodType<T>, prompt: string, opts?: LlmOptions): Promise<T>;
  /** Oddiy matn javob. */
  text(prompt: string, opts?: LlmOptions): Promise<string>;
}

export type NodeResult<S> = Partial<S> | InterruptSignal | void;
export type NodeFn<S> = (state: S, ctx: RunCtx) => Promise<NodeResult<S>>;
export type Router<S> = (state: S) => string;
export type FieldReducer = (prev: unknown, next: unknown) => unknown;

/** Massiv maydonlar uchun odatiy reducer: almashtirmaydi, qo'shadi. */
export const appendReducer: FieldReducer = (prev, next) =>
  ([] as unknown[]).concat(Array.isArray(prev) ? prev : [], Array.isArray(next) ? next : [next]);
