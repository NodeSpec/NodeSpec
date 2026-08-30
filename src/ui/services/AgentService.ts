import type { AuthService } from './AuthService.js';

export interface AgentRequestParams {
  projectId: string;
  branchId: string;
  message: string;
  specificationId?: string;
  maxTurns?: number;
  model?: string;
  temperature?: number;
  endpoint?: string;
  sessionId?: string;
  provider?: string;
  resumeCheckpointId?: string;
  isFinalAttempt?: boolean;
}

export interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  sequence: number;
}

export interface AgentStreamCallbacks {
  onStatus?: (message: string) => void;
  onThinking?: (message: string) => void;
  onToolCall?: (tool: string, args: Record<string, unknown>) => void;
  onToolResult?: (tool: string, result: unknown) => void;
  onNodeCreated?: (node: { id: string; label: string; type: string }) => void;
  onNodeUpdated?: (node: { id: string; label: string; changes: string[] }) => void;
  onEdgeCreated?: (edge: { id: string; sourceLabel: string; targetLabel: string; contractName: string }) => void;
  onContractCreated?: (contract: { id: string; name: string; kind: string }) => void;
  onPortAdded?: (port: { nodeId: string; nodeLabel: string; portName: string; direction: string }) => void;
  onNodeRemoved?: (node: { id: string; label: string }) => void;
  onEdgeRemoved?: (edge: { id: string }) => void;
  onPatchGenerated?: (patch: unknown) => void;
  onSpecificationSaved?: (spec: { specificationId: string; vision: string }) => void;
  onSectionCreated?: (section: { sectionId: string; name: string; orderIndex: number }) => void;
  onRequirementCreated?: (req: { requirementId: string; name: string; category: string }) => void;
  onArtifactCreated?: (artifact: { id: string; nodeLabel: string; path: string; kind: string }) => void;
  onArtifactUpdated?: (artifact: { id: string; nodeLabel: string; path: string; kind: string }) => void;
  onError?: (message: string) => void;
  onComplete?: (summary: string, patches: unknown[], pendingTraceUpdates?: unknown[], partial?: boolean) => void;
  onContinueNeeded?: (info: { checkpointId: string; sessionId: string; attemptCount: number; phase: string; patchCount: number; message: string }) => void;
  onEvent?: (event: StreamEvent) => void;
}

export class AgentService {
  private authService: AuthService;
  private supabaseUrl: string;
  private supabaseAnonKey: string;

  constructor(authService: AuthService, supabaseUrl: string, supabaseAnonKey: string) {
    this.authService = authService;
    this.supabaseUrl = supabaseUrl;
    this.supabaseAnonKey = supabaseAnonKey;
  }

