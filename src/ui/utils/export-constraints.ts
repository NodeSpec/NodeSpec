// AA.0 (R.2a, owner 2026-09-23): the exports (CLAUDE.md, AGENTS.md, the
// Cursor rules, the specification export) read constraints from the one
// store, `project_constraints`, not the legacy spec jsonb. An exported file
// leaves NodeSpec, so a constraint carrying a classification mark is never
// written into one.
import { getSupabaseClient } from '../../persistence/supabase/client.js';

export interface ExportConstraint {
  type: string;
  description: string;
}

type Row = { ctype: string; title: string | null; description: string; rationale: string | null; mark: string | null };

/** Rows → the export's shape: the title leads the description, the reason
 *  follows it. Marked rows are dropped. Pure. */
export function exportConstraintsOf(rows: ReadonlyArray<Row>): ExportConstraint[] {
  return rows
    .filter((r) => !r.mark)
    .map((r) => ({
      type: r.ctype,
      description: [r.title ? `${r.title}: ${r.description}` : r.description, r.rationale ? `(why: ${r.rationale})` : ''].filter(Boolean).join(' '),
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.description.localeCompare(b.description));
}

export async function loadExportConstraints(projectId: string): Promise<ExportConstraint[]> {
  const { data, error } = await getSupabaseClient()
    .from('project_constraints')
    .select('ctype, title, description, rationale, mark')
    .eq('project_id', projectId);
  if (error) throw new Error(error.message);
  return exportConstraintsOf((data ?? []) as Row[]);
}
