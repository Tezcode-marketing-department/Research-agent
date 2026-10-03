import { getSalesTelegramClient, disconnectSalesTelegramClient } from '../sales/telegram-client';

async function main(): Promise<void> {
  const client = await getSalesTelegramClient();
  const messages = await client.getMessages('5154184047', { limit: 10 });
  const sorted = [...messages].reverse();
  for (const m of sorted) {
    const when = m.date ? new Date(m.date * 1000).toISOString() : '?';
    console.log(`[${when}] out=${m.out} : ${m.message}`);
  }
  await disconnectSalesTelegramClient();
}

void main().catch((err) => {
  console.error('ERR', err);
  process.exit(1);
});
