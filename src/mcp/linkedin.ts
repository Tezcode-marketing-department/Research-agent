/**
 * LinkedIn/Google — Playwright o'zi boshqaradigan doimiy profil (persistent
 * context) orqali ishlaydi. Standing Chrome oynasi SHART EMAS: server shu
 * modul birinchi marta chaqirilganda profil papkasidan (cookie/sessiya shu
 * yerda saqlanadi) o'zi ochadi va butun process umri davomida ushlab turadi.
 *
 * Shartlar:
 *  - Login kerak bo'lsa (hali kirilmagan) — ko'rinadigan oyna avtomatik
 *    ochiladi, bir marta kiriladi, keyin ko'rinmas rejimga qaytiladi.
 *  - Shu profil papkasini BOSHQA Chrome jarayoni (masalan qo'lda ochilgan)
 *    bir vaqtda egallay olmaydi — SingletonLock xatosi beradi.
 *  - Yuborish funksiyasi YO'Q (type-draft bundan mustasno — u ham
 *    yubormaydi). Xabarni odam o'zi bosadi.
 */
import { mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

/** OS'ga qarab Chrome'ning odatiy o'rnatish yo'li — CHROME_BIN env bilan har doim bekor qilish mumkin. */
function defaultChromeBin(): string {
  if (platform() === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (platform() === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return 'google-chrome';
}

const CHROME_BIN = process.env.CHROME_BIN ?? defaultChromeBin();
const CHROME_PROFILE =
  process.env.LINKEDIN_PROFILE_DIR ??
  (platform() === 'win32'
    ? join(homedir(), '.chrome-linkedin')
    : join(homedir(), 'Desktop', 'Tezcode', 'Tezcode-Agents', '.chrome-linkedin'));
/** Soatiga nechta sahifa ochish mumkin — akkaunt xavfini cheklaydi. */
const HOURLY_LIMIT = Number(process.env.LINKEDIN_HOURLY_LIMIT ?? 25);

const loads: number[] = [];

function checkRate(): void {
  const hourAgo = Date.now() - 3_600_000;
  while (loads.length && loads[0] < hourAgo) loads.shift();
  if (loads.length >= HOURLY_LIMIT) {
    throw new Error(
      `Soatlik chegara (${HOURLY_LIMIT} sahifa) tugadi. LinkedIn tez harakatni avtomatlashtirish deb biladi — biroz kutish kerak.`,
    );
  }
  loads.push(Date.now());
}

let context: BrowserContext | null = null;
/** Hozirgi kontekst ko'rinadigan rejimda ochilganmi — login kerak bo'lganda belgilanadi. */
let contextHeaded = false;

async function launchContext(headed: boolean): Promise<BrowserContext> {
  mkdirSync(CHROME_PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(CHROME_PROFILE, {
    executablePath: CHROME_BIN,
    headless: !headed,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  contextHeaded = headed;
  return ctx;
}

/**
 * Doimiy kontekst — birinchi chaqiruvda o'zi ochiladi (sukut: ko'rinmas,
 * LINKEDIN_HEADED=1 bo'lsa ko'rinadigan), keyingi har bir qidiruv/sahifa
 * o'qishda QAYTA ISHLATILADI (har safar ochib-yopish shart emas).
 */
async function getContext(): Promise<BrowserContext> {
  if (context) return context;
  context = await launchContext(process.env.LINKEDIN_HEADED === '1');
  return context;
}

/** Ko'rinmas konteksni yopib, ko'rinadiganini ochadi (login uchun). */
async function relaunchHeaded(): Promise<void> {
  if (context) {
    await context.close().catch(() => undefined);
    context = null;
  }
  context = await launchContext(true);
}

/** Doimiy konteksdan sahifa oladi (yangi brauzer jarayoni ochmaydi). */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await getContext();
  const page = ctx.pages().find((p) => !p.isClosed()) ?? (await ctx.newPage());
  return fn(page);
}

async function ensureLoggedIn(page: Page): Promise<void> {
  const url = page.url();
  if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/uas/login')) {
    // Ko'rinmas rejimda edik — parol yozish uchun ko'rinadigan oyna kerak.
    if (!contextHeaded) {
      await relaunchHeaded();
      throw new Error(
        'LinkedIn\'ga kirilmagan. Ko\'rinadigan Chrome oynasi ochildi — bir marta kiring. ' +
          'Shundan keyin men ko\'rinmas rejimda ishlayman va sizga halaqit bermayman.',
      );
    }
    throw new Error(
      'LinkedIn\'ga hali kirilmagan. Ochiq oynada kiring — sessiya saqlanadi.',
    );
  }
}

export interface SearchHit {
  name: string;
  headline: string;
  profileUrl: string;
}

export async function linkedinSearch(query: string, limit = 10): Promise<SearchHit[]> {
  checkRate();
  return withPage(async (page) => {
    const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await ensureLoggedIn(page);
    // Natijalar lazy yuklanadi — profil havolasi paydo bo'lguncha kutamiz.
    try {
      await page.waitForSelector('a[href*="/in/"]', { timeout: 20_000 });
    } catch {
      throw new Error(
        'Qidiruv natijasi chiqmadi (20 s). Sabab: natija yo\'q, LinkedIn qidiruv ' +
          'chegarasi (bepul akkaunt oylik limiti) yoki sahifa sekin yuklandi.',
      );
    }
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1800);
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1500);

    // Brauzer ichida bajariladi — Node tomonida DOM tiplari yo'q, shuning uchun string.
    const hits = (await page.evaluate(`(() => {
      const out = [];
      const seen = new Set();
      for (const a of Array.from(document.querySelectorAll('a[href*="/in/"]'))) {
        const href = a.href.split('?')[0];
        if (!href.includes('/in/') || seen.has(href)) continue;
        const card = a.closest('li') || (a.parentElement && a.parentElement.parentElement);
        const text = ((card && card.textContent) || '').replace(/\\s+/g, ' ').trim();
        const name = (a.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!name || name.length > 80) continue;
        seen.add(href);
        out.push({ name: name, headline: text.slice(0, 300), profileUrl: href });
      }
      return out;
    })()`)) as SearchHit[];
    return hits.slice(0, limit);
  });
}

export async function linkedinProfile(profileUrl: string): Promise<string> {
  checkRate();
  if (!/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//.test(profileUrl)) {
    throw new Error('Faqat linkedin.com/in/... havolasi qabul qilinadi.');
  }
  return withPage(async (page) => {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await ensureLoggedIn(page);
    await page.waitForSelector('main', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1500);
    const text = (await page.evaluate(`(() => {
      const main = document.querySelector('main') || document.body;
      return (main.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    })()`)) as string;
    return text.slice(0, 8000);
  });
}

export interface CompanyHit {
  name: string;
  info: string;
  companyUrl: string;
}

/**
 * LinkedIn kompaniya qidiruvi — Research Agentning asosiy nomzod manbai.
 * `query`ga joy nomi (masalan "Toshkent" yoki "Uzbekistan") qo'shib yuborish
 * tavsiya etiladi — LinkedIn'ning o'zida aniq geo-filtr qo'yish uchun UI
 * navigatsiyasi kerak, shu sabab bu yerda oddiy keyword orqali qilinadi.
 */
export async function linkedinCompanySearch(query: string, limit = 10): Promise<CompanyHit[]> {
  checkRate();
  return withPage(async (page) => {
    const url = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await ensureLoggedIn(page);
    try {
      await page.waitForSelector('a[href*="/company/"]', { timeout: 20_000 });
    } catch {
      throw new Error(
        'Kompaniya qidiruv natijasi chiqmadi (20 s). Sabab: natija yo\'q, LinkedIn qidiruv ' +
          'chegarasi (bepul akkaunt oylik limiti) yoki sahifa sekin yuklandi.',
      );
    }
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1800);
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1500);

    const hits = (await page.evaluate(`(() => {
      const out = [];
      const seen = new Set();
      for (const a of Array.from(document.querySelectorAll('a[href*="/company/"]'))) {
        const href = a.href.split('?')[0];
        if (!href.includes('/company/') || seen.has(href)) continue;
        const card = a.closest('li') || (a.parentElement && a.parentElement.parentElement);
        const text = ((card && card.textContent) || '').replace(/\\s+/g, ' ').trim();
        const name = (a.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!name || name.length > 100) continue;
        seen.add(href);
        out.push({ name: name, info: text.slice(0, 300), companyUrl: href });
      }
      return out;
    })()`)) as CompanyHit[];
    return hits.slice(0, limit);
  });
}

