import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, GrammyError } from 'grammy';
import { AgentDef, AgentRegistry } from '../agents/agent.registry';
import { PrismaService } from '../db/prisma.service';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';

/** Postgres advisory lock kaliti — ikkinchi nusxa polling boshlamasin. */
const LOCK_KEY = 811_223_344;

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
      await ctx.reply(reply.text);
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
          await ctx.reply(pending.text);
          return;
        }
        // Kutayotgan ish yo'q. Ba'zi agentlar uchun (masalan Research) oddiy
        // matn ham /vazifa kabi yangi ish boshlaydi — buyruqni eslab yurish shart emas.
        if (def.autoStartFromText) {
          const reply = await this.conversation.startTask(def.key, ctx.chat.id, text);
          await ctx.reply(reply.text);
          return;
        }
        // Yo'q — oddiy suhbat.
        await ctx.reply(await this.chat.reply(def.key, ctx.chat.id, text));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`${def.title}: ${message}`);
        await ctx.reply(`Xato: ${message}`);
      } finally {
        clearInterval(typing);
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
