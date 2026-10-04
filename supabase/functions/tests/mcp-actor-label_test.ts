// O.2 (owner's report 2026-09-22): a proposal's author is the credential
// that filed it. The history said "unknown agent" for a change a named,
// minted key had made, because every writer fell back to a literal when
// the agent sent no `external_agent`. These pin the two helpers every
// writer now shares: the proven credential label, and the actor label that
// prefers the nickname only when one was actually given.
import { actorLabel, credentialOf } from '../mcp-server/shared.ts';
import { assertEquals } from './helpers.ts';

const key = { userId: 'u1', keyId: '12345678-0000-4000-8000-000000000000', scopes: ['read'], authMethod: 'api_key' as const };

Deno.test('credentialOf: an API key is its name; its id prefix only when the name is unknown', () => {
  assertEquals(credentialOf({ ...key, keyName: 'hermes' }), { delegate: `key:${key.keyId}`, label: 'key · hermes' });
  assertEquals(credentialOf(key), { delegate: `key:${key.keyId}`, label: 'key · 12345678' });
});

Deno.test('credentialOf: an OAuth connector is its client; a session is its email', () => {
  assertEquals(credentialOf({ userId: 'u1', clientId: 'claude-desktop', scopes: [], authMethod: 'oauth_token' }), { delegate: 'oauth:u1:claude-desktop', label: 'oauth · claude-desktop' });
  assertEquals(credentialOf({ userId: 'u1', scopes: [], authMethod: 'jwt', email: 'ben@example.com' }), { delegate: null, label: 'ben@example.com' });
  assertEquals(credentialOf({ userId: 'u1', scopes: [], authMethod: 'jwt' }), { delegate: null, label: 'signed-in user' });
});

Deno.test('actorLabel: the nickname when given, else the credential; never "unknown agent"', () => {
  assertEquals(actorLabel({ ...key, keyName: 'hermes' }, 'claude · planner'), 'claude · planner');
  assertEquals(actorLabel({ ...key, keyName: 'hermes' }, undefined), 'key · hermes');
  assertEquals(actorLabel({ ...key, keyName: 'hermes' }, ''), 'key · hermes');
  assertEquals(actorLabel({ ...key, keyName: 'hermes' }, '   '), 'key · hermes');
  assertEquals(actorLabel(key, 42), 'key · 12345678');
});
