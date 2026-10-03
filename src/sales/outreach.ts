/**
 * Sales Agent'ning Telegram USER akkaunti orqali lead bilan yozishuvi.
 * Past darajadagi I/O shu yerda; "nima yozish kerak" (suhbat mantig'i)
 * Hermes Sales profilida (SOUL.md + skills) qoladi — bu yerda faqat
 * yuborish/o'qish/kuzatish bor.
 */
import type { CeoContact, PrismaClient, SalesThread } from '@prisma/client';
import type { TelegramClient } from 'teleproto';
import { NewMessage, type NewMessageEvent } from 'teleproto/events';
import { askSalesAgent } from './hermes-bridge';
import { getSalesTelegramClient } from './telegram-client';

/** Prisma unique-constraint xatosi (P2002) — reconcile.ts bilan live handler bir xil
 * xabarni ikki marta ishlashga urinsa ham, faqat biri yutadi, ikkinchisi shu holatga tushadi. */
function isDuplicateError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

type LeadThread = SalesThread & { lead: { id: string; company: string } };

/**
 * "Claim" muddati: shuncha vaqtdan ko'proq `claimedAt`si bor-u, `handledAt`i
 * hali null bo'lgan xabar — avvalgi urinish YIQILGAN deb hisoblanadi (oddiy
 * Hermes chaqiruvi 1-3 daqiqa davom etadi, shuning uchun bu chegaradan katta
 * zaxira beriladi). 2026-10-03 da kutilmagan process restart aynan shu
 * holatni keltirib chiqargan — claim qilingan, lekin hech qachon
 * yakunlanmagan xabar HAR DOIM "band" deb qolib ketgan edi.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

/** Claim shartini qaytaradi: hali claim qilinmagan YOKI claim muddati o'tib ketgan. */
function claimableWhere(messageId: string) {
  return {
    id: messageId,
    handledAt: null,
    OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(Date.now() - CLAIM_LEASE_MS) } }],
  };
}

/**
 * Hermes chaqiruvini bajaradi va javobni Sardorga yuboradi.
 *
 * ATOMIK "CLAIM": `claimedAt` orqali — "men bu xabarni olib, ishlamoqdaman"
 * degan belgi, `handledAt`dan ALOHIDA (u faqat MUVAFFAQIYATLI yakunlanganda
 * to'ldiriladi). Claim muvaffaqiyatsiz bo'lsa (boshqa chaqiruv band qilgan
 * va muddati hali o'tmagan) — darhol chiqib ketadi. Shu ajratish bo'lmaganda
 * 2026-10-03 da ikki marta muammo chiqqan edi: (1) reconcile.ts hali
 * tugamagan live-handler chaqiruvini "stuck" deb o'ylab qayta chaqirgan va
 * bitta real leadga ikkita deyarli bir xil xabar ketgan; (2) keyin claim va
 * handled bitta maydon bo'lgani uchun, process claim qilgandan keyin lekin
 * ishni tugatishdan OLDIN qulab tushsa, xabar "band" deb abadiy qolib
 * ketgan (javob umuman yuborilmagan holda).
 */
