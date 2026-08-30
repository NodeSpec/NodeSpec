import { useNavigate } from 'react-router-dom';
import { usePageSeo, BASE_URL } from '../../hooks/usePageSeo.js';
import { SiteFooter } from '../common/SiteFooter.js';
import logoLight from '../../assets/lightmode_nodal.png';

const TOOLS = [
  // ── Orientation & reads ────────────────────────────────────────────────────
  { name: 'list_projects', scope: 'read', description: 'List all projects owned by the authenticated user. Call this first to get a project_id before using other project-scoped tools.', params: [] },
  { name: 'list_branches', scope: 'read', description: 'List all branches for a project. Most calls target main; branch_id comes from here.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }] },
  { name: 'get_project_status', scope: 'read', description: 'Start here each session: current phase, entity counts, unreconciled repository drift, any staged import, a nextAction telling your agent what to do next, and the testBudget gauge (one binding test per criterion; overTested requirements get a consolidation nudge).', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }] },
  { name: 'get_architecture_overview', scope: 'read', description: 'The full topology: nodes, edges, contracts, container hierarchy, artifact completeness, and a Mermaid diagram. Orientation, not per-node implementation detail.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'branch_id', type: 'string', required: false, desc: 'Branch UUID (defaults to main)' }] },
  { name: 'get_project_context', scope: 'read', description: 'The scoped task packet for one node (or requirement/artifact): role doctrine, technology guidance, interface contracts, bound files, and the criteria it serves. Use view:"brief" unless you need machine-readable fields.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'branch_id', type: 'string', required: true, desc: 'The branch UUID' }, { name: 'target_type', type: 'string', required: true, desc: 'node, feature, artifact, or requirement' }, { name: 'target_id', type: 'string', required: true, desc: 'ID or label of the target' }, { name: 'view', type: 'string', required: false, desc: 'brief (default), structured, or full' }] },
  { name: 'get_build_readiness', scope: 'read', description: 'Preflight before writing code: per-node blockers and advisories plus a dependency-ordered buildOrder. Call unscoped for the summary, then re-call scoped to one node for full gap detail.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'branch_id', type: 'string', required: true, desc: 'The branch UUID' }, { name: 'node_ids', type: 'array', required: false, desc: 'Scope to specific nodes for full detail' }] },
  { name: 'list_requirements', scope: 'read', description: 'All requirements with acceptance criteria, met/unmet state, mappings, and relations. The source of exact criterion wording for test reporting.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'category', type: 'string', required: false, desc: 'Filter by category' }, { name: 'status', type: 'string', required: false, desc: 'Filter by status' }] },
  { name: 'get_test_plan', scope: 'read', description: 'The server-generated test plan for a requirement, derived from its criteria. Your agent implements and runs the scenarios, then reports outcomes via report_test_results. Budget: one binding test per criterion first; deep-tier tests after the requirement reads verified (smoke).', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'branch_id', type: 'string', required: true, desc: 'The branch UUID' }, { name: 'requirement_id', type: 'string', required: true, desc: 'The requirement UUID' }] },
  { name: 'get_proposal_status', scope: 'read', description: 'Check whether a submitted proposal was accepted or rejected.', params: [{ name: 'proposal_id', type: 'string', required: true, desc: 'The proposal UUID from propose_patches' }] },
  { name: 'get_pending_changes', scope: 'read', description: 'Repository changes made outside the NodeSpec loop, matched back to the nodes that own the files. Also surfaces any checkbox ticks the change carries (acceptance criteria and anchored implementation tasks from task docs) and whether they were already applied. Reconcile these before building.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }] },
  { name: 'search_catalog', scope: 'read', description: 'Search the role and technology catalog by capability or name. Use before changing a node role or tagging a technology.', params: [{ name: 'query', type: 'string', required: true, desc: 'Search text (2+ characters)' }] },
  { name: 'lookup_catalog', scope: 'read', description: 'Full detail for one known role or technology id, including its AI context.', params: [{ name: 'id', type: 'string', required: true, desc: 'The role or technology id' }] },

  // ── Repository import ──────────────────────────────────────────────────────
  { name: 'run_repo_import', scope: 'propose', description: 'THE repository-import tool, one call shape for every state. First call drives the deterministic analysis (classify, group, frame, synthesize) as far as its time budget allows; a still-running response means call again. When the draft stages, the SAME response carries everything needed to finalize: per-group frames with evidence, the draft nodes/edges/contracts, per-node signals (declared routes, outbound HTTP clients, dependencies, deployment surfaces), open questions, and the import doctrine. Call again with a decisions object to finalize. After the user accepts, calling again reports which nodes still need requirements.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'decisions', type: 'object', required: false, desc: 'Finalization verdict: { approve: true } or revisions — renames, role_changes, set_technology, drop_nodes, add_edges (evidence required), drop_edges' }, { name: 'restart', type: 'boolean', required: false, desc: 'Start a fresh import after a failure, or when the user explicitly wants re-analysis' }] },

  // ── Specification & traceability ───────────────────────────────────────────
  { name: 'update_vision', scope: 'write', description: 'Record or revise the project vision. Ask the user for it in their own words — never infer a vision from code.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'vision', type: 'string', required: true, desc: 'The vision text' }] },
  { name: 'create_requirement', scope: 'write', description: 'Create a requirement with acceptance criteria. Criteria start unmet — existing code proves nothing until it is tested. Pass section to file it under a named section (created if absent).', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'name', type: 'string', required: true, desc: 'Requirement name' }, { name: 'acceptance_criteria', type: 'array', required: false, desc: 'Criterion statements' }, { name: 'section', type: 'string', required: false, desc: 'Section name — matched case-insensitively, created when absent' }] },
  { name: 'update_requirement', scope: 'write', description: 'Reword, re-criterion, reclassify, or re-section an existing requirement.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'requirement_id', type: 'string', required: true, desc: 'The requirement UUID or REQ-xxx id' }, { name: 'section', type: 'string | null', required: false, desc: 'Section name to move it to (created when absent); null clears it' }] },
  { name: 'delete_requirement', scope: 'write', description: 'Remove a genuinely disposable draft. Refuses (without force) when the requirement is mapped or carries test-case evidence — deletion cascades the evidence away. For anything with history, prefer supersession: a new requirement with an expands relation archives the original, and retiring test cases preserves their record.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'requirement_id', type: 'string', required: true, desc: 'The requirement UUID or REQ-xxx id' }] },
  { name: 'map_requirement', scope: 'write', description: 'Bind a requirement to the architecture node(s) that serve it. This mapping is the traceability edge readiness and coverage are computed from.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'requirement_id', type: 'string', required: true, desc: 'The requirement UUID or REQ-xxx id' }, { name: 'node_ids', type: 'array', required: true, desc: 'Nodes serving the requirement' }] },
  { name: 'relate_requirements', scope: 'write', description: 'Record expands / depends-on / relates-to links between requirements.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'from_requirement_id', type: 'string', required: true, desc: 'Source requirement' }, { name: 'to_requirement_id', type: 'string', required: true, desc: 'Target requirement' }, { name: 'relation', type: 'string', required: true, desc: 'The relation kind' }] },
  { name: 'set_requirement_lock', scope: 'write', description: 'Lock or unlock a settled requirement against further edits.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'requirement_id', type: 'string', required: true, desc: 'The requirement UUID or REQ-xxx id' }, { name: 'locked', type: 'boolean', required: true, desc: 'Lock state' }] },

  // ── Build & verify ─────────────────────────────────────────────────────────
  { name: 'generate_task_docs', scope: 'write', description: 'Deterministically regenerate task packets for nodes whose documents are missing or stale.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'node_ids', type: 'array', required: false, desc: 'Limit to specific nodes' }] },
  { name: 'report_test_results', scope: 'write', description: 'Report test outcomes for a requirement. Passing results flip the linked acceptance criteria with provenance and clear staleness; pass criterion_text matching the criterion wording exactly. Report every outcome, including failures. An over-budget write returns a testBudget receipt with a consolidation nudge.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'requirement_id', type: 'string', required: true, desc: 'The requirement UUID or REQ-xxx id' }, { name: 'results', type: 'array', required: true, desc: 'One entry per executed test: { test_id, status, criterion_text?, framework?, artifact_path? }' }] },
  { name: 'update_test_case', scope: 'write', description: 'Rename, reassign, retire, or re-bind an existing test case. Never hard-deletes: retiring hides the case from every count surface but preserves the row (a fresh reported run revives it); reassigning moves it to the requirement it actually verifies and deliberately marks it stale; criterion_text re-binds it after a criterion reword (exact text, never steals, binding alone never flips met).', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'requirement_id', type: 'string', required: true, desc: 'The requirement currently owning the case' }, { name: 'test_id', type: 'string', required: true, desc: 'The case to update (its stable key)' }, { name: 'new_test_id', type: 'string', required: false, desc: 'Rename the key (collisions refused)' }, { name: 'reassign_to', type: 'string', required: false, desc: 'Move the case to this requirement (arrives stale — re-run there)' }, { name: 'retire', type: 'boolean', required: false, desc: 'true retires (retire_reason required, bindings released); false un-retires' }, { name: 'retire_reason', type: 'string', required: false, desc: 'Why — e.g. superseded by TC-004' }, { name: 'criterion_text', type: 'string', required: false, desc: 'Exact criterion text to re-bind this case to' }] },
  { name: 'mark_entity_complete', scope: 'write', description: 'Declare a node or requirement complete. Returns any still-unmet criteria — if some remain, the work is not done.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'entity_id', type: 'string', required: true, desc: 'Node or requirement id' }] },
  { name: 'resolve_change', scope: 'write', description: 'Accept or dismiss a pending repository change. Optionally submit patches when accepting, and pass apply_ticks to flip the change’s criterion and task checkbox ticks with git provenance in the same resolution.', params: [{ name: 'change_event_id', type: 'string', required: true, desc: 'The change event UUID' }, { name: 'resolution', type: 'string', required: true, desc: 'accepted or dismissed' }, { name: 'patches', type: 'array', required: false, desc: 'Optional patches to apply when accepting' }, { name: 'apply_ticks', type: 'boolean', required: false, desc: 'On accept: apply the change’s checkbox ticks (criteria met, tasks done)' }] },
  { name: 'create_project', scope: 'write', description: 'Create a new project. Subject to the account plan’s project limit.', params: [{ name: 'name', type: 'string', required: true, desc: 'Project name' }] },

  // ── Proposals ──────────────────────────────────────────────────────────────
  { name: 'propose_patches', scope: 'propose', description: 'The one write path into the architecture: submit node/edge/contract/artifact changes as a proposal the user reviews and applies. Agents never write the graph directly.', params: [{ name: 'project_id', type: 'string', required: true, desc: 'The project name or UUID' }, { name: 'branch_id', type: 'string', required: true, desc: 'The target branch UUID' }, { name: 'patches', type: 'array', required: true, desc: 'Patch operations in NodeSpec format' }, { name: 'explanations', type: 'array', required: false, desc: 'Explanation per patch' }, { name: 'content_ref', type: 'string', required: false, desc: 'Git ref (pushed commit sha) — add_artifact patches that omit content become bindings-only; their file bodies are pulled from git at this ref when you accept' }, { name: 'proposal_id', type: 'string', required: false, desc: 'Chunked sessions: append this call\'s patches to the staged session started by finalize: false' }, { name: 'finalize', type: 'boolean', required: false, desc: 'false starts a staged session (invisible until finalized); true with proposal_id submits the whole session as one proposal' }, { name: 'expected_patch_count', type: 'number', required: false, desc: 'Truncation guard: the patch count you intended — a shorter delivery fails loudly instead of creating a fragment' }] },

  // ── Key management ─────────────────────────────────────────────────────────
  { name: 'create_api_key', scope: 'admin', description: 'Create an API key for agent authentication. Requires JWT auth (not available when using API key auth).', params: [{ name: 'name', type: 'string', required: true, desc: 'Human-readable name for the key' }, { name: 'scopes', type: 'array', required: false, desc: 'Permissions: read, write, propose' }, { name: 'expires_in_days', type: 'number', required: false, desc: 'Days until expiration' }] },
  { name: 'list_api_keys', scope: 'admin', description: 'List all API keys for the authenticated user. Requires JWT auth.', params: [] },
  { name: 'revoke_api_key', scope: 'admin', description: 'Revoke an API key so it can no longer be used. Requires JWT auth.', params: [{ name: 'key_id', type: 'string', required: true, desc: 'The API key UUID to revoke' }] },
];


export function MCPDocsPage() {
  const navigate = useNavigate();

  usePageSeo({
    title: 'MCP Integration Documentation - NodeSpec',
    description: 'Complete documentation for integrating external AI agents with NodeSpec via the Model Context Protocol (MCP). Learn the tool workflow, authentication methods, and full API reference.',
    path: '/docs/mcp',
    breadcrumbs: [
      { name: 'Home', url: BASE_URL },
      { name: 'MCP Documentation', url: `${BASE_URL}/docs/mcp` },
    ],
  });

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fc' }}>
      {/* Header */}
      <header style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '20px 40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          <img src={logoLight} alt="NodeSpec" style={{ height: '32px', width: 'auto' }} />
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <span style={navLink} onClick={() => navigate('/templates')}>Templates</span>
          <span style={navLink} onClick={() => navigate('/blog')}>Blog</span>
          <span style={{ ...navLink, color: '#2563eb', fontWeight: 600 }}>MCP Docs</span>
        </nav>
      </header>

      {/* Hero */}
      <section style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        padding: '80px 40px 60px',
        color: '#ffffff',
      }}>
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Model Context Protocol
            </span>
          </div>
          <h1 style={{ fontSize: '42px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '16px', lineHeight: 1.2 }}>
            MCP Integration Guide
          </h1>
          <p style={{ fontSize: '18px', color: '#94a3b8', lineHeight: 1.6, maxWidth: '640px' }}>
            Connect Claude Desktop, Cursor, Claude Code, Windsurf, or any MCP-compatible agent to NodeSpec.
            Your agent can read specifications, generate architecture, produce code artifacts, and manage the full development lifecycle.
          </p>
        </div>
      </section>

      {/* Table of Contents */}
      <nav style={{
        maxWidth: '960px',
        margin: '0 auto',
        padding: '32px 40px 0',
      }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '20px 24px',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          {['Overview', 'Connect Your AI', 'Workflow', 'Skills', 'Tool Reference', 'Examples'].map(s => (
            <a
              key={s}
              href={`#${s.toLowerCase().replace(/[^a-z]/g, '-')}`}
              style={{ fontSize: '14px', fontWeight: 500, color: '#2563eb', textDecoration: 'none', padding: '6px 12px', borderRadius: '6px', transition: 'background 0.15s' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#eff6ff'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              {s}
            </a>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '40px 40px 80px' }}>

        {/* Overview Section */}
        <Section id="overview" title="Overview">
          <p style={bodyText}>
            NodeSpec exposes a <strong>Model Context Protocol (MCP)</strong> server that lets your AI assistant read your architecture and specifications, propose changes, and report verified results. NodeSpec never runs a model of its own — it is a deterministic context server, and the only intelligence in the loop is the assistant you already use.
          </p>
          <p style={bodyText}>
            When you connect an agent via MCP, it gains the ability to:
          </p>
          <ul style={listStyle}>
            <li>Read project specifications, requirements, and architecture topology</li>
            <li>Understand where your project is in the development pipeline (requirements, architecture, code)</li>
            <li>Confirm requirements to unblock architecture generation</li>
            <li>Run the NodeSpec AI agent to generate specifications, design architecture, or produce artifacts</li>
            <li>Submit code patches for human review via the proposal system</li>
            <li>Reconcile external git changes with your architecture canvas</li>
          </ul>
        </Section>

        {/* Connect Section */}
        <Section id="connect-your-ai" title="Connect Your AI">
          <p style={bodyText}>
            One endpoint, one sign-in. Point your assistant at{' '}
            <code style={inlineCode}>https://mcp.nodespec.io/mcp</code> and it will open a NodeSpec
            authorization page in your browser. Approve it once and the connection is live — no API key to
            generate, paste, or rotate, and nothing in the URL to customize. Copy it exactly as written; it is
            identical for every account.
          </p>
          <div style={{
            padding: '16px 20px',
            backgroundColor: '#eff6ff',
            borderRadius: '8px',
            border: '1px solid #bfdbfe',
            margin: '20px 0 28px',
          }}>
            <p style={{ fontSize: '14px', color: '#1e40af', lineHeight: 1.6, margin: 0 }}>
              <strong>Server URL:</strong>{' '}
              <code style={{ ...inlineCode, backgroundColor: '#dbeafe' }}>https://mcp.nodespec.io/mcp</code>
              <br />
              The same URL for every account. Once connected, the status indicator in the NodeSpec app header
              turns green.
            </p>
          </div>

          <h3 style={h3Style}>Claude Desktop</h3>
          <ol style={listStyle}>
            <li>Open <strong>Settings &rarr; Connectors</strong>.</li>
            <li>Choose <strong>Add custom connector</strong>.</li>
            <li>Paste <code style={inlineCode}>https://mcp.nodespec.io/mcp</code> as the URL and leave the optional client fields empty.</li>
            <li>Claude opens a NodeSpec sign-in — approve it, and the tools appear.</li>
          </ol>

          <h3 style={h3Style}>Claude Code (CLI)</h3>
          <p style={bodyText}>One command, then approve in the browser:</p>
          <CodeBlock content={`claude mcp add --transport http nodespec https://mcp.nodespec.io/mcp`} />
          <p style={bodyText}>
            Run <code style={inlineCode}>/mcp</code> inside Claude Code to check the connection or re-authorize.
          </p>

          <h3 style={h3Style}>Cursor</h3>
          <p style={bodyText}>
            Add to <code style={inlineCode}>~/.cursor/mcp.json</code> (or Settings &rarr; MCP &rarr; Add server),
            then restart Cursor and approve the sign-in prompt:
          </p>
          <CodeBlock content={`{
  "mcpServers": {
    "nodespec": {
      "url": "https://mcp.nodespec.io/mcp"
    }
  }
}`} />

          <h3 style={h3Style}>VS Code (Copilot agent mode)</h3>
          <p style={bodyText}>
            Create <code style={inlineCode}>.vscode/mcp.json</code> in your workspace (or run{' '}
            <strong>MCP: Add Server</strong> from the Command Palette). Note VS Code uses{' '}
            <code style={inlineCode}>servers</code>, not <code style={inlineCode}>mcpServers</code>, and wants an
            explicit type:
          </p>
          <CodeBlock content={`{
  "servers": {
    "nodespec": {
      "type": "http",
      "url": "https://mcp.nodespec.io/mcp"
    }
  }
}`} />
          <p style={bodyText}>
            Start the server from the CodeLens above the entry, then approve the browser sign-in. Requires a VS
            Code version with Copilot agent-mode MCP support.
          </p>

          <h3 style={h3Style}>Codex</h3>
          <p style={bodyText}>
            Add to <code style={inlineCode}>~/.codex/config.toml</code>, then restart Codex and approve the
            sign-in prompt:
          </p>
          <CodeBlock content={`[mcp_servers.nodespec]
url = "https://mcp.nodespec.io/mcp"`} />

          <h3 style={h3Style}>If your client cannot sign in through the browser</h3>
          <p style={bodyText}>
            A few clients and CI environments cannot complete a browser authorization. For those, generate an API
            key in the app under <strong>Account &rarr; MCP API Keys</strong> and send it as a header against the
            same URL:
          </p>
          <CodeBlock content={`{
  "mcpServers": {
    "nodespec": {
      "url": "https://mcp.nodespec.io/mcp",
      "headers": {
        "X-MCP-API-Key": "ns_live_your_key_here"
      }
    }
  }
}`} />
          <p style={bodyText}>
            <code style={inlineCode}>Authorization: Bearer ns_live_...</code> works too if your client only
            supports that header. Browser sign-in is simpler wherever it is available.
          </p>

          <h3 style={h3Style}>Confirming it worked</h3>
          <p style={bodyText}>
            Ask your assistant to <em>list my NodeSpec projects</em>. If it returns them, you are connected. The
            NodeSpec app header shows the same state — green once an assistant has actually authenticated and
            called the server.
          </p>

          <h3 style={h3Style}>Scopes</h3>
          <p style={bodyText}>
            Authorizing grants your assistant these permissions:
          </p>
          <ul style={listStyle}>
            <li><code style={inlineCode}>read</code> -- list projects, view status, read architecture, specifications, and the catalog</li>
            <li><code style={inlineCode}>write</code> -- record vision and requirements, map traceability, report test results, resolve repository changes</li>
            <li><code style={inlineCode}>propose</code> -- submit architecture changes for review, and run repository import</li>
          </ul>
          <p style={bodyText}>
            Every architecture change arrives as a proposal you review and apply in the app. Your assistant never
            writes to your model directly.
          </p>
        </Section>

        {/* Workflow Section */}
        <Section id="workflow" title="Recommended Workflow">
          <p style={bodyText}>
            When your agent first connects, follow this sequence to orient itself and take action:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', margin: '24px 0' }}>
            {[
              { step: 1, tool: 'list_projects', rationale: 'Discover available projects and obtain a project_id' },
              { step: 2, tool: 'get_project_status', rationale: 'Orient: current phase, counts, any unreconciled repository drift or staged import, and a nextAction naming the step to take' },
              { step: 3, tool: 'get_pending_changes', rationale: 'If status reports drift, reconcile it first with resolve_change — never build on unreconciled changes' },
              { step: 4, tool: 'list_requirements', rationale: 'Read the specification: requirements, acceptance criteria, and their met/unmet state' },
              { step: 5, tool: 'get_build_readiness', rationale: 'Preflight: blocking gaps and the dependency-ordered build sequence. Summary first, then re-call scoped to the node you are about to build' },
              { step: 6, tool: 'get_project_context', rationale: 'Pull that node’s task packet — role doctrine, contracts, bound files, scoped criteria — and build it in your own environment' },
              { step: 7, tool: 'report_test_results', rationale: 'Run the tests from get_test_plan and report every outcome; passing results flip acceptance criteria with provenance' },
            ].map(s => (
              <div key={s.step} style={{
                display: 'flex',
                gap: '16px',
                alignItems: 'flex-start',
                padding: '16px 20px',
                backgroundColor: '#ffffff',
                borderRadius: '10px',
                border: '1px solid #e5e7eb',
              }}>
                <div style={{
                  minWidth: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {s.step}
                </div>
                <div>
                  <code style={inlineCode}>{s.tool}</code>
                  <p style={{ fontSize: '14px', color: '#4b5563', marginTop: '4px', lineHeight: 1.5 }}>
                    {s.rationale}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div style={{
            padding: '16px 20px',
            backgroundColor: '#eff6ff',
            borderRadius: '8px',
            border: '1px solid #bfdbfe',
            marginTop: '16px',
          }}>
            <p style={{ fontSize: '14px', color: '#1e40af', lineHeight: 1.6, margin: 0 }}>
              <strong>Tip:</strong> The <code style={{ ...inlineCode, backgroundColor: '#dbeafe' }}>get_project_status</code> response includes a <code style={{ ...inlineCode, backgroundColor: '#dbeafe' }}>nextAction</code> field that tells your agent exactly what tool to call next. Use this to drive autonomous workflows.
            </p>
          </div>
        </Section>

        {/* Skills Section */}
        <Section id="skills" title="Skills">
          <p style={bodyText}>
            A <strong>skill</strong> tells your AI assistant how to work with NodeSpec before it makes a single
            tool call — when to reach for NodeSpec, what order the workflow runs in, and which rules are
            non-negotiable. Attaching one is the difference between an agent that calls tools and an agent that
            uses them correctly.
          </p>
          <p style={bodyText}>
            Start with <strong>NodeSpec Core</strong>. It covers the full working loop: orienting on a project and
            reconciling drift, the preflight → clear blockers → implement → verify → close cycle,
            importing an existing repository and backfilling its requirements, and the honesty rules that keep an
            agent from inventing a missing schema or claiming an untested criterion.
          </p>
          <div style={{
            padding: '20px 24px',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e5e7eb',
            margin: '24px 0',
          }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827', marginBottom: '6px' }}>
              NodeSpec skills on GitHub
            </div>
            <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.6, margin: '0 0 14px' }}>
              The core skill and architecture-specific packs are published in the open. Copy one into your
              assistant, or grab them from the Skills menu in the app header.
            </p>
            <a
              href="https://github.com/NodeSpec/NodeSpec/tree/main/skills"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                fontSize: '14px', fontWeight: 600, color: '#2563eb', textDecoration: 'none',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              github.com/NodeSpec/NodeSpec/skills
            </a>
          </div>
          <p style={bodyText}>
            Deeper guidance — the import doctrine, the decisions vocabulary, review hints — ships from the
            server itself inside tool responses, so it stays locked to the running version rather than drifting
            inside a file installed months ago. The skill carries what the server cannot: when to start, and what
            the workflow looks like end to end.
          </p>
        </Section>

        {/* Tool Reference Section */}
        <Section id="tool-reference" title="Tool Reference">
          <p style={bodyText}>
            All 30 tools available through the MCP server, grouped by permission scope:
          </p>

          <ToolGroup title="Discovery & Status (read)" tools={TOOLS.filter(t => t.scope === 'read')} />
          <ToolGroup title="Actions (write)" tools={TOOLS.filter(t => t.scope === 'write')} />
          <ToolGroup title="Proposals (propose)" tools={TOOLS.filter(t => t.scope === 'propose')} />
          <ToolGroup title="Key Management (admin)" tools={TOOLS.filter(t => t.scope === 'admin')} />
        </Section>

        {/* Examples Section */}
        <Section id="examples" title="Examples">
          <h3 style={h3Style}>Check project status and decide next action</h3>
          <CodeBlock content={`// 1. Find your project
list_projects()
// Returns: [{ id: "proj_123", name: "My SaaS App", ... }]

// 2. Orient
get_project_status({ project_id: "proj_123" })
// Returns: {
//   phase: "ready_for_code",
//   pendingRepositoryChanges: 2,
//   nextAction: "Reconcile 2 repository changes before building"
// }

// 3. Status reported drift -- reconcile it FIRST
get_pending_changes({ project_id: "proj_123" })
resolve_change({ change_event_id: "chg_456", resolution: "accepted" })

// 4. Now preflight the build
get_build_readiness({ project_id: "proj_123", branch_id: "branch_main" })
// Returns per-node blockers/advisories + a dependency-ordered buildOrder`} />

          <h3 style={h3Style}>Import an existing repository</h3>
          <CodeBlock content={`// One tool carries the whole flow.
// 1. Drive the analysis (call again if it reports still running)
run_repo_import({ project_id: "proj_123" })
// Returns when staged: frames + evidence, draft nodes/edges/contracts,
// per-node signals (routes, outbound HTTP, dependencies, deployments),
// open questions, review hints, and the import doctrine

// 2. Review it, then finalize with your judgment
run_repo_import({
  project_id: "proj_123",
  decisions: {
    renames: [{ from_label: "src", to_label: "Checkout API" }],
    set_technology: [{ label: "Checkout API", technology: "fastapi" }],
    add_edges: [{
      from_label: "Web App",
      to_label: "Checkout API",
      contract_kind: "rest",
      evidence: "axios client in web/src/api.ts calls GET /orders declared in api/main.py"
    }]
  }
})
// Promotes ONE proposal for the user to review and apply in the app

// 3. After the user accepts, the same tool reports what intent is missing
run_repo_import({ project_id: "proj_123" })
// Returns: { state: "accepted", coverage: { nodesWithZeroRequirements: [...] } }
// Then: update_vision -> create_requirement -> map_requirement until empty`} />

          <h3 style={h3Style}>Generate code for a specific component</h3>
          <CodeBlock content={`// Get architecture overview first
get_architecture_overview({ project_id: "proj_123" })
// Returns node topology, Mermaid diagram, artifact status

// Get context for a specific node
get_project_context({
  project_id: "proj_123",
  branch_id: "branch_main",
  target_type: "node",
  target_id: "auth-service"
})
// Returns specification, contracts, dependencies

// Build it yourself from the packet: the response carries the node's task
// document (role doctrine, technology guidance, contracts, criteria).
// Implement in your IDE, then submit via propose_patches below.`} />

          <h3 style={h3Style}>Submit code for review</h3>
          <CodeBlock content={`propose_patches({
  project_id: "proj_123",
  branch_id: "branch_main",
  patches: [
    {
      op: "update_artifact",
      node_id: "auth-service",
      artifact_kind: "source",
      file_path: "src/auth/service.ts",
      content: "// ... your generated code ..."
    }
  ],
  explanations: ["Implemented JWT validation and session management"],
  external_agent: "claude-code"
})
// Returns: { proposal_id: "prop_xyz" }

// Check if the user approved it
get_proposal_status({ proposal_id: "prop_xyz" })
// Returns: { status: "accepted" | "rejected" | "pending" }`} />
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}

const navLink: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 500,
  color: '#4b5563',
  cursor: 'pointer',
};

const bodyText: React.CSSProperties = {
  fontSize: '15px',
  color: '#374151',
  lineHeight: 1.7,
  marginBottom: '12px',
};

const listStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#374151',
  lineHeight: 1.8,
  paddingLeft: '24px',
  marginBottom: '16px',
};

const inlineCode: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '13px',
  backgroundColor: '#f1f5f9',
  padding: '2px 6px',
  borderRadius: '4px',
  color: '#1e40af',
};

const h3Style: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  color: '#111827',
  marginTop: '32px',
  marginBottom: '12px',
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: '56px' }}>
      <h2 style={{
        fontSize: '26px',
        fontWeight: 700,
        color: '#111827',
        letterSpacing: '-0.01em',
        marginBottom: '20px',
        paddingBottom: '12px',
        borderBottom: '2px solid #e5e7eb',
      }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function CodeBlock({ content }: { content: string }) {
  return (
    <pre style={{
      backgroundColor: '#1e293b',
      color: '#e2e8f0',
      padding: '20px 24px',
      borderRadius: '10px',
      fontSize: '13px',
      lineHeight: 1.6,
      overflowX: 'auto',
      margin: '16px 0 24px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    }}>
      <code>{content}</code>
    </pre>
  );
}

function ToolGroup({ title, tools }: { title: string; tools: typeof TOOLS }) {
  return (
    <div style={{ marginTop: '32px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#374151', marginBottom: '16px' }}>
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {tools.map(tool => (
          <div key={tool.name} style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
            padding: '16px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <code style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '14px',
                fontWeight: 600,
                color: '#1e40af',
              }}>
                {tool.name}
              </code>
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: scopeColor(tool.scope),
                backgroundColor: scopeBg(tool.scope),
                padding: '2px 8px',
                borderRadius: '4px',
              }}>
                {tool.scope}
              </span>
            </div>
            <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.5, margin: 0 }}>
              {tool.description}
            </p>
            {tool.params.length > 0 && (
              <div style={{ marginTop: '12px', borderTop: '1px solid #f3f4f6', paddingTop: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                  Parameters
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {tool.params.map(p => (
                    <div key={p.name} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '13px' }}>
                      <code style={{ fontFamily: 'monospace', color: '#1e40af', fontWeight: 500 }}>{p.name}</code>
                      <span style={{ color: '#9ca3af', fontSize: '11px' }}>{p.type}{p.required ? '' : '?'}</span>
                      <span style={{ color: '#6b7280' }}>-- {p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function scopeColor(scope: string): string {
  switch (scope) {
    case 'read': return '#166534';
    case 'write': return '#9a3412';
    case 'propose': return '#1e40af';
    case 'admin': return '#6b21a8';
    default: return '#4b5563';
  }
}

function scopeBg(scope: string): string {
  switch (scope) {
    case 'read': return '#dcfce7';
    case 'write': return '#ffedd5';
    case 'propose': return '#dbeafe';
    case 'admin': return '#f3e8ff';
    default: return '#f3f4f6';
  }
}
