/**
 * Rasm va video — Sardorning mavjud, ishlab turgan quvurlari ustiga TOR tool.
 *
 * Nega shunday: Hermes'ning o'z `image_gen` tooli pullik backend talab qiladi
 * (FAL / OpenAI / xAI). Sardorda esa bepul yo'l allaqachon bor — Gemini web
 * sessiyasi orqali `~/hermes/gem2.py`. Agentga terminal berish o'rniga faqat
 * shu ikkita amalni ochamiz.
 */
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HOME = homedir();
const BROWSER_PY = join(HOME, '.venvs', 'browser', 'bin', 'python');
const GEM2 = join(HOME, 'hermes', 'gem2.py');
const YIG = join(HOME, 'hermes', 'v3', 'yig.py');
const PUBLIC_DIR = join(HOME, 'Desktop', 'promo-reels', 'public');
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
/** Telegram bot chegarasi 50 MB — xavfsiz chegara 45 MB. */
const MAX_MB = 45;

/** Fayl nomi — faqat xavfsiz belgilar, papkadan chiqib ketmasin. */
function safeName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  if (!clean) throw new Error('nom bo\'sh yoki yaroqsiz (faqat harf, raqam, _ va -)');
  return clean;
}

export async function imageGenerate(prompt: string, name: string): Promise<string> {
  if (!existsSync(BROWSER_PY)) throw new Error(`python topilmadi: ${BROWSER_PY}`);
  if (!existsSync(GEM2)) throw new Error(`gem2.py topilmadi: ${GEM2}`);
  const out = join(PUBLIC_DIR, `${safeName(name)}.png`);
  try {
    await run(BROWSER_PY, [GEM2, prompt, out], { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Rasm yasalmadi: ${msg.slice(0, 300)}\n` +
        'Sabab odatda Gemini web sessiyasi: kunlik kvota (~5 rasm) tugagan yoki ' +
        '~/content-bot/.chrome-profile da qayta kirish kerak.',
    );
  }
  if (!existsSync(out)) throw new Error('Skript xatosiz tugadi, lekin fayl yaratilmadi.');
  return out;
}

export interface RenderResult {
  video: string;
  log: string;
  sizeMb: number;
  compressed: boolean;
}

function sizeMb(path: string): number {
  return statSync(path).size / 1024 / 1024;
}

/**
 * Telegram bot 50 MB dan katta faylni qabul qilmaydi.
 * Render 1080x1920 ni ~21 Mbit/s bilan chiqaradi — bu ijtimoiy tarmoq uchun
 * ortiqcha. 8 Mbit/s ayni me'yor va sifat ko'z bilan farq qilmaydi.
 */
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

export async function reelCompress(
  input: string,
  targetMb = MAX_MB,
  suffix = '_web',
): Promise<{ path: string; before: number; after: number }> {
  if (!existsSync(input)) throw new Error(`fayl yo'q: ${input}`);
  if (!existsSync(FFMPEG)) throw new Error(`ffmpeg topilmadi: ${FFMPEG}`);
  const before = sizeMb(input);
  if (before <= targetMb) return { path: input, before, after: before };

  // Bitrate maqsadli hajmdan hisoblanadi — aks holda uzun video baribir oshib ketadi.
  const dur = await durationSec(input);
  const audioKbps = 128;
  const videoKbps = Math.max(1200, Math.floor((targetMb * 8 * 1024) / dur * 0.92) - audioKbps);

  const out = input.replace(/\.mp4$/i, `${suffix}.mp4`);
  await run(
    FFMPEG,
    ['-y', '-i', input,
     '-c:v', 'libx264', '-preset', 'medium',
     '-b:v', `${videoKbps}k`, '-maxrate', `${Math.floor(videoKbps * 1.3)}k`,
     '-bufsize', `${videoKbps * 2}k`,
     '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
     '-c:a', 'aac', '-b:a', `${audioKbps}k`,
     out],
    { timeout: 900_000, maxBuffer: 16 * 1024 * 1024 },
  );
  if (!existsSync(out)) throw new Error('siqilgan fayl yaratilmadi');
  return { path: out, before, after: sizeMb(out) };
}

/**
 * v3 spec.json → tayyor reel. Telegram'ga YUBORMAYDI (--no-send) va
 * jurnalga sinov deb yoziladi — joylash qarori baribir Sardorda.
 */
export async function reelRender(specPath: string): Promise<RenderResult> {
  if (!existsSync(YIG)) throw new Error(`yig.py topilmadi: ${YIG}`);
  if (!existsSync(specPath)) throw new Error(`spec topilmadi: ${specPath}`);
  const { stdout, stderr } = await run(
    'python3',
    [YIG, specPath, '--no-send', '--sinov'],
    { timeout: 1_500_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const log = `${stdout}\n${stderr}`.trim();
  let video = join(specPath.replace(/\/[^/]+$/, ''), 'reel.mp4');
  if (!existsSync(video)) {
    throw new Error(`Render tugadi, lekin reel.mp4 yo'q.\nLog:\n${log.slice(-1200)}`);
  }
  // Telegram 50 MB dan kattasini yubormaydi — kerak bo'lsa darhol siqamiz.
  const c = await reelCompress(video);
  const compressed = c.path !== video;
  if (compressed) video = c.path;
  return { video, log: log.slice(-1500), sizeMb: c.after, compressed };
}
