/**
 * Kod bo'yicha SEO/GEO/AEO auditi.
 *
 * Nega kerak: `seo_audit` tayyor sahifani o'lchaydi — lekin SABAB kodda
 * bo'ladi. Qaysi route'da metadata yo'q, JSON-LD qayerda yozilgan, hreflang
 * qanday yig'iladi, sitemap qaysi sahifalarni tashlab ketyapti — buni faqat
 * manbadan ko'rish mumkin. Sayt hali chiqmagan bo'lsa ham ishlaydi.
 *
 * Bu modul FAQAT O'QIYDI. Hech narsa yozmaydi.
 */
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.vercel', '.turbo', 'coverage', '.venv', 'venv', '__pycache__']);

export type Framework = 'next-app' | 'next-pages' | 'nuxt' | 'vue' | 'react' | 'django' | 'noma\'lum';

export interface RepoSeoReport {
  repo: string;
  framework: Framework;
  routes: { path: string; file: string; hasMetadata: boolean; hasJsonLd: boolean }[];
  findings: { level: 'muhim' | 'o\'rta' | 'past'; what: string; where: string }[];
  facts: Record<string, string>;
}

function walk(root: string, maxFiles = 6000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop() as string;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      if (SKIP.has(e) || e.startsWith('.DS')) continue;
      const abs = join(dir, e);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) stack.push(abs);
      else out.push(abs);
    }
  }
  return out;
}

function read(p: string, max = 200_000): string {
  try { return readFileSync(p, 'utf8').slice(0, max); } catch { return ''; }
}

function frameworkOfPkg(pkg: string, files: string[], dir: string): Framework | null {
  if (/"next"\s*:/.test(pkg)) {
    const hasApp = files.some((f) => f.startsWith(dir) && /\/app\/(.*\/)?page\.(tsx?|jsx?)$/.test(f));
    return hasApp ? 'next-app' : 'next-pages';
  }
  if (/"nuxt"\s*:/.test(pkg)) return 'nuxt';
  if (/"vue"\s*:/.test(pkg)) return 'vue';
  if (/"react"\s*:/.test(pkg)) return 'react';
  return null;
}

/**
 * Monorepoda sayt ildizda emas — `apps/landing`, `apps/web` ichida bo'ladi.
 * Faqat ildizdagi package.json ga qarasak sellerTrend/ClinicaGo/WeWatch
 * "noma'lum" bo'lib qolardi va bitta ham route topilmasdi.
 */
function findApps(root: string, files: string[]): { dir: string; framework: Framework }[] {
  const pkgs = files
    .filter((f) => basename(f) === 'package.json')
    .sort((a, b) => a.length - b.length)
    .slice(0, 40);
  const out: { dir: string; framework: Framework }[] = [];
  for (const pkgFile of pkgs) {
    const dir = pkgFile.replace(/\/package\.json$/, '');
    const fw = frameworkOfPkg(read(pkgFile, 40_000), files, dir);
    if (!fw) continue;
    // Ichma-ich paketni ikki marta sanamaymiz, lekin ildiz "react" bo'lsa-yu
    // ichkarida "next-app" bo'lsa — ikkalasi ham kerak emas, ichkarisi muhim.
    out.push({ dir, framework: fw });
  }
  const nexts = out.filter((a) => a.framework.startsWith('next'));
  return nexts.length ? nexts : out.slice(0, 3);
}

function detectFramework(root: string, files: string[]): Framework {
  const apps = findApps(root, files);
  if (apps.length) return apps[0].framework;
  if (files.some((f) => f.endsWith('manage.py'))) return 'django';
  return 'noma\'lum';
}

