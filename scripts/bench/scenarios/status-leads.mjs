// SB-4 scenario 23: the spec-import status lead, live (owner audit 2026-08-13).
//
// The 'Import a specification' wizard lane fed the retired internal agent;
// after inversion nothing routed it to the user's AI. The fix is a
// get_project_status lead that fires while an import-spec project has zero
// requirements — this proves it end to end over the real MCP surface, then
// runs the conversion workflow the lead prescribes (update_vision +
// create_requirement, both bootstrapping the spec row) and proves the lead
// RETIRES itself once requirements exist.
import { rest, mcpCall, Scenario, parseMcp } from '../lib.mjs';
import { createEmptyProject } from '../fixtures.mjs';

// The shared strict reader (lib.mjs): a call that failed below the tool is an error.
const parse = parseMcp;

export const specImportLead = {
  name: 'spec-import-lead',
  boxes: ['ROUND 15: import-spec origin drives the AI via the status lead; lead retires after conversion'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createEmptyProject(env, session, 'specimport');
    const db = rest(env);

    // The wizard stamps the origin into projects.metadata on creation.
    await db.update('projects', `id=eq.${fx.ids.project}`, {
      metadata: { workflowOrigin: 'import-spec' },
    });

    // 1. Fresh import-spec project → the status lead IS the trigger.
    const before = parse(await mcpCall(env, 'get_project_status', { project_id: fx.ids.project }));
    const lead = String(before?.nextAction ?? '');
    s.check('status leads with the spec-import conversion workflow',
      lead.includes('IMPORT AN EXISTING SPECIFICATION'), lead.slice(0, 160));
    s.check('lead asks for the document and names the conversion tools',
      lead.includes('paste') && lead.includes('update_vision') && lead.includes('create_requirement'),
      lead.slice(0, 300));
    s.check('the faithfulness rule rides the lead (gaps are questions, never blanks)',
      lead.includes('Do not invent content'), lead.slice(160, 460));

    // 2. Run the prescribed workflow over MCP — both tools bootstrap the spec
    //    row on an MCP-first project (no app interaction required).
    const vis = parse(await mcpCall(env, 'update_vision', {
      project_id: fx.ids.project,
      vision: 'Bench: converted from an imported specification document.',
    }));
    // UAT hardening 2026-09-27: "not an error" is not "it landed"; the rows
    // the tools say they wrote are read back.
    const [specRow] = await db.select('project_specifications', `project_id=eq.${fx.ids.project}&select=id,vision`);
    s.check('update_vision bootstraps the spec row on a fresh project',
      vis?.isError !== true && String(specRow?.vision ?? '').startsWith('Bench: converted'), JSON.stringify({ vis, specRow }).slice(0, 200));
    const req = parse(await mcpCall(env, 'create_requirement', {
      project_id: fx.ids.project,
      name: 'Bench imported requirement',
      description: 'Extracted from the pasted document.',
      acceptance_criteria: ['The bench scenario passes'],
    }));
    const [reqRow] = specRow ? await db.select('specification_requirements', `specification_id=eq.${specRow.id}&name=eq.${encodeURIComponent('Bench imported requirement')}&select=acceptance_criteria`) : [];
    const crit = Array.isArray(reqRow?.acceptance_criteria) ? reqRow.acceptance_criteria : [];
    s.check('create_requirement lands (criteria start unmet)',
      req?.isError !== true && crit.length === 1 && crit[0]?.text === 'The bench scenario passes' && crit[0]?.met !== true,
      JSON.stringify({ req, criteria: crit }).slice(0, 300));

    // 3. The lead retires itself: requirements exist, so the origin read is
    //    skipped and normal phase advice returns.
    const after = parse(await mcpCall(env, 'get_project_status', { project_id: fx.ids.project }));
    const next = String(after?.nextAction ?? '');
    s.check('lead is GONE once requirements exist', !next.includes('IMPORT AN EXISTING SPECIFICATION'),
      next.slice(0, 160));
    s.check('normal phase advice resumes (requirements ready for review)',
      next.includes('ready for review'), next.slice(0, 200));
    return { s, fx };
  },
};

