import { PrismaClient } from '@prisma/client';
import { getSalesTelegramClient, disconnectSalesTelegramClient } from '../sales/telegram-client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const contact = await prisma.ceoContact.findUnique({ where: { label: 'sardor' } });
  if (!contact?.telegramPeerId) throw new Error('sardor contact not resolved yet');

  const client = await getSalesTelegramClient();
  const messages = await client.getMessages(contact.telegramPeerId, { limit: 10 });
  const sorted = [...messages].reverse();
  for (const m of sorted) {
    const when = m.date ? new Date(m.date * 1000).toISOString() : '?';
    console.log(`[${when}] out=${m.out} : ${m.message}`);
  }
  await disconnectSalesTelegramClient();
  await prisma.$disconnect();
}

void main().catch((err) => {
  console.error('ERR', err);
  process.exit(1);
});
