/**
 * Sales Agent — Telegram USER akkaunti (bot emas, MTProto/teleproto).
 *
 * Bot API'dan farqli: user akkaunt odamga BIRINCHI bo'lib yoza oladi (bot
 * buni qila olmaydi — foydalanuvchi avval botga yozishi shart). Shu sabab
 * Sales outreach uchun maxsus ishlatiladi, Research esa oddiy bot bo'lib
 * qoladi (@tezcode_research_bot).
 *
 * Login bir martalik: `pnpm sales:login` (interaktiv, telefon kodi kerak).
 * Natijada olingan StringSession .env'dagi SALES_TG_SESSION'ga yoziladi —
 * shundan keyin bu modul HECH QANDAY interaktivlik so'ramaydi.
 */
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';

let client: TelegramClient | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} topilmadi. Avval \`pnpm sales:login\` bilan Telegram akkauntga kiring.`,
    );
  }
  return value;
}

/** Ulangan, tayyor TelegramClient qaytaradi — birinchi chaqiruvda ulanadi, keyingilarida qayta ishlatadi. */
export async function getSalesTelegramClient(): Promise<TelegramClient> {
  if (client?.connected) return client;

  const apiId = Number(requiredEnv('TELEGRAM_API_ID'));
  const apiHash = requiredEnv('TELEGRAM_API_HASH');
  const session = requiredEnv('SALES_TG_SESSION');

  client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  return client;
}

export async function disconnectSalesTelegramClient(): Promise<void> {
  if (client) {
    await client.disconnect();
    client = null;
  }
}
