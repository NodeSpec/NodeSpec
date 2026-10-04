/*
  P0-8: the cancellation decision, extracted verbatim from index.ts so it is testable
  (index.ts is a Deno.serve module). index.ts keeps auth, Stripe/DB side effects, and
  uses this decision's outputs unchanged.
*/
import type { SeatedProject } from '../_shared/project-membership.ts';

export const ANNUAL_REFUND_WINDOW_DAYS = 30;
export const ANNUAL_REFUND_MONTHS = 11;
export const MONTHS_IN_YEAR = 12;

export interface CancellationSubscription {
  current_period_start: number; // unix seconds
  current_period_end: number;   // unix seconds
  items: { data: Array<{ price?: { recurring?: { interval?: string } | null; unit_amount?: number | null } | null }> };
}

export interface CancellationDecision {
  cancellationType: 'immediate_with_refund' | 'end_of_period';
  refundAmountCents: number;
  effectiveEndDate: string;
}

export function decideCancellation(
  subscription: CancellationSubscription,
  now: Date,
): CancellationDecision {
  const billingInterval = subscription.items.data[0]?.price?.recurring?.interval;
  const isAnnual = billingInterval === 'year';
  const periodStartDate = new Date(subscription.current_period_start * 1000);
  const daysSincePeriodStart = Math.floor(
    (now.getTime() - periodStartDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const eligibleForAnnualRefund = isAnnual && daysSincePeriodStart <= ANNUAL_REFUND_WINDOW_DAYS;

  if (eligibleForAnnualRefund) {
    const totalAmountCents = subscription.items.data[0]?.price?.unit_amount ?? 0;
    const refundAmountCents = Math.round((totalAmountCents * ANNUAL_REFUND_MONTHS) / MONTHS_IN_YEAR);
    return {
      cancellationType: 'immediate_with_refund',
      refundAmountCents,
      effectiveEndDate: now.toISOString(),
    };
  }

  return {
    cancellationType: 'end_of_period',
    refundAmountCents: 0,
    effectiveEndDate: new Date(subscription.current_period_end * 1000).toISOString(),
  };
}

/*
  V3 AE.1 (owner 2026-09-25): "a team owner has to delegate ownership
  status to one of the other accounts prior to downgrading" (Enterprise the
  same, in the container the owner administers). index.ts runs this after
  auth and before Stripe is touched: a refusal costs nothing, names the
  projects, and points at the hand-over (the Team popup's Make owner,
  transfer_project_ownership in the database). The reader is shared with
  delete-account (ownedProjectsWithSeats, _shared/project-membership.ts).
*/

export function downgradeRefusal(blockers: ReadonlyArray<SeatedProject>): string {
  const list = blockers.map((b) => `${b.name} (${b.seats} seat${b.seats === 1 ? '' : 's'})`).join(', ');
  return `Before you downgrade, hand each project that still has seats to one of its accounts: ${list}. ` +
    'Open the project, press Team, and press Make owner on the account that takes it; you keep a maintainer seat.';
}
