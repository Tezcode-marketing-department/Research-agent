/**
 * Sayt bo'ylab yurish (crawl) va qidiruv so'rovlarini aniqlash.
 *
 * Nega kerak: agent "hohlagan sayt" bilan ishlashi kerak. Bir URL ni qo'lda
 * berish notanish sayt uchun ishlamaydi — avval sahifalarni topish kerak.
 * Va optimizatsiya qilish uchun MAQSAD kerak: qaysi so'rov bo'yicha top'ga
 * chiqamiz. Ikkalasi ham shu yerda.
 *
 * Prinsip o'zgarmaydi: skript o'lchaydi, model talqin qiladi. Bu modul
 * so'rovlarni O'ZI bazaga yozmaydi — nomzodlarni dalili bilan qaytaradi,
 * qaysi biri haqiqiy mijoz so'rovi ekanini model hal qiladi.
 */
import { fetchText } from './seo.js';

const ASSET = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|xml|pdf|zip|mp4|mp3|woff2?|ttf|eot)(\?|$)/i;

export interface CrawledPage {
  url: string;
  status: number;
  title: string;
  description: string;
  h1: string;
  h2: string[];
  lang: string;
  words: number;
  noindex: boolean;
  text: string;
  source: 'sitemap' | 'havola';
}

function toOrigin(domain: string): string {
  const d = /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
  const u = new URL(d);
  return `${u.protocol}//${u.host}`;
}

/** www bilan/siz bir xil sayt. Buni hisobga olmaslik sitemap'ni butunlay yo'qotadi. */
function sameSite(a: string, b: string): boolean {
  try {
    const h = (u: string) => new URL(u).host.replace(/^www\./, '');
    return h(a) === h(b);
  } catch { return false; }
}

/**
 * Haqiqiy manzilni aniqlaydi: tezcode.dev → 301 → www.tezcode.dev.
 * Buni qilmasak sitemap ichidagi URL'lar "begona" deb tashlanadi.
 */
