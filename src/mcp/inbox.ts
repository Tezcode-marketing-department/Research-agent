/**
 * Telegram biriktirmalari — Sardor yuborgan fayllarni o'qish.
 *
 * Hermes ularni `~/.hermes/profiles/<agent>/cache/<tur>/` ga saqlaydi.
 * Bu tool FAQAT o'sha papkadan o'qiydi — Mac'ning qolgan qismiga
 * kira olmaydi, va o'sha papkadagi ichki kesh fayllarini ham bermaydi.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative, extname, isAbsolute } from 'node:path';

const AGENT = process.env.AGENT_NAME ?? '';
const HERMES = join(homedir(), '.hermes');

/** Biriktirmalar shu pastki papkalarga tushadi. `web/` va ildizdagi *.json — ichki kesh. */
const MEDIA_DIRS = ['documents', 'files', 'images', 'photos', 'videos', 'audio', 'voice'];

const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|csv|tsv|log|html?|xml|ts|tsx|js|jsx|py|sh)$/i;

function cacheRoot(): string {
  if (!AGENT) throw new Error('AGENT_NAME o\'rnatilmagan');
  const root = join(HERMES, 'profiles', AGENT, 'cache');
  // default profil ildizda yashaydi
  const fallback = join(HERMES, 'cache');
  if (existsSync(root)) return root;
  if (existsSync(fallback)) return fallback;
  throw new Error('kesh papkasi topilmadi');
}

function safe(rel: string): string {
  const root = cacheRoot();
  if (isAbsolute(rel)) {
    // Hermes to'liq yo'l beradi — u kesh ichida bo'lsa qabul qilamiz
    const inside = relative(root, rel);
    if (inside.startsWith('..')) throw new Error('bu fayl biriktirmalar papkasida emas');
    return rel;
  }
  const abs = resolve(root, rel);
  if (relative(root, abs).startsWith('..')) throw new Error('papkadan chiqib bo\'lmaydi');
  return abs;
}

export interface InboxItem {
  path: string;
  size: number;
  modified: string;
  kind: string;
}

export function inboxList(limit = 25): InboxItem[] {
  const root = cacheRoot();
  const out: InboxItem[] = [];
  for (const dir of MEDIA_DIRS) {
    const d = join(root, dir);
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      out.push({
        path: `${dir}/${name}`,
        size: st.size,
        modified: st.mtime.toISOString().slice(0, 16).replace('T', ' '),
        kind: dir,
      });
    }
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, limit);
}

export function inboxRead(path: string): string {
  const abs = safe(path);
  if (!existsSync(abs)) throw new Error(`fayl yo'q: ${path} (inbox_list bilan ro'yxatni ko'r)`);
  const st = statSync(abs);
  const ext = extname(abs);

  if (!TEXT_EXT.test(ext)) {
    return (
      `Bu matn fayli emas (${ext || 'kengaytmasiz'}, ${Math.round(st.size / 1024)} KB).\n` +
      'Rasm bo\'lsa vision_analyze ishlat. Video yoki audio bilan ishlash imkoniyati hozircha yo\'q — ' +
      'kerak bo\'lsa blocker_add bilan qayd qil.'
    );
  }
  if (st.size > 400_000) {
    throw new Error(`fayl juda katta (${Math.round(st.size / 1024)} KB) — 400 KB gacha o'qiyman`);
  }
  const text = readFileSync(abs, 'utf8');
  return text.length > 120_000 ? text.slice(0, 120_000) + '\n\n[...qisqartirildi]' : text;
}
