import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';
import { LlmFactory, LlmStepHandle } from '../engine/runner';
import { LlmOptions, NodeLlm, TokenUsage } from '../engine/types';
import { costUsd } from './pricing';

export interface LlmCallRecord {
  runId: string | null;
  node: string;
  model: string;
  effort?: string;
  purpose?: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadIn: number;
  cacheWriteIn: number;
  costUsd: number;
  durationMs: number;
  stopReason?: string | null;
  error?: string;
}

export interface LlmRecorder {
  record(entry: LlmCallRecord): Promise<void>;
}

export class NoopRecorder implements LlmRecorder {
  async record(): Promise<void> {}
}

export type Effort = NonNullable<LlmOptions['effort']>;

export interface LlmDefaults {
  model: string;
  effort: Effort;
  maxTokens: number;
}

export const DEFAULTS: LlmDefaults = {
  model: 'claude-sonnet-5',
  effort: 'high',
  maxTokens: 16000,
};

/**
 * Anthropic ustidagi yupqa qatlam.
 * Har chaqiruv `LlmCall` sifatida yoziladi — xarajat hisoboti shundan chiqadi.
 */
export class AnthropicLlm implements LlmFactory {
  constructor(
    private readonly client: Anthropic,
    private readonly recorder: LlmRecorder = new NoopRecorder(),
    private readonly defaults: LlmDefaults = DEFAULTS,
  ) {}

  forStep(runId: string | null, node: string): LlmStepHandle {
    const total: TokenUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

    const run = async <T>(
      opts: LlmOptions | undefined,
      call: (model: string, effort: Effort, maxTokens: number) => Promise<{
        value: T;
        usage: Anthropic.Usage;
        stopReason: string | null;
        model: string;
      }>,
    ): Promise<T> => {
      const model = opts?.model ?? this.defaults.model;
      const effort = opts?.effort ?? this.defaults.effort;
      const maxTokens = opts?.maxTokens ?? this.defaults.maxTokens;
      const startedAt = Date.now();
      try {
        const out = await call(model, effort, maxTokens);
        const counts = {
          tokensIn: out.usage.input_tokens ?? 0,
          tokensOut: out.usage.output_tokens ?? 0,
          cacheReadIn: out.usage.cache_read_input_tokens ?? 0,
          cacheWriteIn: out.usage.cache_creation_input_tokens ?? 0,
        };
        const cost = costUsd(out.model, counts);
        total.tokensIn += counts.tokensIn;
        total.tokensOut += counts.tokensOut;
        total.costUsd += cost;
        await this.recorder.record({
          runId,
          node,
          model: out.model,
          effort,
          purpose: opts?.purpose,
          ...counts,
          costUsd: cost,
          durationMs: Date.now() - startedAt,
          stopReason: out.stopReason,
        });
        return out.value;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await this.recorder.record({
          runId,
          node,
          model,
          effort,
          purpose: opts?.purpose,
          tokensIn: 0,
          tokensOut: 0,
          cacheReadIn: 0,
          cacheWriteIn: 0,
          costUsd: 0,
          durationMs: Date.now() - startedAt,
          error,
        });
        throw err;
      }
    };

    const llm: NodeLlm = {
      json: <T>(schema: ZodType<T>, prompt: string, opts?: LlmOptions) =>
        run<T>(opts, async (model, effort, maxTokens) => {
          const response = await this.client.messages.parse({
            model,
            max_tokens: maxTokens,
            thinking: { type: 'adaptive' },
            output_config: { effort, format: zodOutputFormat(schema) },
            ...(opts?.system ? { system: opts.system } : {}),
            messages: [{ role: 'user', content: prompt }],
          });
          assertNotRefused(response.stop_reason, response.stop_details);
          if (response.parsed_output == null) {
            throw new Error('javob sxemaga tushmadi (parsed_output bo\'sh)');
          }
          return {
            value: response.parsed_output as T,
            usage: response.usage,
            stopReason: response.stop_reason,
            model: response.model,
          };
        }),

      text: (prompt: string, opts?: LlmOptions) =>
        run<string>(opts, async (model, effort, maxTokens) => {
          const response = await this.client.messages.create({
            model,
            max_tokens: maxTokens,
            thinking: { type: 'adaptive' },
            output_config: { effort },
            ...(opts?.system ? { system: opts.system } : {}),
            messages: [{ role: 'user', content: prompt }],
          });
          assertNotRefused(response.stop_reason, response.stop_details);
          const text = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
            .trim();
          return {
            value: text,
            usage: response.usage,
            stopReason: response.stop_reason,
            model: response.model,
          };
        }),
    };

    return { llm, usage: () => ({ ...total }) };
  }
}

/** Refusal HTTP 200 bilan keladi — `content` o'qishdan oldin tekshiriladi. */
function assertNotRefused(
  stopReason: string | null,
  details: Anthropic.RefusalStopDetails | null,
): void {
  if (stopReason !== 'refusal') return;
  throw new Error(
    `model rad etdi (${details?.category ?? 'noma\'lum'}): ${details?.explanation ?? ''}`.trim(),
  );
}