// Owner spike 2026-09-04: the app's import window no longer converts the
// document itself (it streamed to a retired agent endpoint — "failed to
// fetch"). It STAGES the document in projects.metadata.stagedSpecImport and
// tells the user to have their AI call get_project_status. This proves the
// hand-off end to end over the real MCP surface: the document rides the
// response, the lead says convert it NOW (no re-paste), the prescribed
// conversion lands, and both the lead and the payload retire once
// requirements exist.
export const specImportStaged = {
  name: 'spec-import-staged',
  boxes: ['SPIKE-1: a staged specification reaches the AI through get_project_status and retires after conversion'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createEmptyProject(env, session, 'specstaged');
    const db = rest(env);

    // Exactly what SpecImportStagingPopup writes (src/ui/utils/spec-import-staging.ts).
    const text = '# Bench Product\n\n## Vision\nA benchmark product.\n\n## Requirements\n- Users can register\n- Users can log in';
    const stagedAt = new Date().toISOString();
    await db.update('projects', `id=eq.${fx.ids.project}`, {
      metadata: { workflowOrigin: 'import-spec', stagedSpecImport: { text, chars: text.length, stagedAt } },
    });

    // 1. The staged document rides the status response with the convert-now lead.
    const before = parse(await mcpCall(env, 'get_project_status', { project_id: fx.ids.project }));
    const lead = String(before?.nextAction ?? '');
    s.check('status leads with the STAGED document (not the paste-it lead)',
      lead.includes('SPECIFICATION DOCUMENT IS STAGED') && !lead.includes('IMPORT AN EXISTING SPECIFICATION'),
      lead.slice(0, 160));
    s.check('lead says the document is in the response — never re-ask for it',
      lead.includes('do not ask the user to paste it again'), lead.slice(0, 300));
    s.check('lead names the conversion tools and the faithfulness rule',
      lead.includes('update_vision') && lead.includes('create_requirement') && lead.includes('Do not invent content'),
      lead.slice(160, 520));
    s.check('stagedSpecification carries the exact document text',
      before?.stagedSpecification?.text === text, JSON.stringify(before?.stagedSpecification ?? null).slice(0, 160));
    s.check('stagedSpecification carries chars + stagedAt',
      before?.stagedSpecification?.chars === text.length && before?.stagedSpecification?.stagedAt === stagedAt,
      JSON.stringify(before?.stagedSpecification ?? null).slice(0, 160));

    // 2. Run the prescribed conversion over MCP.
    const vis = parse(await mcpCall(env, 'update_vision', {
      project_id: fx.ids.project,
      vision: 'A benchmark product.',
    }));
    s.check('update_vision lands from the staged document', vis?.isError !== true, JSON.stringify(vis).slice(0, 200));
    for (const name of ['Users can register', 'Users can log in']) {
      const req = parse(await mcpCall(env, 'create_requirement', {
        project_id: fx.ids.project,
        name,
        description: `Extracted from the staged document: ${name}.`,
        acceptance_criteria: [`${name} end to end`],
      }));
      s.check(`create_requirement lands: ${name}`, req?.isError !== true, JSON.stringify(req).slice(0, 200));
    }

    // 3. Requirements exist → the lead AND the payload retire together.
    const after = parse(await mcpCall(env, 'get_project_status', { project_id: fx.ids.project }));
    const next = String(after?.nextAction ?? '');
    s.check('staged lead is GONE once requirements exist', !next.includes('SPECIFICATION DOCUMENT IS STAGED'), next.slice(0, 160));
    s.check('stagedSpecification is no longer echoed', after?.stagedSpecification === undefined,
      JSON.stringify(after?.stagedSpecification ?? null).slice(0, 80));
    s.check('normal phase advice resumes (requirements ready for review)',
      next.includes('ready for review'), next.slice(0, 200));
    return { s, fx };
  },
};

export default [specImportLead, specImportStaged];