export async function triggerCeoResponse(
  prisma: PrismaClient,
  client: TelegramClient,
  contact: CeoContact,
  messageId: string,
  text: string,
): Promise<void> {
  const claimed = await prisma.ceoMessage.updateMany({
    where: claimableWhere(messageId),
    data: { claimedAt: new Date() },
  });
  if (claimed.count === 0) return;

  if (contact.label !== 'sardor') {
    await prisma.ceoMessage.update({ where: { id: messageId }, data: { handledAt: new Date() } });
    return;
  }
  try {
    const reply = await askSalesAgent(text);
    if (reply) {
      await client.sendMessage(contact.telegramPeerId!, { message: reply });
      await prisma.ceoMessage.create({
        data: { contactId: contact.id, direction: 'out', text: reply, handledAt: new Date() },
      });
    }
    await prisma.ceoMessage.update({ where: { id: messageId }, data: { handledAt: new Date() } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sales] Hermes javobi olinmadi: ${msg}`);
    // handledAt QASDDAN null qoladi — lease muddati o'tgach qayta uriniladi.
  }
}

/**
 * Kiruvchi CEO xabarini saqlaydi (allaqachon saqlangan bo'lsa jim o'tkazadi)
 * va Sardor bo'lsa Hermes bridge'ini FON vazifasi sifatida ishga tushiradi —
 * chaqiruvchi (live handler) buni kutib turmaydi. MUHIM: chaqiruvchini
 * bloklamaymiz — Hermes chaqiruvi 1-3 daqiqa davom etishi mumkin, shuni
 * kutib tursak Telegram kutubxonasining yangilanish navbati o'sha vaqt
 * bloklanib qolishi va shu oraliqda kelgan KEYINGI xabar yo'qolib ketishi
 * mumkin (2026-10-03 da aynan shunday lead va CEO xabarlari yo'qolgan edi).
 */
export async function processCeoIncoming(
  prisma: PrismaClient,
  client: TelegramClient,
  contact: CeoContact,
  text: string,
  telegramMsgId?: number,
): Promise<void> {
  let messageId: string;
  try {
    const row = await prisma.ceoMessage.create({
      data: { contactId: contact.id, direction: 'in', text, telegramMsgId },
    });
    messageId = row.id;
  } catch (err) {
    if (isDuplicateError(err)) return; // boshqa yo'l bilan allaqachon qayd qilingan
    throw err;
  }
  void triggerCeoResponse(prisma, client, contact, messageId, text);
}

/**
 * Hermes Sales Agentni chaqiradi — u o'zi `telegram_send` bilan javob
 * yozadi, shuning uchun bu yerda leadga qayta yuborilmaydi. Atomik "claim"
 * (`triggerCeoResponse`dagi bilan bir xil sabab — 2026-10-03 da bitta real
 * leadga xuddi shu race tufayli ikkita deyarli bir xil xabar ketgan edi).
 */
export async function triggerLeadResponse(
  prisma: PrismaClient,
  thread: LeadThread,
  messageId: string,
  text: string,
): Promise<void> {
  const claimed = await prisma.salesMessage.updateMany({
    where: claimableWhere(messageId),
    data: { claimedAt: new Date() },
  });
  if (claimed.count === 0) return;

  try {
    const report = await askSalesAgent(leadReplyPrompt(thread.lead.id, thread.lead.company, text));
    console.log(`[sales] ${thread.lead.company} javobi qayta ishlandi: ${report.slice(0, 300)}`);
    await prisma.salesMessage.update({ where: { id: messageId }, data: { handledAt: new Date() } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sales] ${thread.lead.company} javobini qayta ishlashda xato: ${msg}`);
    // handledAt QASDDAN null qoladi — lease muddati o'tgach qayta uriniladi.
  }
}

/**
 * Kiruvchi lead xabarini saqlaydi (allaqachon saqlangan bo'lsa jim o'tkazadi)
 * va Hermes Sales Agentni FON vazifasi sifatida ishga tushiradi.
 */
export async function processLeadIncoming(
  prisma: PrismaClient,
  thread: LeadThread,
  text: string,
  telegramMsgId?: number,
): Promise<void> {
  let messageId: string;
  try {
    const [row] = await prisma.$transaction([
      prisma.salesMessage.create({
        data: { threadId: thread.id, direction: 'in', text, telegramMsgId },
      }),
      prisma.salesThread.update({
        where: { id: thread.id },
        data: { exchangeCount: { increment: 1 }, state: 'open' },
      }),
    ]);
    messageId = row.id;
  } catch (err) {
    if (isDuplicateError(err)) return;
    throw err;
  }
  void triggerLeadResponse(prisma, thread, messageId, text);
}

/** Hermes Sales Agentga: qaysi lead, nima yozdi — qolganini o'zi (tool orqali) topadi. */
function leadReplyPrompt(leadId: string, company: string, text: string): string {
  return (
    `Lead "${company}" (leadId: ${leadId}) Telegram orqali yangi xabar yozdi: "${text}"\n\n` +
    `telegram_thread(leadId) bilan to'liq suhbat tarixini, lead_get(leadId) bilan dossierni o'qi. ` +
    `skills/sales/lead-outreach bo'yicha mos keladigan javobni ANIQLA va kerak bo'lsa darhol ` +
    `telegram_send(leadId, text) bilan O'ZING yubor — bitta aniq fikr yoki savol, qisqa, gigant matn yo'q. ` +
    `Agar hali javob berish vaqti bo'lmasa yoki noaniq holat (masalan e'tiroz, narx so'ragan, uchrashuv ` +
    `taklif qilgan) bo'lsa va Sardor fikri kerak bo'lsa, leadga o'zing hal qilmasdan ` +
    `sales_notify_ceo bilan undan so'ra.`
  );
}

