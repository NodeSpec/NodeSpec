// V3 4.4: the rail beside the Architecture canvas, to the design's
// Architecture board. For the selected node it says what the canvas cannot:
//
//   Work here     the requirements mapped to it (with the mapping's review
//                 state and its proof count) and the outcomes filed on it,
//                 each a door into Work on that record; the head carries
//                 the node's proof count
//   a question    what the import refused to guess ON THIS NODE
//   Held by       the lease board's holds on the node (2.3)
//   Deploys via   (AA.4) what the import read about how it runs and ships:
//                 managed or self-hosted, where, and each deploy call with
//                 its file and line; (AB.4) where installed software goes:
//                 the devices, the operating systems, the service manager or
//                 the board; only on a plan with repo import
//   Connects to   every edge touching it, with the contract's name, and a
//                 mark on a contract that has no schema yet
//   History       (AA.7) the node's memory, newest first: decisions, a
//                 person's changes, hand-offs, its learning and criteria
//                 proven at a commit, each with who and the commit, and a
//                 review line where the node's context changed after it
//   Expand        (AE.6) on a node an agent may explode: one press stages
//                 the request the person's agent picks up over MCP, and
//                 the row then says so until it is withdrawn or the parts
//                 land
//
// The node types sidebar and the inspector below it are unchanged; this
// sits above the inspector's sections, in the same register.
import { useState } from 'react';
import type { Graph } from '@nodespec/core/types.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { statusTones } from '../ideation/status-tones.js';
import { useNodeItems, type NodeRequirementItem } from './useNodeItems.js';
import { useProjectFeatureGate } from '../../hooks/useProjectFeatureGate.js';
import { eyebrow, meta, identifier, stateWord, sinceLabelStyle } from '../ideation/typography.js';
import { useAgentPresence, holdsOnNode, sinceLabel } from '../ideation/useAgentPresence.js';
import { reachLine } from '../ideation/node-leases.js';
import { assembleQuestionItems, type ImportJobQueueRow, type QueueItem } from '../ideation/useApprovalsQueue.js';
import { CatalogService } from '../../services/CatalogService.js';
import { nodeMemory, type MemoryEntry } from '../../utils/node-memory.js';
import { useNodeMemory } from './useNodeMemory.js';
import { resolveRoleInfo } from '@nodespec/core/container-types.js';
import { canRequestExplode, stagedExplodeFor, type StagedExplode } from '../../utils/explode-staging.js';

export interface NodeConnection { edgeId: string; direction: 'out' | 'in'; otherId: string; otherLabel: string; contract: string | null; label: string | null; schemaMissing: boolean }

/** A record Work can open: the rail's rows name one. */
export type { WorkTarget } from '../work/work-focus.js';
import type { WorkTarget } from '../work/work-focus.js';

/** Every edge touching the node, outgoing first, each with the far end,
 *  the contract's name, and whether that contract still has no schema. Pure. */
export function nodeConnections(graph: Graph, nodeId: string): NodeConnection[] {
  const out: NodeConnection[] = [];
  for (const e of Object.values(graph.edges)) {
    if (e.source !== nodeId && e.target !== nodeId) continue;
    const direction = e.source === nodeId ? 'out' : 'in';
    const otherId = direction === 'out' ? e.target : e.source;
    const contract = graph.contracts[e.contractId] ?? null;
    const schemaMissing = !!contract && !((contract.schema && Object.keys(contract.schema).length > 0) || !!contract.schemaRef);
    out.push({ edgeId: e.id, direction, otherId, otherLabel: graph.nodes[otherId]?.label ?? otherId.slice(0, 8), contract: contract?.name ?? null, label: e.label ?? null, schemaMissing });
  }
  return out.sort((a, b) => (a.direction === b.direction ? a.otherLabel.localeCompare(b.otherLabel, undefined, { sensitivity: 'base' }) : a.direction === 'out' ? -1 : 1));
}

/** The import's open questions that sit on this node and the graph has not
 *  answered. Attribution is derived (questionNodeId), never guessed. Pure. */
export function questionsOnNode(job: ImportJobQueueRow | null, graph: Graph, nodeId: string): QueueItem[] {
  return assembleQuestionItems(job, graph).filter((q) => q.nodeId === nodeId);
}

