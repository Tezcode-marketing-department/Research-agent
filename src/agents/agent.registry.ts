import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { CompiledGraph } from '../engine/graph';
import { GraphRunner, RunOutcome } from '../engine/runner';
import { PlaceholderState, placeholderGraph } from './placeholder.graph';
import { createPrismaResearchLeadStore } from './research.leads';
import { createResearchGraph, researchInitialState, ResearchState } from './research.graph';
import { lookupResearchSources } from './research.web';

/** Har agent — bitta bot va o'z ish graph'i. */
export type AgentKey = 'sales' | 'research' | 'content' | 'boss';

export interface AgentDef {
  key: AgentKey;
  title: string;
  tokenEnv: string;
  greeting: string;
  graphName: string;
  /** Oddiy matn (buyruqsiz) kelganda va kutayotgan ish bo'lmasa — /vazifa kabi yangi ish boshlansinmi (true), yoki oddiy suhbatga o'tsinmi (false). */
  autoStartFromText: boolean;
  start(runner: GraphRunner, input: string, threadKey: string): Promise<RunOutcome<object>>;
  resume(runner: GraphRunner, runId: string, answer: string): Promise<RunOutcome<object>>;
}

interface AgentOptions<S extends object> {
  key: AgentKey;
  title: string;
  tokenEnv: string;
  greeting: string;
  graph: CompiledGraph<S>;
  initialState(input: string): S;
  autoStartFromText?: boolean;
}

function defineAgent<S extends object>(options: AgentOptions<S>): AgentDef {
  return {
    key: options.key,
    title: options.title,
    tokenEnv: options.tokenEnv,
    greeting: options.greeting,
    graphName: options.graph.name,
    autoStartFromText: options.autoStartFromText ?? false,
    start: (runner, input, threadKey) =>
      runner.start(options.graph, options.initialState(input), { threadKey }),
    resume: (runner, runId, answer) => runner.resume(options.graph, runId, answer),
  };
}

const placeholderState = (agent: string) => (input: string): PlaceholderState => ({
  agent,
  input,
  revisions: [],
  attempts: 0,
});

@Injectable()
export class AgentRegistry {
  private readonly agents: Map<AgentKey, AgentDef>;

  constructor(prisma: PrismaService) {
    const researchLeadStore = createPrismaResearchLeadStore(prisma);

    this.agents = new Map<AgentKey, AgentDef>([
      ['sales', defineAgent({
        key: 'sales',
        title: 'Sales Agent',
        tokenEnv: 'TG_BOT_TOKEN_SALES',
        greeting: 'Sales Agent.\n\nOddiy yozing — gaplashamiz.\n/vazifa <matn> — tasdiq talab qiladigan ish boshlaydi\n/holat · /bekor · /tozala',
        graph: placeholderGraph,
        initialState: placeholderState('Sales'),
      })],
      ['research', defineAgent<ResearchState>({
        key: 'research',
        title: 'Research Agent',
        tokenEnv: 'TG_BOT_TOKEN_RESEARCH',
        greeting: 'Research Agent.\n\nOv mavzusini yozing (masalan: "IT/AI kerak bo\'lgan restoranlar Toshkentda") — nomzodlarni dalil bilan topib, Sales navbatiga qo\'yaman.\n/vazifa <mavzu> ham ishlaydi, lekin shart emas — oddiy yozsangiz ham boshlayman.\n/holat · /bekor · /tozala',
        graph: createResearchGraph(lookupResearchSources, researchLeadStore),
        initialState: researchInitialState,
        autoStartFromText: true,
      })],
      ['content', defineAgent({
        key: 'content',
        title: 'Content Agent',
        tokenEnv: 'TG_BOT_TOKEN_CONTENT',
        greeting: 'Content Agent.\n\nOddiy yozing — gaplashamiz.\n/vazifa <matn> — tasdiq talab qiladigan ish\n/holat · /bekor · /tozala',
        graph: placeholderGraph,
        initialState: placeholderState('Content'),
      })],
      ['boss', defineAgent({
        key: 'boss',
        title: 'Dispetcher',
        tokenEnv: 'TG_BOT_TOKEN_BOSS',
        greeting: 'Dispetcher.\n\nVazifani qaysi agentga berishni men taqsimlayman.\n/holat · /tozala',
        graph: placeholderGraph,
        initialState: placeholderState('Dispetcher'),
      })],
    ]);
  }

  all(): AgentDef[] {
    return [...this.agents.values()];
  }

  get(key: AgentKey): AgentDef {
    const def = this.agents.get(key);
    if (!def) throw new Error(`agent topilmadi: ${key}`);
    return def;
  }

  graphByName(name: string): AgentDef {
    const def = [...this.agents.values()].find((agent) => agent.graphName === name);
    if (!def) throw new Error(`graph topilmadi: ${name}`);
    return def;
  }
}
