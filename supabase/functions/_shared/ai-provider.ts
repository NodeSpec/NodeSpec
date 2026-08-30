import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptWithUpgrade } from "./crypto.ts";

// P0-1: lazy re-encryption — when a stored key decrypts from the legacy v1 format and
// ENCRYPTION_SECRET is configured, persist the fresh v2 envelope in the background.
async function persistUpgradedApiKey(
  supabase: SupabaseClient,
  keyId: string,
  upgraded: string,
): Promise<void> {
  const { error } = await supabase
    .from("user_api_keys")
    .update({ api_key_encrypted: upgraded })
    .eq("id", keyId);
  if (error) {
    console.warn(`[ai-provider] lazy v2 re-encryption failed for key ${keyId}: ${error.message}`);
  }
}

export type ProviderType = "openai" | "anthropic" | "google";

export interface ProviderConfig {
  provider: ProviderType;
  apiKey: string;
  model: string;
  heavyModel: string;
  isPlatform: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface SendCompletionConfig {
  model: string;
  temperature: number;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: string;
  responseFormat?: Record<string, unknown>;
  maxTokens?: number;
  /**
   * Upper bound (ms) for this single call, capped by the caller's remaining
   * wall-clock budget. The effective abort fires at min(this, 90s default).
   * When the abort is budget-driven (shorter than the default), the thrown
   * error is tagged so callers can treat it as a resumable pause, not a fatal.
   */
  maxDurationMs?: number;
  /**
   * Anthropic-only reasoning control. "adaptive" lets Claude decide when/how much
   * to think (correct for heavy Opus architecture/validation work); "off" disables
   * thinking for cheap light-model calls (intent classification, chat). Defaults to
   * "adaptive" to preserve prior behavior. No effect on OpenAI/Gemini.
   */
  thinking?: "adaptive" | "off";
  /**
   * Anthropic-only effort control (GA, no beta header). Bounds thinking depth and
   * overall token spend. "medium" is the favorable balance for architecture turns.
   * Omit for light calls. No effect on OpenAI/Gemini.
   */
  effort?: "low" | "medium" | "high" | "max";
  /**
   * Anthropic-only. When true, marks the (large, stable) system prompt + tool
   * definitions with an ephemeral cache breakpoint and incrementally caches the
   * growing message list, so repeated turns within/across invocations re-read the
   * cached prefix instead of reprocessing it. No effect on OpenAI/Gemini.
   */
  enablePromptCache?: boolean;
}

/** Marker on timeout errors so the agent loop can pause+resume instead of failing. */
export const LLM_TIMEOUT_MARKER = "__LLM_CALL_TIMEOUT__";

export function isLlmTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(LLM_TIMEOUT_MARKER);
}

const PROVIDER_MODELS: Record<ProviderType, { light: string; heavy: string }> = {
  openai: { light: "gpt-5.4-mini", heavy: "gpt-5.4" },
  anthropic: { light: "claude-sonnet-4-6", heavy: "claude-opus-4-8" },
  google: { light: "gemini-2.5-flash", heavy: "gemini-2.5-pro" },
};

export function getProviderModels(provider: ProviderType) {
  return PROVIDER_MODELS[provider];
}

const LLM_CALL_TIMEOUT_MS = 110_000;
const MIN_LLM_CALL_TIMEOUT_MS = 5_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  providerName: string,
  maxDurationMs?: number
): Promise<Response> {
  const effectiveTimeout = maxDurationMs !== undefined
    ? Math.max(MIN_LLM_CALL_TIMEOUT_MS, Math.min(LLM_CALL_TIMEOUT_MS, maxDurationMs))
    : LLM_CALL_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `${providerName} API error (timeout): request exceeded ${effectiveTimeout}ms ${LLM_TIMEOUT_MARKER}`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- OpenAI Adapter ---

async function sendOpenAI(
  config: ProviderConfig,
  completion: SendCompletionConfig
): Promise<ChatCompletionResult> {
  const hasTools = completion.tools && completion.tools.length > 0;
  const outputLimit = completion.maxTokens ?? (hasTools ? 16384 : undefined);

  const body: Record<string, unknown> = {
    model: completion.model,
    temperature: completion.temperature,
    messages: completion.messages,
  };

  if (outputLimit !== undefined) {
    body.max_completion_tokens = outputLimit;
  }

  if (hasTools) {
    body.tools = completion.tools;
    body.tool_choice = completion.toolChoice || "auto";
  } else if (completion.responseFormat) {
    body.response_format = completion.responseFormat;
  }

  const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, "OpenAI", completion.maxDurationMs);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response from OpenAI");

  return {
    content: choice.message.content,
    toolCalls: choice.message.tool_calls || [],
    finishReason: choice.finish_reason,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: completion.model,
  };
}

