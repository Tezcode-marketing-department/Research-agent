/** Sales akkaunt orqali CEO kontaktlarga haqiqiy test xabari yuboradi va javobni o'qiydi. */
import 'reflect-metadata';
import { PrismaService } from '../db/prisma.service';
import { ceoInbox, notifyCeos } from '../sales/ceo-contacts';
import { disconnectSalesTelegramClient } from '../sales/telegram-client';

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();

  const notified = await notifyCeos(prisma, 'Test: Sales akkaunt orqali CEO kontakt tizimi ishlayaptimi — tekshiruv xabari.');
  console.log(`Yuborildi: ${notified.map((n) => n.label).join(', ')}`);

  const inbox = await ceoInbox(prisma, 10);
  console.log('\nSo\'nggi yozishma:');
  for (const entry of inbox) {
    console.log(`  [${entry.label}] ${entry.direction} — ${entry.text}`);
  }

  await disconnectSalesTelegramClient();
  await prisma.$disconnect();
}

void main().catch(async (err) => {
  console.error('XATO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
