-- technology_catalog audit queries.
-- Run before and after any catalog change. Sections 1-4 must return ZERO rows.
-- Sections 5+ are informational — they surface things worth a human look.
--
-- RUN THESE AGAINST A FULLY-MIGRATED DATABASE. A migration that deletes roles and a
-- migration that repoints the affinities pointing at them are often the same file, so a
-- half-applied state reports dangling references that the completed run resolves. Use
-- `supabase db reset` (replays everything in order), not a partial push.

-- ═══ 1. INVISIBLE ROWS — an affinity that does not resolve ═════════════════════════════
-- The silent failure: the builder skips the row, nothing raises, the table looks fine.
-- This is how quartz / deno-edge / vercel-edge stayed unplaceable.
-- The M5 trigger assert_role_affinities_resolve() now blocks new ones at write time.
SELECT t.id, aff AS dangling_affinity
FROM public.technology_catalog t,
     jsonb_array_elements_text(t.role_affinities) aff
WHERE NOT EXISTS (SELECT 1 FROM public.node_roles r WHERE r.id = aff)
ORDER BY t.id;

-- ═══ 2. UNPLACEABLE ROWS — no affinities at all ════════════════════════════════════════
-- A system row with no affinity can never be dropped. User-contributed rows are exempt:
-- they are placed directly rather than browsed.
SELECT id, name
FROM public.technology_catalog
WHERE COALESCE(jsonb_array_length(role_affinities), 0) = 0
  AND is_user_contributed IS NOT TRUE
ORDER BY id;

-- ═══ 3. ALL AFFINITIES DEPRECATED — resolves, but every target is dead ═════════════════
-- Passes the trigger (the ids exist) and is still invisible in the palette.
SELECT t.id, t.role_affinities
FROM public.technology_catalog t
WHERE jsonb_array_length(COALESCE(t.role_affinities, '[]'::jsonb)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(t.role_affinities) aff
    JOIN public.node_roles r ON r.id = aff
    WHERE r.deprecated IS NOT TRUE
  )
ORDER BY t.id;

-- ═══ 4. PROVIDER PREFIX MISSING ════════════════════════════════════════════════════════
-- A provider-branded row without its prefix breaks provider inference: the containment
-- coherence rule refuses it inside its own platform, and the capability-equivalence note
-- never fires. The four legacy strays are registered in core/src/provider-inference.ts;
-- do not add a fifth — rename instead.
SELECT id, name
FROM public.technology_catalog
WHERE id NOT LIKE 'aws-%' AND id NOT LIKE 'azure-%' AND id NOT LIKE 'gcp-%'
  AND id NOT LIKE 'supabase-%' AND id NOT LIKE 'firebase-%' AND id NOT LIKE 'cloudflare-%'
  AND id NOT IN ('aurora','dynamodb','ec2','cosmosdb')          -- registered strays
  -- The legacy whole-platform rows ("Amazon Web Services", "Google Cloud Platform") are a
  -- second row for a thing the Structure section already lists from the ROLE, so
  -- isPlatformOnlyTechnology() suppresses them in the palette. They are known and kept for
  -- existing nodes carrying `technology: 'aws'` — not prefix violations.
  AND id NOT IN ('aws','azure','gcp','supabase','firebase','cloudflare','vercel','netlify')
  AND (name ILIKE 'aws %' OR name ILIKE 'amazon %' OR name ILIKE 'azure %'
    OR name ILIKE 'google cloud%' OR name ILIKE 'gcp %' OR name ILIKE 'cloudflare %')
ORDER BY id;

-- ═══ 5. PICKER PRESSURE — how many live LEAF affinities per row ════════════════════════
-- 1 = silent drop (the goal). 2+ = a "how are you using this?" picker on EVERY drop.
-- 0 with a non-empty affinity list means container-only affinities, which drop nothing.
SELECT t.id,
       count(*) FILTER (WHERE r.is_container IS NOT TRUE AND r.deprecated IS NOT TRUE) AS live_leaves,
       count(*) FILTER (WHERE r.is_container IS TRUE     AND r.deprecated IS NOT TRUE) AS live_containers,
       t.role_affinities
FROM public.technology_catalog t
LEFT JOIN LATERAL jsonb_array_elements_text(t.role_affinities) aff ON TRUE
LEFT JOIN public.node_roles r ON r.id = aff
GROUP BY t.id, t.role_affinities
HAVING count(*) FILTER (WHERE r.is_container IS NOT TRUE AND r.deprecated IS NOT TRUE) <> 1
ORDER BY live_leaves DESC, t.id;

