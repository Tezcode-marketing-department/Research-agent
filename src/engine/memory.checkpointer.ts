import { randomUUID } from 'node:crypto';
import { Checkpointer, CreateRunInput, AfterStepInput, RunRecord } from './checkpointer';
import { InterruptSignal, RunStatus } from './types';

/** DB'siz ishlaydigan checkpointer — demo va testlar uchun. */
export class MemoryCheckpointer implements Checkpointer {
  private readonly runs = new Map<string, RunRecord>();
  private readonly idemStore = new Map<string, unknown>();
  readonly steps: AfterStepInput[] = [];

  async create(input: CreateRunInput): Promise<RunRecord> {
    const run: RunRecord = {
      id: randomUUID(),
      graph: input.graph,
      status: 'RUNNING',
      currentNode: null,
      state: input.state,
      interrupt: null,
      steps: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      threadKey: input.threadKey ?? null,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async load(runId: string): Promise<RunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async afterStep(input: AfterStepInput): Promise<void> {
    const run = this.runs.get(input.runId);
    if (!run) throw new Error(`run topilmadi: ${input.runId}`);
    run.state = input.state;
    run.currentNode = input.node;
    run.steps = input.seq;
    run.tokensIn += input.usage.tokensIn;
    run.tokensOut += input.usage.tokensOut;
    run.costUsd += input.usage.costUsd;
    this.steps.push(input);
  }

  async setWaiting(runId: string, node: string, signal: InterruptSignal): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run topilmadi: ${runId}`);
    run.status = 'WAITING';
    run.currentNode = node;
    run.interrupt = { question: signal.question, payload: signal.payload, node };
  }

  async setStatus(runId: string, status: RunStatus, error?: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run topilmadi: ${runId}`);
    run.status = status;
    if (status !== 'WAITING') run.interrupt = null;
    if (error) (run as RunRecord & { error?: string }).error = error;
  }

  async idem<T>(runId: string, node: string, key: string, fn: () => Promise<T>): Promise<T> {
    const full = `${runId}:${node}:${key}`;
    if (this.idemStore.has(full)) return this.idemStore.get(full) as T;
    const out = await fn();
    this.idemStore.set(full, out);
    return out;
  }
}
