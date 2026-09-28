import { Injectable } from '@nestjs/common';
import { CompiledGraph } from '../engine/graph';
import { placeholderGraph, PlaceholderState } from './placeholder.graph';

/** Har agent — bitta bot, bitta graph. */
export type AgentKey = 'sales' | 'research' | 'content' | 'boss';

export interface AgentDef {
  key: AgentKey;
  title: string;
  /** .env dagi token o'zgaruvchisi. */
  tokenEnv: string;
  greeting: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph: CompiledGraph<any>;
  /** Kelgan matndan boshlang'ich holat. */
  initialState(input: string): object;
}

const placeholderState = (agent: string) => (input: string): PlaceholderState => ({
  agent,
  input,
  revisions: [],
  attempts: 0,
});

@Injectable()
export class AgentRegistry {
  private readonly agents = new Map<AgentKey, AgentDef>([
    [
      'sales',
      {
        key: 'sales',
        title: 'Sales Agent',
        tokenEnv: 'TG_BOT_TOKEN_SALES',
        greeting:
          'Sales Agent.\n\nOddiy yozing — gaplashamiz.\n/vazifa <matn> — tasdiq talab qiladigan ish boshlaydi\n/holat · /bekor · /tozala',
        graph: placeholderGraph,
        initialState: placeholderState('Sales'),
      },
    ],
    [
      'research',
      {
        key: 'research',
        title: 'Research Agent',
        tokenEnv: 'TG_BOT_TOKEN_RESEARCH',
        greeting:
          'Research Agent.\n\nOddiy yozing — gaplashamiz.\n/vazifa <matn> — tasdiq talab qiladigan ish\n/holat · /bekor · /tozala',
        graph: placeholderGraph,
        initialState: placeholderState('Research'),
      },
    ],
    [
      'content',
      {
        key: 'content',
        title: 'Content Agent',
        tokenEnv: 'TG_BOT_TOKEN_CONTENT',
        greeting:
          'Content Agent.\n\nOddiy yozing — gaplashamiz.\n/vazifa <matn> — tasdiq talab qiladigan ish\n/holat · /bekor · /tozala',
        graph: placeholderGraph,
        initialState: placeholderState('Content'),
      },
    ],
    [
      'boss',
      {
        key: 'boss',
        title: 'Dispetcher',
        tokenEnv: 'TG_BOT_TOKEN_BOSS',
        greeting:
          'Dispetcher.\n\nVazifani qaysi agentga berishni men taqsimlayman.\n/holat · /tozala',
        graph: placeholderGraph,
        initialState: placeholderState('Dispetcher'),
      },
    ],
  ]);

  all(): AgentDef[] {
    return [...this.agents.values()];
  }

  get(key: AgentKey): AgentDef {
    const def = this.agents.get(key);
    if (!def) throw new Error(`agent topilmadi: ${key}`);
    return def;
  }

  /** Run yozuvidagi graph nomi bo'yicha topish (resume uchun). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphByName(name: string): CompiledGraph<any> {
    for (const def of this.agents.values()) {
      if (def.graph.name === name) return def.graph;
    }
    throw new Error(`graph topilmadi: ${name}`);
  }
}
