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
  overlaps(c: string, v: unknown) { return this.chain('overlaps', c, v); }
  is(c: string, v: unknown) { return this.chain('is', c, v); }
  or(f: string) { return this.chain('or', f); }
  lt(c: string, v: unknown) { return this.chain('lt', c, v); }
  gt(c: string, v: unknown) { return this.chain('gt', c, v); }
  gte(c: string, v: unknown) { return this.chain('gte', c, v); }
  order(c: string, o?: unknown) { return this.chain('order', c, o); }
  limit(n: number) { return this.chain('limit', n); }
  range(from: number, to: number) { return this.chain('range', from, to); }
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

  // The service's user lookup. Scriptable via `script('auth', 'getUserById', result)`;
  // unscripted it finds no user.
  auth = {
    admin: {
      getUserById: (id: string): PromiseLike<ScriptedResult> => {
        this.calls.push({ table: 'auth', op: 'getUserById', payload: id, filters: [] });
        return Promise.resolve(this.nextResult('auth', 'getUserById'));
      },
    },
  };
}

/** AC: a project carries constraints when its owner's plan has Workflows
 *  (node-constraints.ts constraintsCarried reads the owner, then the plan).
 *  Queue that answer; pass 'community' for a project that carries none. */
export function scriptOwnerPlan(sb: FakeSupabase, plan = 'indie', owner = 'owner-1'): FakeSupabase {
  sb.script('projects', 'select', { data: { owner_id: owner }, error: null });
  sb.script('stripe_subscriptions', 'select', { data: plan === 'community' ? null : { plan_name: plan, status: 'active' }, error: null });
  return sb;
}

/** Decision 1: below Team a project is its owner's alone, so a seat counts
 *  only while its owner is on Team or above (ownersCarryingSeats reads the
 *  owners' subscriptions in one batch). Queue that answer for a scripted
 *  seat: the owner on Team, or pass a plan below it for a seat that
 *  reaches nothing. */
