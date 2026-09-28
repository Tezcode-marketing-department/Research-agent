/** Hermes modelini to'g'ridan-to'g'ri sinaydi. */
import { HermesLlm, loadHermesConfig } from '../llm/hermes.llm';

async function main(): Promise<void> {
  const cfg = loadHermesConfig();
  console.log(`model: ${cfg.model} (${cfg.provider}) → ${cfg.baseUrl}`);
  const { llm, usage } = new HermesLlm(cfg).forStep('test', 'test');
  const answer = await llm.text('Salom. O\'zingni bir gapda tanishtir.', {
    system: 'Sen Sales Agentsan. O\'zbekcha, faqat lotin harflarda, qisqa yoz.',
  });
  console.log(`\njavob: ${answer}`);
  console.log(`token: ${JSON.stringify(usage())}`);
}

void main().catch((err) => {
  console.error('XATO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
