import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AfterStepInput,
  Checkpointer,
  CreateRunInput,
  RunRecord,
} from '../engine/checkpointer';
import { InterruptSignal, RunStatus } from '../engine/types';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaCheckpointer implements Checkpointer {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateRunInput): Promise<RunRecord> {
    const run = await this.prisma.run.create({
      data: {
        graph: input.graph,
        state: input.state as Prisma.InputJsonValue,
        tenantId: input.tenantId ?? 'sardor',
        threadKey: input.threadKey,
      },
    });
    return toRecord(run);
  }

  async load(runId: string): Promise<RunRecord | null> {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    return run ? toRecord(run) : null;
  }

  /**
   * Checkpoint va step logi bitta tranzaksiyada — yarim yozilgan holat bo'lmasin.
   * Qayta urinishda o'sha seq kelsa, `upsert` takror yozmaydi.
   */
  async afterStep(input: AfterStepInput): Promise<void> {
    const state = input.state as Prisma.InputJsonValue;
    await this.prisma.$transaction([
      this.prisma.checkpoint.upsert({
        where: { runId_seq: { runId: input.runId, seq: input.seq } },
        create: { runId: input.runId, seq: input.seq, node: input.node, state },
        update: { node: input.node, state },
      }),
      this.prisma.step.upsert({
        where: { runId_seq: { runId: input.runId, seq: input.seq } },
        create: {
          runId: input.runId,
          seq: input.seq,
          node: input.node,
          status: input.status,
          durationMs: input.durationMs,
          tokensIn: input.usage.tokensIn,
          tokensOut: input.usage.tokensOut,
          costUsd: new Prisma.Decimal(input.usage.costUsd),
          error: input.error,
        },
        update: { status: input.status, error: input.error },
      }),
      this.prisma.run.update({
        where: { id: input.runId },
        data: {
          state,
          currentNode: input.node,
          steps: input.seq,
          tokensIn: { increment: input.usage.tokensIn },
          tokensOut: { increment: input.usage.tokensOut },
          costUsd: { increment: new Prisma.Decimal(input.usage.costUsd) },
        },
      }),
    ]);
  }

  async setWaiting(runId: string, node: string, signal: InterruptSignal): Promise<void> {
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: 'WAITING',
        currentNode: node,
        interrupt: {
          question: signal.question,
          payload: signal.payload ?? null,
          node,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async setStatus(runId: string, status: RunStatus, error?: string): Promise<void> {
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status,
        error,
        ...(status === 'WAITING' ? {} : { interrupt: Prisma.DbNull }),
      },
    });
  }

  async idem<T>(runId: string, node: string, key: string, fn: () => Promise<T>): Promise<T> {
    const idempotencyKey = `${runId}:${node}:${key}`;
    const existing = await this.prisma.toolCall.findUnique({ where: { idempotencyKey } });
    if (existing && existing.error === null) {
      return existing.output as T;
    }

    const startedAt = Date.now();
    try {
      const output = await fn();
      await this.prisma.toolCall.upsert({
        where: { idempotencyKey },
        create: {
          runId,
          node,
          tool: key,
          idempotencyKey,
          input: {} as Prisma.InputJsonValue,
          output: (output ?? null) as Prisma.InputJsonValue,
          durationMs: Date.now() - startedAt,
        },
        update: {
          output: (output ?? null) as Prisma.InputJsonValue,
          error: null,
          durationMs: Date.now() - startedAt,
        },
      });
      return output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.toolCall.upsert({
        where: { idempotencyKey },
        create: {
          runId,
          node,
          tool: key,
          idempotencyKey,
          input: {} as Prisma.InputJsonValue,
          error: message,
          durationMs: Date.now() - startedAt,
        },
        update: { error: message, durationMs: Date.now() - startedAt },
      });
      throw err;
    }
  }
}

function toRecord(run: {
  id: string;
  graph: string;
  status: string;
  currentNode: string | null;
  state: unknown;
  interrupt: unknown;
  steps: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: Prisma.Decimal;
  threadKey: string | null;
}): RunRecord {
  return {
    id: run.id,
    graph: run.graph,
    status: run.status as RunStatus,
    currentNode: run.currentNode,
    state: run.state,
    interrupt: (run.interrupt as RunRecord['interrupt']) ?? null,
    steps: run.steps,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd.toNumber(),
    threadKey: run.threadKey,
  };
}
