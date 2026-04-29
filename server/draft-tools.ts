import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { spawnExecutionAgent } from "./execution-agent.js";
import { consumePendingImage } from "./pending-images.js";

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Drafts MCP for EXECUTION agents. They use this to stage an action instead of
 * performing it directly.
 */
export function createDraftStagingMcp(conversationId: string) {
  return createSdkMcpServer({
    name: "boop-drafts",
    version: "0.1.0",
    tools: [
      tool(
        "save_draft",
        `Save a draft of an external action (email, calendar event, message, etc.) for the user to review.
ALWAYS call this instead of sending or creating something directly. The user will say "send it" in the next turn to commit.

- summary: one-line description the user will see.
- payload: JSON string with everything needed to execute the draft (provider-specific fields).
- kind: short type tag like "gmail.reply", "gmail.new", "gcal.event", "slack.message".`,
        {
          kind: z.string(),
          summary: z.string(),
          payload: z.string().describe("JSON string with the data needed to execute."),
        },
        async (args) => {
          const draftId = randomId("draft");
          await convex.mutation(api.drafts.create, {
            draftId,
            conversationId,
            kind: args.kind,
            summary: args.summary,
            payload: args.payload,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Draft saved as ${draftId}. Surface the summary to the user and ask them to confirm "send" or "cancel".`,
              },
            ],
          };
        },
      ),
    ],
  });
}

function buildLinkedInPostTask(draft: { payload: string; summary: string }, imageUrl?: string): string {
  const { text } = JSON.parse(draft.payload) as { text: string };
  if (!text || text.trim().length < 80) {
    throw new Error(
      `linkedin.post draft payload has no valid text (got ${text?.length ?? 0} chars). Reject this draft and re-run the pipeline.`,
    );
  }

  const confirmationInstruction = `After posting, return the full post URL in this format:
https://www.linkedin.com/feed/update/{urn}/
where {urn} is the post ID returned by the tool (e.g. urn:li:share:1234567890).`;

  if (imageUrl) {
    return `Post this article to LinkedIn with an image using the LinkedIn toolkit.

The full post text and image URL are below. Post exactly as written — do not paraphrase, summarize, or ask for clarification.

POST TEXT:
${text.trim()}

IMAGE URL:
${imageUrl}

Steps:
1. Use the LinkedIn toolkit to create a post with media. Upload the image from the URL above (use the image upload tool if available, or pass the URL directly).
2. Attach the post text to the media post.
3. Do not modify the text or add hashtags unless already present.
4. ${confirmationInstruction}`;
  }

  return `Post this article to LinkedIn using the LinkedIn toolkit.

The full post text is below. Post it exactly as written — do not paraphrase, summarize, or ask for clarification.

POST TEXT:
${text.trim()}

Steps:
1. Use LINKEDIN_CREATE_TEXT_POST or equivalent tool with the text above.
2. Do not modify the text or add hashtags unless already present.
3. ${confirmationInstruction}`;
}

/**
 * Drafts MCP for the INTERACTION agent. Lets it review and approve drafts the user confirmed.
 */
export function createDraftDecisionMcp(conversationId: string) {
  return createSdkMcpServer({
    name: "boop-draft-decisions",
    version: "0.1.0",
    tools: [
      tool(
        "list_drafts",
        "List pending drafts in this conversation. Call this when the user says 'send it', 'yes', 'go ahead', etc. without a specific id.",
        {},
        async () => {
          const drafts = await convex.query(api.drafts.pendingByConversation, {
            conversationId,
          });
          if (drafts.length === 0) {
            return { content: [{ type: "text" as const, text: "No pending drafts." }] };
          }
          const body = drafts
            .map((d) => `• [${d.draftId}] (${d.kind}) ${d.summary}`)
            .join("\n");
          return { content: [{ type: "text" as const, text: body }] };
        },
      ),

      tool(
        "send_draft",
        "Approve and execute a draft. Spawns an execution agent to actually perform the action based on the stored payload.",
        { draftId: z.string(), integrations: z.array(z.string()) },
        async (args) => {
          const draft = await convex.query(api.drafts.get, { draftId: args.draftId });
          if (!draft || draft.status !== "pending") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Draft ${args.draftId} not found or already decided.`,
                },
              ],
            };
          }
          await convex.mutation(api.drafts.setStatus, {
            draftId: args.draftId,
            status: "sent",
          });
          const pendingImageUrl =
            draft.kind === "linkedin.post" ? consumePendingImage(conversationId) : undefined;
          const task =
            draft.kind === "linkedin.post"
              ? buildLinkedInPostTask(draft, pendingImageUrl)
              : `Execute this approved draft. Use the matching integration tool to actually send/create it.
kind: ${draft.kind}
summary: ${draft.summary}
payload JSON: ${draft.payload}`;
          const effectiveIntegrations =
            draft.kind === "linkedin.post"
              ? ["linkedin", ...args.integrations]
              : args.integrations;
          const res = await spawnExecutionAgent({
            task,
            integrations: effectiveIntegrations,
            conversationId,
            name: `send:${draft.kind}`,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Draft ${args.draftId} executed.\n\n${res.result}`,
              },
            ],
          };
        },
      ),

      tool(
        "reject_draft",
        "Cancel a pending draft when the user says 'no', 'cancel', or revises the request.",
        { draftId: z.string() },
        async (args) => {
          await convex.mutation(api.drafts.setStatus, {
            draftId: args.draftId,
            status: "rejected",
          });
          return {
            content: [{ type: "text" as const, text: `Draft ${args.draftId} rejected.` }],
          };
        },
      ),
    ],
  });
}
