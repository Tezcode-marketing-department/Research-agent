/**
 * Loyiha tajribasi — o'qiladigan bilim bazasi.
 *
 * Nega tool, nega SOUL emas: bu fayllar jami ~170 KB. Hammasini SOUL'ga
 * qo'ysak har xabarda kontekstni to'ldirib yuboradi. Agent kerak bo'lganda
 * kerakli bo'limni o'qisin.
 *
 * Ichidagi matn — bizning o'z loyihalarimiz tarixi, ya'ni ishonchli manba.
 * Lekin baribir MA'LUMOT: unda yozilgan narsa bugun ham shundaymi — tekshirish
 * kerak bo'lsa tekshiriladi.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(homedir(), 'Desktop', 'Tezcode', 'Tezcode-Agents', 'knowledge', 'seo');

function baseDir(): string {
  if (!existsSync(ROOT)) throw new Error(`bilim bazasi topilmadi: ${ROOT}`);
  return ROOT;
}

export function knowledgeList(): { project: string; lines: number; sections: string[] }[] {
  const dir = baseDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const text = readFileSync(join(dir, f), 'utf8');
      return {
        project: f.replace(/\.md$/, ''),
        lines: text.split('\n').length,
        sections: text.split('\n')
          .filter((l) => /^#{1,2}\s+\S/.test(l))
          .map((l) => l.replace(/^#+\s+/, '').trim())
          .slice(0, 25),
      };
    });
}

function fileOf(project: string): string {
  const p = join(baseDir(), `${project.toLowerCase()}.md`);
  if (!existsSync(p)) {
    const have = knowledgeList().map((x) => x.project).join(', ');
    throw new Error(`"${project}" yo'q. Mavjudlari: ${have}`);
  }
  return p;
}

/** Bo'limsiz — sarlavhalar ro'yxati. Bo'lim berilsa — o'sha bo'lim matni. */
export function knowledgeRead(project: string, section?: string): string {
  const text = readFileSync(fileOf(project), 'utf8');
  if (!section) {
    const heads = text.split('\n').filter((l) => /^#{1,3}\s+\S/.test(l));
    return `${project} — ${text.split('\n').length} qator, bo'limlar:\n\n${heads.join('\n')}\n\n` +
      'Kerakli bo\'limni `section` bilan so\'ra.';
  }
  const lines = text.split('\n');
  const needle = section.toLowerCase();
  const start = lines.findIndex((l) => /^#{1,3}\s/.test(l) && l.toLowerCase().includes(needle));
  if (start < 0) throw new Error(`"${section}" bo'limi topilmadi`);
  const level = (lines[start].match(/^#+/) as RegExpMatchArray)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^#+/);
    if (m && m[0].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').slice(0, 20_000);
}

export interface KnowledgeHit {
  project: string;
  section: string;
  line: string;
}

/** Barcha loyihalar bo'ylab qidiradi — "shu muammoni kim ko'rgan?" savoliga. */
export function knowledgeSearch(term: string, limit = 25): KnowledgeHit[] {
  const dir = baseDir();
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const hits: KnowledgeHit[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    let section = '';
    for (const line of lines) {
      if (/^#{1,3}\s/.test(line)) { section = line.replace(/^#+\s+/, '').trim(); continue; }
      if (re.test(line) && line.trim().length > 15) {
        hits.push({ project: f.replace(/\.md$/, ''), section, line: line.trim().slice(0, 300) });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
