/*
  Community edition stub. The Plan tab (the order of operations over the
  deterministic coupling engine) is not part of the open-source distribution
  (R1: indie+; available on NodeSpec hosted Indie and above and in enterprise
  builds; https://nodespec.io/pricing). Work mounts this unconditionally; here
  it renders nothing instead of the plan, and the tab's tier tag says why.
*/
export function chipTraceState(_state: string, _held: boolean): 'open' {
  return 'open';
}
export const CHIP_WORD: Record<string, string> = {};
export const GENERATE_DOCS_NOTE = '';
export const holderInitial = (holder: string): string => holder.charAt(0).toLowerCase();
export interface PlanFile { path: string; also: string[] }
export function PlanLegend() {
  return null;
}
export function PlanTab(_props: { [key: string]: unknown }) {
  return null;
}
