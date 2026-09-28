/**
 * Reel bilimi — agent SKRIPT YOZMAYDI, faqat ssenariy/spec va rasm promptini yozadi.
 * Renderni Sardorning mavjud v3 quvuri (yig.py) bajaradi.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const V3 = join(HOME, 'hermes', 'v3');
const WORK = join(HOME, 'hermes', 'work');
const PUBLIC_DIR = join(HOME, 'Desktop', 'promo-reels', 'public');

const LOYIHALAR: Record<string, string> = {
  tezdetal: 'td', maxsavdo: 'ms', raos: 'rs', tezcode: 'tc',
};

/** Gemini promptining isbotlangan qoidalari (v3/ssenariy.py dan). */
const IMAGE_GUIDE = `
# Gemini rasm prompti — ishlaydigan qoidalar

1. AVVAL mavjud rasmni qidir. \`public_images\` bilan ro'yxatni ko'r.
   Kunlik kvota ~5 rasm — bitta videoga ko'pi bilan 2 ta yangi rasm.
2. Prompt INGLIZCHA yoziladi.
3. Har promptga qo'shiladi: "no text, no faces".
   Sabab: Gemini matnni buzib yozadi, yuz esa brend uslubiga tushmaydi.
4. Oxirida majburiy: "Generate a VERTICAL PORTRAIT image, 9:16 aspect ratio."
5. Sahna mazmuni ko'rinsin: AI/tizim aynan ISHLAYOTGANI (dashboard, agent oynasi,
   real ekran). Metafora, stol, choy, qo'l siltash — ma'nosiz kadr.
6. PhoneMockup uchun yangi rasm emas, faqat mavjud *_phone.png / *_sayt.png.
7. Bitta fotoni ikki rakursda ishlatish mumkin (P10): 1-sahna keng, 2-sahna zoom —
   yangi rasm kerak emas, kvota tejaladi.

## Namuna

"Modern analytics dashboard on a laptop screen showing rising sales charts,
clean office desk, soft daylight, shallow depth of field, no text, no faces.
Generate a VERTICAL PORTRAIT image, 9:16 aspect ratio."
`.trim();

function readDoc(name: string): string {
  const p = join(V3, name);
  if (!existsSync(p)) throw new Error(`hujjat topilmadi: ${p}`);
  return readFileSync(p, 'utf8');
}

export function reelKnowledge(topic: 'spec' | 'layouts' | 'image_prompt', search?: string): string {
  if (topic === 'image_prompt') return IMAGE_GUIDE;
  if (topic === 'spec') return readDoc('SPEC.md');

  const doc = readDoc('LAYOUTS.md');
  if (!search) {
    // To'liq katalog juda katta — sarlavhalar ro'yxatini beramiz.
    const heads = doc.split('\n').filter((l) => /^#{1,3}\s|^- \*\*|^\| /.test(l));
    return (
      'LAYOUTS.md katta. Quyida qisqa ko\'rinish; aniq layout kerak bo\'lsa ' +
      'search bilan qayta chaqir (masalan search: "PhoneMockup").\n\n' +
      heads.slice(0, 120).join('\n')
    );
  }
  const lines = doc.split('\n');
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(search.toLowerCase())) {
      out.push(...lines.slice(Math.max(0, i - 2), i + 14), '---');
    }
  });
  if (!out.length) return `"${search}" bo'yicha hech narsa topilmadi.`;
  return out.slice(0, 200).join('\n');
}

export function publicImages(prefix?: string): string[] {
  if (!existsSync(PUBLIC_DIR)) return [];
  const all = readdirSync(PUBLIC_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const p = prefix ? (LOYIHALAR[prefix.toLowerCase()] ?? prefix) : null;
  return (p ? all.filter((f) => f.toLowerCase().startsWith(p.toLowerCase())) : all).sort();
}

/** Spec'ni ish papkasiga yozadi va yo'lini qaytaradi (render alohida chaqiriladi). */
export function specSave(project: string, spec: unknown): string {
  const key = project.toLowerCase();
  if (!(key in LOYIHALAR)) {
    throw new Error(`noma'lum loyiha: ${project} (${Object.keys(LOYIHALAR).join(', ')})`);
  }
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    throw new Error('spec JSON obyekt bo\'lishi kerak');
  }
  const date = new Date().toISOString().slice(0, 10);
  const dir = join(WORK, date, key);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'spec.json');
  writeFileSync(path, JSON.stringify(spec, null, 2), 'utf8');
  return path;
}
