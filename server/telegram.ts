import express from "express";
import { Bot } from "grammy";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { handleUserMessage } from "./interaction-agent.js";
import { broadcast } from "./broadcast.js";

const MAX_CHUNK = 4096;

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[^\n]*\n?/, "").replace(/\n?```$/, ""))
    .replace(/`(.+?)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}

function chunk(text: string, size = MAX_CHUNK): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split(/\n/)) {
    if ((buf + "\n" + line).length > size) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

let _bot: Bot | null = null;

function getBot(): Bot | null {
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  if (!_bot) _bot = new Bot(token);
  return _bot;
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const bot = getBot();
  if (!bot) {
    console.warn("[telegram] BOT_TOKEN not set — not sending");
    return;
  }
  for (const part of chunk(stripMarkdown(text))) {
    try {
      await bot.api.sendMessage(chatId, part);
      console.log(`[telegram] → sent ${part.length} chars to ${chatId}`);
    } catch (err) {
      console.error(`[telegram] send failed:`, err);
    }
  }
}

async function sendTypingAction(chatId: number): Promise<void> {
  const bot = getBot();
  if (!bot) return;
  try {
    await bot.api.sendChatAction(chatId, "typing");
  } catch {
    /* non-fatal */
  }
}

export function startTypingLoop(chatId: number): () => void {
  sendTypingAction(chatId);
  const timer = setInterval(() => sendTypingAction(chatId), 4000);
  return () => clearInterval(timer);
}

function getAdminUserIds(): number[] {
  const raw = process.env.TELEGRAM_ADMIN_USER_IDS ?? "";
  if (!raw.trim()) return [];
  return raw
    .split("|")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

export function createTelegramRouter(): express.Router {
  const router = express.Router();

  router.post("/webhook", async (req, res) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const incoming = req.headers["x-telegram-bot-api-secret-token"];
      if (incoming !== secret) {
        res.status(403).json({ ok: false });
        return;
      }
    }

    const update = req.body;
    const message = update?.message;
    if (!message?.text || !message?.from?.id) {
      res.json({ ok: true, skipped: true });
      return;
    }

    const adminIds = getAdminUserIds();
    if (adminIds.length > 0 && !adminIds.includes(message.from.id)) {
      const bot = getBot();
      if (bot) {
        await bot.api
          .sendMessage(message.chat.id, "Sorry, I'm a private bot.")
          .catch(() => {});
      }
      res.json({ ok: true, unauthorized: true });
      return;
    }

    const chatId: number = message.chat.id;
    const userId: number = message.from.id;
    const content: string = message.text;
    const conversationId = `tg:${userId}`;
    const turnTag = Math.random().toString(36).slice(2, 8);
    const preview = content.length > 100 ? content.slice(0, 100) + "…" : content;
    console.log(`[turn ${turnTag}] ← ${userId}: ${JSON.stringify(preview)}`);
    const start = Date.now();

    broadcast("message_in", { conversationId, content, userId, chatId });
    res.json({ ok: true });

    const stopTyping = startTypingLoop(chatId);
    try {
      const reply = await handleUserMessage({
        conversationId,
        content,
        turnTag,
        onThinking: (t) => broadcast("thinking", { conversationId, t }),
      });
      if (reply) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const replyPreview = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
        console.log(
          `[turn ${turnTag}] → reply (${elapsed}s, ${reply.length} chars): ${JSON.stringify(replyPreview)}`,
        );
        await sendTelegramMessage(chatId, reply);
        await convex.mutation(api.messages.send, {
          conversationId,
          role: "assistant",
          content: reply,
        });
      } else {
        console.log(`[turn ${turnTag}] → (no reply)`);
      }
    } catch (err) {
      console.error(`[turn ${turnTag}] handler error`, err);
    } finally {
      stopTyping();
    }
  });

  return router;
}
