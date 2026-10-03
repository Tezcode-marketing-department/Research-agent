/**
 * Sales Agent'ning Telegram USER akkaunti orqali qaror qabul qiluvchilar
 * (Sardor, boshqa CEO) bilan shaxsiy yozishuvi — masalan "qaysi leadga
 * yozay?" degan savol. Bu LinkedIn/lead yozishmasidan ALOHIDA: bot-tugma
 * ishlatib bo'lmaydi (oddiy foydalanuvchi akkaunt callback_data biriktira
 * olmaydi), shuning uchun javob oddiy matn — Hermes agent o'qib talqin qiladi.
 *
 * `SALES_CEO_CONTACTS` env formati: "label:telefon,label:telefon"
 *   masalan: SALES_CEO_CONTACTS="sardor:+998901234567,ceo2:+998907654321"
 */
import type { PrismaClient } from '@prisma/client';
import { getSalesTelegramClient } from './telegram-client';

interface ParsedContact {
  label: string;
  phone: string;
}

function parseConfiguredContacts(): ParsedContact[] {
  const raw = process.env.SALES_CEO_CONTACTS ?? '';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [label, phone] = entry.split(':').map((part) => part.trim());
      if (!label || !phone) {
        throw new Error(
          `SALES_CEO_CONTACTS noto'g'ri formatda: "${entry}" (kutilgan: label:telefon)`,
        );
      }
      return { label, phone };
    });
}

/**
 * Konfiguratsiyadagi har bir kontakt uchun Telegram peer ID topadi
 * (hali topilmagan bo'lsa) va `CeoContact` jadvaliga yozadi. Idempotent —
 * allaqachon topilgan kontaktlar qayta import qilinmaydi.
 */
export async function resolveCeoContacts(prisma: PrismaClient): Promise<{ label: string; telegramPeerId: string }[]> {
  const configured = parseConfiguredContacts();
  if (!configured.length) {
    throw new Error("SALES_CEO_CONTACTS .env'da yo'q yoki bo'sh (format: label:telefon,label:telefon)");
  }

  const client = await getSalesTelegramClient();
  const resolved: { label: string; telegramPeerId: string }[] = [];

  for (const { label, phone } of configured) {
    const existing = await prisma.ceoContact.findUnique({ where: { label } });
    if (existing?.telegramPeerId) {
      resolved.push({ label, telegramPeerId: existing.telegramPeerId });
      continue;
    }

    const result = await client.importContacts([{ phone, firstName: label }]);
    const user = (result as unknown as { users?: { id: { toString(): string } }[] }).users?.[0];
    if (!user) {
      throw new Error(`"${label}" (${phone}) Telegram'da topilmadi.`);
    }
    const telegramPeerId = user.id.toString();
    await prisma.ceoContact.upsert({
      where: { label },
      create: { label, phone, telegramPeerId },
      update: { phone, telegramPeerId },
    });
    resolved.push({ label, telegramPeerId });
  }

  return resolved;
}

/**
 * Sales akkaunt orqali barcha sozlangan CEO kontaktlariga BIR XIL matnni
 * yuboradi (masalan "qaysi leadga yozay?" lettered variantlar bilan).
 * Har biriga alohida chiquvchi xabar sifatida logga yoziladi.
 */
export async function notifyCeos(prisma: PrismaClient, text: string): Promise<{ label: string }[]> {
  const contacts = await resolveCeoContacts(prisma);
  const client = await getSalesTelegramClient();
  const notified: { label: string }[] = [];

  for (const { label, telegramPeerId } of contacts) {
    const contact = await prisma.ceoContact.findUniqueOrThrow({ where: { label } });
    await client.sendMessage(telegramPeerId, { message: text });
    await prisma.ceoMessage.create({ data: { contactId: contact.id, direction: 'out', text, handledAt: new Date() } });
    notified.push({ label });
  }

  return notified;
}

export interface CeoInboxEntry {
  label: string;
  direction: 'in' | 'out';
  text: string;
  at: Date;
}

/**
 * So'nggi yozishmani (hamma kontaktlar bo'ylab, vaqt bo'yicha aralash)
 * qaytaradi — Hermes agent shundan CEO javobini (masalan "B") o'qiydi.
 */
export async function ceoInbox(prisma: PrismaClient, limit = 20): Promise<CeoInboxEntry[]> {
  const rows = await prisma.ceoMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { contact: { select: { label: true } } },
  });
  return rows
    .map((row) => ({
      label: row.contact.label,
      direction: row.direction as 'in' | 'out',
      text: row.text,
      at: row.createdAt,
    }))
    .reverse();
}
