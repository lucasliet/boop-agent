#!/usr/bin/env tsx
import prompts from "prompts";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = resolve(ROOT, ".env.local");
const EXAMPLE_PATH = resolve(ROOT, ".env.example");

type RuntimeChoice = "claude" | "codex" | "custom";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_CODEX_MODEL = "gpt-5.5";
const DEFAULT_CODEX_REASONING_EFFORT = "medium";
const DEFAULT_CUSTOM_BASE_URL = "http://localhost:11434/v1";

interface CommandSpec {
  cmd: string;
  leading: string[];
}

const CLAUDE_MODEL_CHOICES = [
  { title: "claude-sonnet-4-6 (recommended)", value: "claude-sonnet-4-6" },
  { title: "claude-opus-4-6 (slowest, most capable)", value: "claude-opus-4-6" },
  { title: "claude-haiku-4-5 (fastest, cheapest)", value: "claude-haiku-4-5" },
];

const CODEX_MODEL_CHOICES = [
  { title: "gpt-5.5 (most capable)", value: "gpt-5.5" },
  { title: "gpt-5.4-mini (faster local testing)", value: "gpt-5.4-mini" },
  { title: "gpt-5.4 (balanced)", value: "gpt-5.4" },
  { title: "gpt-5.3-codex (coding optimized)", value: "gpt-5.3-codex" },
];

const CODEX_REASONING_CHOICES = [
  { title: "low (fastest)", value: "low" },
  { title: "medium (recommended)", value: "medium" },
  { title: "high (deeper reasoning)", value: "high" },
  { title: "xhigh (maximum reasoning)", value: "xhigh" },
];

function runtimeFromEnv(value: string | undefined): RuntimeChoice {
  if (value === "codex" || value === "custom") return value;
  return "claude";
}

