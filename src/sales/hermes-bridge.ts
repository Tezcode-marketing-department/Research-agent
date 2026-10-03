/**
 * Sardor Sales akkaunt bilan XUDDI HAQIQIY AI CHATDEK gaplasha olishi uchun
 * ko'prik: uning Telegram xabari to'liq Hermes Sales Agent profiliga
 * (SOUL.md + `tezcode` MCP tool'lari bilan) bir martalik (`-z`) chaqiruv
 * sifatida uzatiladi, javob matni qaytariladi.
 *
 * FAQAT Sardor uchun (`outreach.ts`da `label === 'sardor'` bilan
 * cheklanadi) — boshqa hech kim bu ko'prikni ishga tushirmaydi.
 *
 * `--yolo`: Sardor — vakolatli inson, u shaxsan yozyapti, shu sababli
 * tool tasdiqlash so'rovlari bloklamasin (interaktiv TTY yo'q, aks holda
 * chaqiruv osilib qoladi).
 */
import { spawn } from 'node:child_process';

const HERMES_BIN = process.env.HERMES_BIN ?? 'hermes';
const HERMES_SALES_PROFILE = process.env.HERMES_SALES_PROFILE ?? 'sales';
const TIMEOUT_MS = Number(process.env.HERMES_SALES_TIMEOUT_MS ?? 180_000);

export async function askSalesAgent(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', HERMES_SALES_PROFILE, '-z', message, '--yolo'];
    const child = spawn(HERMES_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error("Hermes javobi vaqt chegarasidan oshdi"));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`hermes kod ${code}: ${(stderr || stdout).slice(0, 500)}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