/** app router: app/**\/page.tsx → URL yo'li. [slug] va (guruh) hisobga olinadi. */
function routeOf(root: string, file: string): string {
  let r = relative(root, file)
    .replace(/^.*?app\//, '')
    .replace(/\/page\.(tsx?|jsx?)$/, '')
    .replace(/\/route\.(tsx?|jsx?)$/, '')
    .split('/')
    .filter((seg) => !/^\(.*\)$/.test(seg))
    .join('/');
  if (r === 'page.tsx' || r === '') r = '/';
  return r.startsWith('/') ? r : `/${r}`;
}

export async function repoSeoScan(repo: string, root: string): Promise<RepoSeoReport> {
  const files = walk(root);
  const framework = detectFramework(root, files);
  const findings: RepoSeoReport['findings'] = [];
  const facts: Record<string, string> = {};
  const routes: RepoSeoReport['routes'] = [];

  facts.fayllar = String(files.length);
  facts.framework = framework;

  // ── Route'lar va ularning metadata holati ──
  const apps = findApps(root, files);
  facts.ilovalar = apps.length
    ? apps.map((a) => `${relative(root, a.dir) || '.'}(${a.framework})`).join(', ')
    : '-';

  for (const app of apps.filter((a) => a.framework.startsWith('next'))) {
    const pages = files.filter((f) =>
      f.startsWith(app.dir) && (app.framework === 'next-app'
        ? /\/app\/(.*\/)?page\.(tsx?|jsx?)$/.test(f)
        : /\/pages\/.*\.(tsx?|jsx?)$/.test(f) && !/\/pages\/api\//.test(f)),
    );
    for (const f of pages) {
      const src = read(f);
      routes.push({
        path: app.framework === 'next-app'
          ? routeOf(app.dir, f)
          : `/${relative(app.dir, f).replace(/^.*pages\//, '').replace(/\.(tsx?|jsx?)$/, '')}`,
        file: relative(root, f),
        hasMetadata: /export\s+(const|async\s+function)\s+(metadata|generateMetadata)/.test(src)
          || /<Head>|next\/head/.test(src),
        hasJsonLd: /application\/ld\+json/.test(src) || /JsonLd|jsonLd|schemaOrg/.test(src),
      });
    }
  }

  {
    const noMeta = routes.filter((r) => !r.hasMetadata);
    if (noMeta.length) {
      findings.push({
        level: 'muhim',
        what: `${noMeta.length} route'da metadata (title/description) yo'q`,
        where: noMeta.slice(0, 8).map((r) => r.path).join(', '),
      });
    }
    const noLd = routes.filter((r) => !r.hasJsonLd);
    if (noLd.length && routes.length) {
      findings.push({
        level: 'o\'rta',
        what: `${noLd.length}/${routes.length} route'da JSON-LD yo'q — AI qidiruv uchun muhim`,
        where: noLd.slice(0, 8).map((r) => r.path).join(', '),
      });
    }
  }

  // ── Fayl darajasidagi majburiy narsalar ──
  const has = (re: RegExp) => files.some((f) => re.test(relative(root, f)));
  const checks: [string, RegExp, 'muhim' | 'o\'rta' | 'past', string][] = [
    ['sitemap', /(^|\/)(app\/)?sitemap\.(ts|js|xml)$|sitemap.*\.(ts|js)$/, 'muhim', 'sitemap generatori yo\'q'],
    ['robots', /(^|\/)(app\/|public\/)?robots\.(ts|js|txt)$/, 'muhim', 'robots yo\'q'],
    // app/llms.txt/route.ts ham hisoblanadi — Next'da bu ham /llms.txt beradi.
    ['llmsTxt', /llms[^/]*\.txt(\/route\.[tj]sx?)?$/i, 'o\'rta', 'llms.txt yo\'q — GEO uchun AI botlarga yo\'lboshchi'],
    ['manifest', /(^|\/)(app\/)?manifest\.(ts|js|json)$|site\.webmanifest$/, 'past', 'manifest yo\'q'],
    ['opengraph', /opengraph-image|og-image|(^|\/)og\//, 'o\'rta', 'OG rasm generatori topilmadi'],
  ];
  for (const [key, re, level, msg] of checks) {
    const ok = has(re);
    facts[key] = ok ? 'bor' : 'yo\'q';
    if (!ok) findings.push({ level, what: msg, where: '-' });
  }

  // ── Grep bilan o'lchanadigan naqshlar ──
  const grep = async (pattern: string, include?: string): Promise<number> => {
    // -E SHART: BSD grep BRE da "\\+" literal emas, "bir yoki ko'p marta" degani.
    // Shu sabab 'application/ld\\+json' hech qachon topilmasdi.
    const args = ['-rIlE', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=.next',
      '--exclude-dir=dist', '--exclude=.env*'];
    if (include) args.push(`--include=${include}`);
    args.push('-e', pattern, '.');
    try {
      const { stdout } = await run('grep', args, { cwd: root, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
      return stdout.split('\n').filter(Boolean).length;
    } catch { return 0; }
  };

  const [ld, canonical, hreflang, h1, faq] = await Promise.all([
    grep('application/ld\\+json'),
    grep('canonical'),
    grep('hreflang|alternates'),
    grep('<h1'),
    grep('FAQPage|faqSchema|mainEntity'),
  ]);
  // grep lookahead'ni qo'llamaydi — alt'siz <img> ni o'zimiz sanaymiz.
  let altMissing = 0;
  for (const f of files.filter((x) => /\.(tsx|jsx|html)$/.test(x))) {
    const src = read(f, 120_000);
    if (/<img\s(?![^>]*\balt=)[^>]*>/.test(src)) altMissing += 1;
  }
  facts.jsonLdFayllar = String(ld);
  facts.canonicalFayllar = String(canonical);
  facts.hreflangFayllar = String(hreflang);
  facts.h1Fayllar = String(h1);
  facts.faqSchemaFayllar = String(faq);

  if (!ld) findings.push({ level: 'muhim', what: 'Loyihada umuman JSON-LD yo\'q', where: '-' });
  if (!canonical) findings.push({ level: 'o\'rta', what: 'canonical hech qayerda yozilmagan', where: '-' });
  if (!faq) findings.push({ level: 'o\'rta', what: 'FAQPage sxemasi yo\'q — AEO uchun asosiy element', where: '-' });
  if (altMissing) findings.push({ level: 'past', what: `alt'siz <img> bo'lgan ${altMissing} fayl`, where: '-' });

  // ── i18n ──
  const i18nFiles = files.filter((f) => /\/(messages|locales|i18n|lang)\//.test(f) && /\.(json|ts)$/.test(f));
  if (i18nFiles.length) {
    // "batch-quick-score.ts" til emas — faqat uz, ru, en, pt-BR kabi kodlar.
    const locales = new Set(
      i18nFiles
        .map((f) => basename(f).replace(/\.(json|ts)$/, ''))
        .filter((n) => /^[a-z]{2}(-[A-Za-z]{2})?$/.test(n)),
    );
    if (!locales.size) { facts.tillar = '-'; return { repo, framework, routes, findings, facts }; }
    facts.tillar = [...locales].slice(0, 12).join(', ');
    if (!hreflang) {
      findings.push({
        level: 'muhim',
        what: `${locales.size} til bor, lekin hreflang/alternates yo'q — tillar bir-birini yeydi`,
        where: 'i18n',
      });
    }
  }

  return { repo, framework, routes, findings, facts };
}
