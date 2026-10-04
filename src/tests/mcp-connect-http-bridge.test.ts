import { describe, it, expect } from 'vitest';
import { clientSteps } from '../ui/components/common/agent-connect.js';

/*
  Plain-HTTP MCP connect lane (owner boot-test find, 2026-08-31), kept
  through AK.1 (owner 2026-10-01: one method, a line per client).

  A community container runs on http:// when local or freshly self-hosted,
  and the Claude app adds remote servers by URL only over https, so on a
  local build it connects through the mcp-remote bridge, a local relay the
  app launches itself, carrying the key. The owner's live hits stay taught:
  the file is claude_desktop_config.json (not its neighbour config.json),
  the entry goes inside mcpServers, and the app only reads it at launch.
*/

const LOCAL = 'http://127.0.0.1:54321/functions/v1/mcp-server';
const CLOUD = 'https://nodespec.example/functions/v1/mcp-server';

describe('the Claude app on a local build: the mcp-remote bridge', () => {
  const steps = clientSteps('claude-app', 'key', LOCAL, 'ns_live_k');
  const entry = JSON.parse(steps.blocks[0].text).mcpServers.nodespec;

  it('http gets the bridge with --allow-http, launched by the app itself, the key in its environment', () => {
    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual(['-y', 'mcp-remote', LOCAL, '--allow-http', '--header', 'Authorization:${NODESPEC_AUTH}']);
    // no space inside an argument: the bridge reads the header from the environment
    expect(entry.env).toEqual({ NODESPEC_AUTH: 'Bearer ns_live_k' });
  });

  it('names the right file, where the entry goes, and the full restart', () => {
    expect(steps.blocks[0].label).toBe('claude_desktop_config.json');
    const said = steps.steps.join(' ');
    expect(said).toContain('Settings, Developer, Edit Config, which opens claude_desktop_config.json');
    expect(said).toContain('inside mcpServers');
    expect(said).toContain('quit Claude fully and open it again');
  });

  it('https needs no --allow-http; on the managed platform the app signs in through its connectors instead', () => {
    expect(JSON.parse(clientSteps('claude-app', 'key', CLOUD, 'ns_live_k').blocks[0].text).mcpServers.nodespec.args).not.toContain('--allow-http');
    const managed = clientSteps('claude-app', 'sign-in', CLOUD);
    expect(managed.steps.join(' ')).toContain('Settings, Connectors, and choose Add custom connector');
    expect(managed.blocks).toEqual([{ id: 'claude-app', label: 'Server address', text: CLOUD }]);
  });
});