// --- Anthropic Adapter ---

function convertMessagesForAnthropic(
  messages: ChatMessage[]
): { system: string; messages: Record<string, unknown>[] } {
  let systemPrompt = "";
  const anthropicMessages: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemPrompt += (systemPrompt ? "\n\n" : "") + (msg.content || "");
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const contentBlocks: Record<string, unknown>[] = [];
      if (msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.tool_calls) {
        let parsedInput: unknown = {};
        try {
          parsedInput = JSON.parse(tc.function.arguments);
        } catch {
          parsedInput = {};
        }
        contentBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: parsedInput,
        });
      }
      anthropicMessages.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    if (msg.role === "tool") {
      pushMerged(anthropicMessages, "user", [
        {
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: msg.content || "",
        },
      ]);
      continue;
    }

    pushMerged(anthropicMessages, msg.role === "user" ? "user" : "assistant", [
      { type: "text", text: msg.content || "" },
    ]);
  }

  return { system: systemPrompt, messages: anthropicMessages };
}

/**
 * Appends content to the message list, merging into the previous message when it
 * shares the same role. Anthropic rejects requests with dangling tool_use blocks
 * and expects role continuity; merging keeps a resume-seeded transcript (which can
 * place a tool_result user turn next to a fresh user instruction) valid.
 */
function pushMerged(
  messages: Record<string, unknown>[],
  role: "user" | "assistant",
  blocks: Record<string, unknown>[]
): void {
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    const existing = Array.isArray(last.content)
      ? (last.content as Record<string, unknown>[])
      : [{ type: "text", text: (last.content as string) || "" }];
    last.content = [...existing, ...blocks];
    return;
  }
  messages.push({ role, content: blocks });
}

/**
 * Places an incremental cache breakpoint on the final message so the growing
 * conversation prefix (earlier turns) is re-read from cache on the next turn
 * instead of reprocessed. Complements the static system-prompt breakpoint.
 */
function markLastMessageForCaching(messages: Record<string, unknown>[]): void {
  const last = messages[messages.length - 1];
  if (!last) return;
  const blocks = Array.isArray(last.content)
    ? (last.content as Record<string, unknown>[])
    : [{ type: "text", text: (last.content as string) || "" }];
  if (blocks.length === 0) return;
  blocks[blocks.length - 1] = {
    ...blocks[blocks.length - 1],
    cache_control: { type: "ephemeral" },
  };
  last.content = blocks;
}

function convertToolsForAnthropic(
  tools: ToolDefinition[]
): Record<string, unknown>[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function extractAnthropicToolCalls(
  content: unknown[]
): { text: string; toolCalls: ToolCall[] } {
  let text = "";
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text") {
      text += (b.text as string) || "";
    } else if (b.type === "tool_use") {
      toolCalls.push({
        id: b.id as string,
        type: "function",
        function: {
          name: b.name as string,
          arguments: JSON.stringify(b.input),
        },
      });
    }
    // Skip "thinking" and "redacted_thinking" blocks from adaptive thinking
  }

  return { text, toolCalls };
}

function isTemperatureUnsupported(model: string): boolean {
  return /claude-opus-4-[7-9]/.test(model) || /claude-opus-4-\d{2,}/.test(model);
}

