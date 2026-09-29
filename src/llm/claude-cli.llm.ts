import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import { LlmFactory, LlmStepHandle } from '../engine/runner';
import { LlmOptions, NodeLlm, TokenUsage } from '../engine/types';
import { LlmRecorder, NoopRecorder } from './anthropic.llm';

const CLAUDE_BIN = join(homedir(), '.local', 'bin', 'claude');
/**
 * Research hunt promptlari 24 tagacha manba sahifasini o'z ichiga olishi
 * mumkin (research.web.ts'dagi MAX_TOTAL_SOURCES) — bunday og'ir chaqiruvda
 * lokal CLI 180s ichida ulgurmasligi kuzatildi (2026-09-29). 300s ko'proq
 * bo'sh joy beradi, boshqa (kichik) chaqiruvlarga ta'sir qilmaydi.
 */
const DEFAULT_TIMEOUT_MS = 300_000;

interface CliResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

/**
 * Anthropic API kaliti bo'lmaganda ishlatiladigan variant: lokal `claude` CLI.
 * Hermes ham shu yo'ldan boradi.
 *
 * Diqqat:
 *  - `--strict-mcp-config` MAJBURIY — aks holda Telegram MCP plagini yuklanib
 *    jonli poller'ni o'ldiradi (2026-09-08 da bo'lgan muammo).
 *  - CLAUDECODE env o'chiriladi — ichma-ich sessiya taqiqiga tushmaslik uchun.
 *  - Har chaqiruvda Claude Code o'z tizim promptini yuboradi, shuning uchun
 *    birinchi chaqiruv qimmatroq; keyingilari keshdan o'qiydi.
 */
export class ClaudeCliLlm implements LlmFactory {
  constructor(
    private readonly recorder: LlmRecorder = new NoopRecorder(),
    private readonly bin: string = CLAUDE_BIN,
  ) {}

  forStep(runId: string | null, node: string): LlmStepHandle {
    const total: TokenUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

    const call = async (prompt: string, opts?: LlmOptions): Promise<string> => {
      const startedAt = Date.now();
      const fullPrompt = opts?.system ? `${opts.system}\n\n---\n\n${prompt}` : prompt;
      try {
        const out = await this.run(fullPrompt, opts?.model);
        if (out.is_error) throw new Error(out.result ?? 'claude CLI xatosi');
        const usage = {
          tokensIn: out.usage?.input_tokens ?? 0,
          tokensOut: out.usage?.output_tokens ?? 0,
          costUsd: out.total_cost_usd ?? 0,
        };
        total.tokensIn += usage.tokensIn;
        total.tokensOut += usage.tokensOut;
        total.costUsd += usage.costUsd;
        await this.recorder.record({
          runId,
          node,
          model: opts?.model ?? 'claude-cli',
          purpose: opts?.purpose,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          cacheReadIn: 0,
          cacheWriteIn: 0,
          costUsd: usage.costUsd,
          durationMs: Date.now() - startedAt,
          stopReason: out.stop_reason,
        });
        return (out.result ?? '').trim();
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await this.recorder.record({
          runId,
          node,
          model: opts?.model ?? 'claude-cli',
          purpose: opts?.purpose,
          tokensIn: 0,
          tokensOut: 0,
          cacheReadIn: 0,
          cacheWriteIn: 0,
          costUsd: 0,
          durationMs: Date.now() - startedAt,
          error,
        });
        throw err;
      }
    };

    const llm: NodeLlm = {
      text: (prompt, opts) => call(prompt, opts),
      json: async <T>(schema: ZodType<T>, prompt: string, opts?: LlmOptions): Promise<T> => {
        // CLI'da structured output yo'q — sxemani promptga qo'shib, o'zimiz tekshiramiz.
        const instruction =
          'Javobni FAQAT JSON sifatida qaytar. Markdown blok, izoh yoki qo\'shimcha matn yozma.';
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const raw = await call(`${prompt}\n\n${instruction}`, opts);
          try {
            return schema.parse(extractJson(raw));
          } catch (err) {
            if (attempt === 2) {
              throw new Error(
                `JSON sxemaga tushmadi: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
        throw new Error('erishib bo\'lmaydigan holat');
      },
    };

    return { llm, usage: () => ({ ...total }) };
  }

  /**
   * Prompt komanda-qatori argumenti emas, STDIN orqali uzatiladi — Windows'da
   * spawn argumentlari ~32K belgi bilan chegaralangan (`ENAMETOOLONG`),
   * manba matnlari bilan promptlar buni osongina oshib ketadi.
   */
  private run(prompt: string, model?: string): Promise<CliResult> {
    const args = [
      '-p',
      '--output-format',
      'json',
      '--strict-mcp-config',
      '--dangerously-skip-permissions',
    ];
    if (model) args.push('--model', model);

    const env = { ...process.env };
    delete env.CLAUDECODE;

    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { env, cwd: homedir() });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('claude CLI vaqt chegarasidan oshdi'));
      }, DEFAULT_TIMEOUT_MS);

      child.stdin.on('error', () => {}); // jarayon erta chiqsa EPIPE — close handlerda ko'rinadi
      child.stdin.write(prompt);
      child.stdin.end();

      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`claude CLI kod ${code}: ${stderr.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as CliResult);
        } catch {
          reject(new Error(`claude CLI javobi JSON emas: ${stdout.slice(0, 200)}`));
        }
      });
    });
  }
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  if (body.startsWith('{') || body.startsWith('[')) return JSON.parse(body);
  const start = Math.min(...[body.indexOf('{'), body.indexOf('[')].filter((i) => i >= 0));
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (!Number.isFinite(start) || end < 0) throw new Error('javobda JSON topilmadi');
  return JSON.parse(body.slice(start, end + 1));
}
