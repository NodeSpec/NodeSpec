import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type StreamEventType =
  | 'status'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'node_created'
  | 'node_updated'
  | 'edge_created'
  | 'contract_created'
  | 'port_added'
  | 'node_removed'
  | 'edge_removed'
  | 'patch_generated'
  | 'specification_saved'
  | 'section_created'
  | 'requirement_created'
  | 'artifact_created'
  | 'artifact_updated'
  | 'tree_intelligence'
  | 'analysis_result'
  | 'analysis_paused'
  | 'analysis_progress'
  | 'budget_exhausted'
  | 'classification_report'
  | 'validation_warnings'
  | 'validation_started'
  | 'validation_complete'
  | 'continue_needed'
  | 'error'
  | 'complete';

export interface StreamEvent {
  type: StreamEventType;
  data: Record<string, unknown>;
  timestamp: string;
  sequence: number;
}

export interface SSEEmitterOptions {
  runId: string;
  projectId: string;
  userId: string;
  persistEvents?: boolean;
}

export class SSEEmitter {
  private controller: ReadableStreamDefaultController | null = null;
  private encoder = new TextEncoder();
  private sequence = 0;
  private options: SSEEmitterOptions;
  private supabase: SupabaseClient | null = null;

  constructor(options: SSEEmitterOptions) {
    this.options = options;
    if (options.persistEvents) {
      const url = Deno.env.get('SUPABASE_URL');
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (url && key) {
        // Dynamic import so Deno test suites that never persist events don't need to
        // resolve jsr:@supabase/supabase-js (blocked by some network policies).
        import("jsr:@supabase/supabase-js@2").then(({ createClient }) => {
          this.supabase = createClient(url, key);
        });
      }
    }
  }

  setController(controller: ReadableStreamDefaultController) {
    this.controller = controller;
  }

  emit(type: StreamEventType, data: Record<string, unknown>): void {
    const event: StreamEvent = {
      type,
      data,
      timestamp: new Date().toISOString(),
      sequence: this.sequence++,
    };

    if (this.controller) {
      try {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        this.controller.enqueue(this.encoder.encode(payload));
      } catch {
        // stream closed
      }
    }

    if (this.supabase && this.options.persistEvents) {
      this.supabase
        .from('generation_events')
        .insert({
          run_id: this.options.runId,
          project_id: this.options.projectId,
          user_id: this.options.userId,
          event_type: type,
          event_data: data,
          sequence: event.sequence,
        })
        .then(() => {});
    }
  }

  status(message: string): void {
    this.emit('status', { message });
  }

  thinking(message: string): void {
    this.emit('thinking', { message });
  }

  toolCall(tool: string, args: Record<string, unknown>): void {
    this.emit('tool_call', { tool, args });
  }

  toolResult(tool: string, result: unknown): void {
    this.emit('tool_result', { tool, result });
  }

  nodeCreated(node: { id: string; label: string; type: string }): void {
    this.emit('node_created', node);
  }

  nodeUpdated(node: { id: string; label: string; changes: string[] }): void {
    this.emit('node_updated', node);
  }

  edgeCreated(edge: { id: string; sourceLabel: string; targetLabel: string; contractName: string }): void {
    this.emit('edge_created', edge);
  }

  contractCreated(contract: { id: string; name: string; kind: string }): void {
    this.emit('contract_created', contract);
  }

  portAdded(port: { nodeId: string; nodeLabel: string; portName: string; direction: string }): void {
    this.emit('port_added', port);
  }

  nodeRemoved(node: { id: string; label: string }): void {
    this.emit('node_removed', node);
  }

  edgeRemoved(edge: { id: string }): void {
    this.emit('edge_removed', edge);
  }

  patchGenerated(patch: unknown): void {
    this.emit('patch_generated', { patch });
  }

  specificationSaved(spec: { specificationId: string; vision: string }): void {
    this.emit('specification_saved', spec);
  }

  sectionCreated(section: { sectionId: string; name: string; orderIndex: number }): void {
    this.emit('section_created', section);
  }

  requirementCreated(req: { requirementId: string; name: string; category: string }): void {
    this.emit('requirement_created', req);
  }

  artifactCreated(artifact: { id: string; nodeLabel: string; path: string; kind: string }): void {
    this.emit('artifact_created', artifact);
  }

  artifactUpdated(artifact: { id: string; nodeLabel: string; path: string; kind: string }): void {
    this.emit('artifact_updated', artifact);
  }

  budgetExhausted(data: {
    phase: number;
    phaseName: string;
    turnBudget: number;
    unassignedFiles: number;
    totalFiles: number;
    groupCount: number;
    edgeCount: number;
    runId: string;
  }): void {
    this.emit('budget_exhausted', data);
  }

  validationStarted(issueCount: number): void {
    this.emit('validation_started', { issueCount });
  }

  validationComplete(issuesFixed: number, issuesRemaining: number): void {
    this.emit('validation_complete', { issuesFixed, issuesRemaining });
  }

  continueNeeded(data: {
    checkpointId: string;
    sessionId: string;
    attemptCount: number;
    phase: string;
    patchCount: number;
    message: string;
  }): void {
    this.emit('continue_needed', data);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.emit('error', { message, ...details });
  }

  complete(summary: string, patches: unknown[], pendingTraceUpdates?: unknown[], partial?: boolean): void {
    this.emit('complete', { summary, patchCount: patches.length, patches, pendingTraceUpdates: pendingTraceUpdates || [], partial: partial ?? false });
  }

  close(): void {
    if (this.controller) {
      try {
        this.controller.close();
      } catch {
        // already closed
      }
    }
  }
}

export function createSSEResponse(
  options: SSEEmitterOptions,
  handler: (emitter: SSEEmitter) => Promise<void>,
  corsHeaders: Record<string, string>
): Response {
  const emitter = new SSEEmitter(options);

  const stream = new ReadableStream({
    async start(controller) {
      emitter.setController(controller);
      const encoder = new TextEncoder();
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);
      try {
        await handler(emitter);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const isProviderError = /(?:OpenAI|Anthropic|Gemini) API error/i.test(message);
        emitter.error(message, isProviderError ? { code: 'PROVIDER_ERROR' } : undefined);
      } finally {
        clearInterval(heartbeat);
        emitter.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
