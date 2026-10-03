import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../db/prisma.service';
import { startSalesListener } from './outreach';
import { startSalesReconciler } from './reconcile';

/**
 * Sales Telegram USER akkauntidan kelayotgan javoblarni doimiy tinglaydi —
 * Research bot singari, butun process umri davomida ishlaydi (bot emas,
 * lekin xuddi shunday fonda). Live handlerga qo'shimcha ravishda davriy
 * `reconcile.ts` ham ishga tushadi — live handler qochirib yuborgan xabarni
 * tiklaydigan xavfsizlik to'ri (2026-10-03 da real holatda kerak bo'lgan).
 */
@Injectable()
export class SalesListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SalesListenerService.name);
  private stopReconciler?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get<string>('SALES_TG_SESSION')) {
      this.logger.warn("Sales Telegram: SALES_TG_SESSION bo'sh — o'tkazib yuborildi (pnpm sales:login)");
      return;
    }
    await startSalesListener(this.prisma);
    this.stopReconciler = startSalesReconciler(this.prisma);
    this.logger.log('Sales Telegram: tinglovchi va reconcile sikli ishga tushdi');
  }

  onModuleDestroy(): void {
    this.stopReconciler?.();
  }
}
