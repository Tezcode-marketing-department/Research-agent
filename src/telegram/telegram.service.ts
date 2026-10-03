import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, GrammyError } from 'grammy';
import { AgentDef, AgentRegistry } from '../agents/agent.registry';
import { PrismaService } from '../db/prisma.service';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { resolveCeoDecision } from '../sales/ceo-approval';
import { sendToLead } from '../sales/outreach';

/** Postgres advisory lock kaliti — ikkinchi nusxa polling boshlamasin. */
const LOCK_KEY = 811_223_344;

/** Telegram xabar chegarasi 4096 belgi — boy hisobot qator bo'yicha bo'laklanadi. */
const TG_MESSAGE_LIMIT = 4000;

function splitMessage(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > TG_MESSAGE_LIMIT) {
    const newline = rest.lastIndexOf('\n', TG_MESSAGE_LIMIT);
    const cut = newline > TG_MESSAGE_LIMIT / 2 ? newline : TG_MESSAGE_LIMIT;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bots: Bot[] = [];
  private ownerId = 0;
  private locked = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: AgentRegistry,
    private readonly conversation: ConversationService,
    private readonly chat: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.ownerId = Number(this.config.get('TG_OWNER_CHAT_ID') ?? 0);
    if (!this.ownerId) {
      this.logger.error('TG_OWNER_CHAT_ID yo\'q — botlar ishga tushmaydi');
      return;
    }

    // Bitta nusxa qoidasi: aks holda Telegram 409 beradi va IKKALA poller ham sinadi.
    this.locked = await this.acquireLock();
    if (!this.locked) {
      this.logger.error('Boshqa nusxa ishlayapti (advisory lock band) — polling boshlanmadi');
      return;
    }

    for (const def of this.registry.all()) {
      const token = this.config.get<string>(def.tokenEnv);
      if (!token) {
        this.logger.warn(`${def.title}: ${def.tokenEnv} bo'sh — o'tkazib yuborildi`);
        continue;
      }
      await this.startBot(def, token);
    }

    if (this.bots.length === 0) this.logger.warn('bironta bot ishga tushmadi');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.bots.map((bot) => bot.stop().catch(() => undefined)));
    if (this.locked) {
      await this.prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_KEY})`);
    }
  }

  private async acquireLock(): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<{ locked: boolean }[]>(
      `SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`,
    );
    return rows[0]?.locked === true;
  }

  private async startBot(def: AgentDef, token: string): Promise<void> {
    const bot = new Bot(token);

    // Faqat Sardor. Boshqa hamma jim qoldiriladi — javob ham berilmaydi.
    bot.use(async (ctx, next) => {
      if (ctx.chat?.id !== this.ownerId) {
        this.logger.warn(`${def.title}: begona chat ${ctx.chat?.id} — e'tiborsiz`);
        return;
      }
      await next();
    });

    bot.command('start', async (ctx) => {
      await ctx.reply(def.greeting);
    });

    bot.command('holat', async (ctx) => {
      await ctx.reply(await this.conversation.status(def.key, ctx.chat.id));
    });

    bot.command('bekor', async (ctx) => {
      await ctx.reply(await this.conversation.cancel(def.key, ctx.chat.id));
    });

    bot.command('tozala', async (ctx) => {
      const n = await this.chat.clear(def.key, ctx.chat.id);
      await ctx.reply(`Suhbat tarixi tozalandi (${n} qator).`);
    });

    // Vazifa oqimini ataylab boshlash: tasdiq talab qiladigan ish.
    bot.command('vazifa', async (ctx) => {
      const text = ctx.match?.trim();
      if (!text) {
        await ctx.reply('Foydalanish: /vazifa <matn>');
        return;
      }
      await ctx.replyWithChatAction('typing');
      const reply = await this.conversation.startTask(def.key, ctx.chat.id, text);
      for (const chunk of splitMessage(reply.text)) await ctx.reply(chunk);
    });

    bot.on('message:text', async (ctx) => {
      const text = ctx.message.text.trim();
      if (text.startsWith('/')) return;
      await ctx.replyWithChatAction('typing');
      const typing = setInterval(() => {
        void ctx.replyWithChatAction('typing').catch(() => undefined);
      }, 5000);
      try {
        // Avval: kutayotgan vazifa bormi? Bo'lsa — javob o'shanga.
        const pending = await this.conversation.handleMessage(def.key, ctx.chat.id, text);
        if (pending) {
          for (const chunk of splitMessage(pending.text)) await ctx.reply(chunk);
          return;
        }
        // Kutayotgan ish yo'q. Ba'zi agentlar uchun (masalan Research) oddiy
        // matn ham /vazifa kabi yangi ish boshlaydi — buyruqni eslab yurish shart emas.
        if (def.autoStartFromText) {
          const reply = await this.conversation.startTask(def.key, ctx.chat.id, text);
          for (const chunk of splitMessage(reply.text)) await ctx.reply(chunk);
          return;
        }
        // Yo'q — oddiy suhbat.
        const chatReply = await this.chat.reply(def.key, ctx.chat.id, text);
        for (const chunk of splitMessage(chatReply)) await ctx.reply(chunk);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`${def.title}: ${message}`);
        await ctx.reply(`Xato: ${message}`);
      } finally {
        clearInterval(typing);
      }
    });

    // CEO'ning Accept/Decline bosishi — ceo_propose_meeting (MCP) yuborgan
    // tugma shu yerda ushlanadi, chunki faqat shu process bot tokenini
    // long-polling qiladi. Deterministik: LLM kerak emas, darhol javob.
    bot.on('callback_query:data', async (ctx) => {
      const match = /^ceo_(accept|decline):(.+)$/.exec(ctx.callbackQuery.data);
      if (!match) return;
      const [, action, threadId] = match;
      try {
        const { leadId, leadCompany, alreadyResolved } = await resolveCeoDecision(
          this.prisma, threadId, action as 'accept' | 'decline',
        );

        if (alreadyResolved) {
          // Boshqa CEO allaqachon bosgan — leadga ikkinchi marta xabar yubormaymiz.
          await ctx.answerCallbackQuery({ text: 'Allaqachon hal qilindi (boshqa CEO bosgan)' });
          const original = ctx.callbackQuery.message?.text ?? '';
          await ctx.editMessageText(`${original}\n\n(allaqachon hal qilindi)`).catch(() => undefined);
          return;
        }

        await ctx.answerCallbackQuery({ text: action === 'accept' ? 'Qabul qilindi' : 'Rad etildi' });
        const original = ctx.callbackQuery.message?.text ?? '';
        await ctx.editMessageText(
          `${original}\n\n${action === 'accept' ? `✅ QABUL QILINDI` : `❌ RAD ETILDI`}`,
        ).catch(() => undefined);

        const toLead = action === 'accept'
          ? "Ajoyib! Uchrashuv tasdiqlandi, tez orada bog'lanamiz."
          : "Afsuski, bu vaqt band ekan. Sizga qulay bo'lgan boshqa vaqtni ayting.";
        await sendToLead(this.prisma, leadId, toLead);
        this.logger.log(`CEO ${action}: ${leadCompany}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`CEO tugmasi: ${message}`);
        await ctx.answerCallbackQuery({ text: `Xato: ${message.slice(0, 180)}` }).catch(() => undefined);
      }
    });

    bot.catch((err) => {
      const cause = err.error;
      this.logger.error(
        `${def.title} grammY xatosi: ${cause instanceof GrammyError ? cause.description : String(cause)}`,
      );
    });

    const me = await bot.api.getMe();
    // start() kutilmaydi — u polling siklini ushlab turadi.
    void bot.start({ drop_pending_updates: true });
    this.bots.push(bot);
    this.logger.log(`${def.title} → @${me.username}`);
  }
}
