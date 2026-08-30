import { SSEEmitter } from "./streaming.ts";
import {
  LLM_TIMEOUT_MARKER,
  sendChatCompletion,
  toNormalizedMessages,
  type ProviderConfig,
  type ChatMessage,
  type ToolDefinition,
  type ChatCompletionResult,
} from "./ai-provider.ts";
import type { ToolExecutorFn } from "./agent-runner-v4.ts";

export interface TurnProgressData {
  phase: number;
  phaseName: string;
  turn: number;
  maxTurns: number;
}

export interface PhaseConfigV4 {
  name: string;
  phaseNumber?: number;
  model: string;
  temperature: number;
  maxTurns: number;
  systemPrompt: string;
  userMessage: string;
  tools: ToolDefinition[];
  coverageInjectionInterval?: number;
  getCoverageMessage?: () => string;
  onTurnComplete?: (data: TurnProgressData) => void;
  maxContextChars?: number;
  shouldEarlyStop?: (turn: number, maxTurns: number) => boolean;
  /**
   * Absolute epoch-ms wall-clock deadline for the whole function invocation.
   * Each LLM call is capped to the remaining budget (via maxDurationMs), and
   * no new turn starts with less than MIN_TURN_BUDGET_MS remaining -- so a
   * single slow call can never overrun the platform kill and die without an
   * analysis_paused checkpoint.
   */
  deadlineAt?: number;
}

export interface PhaseResult {
  phaseName: string;
  summary: string;
  toolCallCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  budgetExhausted: boolean;
}

const DEFAULT_MAX_CONTEXT_CHARS = 300_000;

// Don't start a turn with less than this remaining; a fresh LLM call plus
// tool execution rarely completes faster.
const MIN_TURN_BUDGET_MS = 12_000;

// Truncated responses lose tool calls mid-JSON; one retry at a higher output
// cap recovers them. Values cover OpenAI ("length"), Anthropic ("max_tokens"),
// Gemini ("MAX_TOKENS").
const TRUNCATION_REASONS = new Set(["length", "max_tokens", "MAX_TOKENS"]);
const TRUNCATION_RETRY_MAX_TOKENS = 32_768;

function estimateContextChars(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += (msg.content?.length || 0) + 50;
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += tc.function.name.length + tc.function.arguments.length + 50;
      }
    }
  }
  return total;
}

function compressToolResult(content: string): string {
  try {
    const parsed = JSON.parse(content);
    const compressed: Record<string, unknown> = {};
    const keepKeys = [
      "success", "error", "groupId", "groupCount", "assignedCount",
      "skippedCount", "totalFiles", "filteredCount", "edgeCount",
      "unassignedCount", "totalAssigned", "nodeType", "label",
    ];
    for (const key of keepKeys) {
      if (key in parsed) compressed[key] = parsed[key];
    }
    if (Array.isArray(parsed.files)) {
      compressed._fileCount = parsed.files.length;
    }
    if (Array.isArray(parsed.groups)) {
      compressed._groupSummary = parsed.groups.map(
        (g: Record<string, unknown>) => `${g.id}:${g.label}(${g.fileCount} files)`
      );
    }
    if (Array.isArray(parsed.edges)) {
      compressed._edgeCount = parsed.edges.length;
    }
    return JSON.stringify(compressed);
  } catch {
    return content.length > 200 ? content.substring(0, 200) + "...[pruned]" : content;
  }
}

function pruneOldContext(messages: ChatMessage[], maxChars: number): void {
  if (estimateContextChars(messages) <= maxChars) return;

  const keepRecent = 10;
  const compressEnd = Math.max(2, messages.length - keepRecent);

  for (let i = 2; i < compressEnd; i++) {
    const msg = messages[i];
    if (msg.role === "tool" && msg.content && msg.content.length > 400) {
      msg.content = compressToolResult(msg.content);
    }
    if (msg.role === "assistant" && msg.content && msg.content.length > 500) {
      msg.content = msg.content.substring(0, 200) + "...[pruned]";
    }
  }

  if (estimateContextChars(messages) > maxChars) {
    const aggressiveEnd = Math.max(2, messages.length - 6);
    for (let i = 2; i < aggressiveEnd; i++) {
      const msg = messages[i];
      if (msg.role === "tool" && msg.content && msg.content.length > 100) {
        msg.content = '{"_pruned":true}';
      }
      if (msg.role === "assistant" && msg.content && msg.content.length > 100) {
        msg.content = "[prior reasoning pruned]";
      }
    }
  }
}

