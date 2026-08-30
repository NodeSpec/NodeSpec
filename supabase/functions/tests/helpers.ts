/*
  P0-8 harness helpers: a scriptable fake Supabase client and assertion utilities.
  Pure Deno — no network, no env. Tests script per-table responses and then assert on
  the recorded calls (table, operation, payload, filters).
*/

export interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
  opts?: unknown;
  filters: Array<{ method: string; args: unknown[] }>;
}

export interface ScriptedResult {
  data?: unknown;
  error?: { message?: string; code?: string } | null;
  count?: number | null;
}

class FakeQueryBuilder implements PromiseLike<ScriptedResult> {
  constructor(
    private readonly fake: FakeSupabase,
    private readonly call: RecordedCall,
  ) {}

  private chain(method: string, ...args: unknown[]): this {
    this.call.filters.push({ method, args });
    return this;
  }

  // `.select()` also appears mid-chain after insert/update/delete (Postgrest returning
  // rows), not only as the initial op from `from()`. As a chain method it records the
  // columns and preserves the op, so the scripted `${table}.${op}` result still resolves.
  select(c?: string) { return this.chain('select', c); }
  eq(c: string, v: unknown) { return this.chain('eq', c, v); }
  neq(c: string, v: unknown) { return this.chain('neq', c, v); }
  like(c: string, v: unknown) { return this.chain('like', c, v); }
  in(c: string, v: unknown) { return this.chain('in', c, v); }
  is(c: string, v: unknown) { return this.chain('is', c, v); }
  lt(c: string, v: unknown) { return this.chain('lt', c, v); }
  gte(c: string, v: unknown) { return this.chain('gte', c, v); }
  order(c: string, o?: unknown) { return this.chain('order', c, o); }
  limit(n: number) { return this.chain('limit', n); }
  maybeSingle() { return this.chain('maybeSingle'); }
  single() { return this.chain('single'); }

  private resolveResult(): ScriptedResult {
    return this.fake.nextResult(this.call.table, this.call.op);
  }

  then<T1 = ScriptedResult, T2 = never>(
    onfulfilled?: ((value: ScriptedResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.resolveResult()).then(onfulfilled, onrejected);
  }
}

export class FakeSupabase {
  calls: RecordedCall[] = [];
  private results = new Map<string, ScriptedResult[]>();

  /** Queue the next result for `${table}.${op}` (op: select|insert|update|upsert|delete). */
  script(table: string, op: string, result: ScriptedResult): this {
    const key = `${table}.${op}`;
    const queue = this.results.get(key) ?? [];
    queue.push(result);
    this.results.set(key, queue);
    return this;
  }

  nextResult(table: string, op: string): ScriptedResult {
    const queue = this.results.get(`${table}.${op}`);
    if (queue && queue.length > 0) return queue.shift()!;
    return { data: null, error: null };
  }

  from(table: string) {
    const fake = this;
    return {
      select: (columns?: string) => {
        const call: RecordedCall = { table, op: 'select', payload: columns, filters: [] };
        fake.calls.push(call);
        return new FakeQueryBuilder(fake, call);
      },
      insert: (payload: unknown) => {
        const call: RecordedCall = { table, op: 'insert', payload, filters: [] };
        fake.calls.push(call);
        return new FakeQueryBuilder(fake, call);
      },
      update: (payload: unknown) => {
        const call: RecordedCall = { table, op: 'update', payload, filters: [] };
        fake.calls.push(call);
        return new FakeQueryBuilder(fake, call);
      },
      delete: () => {
        const call: RecordedCall = { table, op: 'delete', filters: [] };
        fake.calls.push(call);
        return new FakeQueryBuilder(fake, call);
      },
      upsert: (payload: unknown, opts?: unknown) => {
        const call: RecordedCall = { table, op: 'upsert', payload, opts, filters: [] };
        fake.calls.push(call);
        return new FakeQueryBuilder(fake, call);
      },
    };
  }

  // Postgres function call. Scriptable via `script('rpc', fnName, result)`; recorded under the
  // synthetic table `rpc` with op = fnName so `callsTo('rpc', fnName)` works.
  rpc(fn: string, params?: unknown): PromiseLike<ScriptedResult> {
    const call: RecordedCall = { table: 'rpc', op: fn, payload: params, filters: [] };
    this.calls.push(call);
    return Promise.resolve(this.nextResult('rpc', fn));
  }

  callsTo(table: string, op?: string): RecordedCall[] {
    return this.calls.filter((c) => c.table === table && (!op || c.op === op));
  }
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export function assertEquals(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ?? 'assertEquals failed'}\n  actual:   ${a}\n  expected: ${e}`);
}

// ── N8.5″(a): fixture completion for the SERVER read gate ─────────────────────────
// loadCatalogs now runs parseRole over every node_roles row (the same M5 gate the
// client repository runs), so a minimal role fixture fed through FakeSupabase must
// be completed to pass the SAME gate real DB rows pass. Contract: every field a
// test supplied with a VALID value is preserved verbatim; only the schema-required
// cosmetics are filled, and the two display enums are coerced when a fixture used
// a pre-M free-text value (e.g. 'Frontend', 'automation', '') that no test asserts
// through the loadCatalogs path. Enum truth comes from the schema — never a copy.
import { PaletteCategorySchema, RfVisualTypeSchema } from "../_shared/catalog-schemas.ts";

export function completeRole(row: Record<string, unknown>): Record<string, unknown> {
  return {
    label: String(row.id ?? 'role'),
    description: '',
    icon_name: 'box',
    color: '#666666',
    sort_order: 0,
    is_container: false,
    ...row,
    palette_category: PaletteCategorySchema.safeParse(row.palette_category).success
      ? row.palette_category : 'Services',
    rf_visual_type: RfVisualTypeSchema.safeParse(row.rf_visual_type).success
      ? row.rf_visual_type : 'service',
  };
}
