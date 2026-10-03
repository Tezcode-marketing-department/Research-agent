/**
 * Xavfsizlik to'ri: live event handler (`outreach.ts`dagi `addEventHandler`)
 * ba'zan xabarni qochirib yuborishi mumkin (masalan ulanish qayta tiklanish
 * paytida, teleproto ichki "catchUp" mexanizmi tufayli — 2026-10-03 da real
 * holatda kuzatilgan). Shu sabab bu modul DAVRIY ravishda har aloqa (CEO
 * kontakt, faol lead thread) uchun Telegramdan HAQIQIY so'nggi xabarlarni
 * o'qiydi va bazada yo'q bo'lgan kiruvchi xabarlarni tiklaydi — live
 * handlerning tezligi emas, TO'LIQLIGI shu yerdan kafolatlanadi.
 *
 * `telegramMsgId` ustunidagi unique cheklov live handler bilan poyga
 * (race) holatida ikkalasi bir xil xabarni ikki marta ishlamasligini
 * ta'minlaydi (`outreach.ts`dagi `isDuplicateError`).
 */
import type { PrismaClient } from '@prisma/client';
import type { Api, TelegramClient } from 'teleproto';
import { processCeoIncoming, processLeadIncoming, triggerCeoResponse, triggerLeadResponse } from './outreach';
import { getSalesTelegramClient } from './telegram-client';

const RECONCILE_INTERVAL_MS = Number(process.env.SALES_RECONCILE_INTERVAL_MS ?? 45_000);
const FETCH_LIMIT = 15;

type FetchedMessage = Api.Message & { out?: boolean; id: number; message?: string };

async function reconcileOnce(prisma: PrismaClient, client: TelegramClient): Promise<void> {
  // 0-bosqich: "yozib qo'yilgan, lekin javob yakunlanmagan" qatorlarni qayta
  // uradi — process o'rtada yiqilgan yoki avvalgi urinish xato bergan bo'lsa
  // (2026-10-03: restart paytida xuddi shu holat bitta javobni yo'qotgan edi).
  const staleCeo = await prisma.ceoMessage.findMany({
    where: { direction: 'in', handledAt: null },
    include: { contact: true },
  });
  for (const row of staleCeo) {
    console.log(`[sales] reconcile: tugallanmagan javobni qayta uramiz — ${row.contact.label}: "${row.text.slice(0, 60)}"`);
    await triggerCeoResponse(prisma, client, row.contact, row.id, row.text);
  }

  const staleLead = await prisma.salesMessage.findMany({
    where: { direction: 'in', handledAt: null },
    include: { thread: { include: { lead: { select: { id: true, company: true } } } } },
  });
  for (const row of staleLead) {
    console.log(`[sales] reconcile: tugallanmagan javobni qayta uramiz — ${row.thread.lead.company}: "${row.text.slice(0, 60)}"`);
    await triggerLeadResponse(prisma, row.thread, row.id, row.text);
  }

  // 1-bosqich: live Telegram tarixidan bazada umuman yo'q xabarlarni topish.
  const contacts = await prisma.ceoContact.findMany({ where: { telegramPeerId: { not: null } } });
  for (const contact of contacts) {
    try {
      const messages = (await client.getMessages(contact.telegramPeerId!, {
        limit: FETCH_LIMIT,
      })) as unknown as FetchedMessage[];
      const incoming = [...messages].filter((m) => !m.out).reverse();
      for (const m of incoming) {
        const text = m.message ?? '';
        if (!text) continue;
        const seen = await prisma.ceoMessage.findFirst({
          where: { contactId: contact.id, telegramMsgId: m.id },
        });
        if (seen) continue;
        await processCeoIncoming(prisma, client, contact, text, m.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sales] reconcile: ${contact.label} tekshirishda xato: ${msg}`);
    }
  }

  const threads = await prisma.salesThread.findMany({
    where: { telegramPeerId: { not: null }, state: { not: 'closed' } },
    include: { lead: { select: { id: true, company: true } } },
  });
  for (const thread of threads) {
    try {
      const messages = (await client.getMessages(thread.telegramPeerId!, {
        limit: FETCH_LIMIT,
      })) as unknown as FetchedMessage[];
      const incoming = [...messages].filter((m) => !m.out).reverse();
      for (const m of incoming) {
        const text = m.message ?? '';
        if (!text) continue;
        const seen = await prisma.salesMessage.findFirst({
          where: { threadId: thread.id, telegramMsgId: m.id },
        });
        if (seen) continue;
        await processLeadIncoming(prisma, thread, text, m.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sales] reconcile: ${thread.lead.company} tekshirishda xato: ${msg}`);
    }
  }
}

/** Davriy tekshiruvni boshlaydi. To'xtatish uchun qaytarilgan funksiyani chaqiring. */
export function startSalesReconciler(prisma: PrismaClient): () => void {
  let stopped = false;
  void (async () => {
    const client = await getSalesTelegramClient();
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, RECONCILE_INTERVAL_MS));
      if (stopped) break;
      try {
        await reconcileOnce(prisma, client);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[sales] reconcile sikli xato: ${msg}`);
      }
    }
  })();
  return () => {
    stopped = true;
  };
}
