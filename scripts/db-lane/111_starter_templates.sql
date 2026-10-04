-- db-lane 111: the shipped templates match the data model (AL.15, owner
-- 2026-10-02).
--
--   Before    five official templates, whatever the database held: on a
--             chain that already ran the migration the two retired ones are
--             planted again, and AWS, GCP and GitOps are rewound to another
--             name and a specification without workflows or constraints, so
--             the delete, its cascade and the three rewrites run here every
--             time; a usage row and an upvote sit on the Unity one.
--   After     the Stripe and Unity templates are gone, their usage and upvote
--             rows with them; AWS and GCP read as Starter Projects and the
--             GitOps pipeline keeps its slug under its new name; each of the
--             three carries two workflows, ten outcomes and seven constraints
--             in template_specification; every outcome derives requirements
--             the template carries and no requirement is left underived;
--             every step index is a step of its workflow; every criterion is
--             claimed exactly once; every constraint has a kind the table
--             accepts and names a workflow the template has.
--   Replay    the second run changes nothing: updated_at stands.
--
-- Behaviour, not text (V3 5.1). Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_user uuid := 'db111000-0000-4000-8000-000000000001';
  v_unity uuid;
BEGIN
  IF to_regclass('public.project_templates') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 20260220230921 (project_templates) first';
  END IF;
  IF to_regclass('public.template_upvotes') IS NULL OR to_regclass('public.template_usage') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 20260221044051 (template_upvotes, after template_usage) first';
  END IF;
  IF (SELECT count(*) FROM public.project_templates
      WHERE slug IN ('aws-fullstack-webapp', 'gcp-fullstack-webapp', 'supabase-gitops-pipeline')) <> 3 THEN
    RAISE EXCEPTION 'db-lane 111: the AWS, GCP and GitOps templates must be present (apply the seed migrations first)';
  END IF;
  -- a chain past this migration has no retired templates: plant them again
  INSERT INTO public.project_templates (slug, name, graph_data, author_type)
  SELECT s, 'db-lane 111 ' || s,
         jsonb_build_object('id', 'g111-' || s, 'schemaVersion', 8, 'nodes', '{}'::jsonb, 'edges', '{}'::jsonb,
                            'contracts', '{}'::jsonb, 'artifacts', '{}'::jsonb), 'official'
    FROM unnest(ARRAY['nextjs-supabase-stripe-saas', 'unity-ai-platformer']) s
   WHERE NOT EXISTS (SELECT 1 FROM public.project_templates t WHERE t.slug = s);
  -- and the three it rewrites read as they did before it
  UPDATE public.project_templates
     SET name = name || ' (before AL.15)',
         template_specification = coalesce(template_specification, '{}'::jsonb) - 'workflows' - 'constraints'
   WHERE slug IN ('aws-fullstack-webapp', 'gcp-fullstack-webapp', 'supabase-gitops-pipeline');
  IF (SELECT count(*) FROM public.project_templates
      WHERE author_type = 'official' AND NOT coalesce(template_specification ? 'workflows', false)) <> 5 THEN
    RAISE EXCEPTION 'db-lane 111: expected five official templates without workflows before the migration';
  END IF;
  SELECT id INTO v_unity FROM public.project_templates WHERE slug = 'unity-ai-platformer';
  INSERT INTO auth.users (id, email) VALUES (v_user, 'db-lane-111@nodespec.local');
  INSERT INTO public.template_usage (template_id, user_id) VALUES (v_unity, v_user);
  INSERT INTO public.template_upvotes (template_id, user_id) VALUES (v_unity, v_user);
END $$;

\ir ../../supabase/migrations/20261002120000_v3_al15_starter_templates.sql
CREATE TEMP TABLE lane111_first AS
  SELECT slug, updated_at, template_specification FROM public.project_templates;
\ir ../../supabase/migrations/20261002120000_v3_al15_starter_templates.sql

