import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";

const DAY = 86_400_000;

const TARGETS: Array<{ table: string; fn: any; olderThanMs: number }> = [
  { table: "messages",          fn: api.messages.purgeOlderThan,               olderThanMs:  90 * DAY },
  { table: "memoryEvents",      fn: api.memoryEvents.purgeOlderThan,           olderThanMs:  14 * DAY },
  { table: "usageRecords",      fn: api.usageRecords.purgeOlderThan,           olderThanMs: 180 * DAY },
  { table: "executionAgents",   fn: api.agents.purgeAgentsOlderThan,           olderThanMs:  30 * DAY },
  { table: "agentLogs",         fn: api.agents.purgeLogsOlderThan,             olderThanMs:  14 * DAY },
  { table: "automationRuns",    fn: api.automations.purgeRunsOlderThan,        olderThanMs:  30 * DAY },
  { table: "articles",          fn: api.articles.purgeOlderThan,               olderThanMs:  30 * DAY },
  { table: "consolidationRuns", fn: api.consolidation.purgeRunsOlderThan,      olderThanMs:  30 * DAY },
  { table: "drafts",            fn: api.drafts.purgeOlderThan,                 olderThanMs:   7 * DAY },
  { table: "sendblueDedup",     fn: api.sendblueDedup.purgeOlderThan,          olderThanMs:   7 * DAY },
  { table: "memoryRecords",     fn: api.memoryRecords.purgeInactiveOlderThan,  olderThanMs:  30 * DAY },
];

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ deletedByTable: Record<string, number> }> => {
    const deletedByTable: Record<string, number> = {};
    for (const t of TARGETS) {
      try {
        const r = await ctx.runMutation(t.fn, { olderThanMs: t.olderThanMs });
        deletedByTable[t.table] = r.deleted;
      } catch (err) {
        console.error(`[purge] ${t.table} failed`, err);
        deletedByTable[t.table] = -1;
      }
    }
    return { deletedByTable };
  },
});
