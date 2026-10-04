/*
  Community edition stub: the structural signals of a change card (routes,
  dependencies, outbound hosts, new service directories) are read with the
  repository import's extractors, which are not part of the open-source
  distribution. The reconcile packet imports this seam; here it answers
  { available: false } and the packet carries every other section unchanged.
  Available on NodeSpec hosted (Indie and above) and in enterprise builds:
  https://nodespec.io/pricing
*/
export interface SignalsFile {
  path: string;
  action: "added" | "modified" | "removed";
  oldPath?: string;
}

export type ReadAt = (path: string, ref: string) => Promise<
  { status: "found"; text: string } | { status: "absent" } | { status: "failed"; error: string }
>;

export interface RouteSignal { method: string; route: string; framework: string; path: string; line?: number }
export interface NamedSignal { name: string; path: string; line?: number }
export interface HostSignal { host: string; url: string; path: string; line?: number }
export interface DeploymentFileSignal { kind: string; path: string; line?: number; detail?: string }
export interface ManifestSignal { path: string; dir: string; kind: "manifest" | "dockerfile" }

export interface ReconcileSignals {
  available: true;
  routes: { added: RouteSignal[]; removed: RouteSignal[] };
  deps: { added: NamedSignal[]; dropped: NamedSignal[] };
  imports: { added: NamedSignal[] };
  hosts: { added: HostSignal[] };
  env: { added: NamedSignal[] };
  deployments: { added: DeploymentFileSignal[]; removed: DeploymentFileSignal[] };
  manifests: { added: ManifestSignal[] };
  unread: string[];
}

export type ReconcileSignalsResult = ReconcileSignals | { available: false };

export const SIGNAL_READ_CAP = 0;

export function lineOfText(_content: string | null, _needle: string): number | undefined {
  return undefined;
}

export function computeReconcileSignals(
  _files: SignalsFile[],
  _args: { baseSha: string | null; headSha: string; read: ReadAt; cap?: number },
): Promise<ReconcileSignalsResult> {
  return Promise.resolve({ available: false });
}
