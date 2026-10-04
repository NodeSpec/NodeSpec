// Owner spike 2026-09-04: the 'Import a specification' lane used to stream the
// pasted document to an in-app agent endpoint that no longer exists (the
// "failed to fetch" the owner hit). The app never converts documents itself
// any more — the user's OWN AI does, over MCP. This module is the pure half of
// the hand-off: the staged-document shape that rides projects.metadata, the
// tool names the prompts reference, and the prompts themselves. No React, no
// network — vitest covers it directly.
import { BASELINE_STEP } from './change-intent.js';

/** The MCP tool the user's AI calls to pick the staged document up: the
 *  document rides get_project_status's response (stagedSpecification) while
 *  the project has no requirements. */
export const SPEC_HANDOFF_TOOL = 'get_project_status';

/** The tools the hand-off lead prescribes for the conversion itself, in order. */
export const SPEC_CONVERSION_TOOLS = ['update_vision', 'create_requirement', 'relate_requirements'] as const;

/** The tools a fresh 'Start new' project leans on, in order. */
export const START_NEW_TOOLS = ['update_vision', 'create_requirement', 'propose_patches'] as const;

/** Route of the public MCP tool reference the popup links to. */
export const MCP_TOOLS_DOCS_PATH = '/docs/mcp';

/** Bound on the staged document. It rides a jsonb column and is echoed back
 *  through one MCP response, so it stays well inside a model context. */
export const SPEC_STAGE_MAX_CHARS = 120_000;

export interface StagedSpecImport {
  text: string;
  chars: number;
  stagedAt: string;
}

export type StageSpecResult =
  | { ok: true; staged: StagedSpecImport }
  | { ok: false; reason: 'empty' | 'too-long'; chars: number };

/** Normalise a pasted document into the staged shape, or say why it cannot be staged. */
export function buildStagedSpecImport(text: string, now: Date = new Date()): StageSpecResult {
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  if (!trimmed) return { ok: false, reason: 'empty', chars: 0 };
  if (trimmed.length > SPEC_STAGE_MAX_CHARS) return { ok: false, reason: 'too-long', chars: trimmed.length };
  return {
    ok: true,
    staged: { text: trimmed, chars: trimmed.length, stagedAt: now.toISOString() },
  };
}

/** Read a staged document back out of projects.metadata, tolerating anything else. */
export function readStagedSpecImport(metadata: Record<string, unknown> | null | undefined): StagedSpecImport | null {
  const raw = metadata?.stagedSpecImport;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || !r.text.trim()) return null;
  return {
    text: r.text,
    chars: typeof r.chars === 'number' ? r.chars : r.text.length,
    stagedAt: typeof r.stagedAt === 'string' ? r.stagedAt : '',
  };
}

/** The one-line note the user pastes into their AI after staging. */
export function buildSpecHandoffPrompt(projectName: string): string {
  return `Call the NodeSpec MCP tool ${SPEC_HANDOFF_TOOL} for project "${projectName}". ` +
    `A specification document is staged there — convert it faithfully into the project's vision and requirements ` +
    `using ${SPEC_CONVERSION_TOOLS.join(', ')}, exactly as the response's nextAction describes.`;
}

/** The full prompt variant: the document inline, for an AI that should not
 *  round-trip through status first. */
export function buildSpecInlinePrompt(projectName: string, documentText: string): string {
  return `Import the specification below into the NodeSpec project "${projectName}" faithfully: ` +
    `call ${SPEC_CONVERSION_TOOLS[0]} with the document's intent (confirm the wording with me), ` +
    `${SPEC_CONVERSION_TOOLS[1]} for each requirement it contains with its acceptance criteria, ` +
    `and ${SPEC_CONVERSION_TOOLS[2]} where the document implies structure. ` +
    `Do not invent content the document does not contain — gaps are questions for me.\n\n` +
    `--- SPECIFICATION ---\n${documentText}`;
}

/** The note for a project starting from scratch. */
export function buildStartNewPrompt(projectName: string): string {
  return `Call the NodeSpec MCP tool ${SPEC_HANDOFF_TOOL} for project "${projectName}", ` +
    `then ask me for the project vision in my own words and record it with ${START_NEW_TOOLS[0]}. ` +
    `From there, draft requirements with ${START_NEW_TOOLS[1]} and architecture with ${START_NEW_TOOLS[2]} for my review.`;
}

/** AL.21 (owner 2026-10-03): the MCP tool that imports the connected
 *  repository. The status read points the agent at it on a project started
 *  from a repository. */
export const REPO_IMPORT_TOOL = 'run_repo_import';

/** The note for a project started from a repository. */
export function buildRepoImportPrompt(projectName: string): string {
  return `Call the NodeSpec MCP tool ${SPEC_HANDOFF_TOOL} for project "${projectName}", then ${REPO_IMPORT_TOOL} to import the connected repository. ` +
    `Follow each response's nextAction until the draft is ready for my review.`;
}

/** The note that sends the agent to what the person chose after an import.
 *  The choice is staged on the project; get_project_status leads with it
 *  until the agent has filed outcomes for it. */
export function buildImportIntentPrompt(projectName: string, label: string, change: string | null): string {
  return `In the NodeSpec project "${projectName}" I chose "${label}" for the imported system` +
    `${change ? `, as the change "${change}"` : ''}. Call ${SPEC_HANDOFF_TOOL} and do what its nextAction says for it: ` +
    (change
      ? `draft the change's outcomes, ${BASELINE_STEP} first, as one proposal for my review.`
      : 'draft the lanes and outcomes the system serves, as one proposal for my review.');
}

/** The import intent as get_project_status returns it (data.importIntent). */
export interface ImportIntentView {
  intent: string;
  label: string;
  change: string | null;
  outcomes: number;
  proposalId: string | null;
  started: boolean;
}

/** The Git window's line on the import intent, and whether it still offers the note. */
export function importIntentStatus(v: ImportIntentView): { line: string; prompt: boolean } {
  const chose = `You chose ${v.label}${v.change ? `: ${v.change}` : ''}.`;
  if (v.outcomes > 0) return { line: `${chose} Your agent has filed ${v.outcomes} outcome${v.outcomes === 1 ? '' : 's'} for it.`, prompt: false };
  if (v.proposalId) return { line: `${chose} Your agent has proposed the outcomes; review them under Agents, Proposals.`, prompt: false };
  return { line: `${chose} Staged for your agent, which has not drafted the outcomes yet. Paste this to send it there:`, prompt: true };
}
