import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "purge-old-rows",
  { hourUTC: 6, minuteUTC: 0 },
  internal.purge.run,
);

export default crons;
