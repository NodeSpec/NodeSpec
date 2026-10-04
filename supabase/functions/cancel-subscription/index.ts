import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
// P0-8: the cancellation decision (refund window/amount math) lives in
// ./logic.ts; the request handling in ./handler.ts. Both run under deno test.
import { handleCancelSubscription, type CancelStripe } from './handler.ts';

Deno.serve((req) => handleCancelSubscription(req, {
  env: Deno.env,
  createClient: (url, key) => createClient(url, key),
  stripe: (secret) => new Stripe(secret, {
    appInfo: { name: 'NodeSpec Integration', version: '1.0.0' },
  }) as unknown as CancelStripe,
}));
