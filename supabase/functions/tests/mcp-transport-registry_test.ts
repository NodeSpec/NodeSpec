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
