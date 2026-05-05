import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { spawnExecutionAgent } from "./execution-agent.js";
import {
  SKILL_AUTHOR_PERSONA,
  SKILL_LINKEDIN_POST,
  SKILL_STYLE_GUIDE,
  SKILL_TECHNICAL_ACCURACY,
  SKILL_AVOID_AI_WRITING,
  LINKEDIN_QA_CHECKLIST,
  BRIEF_TEMPLATE,
  skillBlock,
} from "./article-skills.js";

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Extracts the article text from the editor agent's output.
 * Expects the format: "<article text>\n==CHANGELOG==\n<change log>"
 * Throws if the extracted text looks like a clarification request rather than a post.
 */
function extractArticleText(editorOutput: string): string {
  const separatorIndex = editorOutput.indexOf("==CHANGELOG==");
  const text = separatorIndex !== -1
    ? editorOutput.slice(0, separatorIndex).trim()
    : editorOutput.trim();

  if (text.length < 80) {
    throw new Error(
      `Editor returned text too short to be a valid LinkedIn post (${text.length} chars). Raw output: ${editorOutput.slice(0, 200)}`,
    );
  }

  return text;
}

export interface ArticlePipelineOptions {
  input: string;
  inputType: "topic" | "research";
  conversationId: string;
  onProgress?: (stage: string, message: string) => void;
}

export interface ArticlePipelineResult {
  draftId: string;
  articleText: string;
}

/**
 * Runs the 4-stage LinkedIn article pipeline:
 * researcher (optional) → briefer → writer → editor
 * Persists state to Convex articles table and saves a draft on completion.
 */
export async function runArticlePipeline(
  opts: ArticlePipelineOptions,
): Promise<ArticlePipelineResult> {
  const articleId = randomId("article");
  const initialStatus = opts.inputType === "research" ? "researching" : "briefing";

  await convex.mutation(api.articles.create, {
    articleId,
    conversationId: opts.conversationId,
    topic: opts.input.slice(0, 200),
    inputType: opts.inputType,
    status: initialStatus,
  });

  let researchOutput: string | undefined;

  if (opts.inputType === "research") {
    opts.onProgress?.("researcher", "Pesquisando e sintetizando as notas...");
    const researchTask = `You are the researcher agent for a LinkedIn article pipeline.
IMPORTANT: All output must be written in English (en-US), regardless of the language of the input.
${skillBlock("AUTHOR PERSONA", SKILL_AUTHOR_PERSONA)}
${skillBlock("TECHNICAL ACCURACY", SKILL_TECHNICAL_ACCURACY)}

MISSION: Given the research notes below, extract and synthesize ideas into an actionable writing plan.

Return EXACTLY this structure:
1) Post angles (3-6 bullets, each with a one-sentence hook)
2) Key concepts (short list + 1-line definitions)
3) Suggested outline (hook → context → main idea → example → takeaways → CTA)
4) Questions for the author (only what's needed to avoid guessing)
5) Assumptions / Needs verification (bullets)

Do not invent facts. Label uncertain claims "Needs verification".

RESEARCH NOTES:
${opts.input}`;

    const result = await spawnExecutionAgent({
      task: researchTask,
      integrations: [],
      conversationId: opts.conversationId,
      name: "article:researcher",
    });
    researchOutput = result.result;

    await convex.mutation(api.articles.update, {
      articleId,
      status: "briefing",
      researchOutput,
    });
    opts.onProgress?.("briefer", "Criando o brief estruturado...");
  } else {
    opts.onProgress?.("briefer", "Criando o brief estruturado...");
  }

  const briefTask = `You are the briefer agent for a LinkedIn article pipeline.
IMPORTANT: All output must be written in English (en-US), regardless of the language of the input.
${skillBlock("AUTHOR PERSONA", SKILL_AUTHOR_PERSONA)}
${skillBlock("LINKEDIN POST FORMAT", SKILL_LINKEDIN_POST)}
${skillBlock("TECHNICAL ACCURACY", SKILL_TECHNICAL_ACCURACY)}

BRIEF TEMPLATE (your output must follow this structure):
${BRIEF_TEMPLATE}

MISSION: Create a high-quality article brief from the input below.
- Choose one best angle.
- Make the outline tight (one main idea).
- Include a concrete example idea.
- Label uncertain claims "Needs verification".

INPUT:
${researchOutput ?? opts.input}

Return the full brief text conforming to the template above.`;

  const briefResult = await spawnExecutionAgent({
    task: briefTask,
    integrations: [],
    conversationId: opts.conversationId,
    name: "article:briefer",
  });
  const briefOutput = briefResult.result;

  await convex.mutation(api.articles.update, {
    articleId,
    status: "writing",
    briefOutput,
  });
  opts.onProgress?.("writer", "Redigindo o post...");

  const writerTask = `You are the writer agent for a LinkedIn article pipeline.
IMPORTANT: All output must be written in English (en-US), regardless of the language of the input.
${skillBlock("AUTHOR PERSONA", SKILL_AUTHOR_PERSONA)}
${skillBlock("STYLE GUIDE", SKILL_STYLE_GUIDE)}
${skillBlock("LINKEDIN POST FORMAT", SKILL_LINKEDIN_POST)}

MISSION: Write a first draft LinkedIn technical post from the brief below.
- Write in en-US.
- Output must be LinkedIn-ready: strong hook, short paragraphs, clear takeaways.
- Do NOT invent data, benchmarks, or quotes. Mark anything uncertain as "Needs verification".
- Return ONLY the post text (no commentary, no file paths).

BRIEF:
${briefOutput}`;

  const writerResult = await spawnExecutionAgent({
    task: writerTask,
    integrations: [],
    conversationId: opts.conversationId,
    name: "article:writer",
  });
  const draftOutput = writerResult.result;

  await convex.mutation(api.articles.update, {
    articleId,
    status: "editing",
    draftOutput,
  });
  opts.onProgress?.("editor", "Revisando e fazendo QA final...");

  const editorTask = `You are the editor agent for a LinkedIn article pipeline.
IMPORTANT: All output must be written in English (en-US), regardless of the language of the input.
${skillBlock("AUTHOR PERSONA", SKILL_AUTHOR_PERSONA)}
${skillBlock("STYLE GUIDE", SKILL_STYLE_GUIDE)}
${skillBlock("AVOID AI WRITING", SKILL_AVOID_AI_WRITING)}

QA CHECKLIST (apply all items before returning):
${LINKEDIN_QA_CHECKLIST}

MISSION: Edit the draft below for clarity, accuracy, and flow. Then QA it against the checklist.
- Preserve the author's intent and technical meaning.
- Do NOT add unverifiable claims.
- CRITICAL: Remove ALL em dashes (— and --) from the text. Replace with commas, periods, or rewrite as two sentences.
- CRITICAL: NEVER ask for clarification or more input. Work with what you have.
- Return the final post text, then the exact separator line "==CHANGELOG==" on its own line, then a brief change log.

DRAFT:
${draftOutput}`;

  const editorResult = await spawnExecutionAgent({
    task: editorTask,
    integrations: [],
    conversationId: opts.conversationId,
    name: "article:editor",
  });
  const editorOutput = editorResult.result;

  const articleText = extractArticleText(editorOutput);

  const draftId = randomId("draft");
  await convex.mutation(api.drafts.create, {
    draftId,
    conversationId: opts.conversationId,
    kind: "linkedin.post",
    summary: `LinkedIn post: ${articleText.slice(0, 80)}…`,
    payload: JSON.stringify({ text: articleText }),
  });

  await convex.mutation(api.articles.update, {
    articleId,
    status: "draft_ready",
    editorOutput,
    draftId,
  });

  return { draftId, articleText };
}

