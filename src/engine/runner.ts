import { CompiledGraph } from './graph';
import { Checkpointer } from './checkpointer';
import {
  END,
  isInterrupt,
  NodeLlm,
  RunCtx,
  RunStatus,
  TokenUsage,
  ZERO_USAGE,
} from './types';

/** Bitta tugun uchun LLM va uning sarfi. */
export interface LlmStepHandle {
  llm: NodeLlm;
  usage(): TokenUsage;
}

export interface LlmFactory {
  /** runId null — bu graph run emas (masalan suhbat rejimi). */
  forStep(runId: string | null, node: string): LlmStepHandle;
}

export interface RunnerLimits {
  /** Sikldan himoya. */
  maxSteps: number;
  /** Qimmat runni o'zi to'xtatadi. */
  maxCostUsd: number;
}

export interface RunOutcome<S> {
  runId: string;
  status: RunStatus;
  state: S;
  interrupt?: { question: string; payload?: unknown; node: string };
  error?: string;
}

export interface StartOptions {
  tenantId?: string;
  threadKey?: string;
}

const DEFAULT_LIMITS: RunnerLimits = { maxSteps: 50, maxCostUsd: 2 };

/**
 * Graph ijrochisi.
 *
 * Ikki kafolat:
 *  1. Checkpoint HAR tugundan keyin yoziladi — jarayon yiqilsa ish yo'qolmaydi.
 *  2. Interrupt run'ni WAITING holatida muzlatadi; `resume()` o'sha tugunni
 *     odamning javobi bilan QAYTA ishga tushiradi.
 */
export class GraphRunner {
  private readonly limits: RunnerLimits;

  constructor(
    private readonly checkpointer: Checkpointer,
    private readonly llm: LlmFactory,
    limits: Partial<RunnerLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  async start<S extends object>(
    graph: CompiledGraph<S>,
    initial: S,
    options: StartOptions = {},
  ): Promise<RunOutcome<S>> {
    const run = await this.checkpointer.create({
      graph: graph.name,
      state: initial,
      tenantId: options.tenantId,
      threadKey: options.threadKey,
    });
    return this.loop(graph, run.id, initial, graph.entry, 0, undefined);
  }

  /** WAITING run'ni odamning javobi bilan davom ettiradi. */
  async resume<S extends object>(
    graph: CompiledGraph<S>,
    runId: string,
    answer: string,
  ): Promise<RunOutcome<S>> {
    const run = await this.checkpointer.load(runId);
    if (!run) throw new Error(`run topilmadi: ${runId}`);
    if (run.status !== 'WAITING') {
      throw new Error(`run WAITING emas (${run.status}): ${runId}`);
    }
    const node = run.interrupt?.node ?? run.currentNode;
    if (!node) throw new Error(`run qaysi tugunda to'xtagani noma'lum: ${runId}`);

    await this.checkpointer.setStatus(runId, 'RUNNING');
    return this.loop(graph, runId, run.state as S, node, run.steps, answer);
  }

  private async loop<S extends object>(
    graph: CompiledGraph<S>,
    runId: string,
    initialState: S,
    startNode: string,
    startSeq: number,
    resumeAnswer: string | undefined,
  ): Promise<RunOutcome<S>> {
    let state = initialState;
    let node = startNode;
    let seq = startSeq;
    // Odamning javobi FAQAT to'xtagan tugunga beriladi, keyingilarga emas.
    let resume = resumeAnswer;

    for (;;) {
      if (node === END) {
        await this.checkpointer.setStatus(runId, 'DONE');
        return { runId, status: 'DONE', state };
      }

      const snapshot = await this.checkpointer.load(runId);
      if (seq >= this.limits.maxSteps) {
        const error = `qadam chegarasi (${this.limits.maxSteps}) oshdi`;
        await this.checkpointer.setStatus(runId, 'ABORTED', error);
        return { runId, status: 'ABORTED', state, error };
      }
      if ((snapshot?.costUsd ?? 0) >= this.limits.maxCostUsd) {
        const error = `xarajat chegarasi ($${this.limits.maxCostUsd}) oshdi`;
        await this.checkpointer.setStatus(runId, 'ABORTED', error);
        return { runId, status: 'ABORTED', state, error };
      }

      seq += 1;
      const handle = this.llm.forStep(runId, node);
      const currentNode = node;
      const ctx: RunCtx = {
        runId,
        node: currentNode,
        seq,
        resume,
        llm: handle.llm,
        idem: (key, fn) => this.checkpointer.idem(runId, currentNode, key, fn),
        log: (message) => console.log(`[${runId.slice(0, 8)}][${currentNode}] ${message}`),
      };

      const startedAt = Date.now();
      let result;
      try {
        result = await graph.nodeFn(currentNode)(state, ctx);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await this.checkpointer.afterStep({
          runId,
          seq,
          node: currentNode,
          status: 'error',
          state,
          durationMs: Date.now() - startedAt,
          usage: handle.usage() ?? ZERO_USAGE,
          error,
        });
        await this.checkpointer.setStatus(runId, 'FAILED', error);
        return { runId, status: 'FAILED', state, error };
      }

      resume = undefined;
      const durationMs = Date.now() - startedAt;
      const usage = handle.usage();

      if (isInterrupt(result)) {
        await this.checkpointer.afterStep({
          runId,
          seq,
          node: currentNode,
          status: 'interrupt',
          state,
          durationMs,
          usage,
        });
        await this.checkpointer.setWaiting(runId, currentNode, result);
        return {
          runId,
          status: 'WAITING',
          state,
          interrupt: { question: result.question, payload: result.payload, node: currentNode },
        };
      }

      if (result) state = graph.merge(state, result as Partial<S>);

      await this.checkpointer.afterStep({
        runId,
        seq,
        node: currentNode,
        status: 'ok',
        state,
        durationMs,
        usage,
      });

      node = graph.next(currentNode, state);
    }
  }
}
