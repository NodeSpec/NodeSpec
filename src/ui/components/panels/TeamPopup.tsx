/*
  Community edition stub: the Team popup (project seats by email) is the
  Team roster, which is not part of the open-source distribution (R1:
  multi-lane + presence is Team). Every project here has one account, its
  owner; the TopBar never offers the button below Team, and this component
  renders nothing. Available on NodeSpec hosted (Team and above) and in
  the licensed container: https://nodespec.io/pricing
*/
export function TeamPopup(_props: { projectId: string; projectName?: string; onClose: () => void; example?: boolean; viewOnly?: boolean; belowPlan?: boolean }) {
  return null;
}

/** No roster here, so never a seat to remove. */
export function useTeamBelowPlan(_projectId: string | null | undefined, _gate: unknown, _check = 0): boolean {
  return false;
}
