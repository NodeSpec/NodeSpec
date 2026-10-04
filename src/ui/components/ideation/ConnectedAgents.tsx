// V3 I (owner ruling 2026-09-21): the Connected tab under Agents.
//
// AK.1 (owner 2026-10-01): the one place an agent is connected, on every
// build, with the method the build uses (agent-connect.ts): the managed
// platform signs the person in through their client, with a key for an
// agent that cannot open a browser; a local build (open source, Enterprise)
// connects any local MCP client with a key. The lines are per client, none
// first: Claude Code, Codex, Gemini CLI, Antigravity, the Claude app and any
// other MCP client. The header's MCP button reads the same connections as
// evidence of a call and opens this tab.
//
// The person's connected agents, one list on both lanes: the keys they
// minted for their agents and the OAuth clients they approved in the
// browser. Each row is one credential, named as the lease board names it,
// with when it last spoke, when it stops working, and what it holds right
// now. Connect an agent asks for a name and an expiry and hands back the
// key ONCE, with the exact lines to paste; Revoke ends the credential and
// its holds, after one confirmation, in the row. The plan's allowance is
// the server's number (list_api_keys): at the cap the connect door stays
// visible, shut, with the one sentence that says why.
import { useState } from 'react';
import { Copy, KeyRound, Plug } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext.js';
import { sinceLabel, type AgentHold } from './useAgentPresence.js';
import type { AgentConnection, AgentConnections } from './useAgentConnections.js';
import { mcpServerUrl } from '../../services/agent-connections.js';
import { MONO_FACE } from './typography.js';
import { buildEdition } from '../../config/edition.js';
import { AGENT_CLIENTS, clientSteps, connectIntro, connectLaneFor, type AgentClient, type ConnectLane } from '../common/agent-connect.js';

const MONO = MONO_FACE;
const CLIENT_KEY = 'nodespec.agentClient';

function rememberedClient(): AgentClient | null {
  try {
    const v = localStorage.getItem(CLIENT_KEY);
    return AGENT_CLIENTS.some((c) => c.id === v) ? (v as AgentClient) : null;
  } catch { return null; }
}

/** "used 4 min ago" / "never used". */
export function usedLine(lastUsedAt: string | null, now = Date.now()): string {
  if (!lastUsedAt) return 'never used';
  const since = sinceLabel(lastUsedAt, now);
  return since === 'now' ? 'used just now' : since ? `used ${since} ago` : 'used';
}

/** "no expiry" / "expires in 12 d" / "expires today" / "expired". */
export function expiresLine(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return 'no expiry';
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return 'no expiry';
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'expires today';
  return `expires in ${days} d`;
}

/** The holds a row has right now, matched the way the board labels a credential. */
export function holdsOf(row: AgentConnection, holds: AgentHold[]): number {
  const label = row.kind === 'key' ? `key · ${row.name}` : `oauth · ${row.id}`;
  return holds.filter((h) => h.credential === label).length;
}

const EXPIRY_OPTIONS: Array<{ value: string; label: string; days: number | null }> = [
  { value: 'never', label: 'Never', days: null },
  { value: '30', label: 'In 30 days', days: 30 },
  { value: '90', label: 'In 90 days', days: 90 },
];