function initialForChoice<T extends readonly { value: string }[]>(
  choices: T,
  value: string | undefined,
  fallback = 0,
): number {
  const index = choices.findIndex((choice) => choice.value === value);
  return index >= 0 ? index : fallback;
}

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, "utf8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function writeEnv(path: string, env: Record<string, string>): void {
  const example = existsSync(EXAMPLE_PATH) ? readFileSync(EXAMPLE_PATH, "utf8") : "";

  let out = "";
  const seen = new Set<string>();
  const sections = example.split(/\n(?=# ----)/);

  for (const section of sections) {
    const sectionKeys = [...section.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
    let s = section;
    for (const k of sectionKeys) {
      // Remove ALL existing occurrences of this key in the section (dedupe).
      const pattern = new RegExp(`^${k}=.*(\\r?\\n)?`, "gm");
      const matches = [...s.matchAll(pattern)];
      if (matches.length === 0) continue;

      if (seen.has(k)) {
        // Already written in an earlier section — just strip any re-occurrences.
        s = s.replace(pattern, "");
        continue;
      }

      const v = env[k] ?? "";
      // Replace first occurrence, remove the rest.
      let replaced = false;
      s = s.replace(pattern, (match) => {
        if (!replaced) {
          replaced = true;
          return `${k}=${v}` + (match.endsWith("\n") ? "\n" : "");
        }
        return "";
      });
      seen.add(k);
    }
    out += s + "\n";
  }
  writeFileSync(path, out.trim() + "\n");
}

function cleanConvexUrlEnv(path: string): void {
  const envContent = readFileSync(path, "utf8");
  const updated = envContent.replace(/^(?:CONVEX_URL|VITE_CONVEX_URL)=.*(\r?\n)?/gm, "");
  writeFileSync(path, updated);
}

function banner(s: string) {
  console.log("\n" + "━".repeat(60));
  console.log("  " + s);
  console.log("━".repeat(60));
}

function executableNames(name: string): string[] {
  if (process.platform !== "win32") return [name];
  if (/\.(cmd|exe|bat)$/i.test(name)) return [name];
  return [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name];
}

function commandSearchDirs(): string[] {
  const dirs = [
    resolve(ROOT, "node_modules", ".bin"),
    ...((process.env.PATH ?? "").split(delimiter).filter(Boolean)),
  ];
  if (process.platform === "darwin") {
    dirs.push(
      resolve(homedir(), ".local", "bin"),
      resolve(homedir(), ".npm-global", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    );
  }
  dirs.push(dirname(process.execPath));
  return [...new Set(dirs)];
}

function resolveCommand(name: string): string | null {
  if (name.includes("/") || name.includes("\\")) {
    return existsSync(name) ? name : null;
  }
  for (const dir of commandSearchDirs()) {
    for (const executable of executableNames(name)) {
      const candidate = resolve(dir, executable);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function spawnableNodeCommand(): string {
  const candidates = [
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin/node", "/usr/local/bin/node"] : []),
    resolveCommand("node"),
    "node",
    process.execPath,
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => candidate === "node" || existsSync(candidate)) ?? "node";
}

function nodeScriptCommand(scriptPath: string, leading: string[]): CommandSpec {
  const node = spawnableNodeCommand();
  return { cmd: node, leading: [scriptPath, ...leading] };
}

function npmExecCommand(packageName: string, binName: string): CommandSpec | null {
  const npm = resolveCommand("npm");
  if (npm) {
    try {
      const npmCli = realpathSync(npm);
      if (npmCli.endsWith(".js")) {
        return nodeScriptCommand(npmCli, [
          "exec",
          "--yes",
          "--package",
          packageName,
          "--",
          binName,
        ]);
      }
    } catch {
      /* fall through to spawning npm directly */
    }
    return {
      cmd: npm,
      leading: ["exec", "--yes", "--package", packageName, "--", binName],
    };
  }

  const npx = resolveCommand("npx");
  if (npx) {
    try {
      const npxCli = realpathSync(npx);
      if (npxCli.endsWith(".js")) {
        return nodeScriptCommand(npxCli, ["-y", packageName]);
      }
    } catch {
      /* fall through to spawning npx directly */
    }
    return { cmd: npx, leading: ["-y", packageName] };
  }

  return null;
}

function commandEnv(): NodeJS.ProcessEnv {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = process.env[pathKey] ?? process.env.PATH ?? "";
  return {
    ...process.env,
    [pathKey]: [...commandSearchDirs(), currentPath].filter(Boolean).join(delimiter),
  };
}

function packageCommand(binName: string, packageName = binName): CommandSpec {
  const direct = resolveCommand(binName);
  if (direct) return { cmd: direct, leading: [] };

  const npmExec = npmExecCommand(packageName, binName);
  if (npmExec) return npmExec;

  throw new Error(`Could not find ${binName}, npx, or npm on PATH.`);
}

async function runConvexDev(): Promise<void> {
  // If CONVEX_DEPLOYMENT is already set, `convex dev` reuses that deployment.
  // Only pass --configure new if this is a first-time setup — otherwise re-running
  // setup would silently create a new project and abandon all existing data.
  const existing = readEnv(ENV_PATH);
  const args = existing.CONVEX_DEPLOYMENT
    ? ["convex", "dev", "--once"]
    : ["convex", "dev", "--once", "--configure", "new"];

  if (!existing.CONVEX_DEPLOYMENT) {
    // Remove old Convex URLs from the env file to allow convex cli to populate
    // the Vite URL cleanly.
    cleanConvexUrlEnv(ENV_PATH);
  }

  const runner = packageCommand("convex", "convex");
  console.log(
    `\nLaunching \`${[runner.cmd, ...runner.leading, ...args.slice(1)].join(" ")}\` to configure your deployment.`,
  );
  console.log("Convex will open a browser window if you're not logged in.");
  if (existing.CONVEX_DEPLOYMENT) {
    console.log(`Reusing existing deployment: ${existing.CONVEX_DEPLOYMENT}`);
  }

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(runner.cmd, [...runner.leading, ...args.slice(1)], {
      stdio: "inherit",
      cwd: ROOT,
      env: commandEnv(),
    });
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`convex dev exited ${code}`)),
    );
  });
}

function hasBinary(name: string): Promise<boolean> {
  if (resolveCommand(name)) return Promise.resolve(true);
  return new Promise((ok) => {
    const lookup = process.platform === "win32" ? "where" : "which";
    const child = spawn(lookup, [name], { stdio: "ignore", env: commandEnv() });
    child.on("exit", (code) => ok(code === 0));
    child.on("error", () => ok(false));
  });
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* ignore — fall back to the printed URL */
  }
}

