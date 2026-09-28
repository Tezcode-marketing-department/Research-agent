import { Inject, Injectable } from '@nestjs/common';
import { AgentKey, AgentRegistry } from '../agents/agent.registry';
import { PERSONAS } from '../agents/personas';
import { PrismaService } from '../db/prisma.service';
import { LLM_FACTORY } from '../engine/engine.module';
import { LlmFactory } from '../engine/runner';

const HISTORY_LIMIT = 12;

/**
 * Suhbat rejimi — vazifa oqimi (graph) emas.
 * Sardor shunchaki yozganda agent odam kabi javob beradi.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AgentRegistry,
    @Inject(LLM_FACTORY) private readonly llmFactory: LlmFactory,
  ) {}

  async reply(agent: AgentKey, chatId: number | string, text: string): Promise<string> {
    const chat = String(chatId);
    const history = await this.prisma.chatTurn.findMany({
      where: { agent, chatId: chat },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    history.reverse();

    const transcript = history
      .map((turn) => `${turn.role === 'user' ? 'Sardor' : this.registry.get(agent).title}: ${turn.text}`)
      .join('\n');

    const prompt = transcript
      ? `Suhbat tarixi:\n${transcript}\n\nSardor: ${text}\n\nJavob ber.`
      : `Sardor: ${text}\n\nJavob ber.`;

    // Suhbat — graph run emas, shuning uchun runId yo'q.
    const { llm } = this.llmFactory.forStep(null, `chat:${agent}`);
    const answer = await llm.text(prompt, {
      system: PERSONAS[agent],
      purpose: 'chat',
    });

    await this.prisma.chatTurn.createMany({
      data: [
        { agent, chatId: chat, role: 'user', text },
        { agent, chatId: chat, role: 'assistant', text: answer },
      ],
    });

    return answer || '(bo\'sh javob)';
  }

  async clear(agent: AgentKey, chatId: number | string): Promise<number> {
    const { count } = await this.prisma.chatTurn.deleteMany({
      where: { agent, chatId: String(chatId) },
    });
    return count;
  }
}
