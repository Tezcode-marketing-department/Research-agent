/**
 * Instagram'ga joylash — Sardorning mavjud `instagram_publish.py` skripti ustiga.
 *
 * Bu QAYTARIB BO'LMAYDIGAN, OMMAVIY amal. Shuning uchun:
 *  - `dryRun` sukut bo'yicha YOQILGAN — e'tiborsiz chaqiruv post qilmaydi
 *  - muqova majburiy (Sardor qoidasi: har post dizaynli cover bilan)
 *  - har chaqiruv bazaga yoziladi
 *  - SOUL qoidasi: Sardor aniq "joyla" demaguncha dryRun o'chirilmaydi
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { publishReel } from './ig-upload.js';

const run = promisify(execFile);
const HOME = homedir();
const CB = join(HOME, 'content-bot');
const SCRIPT = join(CB, 'instagram_publish.py');

/** .env dagi akkaunt nomlari — `--account` shu qiymatni oladi. */
export const IG_ACCOUNTS = ['tezcode', 'maxsavdo', 'tezdetal', 'raos', 'wewatch', 'clinicago'];


function guard(): void {
  if (!existsSync(SCRIPT)) throw new Error(`skript topilmadi: ${SCRIPT}`);
}

export async function instagramCheck(account?: string): Promise<string> {
  guard();
  const args = [SCRIPT, '--check'];
  if (account && account !== 'tezcode') args.push('--account', account);
  try {
    const { stdout, stderr } = await run('python3', args, {
      cwd: CB, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    });
    return `${stdout}\n${stderr}`.trim().slice(-2000) || 'javob bo\'sh';
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`tekshiruv o'tmadi:\n${(e.stdout ?? '') + (e.stderr ?? e.message ?? '')}`.slice(0, 1500), { cause: err });
  }
}

export interface PublishInput {
  account: string;
  video: string;
  caption: string;
  cover: string;
  dryRun: boolean;
  story?: boolean;
}

export async function instagramPublish(i: PublishInput): Promise<string> {
  guard();
  if (!IG_ACCOUNTS.includes(i.account)) {
    throw new Error(`noma'lum akkaunt: ${i.account}. Mavjudlari: ${IG_ACCOUNTS.join(', ')}`);
  }
  if (!existsSync(i.video)) throw new Error(`video yo'q: ${i.video}`);
  if (!/\.mp4$/i.test(i.video)) throw new Error('faqat .mp4');

  if (!existsSync(i.cover)) {
    throw new Error(`muqova yo'q: ${i.cover}. Sardor qoidasi — har post dizaynli muqova bilan.`);
  }
  if (i.caption.trim().length < 20) throw new Error('opisaniya juda qisqa');
  if (/14\s*kun\s*bepul|bepul\s*sinov/i.test(i.caption)) {
    throw new Error('opisaniyada bepul sinov taklifi bor — bu TAQIQLANGAN (Sardor qoidasi)');
  }

  if (i.dryRun) {
    return (
      `SINOV REJIMI — joylanmadi.\n\n` +
      `akkaunt: ${i.account}\nvideo: ${i.video}\nmuqova: ${i.cover}\n` +
      `opisaniya: ${i.caption.length} belgi\n\n` +
      `Haqiqatan joylash uchun Sardordan ruxsat ol, keyin dryRun: false.`
    );
  }

  const r = await publishReel(i.account, i.video, i.caption, i.cover, i.story ?? false);
  return `JOYLANDI — media_id: ${r.mediaId}\nHajm: ${r.sizeMb.toFixed(1)} MB (to'g'ridan-to'g'ri Meta'ga yuklandi)\n\n${r.steps.join('\n')}`;
}