export function ConnectedAgents({ connections, holds, lane = connectLaneFor(buildEdition, mcpServerUrl()) }: {
  connections: AgentConnections;
  holds: AgentHold[];
  /** How this build connects (AK.1): the edition and where the server is decide; tests pass it. */
  lane?: ConnectLane;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [client, setClientState] = useState<AgentClient | null>(rememberedClient);
  const setClient = (id: AgentClient) => {
    setClientState(id);
    try { localStorage.setItem(CLIENT_KEY, id); } catch { /* private window: the choice lasts this visit */ }
  };
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ name: string; apiKey: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const codeBlock = (id: string, text: string) => (
    <div style={{
      position: 'relative', padding: '8px 64px 8px 10px', borderRadius: '6px', fontSize: '11px',
      backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
      border: `1px solid ${c.border}`, fontFamily: MONO,
      whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5, color: c.text,
    }}>
      {text}
      <button
        type="button"
        onClick={() => copyText(id, text)}
        style={{
          position: 'absolute', top: '6px', right: '6px', padding: '2px 7px',
          borderRadius: '4px', border: `1px solid ${c.border}`, fontSize: '11px',
          backgroundColor: copied === id ? '#15803d' : c.surface,
          color: copied === id ? '#fff' : c.text, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '4px',
        }}
      >
        <Copy size={10} /> {copied === id ? 'Copied' : 'Copy'}
      </button>
    </div>
  );

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setFormError('Name the agent this key is for.'); return; }
    setBusy(true);
    setFormError(null);
    const days = EXPIRY_OPTIONS.find((o) => o.value === expiry)?.days ?? null;
    const r = await connections.connect({ name: trimmed, expiresInDays: days });
    setBusy(false);
    if ('error' in r) { setFormError(r.error); return; }
    setSecret({ name: r.name, apiKey: r.apiKey });
    setFormOpen(false);
    setName('');
    setExpiry('never');
  };

  const revoke = async (row: AgentConnection) => {
    setBusy(true);
    setRowError(null);
    const r = await connections.revoke(row);
    setBusy(false);
    setConfirming(null);
    if ('error' in r) setRowError(r.error);
  };

  const buttonStyle = (primary: boolean, disabled = false): React.CSSProperties => ({
    padding: '5px 11px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600,
    border: primary ? 'none' : `1px solid ${c.border}`,
    backgroundColor: primary ? c.primary : 'transparent',
    color: primary ? '#fff' : c.text,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  });

  const url = mcpServerUrl();
  const unused = connections.rows.length > 0 && connections.rows.every((r) => !r.lastUsedAt);
  const doorShut = connections.atCap || connections.loading || !!connections.error;
  const label = (text: string) => (
    <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: c.textMuted }}>{text}</div>
  );

  // The client row: every client equal, none chosen until the person picks.
  const picker = (
    <div data-testid="connect-clients" role="group" aria-label="Your client" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {AGENT_CLIENTS.map((cl) => (
        <button
          key={cl.id}
          type="button"
          data-testid={`connect-client-${cl.id}`}
          aria-pressed={client === cl.id}
          onClick={() => setClient(cl.id)}
          style={{
            padding: '4px 10px', borderRadius: '6px', fontSize: '11.5px', fontWeight: client === cl.id ? 700 : 500, cursor: 'pointer',
            border: client === cl.id ? `1px solid ${c.primary}` : `1px solid ${c.border}`,
            backgroundColor: client === cl.id ? c.primary : 'transparent',
            color: client === cl.id ? '#fff' : c.text,
          }}
        >
          {cl.label}
        </button>
      ))}
    </div>
  );

  // One client's steps and lines on one lane.
  const lines = (forLane: ConnectLane, apiKey?: string) => {
    if (!client) {
      return <div data-testid="connect-pick" style={{ fontSize: '11.5px', color: c.textMuted }}>Pick the client your agent runs in.</div>;
    }
    const s = clientSteps(client, forLane, url, apiKey);
    if (forLane === 'sign-in' && s.needsKey) {
      return (
        <div data-testid="connect-needs-key" style={{ fontSize: '12px', color: c.text, lineHeight: 1.55 }}>
          {AGENT_CLIENTS.find((x) => x.id === client)!.label} connects with a key: its browser sign-in to a remote server is not dependable yet. Use Connect with a key below; the key comes with its exact line.
        </div>
      );
    }
    return (
      <div data-testid="connect-steps" data-client={client} data-lane={forLane} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: c.text, lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {s.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        {s.blocks.map((b) => (
          <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {label(b.label)}
            {codeBlock(`${forLane}-${b.id}`, b.text)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div data-testid="connected-agents" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 700, letterSpacing: '.09em', color: c.primary }}>CONNECTED AGENTS</span>
        <span data-testid="connected-count" style={{ fontSize: '11.5px', color: c.textSecondary }}>
          {connections.loading && connections.rows.length === 0 ? 'reading your connections' : `${connections.active} of ${connections.limit} connected`}
        </span>
      </div>
      {connections.allowance && (
        <div data-testid="connected-allowance" style={{ fontSize: '11.5px', color: c.textMuted, lineHeight: 1.5 }}>
          {connections.allowance} An agent connects with a key you mint here, or by signing in through its own client; both count.
        </div>
      )}

      {connections.error && (
        <div data-testid="connected-error" style={{ fontSize: '11.5px', color: '#b45309', display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span>{connections.error}</span>
          <button type="button" onClick={() => void connections.refresh()} style={{ ...buttonStyle(false), padding: '2px 8px' }}>Try again</button>
        </div>
      )}

      {!connections.error && !connections.loading && connections.rows.length === 0 && (
        <div data-testid="connected-empty" style={{ fontSize: '12px', color: c.textMuted, lineHeight: 1.55 }}>
          {lane === 'sign-in'
            ? 'No agents connected yet. Add NodeSpec in your client below and approve the sign-in, or connect one with a key; either appears here.'
            : 'No agents connected yet. Connect one below: it gets a key, and its client the line to paste.'}
        </div>
      )}

      {connections.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${c.border}`, borderRadius: '8px', overflow: 'hidden' }}>
          {connections.rows.map((row, i) => {
            const held = holdsOf(row, holds);
            const isConfirming = confirming === `${row.kind}:${row.id}`;
            return (
              <div
                key={`${row.kind}:${row.id}`}
                data-testid="connected-row"
                data-kind={row.kind}
                style={{ padding: '9px 12px', borderTop: i === 0 ? 'none' : `1px solid ${c.border}`, display: 'flex', flexDirection: 'column', gap: '4px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span data-testid="connected-row-name" style={{ fontFamily: MONO, fontSize: '12.5px', fontWeight: 700, color: c.text, wordBreak: 'break-all' }}>{row.name}</span>
                  <span data-testid="connected-row-kind" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: '4px', padding: '1px 5px' }}>
                    {row.kind === 'key' ? 'key' : 'OAuth'}
                  </span>
                  <span style={{ flex: 1 }} />
                  {!isConfirming && (
                    <button
                      type="button"
                      data-testid="connected-revoke"
                      disabled={busy}
                      onClick={() => { setRowError(null); setConfirming(`${row.kind}:${row.id}`); }}
                      style={buttonStyle(false, busy)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
                <div data-testid="connected-row-line" style={{ fontSize: '11px', color: c.textMuted }}>
                  {usedLine(row.lastUsedAt)} · {expiresLine(row.expiresAt)}{held > 0 ? ` · holding ${held} lease${held === 1 ? '' : 's'}` : ''}
                </div>
                {isConfirming && (
                  <div data-testid="connected-revoke-confirm-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '11.5px', color: c.text, marginTop: '2px' }}>
                    <span>
                      Revoke {row.name}? {row.kind === 'key' ? 'The key stops working' : 'The client must sign in again'}{held > 0 ? ` and its ${held} lease${held === 1 ? '' : 's'} end now` : ''}.
                    </span>
                    <button type="button" data-testid="connected-revoke-confirm" disabled={busy} onClick={() => void revoke(row)} style={buttonStyle(true, busy)}>Revoke</button>
                    <button type="button" data-testid="connected-revoke-keep" disabled={busy} onClick={() => setConfirming(null)} style={buttonStyle(false, busy)}>Keep</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {rowError && <div data-testid="connected-row-error" style={{ fontSize: '11.5px', color: '#b45309' }}>{rowError}</div>}
      {unused && (
        <div data-testid="connected-unused" style={{ fontSize: '11.5px', color: c.textMuted, lineHeight: 1.5 }}>
          None of these has called NodeSpec yet. The header reads MCP connected after an agent&apos;s first call.
        </div>
      )}

      {secret ? (
        <div data-testid="connected-secret" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', border: `1px solid ${c.primary}`, borderRadius: '8px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 600, color: c.text }}>
            {secret.name} is connected. This key is shown once.
          </div>
          {codeBlock('secret', secret.apiKey)}
          <div style={{ fontSize: '11.5px', color: c.textMuted, lineHeight: 1.5 }}>
            Every line below carries it. If you lose it, revoke this connection and connect again.
          </div>
          {picker}
          {lines('key', secret.apiKey)}
          <div>
            <button type="button" data-testid="connected-done" onClick={() => setSecret(null)} style={buttonStyle(true)}>Done</button>
          </div>
        </div>
      ) : formOpen ? (
        <form
          data-testid="connected-form"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', border: `1px solid ${c.border}`, borderRadius: '8px' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', fontWeight: 600, color: c.textMuted }}>
            Name, as the board will show it
            <input
              data-testid="connected-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="hermes"
              autoFocus
              style={{ padding: '6px 8px', fontSize: '12.5px', fontFamily: MONO, borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: c.surface, color: c.text }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', fontWeight: 600, color: c.textMuted }}>
            Expires
            <select
              data-testid="connected-expiry"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: c.surface, color: c.text }}
            >
              {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {formError && <div data-testid="connected-form-error" style={{ fontSize: '11.5px', color: '#b45309' }}>{formError}</div>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" data-testid="connected-submit" disabled={busy} style={buttonStyle(true, busy)}>{busy ? 'Connecting' : 'Connect'}</button>
            <button type="button" data-testid="connected-cancel" disabled={busy} onClick={() => { setFormOpen(false); setFormError(null); }} style={buttonStyle(false, busy)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div data-testid="connect-door" data-lane={lane} style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', border: `1px solid ${c.border}`, borderRadius: '8px' }}>
          {label(lane === 'sign-in' ? 'Connect from your AI' : 'Connect a local MCP client')}
          <div data-testid="connect-intro" style={{ fontSize: '12px', color: c.textSecondary, lineHeight: 1.55 }}>{connectIntro(lane)}</div>
          {lane === 'sign-in' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {label('Server address')}
                {codeBlock('server-url', url)}
              </div>
              {picker}
              {lines('sign-in')}
            </>
          )}
          {connections.atCap && !connections.loading && !connections.error && (
            <div data-testid="connected-cap-line" style={{ fontSize: '11.5px', color: c.textMuted, lineHeight: 1.5 }}>{connections.capMessage}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...(lane === 'sign-in' ? { borderTop: `1px solid ${c.border}`, paddingTop: '10px' } : {}) }}>
            {lane === 'sign-in' && (
              <div data-testid="connect-key-note" style={{ fontSize: '11.5px', color: c.textMuted, lineHeight: 1.5 }}>
                An agent that cannot open a browser (Antigravity, Hermes, a server or CI) connects with a key instead.
              </div>
            )}
            <div>
              <button
                type="button"
                data-testid="connected-connect"
                disabled={doorShut}
                onClick={() => { setFormOpen(true); setFormError(null); }}
                style={{ ...buttonStyle(lane === 'key', doorShut), display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {lane === 'sign-in' ? <><KeyRound size={12} /> Connect with a key</> : <><Plug size={12} /> Connect an agent</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
