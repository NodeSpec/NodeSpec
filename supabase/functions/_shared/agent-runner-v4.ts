import { SSEEmitter } from "./streaming.ts";
import {
  sendChatCompletion,
  toNormalizedMessages,
  type ProviderConfig,
  type ChatMessage,
  type ToolCall,
  type ToolDefinition,
  type ChatCompletionResult,
} from "./ai-provider.ts";

export type { ToolDefinition, ToolCall };

export interface AgentRunnerConfigV4 {
  model?: string;
  temperature?: number;
  maxTurns?: number;
}

export type ToolExecutorFn = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export async function runGenericAgentLoopV4(
  systemPrompt: string,
  userMessage: string,
  tools: ToolDefinition[],
  executeTool: ToolExecutorFn,
  emitter: SSEEmitter,
  providerConfig: ProviderConfig,
  config: AgentRunnerConfigV4 = {}
): Promise<{ summary: string; toolCallCount: number; turnCount: number; inputTokens: number; outputTokens: number; model: string }> {
  const model = config.model || providerConfig.model;
  const temperature = config.temperature || 0.3;
  const maxTurns = config.maxTurns || 30;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  let turnCount = 0;
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  emitter.status("Thinking...");

  while (turnCount < maxTurns) {
    turnCount++;

    const result: ChatCompletionResult = await sendChatCompletion(providerConfig, {
      model,
      temperature,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      toolChoice: tools.length > 0 ? "auto" : undefined,
      responseFormat: tools.length === 0 ? { type: "json_object" } : undefined,
    });

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    messages.push(toNormalizedMessages(result));

    if (result.finishReason === "stop" || !result.toolCalls?.length) {
      const summary = result.content || "Completed.";
      emitter.complete(summary, []);
      return { summary, toolCallCount, turnCount, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model };
    }

    for (const toolCall of result.toolCalls) {
      toolCallCount++;
      const fnName = toolCall.function.name;

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
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
  }

  const summary = "Reached maximum turn limit. Partial results may have been applied.";
  emitter.complete(summary, []);
  return { summary, toolCallCount, turnCount, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model };
}
