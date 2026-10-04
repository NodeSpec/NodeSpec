// N5.10 hotfix guard: the MCP_TOOLS registry lived in one giant literal in
// transport.ts, and nothing in the suite could import that module (its handler graph
// pulls jsr:@supabase/supabase-js — blocked here, jsr-403) — so a quoting mistake in a
// tool description (an unescaped apostrophe in a single-quoted string) shipped as a
// syntax error, killed the edge function at boot, and broke every MCP client
// connection. The registry now lives in tool-registry.ts (pure data, zero imports);
// importing it HERE makes the suite parse it, and the assertions keep it shaped like
// what tools/list serves.
import { MCP_TOOLS } from '../mcp-server/tool-registry.ts';
import { assert } from './helpers.ts';

Deno.test('MCP_TOOLS registry parses and every tool is well-formed', () => {
  assert(Array.isArray(MCP_TOOLS) && MCP_TOOLS.length > 20, 'registry present');
  const names = new Set<string>();
  for (const tool of MCP_TOOLS) {
    assert(typeof tool.name === 'string' && tool.name.length > 0, 'tool has a name');
    assert(!names.has(tool.name), `duplicate tool name: ${tool.name}`);
    names.add(tool.name);
    assert(typeof tool.description === 'string' && tool.description.length > 0, `${tool.name}: description present`);
    assert(typeof tool.inputSchema === 'object' && tool.inputSchema !== null, `${tool.name}: inputSchema present`);
    assert(tool.requiredScope === null || ['read', 'write', 'propose'].includes(tool.requiredScope as string), `${tool.name}: requiredScope valid`);
  }
});

// R19: the registry is what tools/list ADVERTISES; the transport switch is
// what actually ANSWERS. Nothing bound them — a tool present in one and not
// the other would advertise and then refuse (or answer while invisible).
// transport.ts cannot be imported here (its handler graph pulls jsr), so the
// dispatch cases are read off the source text: every `case '<tool>'` label
// in the tool dispatch, compared as a SET against the registry names.
Deno.test('R19: every registered tool has a dispatch case, and every tool-shaped case is registered', () => {
  const src = Deno.readTextFileSync(new URL('../mcp-server/transport.ts', import.meta.url));
  const PROTOCOL_CASES = new Set(['initialize', 'initialized', 'ping']);
  const cases = new Set(
    [...src.matchAll(/^\s*case '([a-z_/]+)':/gm)]
      .map((m) => m[1])
      .filter((n) => !n.includes('/') && !PROTOCOL_CASES.has(n)),
  );
  const registered = new Set(MCP_TOOLS.map((t) => t.name));
  for (const name of registered) assert(cases.has(name), `registered but not dispatched: ${name}`);
  for (const name of cases) assert(registered.has(name), `dispatched but not registered: ${name}`);
});

Deno.test('R19: the unknown-tool refusal derives from the registry, never a hand-kept list', async () => {
  const src = Deno.readTextFileSync(new URL('../mcp-server/transport.ts', import.meta.url));
  // the drifted literal is gone (attribute form, not the full stale string)
  assert(!src.includes('Available tools: list_projects'), 'stale hand-kept name list removed');
  // Q: the refusal consults the registry through the caller's plan
  // (tool-surface.ts unknownToolMessage -> nearestToolNames over the plan's
  // names), so a typo never suggests a tool the plan hides.
  assert(src.includes('unknownToolMessage(request.tool'), 'refusal consults the registry');
  // both doors: the JSON-RPC tools/call gate (what an MCP client's typo
  // hits) and the direct-dispatch default (the app/bench transport)
  assert(src.includes('unknownToolMessage(params.name'), 'tools/call refusal consults the registry too');
  const { nearestToolNames } = await import('../mcp-server/tool-registry.ts');
  // one-typo and one-word-away calls come back with the real name first
  assert(nearestToolNames('checkout_tsk')[0] === 'checkout_task', 'typo resolves');
  assert(nearestToolNames('get_workqueue')[0] === 'get_work_queue', 'missing underscore resolves');
  assert(nearestToolNames('release_checkout')[0] === 'release_checkout', 'exact name is its own suggestion');
  // garbage suggests nothing rather than misleading
  assert(nearestToolNames('xxxxxxxxxxxxxxxxxxxxxxxxxxxxx').length === 0, 'no suggestion for noise');
  assert(nearestToolNames('').length === 0, 'empty input suggests nothing');
});
