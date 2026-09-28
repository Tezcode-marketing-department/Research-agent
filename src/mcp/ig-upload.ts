/**
 * Instagram Reels — videoni Meta'ga joylaydi.
 *
 * NEGA BU YO'L (2026-09-22 da o'lchab aniqlangan):
 * Meta'ning `rupload.facebook.com` resumable upload'i FAQAT Facebook Login
 * oqimidagi tokenlar uchun ishlaydi. Bizdagi token — Instagram Login (IGAA…,
 * graph.instagram.com). Unda `upload_type=resumable` qabul qilinmaydi:
 * har safar "The parameter video_url is required" (code 100) qaytadi.
 * v21/v22/v23 — hammasida bir xil. Ya'ni bu skript xatosi emas, token turi.
 *
 * Shuning uchun yagona ishlaydigan yo'l: videoga ommaviy havola berib,
 * `video_url` bilan konteyner yaratish. Havolani Telegram beradi, lekin
 * `getFile` 20 MB dan kattasini bermaydi — shuning uchun katta video avval
 * ffmpeg bilan 19 MB gacha siqiladi. Sifat 1080x1920 da ko'zga bilinmaydi.
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const GRAPH = 'https://graph.instagram.com/v23.0';
const TG = 'https://api.telegram.org';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
/** Telegram `getFile` chegarasi 20 MB — xavfsiz maqsad 18 MB. */
const TG_LIMIT_MB = 19;
const TARGET_MB = 18;

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export interface IgCreds {
  userId: string;
  token: string;
  tgToken: string;
  tgChat: string;
}

export function igCreds(account: string): IgCreds {
  const env = readEnv(join(homedir(), 'content-bot', '.env'));
  const up = account.toUpperCase();
  const userId = account === 'tezcode' ? env.IG_USER_ID : env[`IG_USER_ID_${up}`] ?? env.IG_USER_ID;
  const token = account === 'tezcode' ? env.IG_ACCESS_TOKEN : env[`IG_ACCESS_TOKEN_${up}`] ?? env.IG_ACCESS_TOKEN;
  if (!userId || !token) throw new Error(`${account} uchun IG_USER_ID / IG_ACCESS_TOKEN topilmadi`);
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error('ommaviy havola uchun TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID kerak');
  }
  return { userId, token, tgToken: env.TELEGRAM_BOT_TOKEN, tgChat: env.TELEGRAM_CHAT_ID };
}

const mb = (bytes: number): number => bytes / 1024 / 1024;

