import { isIP } from 'node:net';

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

/** Har vazifada qidiriladigan frilanser/ish topshiriq platformalari. */
export const TARGET_SITES = [
  'uzithub.uz',
  'dowork.uz',
  'giglancer.uz',
  'worklance.uz',
  'freelancer.mehnat.uz',
  'kwork.ru',
  'freelance.habr.com',
] as const;

const MAX_SITE_RESULTS = 3;
/** LLM promptiga uzatiladigan manbalar chegarasi — xarajat va vaqtni nazorat qilish uchun. */
const MAX_TOTAL_SOURCES = 24;
/** DuckDuckGo'ga ketma-ket so'rov yuborishda uni bloklatib qo'ymaslik uchun tanaffus (+jitter). */
const SITE_QUERY_DELAY_MS = 1_500;
const SITE_QUERY_JITTER_MS = 700;

/**
 * DuckDuckGo bot faolligini sezganda HTTP 202 bilan "anomaliya" sahifasini
 * qaytaradi — bu status muvaffaqiyatli hisoblanadi (`response.ok === true`),
 * shuning uchun oddiy HTTP-status tekshiruvi buni ushlamaydi va natija
 * "hech narsa topilmadi" deb noto'g'ri talqin qilinardi. Belgi 2026-09-29da
 * jonli tekshiruvda aniqlandi.
 */
function isBlockedHtml(html: string): boolean {
  return /anomaly|unusual traffic|captcha/i.test(html);
}

class DuckDuckGoBlockedError extends Error {}

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

function searchResults(html: string, baseUrl: string, maxResults: number = MAX_RESULTS): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  const anchors = /<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const href = /\bhref=["']([^"']+)["']/i.exec(match[1])?.[1];
    if (!href) continue;
    let url: URL | null;
    try {
      url = safeUrl(new URL(decodeHtml(href), baseUrl).toString());
    } catch {
      continue;
    }
    if (!url) continue;
    if (url.hostname.endsWith('duckduckgo.com') && url.pathname === '/l/') {
      const target = url.searchParams.get('uddg');
      url = target ? safeUrl(target) : null;
    }
    if (!url || seen.has(url.toString())) continue;
    seen.add(url.toString());
    const title = decodeHtml(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (title) results.push({ title, url: url.toString() });
    if (results.length >= maxResults) break;
  }
  return results;
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

async function runDuckDuckGoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const searchUrl = new URL('https://html.duckduckgo.com/html/');
  searchUrl.searchParams.set('q', query);
  let searchResponse: Response | undefined;
  let lastError: unknown;
  // Tarmoq uzilishi tez-tez vaqtinchalik bo'ladi — bir marta qayta urinish
  // butun ovni bekor qilishning oldini oladi.
  for (let attempt = 1; attempt <= 2 && !searchResponse; attempt += 1) {
    try {
      searchResponse = await fetch(searchUrl, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; TezcodeResearch/1.0; +https://tezcode.dev)', accept: 'text/html' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (!searchResponse) {
    const cause = lastError instanceof Error && lastError.cause ? ` (${String((lastError.cause as { code?: string; message?: string }).code ?? lastError.cause)})` : '';
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Web qidiruvi ishlamadi: ${message}${cause}`);
  }
  if (!searchResponse.ok) throw new Error(`Web qidiruvi HTTP ${searchResponse.status} qaytardi.`);
  const searchHtml = await readLimitedText(searchResponse, 2_000_000);
  if (isBlockedHtml(searchHtml)) {
    throw new DuckDuckGoBlockedError('DuckDuckGo so\'rovni vaqtincha cheklamoqda (anomaliya himoyasi) — birozdan keyin qayta urinib ko\'ring.');
  }
  return searchResults(searchHtml, searchUrl.toString(), maxResults);
}

/** Bitta manbaning (umumiy qidiruv yoki bitta `TARGET_SITES` domeni) qidiruv natijasi — operatorga "chindan qidirdimi" isboti sifatida ko'rsatiladi. */
export interface SiteSearchStat {
  /** Domen nomi, yoki umumiy DuckDuckGo qidiruvi uchun 'umumiy'. */
  site: string;
  resultCount: number;
  /** DuckDuckGo aynan shu so'rovda anomaliya sahifasini qaytardi. */
  blocked: boolean;
  /** Oldingi so'rov bloklangani uchun bu sayt umuman so'ralmadi. */
  skipped: boolean;
}

export interface SearchLookupResult {
  results: SearchResult[];
  stats: SiteSearchStat[];
}

/**
 * Har bir kengaytirilgan so'rov ("queries") uchun umumiy DuckDuckGo qidiruvi
 * ishga tushiriladi — operatorning tabiiy tildagi so'rovi o'rniga LLM tuzgan
 * bir necha qidiruv-do'st ibora orqali izlanadi. Faqat BIRINCHI (eng markaziy)
 * so'rov `TARGET_SITES` domenlarini `site:` operatori bilan alohida so'raydi —
 * har so'rov uchun to'liq 7 ta saytni qayta so'rash DuckDuckGo yukini
 * ko'paytirib yuborardi. Bitta so'rov/sayt ishlamasa (bloklangan, bo'sh
 * natija) faqat o'shasi o'tkazib yuboriladi, butun ov to'xtamaydi.
 * DuckDuckGo bloklaganini payqasak, qolgan hamma so'rovlarni (umumiy ham,
 * sayt ham) so'ramasdan o'tkazib yuboramiz — IP allaqachon cheklangan bo'lsa,
 * davom etish faqat bloklanish vaqtini uzaytiradi. Har bir so'rovning natijasi
 * `stats`da qayd etiladi — operator qaysi so'rov/sayt haqiqatan so'ralganini
 * va necha natija qaytarganini keyin hisobotda ko'ra oladi.
 */
async function collectSearchResults(queries: string[]): Promise<SearchLookupResult> {
  const stats: SiteSearchStat[] = [];
  const generalResults: SearchResult[][] = [];
  let blockedSoFar = false;

  for (const [index, q] of queries.entries()) {
    const label = queries.length > 1 ? `Umumiy so'rov ${index + 1}` : 'umumiy';
    if (blockedSoFar) {
      stats.push({ site: label, resultCount: 0, blocked: false, skipped: true });
      continue;
    }
    try {
      const found = await runDuckDuckGoSearch(q, MAX_RESULTS);
      generalResults.push(found);
      stats.push({ site: label, resultCount: found.length, blocked: false, skipped: false });
    } catch (err) {
      generalResults.push([]);
      const blocked = err instanceof DuckDuckGoBlockedError;
      stats.push({ site: label, resultCount: 0, blocked, skipped: false });
      if (blocked) blockedSoFar = true;
    }
    if (index < queries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SITE_QUERY_DELAY_MS + Math.random() * SITE_QUERY_JITTER_MS));
    }
  }

  const primaryQuery = queries[0];
  const siteResults: SearchResult[][] = [];
  for (const site of TARGET_SITES) {
    if (blockedSoFar) {
      stats.push({ site, resultCount: 0, blocked: false, skipped: true });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, SITE_QUERY_DELAY_MS + Math.random() * SITE_QUERY_JITTER_MS));
    try {
      const found = await runDuckDuckGoSearch(`site:${site} ${primaryQuery}`, MAX_SITE_RESULTS);
      siteResults.push(found);
      stats.push({ site, resultCount: found.length, blocked: false, skipped: false });
    } catch (err) {
      siteResults.push([]);
      const blocked = err instanceof DuckDuckGoBlockedError;
      stats.push({ site, resultCount: 0, blocked, skipped: false });
      if (blocked) blockedSoFar = true;
    }
  }

  return { results: mergeUnique([...generalResults, ...siteResults], MAX_TOTAL_SOURCES), stats };
}

