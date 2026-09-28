/**
 * Hermes'ning kontent xotirasi — zo'r reellar aynan shu fayllardan chiqqan.
 *
 * Bu fayllar TIRIK: Sardor yangi fikr aytsa saboqlarga, har video jurnalga,
 * har kunlik qaror plan_log ga tushadi. Shuning uchun nusxa olmaymiz —
 * har safar joyidan o'qiymiz.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const H = join(homedir(), 'hermes');

const SOURCES: Record<string, { file: string; note: string; tail?: number }> = {
  saboqlar: {
    file: 'memory/saboqlar.md',
    note: 'Sardorning qoidalari. HAMMA narsadan ustun — raqam nima desa ham buzilmaydi.',
  },
  priyomlar: {
    file: 'memory/priyomlar.md',
    note: 'Usullar kutubxonasi (P1-P10). Har reelda 1-2 tasini ishlat va jurnalga yoz.',
  },
  referenslar: {
    file: 'memory/referenslar.md',
    note: 'Referens reellardan olingan saboqlar (R-raqamlar). Har video kamida bitta R ga tayanadi.',
  },
  tekshiruv: {
    file: 'memory/tekshiruv.md',
    note: 'Yuborishdan OLDINGI ro\'yxat. Hammasi "ha" bo\'lmasa qayta yasaladi.',
  },
  jurnal: {
    file: 'memory/jurnal.md',
    note: 'Oldingi videolar: layout, hook, musiqa. Takrorlamaslik uchun.',
    tail: 14,
  },
  plan_log: {
    file: 'data/plan_log.md',
    note: 'Kunlik qarorlar va sabablari.',
    tail: 8,
  },
  metrics: {
    file: 'data/metrics.md',
    note: 'Instagram statistikasi — qaysi post ishlagan.',
  },
  mavzular: {
    file: 'MAVZULAR.md',
    note: 'Mavzu g\'oyalari banki va "Sardor fikri" bo\'limi. Majburiy emas, maslahat.',
  },
};

export function contentMemoryTopics(): { topic: string; note: string; bor: boolean }[] {
  return Object.entries(SOURCES).map(([topic, s]) => ({
    topic,
    note: s.note,
    bor: existsSync(join(H, s.file)),
  }));
}

export function contentMemory(topic: string): string {
  const src = SOURCES[topic];
  if (!src) {
    throw new Error(`noma'lum: ${topic}. Mavjudlari: ${Object.keys(SOURCES).join(', ')}`);
  }
  const path = join(H, src.file);
  if (!existsSync(path)) return `(${src.file} topilmadi)`;

  let text = readFileSync(path, 'utf8');
  if (src.tail) {
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length > src.tail) {
      const head = lines.filter((l) => l.startsWith('#') || l.startsWith('|--') || /^\| *sana/i.test(l));
      text = [...head, ...lines.slice(-src.tail)].join('\n');
    }
  }
  if (text.length > 24_000) text = text.slice(-24_000);
  return `# ${topic}\n> ${src.note}\n\n${text}`;
}
