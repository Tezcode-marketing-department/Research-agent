import { isIP } from 'node:net';
import { googleSearch, linkedinCompanyPage, linkedinProfile } from '../mcp/linkedin';

export interface ResearchSource {
  title: string;
  url: string;
  content: string;
}

interface SearchResult {
  title: string;
  url: string;
}

const MAX_RESULTS = 12;
const MAX_PAGE_CHARS = 8_000;
const MAX_REDIRECTS = 4;

/**
 * Har vazifada qidiriladigan maqsadli manbalar (Google `site:` orqali).
 * `hh.uz` — Hermes Sales agentining haqiqiy tajribasida tasdiqlangan ENG
 * KUCHLI dalil manbai (vakansiya + maosh = ochiq, tekshirsa bo'ladigan og'riq).
 * `linkedin.com` — endi ASOSIY qidiruv emas (LinkedIn'ning o'z qidiruvi bepul
 * akkauntda tez-tez bo'sh natija qaytaradi), lekin shu yerda topilgan
 * linkedin.com havolalari baribir Chrome orqali o'qiladi (`fetchAnyPage`) —
 * kim ekanini tasdiqlash/boyitish uchun foydali.
 */
export const TARGET_SITES = [
  'uzithub.uz',
  'dowork.uz',
  'giglancer.uz',
  'worklance.uz',
  'freelancer.mehnat.uz',
  'kwork.ru',
  'freelance.habr.com',
  'hh.uz',
  'linkedin.com',
] as const;

const MAX_SITE_RESULTS = 3;
/** LLM promptiga uzatiladigan manbalar chegarasi — xarajat va vaqtni nazorat qilish uchun. */
const MAX_TOTAL_SOURCES = 24;

function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) return false;

  const version = isIP(host);
  if (version === 4) {
    const octets = host.split('.').map(Number);
    const [first, second] = octets;
    return !(
      first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 && (second === 18 || second === 19))
    );
  }
  if (version === 6) {
    if (host.startsWith('::ffff:')) {
      const mapped = host.slice(7);
      if (isIP(mapped) === 4) return isPublicHost(mapped);
      const groups = mapped.split(':');
      if (groups.length === 2 && groups.every((part) => /^[\da-f]{1,4}$/i.test(part))) {
        const high = Number.parseInt(groups[0], 16);
        const low = Number.parseInt(groups[1], 16);
        return isPublicHost(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
      }
      return false;
    }
    return host !== '::' && host !== '::1' && !host.startsWith('fc') && !host.startsWith('fd') && !/^fe[89ab]/.test(host);
  }
  return true;
}

function safeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!isPublicHost(url.hostname)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function decodeHtml(text: string): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: '—', ndash: '–',
  };
  return text
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name.toLowerCase()] ?? match);
}

function pageText(html: string): { title: string; content: string } {
  const title = decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const content = decodeHtml(
    html
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(header|footer|nav|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--([\s\S]*?)-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
  return { title, content: content.slice(0, MAX_PAGE_CHARS) };
}

/** Bir necha qidiruvdan kelgan natijalarni URL bo'yicha takrorsiz birlashtiradi, umumiy chegaraga qadar. */
function mergeUnique(lists: SearchResult[][], maxTotal: number = Infinity): SearchResult[] {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (merged.length >= maxTotal) return merged;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }
  }
  return merged;
}

async function fetchPublicPage(rawUrl: string): Promise<{ url: string; title: string; content: string } | null> {
  let url = safeUrl(rawUrl);
  if (!url) return null;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'user-agent': 'TezcodeResearch/1.0 (+https://tezcode.dev)', accept: 'text/html,application/xhtml+xml,text/plain' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === MAX_REDIRECTS) return null;
      url = safeUrl(new URL(location, url).toString());
      if (!url) return null;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(type)) {
      await response.body?.cancel();
      return null;
    }
    const html = await readLimitedText(response, 2_000_000);
    const parsed = pageText(html);
    if (parsed.content.length < 160) return null;
    return { url: url.toString(), title: parsed.title || url.hostname, content: parsed.content };
  }
  return null;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const remaining = maxBytes - size;
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    chunks.push(decoder.decode(chunk, { stream: true }));
    size += chunk.byteLength;
    if (chunk.byteLength < value.byteLength) {
      await reader.cancel();
      break;
    }
  }
  if (size >= maxBytes) await reader.cancel();
  chunks.push(decoder.decode());
  return chunks.join('');
}

const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX;

/**
 * Google Custom Search JSON API — captcha yo'q, lekin sozlash (API kalit +
 * Programmable Search Engine) va kunlik kvota (bepul tarif: 100 so'rov/kun)
 * kerak. `num` API'da ko'pi bilan 10 bo'ladi.
 */
async function googleApiSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', GOOGLE_API_KEY!);
  url.searchParams.set('cx', GOOGLE_CX!);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(maxResults, 10)));
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google API HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  const data = (await response.json()) as { items?: { title: string; link: string }[] };
  return (data.items ?? []).map((item) => ({ title: item.title, url: item.link }));
}

