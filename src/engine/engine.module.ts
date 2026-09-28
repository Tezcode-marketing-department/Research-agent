import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../db/prisma.service';
import { PrismaCheckpointer } from '../db/prisma.checkpointer';
import { PrismaLlmRecorder } from '../db/prisma.recorder';
import { AnthropicLlm } from '../llm/anthropic.llm';
import { ClaudeCliLlm } from '../llm/claude-cli.llm';
import { HermesLlm, loadHermesConfig } from '../llm/hermes.llm';
import { GraphRunner } from './runner';

export const CHECKPOINTER = Symbol('CHECKPOINTER');
export const LLM_FACTORY = Symbol('LLM_FACTORY');

@Module({
  imports: [ConfigModule],
  providers: [
    PrismaService,
    PrismaCheckpointer,
    PrismaLlmRecorder,
    { provide: CHECKPOINTER, useExisting: PrismaCheckpointer },
    {
      provide: LLM_FACTORY,
      inject: [PrismaLlmRecorder, ConfigService],
      // Standart — lokal `claude` CLI: Anthropic API kaliti KERAK EMAS,
      // Sardorning Claude Code obunasidan ishlaydi (Hermes ham shu yo'ldan boradi).
      // API'ga o'tish faqat ataylab: LLM_BACKEND=api.
      useFactory: (recorder: PrismaLlmRecorder, config: ConfigService) => {
        const backend = (config.get<string>('LLM_BACKEND') ?? 'hermes').toLowerCase();
        if (backend === 'hermes') {
          // Hermes Agent sozlagan model (hozir gemini-3.6-flash, bepul tier).
          // Gateway ishlashi shart emas — config.yaml va .env yetarli.
          return new HermesLlm(loadHermesConfig(), recorder);
        }
        if (backend === 'cli') return new ClaudeCliLlm(recorder);
        if (backend === 'api') {
          if (!config.get<string>('ANTHROPIC_API_KEY')) {
            throw new Error('LLM_BACKEND=api, lekin ANTHROPIC_API_KEY yo\'q');
          }
          return new AnthropicLlm(new Anthropic(), recorder);
        }
        throw new Error(`noma'lum LLM_BACKEND: ${backend} (hermes | cli | api)`);
      },
    },
    {
      provide: GraphRunner,
      inject: [CHECKPOINTER, LLM_FACTORY, ConfigService],
      useFactory: (
        checkpointer: PrismaCheckpointer,
        llm: AnthropicLlm,
        config: ConfigService,
      ) =>
        new GraphRunner(checkpointer, llm, {
          maxSteps: Number(config.get('ENGINE_MAX_STEPS') ?? 50),
          maxCostUsd: Number(config.get('ENGINE_MAX_COST_USD') ?? 2),
        }),
    },
  ],
  exports: [GraphRunner, PrismaService, CHECKPOINTER, LLM_FACTORY],
})
export class EngineModule {}
