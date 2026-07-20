import type { Api } from "grammy";

/**
 * Streams a reply into a single Telegram message via editMessageText.
 * Telegram has no native streaming API, so the bot sends a placeholder and
 * keeps editing it as deltas arrive — debounced to stay well under the
 * ~20 edits/sec per-chat limit, with retry_after-aware backoff on 429s.
 *
 * The placeholder is created lazily on the first text delta, not at turn
 * start: long tool-call phases emit no text, and an idle "▌" bubble during
 * them reads as a stuck message.
 */

const MIN_EDIT_INTERVAL_MS = 700;
const MIN_GROWTH_CHARS = 20;
const TICK_MS = 250;
/** Stop growing the streamed text before hitting Telegram's 4096-char cap. */
const MAX_STREAM_CHARS = 3900;
const CURSOR = " ▌";

interface TelegramRateLimitError {
  error_code?: number;
  parameters?: { retry_after?: number };
}

function retryAfterSeconds(err: unknown): number | null {
  const e = err as TelegramRateLimitError | null;
  return e?.error_code === 429 ? (e.parameters?.retry_after ?? 2) : null;
}

export class TelegramStreamer {
  private messageId: number | null = null;
  private startPromise: Promise<boolean> | null = null;
  private text = "";
  private lastRendered = "";
  private lastEditAt = 0;
  private backoffUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: Api,
    private chatId: number,
  ) {}

  private start(): Promise<boolean> {
    this.startPromise ??= (async () => {
      try {
        const msg = await this.api.sendMessage(this.chatId, "▌");
        this.messageId = msg.message_id;
        this.timer = setInterval(() => void this.tick(), TICK_MS);
        return true;
      } catch (err) {
        console.warn("[telegram-stream] placeholder send failed; will reply without streaming", err);
        return false;
      }
    })();
    return this.startPromise;
  }

  get started(): boolean {
    return this.messageId !== null;
  }

  append(delta: string): void {
    // First delta kicks off the placeholder send; text buffers until it lands.
    void this.start();
    if (this.text.length >= MAX_STREAM_CHARS) return;
    this.text = (this.text + delta).slice(0, MAX_STREAM_CHARS);
  }

  private async tick(): Promise<void> {
    if (this.messageId === null) return;
    const now = Date.now();
    if (now < this.backoffUntil || now - this.lastEditAt < MIN_EDIT_INTERVAL_MS) return;
    const candidate = this.text + CURSOR;
    if (candidate === this.lastRendered) return;
    if (this.text.length + CURSOR.length - this.lastRendered.length < MIN_GROWTH_CHARS) return;
    await this.edit(candidate);
  }

  private async edit(text: string): Promise<void> {
    if (this.messageId === null) return;
    try {
      await this.api.editMessageText(this.chatId, this.messageId, text);
      this.lastRendered = text;
      this.lastEditAt = Date.now();
    } catch (err) {
      const retryAfter = retryAfterSeconds(err);
      if (retryAfter !== null) {
        // Keep lastRendered stale so the tick retries after the cooldown.
        this.backoffUntil = Date.now() + retryAfter * 1000;
      } else {
        console.warn("[telegram-stream] edit failed", err);
      }
    }
  }

  /**
   * Stops the worker and writes the final text into the streamed message.
   * Returns false when no message was ever created (no deltas, or the
   * placeholder send failed) so the caller can fall back to a plain send.
   */
  async finalize(finalText: string): Promise<boolean> {
    const started = this.startPromise ? await this.startPromise : false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!started || this.messageId === null) return false;
    await this.edit(finalText || "…");
    return true;
  }
}
