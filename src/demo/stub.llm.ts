import { LlmFactory, LlmStepHandle } from '../engine/runner';
import { LlmOptions, NodeLlm, TokenUsage } from '../engine/types';

/** API kalitisiz ishlaydigan soxta LLM — engine testi uchun. */
export class StubLlm implements LlmFactory {
  private counter = 0;

  forStep(_runId: string | null, _node: string): LlmStepHandle {
    const usage: TokenUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    const bump = (): void => {
      usage.tokensIn += 120;
      usage.tokensOut += 60;
      usage.costUsd += 0.0021;
    };
    const llm: NodeLlm = {
      text: async (prompt: string, _opts?: LlmOptions) => {
        bump();
        this.counter += 1;
        return `[v${this.counter}] ${prompt}`;
      },
      json: async () => {
        bump();
        throw new Error('StubLlm.json demoda ishlatilmaydi');
      },
    };
    return { llm, usage: () => ({ ...usage }) };
  }
}
