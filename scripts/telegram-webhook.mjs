#!/usr/bin/env node
// Registers the Telegram bot webhook URL via the Bot API.
//
// Usage:
//   node scripts/telegram-webhook.mjs <full-webhook-url>
//
// The URL must be https:// — Telegram requires TLS for webhooks.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const envPath = resolve(root, ".env.local");

function readEnv() {
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*?)(?:\s+#.*)?$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const webhookUrl = process.argv[2];
  if (!webhookUrl || !/^https:\/\//.test(webhookUrl)) {
    console.error("Usage: node scripts/telegram-webhook.mjs <https://...webhook-url>");
    console.error("  URL must use https:// — Telegram requires TLS.");
    process.exit(1);
  }

  const env = readEnv();
  const token = env.BOT_TOKEN;
  if (!token) {
    console.log("[telegram-webhook] skipping — BOT_TOKEN not set in .env.local");
    return;
  }

  const body = { url: webhookUrl };
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) body.secret_token = secret;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.ok) {
    console.log(`[telegram-webhook] registered ${webhookUrl}`);
  } else {
    console.error(`[telegram-webhook] failed: ${JSON.stringify(data)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
