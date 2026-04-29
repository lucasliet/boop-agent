import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const statusV = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

export const createRun = mutation({
  args: { runId: v.string(), trigger: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("consolidationRuns", {
      ...args,
      status: "running",
      proposalsCount: 0,
      mergedCount: 0,
      prunedCount: 0,
      startedAt: Date.now(),
    });
  },
});

export const updateRun = mutation({
  args: {
    runId: v.string(),
    status: v.optional(statusV),
    proposalsCount: v.optional(v.number()),
    mergedCount: v.optional(v.number()),
    prunedCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { runId, ...patch } = args;
    const run = await ctx.db
      .query("consolidationRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", runId))
      .unique();
    if (!run) return null;
    const done = patch.status && patch.status !== "running";
    await ctx.db.patch(run._id, { ...patch, ...(done ? { completedAt: Date.now() } : {}) });
    return run._id;
  },
});

export const listRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query("consolidationRuns").order("desc").take(args.limit ?? 25);
  },
});

export const purgeRunsOlderThan = mutation({
  args: { olderThanMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs;
    const limit = args.limit ?? 500;
    const rows = await ctx.db
      .query("consolidationRuns")
      .filter((q) => q.lt(q.field("startedAt"), cutoff))
      .take(limit);
    let deleted = 0;
    for (const r of rows) {
      if (!["completed", "failed"].includes(r.status)) continue;
      await ctx.db.delete(r._id);
      deleted++;
    }
    return { deleted, scanned: rows.length };
  },
});
