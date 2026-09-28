import { InterruptSignal, RunStatus, TokenUsage } from './types';

export interface RunRecord {
  id: string;
  graph: string;
  status: RunStatus;
  currentNode: string | null;
  state: unknown;
  interrupt: { question: string; payload?: unknown; node: string } | null;
  steps: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  threadKey?: string | null;
}

export interface CreateRunInput {
  graph: string;
  state: unknown;
  tenantId?: string;
  threadKey?: string;
}

export interface AfterStepInput {
  runId: string;
  seq: number;
  node: string;
  status: 'ok' | 'interrupt' | 'error';
  state: unknown;
  durationMs: number;
  usage: TokenUsage;
  error?: string;
}

/**
 * Holatni saqlovchi. Ikki amalga oshirish bor:
 * Prisma (haqiqiy ish) va xotira (test/demo, DB'siz).
 */
export interface Checkpointer {
  create(input: CreateRunInput): Promise<RunRecord>;
  load(runId: string): Promise<RunRecord | null>;
  /** Har tugundan KEYIN chaqiriladi — checkpoint + step logi bitta joyda. */
  afterStep(input: AfterStepInput): Promise<void>;
  setWaiting(runId: string, node: string, signal: InterruptSignal): Promise<void>;
  setStatus(runId: string, status: RunStatus, error?: string): Promise<void>;
  /** Nojo'ya ta'sirni bir martaga kafolatlaydi. */
  idem<T>(runId: string, node: string, key: string, fn: () => Promise<T>): Promise<T>;
}
