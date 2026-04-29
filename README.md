<p align="center">
  <img src="assets/boop.gif" alt="Boop" width="220" />
</p>

# Boop

A Telegram-based personal agent built on top of the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview).

📺 **Watch the original walkthrough:** [YouTube — How I built Boop](https://youtu.be/ZpmKjDDbqHs)

> **This is a starting point, not a finished product.**
> It's the architecture built for a personal agent, opened up as a template so you can take it, connect your own Claude to Telegram, and extend it however you want. Integrations are plugged in via [Composio](https://composio.dev/?utm_source=chris&utm_medium=youtube&utm_campaign=collab) — drop in an API key and connect Gmail, Slack, GitHub, Linear, Notion, and ~1000 others straight from the debug dashboard.

```
 Telegram  →  Bot webhook  →  Interaction agent  →  Sub-agents (per task)
                                      │                    │
                                      ▼                    ▼
                                Memory store  ←──  Integrations (your MCP tools)
```

Built on:
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) — the loop, tool use, sub-agents, MCP
- [grammY](https://grammy.dev) — Telegram Bot framework (webhook handler, typing indicator, message chunking)
- [Composio](https://composio.dev/?utm_source=chris&utm_medium=youtube&utm_campaign=collab) — integrations layer. One API key = Gmail, Slack, GitHub, Linear, Notion, Stripe, Supabase, + ~1000 more with hosted OAuth
- [Convex](https://convex.link/chrisraroque) — real-time database for memory, agents, drafts
- Your [Claude Code](https://claude.com/code?ref=chrisraroque) subscription — no separate Anthropic API key required

---

## What you get

- **Telegram in / Telegram out** via the Bot API (with typing indicators and 4096-char chunking).
- **Webhook auto-registration** — `npm run dev` auto-registers the inbound webhook with Telegram every restart on free ngrok. Stable domains (ngrok reserved / Cloudflare Tunnel) register once and skip from then on.
- **Dispatcher + workers** pattern: a lean interaction agent decides what to do, spawns focused sub-agents that actually do the work.
- **Pure dispatcher** — the interaction agent has only memory + spawn + automation + draft tools. Web access, files, and integrations are explicitly denied to it; sub-agents get `WebSearch` / `WebFetch` / the integrations.
- **Tiered memory** (short / long / permanent) with post-turn extraction, decay, and cleaning.
- **Vector search** for recall when you add an embeddings key (Voyage or OpenAI) — falls back to substring.
- **Memory consolidation** — a daily 3-phase adversarial pipeline (proposer → adversary → judge) that merges duplicates, resolves contradictions, and prunes noise. Proposer and judge on Sonnet; adversary on Haiku for cheap skepticism. Runs every 24h by default, also triggerable manually via `POST /consolidate`.
- **Automations** — the agent can schedule recurring work from a text ("every morning at 8 summarize my calendar") and push results back to Telegram.
- **Draft-and-send** — any external action stages a draft first; the agent only commits when the user confirms.
- **Heartbeat + retry** — stuck agents auto-fail, debug dashboard can retry.
- **Admin guard** — set `TELEGRAM_ADMIN_USER_IDS` to restrict the bot to your user IDs only.
- **Composio-powered integrations** — one API key unlocks 1000+ toolkits. Connect Gmail, Slack, GitHub, Linear, Notion, Drive, HubSpot, etc. with a click from the debug dashboard. Composio handles OAuth + token refresh.
- **Debug dashboard** (React + Vite) with a Boop mascot — Dashboard (spend + tokens + agent status), Agents (timeline + integration logos), Automations, Memory (table + force-directed graph), Events, Connections.
- **Convex** for persistence — real-time, typed, free tier.
- **Docker Compose** for self-hosting — one `docker compose up -d` and you're running.
- **Uses your Claude Code subscription** — no separate Anthropic API key required.

<p align="center">
  <img src="assets/agents-view.jpg" alt="Agents view in the Boop debug dashboard" width="900" />
  <br>
  <sub><em>Agents tab — every spawned sub-agent with status, cost, tokens, turns, runtime, and the integrations it touched.</em></sub>
</p>

<p align="center">
  <img src="assets/automations.jpg" alt="Automations view in the Boop debug dashboard" width="900" />
  <br>
  <sub><em>Automations tab — schedule recurring jobs from a text ("every morning at 8 summarize my calendar") and watch them run.</em></sub>
</p>

<p align="center">
  <img src="assets/memory-graph.jpg" alt="Memory graph in the Boop debug dashboard" width="900" />
  <br>
  <sub><em>Memory tab — force-directed graph of clustered memories across short, long, and permanent tiers. Tabular view also available.</em></sub>
</p>

<p align="center">
  <img src="assets/connections.jpg" alt="Connections view in the Boop debug dashboard" width="900" />
  <br>
  <sub><em>Connections tab — Composio toolkits with OAuth handled for you. Click Connect and the agent can use it on the next message.</em></sub>
</p>

---

## Heads up before you use this

- **This was never meant to be open-sourced.** Built for personal use and shared because enough people asked. It's not a product.
- **Not optimized for cost or security.** Use at your own risk. Review the code, set your own budgets, and don't trust it with anything you wouldn't trust yourself with.
- **I'm open to PRs for optimizations** — performance, bug fixes, DX improvements, new example integrations, better docs.

---

## Why is it named Boop?

<p align="center">
  <img src="assets/luna.jpeg" alt="Luna" width="220" />
  <br>
  <sub><em>Luna, the inspiration.</em></sub>
</p>

Boop is meant to be a proactive agent — one that nudges you over Telegram with reminders, drafts, and little follow-ups. A small "boop" whenever it has something for you.

And it's named after the original creator's dog, Luna, who gives plenty of them.

---

## Prerequisites

You need accounts for these. Keep the tabs open — setup will ask for credentials from each.

| Service | Why | Free? |
|---|---|---|
| [Claude Code](https://claude.com/code?ref=chrisraroque) | Powers the agent. Install it, sign in once, the SDK uses your session. | Subscription required |
| Telegram Bot | Create a bot with [@BotFather](https://t.me/BotFather) — `/newbot`, copy the token. | Free |
| [Convex](https://convex.link/chrisraroque) | Database + realtime. | Free tier is plenty |
| [Composio](https://composio.dev/?utm_source=chris&utm_medium=youtube&utm_campaign=collab) | Integrations — one API key unlocks ~1000 toolkits. Optional if you just want chat + memory + automations. | Free tier covers personal use |
| [ngrok](https://ngrok.com?ref=chrisraroque) or similar | Expose your local port so Telegram can reach it. | Free tier works |

**Custom integrations welcome.** Composio covers the common catalog, but you're free to add your own MCP servers under `server/integrations/` and register them in `server/integrations/registry.ts`.

---

## Quickstart

```bash
# 1. Clone + install
git clone https://github.com/lucasliet/boop-agent.git
cd boop-agent
npm install

# 2. Install Claude Code (one-time, global) and sign in
npm install -g @anthropic-ai/claude-code
claude  # sign in, then Ctrl-C to exit

# 3. Create a Telegram bot — talk to @BotFather on Telegram:
#    /newbot → follow prompts → copy the token it gives you

# 4. Interactive setup — writes .env.local, creates Convex deployment
npm run setup

# 5. Install ngrok (one-time) and authorize it
brew install ngrok
# or grab from https://ngrok.com/download
ngrok config add-authtoken <your-token>   # free at https://dashboard.ngrok.com

# 6. Start everything with one command — server, Convex, debug UI, and ngrok
npm run dev
```

`npm run dev` prints color-prefixed output from all four processes and shows a banner with your public webhook URL once the tunnel is live.

```
🐶 Debug dashboard:   http://localhost:5173
🌐 Public URL:        https://<abc123>.ngrok-free.app
📮 Telegram webhook:  https://<abc123>.ngrok-free.app/telegram/webhook
```

On free ngrok, **the webhook auto-registers with Telegram every boot** — no manual paste needed. For stable URLs (ngrok reserved or Cloudflare Tunnel), the webhook registers once and is skipped on subsequent boots.

Text your bot from Telegram. The agent replies.

> **⚠ ngrok free plan gives you a new URL every time.** That means every time you restart `npm run dev`, your Telegram webhook URL is dead until re-registered.
>
> If you're going to run this for more than a quick demo, **strongly recommend one of:**
> - **ngrok paid plan** — gives you a reserved domain that stays the same forever (set `NGROK_DOMAIN` in `.env.local`)
> - **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)** — free, stable subdomain, a bit more setup
> - Any other tunnel with a static URL
>
> If you use a non-ngrok tunnel, point it at `localhost:3456` yourself — `npm run dev` will still run the rest. Set `PUBLIC_URL` in `.env.local` and run `npm run telegram:webhook` once.

---

## How the Telegram integration works

### Bot setup

1. Talk to [@BotFather](https://t.me/BotFather) on Telegram.
2. Send `/newbot`, pick a name and username.
3. Copy the token (`123456:ABC-DEF...`) into `BOT_TOKEN` in `.env.local`.

### `npm run dev` lifecycle

```
 1. Preflight: confirm convex/_generated/ exists (else prompt to run setup).
 2. Spawn four children in parallel, each with a prefixed log stream:
       server │   (tsx watch server/index.ts)
       convex │   (npx convex dev — pushes schema + functions)
       debug  │   (vite dev server on :5173)
       ngrok  │   (if installed AND no static URL) exposes :PORT
 3. Wait for all four readiness signals.
 4. Auto-register the webhook (FREE ngrok only, not reserved domains):
       webhook │ [telegram-webhook] registered https://abc123.ngrok-free.app/telegram/webhook
 5. Show the banner with dashboard + public URL + webhook.
```

### When auto-register fires vs when it doesn't

| Setup | Auto-register fires? | Why |
|---|---|---|
| Free ngrok (default) | **Yes**, every boot | URL rotates; Telegram would be pointing at a dead URL otherwise |
| Reserved `NGROK_DOMAIN` | No | URL is stable; register once with `npm run telegram:webhook` |
| Static `PUBLIC_URL` (Cloudflare Tunnel etc.) | No | Same reason |
| `TELEGRAM_AUTO_WEBHOOK=false` | No | Manual opt-out |

### Manual webhook registration

```bash
npm run telegram:webhook -- https://your-domain.example.com/telegram/webhook
```

Or, using the script directly:

```bash
node scripts/telegram-webhook.mjs https://your-domain.example.com/telegram/webhook
```

### Admin guard

Set `TELEGRAM_ADMIN_USER_IDS` to a pipe-separated list of Telegram user IDs. Anyone not on the list gets a "Sorry, I'm a private bot." reply.

To find your user ID: talk to [@userinfobot](https://t.me/userinfobot) on Telegram.

```env
TELEGRAM_ADMIN_USER_IDS=123456789|987654321
```

### What you'll see in the server logs during a conversation

```
server │ [turn a3f21d] ← 123456789: "what's on my calendar today?"
server │ [turn a3f21d] tool: recall({"query":"calendar today"})
server │ [turn a3f21d] tool: spawn_agent({"integrations":["google-calendar"],"task":"Pull today's events"})
server │ [agent 9e82c1] spawn: google-calendar — "Pull today's events"
server │ [agent 9e82c1] tool: list_events
server │ [agent 9e82c1] done (completed, 2.1s, in/out tokens 1234/567)
server │ [turn a3f21d] → reply (3.4s, 140 chars): "Light day — just your 2pm with Sarah..."
server │ [telegram] → sent 140 chars to 123456789
```

The same events are written to Convex and streamed to the debug dashboard in real time.

---

## Self-hosting with Docker Compose

Boop ships a `docker-compose.yml` for running the server persistently — no `npm run dev` needed.

### 1. Create the bot and get credentials

- Talk to [@BotFather](https://t.me/BotFather): `/newbot` → copy the token.
- Your Convex project must exist. Run `npx convex dev --once` once on your local machine and copy the `CONVEX_URL` from [dashboard.convex.dev](https://dashboard.convex.dev).

### 2. Configure

```bash
git clone https://github.com/lucasliet/boop-agent.git
cd boop-agent
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Required
BOT_TOKEN=123456:ABC-DEF...
CONVEX_URL=https://your-project.convex.cloud
VITE_CONVEX_URL=https://your-project.convex.cloud

# Recommended
TELEGRAM_WEBHOOK_SECRET=any-random-string
TELEGRAM_ADMIN_USER_IDS=your_telegram_user_id

# Optional
ANTHROPIC_API_KEY=sk-ant-...   # if not using Claude Code subscription
COMPOSIO_API_KEY=sk-comp-...
```

### 3. Start the server

```bash
docker compose up -d
```

The `boop-server` container runs on port `3456`. Now you need to expose it to Telegram (HTTPS required).

### 4. Expose the server

**Option A — ngrok with tunnel profile (easiest for testing):**

```bash
export NGROK_AUTHTOKEN=ngrok_...
docker compose --profile tunnel up -d
```

The `webhook` sidecar polls ngrok's local API, gets the HTTPS URL, and calls `scripts/telegram-webhook.mjs` automatically.

**Option B — Cloudflare Tunnel (recommended for production, free):**

```bash
cloudflared tunnel --url http://localhost:3456
```

Then register the webhook once:

```bash
node scripts/telegram-webhook.mjs https://your-subdomain.trycloudflare.com/telegram/webhook
```

**Option C — Reverse proxy with your own domain (nginx / Caddy):**

Point `https://yourdomain.com → localhost:3456` and register:

```bash
node scripts/telegram-webhook.mjs https://yourdomain.com/telegram/webhook
```

### 5. Test

Send a message to your bot in Telegram — it should reply.

### Useful commands

```bash
docker compose logs -f server     # tail logs
docker compose restart server     # restart after changing .env.local
docker compose pull && docker compose up -d --build   # update to latest
docker compose down               # stop everything
```

---

## Architecture in 30 seconds

```
┌─────────────┐    webhook     ┌──────────────────────┐
│   Telegram  │ ─────────────► │ /telegram/webhook    │
└─────────────┘                └──────────┬───────────┘
                                          │
                                          ▼
                          ┌────────────────────────────┐
                          │    Interaction agent       │
                          │    (dispatcher only)       │
                          │  • recall / write_memory   │
                          │  • spawn_agent(...)        │
                          └────────┬────────┬──────────┘
                                   │        │
                   ┌───────────────┘        └──────────────┐
                   ▼                                       ▼
           ┌───────────────┐                      ┌──────────────┐
           │   Memory      │                      │  Execution   │
           │ (Convex)      │                      │  agent(s)    │
           │ + cleaning    │                      │  + integrations│
           └───────────────┘                      └──────────────┘
```

- **Interaction agent** (`server/interaction-agent.ts`) is the front door. It reads the user's message + recent history, optionally calls `recall`, writes memories, creates automations, and decides whether to answer directly or spawn a sub-agent.
- **Execution agent** (`server/execution-agent.ts`) is spawned per task. It loads only the integrations named in the spawn call and returns a tight answer.
- **Memory** (`server/memory/`) handles writes, recall, post-turn extraction, and daily cleaning. Stored in Convex.
- **Automations** (`server/automations.ts`) poll every 30s for due jobs, spawn an execution agent to run them, and push results back to the user via Telegram.
- **Integrations** are provided by [Composio](https://composio.dev/?utm_source=chris&utm_medium=youtube&utm_campaign=collab). The dispatcher names toolkits by slug (`spawn_agent(integrations: ["gmail"])`); `server/composio.ts` opens a toolkit-scoped Composio session per spawn and wraps its tools as an MCP server.

Deep dive: [ARCHITECTURE.md](./ARCHITECTURE.md). Adding your own tools: [INTEGRATIONS.md](./INTEGRATIONS.md).

---

## Skills

Skills are reusable playbooks — `SKILL.md` files under `.claude/skills/` that teach the execution agent how to do a specific kind of task (write a YouTube script, draft a cold email, plan a trip, etc.).

**How the Agent SDK handles them:** every `.claude/skills/*/SKILL.md` is loaded when the execution agent boots, and each skill's `description` gets injected into the agent's system prompt along with an instruction to pick the relevant one for the current task. You do **not** select skills per spawn — the agent picks based on which description matches. Only descriptions load upfront; the full SKILL.md body is pulled into context only when the agent actually invokes the skill, so adding more skills is cheap.

**To add a skill:** create `.claude/skills/<kebab-name>/SKILL.md`:

```yaml
---
name: youtube-script-writer
description: Write a tight, retention-focused YouTube script from a topic or outline. Use when the user asks for a video script, wants to turn research into a video, or needs a hook rewritten.
---

<instructions the agent follows when this skill is invoked>
```

Example included: `.claude/skills/youtube-script-writer/`.

---

## Using your Claude Code subscription

The Claude Agent SDK reuses the credentials Claude Code writes to your machine when you sign in. You do not need an `ANTHROPIC_API_KEY`.

- Install once: `npm install -g @anthropic-ai/claude-code`
- Run `claude` in a terminal, sign in.
- That's it — the SDK finds the session automatically.

If you'd prefer an API key (e.g. for a deployed server or Docker), set `ANTHROPIC_API_KEY` in `.env.local` and the SDK will use it instead.

---

## Environment variables

Everything lives in `.env.local` (auto-created by `npm run setup`). See `.env.example` for the full list.

| Var | Required | Notes |
|---|---|---|
| `CONVEX_URL` / `VITE_CONVEX_URL` | yes | Convex deployment URL. Written by `npx convex dev`. |
| `BOT_TOKEN` | yes | Telegram bot token from @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | recommended | Random string — validates that webhook calls are from Telegram. |
| `TELEGRAM_ADMIN_USER_IDS` | recommended | Pipe-separated Telegram user IDs allowed to use the bot. Empty = public. |
| `TELEGRAM_AUTO_WEBHOOK` | no | Set to `false` to disable auto-registration on `npm run dev`. Default: on. |
| `BOOP_MODEL` | no | Default `claude-sonnet-4-6`. Used as the fallback when no runtime override is set. The user can switch the model at runtime via the `set_model` self-tool — that override is stored in the Convex `settings` table and takes precedence over this env var. |
| `BOOP_UPSTREAM_CHECK` | no | Set to `false` to disable the new-version banner on `npm run dev`. Default: on. |
| `PORT` | no | Default `3456`. |
| `NGROK_DOMAIN` | no | Reserved ngrok domain (paid). When set, `npm run dev` uses it and skips auto-register. |
| `PUBLIC_URL` | no | Static public URL (Cloudflare Tunnel etc.). When set, ngrok is skipped. |
| `VOYAGE_API_KEY` **or** `OPENAI_API_KEY` | optional | Unlocks vector recall. Falls back to substring. |
| `COMPOSIO_API_KEY` | optional | Enables integrations. Without it, plain chat + memory + automations still work. |
| `COMPOSIO_USER_ID` | optional | Stable user id Composio keys connections under. Defaults to `boop-default`. |
| `ANTHROPIC_API_KEY` | optional | Bypass the Claude Code subscription. Required when running in Docker. |

---

## Integrations, via Composio

Boop outsources 3rd-party service integrations to [Composio](https://composio.dev/?utm_source=chris&utm_medium=youtube&utm_campaign=collab). One API key unlocks ~1000 toolkits (Gmail, Slack, GitHub, Linear, Notion, Drive, Stripe, Supabase, HubSpot, Salesforce, Granola, and so on). Composio hosts the OAuth apps, manages token refresh, and exposes every toolkit as a set of Claude-ready tools. Boop never sees an access token.

### Quickstart

1. Grab an API key at [app.composio.dev/developers](https://app.composio.dev/developers?utm_source=chris&utm_medium=youtube&utm_campaign=collab).
2. Add it to `.env.local`:
   ```
   COMPOSIO_API_KEY=sk-comp-...
   ```
3. `npm run dev`.
4. Open the debug dashboard → **Connections** tab. Click **Connect** on any toolkit, authenticate on Composio's hosted page, done.

After a successful connect, the agent can use that toolkit immediately — no restart.

### How it wires in

```
interaction-agent:  spawn_agent(task, integrations: ["gmail", "slack"])
                              │
                              ▼
execution-agent:    for each slug, open a Composio session scoped to that toolkit:
                      composio.create(BOOP_USER, { toolkits: ["gmail"] })
                      session.tools()          ← returns only Gmail tools
                              │
                              ▼
                    createSdkMcpServer({ name: "gmail", tools })
                              │
                              ▼
                    Sub-agent sees mcp__gmail__GMAIL_*  — nothing else.
```

### Adding toolkits beyond the curated list

The ~20 toolkit catalog is hand-picked in `server/composio.ts:CURATED_TOOLKITS`. To surface another:

```ts
export const CURATED_TOOLKITS: CuratedToolkit[] = [
  // …existing entries…
  { slug: "airtable", displayName: "Airtable", authMode: "managed" },
];
```

### Cost tracking

Every execution agent's `total_cost_usd` comes straight from the Claude Agent SDK's `result` message. You'll see real dollar amounts in the Dashboard tab's Cost tile and per-agent cards.

### A note on runaway cost

Boop's `query()` calls don't currently set `maxTurns` or `maxBudgetUsd`. Kept intentionally for a single-user personal agent — execution agents complete in under 60 seconds in practice, and the 15-minute heartbeat (`server/heartbeat.ts`) marks any long-running agent as `failed`.

If you deploy in a higher-throughput setting, set `maxTurns: 20` and `maxBudgetUsd: 2.00` on the `query()` call in `server/execution-agent.ts`.

Deeper dive: [INTEGRATIONS.md](./INTEGRATIONS.md).

---

## Data retention

Boop stores everything in Convex. Without any cleanup, all append-only tables grow forever. A daily Convex cron (`convex/crons.ts`, runs at 06:00 UTC) hard-deletes rows past their TTL.

**The cron is independent of the boop-agent server process** — it runs in Convex's own infrastructure even when your server is offline.

| Table | TTL | Notes |
|-------|-----|-------|
| `memoryRecords` (archived/pruned) | 30 days | Active and `tier: permanent` are never deleted |
| `messages` | 90 days | The dispatcher only reads the last 10 messages per turn |
| `agentLogs` | 14 days | Verbose per-tool-call trace |
| `memoryEvents` | 14 days | Internal audit trail |
| `executionAgents` (completed/failed/cancelled) | 30 days | Running agents are never deleted |
| `automationRuns` (completed/failed) | 30 days | |
| `articles` (posted) | 30 days | Active drafts are never deleted |
| `consolidationRuns` (completed/failed) | 30 days | |
| `drafts` (sent/rejected/expired) | 7 days | Pending drafts are never deleted |
| `sendblueDedup` | 7 days | Dedup cache |
| `usageRecords` | 180 days | Billing history |

**What is never deleted:** `conversations`, `automations` (definitions), `settings`, active `memoryRecords`, pending `drafts`.

To trigger a purge run manually via the Convex dashboard or CLI:

```bash
npx convex run internal/purge:run
```

---

## Project layout

```
boop-agent/
├── server/
│   ├── index.ts                   # Express + WS + HTTP routes
│   ├── telegram.ts                # Telegram webhook, reply, typing indicator
│   ├── interaction-agent.ts       # Dispatcher
│   ├── execution-agent.ts         # Sub-agent runner
│   ├── automations.ts             # Cron loop
│   ├── automation-tools.ts        # create/list/toggle/delete MCP
│   ├── draft-tools.ts             # save_draft / send_draft / reject_draft MCP
│   ├── heartbeat.ts               # Stale-agent sweep
│   ├── consolidation.ts           # 3-phase adversarial pipeline (proposer → adversary → judge)
│   ├── usage.ts                   # aggregateUsageFromResult helper
│   ├── embeddings.ts              # Voyage / OpenAI wrapper
│   ├── composio.ts                # Composio SDK wrapper
│   ├── composio-routes.ts         # /composio/* HTTP routes for the Debug UI
│   ├── broadcast.ts               # WS fanout
│   ├── convex-client.ts           # Convex HTTP client
│   ├── memory/
│   │   ├── types.ts
│   │   ├── tools.ts               # write_memory / recall
│   │   ├── extract.ts             # Post-turn extraction
│   │   └── clean.ts               # Decay + archive + prune
│   └── integrations/
│       ├── registry.ts            # Integration loader
│       └── composio-loader.ts     # Registers each connected Composio toolkit
├── convex/
│   ├── schema.ts
│   ├── messages.ts
│   ├── memoryRecords.ts
│   ├── agents.ts
│   ├── automations.ts
│   ├── consolidation.ts
│   ├── conversations.ts
│   ├── drafts.ts
│   ├── memoryEvents.ts
│   └── usageRecords.ts
├── debug/                         # Dashboard: Dashboard / Agents / Automations / Memory / Events / Connections
├── scripts/
│   ├── setup.ts                   # Interactive setup CLI
│   ├── dev.mjs                    # One-command orchestrator (server + convex + vite + ngrok)
│   ├── preflight.mjs              # Checks convex/_generated exists before booting
│   ├── telegram-webhook.mjs       # Registers Telegram webhook via Bot API
│   └── check-upstream.mjs         # New-version check on dev start
├── Dockerfile                     # Production image (node:20-alpine + tsx)
├── docker-compose.yml             # Self-host: server + optional ngrok tunnel + webhook sidecar
├── .dockerignore
├── README.md           ← you are here
├── ARCHITECTURE.md
└── INTEGRATIONS.md
```

---

## Upgrading

Boop is a fork-and-own template. You customize your copy freely — system prompts, memory thresholds, extra tools — and pull upstream fixes in on your own schedule.

The intended path is **Claude Code-driven**:

```bash
claude                 # inside your repo
/upgrade-boop
```

`/upgrade-boop` is a skill in `.claude/skills/upgrade-boop/SKILL.md`. It:

1. Refuses to run with a dirty working tree.
2. Creates a timestamped rollback tag.
3. Previews upstream changes bucketed by area (core / integrations / UI / schema / scripts / docs).
4. Merges (or cherry-picks, or rebases — your choice).
5. Runs `npm install` + `npm run typecheck`.
6. Parses `CHANGELOG.md` for `[BREAKING]` entries and offers to run the referenced migration skills.
7. Prints a rollback hash + any env-var additions you should copy into `.env.local`.

Plain git works too:

```bash
git remote add upstream https://github.com/lucasliet/boop-agent.git
git fetch upstream
git merge upstream/main
```

### New-version notifications

Every time you run `npm run dev`, a small background check (`scripts/check-upstream.mjs`) asks your `upstream` remote if there are new commits. If there are, you'll see a banner with the count and a reminder to run `/upgrade-boop`.

To turn it off: add `BOOP_UPSTREAM_CHECK=false` to `.env.local`.

---

## Troubleshooting

**Agent doesn't reply.**
- Check the server is running: `curl http://localhost:3456/health`
- Check that the Telegram webhook is registered: `curl https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo`
- Watch server logs. Look for `[telegram]` and `[interaction]` messages.
- Make sure the server is reachable from the internet (HTTPS required by Telegram).

**Webhook keeps returning 403.**
- `TELEGRAM_WEBHOOK_SECRET` in `.env.local` doesn't match what was used when registering the webhook. Re-run `npm run telegram:webhook` after updating the secret.

**Bot replies to everyone.**
- Set `TELEGRAM_ADMIN_USER_IDS` to your Telegram user ID (get it from [@userinfobot](https://t.me/userinfobot)).

**Convex errors / `VITE_CONVEX_URL is not set`.**
- Run `npx convex dev` manually. Ensure `.env.local` has both `CONVEX_URL` and `VITE_CONVEX_URL`.

**"Could not find public function for X:Y".**
- `CONVEX_DEPLOYMENT` and `CONVEX_URL` are pointing at different projects. Re-run `npm run setup` to auto-sync them.

**Agent replies but can't use my integration.**
- Check `COMPOSIO_API_KEY` is set in `.env.local`.
- Check the toolkit shows as **Connected** in the Connections tab.
- Watch server logs for `[composio] registered …` at boot.

**I want to test without Telegram.**
- The server exposes `POST /chat` with `{ conversationId, content }` — curl or the debug dashboard's Chat tab can drive the agent directly.

**Claude SDK says no credentials.**
- Run `claude` once and sign in, or set `ANTHROPIC_API_KEY` in `.env.local`. When running in Docker, `ANTHROPIC_API_KEY` is always required.

**"Dashboard crashed" in the debug UI.**
- The ErrorBoundary caught something. Check the server logs (`server │` stream) and the browser console. Most common cause: a new Convex function hasn't been deployed yet. Restart `npm run dev` so `convex dev` re-pushes.

---

## License

MIT. Build whatever you want on top of this.