/** "REQ-003 · unconfirmed, mapped here at 60% confidence, needs review · 0 of 3 proven" */
export function requirementLine(r: NodeRequirementItem): string {
  const state = r.confirmed ? 'confirmed' : 'unconfirmed';
  const mapping = r.validationStatus === 'needs-review'
    ? `mapped here at ${r.confidence === null ? 'low' : `${Math.round(r.confidence * 100)}%`} confidence, needs review`
    : null;
  return [r.ref, [state, mapping].filter(Boolean).join(', '), `${r.metCount} of ${r.criteriaCount} proven`].join(' · ');
}

/** AA.4a: one environment of the backing service a node holds (metadata.deployment). */
interface DeploymentFact { mode?: string; provider?: string | null; environment?: string | null; technology?: string; evidence?: Array<{ path?: string; line?: number; detail?: string }> }
/** AA.4b: one deploy call (metadata.deploysVia). */
export interface DeployStepFact { path: string; line: number; tool: string; text: string; target?: string }
export interface DeployLine { key: string; kind: 'runs' | 'call'; text: string; cite: string; title?: string }

const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  aws: 'AWS', gcp: 'Google Cloud', azure: 'Azure', supabase: 'Supabase', firebase: 'Firebase', cloudflare: 'Cloudflare',
};

/** "Amazon RDS, managed by AWS and deployed"; the import's own words. Pure. */
export function deploymentSentence(d: DeploymentFact, nameOf: (id: string) => string | null = () => null): string {
  const name = (d.technology && nameOf(d.technology)) || d.technology || 'A backing service';
  const how = d.mode === 'managed' ? `managed by ${d.provider ? (PROVIDER_NAMES[d.provider] ?? d.provider) : 'a provider'}` : 'self-hosted';
  const where = d.environment === 'deployed' ? ' and deployed' : d.environment === 'development' ? ' in local development' : '';
  return `${name}, ${how}${where}`;
}

/** AB.4: one piece of the import's deployment evidence (metadata.deploymentEvidence). */
interface EvidenceFact { kind?: string; path?: string; detail?: string; target?: string; platforms?: string[] }

const OS_NAMES: Readonly<Record<string, string>> = { ios: 'iOS', android: 'Android', macos: 'macOS', windows: 'Windows', linux: 'Linux' };
const PACKAGE_WORDS: Readonly<Record<string, string>> = {
  'installer-wix': 'WiX', 'installer-innosetup': 'Inno Setup', 'installer-nsis': 'NSIS', 'installer-msix': 'MSIX',
  'desktop-electron': 'Electron', 'desktop-tauri': 'Tauri',
};
const SERVICE_WORDS: Readonly<Record<string, string>> = {
  systemd: 'under systemd', launchd: 'under launchd', 'windows-service': 'as a Windows service', supervisor: 'under supervisor',
  'sysv-init': 'as a SysV init script', cron: 'on a cron schedule', 'task-scheduler': 'on a Task Scheduler schedule',
  pm2: 'under pm2', snap: 'as a snap daemon', 'cross-platform': 'as a service',
};

const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Installed on iOS and Android devices, released with fastlane": where
 *  installed software goes, from the node's target and the evidence for it.
 *  Null for software that is not installed (a container, a function). Pure. */
export function installSentence(target: string | null | undefined, evidence: unknown): string | null {
  const ev = (Array.isArray(evidence) ? evidence : []).filter((e): e is EvidenceFact => !!e && typeof e === 'object' && (e as EvidenceFact).target === target);
  const platforms = [...new Set(ev.flatMap((e) => (Array.isArray(e.platforms) ? e.platforms : [])))];
  const oses = platforms.map((p) => OS_NAMES[p] ?? p);
  const first = (e: EvidenceFact) => (e.detail ?? '').split(/[\s:,]/)[0];
  switch (target) {
    case 'mobile-device': {
      const store = ev.find((e) => e.kind === 'store-release');
      const via = store ? first(store) : null;
      // AJ.4: one cross-platform app (Flutter, Compose) can ship to desktops as well.
      const phones = platforms.filter((p) => p === 'ios' || p === 'android').map((p) => OS_NAMES[p]);
      const others = platforms.filter((p) => p !== 'ios' && p !== 'android').map((p) => OS_NAMES[p] ?? p);
      return `Installed on ${phones.length ? `${joinWords(phones)} devices` : 'mobile devices'}${others.length ? ` and on ${joinWords(others)}` : ''}${via ? `, released with ${via}` : ''}`;
    }
    case 'desktop-native': {
      const how = [...new Set(ev.map((e) => (e.kind === 'desktop-package' ? first(e)
        : e.kind === 'desktop-app-framework' ? e.detail ?? '' : PACKAGE_WORDS[e.kind ?? ''] ?? '')).filter(Boolean))];
      return `Installed on ${oses.length ? joinWords(oses) : 'a desktop'}${how.length ? ` (${how.join(', ')})` : ''}`;
    }
    case 'os-service': {
      const phrases = [...new Set(ev.map((e) => {
        const phrase = SERVICE_WORDS[first(e)] ?? 'as a service';
        const os = (e.platforms ?? []).map((p) => OS_NAMES[p] ?? p).filter((o) => !phrase.includes(o));
        return os.length ? `${phrase} on ${joinWords(os)}` : phrase;
      }))];
      return `Runs ${joinWords(phrases)}`;
    }
    case 'embedded': {
      const fw = ev.find((e) => e.kind === 'firmware');
      return `Firmware flashed to a device${fw?.detail ? `: ${fw.detail}` : ''}`;
    }
    default:
      return null;
  }
}