/**
 * Lead'ning telefon raqamidan Telegram foydalanuvchisini topadi (kontakt
 * sifatida import qilib). Topilmasa (raqam Telegramda yo'q) xato qaytaradi —
 * bu holda kanal Telegram emas, boshqa narsa (sayt, Instagram) bo'lishi kerak.
 */
export async function resolveLeadPeer(
  prisma: PrismaClient,
  leadId: string,
  phone: string,
  displayName: string,
): Promise<string> {
  const client = await getSalesTelegramClient();
  const result = await client.importContacts([
    { phone, firstName: displayName || 'Lead' },
  ]);
  const user = (result as unknown as { users?: { id: { toString(): string } }[] }).users?.[0];
  if (!user) {
    throw new Error(`"${phone}" raqami Telegram'da topilmadi.`);
  }
  const telegramPeerId = user.id.toString();

  await prisma.salesThread.upsert({
    where: { leadId },
    create: { leadId, telegramPeerId },
    update: { telegramPeerId },
  });

  return telegramPeerId;
}

/** Lead'ga xabar yuboradi (avval `resolveLeadPeer` bilan topilgan bo'lishi shart) va logga yozadi. */
export async function sendToLead(prisma: PrismaClient, leadId: string, text: string): Promise<void> {
  const thread = await prisma.salesThread.findUnique({ where: { leadId } });
  if (!thread?.telegramPeerId) {
    throw new Error("Avval resolveLeadPeer bilan Telegram foydalanuvchisi topilishi kerak.");
  }
  const client = await getSalesTelegramClient();
  await client.sendMessage(thread.telegramPeerId, { message: text });
  await prisma.$transaction([
    prisma.salesMessage.create({ data: { threadId: thread.id, direction: 'out', text, handledAt: new Date() } }),
    prisma.salesThread.update({ where: { id: thread.id }, data: { exchangeCount: { increment: 1 } } }),
  ]);
}

/** Shu lead uchun yozishma tarixini (eng eskisidan yangisiga) qaytaradi. */
export async function getThreadHistory(prisma: PrismaClient, leadId: string) {
  const thread = await prisma.salesThread.findUnique({
    where: { leadId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  return thread;
}

/**
 * Kelayotgan xabarlarni doimiy tinglaydi:
 *  - Sardor yozsa (`CeoContact.label === 'sardor'`) — xuddi haqiqiy AI
 *    chatdek: xabar to'liq Hermes Sales Agentga (`hermes-bridge.ts`) uzatiladi
 *    va javobi darhol shu akkauntdan Sardorga qaytariladi.
 *  - Boshqa CeoContact (masalan ikkinchi CEO) yozsa — CeoMessage'ga faqat
 *    yozib qo'yiladi, avtomatik javob YO'Q (Hermes keyingi pollingida ko'radi).
 *  - Faol SalesThread'i bor lead yozsa (savol kutilayotgan holat) —
 *    SalesMessage'ga yoziladi VA Hermes Sales Agent avtomatik ishga tushadi:
 *    u o'zi `telegram_thread`/`lead_get` bilan to'liq tarixni o'qiydi va
 *    kerak bo'lsa `telegram_send` bilan O'ZI javob yozadi (yoki hali vaqt
 *    kelmagan bo'lsa `sales_notify_ceo` bilan Sardordan so'raydi) — hech kim
 *    "javob keldimi" deb qo'lda tekshirishi shart emas.
 *  - Boshqa har qanday notanish yuboruvchi — yoza oladi (bloklanmaydi), lekin
 *    hech qayerga yozilmaydi va AI javob berishi shart emas.
 */
export async function startSalesListener(prisma: PrismaClient): Promise<void> {
  const client = await getSalesTelegramClient();
  client.addEventHandler(async (event: NewMessageEvent) => {
    const message = event.message;
    if (message.out) return; // o'zimiz yuborganimiz
    const senderId = message.senderId?.toString();
    if (!senderId) return;
    const text = message.text ?? '';

    const ceoContact = await prisma.ceoContact.findFirst({ where: { telegramPeerId: senderId } });
    if (ceoContact) {
      await processCeoIncoming(prisma, client, ceoContact, text, message.id);
      return;
    }

    const thread = await prisma.salesThread.findFirst({
      where: { telegramPeerId: senderId },
      include: { lead: { select: { id: true, company: true } } },
    });
    if (!thread) return;

    await processLeadIncoming(prisma, thread, text, message.id);
  }, new NewMessage({}));
}