function runInherit(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const resolved = cmd === "node" ? cmd : (resolveCommand(cmd) ?? cmd);
    const child = spawn(resolved, args, {
      stdio: "inherit",
      cwd: ROOT,
      env: commandEnv(),
    });
    child.on("exit", (code) =>
      code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
    child.on("error", fail);
  });
}

function runCapture(cmd: string, args: string[], options: { echoOutput?: boolean } = {}): Promise<string> {
  return new Promise((ok, fail) => {
    const resolved = cmd === "node" ? cmd : (resolveCommand(cmd) ?? cmd);
    const child = spawn(resolved, args, {
      stdio: ["inherit", "pipe", "pipe"],
      cwd: ROOT,
      env: commandEnv(),
    });
    let out = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      if (options.echoOutput !== false) process.stdout.write(s);
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (code) =>
      code === 0 ? ok(out) : fail(new Error(`${cmd} exited ${code}`)),
    );
    child.on("error", fail);
  });
}

async function promptTelegramConfig(existing: Record<string, string>): Promise<Record<string, string>> {
  banner("Telegram Bot");
  console.log(`
To create a Telegram bot:
  1. Open Telegram and search for @BotFather
  2. Send /newbot and follow the prompts
  3. Copy the token it gives you (looks like 1234567890:ABCdef...)

To find your Telegram user ID, message @userinfobot on Telegram.
`);

  const answers = await prompts(
    [
      {
        type: "text",
        name: "BOT_TOKEN",
        message: "Paste your Telegram bot token:",
        initial: existing.BOT_TOKEN ?? "",
      },
      {
        type: "text",
        name: "TELEGRAM_WEBHOOK_SECRET",
        message:
          "Webhook secret token (optional — a random string Telegram sends to verify requests):",
        initial: existing.TELEGRAM_WEBHOOK_SECRET ?? "",
      },
      {
        type: "text",
        name: "TELEGRAM_ADMIN_USER_IDS",
        message:
          "Allowed Telegram user IDs, pipe-separated (e.g. 123456789|987654321). Leave blank to allow everyone:",
        initial: existing.TELEGRAM_ADMIN_USER_IDS ?? "",
      },
    ],
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  return answers;
}

async function main() {
  banner("boop-agent setup");

  console.log(`
What this does:
  1. Configures your Telegram bot token
  2. Asks whether Boop should use your Claude Code or Codex subscription,
     or a custom OpenAI-compatible endpoint
  3. Optionally enables local browser use
  4. Runs \`npx convex dev\` to create a Convex project
  5. Writes .env.local

Before you start:
  • Claude Code subscription if choosing Claude: https://claude.com/code
  • Codex/ChatGPT account if choosing Codex:     run \`codex login\`
  • Convex account (free tier):                  https://convex.dev
  • A Telegram account to create a bot via @BotFather
`);

  const existing = readEnv(ENV_PATH);
  const runtimeDefault = runtimeFromEnv(existing.BOOP_RUNTIME);

  const telegramAnswers = await promptTelegramConfig(existing);

  const answers = await prompts(
    [
      {
        type: "select",
        name: "BOOP_RUNTIME",
        message: "Which subscription should Boop use for the agent runtime?",
        choices: [
          {
            title: "Claude Code subscription",
            value: "claude",
            description: "Uses the Claude Agent SDK and your local `claude` login.",
          },
          {
            title: "Codex / ChatGPT subscription",
            value: "codex",
            description: "Uses local `codex app-server` auth from `codex login`.",
          },
          {
            title: "Custom API (OpenAI-compatible endpoint)",
            value: "custom",
            description:
              "Any OpenAI-compatible HTTP endpoint — Ollama, LM Studio, vLLM, OpenRouter, …",
          },
        ],
        initial:
          runtimeDefault === "codex" ? 1 : runtimeDefault === "custom" ? 2 : 0,
      },
      {
        type: (_prev: unknown, values: Record<string, unknown>) =>
          values.BOOP_RUNTIME === "claude" ? "select" : null,
        name: "BOOP_MODEL",
        message: "Which Claude model should the agent use?",
        choices: CLAUDE_MODEL_CHOICES,
        initial: initialForChoice(CLAUDE_MODEL_CHOICES, existing.BOOP_MODEL),
      },
      {
        type: (_prev: unknown, values: Record<string, unknown>) =>
          values.BOOP_RUNTIME === "codex" ? "select" : null,
        name: "BOOP_CODEX_MODEL",
        message: "Which Codex model should the agent use?",
        choices: CODEX_MODEL_CHOICES,
        initial: initialForChoice(CODEX_MODEL_CHOICES, existing.BOOP_CODEX_MODEL),
      },
      {
        type: (_prev: unknown, values: Record<string, unknown>) =>
          values.BOOP_RUNTIME === "codex" ? "select" : null,
        name: "BOOP_CODEX_REASONING_EFFORT",
        message: "How much Codex reasoning effort should Boop use?",
        choices: CODEX_REASONING_CHOICES,
        initial: initialForChoice(
          CODEX_REASONING_CHOICES,
          existing.BOOP_CODEX_REASONING_EFFORT,
          1,
        ),
      },
      {
        type: (_prev: unknown, values: Record<string, unknown>) =>
          values.BOOP_RUNTIME === "custom" ? "text" : null,
        name: "BOOP_CUSTOM_BASE_URL",
        message: "Base URL of the OpenAI-compatible endpoint:",
        initial: existing.BOOP_CUSTOM_BASE_URL ?? DEFAULT_CUSTOM_BASE_URL,
      },
      {
        type: (_prev: unknown, values: Record<string, unknown>) =>
          values.BOOP_RUNTIME === "custom" ? "text" : null,
        name: "BOOP_CUSTOM_API_KEY",
        message: "API key (optional — local endpoints usually accept any value):",
        initial: existing.BOOP_CUSTOM_API_KEY ?? "",
      },
      {
        type: (_prev: unknown, values: Record<string, unknown>) =>
          values.BOOP_RUNTIME === "custom" ? "text" : null,
        name: "BOOP_CUSTOM_MODEL",
        message: "Model id the endpoint serves (e.g. llama3.1):",
        initial: existing.BOOP_CUSTOM_MODEL ?? "",
        validate: (value: string) =>
          value.trim().length > 0 || "A model id is required for the custom runtime.",
      },
      {
        type: "text",
        name: "PORT",
        message: "Local server port",
        initial: existing.PORT ?? "3456",
      },
      {
        type: "confirm",
        name: "runConvex",
        message: "Run `convex dev` now to configure your Convex deployment?",
        initial: true,
      },
    ],
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  // Merge prompted defaults with what the user answered (answer wins).
  Object.assign(answers, telegramAnswers, {
    BOOP_RUNTIME: answers.BOOP_RUNTIME ?? runtimeDefault,
    BOOP_MODEL: answers.BOOP_MODEL ?? existing.BOOP_MODEL ?? DEFAULT_CLAUDE_MODEL,
    BOOP_CODEX_MODEL:
      answers.BOOP_CODEX_MODEL ?? existing.BOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    BOOP_CODEX_REASONING_EFFORT:
      answers.BOOP_CODEX_REASONING_EFFORT ??
      existing.BOOP_CODEX_REASONING_EFFORT ??
      DEFAULT_CODEX_REASONING_EFFORT,
    BOOP_CUSTOM_BASE_URL:
      answers.BOOP_CUSTOM_BASE_URL ??
      existing.BOOP_CUSTOM_BASE_URL ??
      DEFAULT_CUSTOM_BASE_URL,
    BOOP_CUSTOM_API_KEY:
      answers.BOOP_CUSTOM_API_KEY ?? existing.BOOP_CUSTOM_API_KEY ?? "",
    BOOP_CUSTOM_MODEL:
      answers.BOOP_CUSTOM_MODEL ?? existing.BOOP_CUSTOM_MODEL ?? "",
  });

  // ---- Composio API key ---------------------------------------------------
  banner("Composio — integrations (Gmail, Slack, GitHub, Linear, 1000+ more)");
  const composioSettingsUrl = "https://platform.composio.dev/settings";
  const existingComposio = existing.COMPOSIO_API_KEY ?? "";
  const { composioMode } = await prompts(
    {
      type: "select",
      name: "composioMode",
      message: existingComposio
        ? "Composio API key detected. Keep it or replace?"
        : "Configure Composio now? (needed to connect any integration)",
      choices: existingComposio
        ? [
            { title: "Keep existing key", value: "keep" },
            { title: "Replace (opens the Composio dashboard)", value: "replace" },
            { title: "Skip", value: "skip" },
          ]
        : [
            { title: "Yes — open the Composio dashboard and paste my key", value: "replace" },
            { title: "Skip for now", value: "skip" },
          ],
      initial: 0,
    },
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  if (composioMode === "replace") {
    console.log(`\nOpening ${composioSettingsUrl} — grab your API key there.`);
    console.log(`(If the browser doesn't open, copy the URL above.)\n`);
    openInBrowser(composioSettingsUrl);
    const { COMPOSIO_API_KEY } = await prompts(
      {
        type: "password",
        name: "COMPOSIO_API_KEY",
        message: "Paste your Composio API key (leave blank to skip):",
        initial: "",
      },
      {
        onCancel: () => {
          console.log("Setup cancelled.");
          process.exit(1);
        },
      },
    );
    (answers as any).COMPOSIO_API_KEY = COMPOSIO_API_KEY || existingComposio;
  } else if (composioMode === "keep") {
    (answers as any).COMPOSIO_API_KEY = existingComposio;
  } else {
    (answers as any).COMPOSIO_API_KEY = existingComposio;
    console.log(
      `\nSkipped. Add COMPOSIO_API_KEY to .env.local later to enable integrations.`,
    );
  }

  // ---- Embedding provider --------------------------------------------------
  banner("Memory search — embedding provider");
  const existingVoyage = existing.VOYAGE_API_KEY ?? "";
  const existingOpenai = existing.OPENAI_API_KEY ?? "";
  const inferredCurrent = existingVoyage
    ? "voyage"
    : existingOpenai
      ? "openai"
      : "local";
  console.log(`
Boop's recall() searches your stored memories by semantic similarity. Pick
how you want to generate embeddings:

  • Local  — free, runs in-process via @huggingface/transformers
            (Xenova/bge-large-en-v1.5, 1024-dim). First run downloads
            ~1.3GB and caches in Boop's local data folder. No API key.
  • Voyage — paid, ~$0.06/M tokens. Slightly stronger English retrieval.
  • OpenAI — paid, ~$0.13/M tokens. Comparable to Voyage.

All three produce 1024-dim vectors (compatible with the same Convex index)
so you can switch later by adding/removing the API key.
`);
  const { embeddingProvider } = await prompts(
    {
      type: "select",
      name: "embeddingProvider",
      message: "Which embedding provider should boop use?",
      choices: [
        { title: "Local (free, recommended)", value: "local" },
        { title: "Voyage (paid — I have a key)", value: "voyage" },
        { title: "OpenAI (paid — I have a key)", value: "openai" },
      ],
      initial:
        inferredCurrent === "voyage" ? 1 : inferredCurrent === "openai" ? 2 : 0,
    },
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  if (embeddingProvider === "voyage") {
    const { VOYAGE_API_KEY } = await prompts({
      type: "password",
      name: "VOYAGE_API_KEY",
      message: "Paste your Voyage API key (https://dash.voyageai.com):",
      initial: existingVoyage,
    });
    (answers as any).VOYAGE_API_KEY = VOYAGE_API_KEY || "";
    (answers as any).OPENAI_API_KEY = "";
  } else if (embeddingProvider === "openai") {
    const { OPENAI_API_KEY } = await prompts({
      type: "password",
      name: "OPENAI_API_KEY",
      message: "Paste your OpenAI API key:",
      initial: existingOpenai,
    });
    (answers as any).OPENAI_API_KEY = OPENAI_API_KEY || "";
    (answers as any).VOYAGE_API_KEY = "";
  } else {
    // Local — clear any stale paid keys so embeddings.ts falls through to
    // the local provider on next start.
    (answers as any).VOYAGE_API_KEY = "";
    (answers as any).OPENAI_API_KEY = "";

    const { preload } = await prompts({
      type: "confirm",
      name: "preload",
      message:
        "Pre-download the local model now? (~1.3GB — saves the wait on first recall)",
      initial: true,
    });
    if (preload) {
      console.log("\nDownloading Xenova/bge-large-en-v1.5… (Ctrl+C to skip)\n");
      try {
        const tsx = packageCommand("tsx", "tsx");
        await runInherit(tsx.cmd, [...tsx.leading, "scripts/preload-embeddings.ts"]);
        console.log("✓ Local model cached.");
      } catch (err) {
        console.warn(
          "Preload failed — model will download on first recall instead.",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // ---- Local browser use ---------------------------------------------------
  banner("Local browser use — optional");
  console.log(`
Boop can optionally expose a local Patchright Chrome profile to spawned agents.
Use it for login-required services, visual browser workflows, or sites that
reject ordinary automation. It is off by default, and agents cannot see or use
the browser integration unless you enable it.
`);

  const { enableLocalBrowser } = await prompts(
    {
      type: "confirm",
      name: "enableLocalBrowser",
      message: "Enable Local browser use now?",
      initial: existing.BOOP_BROWSER_ENABLED === "true",
    },
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );
  (answers as any).BOOP_BROWSER_ENABLED = enableLocalBrowser ? "true" : "false";

  if (enableLocalBrowser) {
    const { installBrowser } = await prompts(
      {
        type: "confirm",
        name: "installBrowser",
        message: "Install the Patchright Chrome browser binary now?",
        initial: false,
      },
      {
        onCancel: () => {
          console.log("Setup cancelled.");
          process.exit(1);
        },
      },
    );
    if (installBrowser) {
      console.log("\nInstalling Patchright Chrome… (Ctrl+C to skip)\n");
      try {
        const patchright = packageCommand("patchright", "patchright");
        await runInherit(patchright.cmd, [...patchright.leading, "install", "chrome"]);
        console.log("✓ Patchright Chrome installed.");
      } catch (err) {
        console.warn(
          "Patchright Chrome install failed — you can retry from Settings later.",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // ---- Tunnel configuration ------------------------------------------------
  banner("Tunnel — public URL for Telegram to reach your server");
  console.log(`
ngrok's FREE plan gives you a NEW public URL every restart. Boop
auto-registers it with Telegram on each \`npm run dev\`, so this is fine for
testing. For a stable URL, pick one of:

  1. Free ngrok             (fine for testing / demos — auto-registered each restart)
  2. ngrok RESERVED domain  (paid — stays the same across restarts)
  3. Cloudflare Tunnel / other static tunnel you set up yourself
`);

  const { tunnelChoice } = await prompts(
    {
      type: "select",
      name: "tunnelChoice",
      message: "Which option are you using?",
      choices: [
        { title: "Free ngrok — I'll paste a new URL each restart", value: "free" },
        { title: "ngrok reserved domain (paid)", value: "ngrok-domain" },
        { title: "Cloudflare Tunnel or another stable URL", value: "static" },
      ],
      initial: 0,
    },
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  if (tunnelChoice === "ngrok-domain") {
    const { NGROK_DOMAIN } = await prompts({
      type: "text",
      name: "NGROK_DOMAIN",
      message: "Your ngrok reserved domain (e.g. boop.ngrok.app, no https://):",
      initial: existing.NGROK_DOMAIN ?? "",
    });
    const clean = (NGROK_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (clean) {
      (answers as any).NGROK_DOMAIN = clean;
      (answers as any).PUBLIC_URL = `https://${clean}`;
    }
  } else if (tunnelChoice === "static") {
    const { PUBLIC_URL } = await prompts({
      type: "text",
      name: "PUBLIC_URL",
      message: "Your stable public URL (e.g. https://boop.mydomain.com):",
      initial: existing.PUBLIC_URL ?? "",
    });
    if (PUBLIC_URL) {
      (answers as any).PUBLIC_URL = PUBLIC_URL.replace(/\/$/, "");
      (answers as any).NGROK_DOMAIN = "";
    }
  } else {
    // free ngrok — clear any stale domain and keep PUBLIC_URL at the localhost default
    (answers as any).NGROK_DOMAIN = "";
  }

  const env: Record<string, string> = { ...existing, ...answers };
  delete (env as any).runConvex;
  if (!env.PUBLIC_URL) env.PUBLIC_URL = `http://localhost:${env.PORT ?? "3456"}`;
  // Clear stale / stub Convex values so `convex dev` can populate them freshly.
  // (`convex dev` uses .convex/ to identify the deployment, not these env vars.)
  if (env.CONVEX_URL?.includes("example.convex.cloud")) delete env.CONVEX_URL;
  if (env.VITE_CONVEX_URL?.includes("example.convex.cloud")) delete env.VITE_CONVEX_URL;
  writeEnv(ENV_PATH, env);

  if (env.BOOP_RUNTIME === "codex") {
    const codexInstalled = await hasBinary("codex");
    banner("Codex authentication");
    console.log(`This project uses your Codex / ChatGPT subscription through local Codex auth — no OpenAI API key needed.

If you haven't already:
  • Install Codex CLI:  npm install -g @openai/codex
  • Run once:           codex login
  • Sign in when prompted

Boop reads the Codex credentials saved on disk. Set BOOP_CODEX_AUTH_HOME in
.env.local only if you need Boop to read a different Codex home containing
auth.json.

${codexInstalled ? "✓ Codex CLI found on PATH." : "⚠ Codex CLI was not found on PATH. Install it before running `npm run dev`."}
`);
  } else if (env.BOOP_RUNTIME === "custom") {
    banner("Custom endpoint check");
    // Best-effort, non-blocking reachability probe — setup never fails on this.
    const baseUrl = (env.BOOP_CUSTOM_BASE_URL ?? DEFAULT_CUSTOM_BASE_URL).replace(/\/$/, "");
    const probeController = new AbortController();
    const probeTimeout = setTimeout(() => probeController.abort(), 3000);
    let probeStatus: string;
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: env.BOOP_CUSTOM_API_KEY
          ? { Authorization: `Bearer ${env.BOOP_CUSTOM_API_KEY}` }
          : {},
        signal: probeController.signal,
      });
      probeStatus = res.ok
        ? `✓ Endpoint responded at ${baseUrl}/models.`
        : `⚠ Endpoint responded with HTTP ${res.status} at ${baseUrl}/models — check BOOP_CUSTOM_BASE_URL/BOOP_CUSTOM_API_KEY.`;
    } catch {
      probeStatus = `⚠ Could not reach ${baseUrl}/models. Start your server (Ollama, LM Studio, …) before running \`npm run dev\`.`;
    } finally {
      clearTimeout(probeTimeout);
    }
    console.log(`Boop will call your OpenAI-compatible endpoint directly over HTTP — no CLI to install.

  • Base URL: ${baseUrl}
  • Model:    ${env.BOOP_CUSTOM_MODEL || "(not set — BOOP_CUSTOM_MODEL is required)"}

${probeStatus}
`);
  } else {
    const claudeInstalled = await hasBinary("claude");
    banner("Claude authentication");
    console.log(`This project uses your Claude Code subscription — no Anthropic API key needed.

If you haven't already:
  • Install Claude Code:  npm install -g @anthropic-ai/claude-code
  • Run once:              claude
  • Sign in when prompted

The Claude Agent SDK reads the credentials Claude Code saves on disk.
You can override with ANTHROPIC_API_KEY in .env.local if you'd rather use an API key.

${claudeInstalled ? "✓ Claude Code found on PATH." : "⚠ Claude Code was not found on PATH. Install it before running `npm run dev`."}
`);
  }

  if (answers.runConvex) {
    await runConvexDev();
    const after = readEnv(ENV_PATH);

    // VITE_CONVEX_URL is written to .env.local as part of `convex dev`. The
    // server falls back to it, so avoid writing an active CONVEX_URL too; Convex
    // CLI treats multiple Convex URL env vars as ambiguous.
    const deploymentMatch =
      after.CONVEX_DEPLOYMENT?.match(/^([a-z]+):([\w-]+)/);

    if (deploymentMatch) {
      const url =
        after.VITE_CONVEX_URL ||
        after.CONVEX_URL ||
        `https://${deploymentMatch[2]}.convex.cloud`;
      if (after.VITE_CONVEX_URL !== url || after.CONVEX_URL) {
        writeEnv(ENV_PATH, {
          ...after,
          VITE_CONVEX_URL: url,
        });
        console.log(`\n✓ Synced VITE_CONVEX_URL → ${url}`);
      }
    }
  } else {
    console.log("\nSkipped Convex. Run `npx convex dev` yourself when ready.");
  }

  const port = answers.PORT ?? "3456";
  banner("You're set up. Here's how to actually run it.");
  console.log(`
Before you start: install ngrok (one-time).

  brew install ngrok                           # macOS
  # or download:  https://ngrok.com/download
  ngrok config add-authtoken <your-token>      # free at https://dashboard.ngrok.com

Then run ONE command:

  npm run dev

That starts the server, Convex watcher, debug dashboard, AND ngrok all
together — color-prefixed output so you can tell who's saying what. Once
the tunnel is live, the Telegram webhook is auto-registered and you'll see
a banner with your public URL.

Test it:
  • Open http://localhost:5173 for the debug dashboard (Chat tab works
    without Telegram).
  • Or open your bot on Telegram and send it a message. The agent replies.

Using a stable URL (ngrok reserved domain or Cloudflare Tunnel)?
  Run this once after boot to register the webhook:

    npm run telegram:webhook <your-public-url>/telegram/webhook

Integrations (via Composio):
  1. Set COMPOSIO_API_KEY in .env.local (get one at https://app.composio.dev/developers).
  2. Open the debug dashboard → Connections tab.
  3. Click Connect on any toolkit (Gmail, Slack, GitHub, Linear, Notion, …).
  4. Composio handles OAuth; the toolkit becomes available to the agent.

Local browser use:
  • Off by default unless you enabled it during setup or in Settings.
  • Open the debug dashboard → Settings → Local browser use to toggle it.
  • The Patchright Chrome binary is installed only if you opt in from setup
    or click "Install Patchright Chrome" in the local browser settings.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