export function scriptSeatOwner(sb: FakeSupabase, owner: string, plan = 'team'): FakeSupabase {
  sb.script('stripe_subscriptions', 'select', { data: [{ user_id: owner, plan_name: plan, status: 'active', current_period_end: '2099-01-01T00:00:00Z' }], error: null });
  return sb;
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

// ── MemorySupabase (2026-09-21): a table-backed fake ───────────────────────
// FakeSupabase answers a scripted result whatever the query said, so a
// handler's filters are never applied: an UPDATE scoped to the wrong project
// "succeeds", a released lease still "heartbeats", an unqueued read is an
// empty table. MemorySupabase keeps rows per table and applies the chain
// (eq, neq, in, is, gt, gte, lt, lte, like, ilike, not, match, filter, order,
// limit, range, single, maybeSingle, count), inserts with generated ids and
// the unique indexes a test declares (23505), updates and deletes exactly the
// rows the filters select, resolves one level of embedded resource
// (`projects!inner(id, name)` through `<singular>_id`), answers rpc() through
// registered functions and auth.getUser through registered tokens. An
// unseeded table is a missing relation (42P01), as in Postgres. It does NOT
// model RLS, triggers, transactions or .or(): those are the SQL lane's
// (scripts/db-lane), which runs them on a real Postgres.
export type Row = Record<string, unknown>;
type Filter = { method: string; args: unknown[] };
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
type UniqueRule = { name: string; columns: string[]; where?: (row: Row) => boolean };
export interface MemoryError { code: string; message: string; details?: string }
export interface MemoryResult { data: unknown; error: MemoryError | null; count?: number | null }

function singular(table: string): string {
  if (table.endsWith('ies')) return table.slice(0, -3) + 'y';
  if (/(ches|shes|sses|xes)$/.test(table)) return table.slice(0, -2);
  if (table.endsWith('s')) return table.slice(0, -1);
  return table;
}
function likeToRegExp(pattern: string, flags = ''): RegExp {
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${esc}$`, flags);
}
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}
function rowMatches(row: Row, f: Filter): boolean {
  if (f.method === 'match') {
    const obj = f.args[0] as Row;
    return Object.entries(obj).every(([k, v]) => row[k] === v);
  }
  const [col, v, v2] = f.args as [string, unknown, unknown];
  const x = row[col];
  switch (f.method) {
    case 'eq': return x === v;
    case 'neq': return x !== v;
    case 'in': return Array.isArray(v) && v.includes(x);
    case 'is': return v === null ? x == null : x === v;
    case 'gt': return x != null && compareValues(x, v) > 0;
    case 'gte': return x != null && compareValues(x, v) >= 0;
    case 'lt': return x != null && compareValues(x, v) < 0;
    case 'lte': return x != null && compareValues(x, v) <= 0;
    case 'like': return typeof x === 'string' && likeToRegExp(String(v)).test(x);
    case 'ilike': return typeof x === 'string' && likeToRegExp(String(v), 'i').test(x);
    case 'not': return !rowMatches(row, { method: String(v), args: [col, v2] });
    case 'filter': return rowMatches(row, { method: String(v), args: [col, v2] });
    default: return true;
  }
}
/** Split a select string on top-level commas: `role, projects!inner(id, name)`. */
function splitColumns(columns: string): string[] {
  const out: string[] = [];
  let depth = 0; let cur = '';
  for (const ch of columns) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

class MemoryQuery implements PromiseLike<MemoryResult> {
  private filters: Filter[] = [];
  private ordering: Array<{ col: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private wantRows: boolean;
  private columns: string | undefined;
  private countMode: boolean = false;
  private head = false;

  constructor(
    private readonly db: MemorySupabase,
    private readonly table: string,
    private readonly op: Op,
    private readonly payload: unknown,
    private readonly opts: unknown,
    private readonly call: RecordedCall,
    columns?: string,
    selectOpts?: { count?: string; head?: boolean },
  ) {
    this.wantRows = op === 'select';
    this.columns = columns;
    if (selectOpts?.count) this.countMode = true;
    if (selectOpts?.head) this.head = true;
  }

  private record(method: string, ...args: unknown[]): this {
    this.call.filters.push({ method, args });
    return this;
  }
  private where(method: string, ...args: unknown[]): this {
    this.filters.push({ method, args });
    return this.record(method, ...args);
  }

  select(columns?: string, opts?: { count?: string; head?: boolean }) {
    this.wantRows = true;
    this.columns = columns;
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this.record('select', columns);
  }
  eq(c: string, v: unknown) { return this.where('eq', c, v); }
  neq(c: string, v: unknown) { return this.where('neq', c, v); }
  in(c: string, v: unknown) { return this.where('in', c, v); }
  is(c: string, v: unknown) { return this.where('is', c, v); }
  gt(c: string, v: unknown) { return this.where('gt', c, v); }
  gte(c: string, v: unknown) { return this.where('gte', c, v); }
  lt(c: string, v: unknown) { return this.where('lt', c, v); }
  lte(c: string, v: unknown) { return this.where('lte', c, v); }
  like(c: string, v: unknown) { return this.where('like', c, v); }
  ilike(c: string, v: unknown) { return this.where('ilike', c, v); }
  not(c: string, op: string, v: unknown) { return this.where('not', c, op, v); }
  filter(c: string, op: string, v: unknown) { return this.where('filter', c, op, v); }
  match(obj: Row) { return this.where('match', obj); }
  or(_expr: string) { throw new Error('MemorySupabase: .or() is not modelled; seed the rows so eq/in select them.'); }
  order(c: string, o?: { ascending?: boolean }) { this.ordering.push({ col: c, ascending: o?.ascending !== false }); return this.record('order', c, o); }
  limit(n: number) { this.limitN = n; return this.record('limit', n); }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this.record('range', from, to); }
  single() { this.mode = 'single'; return this.record('single'); }
  maybeSingle() { this.mode = 'maybe'; return this.record('maybeSingle'); }

  then<T1 = MemoryResult, T2 = never>(
    onfulfilled?: ((value: MemoryResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }

  private project(row: Row, columns: string | undefined): Row | null {
    if (!columns || columns.trim() === '*') return { ...row };
    const out: Row = {};
    for (const tok of splitColumns(columns)) {
      const m = /^(?:([A-Za-z_]\w*):)?([A-Za-z_]\w*)(!inner|!left)?\(([\s\S]*)\)$/.exec(tok);
      if (m) {
        const [, alias, rel, mod, inner] = m;
        const target = this.db.rowsOf(rel).find((r) => r.id === row[`${singular(rel)}_id`]);
        if (!target) {
          if (mod === '!inner') return null;
          out[alias ?? rel] = null;
        } else {
          out[alias ?? rel] = this.project(target, inner);
        }
      } else if (tok === '*') {
        Object.assign(out, row);
      } else {
        const [alias, col] = tok.includes(':') ? tok.split(':').map((s) => s.trim()) : [tok, tok];
        out[alias] = row[col];
      }
    }
    return out;
  }

  private shape(list: Row[]): MemoryResult {
    const projected = list.map((r) => this.project(r, this.columns)).filter((r): r is Row => r !== null);
    const count = this.countMode ? projected.length : undefined;
    if (this.head) return { data: null, error: null, count: count ?? null };
    if (this.mode === 'single') {
      if (projected.length !== 1) return { data: null, error: { code: 'PGRST116', message: `JSON object requested, multiple (or no) rows returned (${projected.length})` } };
      return { data: projected[0], error: null, ...(count !== undefined ? { count } : {}) };
    }
    if (this.mode === 'maybe') {
      if (projected.length > 1) return { data: null, error: { code: 'PGRST116', message: `JSON object requested, multiple (or no) rows returned (${projected.length})` } };
      return { data: projected[0] ?? null, error: null, ...(count !== undefined ? { count } : {}) };
    }
    return { data: projected, error: null, ...(count !== undefined ? { count } : {}) };
  }

  private execute(): MemoryResult {
    let rows: Row[];
    try {
      rows = this.db.rowsOf(this.table);
    } catch (e) {
      return { data: null, error: e as MemoryError };
    }
    // A table given its columns (MemorySupabase.columns) answers a query that
    // names any other column the way PostgREST does: an error, no rows.
    const unknown = this.db.unknownColumn(this.table, [
      ...this.filters.map((f) => f.args[0]).filter((c): c is string => typeof c === 'string' && !c.includes('.')),
      ...this.ordering.map((o) => o.col),
      ...(this.columns ? splitColumns(this.columns).filter((t) => !t.includes('(') && t !== '*').map((t) => (t.includes(':') ? t.split(':')[1].trim() : t)) : []),
    ]);
    if (unknown) return { data: null, error: { code: '42703', message: `column ${this.table}.${unknown} does not exist` } };
    // A filter on an embedded resource's column (`.eq('projects.name', x)`
    // beside `projects!inner(...)`) keeps the parent rows whose embedded row
    // matches, as PostgREST does for an inner embed.
    const embedded = (r: Row, f: Filter): boolean => {
      const [path, ...rest] = f.args as [string, ...unknown[]];
      const [rel, col] = path.split('.');
      const target = this.db.rowsOf(rel).find((t) => t.id === r[`${singular(rel)}_id`]);
      return !!target && rowMatches(target, { method: f.method, args: [col, ...rest] });
    };
    const selected = rows.filter((r) => this.filters.every((f) => (typeof f.args[0] === 'string' && f.args[0].includes('.') ? embedded(r, f) : rowMatches(r, f))));
    switch (this.op) {
      case 'select': {
        let list = selected.slice();
        for (const o of [...this.ordering].reverse()) list.sort((a, b) => (o.ascending ? 1 : -1) * compareValues(a[o.col], b[o.col]));
        if (this.rangeFrom !== null) list = list.slice(this.rangeFrom, (this.rangeTo ?? list.length - 1) + 1);
        if (this.limitN !== null) list = list.slice(0, this.limitN);
        return this.shape(list);
      }
      case 'insert': {
        const items = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const inserted: Row[] = [];
        for (const item of items) {
          const row: Row = { ...item };
          if (row.id === undefined) row.id = crypto.randomUUID();
          const clash = this.db.uniqueClash(this.table, row, null);
          if (clash) return { data: null, error: clash };
          rows.push(row);
          inserted.push(row);
        }
        return this.wantRows ? this.shape(inserted) : { data: null, error: null };
      }
      case 'upsert': {
        const items = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const conflict = String((this.opts as { onConflict?: string } | undefined)?.onConflict ?? 'id').split(',').map((s) => s.trim());
        const touched: Row[] = [];
        for (const item of items) {
          const existing = rows.find((r) => conflict.every((c) => r[c] === item[c]));
          if (existing) { Object.assign(existing, item); touched.push(existing); continue; }
          const row: Row = { ...item };
          if (row.id === undefined) row.id = crypto.randomUUID();
          const clash = this.db.uniqueClash(this.table, row, null);
          if (clash) return { data: null, error: clash };
          rows.push(row);
          touched.push(row);
        }
        return this.wantRows ? this.shape(touched) : { data: null, error: null };
      }
      case 'update': {
        const patch = this.payload as Row;
        for (const r of selected) {
          const clash = this.db.uniqueClash(this.table, { ...r, ...patch }, r);
          if (clash) return { data: null, error: clash };
        }
        for (const r of selected) Object.assign(r, patch);
        return this.wantRows ? this.shape(selected) : { data: null, error: null };
      }
      case 'delete': {
        for (const r of selected) rows.splice(rows.indexOf(r), 1);
        return this.wantRows ? this.shape(selected) : { data: null, error: null };
      }
    }
  }
}

export class MemorySupabase {
  calls: RecordedCall[] = [];
  private tables = new Map<string, Row[]>();
  private uniques = new Map<string, UniqueRule[]>();
  private fns = new Map<string, (params: Row, db: MemorySupabase) => unknown | Promise<unknown>>();
  private tokens = new Map<string, Row>();

  /** Seed (or replace) a table; the array returned is live. An empty seed
   *  makes the table exist. */
  table(name: string, rows: Row[] = []): Row[] {
    this.tables.set(name, rows);
    return rows;
  }
  private columnSets = new Map<string, Set<string>>();
  /** Declare a table's columns: a query naming any other one then fails as
   *  PostgREST fails it (42703), instead of passing on a column that does
   *  not exist (bench 2026-09-25: an order by a missing column). */
  columns(name: string, columns: string[]): this {
    this.columnSets.set(name, new Set(columns));
    return this;
  }
  unknownColumn(name: string, used: string[]): string | null {
    const known = this.columnSets.get(name);
    if (!known) return null;
    return used.find((c) => !known.has(c)) ?? null;
  }
  rowsOf(name: string): Row[] {
    const rows = this.tables.get(name);
    if (!rows) throw { code: '42P01', message: `relation "public.${name}" does not exist` } as MemoryError;
    return rows;
  }
  /** A unique index, partial when `where` is given (`released_at IS NULL`). */
  unique(table: string, columns: string[], opts: { name?: string; where?: (row: Row) => boolean } = {}): this {
    const list = this.uniques.get(table) ?? [];
    list.push({ name: opts.name ?? `${table}_${columns.join('_')}_key`, columns, where: opts.where });
    this.uniques.set(table, list);
    return this;
  }
  uniqueClash(table: string, candidate: Row, self: Row | null): MemoryError | null {
    for (const rule of this.uniques.get(table) ?? []) {
      if (rule.where && !rule.where(candidate)) continue;
      if (rule.columns.some((c) => candidate[c] == null)) continue;
      const dup = (this.tables.get(table) ?? []).find((r) => r !== self && (!rule.where || rule.where(r)) && rule.columns.every((c) => r[c] === candidate[c]));
      if (dup) return { code: '23505', message: `duplicate key value violates unique constraint "${rule.name}"`, details: `Key (${rule.columns.join(', ')}) already exists.` };
    }
    return null;
  }
  /** A Postgres function the handlers call through rpc(). Throw to answer with an error. */
  fn(name: string, impl: (params: Row, db: MemorySupabase) => unknown | Promise<unknown>): this {
    this.fns.set(name, impl);
    return this;
  }
  /** A session token auth.getUser answers with this user. */
  jwt(token: string, user: Row): this {
    this.tokens.set(token, user);
    return this;
  }

  from(table: string) {
    const db = this;
    const start = (op: Op, payload?: unknown, opts?: unknown, columns?: string, selectOpts?: { count?: string; head?: boolean }) => {
      const call: RecordedCall = { table, op, payload, opts, filters: [] };
      db.calls.push(call);
      return new MemoryQuery(db, table, op, payload, opts, call, columns, selectOpts);
    };
    return {
      select: (columns?: string, opts?: { count?: string; head?: boolean }) => start('select', columns, undefined, columns, opts),
      insert: (payload: unknown) => start('insert', payload),
      update: (payload: unknown) => start('update', payload),
      upsert: (payload: unknown, opts?: unknown) => start('upsert', payload, opts),
      delete: () => start('delete'),
    };
  }

  async rpc(fn: string, params?: unknown): Promise<MemoryResult> {
    const call: RecordedCall = { table: 'rpc', op: fn, payload: params, filters: [] };
    this.calls.push(call);
    const impl = this.fns.get(fn);
    if (!impl) return { data: null, error: { code: '42883', message: `function public.${fn} does not exist` } };
    try {
      return { data: await impl((params ?? {}) as Row, this), error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { data: null, error: { code: err.code ?? 'P0001', message: err.message ?? String(e) } };
    }
  }

  auth = {
    getUser: (token?: string) => {
      const user = token ? this.tokens.get(token) : undefined;
      return Promise.resolve(user
        ? { data: { user }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT: unable to parse or verify signature', status: 401 } });
    },
  };

  callsTo(table: string, op?: string): RecordedCall[] {
    return this.calls.filter((c) => c.table === table && (!op || c.op === op));
  }
}

/** A table's columns as the migration chain defines them: CREATE TABLE, then
 *  every ALTER TABLE ADD, DROP and RENAME COLUMN, in file order. For
 *  MemorySupabase.columns, so a query on a column the table lacks fails.
 *  The chain is the hand-written migrations here and, in the community
 *  export, the one schema `supabase db dump` wrote in their place. */
export function migrationColumns(table: string): string[] {
  const dir = new URL('../../migrations/', import.meta.url);
  const files = [...Deno.readDirSync(dir)].filter((e) => e.isFile && e.name.endsWith('.sql')).map((e) => e.name).sort();
  return columnsFromSql(files.map((f) => Deno.readTextFileSync(new URL(f, dir))), table);
}

/** The columns `table` has once these SQL files have run in order. The
 *  table is read under every spelling a chain holds: bare, schema.name and
 *  the dump's "schema"."name" (AL.22, owner 2026-10-03: the export's dump
 *  quotes every identifier, which read as no table at all, so three git
 *  tests failed in the export alone); ALTER TABLE ONLY too. */
export function columnsFromSql(sqlFiles: readonly string[], table: string): string[] {
  const name = `(?:"?[A-Za-z_][\\w$]*"?\\.)?"?${table}"?`;
  const skip = /^(constraint|primary|unique|check|foreign|exclude|like)\b/i;
  // The statements on the table, in the order Postgres runs them: a CREATE
  // defines it (IF NOT EXISTS on a table that exists does nothing), a DROP
  // TABLE removes it, and the ALTERs add, drop and rename columns, a rename
  // keeping the column's place as the dump keeps it.
  const statements = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?${name}\\s*\\(|DROP TABLE (?:IF EXISTS )?${name}(?![\\w$])|ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${name}\\s+([^;]+);`,
    'gi',
  );
  let cols: string[] | null = null;
  for (const file of sqlFiles) {
    const sql = file.replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(statements)) {
      const head = m[0].slice(0, 12).toUpperCase();
      if (head.startsWith('DROP TABLE')) { cols = null; continue; }
      if (head.startsWith('CREATE TABLE')) {
        if (cols && /IF NOT EXISTS/i.test(m[0])) continue;
        let depth = 1;
        let i = m.index! + m[0].length;
        const start = i;
        for (; i < sql.length && depth > 0; i++) {
          if (sql[i] === '(') depth++;
          else if (sql[i] === ')') depth--;
        }
        const body = sql.slice(start, i - 1);
        cols = [];
        let part = '';
        let d = 0;
        for (const ch of body + ',') {
          if (ch === '(') d++;
          if (ch === ')') d--;
          if (ch === ',' && d === 0) {
            const col = part.trim().split(/\s+/)[0]?.replace(/"/g, '');
            if (col && !skip.test(part.trim())) cols.push(col);
            part = '';
          } else part += ch;
        }
        continue;
      }
      if (!cols) continue;
      for (const clause of m[1].split(/,(?![^(]*\))/)) {
        const add = /ADD COLUMN (?:IF NOT EXISTS )?"?(\w+)"?/i.exec(clause);
        if (add && !cols.includes(add[1])) cols.push(add[1]);
        const drop = /DROP COLUMN (?:IF EXISTS )?"?(\w+)"?/i.exec(clause);
        if (drop) cols = cols.filter((c) => c !== drop[1]);
        const ren = /RENAME COLUMN "?(\w+)"? TO "?(\w+)"?/i.exec(clause);
        if (ren) cols = cols.map((c) => (c === ren[1] ? ren[2] : c));
      }
    }
  }
  return cols ?? [];
}

