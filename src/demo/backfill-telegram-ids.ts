/**
 * Bir martalik tuzatish: manual backfill paytida (2026-10-03) telegramMsgId
 * yozilmagan eski SalesMessage/CeoMessage qatorlarini tuzatadi:
 *  1. Agar reconcile.ts allaqachon o'sha xabarni (bir xil matn+yo'nalish)
 *     haqiqiy telegramMsgId bilan qayta yozgan bo'lsa — eski null qator
 *     O'CHIRILADI (dublikat).
 *  2. Qolgan null qatorlar haqiqiy Telegram tarixi bilan xronologik
 *     moslashtirilib to'ldiriladi.
 */
import { PrismaClient } from '@prisma/client';
import { getSalesTelegramClient, disconnectSalesTelegramClient } from '../sales/telegram-client';

async function backfillPeer(
  prisma: PrismaClient,
  client: Awaited<ReturnType<typeof getSalesTelegramClient>>,
  peerId: string,
  table: 'salesMessage' | 'ceoMessage',
  idField: 'threadId' | 'contactId',
  idValue: string,
) {
  const model = (prisma as unknown as Record<string, any>)[table];

  // 1-bosqich: dublikatlarni o'chirish.
  const nullRows: { id: string; text: string; direction: string }[] = await model.findMany({
    where: { [idField]: idValue, telegramMsgId: null },
    orderBy: { createdAt: 'asc' },
  });
  for (const row of nullRows) {
    const dup = await model.findFirst({
      where: { [idField]: idValue, text: row.text, direction: row.direction, telegramMsgId: { not: null } },
    });
    if (dup) {
      await model.delete({ where: { id: row.id } });
      console.log(`  deleted duplicate null row (real copy exists, telegramMsgId=${dup.telegramMsgId}): "${row.text.slice(0, 60)}"`);
    }
  }

  // 2-bosqich: qolgan null qatorlarni haqiqiy tarix bilan moslashtirish.
  const remaining: { id: string; text: string; direction: string }[] = await model.findMany({
    where: { [idField]: idValue, telegramMsgId: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!remaining.length) return;

  const live = await client.getMessages(peerId, { limit: 50 });
  const liveSorted = [...live].sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
  let liveIdx = 0;
  for (const row of remaining) {
    const wantOut = row.direction === 'out';
    while (
      liveIdx < liveSorted.length &&
      !(liveSorted[liveIdx].message === row.text && Boolean(liveSorted[liveIdx].out) === wantOut)
    ) {
      liveIdx += 1;
    }
    if (liveIdx >= liveSorted.length) {
      console.log(`  no live match for: ${row.direction} "${row.text.slice(0, 60)}"`);
      continue;
    }
    const msgId = liveSorted[liveIdx].id;
    try {
      await model.update({ where: { id: row.id }, data: { telegramMsgId: msgId } });
      console.log(`  backfilled ${row.direction} -> telegramMsgId=${msgId}: "${row.text.slice(0, 60)}"`);
    } catch (err) {
      console.log(`  skip (still colliding): "${row.text.slice(0, 60)}" ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    }
    liveIdx += 1;
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const client = await getSalesTelegramClient();

  const contacts = await prisma.ceoContact.findMany({ where: { telegramPeerId: { not: null } } });
  for (const c of contacts) {
    console.log(`CeoContact: ${c.label}`);
    await backfillPeer(prisma, client, c.telegramPeerId!, 'ceoMessage', 'contactId', c.id);
  }

  const threads = await prisma.salesThread.findMany({
    where: { telegramPeerId: { not: null } },
    include: { lead: { select: { company: true } } },
  });
  for (const t of threads) {
    console.log(`SalesThread: ${t.lead.company}`);
    await backfillPeer(prisma, client, t.telegramPeerId!, 'salesMessage', 'threadId', t.id);
  }

  await disconnectSalesTelegramClient();
  await prisma.$disconnect();
}

void main().catch((err) => {
  console.error('ERR', err);
  process.exit(1);
});