async function realOrigin(root: string): Promise<string> {
  try {
    const res = await fetch(root, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const u = new URL(res.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return root;
  }
}

function tag(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
}

/** &#x27; kabi kodlarni asl belgiga qaytaradi — aks holda "qo x27" degan axlat chiqadi. */
function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»',
    rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', middot: '·',
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

/**
 * HTML → ko'rinadigan matn. Blok teglar o'rniga "|" qo'yiladi: aks holda
 * qo'shni havolalar qo'shilib ketib, "ai chatbot ai video analitika" kabi
 * hech kim qidirmaydigan ibora paydo bo'ladi.
 */
function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/?(p|div|li|ul|ol|br|h[1-6]|section|article|nav|footer|header|td|tr|th|a|span|button|label|option)\b[^>]*>/gi, ' | ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s*\|\s*(\|\s*)+/g, ' | ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Kiril bo'lsa ru; o'zbekcha belgilar bo'lsa uz; aks holda en. */
export function detectLang(text: string, htmlLang?: string): string {
  if (htmlLang) {
    const l = htmlLang.toLowerCase();
    if (l.startsWith('ru')) return 'ru';
    if (l.startsWith('uz')) return 'uz';
    if (l.startsWith('en')) return 'en';
  }
  const sample = text.slice(0, 4000);
  const cyr = (sample.match(/[Ѐ-ӿ]/g) || []).length;
  if (cyr > sample.length * 0.15) return 'ru';
  if (/\b(va|uchun|bilan|bo['ʻ’]l|xizmat|haqida|qanday|narx)\w*/i.test(sample)) return 'uz';
  return 'en';
}

function parsePage(url: string, status: number, html: string, source: CrawledPage['source']): CrawledPage {
  const text = visibleText(html);
  const h2 = Array.from(html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi))
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20);
  const robotsMeta = tag(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)
    || tag(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']robots["']/i);
  return {
    url,
    status,
    title: tag(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: tag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
      || tag(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
    h1: tag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    h2,
    lang: detectLang(text, tag(html, /<html[^>]+lang=["']([^"']+)["']/i)),
    words: text.split(/\s+/).filter(Boolean).length,
    noindex: /noindex/i.test(robotsMeta),
    text: text.slice(0, 8000),
    source,
  };
}

/** sitemap.xml va robots.txt dagi sitemap'lardan URL yig'adi (ichma-ich indeks ham). */
async function fromSitemaps(root: string, limit: number): Promise<string[]> {
  const found = new Set<string>();
  const queue: string[] = [`${root}/sitemap.xml`];

  const robots = await fetchText(`${root}/robots.txt`);
  if (robots.ok) {
    for (const m of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1].trim());
  }

  const seenMaps = new Set<string>();
  while (queue.length && found.size < limit) {
    const sm = queue.shift() as string;
    if (seenMaps.has(sm) || seenMaps.size > 10) continue;
    seenMaps.add(sm);
    const r = await fetchText(sm);
    if (!r.ok) continue;
    const isIndex = /<sitemapindex/i.test(r.body);
    for (const m of r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const loc = m[1].trim();
      if (isIndex) queue.push(loc);
      else if (sameSite(loc, root) && !ASSET.test(loc)) found.add(loc.split('#')[0]);
      if (found.size >= limit) break;
    }
  }
  return Array.from(found);
}

/** Bir sahifadagi ichki havolalar. */
function linksOf(html: string, base: string, root: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) continue;
    let abs: string;
    try { abs = new URL(raw, base).toString(); } catch { continue; }
    if (!sameSite(abs, root) || ASSET.test(abs)) continue;
    out.add(abs.split('#')[0].replace(/\/$/, '') || root);
  }
  return Array.from(out);
}

export interface CrawlResult {
  root: string;
  pages: CrawledPage[];
  source: string;
  errors: { url: string; status: number }[];
}

/**
 * Sayt sahifalarini topadi. Avval sitemap, yetmasa ichki havolalar bo'ylab.
 * Bir vaqtda 4 ta so'rov — sayt yuklanib qolmasin.
 */
export async function siteCrawl(domain: string, limit = 40): Promise<CrawlResult> {
  const root = await realOrigin(toOrigin(domain));
  const errors: CrawlResult['errors'] = [];
  const pages: CrawledPage[] = [];
  const done = new Set<string>();

  const sitemapUrls = await fromSitemaps(root, limit);
  const source = sitemapUrls.length ? `sitemap (${sitemapUrls.length} URL)` : 'ichki havolalar';

  // Navbat: sitemap bo'lsa o'shandan, aks holda bosh sahifadan yuramiz.
  const queue: { url: string; from: CrawledPage['source'] }[] = sitemapUrls.length
    ? sitemapUrls.slice(0, limit).map((u) => ({ url: u, from: 'sitemap' as const }))
    : [{ url: root, from: 'havola' as const }];

  while (queue.length && pages.length < limit) {
    const batch = queue.splice(0, 6).filter((x) => !done.has(x.url));
    if (!batch.length) continue;
    batch.forEach((x) => done.add(x.url));

    const got = await Promise.all(batch.map(async (x) => ({ x, r: await fetchText(x.url) })));
    for (const { x, r } of got) {
      if (!r.ok || !r.body) { errors.push({ url: x.url, status: r.status }); continue; }
      const p = parsePage(x.url, r.status, r.body, x.from);
      pages.push(p);
      // sitemap yo'q bo'lsa — havolalar bo'ylab davom etamiz
      if (!sitemapUrls.length) {
        for (const l of linksOf(r.body, x.url, root)) {
          if (!done.has(l) && queue.length + pages.length < limit * 2) {
            queue.push({ url: l, from: 'havola' });
          }
        }
      }
    }
  }
  return { root, pages, source, errors };
}

// ───────────────────────── so'rov nomzodlarini aniqlash ─────────────────────────

const STOP: Record<string, Set<string>> = {
  uz: new Set('va ham bu shu u biz siz ular uchun bilan bo lgan bo lish bo ladi kerak eng juda har bir ikki qanday qachon qayerda nima kim yoki lekin ammo agar chunki keyin oldin hamda hech faqat yana o z o zi ushbu mana ana deb degan sizning bizning ularning yer yerda edi emas bor yo q ko p oz kabi singari haqida orqali tomonidan ustida ichida tashqari doim hozir bugun endi barcha barchasi qilish qiladi qilib bering berish olish olib ko rish ko rib'
    .split(' ')),
  ru: new Set('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам сказал ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее кажется сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это наш ваш'
    .split(' ')),
  en: new Set('the a an and or but if then than that this these those is are was were be been being of in on at to for with by from as it its we you they he she i our your their not no yes can will would should could may might do does did have has had more most very all any each other some such only own same so too s t don now about into over under again further here there when where why how what which who whom'
    .split(' ')),
};

const ALL_STOP = new Set<string>([...STOP.uz, ...STOP.ru, ...STOP.en]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’ʻʼ`]/g, "'")
    .split(/[^a-zЀ-ӿ0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));
}

export interface QueryCandidate {
  phrase: string;
  words: number;
  locale: string;
  score: number;
  /** nechta sahifada uchradi */
  pages: number;
  /** eng kuchli joyi: sarlavha | h1 | h2 | matn */
  strongest: string;
  example: string;
}

interface Src { text: string; weight: number; where: string; url: string; lang: string }

/**
 * Sahifalardan 2-4 so'zli iboralarni chiqaradi va vaznlaydi.
 * Sarlavha va H1 dagi ibora matn ichidagidan ancha og'irroq — sayt nimani
 * targ'ib qilayotgani o'sha yerda ko'rinadi.
 */
export function discoverQueries(pages: CrawledPage[], limit = 25): QueryCandidate[] {
  const live = pages.filter((p) => !p.noindex && p.status === 200);
  if (!live.length) return [];

  const srcs: Src[] = [];
  for (const p of live) {
    if (p.title) srcs.push({ text: p.title, weight: 6, where: 'sarlavha', url: p.url, lang: p.lang });
    if (p.h1) srcs.push({ text: p.h1, weight: 5, where: 'h1', url: p.url, lang: p.lang });
    for (const h of p.h2) srcs.push({ text: h, weight: 3, where: 'h2', url: p.url, lang: p.lang });
    if (p.description) srcs.push({ text: p.description, weight: 2, where: 'description', url: p.url, lang: p.lang });
    if (p.text) srcs.push({ text: p.text, weight: 1, where: 'matn', url: p.url, lang: p.lang });
  }

  interface Acc {
    strong: number;   // sarlavha/h1/h2/description vazni
    body: number;     // matn vazni
    pages: Set<string>;
    inTitleOrH1: boolean;
    best: number;
    where: string;
    lang: Map<string, number>;
    example: string;
  }
  const acc = new Map<string, Acc>();

  for (const s of srcs) {
    // Har segment alohida: "|", nuqta, vergul iboraning chegarasi.
    for (const seg of s.text.split(/[|•·.!?;:,()[\]{}"\u2013\u2014\n]+/)) {
      const words = tokenize(seg);
      for (let n = 2; n <= 4; n += 1) {
        for (let i = 0; i + n <= words.length; i += 1) {
          const gram = words.slice(i, i + n);
          if (ALL_STOP.has(gram[0]) || ALL_STOP.has(gram[gram.length - 1])) continue;
          if (gram.every((w) => ALL_STOP.has(w))) continue;
          const phrase = gram.join(' ');
          if (phrase.length < 6 || phrase.length > 60) continue;

          const cur = acc.get(phrase) ?? {
            strong: 0, body: 0, pages: new Set<string>(), inTitleOrH1: false,
            best: 0, where: s.where, lang: new Map<string, number>(), example: seg.trim().slice(0, 90),
          };
          // Uzunroq ibora aniqroq maqsad — biroz ustunlik
          const w = s.weight * (1 + (n - 2) * 0.35);
          if (s.where === 'matn') cur.body += w; else cur.strong += w;
          if (s.where === 'sarlavha' || s.where === 'h1') cur.inTitleOrH1 = true;
          cur.pages.add(s.url);
          if (s.weight > cur.best) { cur.best = s.weight; cur.where = s.where; cur.example = seg.trim().slice(0, 90); }
          cur.lang.set(s.lang, (cur.lang.get(s.lang) ?? 0) + 1);
          acc.set(phrase, cur);
        }
      }
    }
  }

  const total = live.length;
  const out: QueryCandidate[] = [];
  for (const [phrase, v] of acc) {
    // Deyarli har sahifada, lekin hech bir sarlavha/H1 da yo'q — bu menyu yoki
    // futer matni. Sayt nimani targ'ib qilayotganini emas, shablonni ko'rsatadi.
    const everywhere = total >= 5 && v.pages.size / total > 0.7;
    if (everywhere && !v.inTitleOrH1) continue;

    // Har sahifada takrorlanadigan H2 ("Savol va javoblar", "Narx nimaga bog'liq")
    // shablon sarlavhasi — mavzuni emas, dizaynni bildiradi. Sarlavha yoki H1 da
    // uchramasa, takrorlanish ballni oshirmasligi kerak.
    const templatePenalty = !v.inTitleOrH1 && v.pages.size > 3
      ? Math.sqrt(v.pages.size / 3)
      : 1;
    // Matndagi takror futer tufayli cheksiz o'smasin — chegaralanadi.
    const score = (v.strong / templatePenalty) * 3 + Math.min(v.body, 25);
    if (score < 12) continue;

    const locale = [...v.lang.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'uz';
    out.push({
      phrase,
      words: phrase.split(' ').length,
      locale,
      score: Math.round(score * 10) / 10,
      pages: v.pages.size,
      strongest: v.where,
      example: v.example,
    });
  }

  out.sort((a, b) => b.score - a.score);

  // Bir xil ma'noli qisqa/uzun juftlikdan bittasi yetadi ("pos tizimi" ⊂ "pos tizimi narxi").
  const kept: QueryCandidate[] = [];
  for (const c of out) {
    const dup = kept.find(
      (k) => (k.phrase.includes(c.phrase) || c.phrase.includes(k.phrase)) && k.score >= c.score * 1.6,
    );
    if (!dup) kept.push(c);
    if (kept.length >= limit) break;
  }
  return kept;
}