  private async fetchWithAuthRetry(
    url: string,
    bodyParams: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Response> {
    const session = await this.authService.getSession();
    if (!session) {
      throw new Error('Not authenticated');
    }

    const makeRequest = (token: string) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'apikey': this.supabaseAnonKey,
        },
        body: JSON.stringify(bodyParams),
        signal,
      });

    let response = await makeRequest(session.session.access_token);

    if (response.status === 401) {
      const refreshed = await this.authService.refreshSession();
      if (!refreshed) {
        const validated = await this.authService.getUser();
        if (!validated) {
          throw new Error('Session expired. Please sign in again.');
        }
        response = await makeRequest(validated.session.access_token);
      } else {
        response = await makeRequest(refreshed.session.access_token);
      }
    }

    return response;
  }

  async streamAgent(
    params: AgentRequestParams,
    callbacks: AgentStreamCallbacks,
    signal?: AbortSignal
  ): Promise<{ summary: string; patches: unknown[]; pendingTraceUpdates: unknown[]; paused: boolean; checkpointId?: string; sessionId?: string; partial: boolean; droppedConnection: boolean }> {
    const endpoint = params.endpoint || 'agent-orchestrator-v4';
    const url = `${this.supabaseUrl}/functions/v1/${endpoint}`;

    const { endpoint: _ep, ...bodyParams } = params;
    const response = await this.fetchWithAuthRetry(url, bodyParams, signal);

    if (!response.ok) {
      // SHIP-1(e) pilot find: the AI orchestration function is deployed on the
      // hosted platform but not part of every stack (self-host bundles, the
      // bench) — there a call 404s with an HTML body and the raw error read as
      // a mystery. Name the situation and the working alternative instead.
      if (response.status === 404) {
        throw new Error(
          `The AI orchestration function ("${endpoint}") is not deployed on this stack — ` +
          'in-app AI drafting is a hosted-platform feature. On a self-hosted or bench deployment, ' +
          'connect your own AI over MCP instead: it has the full lane (create_requirement, ' +
          'propose_patches, report_test_results) — see Settings → MCP / API Keys.'
        );
      }
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        errorMessage = JSON.parse(errorBody).error || errorBody;
      } catch {
        errorMessage = errorBody;
      }
      throw new Error(`Agent request failed (${response.status}): ${errorMessage}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let summary = '';
    let patches: unknown[] = [];
    let pendingTraceUpdates: unknown[] = [];
    let paused = false;
    let checkpointId: string | undefined;
    let resumeSessionId: string | undefined = params.sessionId;
    let partial = false;
    let receivedTerminal = false;
    let droppedConnection = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const chunk of lines) {
          const trimmed = chunk.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          let event: StreamEvent;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          callbacks.onEvent?.(event);

          const d = event.data;
          switch (event.type) {
            case 'status':
              callbacks.onStatus?.(String(d.message || ''));
              break;
            case 'thinking':
              callbacks.onThinking?.(String(d.message || ''));
              break;
            case 'tool_call':
              callbacks.onToolCall?.(String(d.tool || ''), (d.args || {}) as Record<string, unknown>);
              break;
            case 'tool_result':
              callbacks.onToolResult?.(String(d.tool || ''), d.result);
              break;
            case 'node_created':
              callbacks.onNodeCreated?.(d as unknown as { id: string; label: string; type: string });
              break;
            case 'node_updated':
              callbacks.onNodeUpdated?.(d as unknown as { id: string; label: string; changes: string[] });
              break;
            case 'edge_created':
              callbacks.onEdgeCreated?.(d as unknown as { id: string; sourceLabel: string; targetLabel: string; contractName: string });
              break;
            case 'contract_created':
              callbacks.onContractCreated?.(d as unknown as { id: string; name: string; kind: string });
              break;
            case 'port_added':
              callbacks.onPortAdded?.(d as unknown as { nodeId: string; nodeLabel: string; portName: string; direction: string });
              break;
            case 'node_removed':
              callbacks.onNodeRemoved?.(d as unknown as { id: string; label: string });
              break;
            case 'edge_removed':
              callbacks.onEdgeRemoved?.(d as unknown as { id: string });
              break;
            case 'patch_generated':
              callbacks.onPatchGenerated?.(d.patch);
              break;
            case 'specification_saved':
              callbacks.onSpecificationSaved?.(d as unknown as { specificationId: string; vision: string });
              break;
            case 'section_created':
              callbacks.onSectionCreated?.(d as unknown as { sectionId: string; name: string; orderIndex: number });
              break;
            case 'requirement_created':
              callbacks.onRequirementCreated?.(d as unknown as { requirementId: string; name: string; category: string });
              break;
            case 'artifact_created':
              callbacks.onArtifactCreated?.(d as unknown as { id: string; nodeLabel: string; path: string; kind: string });
              break;
            case 'artifact_updated':
              callbacks.onArtifactUpdated?.(d as unknown as { id: string; nodeLabel: string; path: string; kind: string });
              break;
            case 'error':
              callbacks.onError?.(String(d.message || 'Unknown error'));
              break;
            case 'complete':
              summary = String(d.summary || '');
              patches = (d.patches || []) as unknown[];
              pendingTraceUpdates = (d.pendingTraceUpdates || []) as unknown[];
              partial = Boolean(d.partial);
              receivedTerminal = true;
              callbacks.onComplete?.(summary, patches, pendingTraceUpdates, partial);
              break;
            case 'continue_needed':
              paused = true;
              receivedTerminal = true;
              checkpointId = String(d.checkpointId || '');
              resumeSessionId = String(d.sessionId || resumeSessionId || '');
              callbacks.onContinueNeeded?.({
                checkpointId,
                sessionId: resumeSessionId || '',
                attemptCount: Number(d.attemptCount || 0),
                phase: String(d.phase || ''),
                patchCount: Number(d.patchCount || 0),
                message: String(d.message || ''),
              });
              break;
          }
        }
      }
    } catch (err) {
      // A user-initiated abort should propagate as a cancellation.
      if (signal?.aborted) {
        throw err;
      }
      // Any other read failure is a dropped connection (e.g. the edge function
      // was hard-killed mid-stream). Signal it so the caller can retry for free
      // instead of surfacing a fatal "network error".
      droppedConnection = true;
    } finally {
      reader.releaseLock();
    }

    // The stream ended without a terminal event (complete/continue_needed). This
    // is the platform hard-kill case -- treat it as a resumable dropped connection.
    if (!receivedTerminal && !droppedConnection) {
      droppedConnection = true;
    }

    return { summary, patches, pendingTraceUpdates, paused, checkpointId, sessionId: resumeSessionId, partial, droppedConnection };
  }

}