/** Kompaniya sahifasining "About" matnini o'qiydi — fakt va og'riq chiqarish uchun. */
export async function linkedinCompanyPage(companyUrl: string): Promise<string> {
  checkRate();
  if (!/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/company\//.test(companyUrl)) {
    throw new Error('Faqat linkedin.com/company/... havolasi qabul qilinadi.');
  }
  return withPage(async (page) => {
    const aboutUrl = companyUrl.replace(/\/?$/, '/').replace(/\/$/, '') + '/about/';
    await page.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await ensureLoggedIn(page);
    await page.waitForSelector('main', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1500);
    const text = (await page.evaluate(`(() => {
      const main = document.querySelector('main') || document.body;
      return (main.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    })()`)) as string;
    return text.slice(0, 8000);
  });
}

export interface GoogleHit {
  title: string;
  url: string;
}

/**
 * Google'da qidirish — ochiq Chrome oynasi orqali (DuckDuckGo o'rniga).
 * Haqiqiy brauzer + odamning shu oynadagi sessiyasi (agar Google'ga kirilgan
 * bo'lsa) captcha/anomaliya xavfini kamaytiradi.
 */
export async function googleSearch(query: string, limit = 10): Promise<GoogleHit[]> {
  checkRate();
  return withPage(async (page) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit * 2, 30)}&hl=uz`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Rozilik sahifasi (consent.google.com) chiqishi mumkin — "Hammasiga rozi" tugmasini bosamiz.
    if (page.url().includes('consent.google.com')) {
      const acceptBtn = page.locator('button:has-text("Accept all"), button:has-text("Hammasiga rozi"), button:has-text("Принять все")').first();
      if ((await acceptBtn.count()) > 0) {
        await acceptBtn.click().catch(() => undefined);
        await page.waitForTimeout(1500);
      }
    }

    if (/sorry\/index|captcha/i.test(page.url())) {
      throw new Error('Google botni aniqladi (captcha) — ochiq oynada bir marta qo\'lda tekshiruvdan o\'ting.');
    }

    await page.waitForSelector('#search', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(800);

    const hits = (await page.evaluate(`(() => {
      const out = [];
      const seen = new Set();
      const root = document.querySelector('#search') || document.body;
      for (const a of Array.from(root.querySelectorAll('a[href^="http"]'))) {
        const href = a.href;
        if (!href || seen.has(href)) continue;
        if (href.includes('google.com/') || href.includes('googleusercontent.com')) continue;
        const h3 = a.querySelector('h3');
        if (!h3) continue;
        const title = (h3.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!title) continue;
        seen.add(href);
        out.push({ title, url: href });
      }
      return out;
    })()`)) as GoogleHit[];
    return hits.slice(0, limit);
  });
}

export async function browserStatus(): Promise<string> {
  try {
    const wasOpen = context !== null;
    const ctx = await getContext();
    const pages = ctx.pages().filter((p) => !p.isClosed());
    const urls = pages.map((p) => p.url()).slice(0, 5);
    const hourAgo = Date.now() - 3_600_000;
    const used = loads.filter((t) => t >= hourAgo).length;
    return (
      `${wasOpen ? 'Brauzer allaqachon ochiq edi' : 'Brauzerni men ochdim'} (${contextHeaded ? 'ko\'rinadigan' : 'ko\'rinmas'}). ` +
      `Sahifalar: ${urls.join(', ') || 'yo\'q'}\nSoatlik sarf: ${used}/${HOURLY_LIMIT}`
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// ─────────────────────────── suhbat (B2B hunting) ───────────────────────────

/** Profil sahifasidan "Message" oynasini ochadi. */
async function openMessageBox(page: Page, profileUrl: string): Promise<void> {
  if (!page.url().startsWith(profileUrl)) {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await ensureLoggedIn(page);
    await page.waitForTimeout(2500);
  }
  const btn = page
    .locator('button:has-text("Message"), button:has-text("Xabar"), a:has-text("Message")')
    .first();
  if ((await btn.count()) === 0) {
    throw new Error(
      'Bu profilda "Message" tugmasi yo\'q — aloqada emassiz yoki u xabar qabul qilmaydi. ' +
        'Avval connect so\'rovi kerak bo\'lishi mumkin.',
    );
  }
  await btn.click();
  await page.waitForTimeout(2000);
}

function msgBox(page: Page) {
  return page.locator('div.msg-form__contenteditable, div[role="textbox"][contenteditable="true"]').first();
}

/** Suhbat tarixini o'qiydi — javob yozishdan oldin kontekst uchun. */
export async function linkedinThread(profileUrl: string): Promise<string> {
  checkRate();
  return withPage(async (page) => {
    await openMessageBox(page, profileUrl);
    const text = (await page.evaluate(`(() => {
      const list = document.querySelector('.msg-s-message-list-content')
        || document.querySelector('[class*="msg-s-message-list"]');
      if (!list) return '';
      return (list.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    })()`)) as string;
    return text ? text.slice(-6000) : '(suhbat bo\'sh — hali yozilmagan)';
  });
}

/**
 * Matnni xabar maydoniga YOZADI, lekin YUBORMAYDI.
 * Send tugmasini Sardor o'zi bosadi — shu sababdan LinkedIn buni odatiy
 * foydalanuvchi harakati deb ko'radi va akkaunt xavfi kamayadi.
 */
export async function linkedinTypeDraft(profileUrl: string, text: string): Promise<string> {
  checkRate();
  if (text.trim().length < 10) throw new Error('matn juda qisqa');
  if (text.length > 1800) throw new Error('matn juda uzun (1800 belgidan oshmasin)');
  // Oyna ko'rinmas bo'lsa odam tugmani bosa olmaydi — ko'rinadiganga o'tamiz.
  if (!contextHeaded) await relaunchHeaded();

  return withPage(async (page) => {
    await openMessageBox(page, profileUrl);
    const box = msgBox(page);
    if ((await box.count()) === 0) throw new Error('Xabar maydoni topilmadi.');
    await box.click();
    await page.waitForTimeout(400);
    await box.fill('');
    // Odam tezligida yozamiz — bir zarbda qo'yish bot belgisi.
    await box.type(text, { delay: 18 });
    await page.waitForTimeout(500);
    return (
      'Matn xabar maydoniga yozildi. YUBORILMADI — ochiq Chrome oynasida ' +
      'o\'qib ko\'ring va Send tugmasini o\'zingiz bosing.'
    );
  });
}