// ── the Government build (audit, owner 2026-09-27) ───────────────────────────
// Classification is the Government build's alone. A test that needs it runs
// as that build: self-hosted, NODESPEC_EDITION=government, and a licence of
// the tier given, signed here with a fresh key. The environment and the
// licence cache are put back afterwards.
export function asGovernmentBuild<T>(tier: string, fn: () => Promise<T>): Promise<T> {
  return asSelfHostedInstall(tier, 'government', fn);
}

/** A self-hosted install of the given edition (undefined: an Enterprise or
 *  open source install, which names none) on a licence of the given tier. */
export async function asSelfHostedInstall<T>(tier: string, edition: string | undefined, fn: () => Promise<T>): Promise<T> {
  const { LICENSE_PREFIX } = await import('../_shared/selfhost-license.ts');
  const { resetLicenseTierCache } = await import('../_shared/deployment.ts');
  const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    v: 1, licensee: 'Test Agency', tier, issued: '2026-01-01', expires: '2099-12-31', deployment: 'self-hosted',
  })));
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(payload) as unknown as BufferSource));
  const vars: Record<string, string | undefined> = {
    NODESPEC_DEPLOYMENT: 'self-hosted',
    NODESPEC_EDITION: edition,
    NODESPEC_LICENSE: `${LICENSE_PREFIX}.${payload}.${b64url(sig)}`,
    NODESPEC_LICENSE_PUBLIC_KEY: publicKey,
  };
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  resetLicenseTierCache();
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    resetLicenseTierCache();
  }
}