/**
 * Revises an existing LinkedIn draft with targeted instructions, running only
 * the editor + QA stage. Rejects the old draft and saves a new one.
 */
export async function reviseArticleDraft(opts: {
  draftId: string;
  instructions: string;
  conversationId: string;
  onProgress?: (stage: string, message: string) => void;
}): Promise<{ draftId: string; articleText: string }> {
  const draft = await convex.query(api.drafts.get, { draftId: opts.draftId });
  if (!draft || draft.status !== "pending") {
    throw new Error(`Draft ${opts.draftId} not found or already decided.`);
  }

  const { text: currentText } = JSON.parse(draft.payload) as { text: string };

  opts.onProgress?.("editor", "Revisando o post com as suas instruções...");

  const editorTask = `You are the editor agent for a LinkedIn article pipeline.
IMPORTANT: All output must be written in English (en-US), regardless of the language of the input.
${skillBlock("AUTHOR PERSONA", SKILL_AUTHOR_PERSONA)}
${skillBlock("STYLE GUIDE", SKILL_STYLE_GUIDE)}
${skillBlock("AVOID AI WRITING", SKILL_AVOID_AI_WRITING)}

QA CHECKLIST (apply all items before returning):
${LINKEDIN_QA_CHECKLIST}

REVISION INSTRUCTIONS (apply these changes to the post):
${opts.instructions}

MISSION: Apply the revision instructions above to the post, then QA the result against the checklist.
- Preserve the author's intent and technical meaning.
- Do NOT add unverifiable claims.
- CRITICAL: Remove ALL em dashes (— and --) from the text. Replace with commas, periods, or rewrite as two sentences.
- CRITICAL: NEVER ask for clarification or more input. Work with what you have.
- Return the final post text, then the exact separator line "==CHANGELOG==" on its own line, then a brief change log.

CURRENT POST:
${currentText}`;

  const editorResult = await spawnExecutionAgent({
    task: editorTask,
    integrations: [],
    conversationId: opts.conversationId,
    name: "article:editor",
  });

  const articleText = extractArticleText(editorResult.result);

  await convex.mutation(api.drafts.setStatus, {
    draftId: opts.draftId,
    status: "rejected",
  });

  const newDraftId = randomId("draft");
  await convex.mutation(api.drafts.create, {
    draftId: newDraftId,
    conversationId: opts.conversationId,
    kind: "linkedin.post",
    summary: `LinkedIn post: ${articleText.slice(0, 80)}…`,
    payload: JSON.stringify({ text: articleText }),
  });

  const article = await convex.query(api.articles.listByConversation, {
    conversationId: opts.conversationId,
  });
  const latest = article.find((a) => a.draftId === opts.draftId);
  if (latest) {
    await convex.mutation(api.articles.update, {
      articleId: latest.articleId,
      editorOutput: editorResult.result,
      draftId: newDraftId,
    });
  }

  return { draftId: newDraftId, articleText };
}

