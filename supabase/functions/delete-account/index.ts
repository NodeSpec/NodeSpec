import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
// The request handling lives in ./handler.ts, which runs under deno test.
import { handleDeleteAccount, type DeleteStripe } from './handler.ts';

Deno.serve((req) => handleDeleteAccount(req, {
  env: Deno.env,
  createClient: (url, key) => createClient(url, key),
  stripe: (secret) => new Stripe(secret, {
    appInfo: { name: 'NodeSpec Integration', version: '1.0.0' },
  }) as unknown as DeleteStripe,
}));
