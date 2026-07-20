import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeRunRequest, RuntimeTool } from "../server/runtimes/types.js";
import { runCustomApiAgent } from "../server/runtimes/custom-api.js";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  constructorArgs: [] as unknown[],
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mocks.create } };
    constructor(opts: unknown) {
      mocks.constructorArgs.push(opts);
    }
  },
}));

async function* streamOf(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) yield chunk;
}

function textChunk(text: string) {
  return { choices: [{ delta: { content: text }, finish_reason: null }] };
}

function finishChunk(reason: string) {
  return { choices: [{ delta: {}, finish_reason: reason }] };
}

function usageChunk(promptTokens: number, completionTokens: number) {
  return {
    choices: [],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  };
}

function toolCallDelta(
  index: number,
  delta: { id?: string; name?: string; args?: string },
) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              ...(delta.id ? { id: delta.id } : {}),
              function: {
                ...(delta.name ? { name: delta.name } : {}),
                ...(delta.args !== undefined ? { arguments: delta.args } : {}),
              },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
}

function makeRequest(overrides: Partial<RuntimeRunRequest> = {}): RuntimeRunRequest {
  return {
    prompt: "hello",
    systemPrompt: "you are boop",
    model: "test-model",
    tools: [],
    mode: "execution",
    ...overrides,
  };
}

function makeTool(overrides: Partial<RuntimeTool> = {}): RuntimeTool {
  return {
    namespace: "calendar",
    name: "list_events",
    description: "Lists calendar events",
    inputSchema: {},
    jsonSchema: { type: "object", properties: { date: { type: "string" } } },
    handle: async () => ({ text: "3 events", success: true }),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.constructorArgs.length = 0;
});

describe("runCustomApiAgent", () => {
  it("converts image prompt blocks into image_url content parts", async () => {
    // Given
    mocks.create.mockResolvedValue(streamOf([textChunk("ok"), finishChunk("stop")]));
    const request = makeRequest({
      prompt: [
        { type: "text", text: "what is in this picture?" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
        },
      ],
    });

    // When
    await runCustomApiAgent(request, { baseUrl: "http://localhost:1234/v1" });

    // Then
    expect(mocks.constructorArgs[0]).toEqual({
      baseURL: "http://localhost:1234/v1",
      apiKey: "boop",
    });
    const messages = mocks.create.mock.calls[0][0].messages;
    expect(messages[0]).toEqual({ role: "system", content: "you are boop" });
    expect(messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what is in this picture?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      ],
    });
  });

  it("streams text deltas to onText and reports usage", async () => {
    // Given
    mocks.create.mockResolvedValue(
      streamOf([textChunk("Hello"), textChunk(" world"), usageChunk(10, 5), finishChunk("stop")]),
    );
    const onText = vi.fn();
    const onUsage = vi.fn();

    // When
    const result = await runCustomApiAgent(makeRequest({ onText, onUsage }), {});

    // Then
    expect(result.text).toBe("Hello world");
    expect(onText.mock.calls.map(([text]) => text)).toEqual(["Hello", " world"]);
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: "test-model", inputTokens: 10, outputTokens: 5 }),
    );
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    const params = mocks.create.mock.calls[0][0];
    expect(params.stream).toBe(true);
    expect(params.stream_options).toEqual({ include_usage: true });
  });

  it("accumulates fragmented tool calls and drives the agent loop", async () => {
    // Given
    const handle = vi.fn(async () => ({ text: "3 events", success: true }));
    const tool = makeTool({ handle });
    const onToolUse = vi.fn();
    const onToolResult = vi.fn();
    mocks.create
      .mockResolvedValueOnce(
        streamOf([
          toolCallDelta(0, { id: "call_1", name: "calendar__list_events", args: '{"date":' }),
          toolCallDelta(0, { args: ' "2026-07-20"}' }),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([textChunk("Done."), finishChunk("stop")]));

    // When
    const result = await runCustomApiAgent(
      makeRequest({ tools: [tool], onToolUse, onToolResult }),
      { apiKey: "secret" },
    );

    // Then
    expect(result.text).toBe("Done.");
    expect(handle).toHaveBeenCalledWith({ date: "2026-07-20" });
    expect(onToolUse).toHaveBeenCalledWith("calendar.list_events", { date: "2026-07-20" });
    expect(onToolResult).toHaveBeenCalledWith("calendar.list_events", "3 events");

    const secondCallMessages = mocks.create.mock.calls[1][0].messages;
    expect(secondCallMessages.at(-2)).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "calendar__list_events",
            arguments: '{"date": "2026-07-20"}',
          },
        },
      ],
    });
    expect(secondCallMessages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "3 events",
    });

    const openAiTools = mocks.create.mock.calls[0][0].tools;
    expect(openAiTools).toEqual([
      {
        type: "function",
        function: {
          name: "calendar__list_events",
          description: "Lists calendar events",
          parameters: { type: "object", properties: { date: { type: "string" } } },
        },
      },
    ]);
  });

  it("turns tool handle errors into textual tool results", async () => {
    // Given
    const handle = vi.fn(async () => {
      throw new Error("calendar offline");
    });
    mocks.create
      .mockResolvedValueOnce(
        streamOf([
          toolCallDelta(0, { id: "call_1", name: "calendar__list_events", args: "{}" }),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(streamOf([textChunk("Sorry, failed."), finishChunk("stop")]));
    const onToolResult = vi.fn();

    // When
    const result = await runCustomApiAgent(
      makeRequest({ tools: [makeTool({ handle })], onToolResult }),
      {},
    );

    // Then
    expect(result.text).toBe("Sorry, failed.");
    expect(onToolResult).toHaveBeenCalledWith(
      "calendar.list_events",
      "Tool error: calendar offline",
    );
    expect(mocks.create.mock.calls[1][0].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "Tool error: calendar offline",
    });
  });

  it("stops after the tool-call iteration limit", async () => {
    // Given — a fresh stream per call. mockResolvedValue would reuse one
    // exhausted async generator across all 25 iterations, making the loop
    // see an empty stream on call #2 and return early instead of throwing.
    mocks.create.mockImplementation(async () =>
      streamOf([
        toolCallDelta(0, { id: "call_1", name: "calendar__list_events", args: "{}" }),
        finishChunk("tool_calls"),
      ]),
    );

    // When
    const run = runCustomApiAgent(makeRequest({ tools: [makeTool()] }), {});

    // Then
    await expect(run).rejects.toThrow(/exceeded 25 tool-call iterations/);
    expect(mocks.create).toHaveBeenCalledTimes(25);
  });

  it("falls back to non-streaming when the endpoint rejects streaming", async () => {
    // Given
    mocks.create
      .mockRejectedValueOnce(new Error("streaming is not supported by this endpoint"))
      .mockResolvedValueOnce({
        choices: [
          { message: { content: "plain answer" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      });

    // When
    const result = await runCustomApiAgent(makeRequest(), {});

    // Then
    expect(result.text).toBe("plain answer");
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0].stream).toBe(false);
    expect(result.usage).toMatchObject({ inputTokens: 3, outputTokens: 2 });
  });

  it("wraps endpoint errors with an actionable message", async () => {
    // Given
    const err = Object.assign(new Error("model not found"), { status: 404 });
    mocks.create.mockRejectedValue(err);

    // When
    const run = runCustomApiAgent(makeRequest(), { baseUrl: "http://localhost:9/v1" });

    // Then
    await expect(run).rejects.toThrow(
      /Custom API request failed at http:\/\/localhost:9\/v1 \(status 404\): model not found/,
    );
  });
});
