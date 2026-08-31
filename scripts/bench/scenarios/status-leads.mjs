// SB-4 scenario 23: the spec-import status lead, live (owner audit 2026-08-13).
//
// The 'Import a specification' wizard lane fed the retired internal agent;
// after inversion nothing routed it to the user's AI. The fix is a
// get_project_status lead that fires while an import-spec project has zero
// requirements — this proves it end to end over the real MCP surface, then
// runs the conversion workflow the lead prescribes (update_vision +
// create_requirement, both bootstrapping the spec row) and proves the lead
// RETIRES itself once requirements exist.
import { rest, mcpCall, Scenario } from '../lib.mjs';
import { createEmptyProject } from '../fixtures.mjs';

const parse = (r) => {
  const text = r.data?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.data?.result?.isError }; }
};

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
    s.check('update_vision bootstraps the spec row on a fresh project', vis?.isError !== true,
      JSON.stringify(vis).slice(0, 200));
    const req = parse(await mcpCall(env, 'create_requirement', {
      project_id: fx.ids.project,
      name: 'Bench imported requirement',
      description: 'Extracted from the pasted document.',
      acceptance_criteria: ['The bench scenario passes'],
    }));
    s.check('create_requirement lands (criteria start unmet)', req?.isError !== true,
      JSON.stringify(req).slice(0, 200));

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

export default [specImportLead];
