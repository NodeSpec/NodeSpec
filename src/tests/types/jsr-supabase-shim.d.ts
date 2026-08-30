// Ambient shim so vitest-side tests can import edge-function modules whose
// type-import chain reaches files using Deno "jsr:" specifiers (which tsc
// cannot resolve). Runtime is unaffected: the edge modules imported by tests
// only use `import type` on that chain, which is erased at transpile.
declare module "jsr:@supabase/supabase-js@2" {
  // deno-lint-ignore no-explicit-any
  export type SupabaseClient = any;
  // deno-lint-ignore no-explicit-any
  export function createClient(...args: unknown[]): any;
}

// N8.3′: _shared/catalog-loader.ts now type-imports the mirror
// _shared/catalog-schemas.ts (the unified AiContext), whose Deno zod specifier
// tsc cannot resolve — map it onto the workspace zod so the mirror type-checks
// in the vitest program with REAL zod types (not any).
declare module "npm:zod@3.22.4" {
  export * from "zod";
}
