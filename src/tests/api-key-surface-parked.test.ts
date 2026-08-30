import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/*
  MCP API-key surface: PARKED, not deleted (owner ruling 2026-08-30).

  The Account panel's "Agents" tab read as a V1 BYOK hangover — an AI
  connected by pasting an API key — and confused users now that OAuth via
  the consent page is the one connection story. The frontend surface is
  REMOVED; the backend lane stays fully functional as a placeholder for a
  future headless/CI surface: already-issued ns_live_ keys keep working,
  the Worker's advertised X-MCP-API-Key header keeps working, and keys are
  managed through the MCP tools by an already-connected assistant.
*/

const ROOT = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf-8');

describe('frontend: no API-key management surface remains', () => {
  it('the panel is gone and nothing imports it', () => {
    expect(existsSync(resolve(ROOT, 'src/ui/components/panels/MCPApiKeysPanel.tsx'))).toBe(false);
    expect(read('src/ui/components/panels/index.ts')).not.toContain('MCPApiKeysPanel');
    expect(read('src/ui/components/panels/AccountPanel.tsx')).not.toContain('MCPApiKeysPanel');
  });

  it('the Account panel has no Agents tab', () => {
    const panel = read('src/ui/components/panels/AccountPanel.tsx');
    expect(panel).not.toContain("'agents'");
    expect(panel).not.toContain('>\n          Agents\n        </button>');
  });

  it('the connect guide no longer steers users to paste an API key', () => {
    const guide = read('src/ui/components/common/McpConnectGuide.tsx');
    expect(guide).not.toContain('ns_live_');
    expect(guide).not.toContain('X-MCP-API-Key');
  });
});

describe('backend: the lane is parked, never removed', () => {
  it('auth still honors ns_live_ keys, and says why the UI is gone', () => {
    const auth = read('supabase/functions/mcp-server/auth.ts');
    expect(auth).toContain("token.startsWith('ns_live_')");
    expect(auth).toContain('authenticateWithApiKey(supabase, token)');
    expect(auth).toContain('PARKED LANE');
  });

  it('the key tools stay registered so a connected assistant can manage keys', () => {
    const registry = read('supabase/functions/mcp-server/tool-registry.ts');
    for (const tool of ['create_api_key', 'list_api_keys', 'revoke_api_key']) {
      expect(registry).toContain(`name: '${tool}'`);
    }
    expect(read('supabase/functions/mcp-server/tools/keys.ts')).toContain('PARKED LANE');
  });
});
