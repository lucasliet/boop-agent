import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const emit = mutation({
  args: {
    eventType: v.string(),
    conversationId: v.optional(v.string()),
    memoryId: v.optional(v.string()),
    agentId: v.optional(v.string()),
    data: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("memoryEvents", { ...args, createdAt: Date.now() });
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query("memoryEvents").order("desc").take(args.limit ?? 100);
  },
});

export const byConversation = query({
  args: { conversationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("memoryEvents")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const purgeOlderThan = mutation({
  args: { olderThanMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs;
    const limit = args.limit ?? 500;
    const rows = await ctx.db
      .query("memoryEvents")
      .filter((q) => q.lt(q.field("createdAt"), cutoff))
      .take(limit);
    let deleted = 0;
    for (const r of rows) {
      await ctx.db.delete(r._id);
      deleted++;
    }
    return { deleted, scanned: rows.length };
  },
});
