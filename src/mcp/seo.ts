/**
 * SEO / GEO / AEO — o'lchaydigan toollar.
 *
 * Prinsip: texnik tekshiruvni SKRIPT qiladi, model emas. Model faqat
 * natijani talqin qiladi va reja tuzadi. Shunda "menimcha bor" degan
 * javob bo'lmaydi — har band o'lchangan bo'ladi.
 */
import { withPage } from './linkedin.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/153.0 Safari/537.36';

export async function fetchText(url: string, timeoutMs = 20_000): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xml,text/plain,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: '' };
  }
}

export interface AuditResult {
  url: string;
  score: number;
  checks: Record<string, { ok: boolean; detail: string }>;
}

function origin(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

export async function seoAudit(url: string): Promise<AuditResult> {
  if (!/^https?:\/\//.test(url)) url = `https://${url}`;
  const root = origin(url);
  const checks: AuditResult['checks'] = {};

  const page = await fetchText(url);
  if (!page.ok) {
    checks.sahifa = { ok: false, detail: `ochilmadi (HTTP ${page.status})` };
    return { url, score: 0, checks };
  }
  const html = page.body;
  checks.sahifa = { ok: true, detail: `HTTP ${page.status}, ${Math.round(html.length / 1024)} KB` };

  // robots.txt — AI botlar ochiqmi
  const robots = await fetchText(`${root}/robots.txt`);
  if (!robots.ok) {
    checks.robots = { ok: false, detail: 'robots.txt yo\'q' };
  } else {
    const bots = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];
    const blocked = bots.filter((b) => {
      const re = new RegExp(`User-agent:\\s*${b}[\\s\\S]{0,200}?Disallow:\\s*/\\s*$`, 'im');
      return re.test(robots.body);
    });
    const hasSitemap = /sitemap:/i.test(robots.body);
    checks.robots = {
      ok: blocked.length === 0 && hasSitemap,
      detail:
        (blocked.length ? `bloklangan AI botlar: ${blocked.join(', ')}` : 'AI botlar ochiq') +
        (hasSitemap ? ', sitemap ko\'rsatilgan' : ', SITEMAP KO\'RSATILMAGAN'),
    };
  }

  // sitemap
  const sm = await fetchText(`${root}/sitemap.xml`);
  const urlCount = (sm.body.match(/<loc>/g) || []).length;
  checks.sitemap = sm.ok
    ? { ok: urlCount > 0, detail: `${urlCount} ta URL` }
    : { ok: false, detail: 'sitemap.xml yo\'q' };

  // llms.txt — GEO
  const llms = await fetchText(`${root}/llms.txt`);
  checks.llmsTxt = { ok: llms.ok, detail: llms.ok ? `bor (${llms.body.length} belgi)` : 'yo\'q' };

  // meta
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ?? '';
  const noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html);
  checks.title = { ok: title.length >= 20 && title.length <= 65, detail: `${title.length} belgi: ${title.slice(0, 70)}` };
  checks.description = { ok: desc.length >= 70 && desc.length <= 165, detail: desc ? `${desc.length} belgi` : 'yo\'q' };
  checks.indexable = { ok: !noindex, detail: noindex ? 'NOINDEX o\'rnatilgan' : 'indekslanadi' };

  // canonical + hreflang
  const canonical = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i.exec(html)?.[1] ?? '';
  const hreflangs = [...html.matchAll(/hreflang=["']([^"']+)["']/gi)].map((m) => m[1]);
  checks.canonical = { ok: !!canonical, detail: canonical || 'yo\'q' };
  checks.hreflang = {
    ok: hreflangs.length > 0 && hreflangs.includes('x-default'),
    detail: hreflangs.length ? hreflangs.join(', ') : 'yo\'q',
  };

  // JSON-LD schema turlari
  const ldBlocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  const types = new Set<string>();
  for (const b of ldBlocks) {
    for (const m of b[1].matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(m[1]);
  }
  const wanted = ['Organization', 'FAQPage', 'BreadcrumbList'];
  const missing = wanted.filter((w) => !types.has(w));
  checks.jsonLd = {
    ok: ldBlocks.length > 0 && missing.length === 0,
    detail: types.size ? `bor: ${[...types].join(', ')}${missing.length ? ` | yetishmaydi: ${missing.join(', ')}` : ''}` : 'JSON-LD yo\'q',
  };

  // AEO — savol shaklidagi sarlavha va qisqa javob
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
  const questions = h2s.filter((h) => /\?|qanday|nima|qancha|nega|как|что|сколько/i.test(h));
  checks.aeo = {
    ok: questions.length >= 2,
    detail: `${h2s.length} ta H2, shundan ${questions.length} tasi savol shaklida`,
  };

  // H1 — bitta bo'lishi kerak
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  );
  checks.h1 = {
    ok: h1s.length === 1,
    detail: h1s.length === 0 ? 'H1 yo\'q' : h1s.length === 1 ? h1s[0].slice(0, 80) : `${h1s.length} ta H1 (bitta bo'lsin)`,
  };

  // Sahifa tili URL yo'lidagi lokalga mos kelyaptimi
  const htmlLang = /<html[^>]+lang=["']([^"']+)/i.exec(html)?.[1]?.toLowerCase() ?? '';
  const pathLocale = /^\/([a-z]{2})(\/|$)/.exec(new URL(url).pathname)?.[1] ?? '';
  checks.lang = {
    ok: !!htmlLang && (!pathLocale || htmlLang.startsWith(pathLocale)),
    detail: htmlLang
      ? `html lang="${htmlLang}"${pathLocale ? `, URL lokali "${pathLocale}"` : ''}` +
        (pathLocale && !htmlLang.startsWith(pathLocale) ? ' — MOS EMAS' : '')
      : 'html lang ko\'rsatilmagan',
  };

  // Matn hajmi — yupqa sahifa reyting olmaydi
  const textLen = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
  const words = Math.round(textLen / 6);
  checks.hajm = { ok: words >= 300, detail: `~${words} so'z` };

  const vals = Object.values(checks);
  const score = Math.round((vals.filter((c) => c.ok).length / vals.length) * 100);
  return { url, score, checks };
}

// ───────────────────────── pozitsiya va raqobatchilar ─────────────────────────

const rankLoads: number[] = [];
const RANK_DAILY_LIMIT = Number(process.env.SEO_RANK_DAILY_LIMIT ?? 30);

function checkRankRate(): void {
  const dayAgo = Date.now() - 86_400_000;
  while (rankLoads.length && rankLoads[0] < dayAgo) rankLoads.shift();
  if (rankLoads.length >= RANK_DAILY_LIMIT) {
    throw new Error(
      `Kunlik chegara (${RANK_DAILY_LIMIT} tekshiruv) tugadi. Google tez so'rovlarni bloklaydi.`,
    );
  }
  rankLoads.push(Date.now());
}

export interface SerpItem {
  position: number;
  title: string;
  url: string;
}

/** Google natijalarini Sardorning brauzeri orqali o'qiydi. Kam hajmda. */
export async function serpTop(query: string, limit = 10): Promise<SerpItem[]> {
  checkRankRate();
  return withPage(async (page) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20&hl=uz`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);
    const body = (await page.evaluate(`document.body.innerText.slice(0, 500)`)) as string;
    if (/unusual traffic|not a robot|обычного трафика/i.test(body)) {
      throw new Error('Google captcha so\'radi — biroz kutish kerak yoki qo\'lda tekshiring.');
    }
    const items = (await page.evaluate(`(() => {
      const out = [];
      const seen = new Set();
      for (const h of Array.from(document.querySelectorAll('a h3'))) {
        const a = h.closest('a');
        if (!a) continue;
        const href = a.href;
        if (!href || !href.startsWith('http') || href.includes('google.com')) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        out.push({ position: out.length + 1, title: (h.textContent||'').trim(), url: href });
      }
      return out;
    })()`)) as SerpItem[];
    return items.slice(0, limit);
  });
}

export async function rankOf(query: string, domain: string): Promise<{ position: number | null; url: string | null; top: SerpItem[] }> {
  const top = await serpTop(query, 20);
  const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const hit = top.find((i) => i.url.replace(/^https?:\/\//, '').replace(/^www\./, '').startsWith(clean));
  return { position: hit ? hit.position : null, url: hit ? hit.url : null, top: top.slice(0, 10) };
}
