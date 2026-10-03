import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EngineModule } from './engine/engine.module';
import { TelegramModule } from './telegram/telegram.module';
import { SalesModule } from './sales/sales.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), EngineModule, TelegramModule, SalesModule],
})
export class AppModule {}
