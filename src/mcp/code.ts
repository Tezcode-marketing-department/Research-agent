/**
 * Kod tahriri — faqat OQ RO'YXATDAGI repoda, tor amallar bilan.
 *
 * Nega terminal emas: terminal bersak agent istalgan buyruqni bajaradi.
 * Bu yerda u faqat oltita amalni qila oladi va har biri tekshiriladi.
 *
 * PUSH TOOLI YO'Q — bu ataylab. Push qaytarib bo'lmaydigan, tashqariga
 * chiqadigan amal; uni Sardor o'zi qiladi.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HOME = homedir();

/**
 * TAHRIRLASH mumkin bo'lgan repolar. Faqat shular — boshqasida yozuv yo'q.
 */
const WRITABLE: Record<string, string> = {
  'tezcode-landing': join(HOME, 'Desktop', 'Tezcode', 'tezcode-landing'),
};

/**
 * FAQAT O'QISH uchun loyihalar. Agent SEO holatini kodidan o'rganishi mumkin,
 * lekin bir belgi ham o'zgartira olmaydi — tahrir funksiyalari bu ro'yxatni
 * qabul qilmaydi.
 */
const READABLE: Record<string, string> = {
  'raos': join(HOME, 'Desktop', 'work', 'Pos-cosmetics'),
  'sellertrend': join(HOME, 'Desktop', 'work', 'sellerTrend'),
  'clinicago': join(HOME, 'Desktop', 'work', 'hamshiraGo'),
  'wewatch': join(HOME, 'Desktop', 'Tezcode', 'Rave'),
};

const REPOS: Record<string, string> = { ...WRITABLE, ...READABLE };

/** Tahrirlash mumkin bo'lgan kengaytmalar — sir va build chiqishiga tegmasin. */
const EDITABLE = /\.(tsx?|jsx?|mjs|cjs|json|md|mdx|css|scss|ya?ml|txt|xml|html)$/i;
const BLOCKED = /(^|\/)(\.env|\.git\/|node_modules\/|\.next\/|dist\/|\.vercel\/)/;

function repoRoot(repo: string, forWrite = false): string {
  const root = REPOS[repo];
  if (!root) {
    throw new Error(
      `"${repo}" ruxsat etilmagan. Ruxsat berilganlar: ${Object.keys(REPOS).join(', ')}`,
    );
  }
  if (forWrite && !WRITABLE[repo]) {
    throw new Error(
      `"${repo}" faqat o'qish uchun — kodini o'rgan, lekin o'zgartira olmaysan. ` +
      `Tahrir qilinadigani: ${Object.keys(WRITABLE).join(', ')}. ` +
      `O'zgartirish kerak bo'lsa topilmani Sardorga aniq ayt yoki blocker_add qil.`,
    );
  }
  if (!existsSync(root)) throw new Error(`repo topilmadi: ${root}`);
  return root;
}

/** Yo'l repo ichida qolishini kafolatlaydi — `../` bilan chiqib bo'lmaydi. */
function safePath(repo: string, rel: string, forWrite = false): string {
  const root = repoRoot(repo, forWrite);
  if (isAbsolute(rel)) throw new Error('yo\'l nisbiy bo\'lsin (repo ildizidan)');
  const abs = resolve(root, rel);
  const inside = relative(root, abs);
  if (inside.startsWith('..')) throw new Error('repo tashqarisiga chiqib bo\'lmaydi');
  if (BLOCKED.test(inside)) throw new Error(`bu joyga tegib bo'lmaydi: ${inside}`);
  return abs;
}

export function codeRepos(): { repo: string; path: string; writable: boolean }[] {
  return Object.entries(REPOS).map(([repo, path]) => ({
    repo, path, writable: Boolean(WRITABLE[repo]),
  }));
}

