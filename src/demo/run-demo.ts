/** pnpm demo — engine'ni DB va API kalitisiz tekshiradi. */
import { MemoryCheckpointer } from '../engine/memory.checkpointer';
import { GraphRunner } from '../engine/runner';
import { demoGraph, DemoState } from './demo.graph';
import { StubLlm } from './stub.llm';

async function main(): Promise<void> {
  const checkpointer = new MemoryCheckpointer();
  const runner = new GraphRunner(checkpointer, new StubLlm(), { maxSteps: 20, maxCostUsd: 1 });

  const initial: DemoState = { topic: 'Bomond uchun birinchi xabar', revisions: [], attempts: 0 };

  let outcome = await runner.start(demoGraph, initial, { threadKey: 'sales:demo' });
  console.log(`1) status=${outcome.status}`);
  console.log(outcome.interrupt?.question, '\n');

  // Sardor tuzatish so'raydi → graph "draft" ga qaytadi va yana to'xtaydi.
  outcome = await runner.resume<DemoState>(demoGraph, outcome.runId, 'birinchi gapni iliqroq qil');
  console.log(`2) status=${outcome.status} (tuzatishdan keyin)`);
  console.log(outcome.interrupt?.question, '\n');

  // Endi tasdiq.
  outcome = await runner.resume<DemoState>(demoGraph, outcome.runId, 'ha');
  console.log(`3) status=${outcome.status} sent=${outcome.state.sent}`);
  console.log(`   urinishlar=${outcome.state.attempts} tuzatishlar=${outcome.state.revisions.length}`);

  const run = await checkpointer.load(outcome.runId);
  console.log(
    `\nxarajat: ${run?.tokensIn}/${run?.tokensOut} token, $${run?.costUsd.toFixed(4)}`,
  );
  console.log('\nqadamlar:');
  for (const step of checkpointer.steps) {
    console.log(`  ${step.seq}. ${step.node.padEnd(8)} ${step.status}`);
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
