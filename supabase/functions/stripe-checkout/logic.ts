/*
  P0-8: checkout's per-tier price validation and session parameters, extracted verbatim
  from index.ts so they are testable (index.ts is a Deno.serve module). index.ts keeps
  auth, customer provisioning side effects, and the Stripe calls.
*/
import { CHECKOUT_LOOKUP_KEYS, VALID_LOOKUP_KEYS } from '../_shared/stripe-plans.ts';

/**
 * Owner ruling 2026-08-31: checkout sells exactly the live catalog
 * (CHECKOUT_LOOKUP_KEYS — Indie monthly/annual). Keys the resolution side
 * still recognizes but checkout no longer offers get a NAMED refusal so a
 * stale client says why, not "invalid".
 */
export function validateCheckoutPrice(price_id: string): string | null {
  if (CHECKOUT_LOOKUP_KEYS.has(price_id)) return null;
  if (VALID_LOOKUP_KEYS.has(price_id)) {
    if (price_id.includes('token_addon')) {
      return 'Token add-ons are not currently offered.';
    }
    return 'This plan is not available for purchase yet — Indie is the current paid tier ($15/mo or $144/yr). For Team, join the waitlist at https://nodespec.io/pricing.';
  }
  return `Invalid price identifier: ${price_id}`;
}

export interface CheckoutSessionParams {
  customer: string;
  payment_method_types: string[];
  line_items: Array<{ price: string; quantity: number }>;
  mode: string;
  success_url: string;
  cancel_url: string;
}

export function buildCheckoutSessionParams(
  customerId: string,
  resolvedPriceId: string,
  mode: string,
  success_url: string,
  cancel_url: string,
): CheckoutSessionParams {
  return {
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: resolvedPriceId,
        quantity: 1,
      },
    ],
    mode,
    success_url,
    cancel_url,
  };
}
