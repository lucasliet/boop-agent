import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { TelegramStreamer } from "../server/telegram-stream.js";

interface EditCall {
  text: string;
}

function fakeApi(options?: { failStart?: boolean; rateLimitOnce?: boolean }) {
  const edits: EditCall[] = [];
  let rateLimited = false;
  const api = {
    sendMessage: vi.fn(async () => {
      if (options?.failStart) throw new Error("network down");
      return { message_id: 42 };
    }),
    editMessageText: vi.fn(async (_chatId: number, _messageId: number, text: string) => {
      if (options?.rateLimitOnce && !rateLimited) {
        rateLimited = true;
        throw { error_code: 429, parameters: { retry_after: 2 } };
      }
      edits.push({ text });
    }),
  } as unknown as Api;
  return { api, edits };
}

describe("TelegramStreamer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not create a message before the first delta arrives", async () => {
    // Given
    const { api } = fakeApi();
    new TelegramStreamer(api, 123);

    // When
    await vi.advanceTimersByTimeAsync(10_000);

    // Then
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("creates the placeholder on the first delta and edits after the debounce", async () => {
    // Given
    const { api, edits } = fakeApi();
    const streamer = new TelegramStreamer(api, 123);

    // When
    streamer.append("hello world, this is a long enough delta");
    await vi.advanceTimersByTimeAsync(249);

    // Then — placeholder sent lazily, but no edit inside the debounce window
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(edits).toHaveLength(0);

    // When
    await vi.advanceTimersByTimeAsync(700);

    // Then
    expect(edits).toHaveLength(1);
    expect(edits[0]?.text).toContain("hello world");
  });

  it("batches small deltas instead of editing per token", async () => {
    // Given
    const { api, edits } = fakeApi();
    const streamer = new TelegramStreamer(api, 123);

    // When
    streamer.append("hi");
    await vi.advanceTimersByTimeAsync(2000);

    // Then — growth below MIN_GROWTH_CHARS means no edit yet
    expect(edits).toHaveLength(0);
  });

  it("backs off on 429 and retries after the cooldown", async () => {
    // Given
    const { api, edits } = fakeApi({ rateLimitOnce: true });
    const streamer = new TelegramStreamer(api, 123);
    streamer.append("a reasonably long delta to pass the threshold");

    // When — first attempt hits the 429
    await vi.advanceTimersByTimeAsync(1000);
    expect(edits).toHaveLength(0);

    // When — still inside the 2s retry_after window
    await vi.advanceTimersByTimeAsync(1000);
    expect(edits).toHaveLength(0);

    // When — after the cooldown
    await vi.advanceTimersByTimeAsync(1500);

    // Then
    expect(edits).toHaveLength(1);
  });

  it("finalize writes the final text and stops further edits", async () => {
    // Given
    const { api, edits } = fakeApi();
    const streamer = new TelegramStreamer(api, 123);
    streamer.append("partial content that is long enough");

    // When
    const rendered = await streamer.finalize("final answer");
    await vi.advanceTimersByTimeAsync(5000);

    // Then
    expect(rendered).toBe(true);
    expect(edits.at(-1)?.text).toBe("final answer");
    expect(edits).toHaveLength(1);
  });

  it("returns false from finalize when the placeholder send fails", async () => {
    // Given
    const { api, edits } = fakeApi({ failStart: true });
    const streamer = new TelegramStreamer(api, 123);

    // When
    streamer.append("some long enough delta text");
    await vi.advanceTimersByTimeAsync(3000);
    const rendered = await streamer.finalize("final");

    // Then
    expect(rendered).toBe(false);
    expect(streamer.started).toBe(false);
    expect(edits).toHaveLength(0);
  });
});
