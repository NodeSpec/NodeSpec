/*
  P0-8: checkout's per-tier price validation and session parameters, extracted verbatim
  from index.ts so they are testable (index.ts is a Deno.serve module). index.ts keeps
  auth, customer provisioning side effects, and the Stripe calls.
*/
import { VALID_LOOKUP_KEYS } from '../_shared/stripe-plans.ts';

/** Exactly the inline check index.ts performed, against the now-shared key set. */
export function validateCheckoutPrice(price_id: string): string | null {
  if (!VALID_LOOKUP_KEYS.has(price_id)) {
    return `Invalid price identifier: ${price_id}`;
  }
  return null;
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
