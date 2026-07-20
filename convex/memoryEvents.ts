import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { DEMO_SCAN_LIMIT, isDemoId, isDemoMemoryEvent, isDemoModeEnabled } from "./demoMode";

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

async function readRecent(
  ctx: QueryCtx,
  limit: number,
  demoOnly: boolean,
) {
  const rows = await ctx.db
    .query("memoryEvents")
    .order("desc")
    .take(DEMO_SCAN_LIMIT);
  return rows.filter((event) => isDemoMemoryEvent(event) === demoOnly).slice(0, limit);
}

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => readRecent(ctx, args.limit ?? 100, false),
});

export const recentForDashboard = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return readRecent(ctx, limit, await isDemoModeEnabled(ctx));
  },
});

export const byConversation = query({
  args: { conversationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (isDemoId(args.conversationId)) return [];
    return await ctx.db
      .query("memoryEvents")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit ?? 100);
  },
});

export const byConversationForDashboard = query({
  args: { conversationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (isDemoId(args.conversationId) !== (await isDemoModeEnabled(ctx))) return [];
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
