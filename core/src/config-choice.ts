/**
 * THE rule for reading a node's configuration choice (N8.1b inspector toggle).
 *
 * Owner bug 2026-07-30: "after I click 'I'll specify' and make a manual change, I
 * cannot click 'AI Decides'." Every reader used `values-win` precedence
 * (`configSource === 'manual' || hasValues`), so once `metadata.config` had a
 * single key the derived state was PINNED to manual: the click wrote
 * `configSource: 'ai'` and the very next render recomputed back to manual. The
 * choice was unreachable, not un-clickable.
 *
 * The rule now: an EXPLICIT choice wins. `configSource` is only ever written by
 * the inspector's toggle, so its presence means the user chose; its absence means
 * nobody chose, and only THEN do values imply 'user-specified' (the back-compat
 * inference for nodes that predate the toggle).
 *
 * Values are never destroyed by delegating — they lie dormant and return intact
 * if the user switches back. Readers must therefore honor the CHOICE, not the
 * leftovers, or the packet would "honor these choices" while the inspector says
 * delegated.
 *
 * MIRRORED at supabase/functions/_shared/config-choice.ts — change together.
 */

export type ConfigChoice =
  /** The user explicitly delegated configuration to the implementing AI. */
  | 'delegated'
  /** The user owns configuration (explicit choice, or legacy values with no recorded choice). */
  | 'user-specified'
  /** Nobody has decided yet — the packet asks the AI to confirm with the user. */
  | 'unchosen';

export function resolveConfigChoice(
  metadata: Record<string, unknown> | undefined | null,
): ConfigChoice {
  const explicit = metadata?.configSource;
  // An explicit delegation wins even when dormant values remain.
  if (explicit === 'ai') return 'delegated';
  if (explicit === 'manual') return 'user-specified';
  const config = metadata?.config as Record<string, unknown> | undefined;
  const hasValues = !!config && typeof config === 'object' && Object.keys(config).length > 0;
  return hasValues ? 'user-specified' : 'unchosen';
}