/**
 * GOOGLE_SEARCH_API_KEY/GOOGLE_SEARCH_CX sozlangan bo'lsa haqiqiy API
 * ishlatiladi (ishonchli, captcha yo'q). Sozlanmagan bo'lsa ochiq Chrome
 * oynasi orqali qidiradi (zahira — captcha xavfi bor, lekin kalit shart
 * emas). Ikkalasi ham xato bo'lsa chaqiruvchi bo'sh ro'yxat bilan davom etadi.
 */
async function runGoogleSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  if (GOOGLE_API_KEY && GOOGLE_CX) {
    return googleApiSearch(query, maxResults);
  }
  const hits = await googleSearch(query, maxResults);
  return hits.map((hit) => ({ title: hit.title, url: hit.url }));
}

/** Bitta manbaning (Google so'rovi yoki sayt) natijasi — operatorga "chindan qidirdimi" isboti sifatida ko'rsatiladi. */
export interface SiteSearchStat {
  /** Manba nomi: 'linkedin', 'google', yoki bitta TARGET_SITES domeni. */
  site: string;
  resultCount: number;
  /** Chrome/LinkedIn/Google bu so'rovda xato qaytardi (bloklandi, login kerak, captcha). */
  blocked: boolean;
  /** Oldingi so'rov bloklangani uchun bu manba umuman so'ralmadi. */
  skipped: boolean;
  /** O'zbekistonga tegishli emas deb topilib tashlangan natijalar (faqat Google umumiy qidiruvi). */
  filteredOut?: number;
}

export interface SearchLookupResult {
  results: SearchResult[];
  stats: SiteSearchStat[];
}

/**
 * O'zbekistonga tegishli emas bo'lishi ehtimoli yuqori milliy domenlar
 * (.de, .co.uk, .ru, .kz ...). Faqat shu ro'yxatdagi chekkalari tekshiriladi —
 * xalqaro platformalar (.com/.org/.uz, linkedin, instagram, t.me) saqlanadi,
 * chunki o'zbek bizneslari ko'p shu yerda turadi.
 */
const FOREIGN_CCTLD_SUFFIXES = [
  // Yevropa va sobiq ittifoq
  '.uk', '.co.uk', '.org.uk', '.de', '.fr', '.it', '.es', '.nl', '.se', '.no', '.fi',
  '.pl', '.at', '.be', '.dk', '.cz', '.sk', '.hu', '.ro', '.gr', '.pt', '.ie', '.ch',
  '.ru', '.ua', '.by',
  // Amerika va Osiya
  '.us', '.ca', '.br', '.com.br', '.mx', '.com.mx', '.in', '.co.in', '.jp', '.co.jp',
  '.cn', '.com.cn', '.kr', '.co.kr', '.tw', '.com.tw', '.hk', '.com.hk',
  '.sg', '.com.sg', '.my', '.th', '.vn', '.ph', '.id',
  // Yaqin va O'rta Sharq
  '.il', '.ae', '.sa', '.tr', '.com.tr', '.pk',
  // Markaziy Osiyo — o'zbek bo'lmagan domenlar
  '.kz', '.kg', '.az', '.ge', '.am', '.tj', '.tm',
];

/** O'zbekistonga tegishli deb hisoblangan (yoki TARGET_SITE/LinkedIn) manba URL'i. */
export function isUzbekRelevantUrl(rawUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  // Frilanser platformalari, hh.uz va LinkedIn ataylab so'raladi — filtr tegmaydi.
  if (TARGET_SITES.some((site) => hostname === site || hostname.endsWith(`.${site}`))) return true;
  if (hostname.endsWith('.uz')) return true;
  return !FOREIGN_CCTLD_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isLinkedinUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

/**
 * Har bir kengaytirilgan so'rov ("queries") uchun Google qidiruvi (API yoki
 * Chrome zahira) — asosiy manba. Faqat BIRINCHI (eng markaziy) so'rov uchun
 * qo'shimcha ravishda maqsadli manbalar (`TARGET_SITES`: frilanser
 * platformalari, hh.uz, linkedin.com) Google `site:` operatori bilan alohida
 * so'raladi. Bitta manba ishlamasa (bloklangan, bo'sh natija) faqat o'shasi
 * o'tkazib yuboriladi, butun ov to'xtamaydi.
 */
/** Chrome-zahira ishlatilganda ketma-ket navigatsiyalar orasida kichik tanaffus — bot izlarini kamaytiradi. API rejimida ham zarari yo'q. */
const NAV_DELAY_MS = 1_200;
const NAV_JITTER_MS = 600;
async function navDelay(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, NAV_DELAY_MS + Math.random() * NAV_JITTER_MS));
}