-- ═══ 6. configMode COVERAGE BY CLASS ═══════════════════════════════════════════════════
-- Unset is CORRECT for frameworks (the 4d-1 standing rule) and wrong for managed services.
-- Read the split, do not bulk-stamp.
SELECT COALESCE(t.ai_context ->> 'configMode', '(unset)') AS config_mode,
       count(*) AS rows,
       count(*) FILTER (WHERE t.id ~ '^(aws|azure|gcp|supabase|firebase|cloudflare)-') AS provider_branded,
       string_agg(t.id, ', ' ORDER BY t.id) FILTER (
         WHERE t.id ~ '^(aws|azure|gcp|supabase|firebase|cloudflare)-') AS provider_rows
FROM public.technology_catalog t
GROUP BY 1 ORDER BY rows DESC;

-- Provider-branded rows with NO configMode — these fall through to the generic ownership
-- path and usually want 'declarative' (or 'code' for a user-code runtime).
SELECT id, name, role_affinities
FROM public.technology_catalog
WHERE id ~ '^(aws|azure|gcp|supabase|firebase|cloudflare)-'
  AND ai_context ->> 'configMode' IS NULL
ORDER BY id;

-- ═══ 7. ENRICHMENT COMPLETENESS ════════════════════════════════════════════════════════
SELECT id, name,
       (ai_context ? 'purpose')       AS has_purpose,
       (ai_context ? 'bestPractices') AS has_best_practices,
       (ai_context ? 'antiPatterns')  AS has_anti_patterns,
       (ai_context ? 'provenance')    AS has_provenance,
       COALESCE(jsonb_array_length(COALESCE(metadata_schema_keys.k, '[]'::jsonb)), 0) AS schema_fields
FROM public.technology_catalog
LEFT JOIN LATERAL (
  SELECT jsonb_agg(key) AS k FROM jsonb_object_keys(metadata_schema) key
) metadata_schema_keys ON TRUE
WHERE NOT (ai_context ? 'purpose')
   OR NOT (ai_context ? 'bestPractices')
   OR NOT (ai_context ? 'antiPatterns')
ORDER BY id;

-- ═══ 8. FRESHNESS — rows whose guidance was never verified against docs ════════════════
-- `model-knowledge` is an honest label, not a defect. But for a fast-moving product it is
-- a freshness candidate: fetch the docs and upgrade to `live-docs`.
SELECT id, name,
       ai_context -> 'provenance' ->> 'method'     AS method,
       ai_context -> 'provenance' ->> 'verifiedAt' AS verified_at
FROM public.technology_catalog
WHERE ai_context -> 'provenance' ->> 'method' IS DISTINCT FROM 'live-docs'
ORDER BY (ai_context -> 'provenance' ->> 'verifiedAt') NULLS FIRST, id;

-- ═══ 9. POSSIBLE DUPLICATES — same product under two ids ═══════════════════════════════
-- Three duplicate pairs shipped before anyone checked. Fuzzy, so eyeball the output.
SELECT a.id AS id_a, b.id AS id_b, a.name AS name_a, b.name AS name_b
FROM public.technology_catalog a
JOIN public.technology_catalog b
  ON a.id < b.id
 AND (
      lower(regexp_replace(a.name, '[^a-z0-9]', '', 'gi'))
        = lower(regexp_replace(b.name, '[^a-z0-9]', '', 'gi'))
   OR lower(regexp_replace(a.id, '^(aws|azure|gcp|supabase|firebase|cloudflare)-', ''))
        = lower(regexp_replace(b.id, '^(aws|azure|gcp|supabase|firebase|cloudflare)-', ''))
 )
ORDER BY a.id;

-- ═══ 10. ROLE STARVATION — a live role no technology can be dropped onto ═══════════════
-- Not always a defect (hardware roles are legitimately technology-less), but a starved
-- non-hardware role usually means an affinity is filed on the wrong role. This is the
-- query that surfaced the gap queue: aws-ecr / azure-container-registry filed
-- `object-storage` while `container-registry` sat starved, because the role did not exist
-- yet. A newly-added role shows here until its technologies are re-filed onto it.
SELECT r.id, r.label, r.palette_category, r.nature
FROM public.node_roles r
WHERE r.deprecated IS NOT TRUE
  AND r.is_container IS NOT TRUE
  AND r.palette_category NOT IN ('Hardware', 'requirements', 'Logical')
  AND NOT EXISTS (
    SELECT 1 FROM public.technology_catalog t
    WHERE t.role_affinities @> to_jsonb(r.id)
  )
ORDER BY r.palette_category, r.id;