async function durationSec(path: string): Promise<number> {
  const probe = FFMPEG.replace(/ffmpeg$/, 'ffprobe');
  const { stdout } = await run(
    probe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
    { timeout: 60_000 },
  );
  const d = Number(stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : 25;
}

/** 20 MB dan katta videoni Telegram o'tkazadigan hajmgacha siqadi. */
async function fitForUpload(input: string): Promise<{ path: string; note?: string }> {
  const before = mb(statSync(input).size);
  if (before <= TG_LIMIT_MB) return { path: input };
  if (!existsSync(FFMPEG)) throw new Error(`video ${before.toFixed(1)} MB, siqish kerak, lekin ffmpeg yo'q: ${FFMPEG}`);

  const out = join(dirname(input), `${basename(input).replace(/\.mp4$/i, '')}_ig${TARGET_MB}.mp4`);
  if (existsSync(out) && mb(statSync(out).size) <= TG_LIMIT_MB) {
    return { path: out, note: `siqilgan nusxa ishlatildi (${mb(statSync(out).size).toFixed(1)} MB)` };
  }
  const dur = await durationSec(input);
  const audioKbps = 128;
  const totalKbps = Math.floor((TARGET_MB * 8192) / dur) - audioKbps;
  if (totalKbps < 400) throw new Error(`video juda uzun (${dur.toFixed(0)} s) — 18 MB ga sifatsiz siqiladi`);
  await run(
    FFMPEG,
    ['-y', '-i', input, '-c:v', 'libx264', '-b:v', `${totalKbps}k`, '-maxrate', `${Math.floor(totalKbps * 1.3)}k`,
     '-bufsize', `${totalKbps * 2}k`, '-preset', 'medium', '-c:a', 'aac', '-b:a', `${audioKbps}k`,
     '-movflags', '+faststart', out],
    { timeout: 900_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const after = mb(statSync(out).size);
  if (after > TG_LIMIT_MB) throw new Error(`siqishdan keyin ham katta: ${after.toFixed(1)} MB`);
  return { path: out, note: `siqildi ${before.toFixed(1)} → ${after.toFixed(1)} MB` };
}

/** Faylni Telegram'ga yuklab, Meta o'qiy oladigan ommaviy havola qaytaradi. */
async function publicUrl(path: string, c: IgCreds, kind: 'photo' | 'document'): Promise<string> {
  const bytes = readFileSync(path);
  const form = new FormData();
  form.append('chat_id', c.tgChat);
  form.append('disable_notification', 'true');
  form.append(kind, new Blob([new Uint8Array(bytes)]), basename(path));
  const up = await fetch(`${TG}/bot${c.tgToken}/${kind === 'photo' ? 'sendPhoto' : 'sendDocument'}`, {
    method: 'POST',
    body: form,
  });
  const j = (await up.json()) as {
    ok: boolean;
    description?: string;
    result?: { photo?: { file_id: string }[]; document?: { file_id: string } };
  };
  if (!j.ok) throw new Error(`Telegram'ga yuklanmadi: ${j.description}`);
  const fileId = kind === 'photo'
    ? j.result?.photo?.[j.result.photo.length - 1]?.file_id
    : j.result?.document?.file_id;
  if (!fileId) throw new Error('Telegram file_id qaytarmadi');

  const gf = await fetch(`${TG}/bot${c.tgToken}/getFile?file_id=${fileId}`);
  const g = (await gf.json()) as { ok: boolean; description?: string; result?: { file_path: string } };
  if (!g.ok || !g.result) {
    throw new Error(`havola olinmadi: ${g.description ?? 'noma\'lum'} (odatda fayl 20 MB dan katta)`);
  }
  return `${TG}/file/bot${c.tgToken}/${g.result.file_path}`;
}

async function graph(path: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`${GRAPH}/${path}`, { method: 'POST', body });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok || j.error) throw new Error(`Graph API: ${JSON.stringify(j.error ?? j).slice(0, 500)}`);
  return j;
}

export interface UploadResult {
  mediaId: string;
  sizeMb: number;
  steps: string[];
}

export async function publishReel(
  account: string,
  videoPath: string,
  caption: string,
  coverPath?: string,
  story = false,
): Promise<UploadResult> {
  if (!existsSync(videoPath)) throw new Error(`video yo'q: ${videoPath}`);
  if (extname(videoPath).toLowerCase() !== '.mp4') throw new Error('faqat .mp4');
  const c = igCreds(account);
  const steps: string[] = [];

  // 1. Hajmni Telegram havolasi o'tadigan darajaga keltirish
  const fit = await fitForUpload(videoPath);
  if (fit.note) steps.push(fit.note);
  const size = statSync(fit.path).size;

  // 2. Ommaviy havolalar
  const videoUrl = await publicUrl(fit.path, c, 'document');
  steps.push(`video havolasi tayyor (${mb(size).toFixed(1)} MB)`);

  const params: Record<string, string> = {
    media_type: story ? 'STORIES' : 'REELS',
    video_url: videoUrl,
  };
  if (!story) params.caption = caption;
  if (coverPath && !story) {
    if (!existsSync(coverPath)) throw new Error(`muqova yo'q: ${coverPath}`);
    params.cover_url = await publicUrl(coverPath, c, 'photo');
    steps.push('muqova havolasi tayyor');
  }

  // 3. Konteyner
  const created = await graph(`${c.userId}/media`, params, c.token);
  const containerId = String(created.id ?? '');
  if (!containerId) throw new Error('konteyner id qaytmadi');
  steps.push(`konteyner: ${containerId}`);

  // 4. Meta qayta ishlaguncha kutish
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(
      `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(c.token)}`,
    );
    const s = (await st.json()) as { status_code?: string; status?: string };
    if (s.status_code === 'FINISHED') { ready = true; break; }
    if (s.status_code === 'ERROR') throw new Error(`qayta ishlash xatosi: ${s.status ?? ''}`);
  }
  if (!ready) throw new Error('5 daqiqada tayyor bo\'lmadi');
  steps.push('qayta ishlandi');

  // 5. Joylash
  const pub = await graph(`${c.userId}/media_publish`, { creation_id: containerId }, c.token);
  const mediaId = String(pub.id ?? '');
  steps.push(`joylandi: ${mediaId}`);
  return { mediaId, sizeMb: mb(size), steps };
}
