import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const purgeOlderThan = mutation({
  args: { olderThanMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs;
    const limit = args.limit ?? 500;
    const rows = await ctx.db
      .query("sendblueDedup")
      .filter((q) => q.lt(q.field("claimedAt"), cutoff))
      .take(limit);
    let deleted = 0;
    for (const r of rows) {
      await ctx.db.delete(r._id);
      deleted++;
    }
    return { deleted, scanned: rows.length };
  },
});

export const claim = mutation({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sendblueDedup")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();
    if (existing) return { claimed: false };
    await ctx.db.insert("sendblueDedup", {
      handle: args.handle,
      claimedAt: Date.now(),
    });
    return { claimed: true };
  },
});