async function sendAnthropic(
  config: ProviderConfig,
  completion: SendCompletionConfig
): Promise<ChatCompletionResult> {
  const { system, messages } = convertMessagesForAnthropic(completion.messages);
  const noTemperature = isTemperatureUnsupported(completion.model);
  const thinkingMode = completion.thinking ?? "adaptive";
  const cache = completion.enablePromptCache === true;

  const body: Record<string, unknown> = {
    model: completion.model,
    max_tokens: completion.maxTokens ?? 16384,
    messages,
  };

  if (thinkingMode === "adaptive") {
    body.thinking = { type: "adaptive" };
    // Adaptive thinking requires temperature=1; Opus 4.7+ omits temperature entirely.
    if (!noTemperature) body.temperature = 1;
  } else if (!noTemperature) {
    body.temperature = completion.temperature;
  }

  if (completion.effort) {
    body.output_config = { effort: completion.effort };
  }

  if (system) {
    // A single cache breakpoint on the (large, stable) system block caches the
    // tools + system prefix that is rendered before it. Only worth it on the heavy
    // architecture/validation prompts, which comfortably exceed the min cacheable
    // prefix; light calls pass enablePromptCache=false and send a plain string.
    body.system = cache
      ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
      : system;
  }

  if (completion.tools && completion.tools.length > 0) {
    body.tools = convertToolsForAnthropic(completion.tools);
    if (completion.toolChoice === "auto") {
      body.tool_choice = { type: "auto" };
    }
  }

  if (cache) {
    markLastMessageForCaching(messages);
  }

  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, "Anthropic", completion.maxDurationMs);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const { text, toolCalls } = extractAnthropicToolCalls(
    data.content as unknown[]
  );

  const finishReason =
    data.stop_reason === "end_turn"
      ? "stop"
      : data.stop_reason === "tool_use"
        ? "tool_calls"
        : data.stop_reason || "stop";

  return {
    content: text || null,
    toolCalls,
    finishReason,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    model: completion.model,
  };
}

// --- Google/Gemini Adapter ---

function convertMessagesForGemini(
  messages: ChatMessage[]
): { systemInstruction: string; contents: Record<string, unknown>[] } {
  let systemInstruction = "";
  const contents: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction +=
        (systemInstruction ? "\n\n" : "") + (msg.content || "");
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const parts: Record<string, unknown>[] = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      for (const tc of msg.tool_calls) {
        let parsedArgs: unknown = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments);
        } catch {
          parsedArgs = {};
        }
        parts.push({
          functionCall: { name: tc.function.name, args: parsedArgs },
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    if (msg.role === "tool") {
      const toolCallId = msg.tool_call_id || "unknown";
      let parsedResponse: unknown;
      try {
        parsedResponse = JSON.parse(msg.content || "{}");
      } catch {
        parsedResponse = { result: msg.content };
      }
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: toolCallId,
              response: parsedResponse,
            },
          },
        ],
      });
      continue;
    }

    const role = msg.role === "user" ? "user" : "model";
    contents.push({ role, parts: [{ text: msg.content || "" }] });
  }

  return { systemInstruction, contents };
}

function convertToolsForGemini(
  tools: ToolDefinition[]
): Record<string, unknown>[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    },
  ];
}

function extractGeminiToolCalls(
  parts: unknown[]
): { text: string; toolCalls: ToolCall[] } {
  let text = "";
  const toolCalls: ToolCall[] = [];

  for (const part of parts) {
    const p = part as Record<string, unknown>;
    if (p.text) {
      text += p.text as string;
    }
    if (p.functionCall) {
      const fc = p.functionCall as { name: string; args: unknown };
      toolCalls.push({
        id: `gemini-${crypto.randomUUID().slice(0, 8)}`,
        type: "function",
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args || {}),
        },
      });
    }
  }

  return { text, toolCalls };
}