async function collectSearchResults(queries: string[]): Promise<SearchLookupResult> {
  const stats: SiteSearchStat[] = [];
  const googleResults: SearchResult[][] = [];

  for (const [index, q] of queries.entries()) {
    const label = queries.length > 1 ? `Google so'rov ${index + 1}` : 'google';
    if (index > 0) await navDelay();
    try {
      const found = await runGoogleSearch(q, MAX_RESULTS);
      const kept = found.filter((result) => isUzbekRelevantUrl(result.url));
      const filteredOut = found.length - kept.length;
      googleResults.push(kept);
      stats.push({
        site: label,
        resultCount: kept.length,
        blocked: false,
        skipped: false,
        ...(filteredOut ? { filteredOut } : {}),
      });
    } catch (err) {
      googleResults.push([]);
      stats.push({ site: label, resultCount: 0, blocked: true, skipped: false });
      void err;
    }
  }

  const primaryQuery = queries[0];
  const siteResults: SearchResult[][] = [];
  for (const site of TARGET_SITES) {
    await navDelay();
    try {
      const found = await runGoogleSearch(`site:${site} ${primaryQuery}`, MAX_SITE_RESULTS);
      siteResults.push(found);
      stats.push({ site, resultCount: found.length, blocked: false, skipped: false });
    } catch (err) {
      siteResults.push([]);
      stats.push({ site, resultCount: 0, blocked: true, skipped: false });
      void err;
    }
  }

  return {
    results: mergeUnique([...googleResults, ...siteResults], MAX_TOTAL_SOURCES),
    stats,
  };
}

export interface ResearchLookupResult {
  sources: ResearchSource[];
  stats: SiteSearchStat[];
}

/**
 * Barcha so'rovlar (LinkedIn + Google + saytlar) natija bermaganda ko'tariladi.
 * `stats`ni o'zi bilan olib yuradi — shu sabab chaqiruvchi (research.graph.ts)
 * buni bo'sh natija sifatida qabul qilib, baribir qaysi manba bloklangani/hech
 * narsa qaytarmaganini hisobotda ko'rsata oladi, "sabab noma'lum" xato
 * o'rniga.
 */
export class NoSearchResultsError extends Error {
  constructor(public readonly stats: SiteSearchStat[]) {
    super('Qidiruvdan ochiq natija olinmadi.');
  }
}

/**
 * LinkedIn manzilini (profil yoki kompaniya) Chrome orqali, boshqa har qanday
 * manzilni oddiy HTTP fetch orqali o'qiydi — Chrome faqat login talab
 * qiladigan sahifalar uchun ishlatiladi, boshqa saytlar uchun tezroq va
 * akkaunt budjetini tejaydigan yo'l.
 */
async function fetchAnyPage(result: SearchResult): Promise<{ url: string; title: string; content: string } | null> {
  if (isLinkedinUrl(result.url)) {
    try {
      const content = /\/in\//.test(result.url)
        ? await linkedinProfile(result.url)
        : await linkedinCompanyPage(result.url);
      if (!content || content.length < 100) return null;
      return { url: result.url, title: result.title, content: content.slice(0, MAX_PAGE_CHARS) };
    } catch {
      return null;
    }
  }
  return fetchPublicPage(result.url);
}

/** Web'dan manba topadi, sahifalarni oladi va faqat tekshiriladigan matnni qaytaradi. */
export async function lookupResearchSources(queries: string[]): Promise<ResearchLookupResult> {
  const cleanQueries = queries.map((q) => q.trim()).filter((q) => q.length >= 3);
  if (!cleanQueries.length) throw new Error('Izlanish savoli kamida 3 ta belgidan iborat bo‘lsin.');

  const { results, stats } = await collectSearchResults(cleanQueries);
  if (!results.length) throw new NoSearchResultsError(stats);

  const pages = await Promise.all(results.map(async (result) => ({
    result,
    page: await fetchAnyPage(result),
  })));

  const sources = pages
    .filter((item): item is { result: SearchResult; page: NonNullable<typeof item.page> } => item.page !== null)
    .map(({ result, page }) => ({
      title: page.title || result.title,
      url: page.url,
      content: page.content,
    }));

  return { sources, stats };
}

const CONTACT_LOOKUP_MAX_RESULTS = 3;

/**
 * Bitta nomzod uchun bog'lanish ma'lumotini alohida qidiradi — to'liq
 * `TARGET_SITES`/LinkedIn fanoutisiz, faqat bitta Google so'rovi. Yengil
 * funksiya sifatida ajratilgan — har nomzodda to'liq qidiruv yukini
 * ko'paytirmaslik uchun.
 */
export async function lookupContactPages(query: string): Promise<ResearchSource[]> {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 3) return [];

  let results: SearchResult[];
  try {
    results = (await runGoogleSearch(cleanQuery, CONTACT_LOOKUP_MAX_RESULTS))
      .filter((result) => isUzbekRelevantUrl(result.url));
  } catch {
    return [];
  }

  const pages = await Promise.all(results.map(async (result) => ({
    result,
    page: await fetchAnyPage(result),
  })));

  return pages
    .filter((item): item is { result: SearchResult; page: NonNullable<typeof item.page> } => item.page !== null)
    .map(({ result, page }) => ({
      title: page.title || result.title,
      url: page.url,
      content: page.content,
    }));
}

export const researchInternals = { isPublicHost, safeUrl, pageText, mergeUnique, isUzbekRelevantUrl };