/** What the import read about how the node runs and ships, as rail lines:
 *  where installed software goes (AB.4), each environment of its backing
 *  service, then each deploy call. Pure. */
export function deployLines(metadata: Record<string, unknown> | undefined, nameOf?: (id: string) => string | null, deploymentTarget?: string | null): DeployLine[] {
  const out: DeployLine[] = [];
  const installs = installSentence(deploymentTarget, metadata?.deploymentEvidence);
  if (installs) {
    const ev = (metadata!.deploymentEvidence as EvidenceFact[]).filter((e) => e && e.target === deploymentTarget && typeof e.path === 'string');
    out.push({
      key: 'installs', kind: 'runs', text: installs, cite: ev[0]?.path ?? '',
      ...(ev.length > 0 ? { title: ev.map((e) => `${e.path} ${e.detail ?? ''}`.trim()).join('\n') } : {}),
    });
  }
  const primary = metadata?.deployment as (DeploymentFact & { otherEnvironments?: DeploymentFact[] }) | undefined;
  const envs = primary && typeof primary === 'object' ? [primary, ...(Array.isArray(primary.otherEnvironments) ? primary.otherEnvironments : [])] : [];
  envs.forEach((d, i) => {
    const ev = (d.evidence ?? []).filter((e) => e && typeof e.path === 'string');
    const cite = ev[0] ? `${ev[0].path}${ev[0].line ? `:${ev[0].line}` : ''}` : '';
    out.push({
      key: `runs-${i}`, kind: 'runs', text: deploymentSentence(d, nameOf), cite,
      ...(ev.length > 0 ? { title: ev.map((e) => `${e.path}${e.line ? `:${e.line}` : ''} ${e.detail ?? ''}`.trim()).join('\n') } : {}),
    });
  });
  const steps = Array.isArray(metadata?.deploysVia) ? (metadata!.deploysVia as DeployStepFact[]) : [];
  for (const s of steps) {
    if (!s || typeof s.path !== 'string' || typeof s.text !== 'string') continue;
    out.push({ key: `call-${s.path}-${s.line}`, kind: 'call', text: s.text, cite: `${s.path}:${s.line}`, ...(s.target ? { title: `${s.path}:${s.line}, in ${s.target}` } : {}) });
  }
  return out;
}