export async function runPhaseLoopV4(
  phase: PhaseConfigV4,
  executeTool: ToolExecutorFn,
  emitter: SSEEmitter,
  providerConfig: ProviderConfig,
): Promise<PhaseResult> {
  const maxContextChars = phase.maxContextChars || DEFAULT_MAX_CONTEXT_CHARS;

  const messages: ChatMessage[] = [
    { role: "system", content: phase.systemPrompt },
    { role: "user", content: phase.userMessage },
  ];

  let turnCount = 0;
  let toolCallCount = 0;
  let toolCallTurns = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  emitter.status(`[${phase.name}] Starting...`);

  const timeBudgetResult = (reason: string): PhaseResult => ({
    phaseName: phase.name,
    summary: `[${phase.name}] ${reason}`,
    toolCallCount,
    turnCount,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    model: phase.model,
    budgetExhausted: true,
  });

  while (turnCount < phase.maxTurns) {
    turnCount++;

    if (phase.shouldEarlyStop && phase.shouldEarlyStop(turnCount, phase.maxTurns)) {
      emitter.status(`[${phase.name}] Time-budget early stop at turn ${turnCount}/${phase.maxTurns}.`);
      return timeBudgetResult(`Stopped early at turn ${turnCount} due to time budget.`);
    }

    const remainingMs = phase.deadlineAt !== undefined
      ? phase.deadlineAt - Date.now()
      : undefined;
    if (remainingMs !== undefined && remainingMs < MIN_TURN_BUDGET_MS) {
      emitter.status(`[${phase.name}] Wall-clock deadline at turn ${turnCount}/${phase.maxTurns}.`);
      return timeBudgetResult(`Stopped at turn ${turnCount}: wall-clock deadline.`);
    }

    pruneOldContext(messages, maxContextChars);

    const baseRequest = {
      model: phase.model,
      temperature: phase.temperature,
      messages,
      tools: phase.tools.length > 0 ? phase.tools : undefined,
      toolChoice: phase.tools.length > 0 ? "auto" : undefined,
      maxDurationMs: remainingMs,
    };

    let result: ChatCompletionResult;
    try {
      result = await sendChatCompletion(providerConfig, baseRequest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(LLM_TIMEOUT_MARKER)) {
        // Budget-driven abort: surface as an exhausted budget so the
        // orchestrator emits analysis_paused and the client can resume,
        // instead of failing the phase.
        emitter.status(`[${phase.name}] LLM call hit wall-clock budget at turn ${turnCount}; pausing.`);
        return timeBudgetResult(`Paused at turn ${turnCount}: LLM call exceeded remaining wall-clock budget.`);
      }
      throw err;
    }

    if (
      TRUNCATION_REASONS.has(result.finishReason) &&
      (remainingMs === undefined || remainingMs > 45_000)
    ) {
      emitter.status(`[${phase.name}] Response truncated (${result.finishReason}); retrying with a larger output limit.`);
      const retried = await sendChatCompletion(providerConfig, {
        ...baseRequest,
        maxTokens: TRUNCATION_RETRY_MAX_TOKENS,
        maxDurationMs: phase.deadlineAt !== undefined
          ? phase.deadlineAt - Date.now()
          : undefined,
      });
      retried.inputTokens += result.inputTokens;
      retried.outputTokens += result.outputTokens;
      result = retried;
    }

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    messages.push(toNormalizedMessages(result));

    if (result.finishReason === "stop" || !result.toolCalls?.length) {
      return {
        phaseName: phase.name,
        summary: result.content || "Phase completed.",
        toolCallCount,
        turnCount,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        model: phase.model,
        budgetExhausted: false,
      };
    }

    for (const toolCall of result.toolCalls) {
      toolCallCount++;
      const fnName = toolCall.function.name;

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        // Truncated/malformed arguments: bounce back to the model instead of
        // silently executing with empty args (which corrupts or drops the
        // intended action, e.g. a create_node_group with no label).
        messages.push({
          role: "tool",
          content: JSON.stringify({
            success: false,
            error:
              "Tool arguments were not valid JSON (likely truncated). Re-issue this tool call with complete arguments.",
          }),
          tool_call_id: toolCall.id,
        });
        continue;
      }

      emitter.toolCall(fnName, args);
      const toolResult = await executeTool(fnName, args);
      emitter.toolResult(fnName, toolResult);

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        tool_call_id: toolCall.id,
      });
    }

    toolCallTurns++;

    if (phase.onTurnComplete) {
      phase.onTurnComplete({
        phase: phase.phaseNumber ?? 0,
        phaseName: phase.name,
        turn: turnCount,
        maxTurns: phase.maxTurns,
      });
    }

    if (
      phase.coverageInjectionInterval &&
      phase.getCoverageMessage &&
      toolCallTurns > 0 &&
      toolCallTurns % phase.coverageInjectionInterval === 0
    ) {
      const coverageMsg = phase.getCoverageMessage();
      messages.push({
        role: "system",
        content: coverageMsg,
      });
      emitter.status(coverageMsg);
    }
  }

  return {
    phaseName: phase.name,
    summary: `[${phase.name}] Reached turn limit (${phase.maxTurns}).`,
    toolCallCount,
    turnCount,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    model: phase.model,
    budgetExhausted: true,
  };
}
