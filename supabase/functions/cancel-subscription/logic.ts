/*
  P0-8: the cancellation decision, extracted verbatim from index.ts so it is testable
  (index.ts is a Deno.serve module). index.ts keeps auth, Stripe/DB side effects, and
  uses this decision's outputs unchanged.
*/

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
