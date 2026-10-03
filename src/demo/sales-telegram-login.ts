/**
 * Sales Agent'ning Telegram USER akkauntiga BIR MARTALIK login.
 *
 * Interaktiv — albatta o'zingiz terminalda ishga tushiring:
 *   pnpm sales:login
 *
 * Telefon raqami, Telegramdan kelgan kod (va agar yoqilgan bo'lsa 2FA
 * parol) so'raladi. Muvaffaqiyatli bo'lsa, StringSession avtomatik
 * `.env`dagi SALES_TG_SESSION qatoriga yoziladi — shundan keyin qayta
 * login shart emas, kod shu session'ni o'qib ishlatadi.
 *
 * Parol/kod faqat Telegram'ning o'ziga (MTProto orqali) boradi — bizning
 * serverimiz yoki bazamizda saqlanmaydi.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { join } from 'node:path';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';

const ENV_PATH = join(__dirname, '..', '..', '.env');

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} .env'da topilmadi.`);
  return value;
}

function saveSessionToEnv(session: string): void {
  const raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const line = `SALES_TG_SESSION="${session}"`;
  const updated = /^SALES_TG_SESSION=.*$/m.test(raw)
    ? raw.replace(/^SALES_TG_SESSION=.*$/m, line)
    : `${raw.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_PATH, updated, 'utf8');
}

async function main(): Promise<void> {
  const apiId = Number(readEnv('TELEGRAM_API_ID'));
  const apiHash = readEnv('TELEGRAM_API_HASH');

  const rl = createInterface({ input: stdin, output: stdout });
  const ask = (q: string) => rl.question(q);

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => ask('Telefon raqami (+998...): '),
    phoneCode: async () => ask('Telegramdan kelgan kod: '),
    password: async () => ask("2FA parol (yo'q bo'lsa bo'sh qoldirib Enter): "),
    onError: (err) => console.error('XATO:', err.message),
  });

  rl.close();

  const session = client.session.save() as unknown as string;
  saveSessionToEnv(session);

  const me = await client.getMe();
  console.log(`\nKirildi: ${'firstName' in me ? me.firstName : ''} (@${'username' in me ? me.username : '?'})`);
  console.log('Session .env (SALES_TG_SESSION) ga saqlandi — qayta login shart emas.');

  await client.disconnect();
}

void main().catch((err) => {
  console.error('XATO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
