/** Chat rejimini DB bilan uchdan-uchiga sinaydi (Telegram'siz). */
import 'reflect-metadata';
import { AgentRegistry } from '../agents/agent.registry';
import { PrismaService } from '../db/prisma.service';
import { PrismaLlmRecorder } from '../db/prisma.recorder';
import { ChatService } from '../telegram/chat.service';
import { HermesLlm, loadHermesConfig } from '../llm/hermes.llm';

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  const llm = new HermesLlm(loadHermesConfig(), new PrismaLlmRecorder(prisma));
  const chat = new ChatService(prisma, new AgentRegistry(prisma), llm);
  const chatId = 999000222;

  for (const text of ['salom', 'sen nima bo\'yicha ishlaydigan agentsan?']) {
    const answer = await chat.reply('sales', chatId, text);
    console.log(`\n> ${text}\n${answer}`);
  }

  const calls = await prisma.llmCall.count({ where: { node: 'chat:sales' } });
  const turns = await prisma.chatTurn.count({ where: { chatId: String(chatId) } });
  console.log(`\nLlmCall yozuvlari: ${calls} | suhbat qatorlari: ${turns}`);
  await prisma.$disconnect();
}

void main().catch((err) => {
  console.error('XATO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
