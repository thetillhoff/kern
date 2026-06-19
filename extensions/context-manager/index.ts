import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendCompactionLog } from "./logger.ts";

export default function (pi: ExtensionAPI) {
  const logPath = join(homedir(), ".pi", "compaction.jsonl");

  pi.on("session_before_compact", async (_event, ctx) => {
    const usage = ctx.getContextUsage() as { total?: number; limit?: number | null } | null;
    const tokensBefore = usage?.total ?? 0;
    const tokensLimit = usage?.limit ?? 0;
    const pct = tokensLimit > 0 ? Math.round((tokensBefore / tokensLimit) * 100) : 0;

    ctx.ui.notify(`Compacting context (${pct}% full, ${tokensBefore.toLocaleString()} tokens)`, "info");

    appendCompactionLog(logPath, {
      ts: new Date().toISOString(),
      session: ctx.sessionManager.getBranch() ?? "unknown",
      tokensBefore,
      tokensLimit,
      trigger: "auto",
    });
  });
}