export interface ResearchLookupResult {
  sources: ResearchSource[];
  stats: SiteSearchStat[];
}

/**
 * Barcha so'rovlar (umumiy + saytlar) natija bermaganda ko'tariladi. `stats`ni
 * o'zi bilan olib yuradi — shu sabab chaqiruvchi (research.graph.ts) buni
 * bo'sh natija sifatida qabul qilib, baribir qaysi sayt bloklangani/hech
 * narsa qaytarmaganini hisobotda ko'rsata oladi, "sabab noma'lum" xato
 * o'rniga.
 */
export class NoSearchResultsError extends Error {
  constructor(public readonly stats: SiteSearchStat[]) {
    super('Web qidiruvidan ochiq natija olinmadi.');
  }
}

/** Web'dan manba topadi, sahifalarni oladi va faqat tekshiriladigan matnni qaytaradi. */
export async function lookupResearchSources(queries: string[]): Promise<ResearchLookupResult> {
  const cleanQueries = queries.map((q) => q.trim()).filter((q) => q.length >= 3);
  if (!cleanQueries.length) throw new Error('Izlanish savoli kamida 3 ta belgidan iborat bo‘lsin.');

  const { results, stats } = await collectSearchResults(cleanQueries);
  if (!results.length) throw new NoSearchResultsError(stats);

  const pages = await Promise.all(results.map(async (result) => ({
    result,
    page: await fetchPublicPage(result.url),
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
 * `TARGET_SITES` fanoutisiz, faqat bitta umumiy so'rov. `lookupResearchSources`
 * har chaqiruvda 7 ta qo'shimcha sayt so'ramasin, shu sabab alohida, yengil
 * funksiya sifatida ajratildi.
 */
export async function lookupContactPages(query: string): Promise<ResearchSource[]> {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 3) return [];

  let results: SearchResult[];
  try {
    results = await runDuckDuckGoSearch(cleanQuery, CONTACT_LOOKUP_MAX_RESULTS);
  } catch {
    return [];
  }

  const pages = await Promise.all(results.map(async (result) => ({
    result,
    page: await fetchPublicPage(result.url),
  })));

  return pages
    .filter((item): item is { result: SearchResult; page: NonNullable<typeof item.page> } => item.page !== null)
    .map(({ result, page }) => ({
      title: page.title || result.title,
      url: page.url,
      content: page.content,
    }));
}

export const researchInternals = { isPublicHost, safeUrl, pageText, searchResults, mergeUnique, isBlockedHtml };
