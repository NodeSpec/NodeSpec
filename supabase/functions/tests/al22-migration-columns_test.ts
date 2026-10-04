// AL.22 (owner 2026-10-03: "OSS Export Yaml still failed"): three git tests
// passed here and failed in the community export, where supabase/migrations
// is the one schema `supabase db dump` writes. The dump quotes every
// identifier ("public"."git_sync_log"), the column reader took that for no
// table at all, and a table with no columns refuses every query. The reader
// now takes each spelling a chain holds, and the same read answers the same
// columns in both trees: this file runs in both.
import { columnsFromSql, migrationColumns, MemorySupabase, assert, assertEquals } from './helpers.ts';

// A hand-written migration, as this repository's chain spells it.
const HAND = `
CREATE TABLE IF NOT EXISTS git_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES git_integrations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('push', 'pull')),
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT git_sync_log_status_check CHECK (status IN ('pending', 'success', 'failed'))
);
ALTER TABLE git_sync_log ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE git_sync_log ADD COLUMN commented_out text;
`;
const LATER = `
ALTER TABLE public.git_sync_log ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb, ADD COLUMN patches integer DEFAULT 0;
ALTER TABLE git_sync_log RENAME COLUMN patches TO patches_synced;
ALTER TABLE git_sync_log DROP COLUMN IF EXISTS status;
ALTER TABLE git_sync_log ALTER COLUMN direction DROP NOT NULL;
`;
// pg_dump as it comes.
const DUMP_PLAIN = `
CREATE TABLE public.git_sync_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT git_sync_log_direction_check CHECK ((direction = ANY (ARRAY['push'::text, 'pull'::text])))
);
ALTER TABLE ONLY public.git_sync_log
    ADD CONSTRAINT git_sync_log_pkey PRIMARY KEY (id);
`;
// pg_dump as `supabase db dump` runs it: every identifier quoted, IF NOT EXISTS added.
const DUMP_CLI = `
CREATE TABLE IF NOT EXISTS "public"."git_sync_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "git_sync_log_direction_check" CHECK (("direction" = ANY (ARRAY['push'::"text", 'pull'::"text"])))
);
ALTER TABLE "public"."git_sync_log" OWNER TO "postgres";
ALTER TABLE ONLY "public"."git_sync_log"
    ADD CONSTRAINT "git_sync_log_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."git_sync_log" ADD COLUMN "completed_at" timestamp with time zone;
CREATE TABLE IF NOT EXISTS "public"."git_sync_log_archive" (
    "row_id" "uuid" NOT NULL
);
`;

Deno.test('AL.22 columns: a hand-written chain, in file order, with adds, a rename, a drop and a comment', () => {
  assertEquals(columnsFromSql([HAND], 'git_sync_log'), ['id', 'integration_id', 'direction', 'status', 'started_at']);
  assertEquals(columnsFromSql([HAND, LATER], 'git_sync_log'), ['id', 'integration_id', 'direction', 'started_at', 'metadata', 'patches_synced']);
  assertEquals(columnsFromSql([HAND, LATER, 'ALTER TABLE git_sync_log ADD COLUMN status text;'], 'git_sync_log'),
    ['id', 'integration_id', 'direction', 'started_at', 'metadata', 'patches_synced', 'status'], 'file order is the order: a column dropped then added again comes last');
  assertEquals(columnsFromSql([HAND], 'git_integrations'), [], 'another table is not this one');
});

Deno.test('AL.22 columns: statements run in order, as Postgres runs them', () => {
  // A rename keeps the column's place, as the dump keeps it.
  assertEquals(columnsFromSql(['CREATE TABLE t (a int, b int, c int); ALTER TABLE t RENAME COLUMN b TO x;'], 't'), ['a', 'x', 'c']);
  // IF NOT EXISTS on a table or a column that exists does nothing.
  assertEquals(columnsFromSql([HAND, 'CREATE TABLE IF NOT EXISTS git_sync_log (ghost text);'], 'git_sync_log'), ['id', 'integration_id', 'direction', 'status', 'started_at']);
  assertEquals(columnsFromSql([HAND, 'ALTER TABLE git_sync_log ADD COLUMN IF NOT EXISTS status text;'], 'git_sync_log'), ['id', 'integration_id', 'direction', 'status', 'started_at']);
  // A dropped table has no columns; created again, it has the new ones only.
  assertEquals(columnsFromSql([HAND, 'DROP TABLE git_sync_log;'], 'git_sync_log'), []);
  assertEquals(columnsFromSql([HAND, 'DROP TABLE IF EXISTS "public"."git_sync_log" CASCADE;\nCREATE TABLE IF NOT EXISTS "public"."git_sync_log" ("only" "text");'], 'git_sync_log'), ['only']);
  // Dropping a longer name, or altering a table before it exists, is not this table.
  assertEquals(columnsFromSql([HAND, 'DROP TABLE git_sync_log_archive;'], 'git_sync_log'), ['id', 'integration_id', 'direction', 'status', 'started_at']);
  assertEquals(columnsFromSql([LATER, HAND], 'git_sync_log'), ['id', 'integration_id', 'direction', 'status', 'started_at']);
});

Deno.test('AL.22 columns: the plain dump and the dump the export carries read the same table', () => {
  assertEquals(columnsFromSql([DUMP_PLAIN], 'git_sync_log'), ['id', 'started_at', 'metadata']);
  assertEquals(columnsFromSql([DUMP_CLI], 'git_sync_log'), ['id', 'started_at', 'metadata', 'completed_at']);
  assertEquals(columnsFromSql([DUMP_CLI], 'git_sync_log_archive'), ['row_id'], 'a longer name is its own table');
});

Deno.test('AL.22 columns: what the export did, on its own dump: the table read as empty and refused the read the code makes', async () => {
  const before = new MemorySupabase().columns('git_sync_log', []);
  before.table('git_sync_log', []);
  const refused = await before.from('git_sync_log').select('commit_sha, branch_id, status, metadata').eq('direction', 'push').order('started_at', { ascending: false });
  assertEquals(refused.error?.code, '42703');
  const after = new MemorySupabase().columns('git_sync_log', columnsFromSql([DUMP_CLI], 'git_sync_log'));
  after.table('git_sync_log', []);
  const read = await after.from('git_sync_log').select('id, metadata').order('started_at', { ascending: false });
  assertEquals(read.error, null);
});

Deno.test('AL.22 columns: the chain on disk, hand-written here or dumped in the export, answers the table as it is', () => {
  // The columns git_sync_log has, in the order its CREATE TABLE gives them
  // (the dump keeps that order). The same list in both trees.
  assertEquals(migrationColumns('git_sync_log'), [
    'id', 'integration_id', 'project_id', 'branch_id', 'direction', 'commit_sha', 'status',
    'error_message', 'patches_synced', 'started_at', 'completed_at', 'metadata',
  ]);
  assert(migrationColumns('no_such_table_anywhere').length === 0);
});
