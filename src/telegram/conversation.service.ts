import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentKey, AgentRegistry } from '../agents/agent.registry';
import { PrismaService } from '../db/prisma.service';
import { GraphRunner, RunOutcome } from '../engine/runner';

export interface ReplyPayload {
  text: string;
  /** WAITING bo'lsa — javob kutilyapti. */
  waiting: boolean;
}

/**
 * Telegram xabari ↔ graph run.
 *
 * Qoida: bitta suhbatda (bot + chat) bir vaqtda BITTA kutayotgan run bo'ladi.
 * Shunda "ha" nimaga tegishli ekani doim aniq — inline tugma kerak emas.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: GraphRunner,
    private readonly registry: AgentRegistry,
  ) {}

  private threadKey(agent: AgentKey, chatId: number | string): string {
    return `${agent}:${chatId}`;
  }

  /**
   * Kutayotgan vazifa bo'lsa — javob o'shanga tegishli.
   * Bo'lmasa `null` qaytadi va xabar suhbat rejimiga o'tadi.
   */
  async handleMessage(
    agent: AgentKey,
    chatId: number | string,
    text: string,
  ): Promise<ReplyPayload | null> {
    const threadKey = this.threadKey(agent, chatId);
    const waiting = await this.prisma.run.findFirst({
      where: { threadKey, status: 'WAITING' },
      orderBy: { updatedAt: 'desc' },
    });

    if (waiting) {
      // Javob kutilayotgan run bor — matn o'sha runga tegishli.
      const graph = this.registry.graphByName(waiting.graph);
      const outcome = await this.runner.resume(graph, waiting.id, text);
      await this.recordApprovalLabel(waiting.id, text);
      return this.format(outcome);
    }

    // Kutayotgan vazifa yo'q — bu oddiy suhbat, graph ishga tushmaydi.
    return null;
  }

  /** Vazifa oqimini ataylab boshlaydi (/vazifa). */
  async startTask(
    agent: AgentKey,
    chatId: number | string,
    text: string,
  ): Promise<ReplyPayload> {
    const def = this.registry.get(agent);
    const outcome = await this.runner.start(def.graph, def.initialState(text), {
      threadKey: this.threadKey(agent, chatId),
    });
    return this.format(outcome);
  }

  /** Kutayotgan runni bekor qiladi (/bekor). */
  async cancel(agent: AgentKey, chatId: number | string): Promise<string> {
    const threadKey = this.threadKey(agent, chatId);
    const waiting = await this.prisma.run.findFirst({
      where: { threadKey, status: 'WAITING' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!waiting) return 'Kutayotgan ish yo\'q.';
    await this.prisma.run.update({
      where: { id: waiting.id },
      data: { status: 'ABORTED', interrupt: Prisma.DbNull, error: 'sardor bekor qildi' },
    });
    return 'Bekor qilindi.';
  }

  async status(agent: AgentKey, chatId: number | string): Promise<string> {
    const threadKey = this.threadKey(agent, chatId);
    const [waiting, last24hCost] = await Promise.all([
      this.prisma.run.findFirst({
        where: { threadKey, status: 'WAITING' },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.run.aggregate({
        where: { threadKey, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
        _sum: { costUsd: true, tokensIn: true, tokensOut: true },
        _count: true,
      }),
    ]);

    const lines = [
      waiting
        ? `Kutilmoqda: ${waiting.graph} / ${waiting.currentNode} (${waiting.steps} qadam)`
        : 'Kutayotgan ish yo\'q.',
      `Oxirgi 24 soat: ${last24hCost._count} run, ` +
        `${last24hCost._sum.tokensIn ?? 0}/${last24hCost._sum.tokensOut ?? 0} token, ` +
        `$${Number(last24hCost._sum.costUsd ?? 0).toFixed(4)}`,
    ];
    return lines.join('\n');
  }

  /**
   * Har tasdiq — ML uchun yorliq. Model keyin shu jadvaldan o'qitiladi.
   * Bugun yig'ilmasa, ertaga o'qitadigan narsa bo'lmaydi.
   */
  private async recordApprovalLabel(runId: string, answer: string): Promise<void> {
    const { parseIntent } = await import('../agents/placeholder.graph');
    const intent = parseIntent(answer);
    const label = intent === 'approve' ? 'approved' : intent === 'reject' ? 'rejected' : 'edited';
    try {
      await this.prisma.outcome.create({
        data: { subjectType: 'run', subjectId: runId, label, source: 'sardor', note: answer.slice(0, 500) },
      });
    } catch (err) {
      this.logger.warn(`yorliq yozilmadi: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private format(outcome: RunOutcome<object>): ReplyPayload {
    switch (outcome.status) {
      case 'WAITING':
        return { text: outcome.interrupt?.question ?? 'Javob kutilmoqda.', waiting: true };
      case 'DONE':
        return { text: 'Tayyor.', waiting: false };
      case 'ABORTED':
        return { text: `To'xtatildi: ${outcome.error}`, waiting: false };
      case 'FAILED':
        return { text: `Xato: ${outcome.error}`, waiting: false };
      default:
        return { text: `Holat: ${outcome.status}`, waiting: false };
    }
  }
}
