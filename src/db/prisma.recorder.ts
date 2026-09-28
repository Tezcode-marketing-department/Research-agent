import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LlmCallRecord, LlmRecorder } from '../llm/anthropic.llm';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaLlmRecorder implements LlmRecorder {
  private readonly logger = new Logger(PrismaLlmRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Kuzatuv yozuvi HECH QACHON javobni buzmasin — xato bo'lsa faqat logga tushadi.
   * `runId` bo'lmasa (suhbat rejimi) bog'lanmagan yozuv sifatida saqlanadi.
   */
  async record(entry: LlmCallRecord): Promise<void> {
    try {
      await this.prisma.llmCall.create({
      data: {
        runId: entry.runId ?? undefined,
        node: entry.node,
        model: entry.model,
        effort: entry.effort,
        purpose: entry.purpose,
        tokensIn: entry.tokensIn,
        tokensOut: entry.tokensOut,
        cacheReadIn: entry.cacheReadIn,
        cacheWriteIn: entry.cacheWriteIn,
        costUsd: new Prisma.Decimal(entry.costUsd),
        durationMs: entry.durationMs,
        stopReason: entry.stopReason ?? undefined,
        error: entry.error,
      },
      });
    } catch (err) {
      this.logger.warn(
        `LlmCall yozilmadi: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
