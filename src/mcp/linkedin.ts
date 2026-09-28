/**
 * LinkedIn — Sardor ochgan Chrome oynasiga ULANADI, o'zi brauzer ochmaydi.
 *
 * Shartlar:
 *  - Oynani Sardor `scripts/chrome-linkedin.sh` bilan ochadi va LinkedIn'ga
 *    o'zi kiradi. Bizda parol ham, cookie ham yo'q.
 *  - Oyna yopilsa — agentning kirishi tugaydi.
 *  - Yuborish funksiyasi YO'Q. Faqat o'qish. Xabarni Sardor o'zi bosadi.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

const CDP_PORT = Number(process.env.LINKEDIN_CDP_PORT ?? 9222);
const CDP_URL = process.env.LINKEDIN_CDP_URL ?? `http://127.0.0.1:${CDP_PORT}`;
const CHROME_BIN =
  process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PROFILE =
  process.env.LINKEDIN_PROFILE_DIR ??
  join(homedir(), 'Desktop', 'Tezcode', 'Tezcode-Agents', '.chrome-linkedin');
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

async function cdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Oxirgi marta qanday rejimda ochganimiz — login kerak bo'lsa qayta ochish uchun. */
let launchedHeaded = false;
let launchedPid: number | null = null;

/**
 * Chrome ochiq bo'lmasa — O'ZI ochadi. Sardordan skript so'ramaydi.
 *
 * Sukut bo'yicha KO'RINMAS (headless): oyna chiqmaydi, fokus o'g'irlanmaydi,
 * Sardor ishlayveradi. Faqat LinkedIn'ga kirish kerak bo'lganda ko'rinadigan
 * oyna ochiladi — chunki parolni faqat Sardor yozadi.
 */
async function launchChrome(headed: boolean): Promise<void> {
  if (!existsSync(CHROME_BIN)) throw new Error(`Chrome topilmadi: ${CHROME_BIN}`);
  mkdirSync(CHROME_PROFILE, { recursive: true });
  const args = [
    `--user-data-dir=${CHROME_PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (!headed) args.push('--headless=new');
  args.push('https://www.linkedin.com/feed/');

  const child = spawn(CHROME_BIN, args, { detached: true, stdio: 'ignore' });
  child.unref();
  launchedHeaded = headed;
  launchedPid = child.pid ?? null;

  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive()) return;
  }
  throw new Error('Chrome ochildi, lekin debug porti javob bermadi.');
}

/** Ko'rinmas nusxani yopib, ko'rinadiganini ochadi (login uchun). */
async function relaunchHeaded(): Promise<void> {
  if (launchedPid) {
    try {
      process.kill(launchedPid, 'SIGTERM');
    } catch {
      /* allaqachon yopilgan */
    }
    launchedPid = null;
  }
  for (let i = 0; i < 20 && (await cdpAlive()); i += 1) {
    await new Promise((r) => setTimeout(r, 300));
  }
  await launchChrome(true);
}

async function connect(): Promise<Browser> {
  // Sukut — ko'rinmas. LINKEDIN_HEADED=1 bo'lsa ko'rinadigan oyna.
  if (!(await cdpAlive())) await launchChrome(process.env.LINKEDIN_HEADED === '1');
  try {
    return await chromium.connectOverCDP(CDP_URL, { timeout: 8000 });
  } catch (err) {
    throw new Error(
      `Chrome'ga ulanib bo'lmadi: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Ochiq kontekstdan sahifa oladi (yangi brauzer ochmaydi). */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await connect();
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('Brauzer konteksti topilmadi — oynani qayta oching.');
    const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
    return await fn(page);
  } finally {
    // connectOverCDP: uzilish oynani YOPMAYDI, faqat ulanishni uzadi.
    await browser.close().catch(() => undefined);
  }
}

async function ensureLoggedIn(page: Page): Promise<void> {
  const url = page.url();
  if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/uas/login')) {
    // Ko'rinmas rejimda edik — parol yozish uchun ko'rinadigan oyna kerak.
    if (!launchedHeaded) {
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

export async function browserStatus(): Promise<string> {
  try {
    const wasOpen = await cdpAlive();
    const browser = await connect();
    const context = browser.contexts()[0];
    const pages = context ? context.pages().filter((p) => !p.isClosed()) : [];
    const urls = pages.map((p) => p.url()).slice(0, 5);
    await browser.close().catch(() => undefined);
    const hourAgo = Date.now() - 3_600_000;
    const used = loads.filter((t) => t >= hourAgo).length;
    return (
      `${wasOpen ? 'Oyna ochiq edi' : 'Oynani men ochdim'}. ` +
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
  // Oyna ko'rinmas bo'lsa Sardor tugmani bosa olmaydi — ko'rinadiganga o'tamiz.
  if (!launchedHeaded) await relaunchHeaded();

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
