import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentRegistry } from '../agents/agent.registry';
import { EngineModule } from '../engine/engine.module';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [ConfigModule, EngineModule],
  providers: [AgentRegistry, ConversationService, ChatService, TelegramService],
  exports: [ConversationService, ChatService],
})
export class TelegramModule {}