async function sendGemini(
  config: ProviderConfig,
  completion: SendCompletionConfig
): Promise<ChatCompletionResult> {
  const { systemInstruction, contents } = convertMessagesForGemini(
    completion.messages
  );

  const hasTools = completion.tools && completion.tools.length > 0;
  const outputLimit = completion.maxTokens ?? (hasTools ? 16384 : undefined);

  const generationConfig: Record<string, unknown> = {
    temperature: completion.temperature,
  };
  if (outputLimit !== undefined) {
    generationConfig.maxOutputTokens = outputLimit;
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig,
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  if (completion.tools && completion.tools.length > 0) {
    body.tools = convertToolsForGemini(completion.tools);
    body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${completion.model}:generateContent?key=${config.apiKey}`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "Gemini", completion.maxDurationMs);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error("No response from Gemini");

  const parts = candidate.content?.parts || [];
  const { text, toolCalls } = extractGeminiToolCalls(parts);

  const finishReason =
    candidate.finishReason === "STOP"
      ? "stop"
      : candidate.finishReason === "TOOL_CALLS" ||
          (toolCalls.length > 0 && candidate.finishReason !== "STOP")
        ? "tool_calls"
        : candidate.finishReason || "stop";

  const usage = data.usageMetadata || {};

  return {
    content: text || null,
    toolCalls,
    finishReason,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    model: completion.model,
  };
}

// --- Unified send function ---

const ADAPTERS: Record<
  ProviderType,
  (
    config: ProviderConfig,
    completion: SendCompletionConfig
  ) => Promise<ChatCompletionResult>
> = {
  openai: sendOpenAI,
  anthropic: sendAnthropic,
  google: sendGemini,
};

export async function sendChatCompletion(
  config: ProviderConfig,
  completion: SendCompletionConfig
): Promise<ChatCompletionResult> {
  const adapter = ADAPTERS[config.provider];
  if (!adapter) {
    throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
  return adapter(config, completion);
}

export function toNormalizedMessages(
  result: ChatCompletionResult
): ChatMessage {
  return {
    role: "assistant",
    content: result.content,
    tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
  };
}

// --- Provider config resolution ---

export function resolvePlatformConfig(): ProviderConfig {
  const platformKey = Deno.env.get("OPENAI_API_KEY");
  if (!platformKey) throw new Error("OPENAI_API_KEY is not configured");
  return {
    provider: "openai",
    apiKey: platformKey,
    model: PROVIDER_MODELS.openai.light,
    heavyModel: PROVIDER_MODELS.openai.heavy,
    isPlatform: true,
  };
}

export async function resolveProviderConfigForProvider(
  supabase: SupabaseClient,
  userId: string,
  provider: ProviderType,
  model?: string
): Promise<ProviderConfig> {
  const models = PROVIDER_MODELS[provider];

  const { data: keyRow } = await supabase
    .from("user_api_keys")
    .select("id, api_key_encrypted")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("is_active", true)
    .maybeSingle();

  if (keyRow?.api_key_encrypted) {
    const { plaintext: apiKey, upgraded } = await decryptWithUpgrade(keyRow.api_key_encrypted);
    if (upgraded) await persistUpgradedApiKey(supabase, keyRow.id, upgraded);
    return {
      provider,
      apiKey,
      model: model || models.light,
      heavyModel: models.heavy,
      isPlatform: false,
    };
  }

  const platformKey = Deno.env.get("OPENAI_API_KEY");
  if (!platformKey) {
    throw new Error(
      `No API key found for provider "${provider}" and no platform fallback available`
    );
  }
  console.warn(
    `[ai-provider] No user key for ${provider}, falling back to platform OpenAI`
  );
  return {
    provider: "openai",
    apiKey: platformKey,
    model: PROVIDER_MODELS.openai.light,
    heavyModel: PROVIDER_MODELS.openai.heavy,
    isPlatform: true,
  };
}

export async function resolveProviderConfig(
  supabase: SupabaseClient,
  userId: string
): Promise<ProviderConfig> {
  const { data: settings } = await supabase
    .from("user_settings")
    .select("ai_provider, ai_model, use_global_ai")
    .eq("user_id", userId)
    .maybeSingle();

  if (settings?.ai_provider && !settings?.use_global_ai) {
    const provider = settings.ai_provider as ProviderType;
    const models = PROVIDER_MODELS[provider];
    if (models) {
      const { data: keyRow } = await supabase
        .from("user_api_keys")
        .select("id, api_key_encrypted")
        .eq("user_id", userId)
        .eq("provider", provider)
        .eq("is_active", true)
        .maybeSingle();

      if (keyRow?.api_key_encrypted) {
        const { plaintext: apiKey, upgraded } = await decryptWithUpgrade(keyRow.api_key_encrypted);
        if (upgraded) await persistUpgradedApiKey(supabase, keyRow.id, upgraded);
        return {
          provider,
          apiKey,
          model: settings.ai_model || models.light,
          heavyModel: models.heavy,
          isPlatform: false,
        };
      }
    }
  }

  return resolvePlatformConfig();
}
