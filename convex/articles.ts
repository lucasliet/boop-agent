import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const statusV = v.union(
  v.literal("researching"),
  v.literal("fact_checking"),
  v.literal("briefing"),
  v.literal("writing"),
  v.literal("editing"),
  v.literal("draft_ready"),
  v.literal("posted"),
);

export const create = mutation({
  args: {
    articleId: v.string(),
    conversationId: v.string(),
    topic: v.string(),
    inputType: v.union(
      v.literal("topic"),
      v.literal("research"),
      v.literal("user_post"),
    ),
    status: statusV,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("articles", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    articleId: v.string(),
    status: v.optional(statusV),
    researchOutput: v.optional(v.string()),
    briefOutput: v.optional(v.string()),
    draftOutput: v.optional(v.string()),
    editorOutput: v.optional(v.string()),
    draftId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { articleId, ...fields } = args;
    const article = await ctx.db
      .query("articles")
      .withIndex("by_article_id", (q) => q.eq("articleId", articleId))
      .unique();
    if (!article) return null;
    await ctx.db.patch(article._id, { ...fields, updatedAt: Date.now() });
    return article;
  },
});

export const get = query({
  args: { articleId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("articles")
      .withIndex("by_article_id", (q) => q.eq("articleId", args.articleId))
      .unique();
  },
});

export const purgeOlderThan = mutation({
  args: { olderThanMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs;
    const limit = args.limit ?? 500;
    const rows = await ctx.db
      .query("articles")
      .filter((q) => q.lt(q.field("createdAt"), cutoff))
      .take(limit);
    let deleted = 0;
    for (const r of rows) {
      if (r.status !== "posted") continue;
      await ctx.db.delete(r._id);
      deleted++;
    }
    return { deleted, scanned: rows.length };
  },
});

export const listByConversation = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("articles")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(20);
  },
});