export interface RefineUserPostOptions {
  text: string;
  instructions?: string;
  factCheck?: boolean;
  conversationId: string;
  onProgress?: (stage: string, message: string) => void;
}

/**
 * Refines a finished post pasted by the user. Runs an optional fact-checker
 * stage (using native WebSearch/WebFetch) followed by the editor + QA stage.
 * Preserves the author's voice — does NOT regenerate the post.
 */
export async function refineUserPost(
  opts: RefineUserPostOptions,
): Promise<{ draftId: string; articleText: string }> {
  const factCheck = opts.factCheck ?? true;
  const articleId = randomId("article");

  await convex.mutation(api.articles.create, {
    articleId,
    conversationId: opts.conversationId,
    topic: opts.text.slice(0, 200),
    inputType: "user_post",
    status: factCheck ? "fact_checking" : "editing",
  });

  let factCheckReport: string | undefined;

  if (factCheck) {
    opts.onProgress?.("fact-checker", "Validando os fatos com pesquisa web...");
    const factCheckTask = `You are the fact-checker for a LinkedIn article pipeline.
IMPORTANT: All output must be written in English (en-US).

MISSION: Validate the verifiable claims in the post below using web search.

Use WebSearch and WebFetch to look up: numbers, benchmarks, product names,
API behavior, version compatibility, dates, quotes, citations, names of people/companies.

DO NOT rewrite the post. DO NOT add stylistic feedback. DO NOT ask for clarification.

Return EXACTLY this structure:
1) Verified claims (claim — short note + source URL)
2) Incorrect claims (claim — corrected version + source URL)
3) Unverifiable claims (claim — why it can't be confirmed)
4) Suggested edits for the editor (bullet list, only fact-related; leave style to editor)

If there are no verifiable claims, say so explicitly under each section.

POST:
${opts.text}`;

    const factCheckResult = await spawnExecutionAgent({
      task: factCheckTask,
      integrations: [],
      conversationId: opts.conversationId,
      name: "article:fact-checker",
    });
    factCheckReport = factCheckResult.result;

    await convex.mutation(api.articles.update, {
      articleId,
      status: "editing",
      researchOutput: factCheckReport,
    });
  }

  opts.onProgress?.("editor", "Refinando o post e aplicando QA...");

  const editorTask = `You are the editor agent for a LinkedIn article pipeline.
IMPORTANT: All output must be written in English (en-US), regardless of the language of the input.
${skillBlock("AUTHOR PERSONA", SKILL_AUTHOR_PERSONA)}
${skillBlock("STYLE GUIDE", SKILL_STYLE_GUIDE)}
${skillBlock("AVOID AI WRITING", SKILL_AVOID_AI_WRITING)}

QA CHECKLIST (apply all items before returning):
${LINKEDIN_QA_CHECKLIST}

${factCheckReport
    ? `FACT-CHECK REPORT (apply corrections from "Incorrect claims"; for "Unverifiable" claims, soften wording or add hedging only when needed — do not invent sources):
${factCheckReport}

`
    : ""}REVISION INSTRUCTIONS (optional, from user):
${opts.instructions ?? "(none — just polish the post and apply any fact-check corrections above)"}

MISSION: Refine the user's post below for clarity, accuracy, and flow. Then QA it against the checklist.
- CRITICAL: Preserve the author's voice, structure, and intent. This is THEIR post — do not rewrite it from scratch.
- Apply factual corrections from the fact-check report when present.
- Do NOT add unverifiable claims.
- CRITICAL: Remove ALL em dashes (— and --) from the text. Replace with commas, periods, or rewrite as two sentences.
- CRITICAL: NEVER ask for clarification or more input. Work with what you have.
- Return the final post text, then the exact separator line "==CHANGELOG==" on its own line, then a brief change log.

USER POST:
${opts.text}`;

  const editorResult = await spawnExecutionAgent({
    task: editorTask,
    integrations: [],
    conversationId: opts.conversationId,
    name: "article:editor",
  });
  const editorOutput = editorResult.result;

  const articleText = extractArticleText(editorOutput);

  const draftId = randomId("draft");
  await convex.mutation(api.drafts.create, {
    draftId,
    conversationId: opts.conversationId,
    kind: "linkedin.post",
    summary: `LinkedIn post: ${articleText.slice(0, 80)}…`,
    payload: JSON.stringify({ text: articleText }),
  });

  await convex.mutation(api.articles.update, {
    articleId,
    status: "draft_ready",
    draftOutput: opts.text,
    editorOutput,
    draftId,
  });

  return { draftId, articleText };
}

