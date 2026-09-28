/**
 * Telegram oqimini DB bilan sinaydi (Telegram'siz): ConversationService'ni
 * to'g'ridan-to'g'ri chaqiradi. Tekshiriladigan narsa —
 * start → WAITING → tuzatish → WAITING → tasdiq → DONE va Outcome yorliqlari.
 */
import 'reflect-metadata';
import { AgentRegistry } from '../agents/agent.registry';
import { PrismaService } from '../db/prisma.service';
import { PrismaCheckpointer } from '../db/prisma.checkpointer';
import { GraphRunner } from '../engine/runner';
import { ConversationService } from '../telegram/conversation.service';
import { StubLlm } from './stub.llm';

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();

  const runner = new GraphRunner(new PrismaCheckpointer(prisma), new StubLlm());
  const conversation = new ConversationService(prisma, runner, new AgentRegistry());
  const chatId = 999_000_111; // sinov chati

  const say = async (text: string): Promise<void> => {
    const reply = await conversation.handleMessage('sales', chatId, text);
    console.log(`\n> ${text}\n${reply ? reply.text : '(kutayotgan vazifa yo\'q — suhbat rejimi)'}`);
  };

  const task = await conversation.startTask('sales', chatId, 'Bomond qurilish kompaniyasiga birinchi xabar');
  console.log(`\n> /vazifa Bomond qurilish kompaniyasiga birinchi xabar\n${task.text}`);
  await say('birinchi gap quruq, iliqroq qil');
  await say('ha');

  console.log('\n--- DB holati ---');
  const runs = await prisma.run.findMany({
    where: { threadKey: `sales:${chatId}` },
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: { stepLogs: { orderBy: { seq: 'asc' } } },
  });
  const run = runs[0];
  if (!run) throw new Error('run topilmadi');
  console.log(`run=${run.id.slice(0, 8)} status=${run.status} qadam=${run.steps}`);
  console.log('qadamlar: ' + run.stepLogs.map((s) => `${s.seq}.${s.node}/${s.status}`).join(' → '));

  const labels = await prisma.outcome.findMany({
    where: { subjectId: run.id },
    orderBy: { createdAt: 'asc' },
  });
  console.log('ML yorliqlari: ' + (labels.map((l) => l.label).join(', ') || 'yo\'q'));

  const checkpoints = await prisma.checkpoint.count({ where: { runId: run.id } });
  console.log(`checkpointlar: ${checkpoints}`);

  await prisma.$disconnect();
}

void main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
