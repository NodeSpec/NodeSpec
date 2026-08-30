// B2 (docs/WORK_LOOP_PLAN.md) · the auto-sync driver.
//
// Runs INSIDE the editor because only the state's owner may apply: the
// editor's autosave persists its in-memory graph as a full snapshot, so any
// server-side graph write would be silently clobbered after the baseline
// advanced — hiding drift. This hook instead drives the SAME accept lane a
// human click drives (patch pipeline → provenance stamp → R5e
// evidence-staleness flags → autosave), then resolves the card with an
// autoSynced audit stamp. Cards that fail any eligibility test — or fail
// mid-apply — stay pending for the human/AI, with one attempt per session so
// a persistently failing card never loops.
import { useEffect, useRef } from 'react';
import type { GitService } from '../services/GitService.js';
import { isAutoSyncEligible, type AutoSyncArtifactView } from '../utils/git-auto-sync.js';

const POLL_MS = 30_000; // matches the ChangesPanel badge cadence

export function useGitAutoSync(args: {
  /** integration present AND auto_sync flag on. */
  enabled: boolean;
  projectId: string | null;
  integrationId: string | null;
  branchName: string;
  gitService: GitService;
  /** Live view of the canvas artifacts (lock + kind checks). */
  artifactsById: Record<string, AutoSyncArtifactView | undefined>;
  /** The GraphEditor accept lane; returns null on success, error string on refusal. */
  onAcceptArtifact: (artifactId: string, newContent: string, path: string, sourceCommit?: string) => string | null;
  /** B3: the residue-bind lane, for declared new files (same patch pipeline). */
  onBindFile: (path: string, nodeId: string, content: string, sourceCommit?: string) => string | null;
  /** Re-runs early when the realtime card badge moves. */
  pendingSignal: number;
  onSynced?: (message: string) => void;
}): void {
  const {
    enabled, projectId, integrationId, branchName,
    gitService, artifactsById, onAcceptArtifact, onBindFile, pendingSignal, onSynced,
  } = args;

  const inFlight = useRef(false);
  // One attempt per card per session: a card that fails stays PENDING (visible
  // in the panel with its error), and auto-sync must not hammer it.
  const attempted = useRef(new Set<string>());
  // Refs so the interval closure always sees the live lane + graph without
  // re-arming on every render.
  const acceptRef = useRef(onAcceptArtifact);
  acceptRef.current = onAcceptArtifact;
  const bindRef = useRef(onBindFile);
  bindRef.current = onBindFile;
  const artifactsRef = useRef(artifactsById);
  artifactsRef.current = artifactsById;

  useEffect(() => {
    if (!enabled || !projectId || !integrationId) return;
    let cancelled = false;

    const run = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const pending = await gitService.getPendingChanges(projectId);
        for (const change of pending) {
          if (cancelled) return;
          if (attempted.current.has(change.id)) continue;
          const decision = isAutoSyncEligible(change, branchName, artifactsRef.current);
          if (!decision.eligible) continue;
          attempted.current.add(change.id);

          // Content at the card's exact commit — the change the card recorded,
          // not whatever the branch tip moved to since.
          const declaredBinds = change.bindingResolution?.bind ?? [];
          const matchPaths = (change.artifactMatches ?? []).map((m) => m.path);
          const paths = [...new Set([...matchPaths, ...declaredBinds.map((b) => b.path)])];
          const fetched = await gitService.fetchFileContent(
            integrationId, paths, undefined, change.commitSha,
          );
          const contentByPath = new Map(fetched.map((f) => [f.path, f.content]));

          let failure: string | null = null;
          let appliedCount = 0;
          let boundCount = 0;

          // B3: bind declared NEW files first (bind-then-clear: the entry only
          // leaves bindings.json at the next push, keyed off the graph actually
          // carrying the binding — so a failure here loses nothing).
          for (const declared of declaredBinds) {
            const content = contentByPath.get(declared.path);
            if (content === undefined) {
              failure = `content unavailable for declared ${declared.path}`;
              break;
            }
            const err = bindRef.current(declared.path, declared.nodeId, content, change.commitSha);
            if (err) { failure = err; break; }
            boundCount++;
          }

          if (!failure) {
            for (const match of change.artifactMatches ?? []) {
              const content = contentByPath.get(match.path);
              if (content === undefined) {
                failure = `content unavailable for ${match.path}`;
                break;
              }
              const err = acceptRef.current(match.artifactId, content, match.path, change.commitSha);
              if (err) { failure = err; break; }
              appliedCount++;
            }
          }

          if (failure) {
            // Partial applies are real patches already on the canvas — honest,
            // since each carries provenance — but the CARD stays pending so
            // the remainder is visibly someone's to finish.
            console.warn(`[auto-sync] card ${change.id} left pending after ${boundCount} binds + ${appliedCount} applies: ${failure}`);
            continue;
          }

          await gitService.resolveChangeEvent(change.id, 'accepted', {
            autoSynced: { at: new Date().toISOString(), files: appliedCount },
            ...(boundCount > 0 ? { declarationsBound: boundCount } : {}),
          });
          const parts: string[] = [];
          if (boundCount > 0) parts.push(`bound ${boundCount} declared file${boundCount === 1 ? '' : 's'}`);
          if (appliedCount > 0) parts.push(`synced ${appliedCount} bound file${appliedCount === 1 ? '' : 's'}`);
          onSynced?.(`Auto-sync: ${parts.join(', ')} from commit ${change.commitSha.slice(0, 7)}`);
        }
      } catch (err) {
        console.warn('[auto-sync] pass failed (will retry on next tick):', err);
      } finally {
        inFlight.current = false;
      }
    };

    void run();
    const timer = setInterval(run, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
    // pendingSignal re-arms the effect so a realtime card arrival syncs
    // without waiting out the interval.
  }, [enabled, projectId, integrationId, branchName, gitService, pendingSignal, onSynced]);
}
