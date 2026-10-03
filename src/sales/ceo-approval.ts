/**
 * CEO tasdiq oqimi: uchrashuv vaqti leadga taklif qilingach, IKKI qaror
 * qabul qiluvchiga (Sardor + boshqa CEO, `CEO_CHAT_ID` ichida vergul bilan
 * ajratilgan ikki chat ID) Accept/Decline tugmali xabar yuboriladi (mavjud
 * Research bot orqali, raw Bot API — alohida bot token shart emas).
 * Ikkisidan BIRI bossa yetarli — birinchi bosilgan g'alaba qiladi, ikkinchi
 * bosilsa ("allaqachon hal qilindi") leadga qayta xabar YUBORILMAYDI.
 * Callback'ni ushlash `telegram.service.ts`da, chunki faqat o'sha process
 * shu bot tokenini long-polling qilyapti.
 */
import type { PrismaClient } from '@prisma/client';

interface TelegramApiResult {
  ok: boolean;
  description?: string;
}

async function tgApi(token: string, method: string, body: object): Promise<TelegramApiResult> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()) as TelegramApiResult;
}

/** CEOlarga uchrashuv vaqtini tasdiqlash uchun Accept/Decline tugmali xabar yuboradi. */
export async function proposeMeetingToCeo(
  prisma: PrismaClient,
  leadId: string,
  proposedTime: Date,
  opts: { botToken: string; ceoChatIds: string[] },
): Promise<void> {
  const thread = await prisma.salesThread.findUnique({ where: { leadId }, include: { lead: true } });
  if (!thread) throw new Error("Avval telegram_resolve_lead va yozishma bo'lishi kerak.");

  const timeLabel = proposedTime.toLocaleString('uz-UZ', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tashkent',
  });
  const text = `📅 Uchrashuv so'rovi\n\nMijoz: ${thread.lead.company}${thread.lead.person ? ` (${thread.lead.person})` : ''}\nTaklif qilingan vaqt: ${timeLabel}\n\nMaqulmi?`;

  for (const chatId of opts.ceoChatIds) {
    const result = await tgApi(opts.botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Qabul qilish', callback_data: `ceo_accept:${thread.id}` },
          { text: '❌ Rad etish', callback_data: `ceo_decline:${thread.id}` },
        ]],
      },
    });
    if (!result.ok) throw new Error(`Telegram xato (${chatId}): ${result.description}`);
  }

  await prisma.salesThread.update({
    where: { id: thread.id },
    data: { state: 'awaiting_ceo', proposedTime },
  });
}

/**
 * CEO tugma bosganda chaqiriladi. Ikkala CEO ham tugma bosishi mumkin bo'lgani
 * uchun `updateMany` bilan FAQAT hali "awaiting_ceo" holatidagi threadni
 * atomik ravishda "band qiladi" — poyga holatida ikkinchi bosilgan click
 * `alreadyResolved: true` qaytaradi, chaqiruvchi shu holda leadga qayta
 * xabar yubormasligi kerak.
 */
export async function resolveCeoDecision(
  prisma: PrismaClient,
  threadId: string,
  decision: 'accept' | 'decline',
): Promise<{ leadId: string; leadCompany: string; alreadyResolved: boolean }> {
  const claimed = await prisma.salesThread.updateMany({
    where: { id: threadId, state: 'awaiting_ceo' },
    data: { state: decision === 'accept' ? 'confirmed' : 'open' },
  });

  const thread = await prisma.salesThread.findUniqueOrThrow({
    where: { id: threadId },
    include: { lead: true },
  });
  return { leadId: thread.leadId, leadCompany: thread.lead.company, alreadyResolved: claimed.count === 0 };
}
