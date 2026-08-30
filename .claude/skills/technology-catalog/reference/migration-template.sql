-- <TIMESTAMP>_<slug>.sql — technology_catalog change.
-- Template for the repo's migration pattern. Worked examples:
--   supabase/migrations/20260731120000_m0_catalog_data_repairs.sql   (repairs + re-filings)
--   supabase/migrations/20260731170000_m3_role_rows.sql              (new rows + merges)
--
-- Timestamp must be AFTER the current head:  ls supabase/migrations | tail -1
--
-- WHY THIS SHAPE. Every statement below is idempotent or guarded, and the file ENDS with a
-- verification block that RAISEs. A migration that half-applies leaves the catalog in a
-- state no one designed; one that aborts leaves it exactly as it was.

-- ═══ 0. PRE-FLIGHT — refuse to run against a catalog you did not expect ════════════════
-- Cheap insurance when the change assumes a specific starting state (a role exists, a row
-- is filed a certain way). Skip only if the change is unconditional.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO missing
  FROM unnest(ARRAY['<role-id-this-migration-files-onto>']) r
  WHERE NOT EXISTS (SELECT 1 FROM public.node_roles WHERE id = r);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: role(s) % do not exist — file the row on a real role, '
                    'or add the role first (node_roles is a validateCatalogFiling change)', missing;
  END IF;
END $$;

-- ═══ 1. INSERT new technology rows ═════════════════════════════════════════════════════
-- ON CONFLICT DO NOTHING so a re-run is safe. Never write `search_vector` (generated).
INSERT INTO public.technology_catalog
  (id, name, display_name, brand_color, secondary_color, icon_url,
   role_affinities, ai_context, suggested_files, metadata_schema, common_connections,
   node_shape, is_user_contributed)
VALUES
  ('<provider-prefix->id',
   '<Official Product Name>',
   NULL,                                    -- display_name only when it differs meaningfully
   '#000000', NULL, NULL,
   -- ONE affinity unless a second is genuinely a different architecture.
   -- Two live LEAF affinities = a picker on every drop.
   '["<primary-role-id>"]'::jsonb,
   jsonb_build_object(
     'purpose',       '<2-4 sentences: what it is, WHEN to choose it, and when NOT to>',
     'bestPractices', jsonb_build_array('<architecture-level>', '<not tutorial steps>'),
     'antiPatterns',  jsonb_build_array('<what goes wrong>', '<and why>'),
     'typicalTech',   jsonb_build_array('<co-occurring technologies>'),
     -- UNSET for frameworks (deliberate, 4d-1). See SKILL.md for the full table.
     'configMode',    'declarative',
     'provenance',    jsonb_build_object(
                        'method',     'live-docs',        -- or 'model-knowledge', honestly
                        'verifiedAt', '<YYYY-MM-DD>',
                        'sources',    jsonb_build_array('<vendor docs url>'),
                        'notes',      '<what you actually verified>')
   ),
   '[{"kind":"source","path":"<idiomatic/path>"}]'::jsonb,
   -- metadata_schema: ARCHITECTURE decisions only. No connection strings, no request
   -- knobs, NO VERSION ENUMS — name the model, not the number.
   jsonb_build_object(
     '<fieldName>', jsonb_build_object(
       'type', 'string', 'label', '<Human Label>',
       'options', jsonb_build_array('<a>', '<b>'), 'default', '<a>',
       'description', '<what this decides>')
   ),
   '[{"id":"<related-tech-id>","reason":"<why they connect>"}]'::jsonb,
   'rounded', false)
ON CONFLICT (id) DO NOTHING;

-- ═══ 2. RE-FILE an existing row's affinities ═══════════════════════════════════════════
-- Replace the whole array rather than appending — appending is how rows grow a picker.
-- SIMULATE THIS AGAINST THE LIVE EXPORT FIRST. An M0 repoint that looked obviously correct
-- would have created a NEW two-option picker for celery-beat; only simulation caught it.
UPDATE public.technology_catalog
SET role_affinities = '["<correct-role-id>"]'::jsonb, updated_at = now()
WHERE id IN ('<tech-id>');

-- ═══ 3. ENRICH without clobbering ══════════════════════════════════════════════════════
-- `||` merges at the top level, so this preserves keys you are not setting.
UPDATE public.technology_catalog
SET ai_context = COALESCE(ai_context, '{}'::jsonb) || jsonb_build_object(
      'configMode', 'declarative',
      'provenance', jsonb_build_object('method', 'model-knowledge',
                                       'verifiedAt', '<YYYY-MM-DD>',
                                       'notes', '<freshness candidate: not doc-verified>')
    ),
    updated_at = now()
WHERE id IN ('<tech-id>');

-- ═══ VERIFICATION — raises rather than half-applying ═══════════════════════════════════
DO $$
DECLARE bad int; detail text;
BEGIN
  -- 1. every affinity resolves (the M5 trigger enforces this too; a named error is kinder)
  SELECT count(*), string_agg(DISTINCT t.id || ' -> ' || aff, ', ')
    INTO bad, detail
  FROM public.technology_catalog t, jsonb_array_elements_text(t.role_affinities) aff
  WHERE NOT EXISTS (SELECT 1 FROM public.node_roles r WHERE r.id = aff);
  IF bad > 0 THEN
    RAISE EXCEPTION 'dangling role_affinity(ies): % — the row(s) would be INVISIBLE in the palette', detail;
  END IF;

  -- 2. the rows this migration touched actually exist and are placeable
  SELECT count(*) INTO bad
  FROM unnest(ARRAY['<tech-id>']) x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.technology_catalog t
    WHERE t.id = x AND jsonb_array_length(COALESCE(t.role_affinities, '[]'::jsonb)) > 0
  );
  IF bad > 0 THEN RAISE EXCEPTION '% expected row(s) missing or unplaceable', bad; END IF;

  -- 3. no row this migration touched grew a drop-time picker
  SELECT count(*), string_agg(t.id, ', ') INTO bad, detail
  FROM public.technology_catalog t
  WHERE t.id = ANY (ARRAY['<tech-id>'])
    AND (SELECT count(*) FROM jsonb_array_elements_text(t.role_affinities) aff
         JOIN public.node_roles r ON r.id = aff
         WHERE r.is_container IS NOT TRUE AND r.deprecated IS NOT TRUE) > 1;
  IF bad > 0 THEN
    RAISE EXCEPTION 'row(s) % now have 2+ live LEAF affinities — every drop will show a picker. '
                    'Intended? If so, delete this check with a comment saying why', detail;
  END IF;

  RAISE NOTICE 'catalog change verified.';
END $$;

-- ═══ RESULT ════════════════════════════════════════════════════════════════════════════
-- <One or two lines: what a user can now do that they could not before, and what the AI
--  receives that it did not. If the change fixes a mis-filing, say what was wrong.>