const MEMORY_KIND_WORD: Readonly<Record<MemoryEntry['kind'], string>> = {
  decision: 'Decision', change: 'Change', handoff: 'Hand-off', learning: 'Learning', proven: 'Proven',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Decision · claude · lead · 20 Sep · @bbbbbbb": the entry's who, when and commit. Pure. */
export function memoryMeta(e: MemoryEntry): string {
  const d = e.at ? new Date(e.at) : null;
  const when = d && Number.isFinite(d.getTime()) ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : null;
  return [MEMORY_KIND_WORD[e.kind], e.who, when, e.commit ? `@${e.commit.slice(0, 7)}` : null].filter(Boolean).join(' · ');
}

interface ArchitectureRailProps {
  projectId?: string | null;
  /** AA.7: the branch the node's history is read on. */
  branchId?: string | null;
  nodeId: string;
  graph: Graph;
  /** A row opens Work on its record. */
  onOpenWork?: (target: WorkTarget) => void;
  /** An imported candidate is decided under Proposals. */
  onOpenChanges?: () => void;
  /** AE.6: the explode requests staged on the project, and the two presses. */
  stagedExplodes?: readonly StagedExplode[];
  onRequestExplode?: (nodeId: string) => void;
  onWithdrawExplode?: (nodeId: string) => void;
}

/** Item 27: History lines shown before the fold. */
export const HISTORY_SHOWN = 20;

export function ArchitectureRail({ projectId, branchId, nodeId, graph, onOpenWork, onOpenChanges, stagedExplodes = [], onRequestExplode, onWithdrawExplode }: ArchitectureRailProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const tones = statusTones(theme.mode);
  // Q: the import's candidates and questions only on a plan with repo import:
  // not read below it, and not drawn either.
  const gate = useProjectFeatureGate(projectId);
  const canImport = !gate.loading && gate.can('repo_import');
  const items = useNodeItems(projectId, nodeId, canImport);
  const presence = useAgentPresence(projectId);
  const holds = holdsOnNode(presence.holds, nodeId).filter((h) => !h.stale);
  const connections = nodeConnections(graph, nodeId);
  const questions = canImport ? questionsOnNode(items.job, graph, nodeId) : [];
  // AA.7: the node's memory, flagged against the fingerprints its task document carried.
  const memoryRead = useNodeMemory(projectId, branchId, nodeId);
  const taskDoc = Object.values(graph.artifacts ?? {}).find((a) => a?.nodeId === nodeId && a?.kind === 'task') as { content?: unknown; metadata?: Record<string, unknown> } | undefined;
  const memory = nodeMemory(memoryRead.raw, taskDoc ?? null, { you: memoryRead.you });
  // Item 27: the newest lines first; the rest behind one fold, kept per node.
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);
  const historyOpen = historyOpenFor === nodeId;
  const historyShown = historyOpen ? memory.entries : memory.entries.slice(0, HISTORY_SHOWN);
  const historyHidden = memory.entries.slice(historyShown.length);
  const historyHiddenFlagged = historyHidden.filter((e) => e.review).length;
  // AA.4: the import's reading of how the node runs and ships (Indie and above).
  const deploys = canImport ? deployLines(graph.nodes[nodeId]?.metadata as Record<string, unknown> | undefined, (id) => CatalogService.getTechnologyName(id), graph.nodes[nodeId]?.deploymentTarget) : [];
  const outcomes = items.candidates.filter((k) => k.kind === 'outcome');
  const imported = canImport ? items.candidates.filter((k) => k.kind !== 'outcome') : [];
  const total = items.requirements.length + outcomes.length + imported.length;
  const proven = items.requirements.reduce((n, r) => n + r.metCount, 0);
  const criteria = items.requirements.reduce((n, r) => n + r.criteriaCount, 0) + outcomes.filter((o) => o.status === 'pending').reduce((n, o) => n + o.criteriaCount, 0);
  // AE.6: the Expand press, on a node the depth rule lets an agent explode.
  const requested = stagedExplodeFor(stagedExplodes, nodeId);
  const expandable = !!onRequestExplode && canRequestExplode(graph, nodeId, resolveRoleInfo);

  const head = (text: string, count: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', padding: '10px 16px 6px', backgroundColor: c.backgroundSecondary, borderBottom: `1px solid ${c.border}` }}>
      <span style={{ ...eyebrow(c.text), fontSize: '11px', letterSpacing: '0.06em' }}>{text}</span>
      <span style={{ ...meta(c.textSecondary), fontWeight: 700 }}>{count}</span>
    </div>
  );
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderBottom: `1px solid ${c.border}44` };
  const door = (onClick: (() => void) | undefined): React.CSSProperties => ({
    width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 16px', border: 'none', borderBottom: `1px solid ${c.border}44`,
    background: 'transparent', color: c.text, cursor: onClick ? 'pointer' : 'default', font: 'inherit',
  });
  const ellipsis: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

  const press: React.CSSProperties = {
    flexShrink: 0, padding: '4px 10px', borderRadius: '6px', border: `1px solid ${c.border}`, background: 'transparent',
    color: c.text, fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', font: 'inherit',
  };

  return (
    <div data-testid="architecture-rail" style={{ borderBottom: `1px solid ${c.border}` }}>
      {(expandable || requested) && (
        <div data-testid="rail-expand" data-state={requested ? 'requested' : 'open'} style={{ ...row, justifyContent: 'space-between' }}>
          {requested ? (
            <>
              <span style={meta(c.textSecondary)}>Expansion requested. Your agent picks it up over MCP on its next status read.</span>
              <button type="button" data-testid="rail-expand-withdraw" onClick={() => onWithdrawExplode?.(nodeId)} style={press}>Withdraw</button>
            </>
          ) : (
            <>
              <span style={meta(c.textSecondary)}>Ask your agent to split this node into parts.</span>
              <button type="button" data-testid="rail-expand-request" onClick={() => onRequestExplode?.(nodeId)} style={press}>Expand</button>
            </>
          )}
        </div>
      )}
      {head('Work here', `${proven} of ${criteria} proven`)}
      {items.error && <div style={{ ...meta(tones.bad), padding: '6px 16px' }}>{items.error}</div>}
      {!items.error && total === 0 && !items.loading && (
        <div data-testid="rail-nothing" style={{ ...meta(c.textSecondary), padding: '6px 16px' }}>Nothing is mapped or filed here yet.</div>
      )}
      {items.requirements.map((r) => {
        const open = onOpenWork ? () => onOpenWork({ kind: 'requirement', id: r.requirementRowId }) : undefined;
        return (
          <button key={r.mappingId} type="button" data-testid="rail-item" data-kind="requirement" onClick={open} disabled={!open} title={open ? 'Open it under Work' : undefined} style={door(open)}>
            <span style={{ ...meta(c.text), fontWeight: 600, ...ellipsis }}>{r.name}</span>
            <span data-testid="rail-item-line" style={{ ...meta(c.textSecondary), display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={identifier(c.textSecondary)}>{r.ref}</span>
              <span>{requirementLine(r).slice(r.ref.length + 3)}</span>
              {r.validationStatus === 'needs-review' && <span data-testid="rail-needs-review" style={{ ...stateWord(tones.warn), border: `1px solid ${tones.warn}88`, borderRadius: '5px', padding: '1px 6px' }}>needs review</span>}
            </span>
          </button>
        );
      })}
      {outcomes.map((k) => {
        const open = onOpenWork ? () => onOpenWork({ kind: 'outcome', id: k.id }) : undefined;
        return (
          <button key={k.id} type="button" data-testid="rail-item" data-kind="outcome" onClick={open} disabled={!open} title={open ? 'Open it under Work' : undefined} style={door(open)}>
            <span style={{ ...meta(c.text), fontWeight: 600, ...ellipsis }}>{k.name}</span>
            <span data-testid="rail-item-line" style={meta(c.textSecondary)}>
              {k.status === 'pending' ? `Outcome, not yet a requirement · ${k.criteriaCount} draft criteri${k.criteriaCount === 1 ? 'on' : 'a'}` : `Outcome, ${k.status === 'accepted' ? 'settled' : k.status}`}
            </span>
          </button>
        );
      })}
      {imported.map((k) => {
        const open = onOpenChanges;
        return (
          <button key={k.id} type="button" data-testid="rail-item" data-kind="candidate" onClick={open} disabled={!open} title={open ? 'Decide it under Proposals' : undefined} style={door(open)}>
            <span style={{ ...meta(c.text), fontWeight: 600, ...ellipsis }}>{k.name}</span>
            <span data-testid="rail-item-line" style={meta(c.textSecondary)}>
              Imported candidate ({k.kind}), undecided · <span style={{ color: tones.warn, fontWeight: 600 }}>proposal waiting</span>
            </span>
          </button>
        );
      })}

      {questions.map((q) => (
        <div key={q.proposalId} data-testid="rail-question" data-kind={q.questionKind ?? 'question'} style={{ display: 'flex', flexDirection: 'column', gap: '5px', margin: '10px 16px', padding: '10px 12px', borderRadius: '9px', border: `1px solid ${tones.warn}66`, backgroundColor: `${tones.warn}14` }}>
          <span style={{ ...meta(c.text), fontWeight: 650 }}>{q.target}</span>
          <span style={{ fontSize: '11.5px', lineHeight: 1.5, color: c.textSecondary }}>{q.text}</span>
        </div>
      ))}

      {head('Held by', holds.length === 0 ? 'nobody' : String(holds.length))}
      {holds.map((h) => (
        <div key={h.checkoutId}>
          <div data-testid="rail-hold" data-level={h.level} style={row}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: h.level === 'node' ? tones.warn : c.primary, flexShrink: 0 }} />
            <span style={{ ...meta(c.text), fontWeight: 650 }}>{h.holder}</span>
            <span style={meta(c.textSecondary)}>{h.level === 'node' ? 'holds the node' : `${h.level} · ${h.refLabel}`}</span>
            <span style={{ ...sinceLabelStyle(c.textSecondary), marginLeft: 'auto' }}>{sinceLabel(h.since)} ago</span>
          </div>
          {/* AA.5: what the lease reaches: the node itself, or the files of the work */}
          {reachLine(h) && <div data-testid="rail-hold-reach" title={Array.isArray(h.meta?.reach) ? (h.meta!.reach as unknown[]).map(String).join('\n') : undefined} style={{ ...meta(c.textSecondary), padding: '0 16px 6px 33px', ...ellipsis }}>{reachLine(h)}</div>}
        </div>
      ))}

      {deploys.length > 0 && head('Deploys via', String(deploys.length))}
      {deploys.map((d) => (
        <div key={d.key} data-testid="rail-deploy" data-kind={d.kind} title={d.title} style={{ ...row, alignItems: 'baseline' }}>
          <span style={{ ...meta(d.kind === 'runs' ? c.text : c.textSecondary), fontWeight: d.kind === 'runs' ? 650 : 400, flex: 1, minWidth: 0, ...ellipsis }}>{d.text}</span>
          {d.cite && <span style={{ ...identifier(c.textSecondary), flexShrink: 0 }}>{d.cite}</span>}
        </div>
      ))}

      {head('Connects to', String(connections.length))}
      {connections.map((e) => (
        <div key={e.edgeId} data-testid="rail-connection" data-direction={e.direction} style={row}>
          <span style={{ ...identifier(c.textSecondary), width: '14px', textAlign: 'center' }} aria-label={e.direction === 'out' ? 'to' : 'from'}>{e.direction === 'out' ? '→' : '←'}</span>
          <span style={{ ...meta(c.text), fontWeight: 650, flexShrink: 0 }}>{e.otherLabel}</span>
          <span style={{ ...meta(c.textSecondary), flex: 1, minWidth: 0, ...ellipsis }} title={e.label ?? undefined}>{e.contract ?? e.label ?? ''}</span>
          {e.schemaMissing && <span data-testid="rail-no-schema" title="This contract has no schema yet. Build readiness calls that a blocker." style={{ ...stateWord(tones.bad), flexShrink: 0 }}>no schema</span>}
        </div>
      ))}

      {head('History', memory.flagged > 0 ? `${memory.entries.length}, ${memory.flagged} to review` : String(memory.entries.length))}
      {memoryRead.error && <div style={{ ...meta(tones.bad), padding: '6px 16px' }}>{memoryRead.error}</div>}
      {!memoryRead.error && !memoryRead.loading && memory.entries.length === 0 && (
        <div data-testid="rail-history-empty" style={{ ...meta(c.textSecondary), padding: '6px 16px' }}>Nothing recorded on this node yet.</div>
      )}
      {historyShown.map((e, i) => (
        <div key={`${e.kind}-${e.at ?? 'standing'}-${i}`} data-testid="rail-history" data-kind={e.kind} data-review={e.review ? 'yes' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '7px 16px', borderBottom: `1px solid ${c.border}44` }}>
          <span data-testid="rail-history-meta" style={identifier(c.textSecondary)}>{memoryMeta(e)}</span>
          <span style={{ fontSize: '11.5px', lineHeight: 1.5, color: c.text, whiteSpace: 'pre-wrap' }}>{e.text}</span>
          {e.review && <span data-testid="rail-history-review" style={{ ...meta(tones.warn), fontWeight: 600 }}>{e.review}</span>}
        </div>
      ))}
      {historyHidden.length > 0 && (
        <button type="button" data-testid="rail-history-more" onClick={() => setHistoryOpenFor(nodeId)} style={{ ...meta(c.textSecondary), background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '7px 16px' }}>
          {historyHidden.length} more{historyHiddenFlagged > 0 ? `, ${historyHiddenFlagged} to review` : ''}
        </button>
      )}
      {historyOpen && memory.entries.length > HISTORY_SHOWN && (
        <button type="button" data-testid="rail-history-fewer" onClick={() => setHistoryOpenFor(null)} style={{ ...meta(c.textSecondary), background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '7px 16px' }}>
          Show fewer
        </button>
      )}
    </div>
  );
}
