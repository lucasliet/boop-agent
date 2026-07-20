import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import type { RuntimeRunRequest, RuntimeRunResult, RuntimeTool } from "./types.js";
import { EMPTY_USAGE, type UsageTotals } from "../usage.js";
import { ensureModelPrices, estimateCustomCostUsd } from "../model-prices.js";
import { formatError } from "../error-format.js";

const MAX_TOOL_ITERATIONS = 25;
const TOOL_NAME_MAX_LENGTH = 64;

export interface CustomApiAgentOptions {
  baseUrl?: string;
  apiKey?: string;
}

/**
 * OpenAI rejects tool names outside [a-zA-Z0-9_-], so the display name
 * `namespace.name` is flattened into a sanitized identifier and mapped back
 * when the model calls it.
 */
function buildToolRegistry(tools: RuntimeTool[]): {
  openAiTools: ChatCompletionTool[];
  bySanitizedName: Map<string, { tool: RuntimeTool; displayName: string }>;
} {
  const bySanitizedName = new Map<string, { tool: RuntimeTool; displayName: string }>();
  const openAiTools: ChatCompletionTool[] = [];
  for (const tool of tools) {
    const displayName = `${tool.namespace}.${tool.name}`;
    const base = `${tool.namespace}__${tool.name}`
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, TOOL_NAME_MAX_LENGTH);
    let sanitized = base;
    let suffix = 1;
    while (bySanitizedName.has(sanitized)) {
      sanitized = `${base.slice(0, TOOL_NAME_MAX_LENGTH - 4)}_${suffix}`;
      suffix += 1;
    }
    bySanitizedName.set(sanitized, { tool, displayName });
    openAiTools.push({
      type: "function",
      function: {
        name: sanitized,
        description: tool.description,
        parameters: tool.jsonSchema,
      },
    });
  }
  return { openAiTools, bySanitizedName };
}

function buildInitialMessages(request: RuntimeRunRequest): ChatCompletionMessageParam[] {
  const userContent: string | ChatCompletionContentPart[] =
    typeof request.prompt === "string"
      ? request.prompt
      : request.prompt.map((block): ChatCompletionContentPart => {
          if (block.type === "image") {
            return {
              type: "image_url",
              image_url: {
                url: `data:${block.source.media_type};base64,${block.source.data}`,
              },
            };
          }
          return { type: "text", text: block.text };
        });
  return [
    { role: "system", content: request.systemPrompt },
    { role: "user", content: userContent },
  ];
}

/** Heuristic: some OpenAI-compatible endpoints (e.g. certain proxies) reject streaming. */
function isStreamingUnsupportedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : formatError(err);
  return /stream/i.test(message) && /not support|unsupported|invalid|cannot|disabled/i.test(message);
}

function toActionableError(err: unknown, baseUrl?: string): Error {
  const status = (err as { status?: unknown } | null)?.status;
  const message = formatError(err);
  const where = baseUrl ? ` at ${baseUrl}` : "";
  return new Error(
    `Custom API request failed${where}${status ? ` (status ${String(status)})` : ""}: ${message}`,
  );
}

function applyUsageChunk(
  totals: UsageTotals,
  usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null } | null | undefined,
  model: string,
  baseUrl?: string,
): UsageTotals {
  if (!usage) return totals;
  const next: UsageTotals = {
    model,
    inputTokens: totals.inputTokens + (usage.prompt_tokens ?? 0),
    outputTokens: totals.outputTokens + (usage.completion_tokens ?? 0),
    cacheReadTokens: totals.cacheReadTokens + (usage.prompt_tokens_details?.cached_tokens ?? 0),
    cacheCreationTokens: totals.cacheCreationTokens,
    costUsd: 0,
  };
  next.costUsd = estimateCustomCostUsd(next, baseUrl);
  return next;
}

type PendingToolCall = { id: string; name: string; arguments: string };

type TurnOutcome = {
  text: string;
  finishReason: string | null;
  toolCalls: PendingToolCall[];
};

