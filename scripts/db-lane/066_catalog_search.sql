-- db-lane 066: the catalog search finds the thing named.
--
--   Owner's report 2026-09-21: search_catalog('postgres') answered ten rows
--   that MENTION Postgres and never PostgreSQL itself. The cause is the
--   english stemmer: 'postgres' becomes the lexeme 'postgr' (it reads the
--   trailing "es" as a plural) while 'PostgreSQL' stays 'postgresql', so the
--   row could not match at that query at all. The same read found
--   search_catalog('postgresql') ranking azure-cosmos-db-for-postgresql
--   ABOVE postgresql, because ts_rank_cd rewards term density.
--
--   This file runs the real function (migration 20260921140000) on real
--   rows. It plants its own probe rows first, so the mechanism is proven
--   deterministically whatever the catalog holds, and then asserts the
--   owner's actual case against the shipped rows when they are present.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
BEGIN
  IF to_regprocedure('public.search_relevant_technologies(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 066: search_relevant_technologies(text, integer) is missing. Apply migration 20260317014759.';
  END IF;

  -- The shape of the bug, planted: a row NAMED with the long spelling, and
  -- three decoys that merely mention the short one in their purpose.
  INSERT INTO public.technology_catalog (id, name, brand_color, role_affinities, ai_context, is_user_contributed) VALUES
    ('db66-probeglot',        'Probeglot',        '#123456', '[]'::jsonb,
     '{"purpose": "A probe row for db-lane 066.", "provenance": {"verifiedAt": "2026-09-21", "method": "model-knowledge"}}'::jsonb, false),
    ('db66-probeglotql',      'Probeglotql',      '#123456', '[]'::jsonb,
     '{"purpose": "A probe row whose NAME carries the long spelling.", "provenance": {"verifiedAt": "2026-09-21", "method": "model-knowledge"}}'::jsonb, false),
    ('db66-mentions-a',       'Decoy Alpha',      '#123456', '[]'::jsonb,
     '{"purpose": "Runs on Probeglot and speaks Probeglot and hosts Probeglot for Probeglot users.", "provenance": {"verifiedAt": "2026-09-21", "method": "model-knowledge"}}'::jsonb, false),
    ('db66-mentions-b',       'Decoy Beta',       '#123456', '[]'::jsonb,
     '{"purpose": "Probeglot Probeglot Probeglot, a managed Probeglot service.", "provenance": {"verifiedAt": "2026-09-21", "method": "model-knowledge"}}'::jsonb, false),
    ('db66-for-probeglotql',  'Decoy For Probeglotql', '#123456', '[]'::jsonb,
     '{"purpose": "A managed Probeglotql, compatible with Probeglotql wire protocol.", "provenance": {"verifiedAt": "2026-09-21", "method": "model-knowledge"}}'::jsonb, false);
END $$;

-- ── 1. the stemmer's shape, on the probe rows ────────────────────────────────
DO $$
DECLARE
  first_id text;
  ids text[];
BEGIN
  -- the long spelling stems to its own lexeme; the short one does not reach it
  IF to_tsvector('english', 'Probeglotql') @@ plainto_tsquery('english', 'probeglot') THEN
    RAISE EXCEPTION 'db-lane 066: the fixture no longer reproduces the stemmer gap this file exists for';
  END IF;

  -- THE REPORT: the short spelling must still answer the row named with the long one, FIRST
  SELECT array_agg(tech_id ORDER BY rank DESC, tech_name) INTO ids
    FROM public.search_relevant_technologies('probeglotql', 10);
  first_id := ids[1];
  IF first_id <> 'db66-probeglotql' THEN
    RAISE EXCEPTION 'db-lane 066: the row NAMED Probeglotql must rank first for its own name, got %', ids;
  END IF;

  SELECT array_agg(tech_id ORDER BY rank DESC, tech_name) INTO ids
    FROM public.search_relevant_technologies('probeglot', 10);
  IF NOT ('db66-probeglotql' = ANY(ids)) THEN
    RAISE EXCEPTION 'db-lane 066: a prefix of the name must REACH the row (the stemmer gap), got %', ids;
  END IF;
  IF ids[1] <> 'db66-probeglot' THEN
    RAISE EXCEPTION 'db-lane 066: the exact name still wins over its own prefix relatives, got %', ids;
  END IF;

  -- density never beats exactness: the decoys repeat the word, the named row is the answer
  IF array_position(ids, 'db66-probeglotql') > array_position(ids, 'db66-mentions-b')
     AND array_position(ids, 'db66-mentions-b') IS NOT NULL THEN
    RAISE EXCEPTION 'db-lane 066: a row that merely MENTIONS the word outranks the row named with it, got %', ids;
  END IF;

  -- case never decides
  SELECT array_agg(tech_id ORDER BY rank DESC, tech_name) INTO ids
    FROM public.search_relevant_technologies('PROBEGLOTQL', 5);
  IF ids[1] <> 'db66-probeglotql' THEN
    RAISE EXCEPTION 'db-lane 066: the search is case blind, got %', ids;
  END IF;

  -- a hyphenated id is reachable by its spaced words ("aws s3" names aws-s3)
  SELECT array_agg(tech_id ORDER BY rank DESC, tech_name) INTO ids
    FROM public.search_relevant_technologies('db66 mentions a', 10);
  IF NOT ('db66-mentions-a' = ANY(ids)) THEN
    RAISE EXCEPTION 'db-lane 066: a spaced query must reach the hyphenated id, got %', ids;
  END IF;
END $$;

-- ── 2. it stays a search: no match is still no match ─────────────────────────
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.search_relevant_technologies('zzzqqxnothinghere', 10);
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 066: a word in no row must answer nothing, got % rows', n; END IF;

  SELECT count(*) INTO n FROM public.search_relevant_technologies('', 10);
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 066: an empty query answers nothing, got % rows', n; END IF;

  SELECT count(*) INTO n FROM public.search_relevant_technologies('   ', 10);
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 066: a blank query answers nothing, got % rows', n; END IF;

  -- the cap is honoured
  SELECT count(*) INTO n FROM public.search_relevant_technologies('probeglot', 2);
  IF n > 2 THEN RAISE EXCEPTION 'db-lane 066: max_results is a cap, got % rows', n; END IF;

  -- a query that is ALL stopwords used to raise "no operand in tsquery" from the
  -- concatenated query build; it must answer, not throw
  SELECT count(*) INTO n FROM public.search_relevant_technologies('probeglot the', 5);
  IF n = 0 THEN RAISE EXCEPTION 'db-lane 066: a trailing stopword must not erase the search'; END IF;
  PERFORM public.search_relevant_technologies('the', 5);
  PERFORM public.search_relevant_technologies('the and of', 5);
END $$;

-- ── 3. the owner's actual case, on the shipped rows ──────────────────────────
DO $$
DECLARE ids text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.technology_catalog WHERE id = 'postgresql') THEN
    RAISE NOTICE 'db-lane 066: the shipped postgresql row is absent (starter catalog) — probe rows carried the proof';
    RETURN;
  END IF;

  SELECT array_agg(tech_id ORDER BY rank DESC, tech_name) INTO ids
    FROM public.search_relevant_technologies('postgres', 10);
  IF ids[1] <> 'postgresql' THEN
    RAISE EXCEPTION 'db-lane 066: search_catalog(''postgres'') must lead with PostgreSQL (the owner''s report), got %', ids;
  END IF;

  SELECT array_agg(tech_id ORDER BY rank DESC, tech_name) INTO ids
    FROM public.search_relevant_technologies('postgresql', 10);
  IF ids[1] <> 'postgresql' THEN
    RAISE EXCEPTION 'db-lane 066: the row named PostgreSQL outranks the rows that merely mention it, got %', ids;
  END IF;

  -- the other common short spellings a person actually types
  FOR ids IN
    SELECT array_agg(tech_id ORDER BY rank DESC, tech_name)
      FROM public.search_relevant_technologies('redis', 5)
  LOOP
    IF ids[1] <> 'redis' THEN RAISE EXCEPTION 'db-lane 066: redis leads its own search, got %', ids; END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'db-lane 066: the row named by a query leads it — a prefix reaches the longer name past the stemmer, exactness beats term density, case and hyphens never decide, and a stopword never erases the search';
END $$;

ROLLBACK;
