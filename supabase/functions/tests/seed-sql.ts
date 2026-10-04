// AA.6: read a demo seed's rows straight from its SQL, so a Deno test can
// measure against the real seed (scripts/seed-demo/*.sql) instead of a copy
// that drifts. Understands exactly what the seeds write: INSERT ... (cols)
// VALUES (...), (...); and INSERT ... SELECT ... FROM (VALUES ...) AS v(cols);
// values are '...' strings ('' escapes), $tag$...$tag$ bodies, numbers,
// true/false/NULL, ARRAY[...] and ::casts (::jsonb parses). Line comments
// between tuples are skipped. Anything else throws, so a seed that outgrows
// this reader fails loudly instead of loading half its rows.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

class Reader {
  i = 0;
  constructor(readonly s: string) {}
  ws() {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
      if (this.s.startsWith("--", this.i)) { while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++; continue; }
      return;
    }
  }
  peek(t: string) { this.ws(); return this.s.startsWith(t, this.i); }
  eat(t: string) { this.ws(); if (!this.s.startsWith(t, this.i)) throw new Error(`seed-sql: expected ${t} at ${this.s.slice(this.i, this.i + 60)}`); this.i += t.length; }
  ident(): string {
    this.ws();
    const m = /^[A-Za-z_][\w.]*/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`seed-sql: expected a name at ${this.s.slice(this.i, this.i + 60)}`);
    this.i += m[0].length;
    return m[0];
  }
  value(): unknown {
    this.ws();
    let v: unknown;
    const c = this.s[this.i];
    if (c === "'") {
      let out = "";
      this.i++;
      for (;;) {
        const j = this.s.indexOf("'", this.i);
        if (j < 0) throw new Error("seed-sql: unterminated string");
        out += this.s.slice(this.i, j);
        this.i = j + 1;
        if (this.s[this.i] === "'") { out += "'"; this.i++; continue; }
        break;
      }
      v = out;
    } else if (c === "$") {
      const m = /^\$(\w*)\$/.exec(this.s.slice(this.i));
      if (!m) throw new Error("seed-sql: bad dollar quote");
      const tag = m[0];
      const end = this.s.indexOf(tag, this.i + tag.length);
      v = this.s.slice(this.i + tag.length, end);
      this.i = end + tag.length;
    } else if (this.s.startsWith("ARRAY[", this.i)) {
      this.i += 6;
      const items: unknown[] = [];
      while (!this.peek("]")) { items.push(this.value()); if (this.peek(",")) this.eat(","); }
      this.eat("]");
      v = items;
    } else {
      const m = /^(-?\d+(?:\.\d+)?|true|false|NULL|null)/i.exec(this.s.slice(this.i));
      if (!m) throw new Error(`seed-sql: unsupported value at ${this.s.slice(this.i, this.i + 60)}`);
      this.i += m[0].length;
      const w = m[0].toLowerCase();
      v = w === "null" ? null : w === "true" ? true : w === "false" ? false : Number(m[0]);
    }
    while (this.peek("::")) {
      this.eat("::");
      const t = this.ident();
      if (this.peek("[]")) this.eat("[]");
      if (t === "jsonb" && typeof v === "string") v = JSON.parse(v);
    }
    return v;
  }
  tuple(): unknown[] {
    this.eat("(");
    const out: unknown[] = [];
    while (!this.peek(")")) { out.push(this.value()); if (this.peek(",")) this.eat(","); }
    this.eat(")");
    return out;
  }
  tuples(): unknown[][] {
    const out: unknown[][] = [this.tuple()];
    while (this.peek(",")) { this.eat(","); out.push(this.tuple()); }
    return out;
  }
  skipParens() {
    this.eat("(");
    for (let depth = 1; depth > 0 && this.i < this.s.length; this.i++) {
      if (this.s[this.i] === "(") depth++;
      else if (this.s[this.i] === ")") depth--;
      if (depth === 0) break;
    }
    this.i++;
  }
  names(): string[] {
    this.eat("(");
    const out: string[] = [];
    while (!this.peek(")")) { out.push(this.ident()); if (this.peek(",")) this.eat(","); }
    this.eat(")");
    return out;
  }
}

/** Every row the seed inserts into `table`, as objects keyed by column. */
export function seedRows(sql: string, table: string): Row[] {
  const rows: Row[] = [];
  const head = `INSERT INTO public.${table}`;
  for (let at = sql.indexOf(head); at >= 0; at = sql.indexOf(head, at + head.length)) {
    const r = new Reader(sql);
    r.i = at + head.length;
    if (!r.peek("(")) continue;
    const cols = r.names();
    if (r.peek("VALUES")) {
      r.eat("VALUES");
      for (const t of r.tuples()) rows.push(Object.fromEntries(cols.map((c, k) => [c, t[k]])));
      continue;
    }
    // INSERT ... SELECT v.col::type, 'literal', ... FROM (VALUES ...) AS v(cols)
    r.eat("SELECT");
    const exprs: Array<{ from?: string; literal?: unknown }> = [];
    for (;;) {
      if (r.peek("'") || r.peek("$")) exprs.push({ literal: r.value() });
      else {
        const name = r.ident();
        if (r.peek("(")) { r.skipParens(); exprs.push({}); } // a function call: not modelled
        else exprs.push({ from: name.replace(/^v\./, "") });
        while (r.peek("::")) { r.eat("::"); r.ident(); }
      }
      if (r.peek(",")) { r.eat(","); continue; }
      break;
    }
    r.eat("FROM"); r.eat("("); r.eat("VALUES");
    const tuples = r.tuples();
    r.eat(")"); r.eat("AS"); r.ident();
    const vcols = r.names();
    for (const t of tuples) {
      const v = Object.fromEntries(vcols.map((c, k) => [c, t[k]]));
      rows.push(Object.fromEntries(cols.map((c, k) => [c, exprs[k]?.from !== undefined ? v[exprs[k].from!] : exprs[k]?.literal ?? null])));
    }
  }
  return rows;
}
