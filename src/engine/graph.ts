import { END, FieldReducer, NodeFn, Router } from './types';

/**
 * Graph quruvchi. Tugunlar va o'tishlar — oddiy funksiyalar,
 * ya'ni marshrut DETERMINISTIK. LLM faqat tugun ICHIDA chaqiriladi.
 */
export class GraphBuilder<S extends object> {
  private readonly nodes = new Map<string, NodeFn<S>>();
  private readonly edges = new Map<string, string>();
  private readonly routers = new Map<string, Router<S>>();
  private readonly reducers = new Map<keyof S, FieldReducer>();
  private entry?: string;

  constructor(readonly name: string) {}

  node(name: string, fn: NodeFn<S>): this {
    if (name === END) throw new Error(`"${END}" band nom`);
    if (this.nodes.has(name)) throw new Error(`tugun takrorlandi: ${name}`);
    this.nodes.set(name, fn);
    if (!this.entry) this.entry = name; // birinchi qo'shilgan tugun — kirish nuqtasi
    return this;
  }

  /** Doimiy o'tish. */
  edge(from: string, to: string): this {
    this.edges.set(from, to);
    return this;
  }

  /** Shartli o'tish — holatga qarab keyingi tugun nomini qaytaradi. */
  route(from: string, router: Router<S>): this {
    this.routers.set(from, router);
    return this;
  }

  entryPoint(name: string): this {
    this.entry = name;
    return this;
  }

  /** Massiv/yig'iluvchi maydonlar uchun: almashtirish o'rniga qo'shish. */
  reducer(field: keyof S, fn: FieldReducer): this {
    this.reducers.set(field, fn);
    return this;
  }

  compile(): CompiledGraph<S> {
    if (!this.entry) throw new Error(`${this.name}: kirish tuguni yo'q`);
    for (const [from, to] of this.edges) {
      if (!this.nodes.has(from)) throw new Error(`o'tish noma'lum tugundan: ${from}`);
      if (to !== END && !this.nodes.has(to)) throw new Error(`o'tish noma'lum tugunga: ${to}`);
    }
    for (const from of this.routers.keys()) {
      if (!this.nodes.has(from)) throw new Error(`router noma'lum tugunda: ${from}`);
    }
    // Chiqish yo'li yo'q tugun — jim qolib ketadigan xato, kompilyatsiyada ushlaymiz.
    for (const name of this.nodes.keys()) {
      if (!this.edges.has(name) && !this.routers.has(name)) {
        throw new Error(`"${name}" tugunidan chiqish yo'q (edge yoki route qo'shing)`);
      }
    }
    return new CompiledGraph<S>(
      this.name,
      this.entry,
      this.nodes,
      this.edges,
      this.routers,
      this.reducers,
    );
  }
}

export class CompiledGraph<S extends object> {
  constructor(
    readonly name: string,
    readonly entry: string,
    private readonly nodes: Map<string, NodeFn<S>>,
    private readonly edges: Map<string, string>,
    private readonly routers: Map<string, Router<S>>,
    private readonly reducers: Map<keyof S, FieldReducer>,
  ) {}

  nodeFn(name: string): NodeFn<S> {
    const fn = this.nodes.get(name);
    if (!fn) throw new Error(`${this.name}: "${name}" tuguni topilmadi`);
    return fn;
  }

  /** Tugundan keyin qayerga borishni hal qiladi. */
  next(from: string, state: S): string {
    const router = this.routers.get(from);
    if (router) {
      const to = router(state);
      if (to !== END && !this.nodes.has(to)) {
        throw new Error(`${this.name}: router "${from}" → noma'lum "${to}"`);
      }
      return to;
    }
    return this.edges.get(from) ?? END;
  }

  /** Tugun qaytargan bo'lakni holatga qo'shadi (reducer bo'lsa — u orqali). */
  merge(state: S, patch: Partial<S>): S {
    const out = { ...state } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const reducer = this.reducers.get(key as keyof S);
      out[key] = reducer ? reducer(out[key], value) : value;
    }
    return out as S;
  }
}

export function graph<S extends object>(name: string): GraphBuilder<S> {
  return new GraphBuilder<S>(name);
}