DO $$
DECLARE
  bad text;
  n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.project_templates WHERE slug IN ('nextjs-supabase-stripe-saas', 'unity-ai-platformer')) THEN
    RAISE EXCEPTION 'db-lane 111: a retired template is still listed';
  END IF;
  SELECT count(*) INTO n FROM public.template_usage u WHERE u.user_id = 'db111000-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 111: the usage row on the retired template did not cascade'; END IF;
  SELECT count(*) INTO n FROM public.template_upvotes u WHERE u.user_id = 'db111000-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'db-lane 111: the upvote on the retired template did not cascade'; END IF;

  SELECT string_agg(slug || '=' || name, ', ' ORDER BY slug) INTO bad
    FROM public.project_templates WHERE author_type = 'official';
  IF bad IS DISTINCT FROM 'aws-fullstack-webapp=AWS Starter Project, gcp-fullstack-webapp=GCP Starter Project, supabase-gitops-pipeline=Supabase GitOps Pipeline' THEN
    RAISE EXCEPTION 'db-lane 111: the official templates read %', bad;
  END IF;

  SELECT string_agg(t.slug, ', ') INTO bad
    FROM public.project_templates t
    WHERE NOT (jsonb_array_length(t.template_specification -> 'workflows') = 2
      AND (SELECT count(*) FROM jsonb_array_elements(t.template_specification -> 'workflows') w, jsonb_array_elements(w -> 'outcomes')) = 10
      AND jsonb_array_length(t.template_specification -> 'constraints') = 7);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 111: not the Starter shape (2 workflows, 10 outcomes, 7 constraints): %', bad; END IF;

  SELECT string_agg(t.slug || ':' || (d ->> 'requirementId'), ', ') INTO bad
    FROM public.project_templates t,
         jsonb_array_elements(t.template_specification -> 'workflows') w,
         jsonb_array_elements(w -> 'outcomes') o,
         jsonb_array_elements(o -> 'derives') d
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.template_specification -> 'requirements') r WHERE r ->> 'requirementId' = d ->> 'requirementId');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 111: an outcome derives a requirement its template lacks: %', bad; END IF;

  SELECT string_agg(t.slug || ':' || (r ->> 'requirementId'), ', ') INTO bad
    FROM public.project_templates t,
         jsonb_array_elements(t.template_specification -> 'requirements') r
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(t.template_specification -> 'workflows') w,
                    jsonb_array_elements(w -> 'outcomes') o,
                    jsonb_array_elements(o -> 'derives') d
      WHERE d ->> 'requirementId' = r ->> 'requirementId');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 111: a requirement no outcome derives: %', bad; END IF;

  SELECT string_agg(t.slug || ':' || (o ->> 'key') || '@' || s, ', ') INTO bad
    FROM public.project_templates t,
         jsonb_array_elements(t.template_specification -> 'workflows') w,
         jsonb_array_elements(w -> 'outcomes') o,
         jsonb_array_elements_text(o -> 'steps') s
    WHERE s::integer < 0 OR s::integer >= jsonb_array_length(w -> 'steps');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 111: an outcome sits on a step its workflow lacks: %', bad; END IF;

  SELECT string_agg(t.slug || ':' || (o ->> 'key') || '/' || (c ->> 'id'), ', ') INTO bad
    FROM public.project_templates t,
         jsonb_array_elements(t.template_specification -> 'workflows') w,
         jsonb_array_elements(w -> 'outcomes') o,
         jsonb_array_elements(o -> 'criteria') c
    WHERE (SELECT count(*) FROM jsonb_array_elements(o -> 'derives') d, jsonb_array_elements_text(d -> 'criteria') dc WHERE dc = c ->> 'id') <> 1;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 111: a criterion claimed other than exactly once: %', bad; END IF;

  SELECT string_agg(t.slug || ':' || COALESCE(k ->> 'title', k ->> 'description'), ', ') INTO bad
    FROM public.project_templates t,
         jsonb_array_elements(t.template_specification -> 'constraints') k
    WHERE (k ->> 'ctype') NOT IN ('technology', 'architecture', 'deployment', 'performance', 'security', 'compliance', 'cost', 'other')
       OR ((k ? 'workflow') AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.template_specification -> 'workflows') w WHERE w ->> 'name' = k ->> 'workflow'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 111: a constraint of a kind the table refuses, or on a workflow the template lacks: %', bad; END IF;

  SELECT string_agg(f.slug, ', ') INTO bad
    FROM lane111_first f JOIN public.project_templates t ON t.slug = f.slug
    WHERE t.updated_at IS DISTINCT FROM f.updated_at OR t.template_specification IS DISTINCT FROM f.template_specification;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'db-lane 111: the replay changed %', bad; END IF;
  IF (SELECT count(*) FROM lane111_first) <> 3 THEN RAISE EXCEPTION 'db-lane 111: expected three templates after the first run'; END IF;

  RAISE NOTICE 'db-lane 111: two templates retired with their rows; three Starter-shaped templates, every requirement derived once over, every step and criterion accounted for; the replay changed nothing';
END $$;

ROLLBACK;
