import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ZodType } from 'zod';
import { LlmFactory, LlmStepHandle } from '../engine/runner';
import { LlmOptions, NodeLlm, TokenUsage } from '../engine/types';
import { LlmRecorder, NoopRecorder } from './anthropic.llm';

const HERMES_HOME = join(homedir(), '.hermes');
const TIMEOUT_MS = 120_000;

export interface HermesModelConfig {
  model: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
}

/**
 * Hermes Agent (Nous Research) sozlamalaridan modelni o'qiydi.
 * Gateway ISHLASHI SHART EMAS — bizga faqat model va kalit kerak.
 * Hermes UI'da model o'zgartirilsa, bizning agentlar ham o'sha modelga o'tadi.
 */
export function loadHermesConfig(home: string = HERMES_HOME): HermesModelConfig {
  const raw = readFileSync(join(home, 'config.yaml'), 'utf8');
  const cfg = parseYaml(raw) as { model?: { default?: string; provider?: string; base_url?: string } };
  const model = cfg.model?.default;
  const baseUrl = cfg.model?.base_url;
  const provider = cfg.model?.provider ?? 'gemini';
  if (!model || !baseUrl) throw new Error('~/.hermes/config.yaml da model yoki base_url yo\'q');

  const env = readEnvFile(join(home, '.env'));
  const keyName = provider === 'gemini' ? 'GEMINI_API_KEY' : `${provider.toUpperCase()}_API_KEY`;
  const apiKey = env[keyName] ?? env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error(`~/.hermes/.env da ${keyName} topilmadi`);

  return { model, provider, baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
}

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

interface ChatCompletion {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/** OpenAI-mos chat completions orqali Hermes modelini chaqiradi. */
export class HermesLlm implements LlmFactory {
  constructor(
    private readonly config: HermesModelConfig,
    private readonly recorder: LlmRecorder = new NoopRecorder(),
  ) {}

  forStep(runId: string | null, node: string): LlmStepHandle {
    const total: TokenUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

    const call = async (prompt: string, opts?: LlmOptions): Promise<string> => {
      const startedAt = Date.now();
      const model = opts?.model ?? this.config.model;
      const messages: { role: string; content: string }[] = [];
      if (opts?.system) messages.push({ role: 'system', content: opts.system });
      messages.push({ role: 'user', content: prompt });

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let body: ChatCompletion;
        try {
          const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages,
              max_tokens: opts?.maxTokens ?? 4096,
            }),
            signal: controller.signal,
          });
          body = (await response.json()) as ChatCompletion;
          if (!response.ok) {
            throw new Error(`${response.status}: ${body.error?.message ?? 'noma\'lum xato'}`);
          }
        } finally {
          clearTimeout(timer);
        }

        const text = body.choices?.[0]?.message?.content?.trim() ?? '';
        const usage = {
          tokensIn: body.usage?.prompt_tokens ?? 0,
          tokensOut: body.usage?.completion_tokens ?? 0,
          costUsd: 0, // bepul tier
        };
        total.tokensIn += usage.tokensIn;
        total.tokensOut += usage.tokensOut;

        await this.recorder.record({
          runId,
          node,
          model,
          purpose: opts?.purpose,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          cacheReadIn: 0,
          cacheWriteIn: 0,
          costUsd: 0,
          durationMs: Date.now() - startedAt,
          stopReason: body.choices?.[0]?.finish_reason ?? null,
        });
        return text;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await this.recorder.record({
          runId,
          node,
          model,
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
        const instruction = 'Javobni FAQAT JSON qaytar. Markdown blok yoki izoh yozma.';
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const raw = await call(`${prompt}\n\n${instruction}`, opts);
          try {
            return schema.parse(extractJson(raw));
          } catch (err) {
            if (attempt === 2) {
              throw new Error(
                `JSON sxemaga tushmadi: ${err instanceof Error ? err.message : String(err)}`,
                { cause: err },
              );
            }
          }
        }
        throw new Error('erishib bo\'lmaydigan holat');
      },
    };

    return { llm, usage: () => ({ ...total }) };
  }
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  if (body.startsWith('{') || body.startsWith('[')) return JSON.parse(body);
  const starts = [body.indexOf('{'), body.indexOf('[')].filter((i) => i >= 0);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (starts.length === 0 || end < 0) throw new Error('javobda JSON topilmadi');
  return JSON.parse(body.slice(Math.min(...starts), end + 1));
}
