import { useState, useCallback, useRef } from 'react';
import { useServices } from '../context/ServiceContext.js';
import type { AgentRequestParams, AgentStreamCallbacks } from '../services/AgentService.js';

export interface AgentStreamNode {
  id: string;
  label: string;
  type: string;
}

export interface AgentStreamEdge {
  id: string;
  sourceLabel: string;
  targetLabel: string;
  contractName: string;
}

export interface AgentStreamArtifact {
  id: string;
  nodeLabel: string;
  path: string;
  kind: string;
}

export interface AgentStreamState {
  isRunning: boolean;
  status: string;
  nodesCreated: AgentStreamNode[];
  edgesCreated: AgentStreamEdge[];
  artifactsCreated: AgentStreamArtifact[];
  artifactsUpdated: AgentStreamArtifact[];
  toolCalls: Array<{ tool: string; args: Record<string, unknown> }>;
  error: string | null;
  summary: string | null;
  patches: unknown[];
}

const INITIAL_STATE: AgentStreamState = {
  isRunning: false,
  status: '',
  nodesCreated: [],
  edgesCreated: [],
  artifactsCreated: [],
  artifactsUpdated: [],
  toolCalls: [],
  error: null,
  summary: null,
  patches: [],
};

export function useAgentStream() {
  const services = useServices();
  const [state, setState] = useState<AgentStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const runAgent = useCallback(async (
    params: AgentRequestParams,
    extraCallbacks?: Partial<AgentStreamCallbacks>
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...INITIAL_STATE,
      isRunning: true,
      status: 'Starting...',
    });

    const callbacks: AgentStreamCallbacks = {
      onStatus: (message) => {
        setState(prev => ({ ...prev, status: message }));
        extraCallbacks?.onStatus?.(message);
      },
      onThinking: (message) => {
        setState(prev => ({ ...prev, status: message }));
        extraCallbacks?.onThinking?.(message);
      },
      onToolCall: (tool, args) => {
        setState(prev => ({
          ...prev,
          toolCalls: [...prev.toolCalls, { tool, args }],
        }));
        extraCallbacks?.onToolCall?.(tool, args);
      },
      onNodeCreated: (node) => {
        setState(prev => ({
          ...prev,
          nodesCreated: [...prev.nodesCreated, node],
        }));
        extraCallbacks?.onNodeCreated?.(node);
      },
      onEdgeCreated: (edge) => {
        setState(prev => ({
          ...prev,
          edgesCreated: [...prev.edgesCreated, edge],
        }));
        extraCallbacks?.onEdgeCreated?.(edge);
      },
      onArtifactCreated: (artifact) => {
        setState(prev => ({
          ...prev,
          artifactsCreated: [...prev.artifactsCreated, artifact],
        }));
        extraCallbacks?.onArtifactCreated?.(artifact);
      },
      onArtifactUpdated: (artifact) => {
        setState(prev => ({
          ...prev,
          artifactsUpdated: [...prev.artifactsUpdated, artifact],
        }));
        extraCallbacks?.onArtifactUpdated?.(artifact);
      },
      onError: (message) => {
        setState(prev => ({ ...prev, error: message }));
        extraCallbacks?.onError?.(message);
      },
      onComplete: (summary, patches, pendingTraceUpdates) => {
        setState(prev => ({
          ...prev,
          isRunning: false,
          summary,
          patches,
          status: 'Complete',
        }));
        extraCallbacks?.onComplete?.(summary, patches, pendingTraceUpdates);
      },
      onEvent: extraCallbacks?.onEvent,
      onToolResult: extraCallbacks?.onToolResult,
      onContractCreated: extraCallbacks?.onContractCreated,
      onPortAdded: extraCallbacks?.onPortAdded,
      onNodeRemoved: extraCallbacks?.onNodeRemoved,
      onEdgeRemoved: extraCallbacks?.onEdgeRemoved,
      onPatchGenerated: extraCallbacks?.onPatchGenerated,
    };

    try {
      const result = await services.agent.streamAgent(params, callbacks, controller.signal);
      return result;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setState(prev => ({ ...prev, isRunning: false, status: 'Cancelled' }));
        return { summary: 'Cancelled', patches: [], pendingTraceUpdates: [] };
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({ ...prev, isRunning: false, error: message }));
      throw err;
    }
  }, [services.agent]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState(prev => ({ ...prev, isRunning: false, status: 'Cancelled' }));
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, runAgent, cancel, reset };
}