/**
 * Creates the boop-article MCP server exposing start_article_pipeline,
 * revise_article_draft, and refine_user_post to the dispatcher.
 */
export function createArticlePipelineMcp(
  conversationId: string,
  onProgress: (stage: string, message: string) => void,
) {
  return createSdkMcpServer({
    name: "boop-article",
    version: "0.1.0",
    tools: [
      tool(
        "start_article_pipeline",
        `Run the full LinkedIn article pipeline (researcher → briefer → writer → editor + QA).
Returns a draftId and the final article text after all stages complete. The user must approve via send_draft.
Use for: "write a LinkedIn post about X", "create an article from this research", "draft a post".
Do NOT use for adjustments to an existing draft — use revise_article_draft instead.`,
        {
          input: z
            .string()
            .describe("Either a topic/angle, or raw research notes to synthesize."),
          inputType: z
            .enum(["topic", "research"])
            .describe(
              '"topic" for a single topic or angle; "research" for pasted research notes or URLs.',
            ),
        },
        async (args) => {
          const { draftId, articleText } = await runArticlePipeline({
            input: args.input,
            inputType: args.inputType,
            conversationId,
            onProgress,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Pipeline complete. Draft ID: ${draftId}\n\n${articleText}`,
              },
            ],
          };
        },
      ),

      tool(
        "revise_article_draft",
        `Apply targeted revisions to an existing pending LinkedIn draft, then re-run QA.
Rejects the old draft and returns a new draftId with the revised text.
Use for: "make the hook punchier", "shorten the CTA", "adjust the tone", any tweak to a post already drafted.
Do NOT use for a completely new topic — use start_article_pipeline instead.`,
        {
          draftId: z.string().describe("The pending draft ID to revise."),
          instructions: z
            .string()
            .describe("Specific changes to apply, e.g. 'make the hook more direct and cut the last bullet'."),
        },
        async (args) => {
          const { draftId, articleText } = await reviseArticleDraft({
            draftId: args.draftId,
            instructions: args.instructions,
            conversationId,
            onProgress,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Revision complete. New draft ID: ${draftId}\n\n${articleText}`,
              },
            ],
          };
        },
      ),

      tool(
        "refine_user_post",
        `Refine a finished LinkedIn post the USER pasted in the chat (not one we drafted).
Runs an optional fact-checker (web search) and then the editor + QA stage. Preserves the author's voice — does NOT regenerate the post.
Returns a draftId the user can approve via send_draft.
Use for: "refina esse post que escrevi", "polish this post I wrote", "checa os fatos e ajusta", any case where the user pastes their own finished post and wants polish/fact-check.
Do NOT use start_article_pipeline (that rewrites from scratch).
Do NOT use revise_article_draft (that requires an existing draftId from a draft we created).`,
        {
          text: z.string().describe("The full post text the user wrote."),
          instructions: z
            .string()
            .optional()
            .describe(
              "Optional revision notes from the user (e.g. 'shorten the intro', 'tom mais direto'). Omit if the user just said 'refina'.",
            ),
          factCheck: z
            .boolean()
            .optional()
            .describe(
              "Whether to run web-search fact-checking before editing. Default true. Set false for purely stylistic polish to skip the search cost.",
            ),
        },
        async (args) => {
          const { draftId, articleText } = await refineUserPost({
            text: args.text,
            instructions: args.instructions,
            factCheck: args.factCheck,
            conversationId,
            onProgress,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Refinement complete. Draft ID: ${draftId}\n\n${articleText}`,
              },
            ],
          };
        },
      ),
    ],
  });
}