/** Streams one completion, accumulating text and fragmented tool-call deltas. */
async function consumeStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  request: RuntimeRunRequest,
  onUsageDelta: (usage: ChatCompletionChunk["usage"]) => void,
): Promise<TurnOutcome> {
  let text = "";
  let finishReason: string | null = null;
  const toolCalls = new Map<number, PendingToolCall>();

  for await (const chunk of stream) {
    if (chunk.usage) onUsageDelta(chunk.usage);
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.delta?.content) {
      text += choice.delta.content;
      await request.onText?.(choice.delta.content);
    }
    if (choice.delta?.tool_calls) {
      for (const delta of choice.delta.tool_calls) {
        const pending = toolCalls.get(delta.index) ?? { id: "", name: "", arguments: "" };
        if (delta.id) pending.id = delta.id;
        if (delta.function?.name) pending.name += delta.function.name;
        if (delta.function?.arguments) pending.arguments += delta.function.arguments;
        toolCalls.set(delta.index, pending);
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  return { text, finishReason, toolCalls: [...toolCalls.values()] };
}

function outcomeFromCompletion(completion: ChatCompletion): TurnOutcome {
  const choice = completion.choices?.[0];
  const message = choice?.message;
  const toolCalls: PendingToolCall[] = (message?.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.type === "function" ? call.function.name : "",
    arguments: call.type === "function" ? call.function.arguments : "",
  }));
  return {
    text: typeof message?.content === "string" ? message.content : "",
    finishReason: choice?.finish_reason ?? null,
    toolCalls,
  };
}

/**
 * Runs an agent turn against any OpenAI-compatible chat-completions endpoint,
 * driving the tool-call loop until the model answers or the iteration cap hits.
 */
export async function runCustomApiAgent(
  request: RuntimeRunRequest,
  opts: CustomApiAgentOptions,
): Promise<RuntimeRunResult> {
  await ensureModelPrices();

  const client = new OpenAI({
    baseURL: opts.baseUrl,
    apiKey: opts.apiKey ?? "boop",
  });

  const { openAiTools, bySanitizedName } = buildToolRegistry(request.tools);
  const messages = buildInitialMessages(request);
  let usage: UsageTotals = { ...EMPTY_USAGE, model: request.model };

  const onUsageDelta = (delta: ChatCompletionChunk["usage"] | ChatCompletion["usage"]) => {
    usage = applyUsageChunk(usage, delta, request.model, opts.baseUrl);
    void request.onUsage?.(usage);
  };

  const callApi = async (): Promise<TurnOutcome> => {
    const params = {
      model: request.model,
      messages,
      ...(openAiTools.length > 0 ? { tools: openAiTools } : {}),
    };
    const requestOptions = request.abortController
      ? { signal: request.abortController.signal }
      : undefined;
    try {
      const stream = await client.chat.completions.create(
        { ...params, stream: true, stream_options: { include_usage: true } },
        requestOptions,
      );
      return await consumeStream(stream, request, onUsageDelta);
    } catch (err) {
      if (!isStreamingUnsupportedError(err)) throw toActionableError(err, opts.baseUrl);
    }
    // Fallback for endpoints without streaming support.
    try {
      const completion = await client.chat.completions.create(
        { ...params, stream: false },
        requestOptions,
      );
      onUsageDelta(completion.usage);
      const outcome = outcomeFromCompletion(completion);
      if (outcome.text) await request.onText?.(outcome.text);
      return outcome;
    } catch (err) {
      throw toActionableError(err, opts.baseUrl);
    }
  };

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const outcome = await callApi();

    if (outcome.finishReason !== "tool_calls" || outcome.toolCalls.length === 0) {
      return { text: outcome.text, usage };
    }

    const assistantToolCalls: ChatCompletionMessageToolCall[] = outcome.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
    const assistantMessage: ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: outcome.text || null,
      tool_calls: assistantToolCalls,
    };
    messages.push(assistantMessage);

    for (const call of outcome.toolCalls) {
      const entry = bySanitizedName.get(call.name);
      const toolMessage: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: call.id,
        content: "",
      };
      if (!entry) {
        toolMessage.content = `Tool error: unknown tool "${call.name}" requested by the model.`;
        messages.push(toolMessage);
        continue;
      }
      const { tool, displayName } = entry;
      let args: Record<string, unknown>;
      try {
        const parsed: unknown = call.arguments ? JSON.parse(call.arguments) : {};
        args = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
      } catch (err) {
        toolMessage.content = `Tool error: invalid JSON arguments: ${formatError(err)}`;
        messages.push(toolMessage);
        await request.onToolResult?.(displayName, toolMessage.content);
        continue;
      }
      await request.onToolUse?.(displayName, args);
      try {
        const result = await tool.handle(args);
        toolMessage.content = result.text;
      } catch (err) {
        toolMessage.content = `Tool error: ${formatError(err)}`;
      }
      messages.push(toolMessage);
      await request.onToolResult?.(displayName, toolMessage.content);
    }
  }

  throw new Error(
    `Custom API agent exceeded ${MAX_TOOL_ITERATIONS} tool-call iterations without a final answer. Check that the model at ${opts.baseUrl ?? "the configured endpoint"} supports tool calling.`,
  );
}