export async function codeTree(repo: string, sub = '.', depth = 2): Promise<string> {
  const root = repoRoot(repo);
  const start = sub === '.' ? root : safePath(repo, sub);
  const { stdout } = await run(
    'find',
    [start, '-maxdepth', String(depth), '-not', '-path', '*/node_modules/*',
     '-not', '-path', '*/.git/*', '-not', '-path', '*/.next/*', '-not', '-path', '*/dist/*'],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((p) => relative(root, p) || '.')
    .sort()
    .slice(0, 300)
    .join('\n');
}

export function codeRead(repo: string, path: string): string {
  const abs = safePath(repo, path);
  if (!existsSync(abs)) throw new Error(`fayl yo'q: ${path}`);
  const text = readFileSync(abs, 'utf8');
  if (text.length > 60_000) {
    return text.slice(0, 60_000) + `\n\n[...qisqartirildi, jami ${text.length} belgi]`;
  }
  return text;
}

export async function codeSearch(repo: string, pattern: string, include?: string): Promise<string> {
  const root = repoRoot(repo);
  const args = ['-rn', '--binary-files=without-match',
    '--exclude-dir=node_modules', '--exclude-dir=.git',
    '--exclude-dir=.next', '--exclude-dir=dist', '--exclude=.env*'];
  if (include) args.push(`--include=${include}`);
  args.push('-e', pattern, '.');
  try {
    const { stdout } = await run('grep', args, { cwd: root, timeout: 45_000, maxBuffer: 4 * 1024 * 1024 });
    const lines = stdout.split('\n').filter(Boolean);
    return lines.slice(0, 120).join('\n') + (lines.length > 120 ? `\n[...yana ${lines.length - 120} qator]` : '');
  } catch {
    return 'topilmadi';
  }
}

/** Aniq matnni almashtiradi. Matn bir marta uchrashi SHART — noaniqlik xatoga olib keladi. */
export function codeEdit(repo: string, path: string, find: string, replace: string): string {
  const abs = safePath(repo, path, true);
  const rel = relative(repoRoot(repo), abs);
  if (!EDITABLE.test(rel)) throw new Error(`bu turdagi faylni tahrirlab bo'lmaydi: ${rel}`);
  if (!existsSync(abs)) throw new Error(`fayl yo'q: ${path}`);
  if (!find.trim()) throw new Error('find bo\'sh bo\'lmasin');

  const text = readFileSync(abs, 'utf8');
  const count = text.split(find).length - 1;
  if (count === 0) throw new Error('find matni faylda topilmadi — avval code_read bilan aniq ko\'chirib ol');
  if (count > 1) throw new Error(`find matni ${count} marta uchradi — kengaytirib, yagona qilib ber`);

  writeFileSync(abs, text.replace(find, replace), 'utf8');
  return `${rel} — o'zgartirildi (-${find.split('\n').length} / +${replace.split('\n').length} qator)`;
}

export async function codeDiff(repo: string, path?: string): Promise<string> {
  const root = repoRoot(repo);
  const args = ['diff', '--no-color'];
  if (path) args.push('--', relative(root, safePath(repo, path)));
  const { stdout } = await run('git', args, { cwd: root, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  if (!stdout.trim()) return 'o\'zgarish yo\'q';
  return stdout.length > 20_000 ? stdout.slice(0, 20_000) + '\n[...qisqartirildi]' : stdout;
}

export async function codeRevert(repo: string, path: string): Promise<string> {
  const root = repoRoot(repo);
  const rel = relative(root, safePath(repo, path));
  await run('git', ['checkout', '--', rel], { cwd: root, timeout: 30_000 });
  return `${rel} — o'zgarishlar bekor qilindi`;
}

/** typecheck + lint. O'tmasa o'zgarish yaroqsiz. */
export async function codeVerify(repo: string): Promise<{ ok: boolean; output: string }> {
  const root = repoRoot(repo);
  const pnpm = join(HOME, '.npm-global', 'bin', 'pnpm');
  const bin = existsSync(pnpm) ? pnpm : 'pnpm';
  try {
    const { stdout, stderr } = await run(bin, ['type-check'], {
      cwd: root, timeout: 600_000, maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout}\n${stderr}`.trim().slice(-2000) || 'toza' };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? e.message ?? ''}`.trim().slice(-3000) };
  }
}

export async function codeStatus(repo: string): Promise<string> {
  const root = repoRoot(repo);
  const { stdout } = await run('git', ['status', '--short', '--branch'], { cwd: root, timeout: 20_000 });
  return stdout.trim() || 'toza';
}

/** Lokal commit. Push YO'Q — uni Sardor qiladi. */
export async function codeCommit(repo: string, message: string): Promise<string> {
  const root = repoRoot(repo, true);
  const status = await codeStatus(repo);
  if (status === 'toza' || !/^[ MARCD?]{2} /m.test(status)) {
    throw new Error('commit qilinadigan o\'zgarish yo\'q');
  }
  const verify = await codeVerify(repo);
  if (!verify.ok) {
    throw new Error(`type-check o'tmadi — commit qilinmadi:\n${verify.output.slice(-1200)}`);
  }
  await run('git', ['add', '-A'], { cwd: root, timeout: 30_000 });
  await run('git', ['commit', '-m', message], { cwd: root, timeout: 60_000 });
  const { stdout } = await run('git', ['log', '-1', '--oneline'], { cwd: root, timeout: 20_000 });
  return `Commit qilindi (lokal, push YO'Q): ${stdout.trim()}`;
}
