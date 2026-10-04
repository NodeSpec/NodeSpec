-- db-lane 042: the ladder's bottom rungs are the database's.
--
-- V3 2.4: open rows follow the lane's level, a confirmed requirement always
-- comes back as a proposal, a locked one refuses every write but the
-- unlock and evidence. The first two rungs are router policy (Deno tests);
-- this file proves the third on real triggers, and proves that "confirmed"
-- is NOT a trigger, so nobody later expects the database to hold that
-- rung: a direct write on a confirmed row lands.
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  v_owner uuid;
  v_proj uuid := 'db420000-0000-4000-8000-000000000010';
  v_spec uuid := 'db420000-0000-4000-8000-000000000020';
  v_req  uuid := 'db420000-0000-4000-8000-000000000030';
  v_name text; v_refused boolean; v jsonb; v_met text; v_locked boolean;
BEGIN
  IF to_regprocedure('public.requirement_lock_guard()') IS NULL
     OR to_regprocedure('public.apply_criteria_ops(uuid, jsonb, timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'db-lane 042: the lock guards or apply_criteria_ops are missing. Apply migration 20260916130000.';
  END IF;

  SELECT id INTO v_owner FROM auth.users WHERE email = 'bench@nodespec.local';
  IF v_owner IS NULL THEN SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'db-lane 042: no auth.users row to own the fixture. Run supabase db reset (the seed creates bench@nodespec.local).';
  END IF;
  INSERT INTO public.projects (id, name, owner_id) VALUES (v_proj, 'db-lane 042', v_owner);
  INSERT INTO public.project_specifications (id, project_id, vision, created_by) VALUES (v_spec, v_proj, 'db-lane 042', v_owner);
  INSERT INTO public.specification_requirements (id, specification_id, requirement_id, name, description, source, confirmed, locked, acceptance_criteria)
    VALUES (v_req, v_spec, 'REQ-001', 'Store tasks', 'Tasks persist across sessions', 'manual', true, false,
            '[{"id":"c1","text":"Tasks persist across sessions","met":false}]'::jsonb);

  -- 1. confirmed is router policy, not a trigger: a direct write lands.
  UPDATE public.specification_requirements SET name = 'Store tasks durably' WHERE id = v_req;
  SELECT name INTO v_name FROM public.specification_requirements WHERE id = v_req;
  IF v_name <> 'Store tasks durably' THEN RAISE EXCEPTION 'db-lane 042: a confirmed row should accept a direct write, got name %', v_name; END IF;

  -- 2. locking is a write like any other.
  UPDATE public.specification_requirements SET locked = true WHERE id = v_req;

  -- 3. a locked row refuses a field edit, with the lock's SQLSTATE and message.
  v_refused := false;
  BEGIN
    UPDATE public.specification_requirements SET name = 'x' WHERE id = v_req;
    RAISE EXCEPTION 'db-lane 042: a locked row accepted a field edit';
  EXCEPTION WHEN SQLSTATE 'P0LCK' THEN
    v_refused := SQLERRM LIKE 'REQ-001 is locked.%';
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 042: expected the lock''s P0LCK refusal naming REQ-001'; END IF;

  -- 4. and a new mapping that names it.
  v_refused := false;
  BEGIN
    INSERT INTO public.specification_mappings (specification_id, requirement_id, node_id) VALUES (v_spec, v_req, 'db420000-0000-4000-8000-000000000040');
    RAISE EXCEPTION 'db-lane 042: a locked row accepted a new mapping';
  EXCEPTION WHEN SQLSTATE 'P0LCK' THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'db-lane 042: expected P0LCK on the mapping'; END IF;

  -- 5. evidence still flows: the criteria ops flip met on a locked row.
  v := public.apply_criteria_ops(v_req, '[{"op":"set_met","criterion_id":"c1","value":true}]'::jsonb, NULL);
  SELECT acceptance_criteria->0->>'met' INTO v_met FROM public.specification_requirements WHERE id = v_req;
  IF v_met IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'db-lane 042: evidence should pass the lock, got met=% (%)', v_met, v; END IF;

  -- 6. the unlock door: locked -> false and nothing else, then edits land again.
  UPDATE public.specification_requirements SET locked = false WHERE id = v_req;
  SELECT locked INTO v_locked FROM public.specification_requirements WHERE id = v_req;
  IF v_locked THEN RAISE EXCEPTION 'db-lane 042: the unlock door did not open'; END IF;
  UPDATE public.specification_requirements SET name = 'Store tasks, unlocked' WHERE id = v_req;
  SELECT name INTO v_name FROM public.specification_requirements WHERE id = v_req;
  IF v_name <> 'Store tasks, unlocked' THEN RAISE EXCEPTION 'db-lane 042: an unlocked row should accept edits again'; END IF;

  RAISE NOTICE 'db-lane 042: confirmed lands (policy, not trigger); locked refuses edits and mappings with P0LCK; evidence passes; the unlock door opens';
END $$;

ROLLBACK;
