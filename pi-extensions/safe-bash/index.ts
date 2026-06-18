import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { matchesAny } from "./rules.ts";

interface BashSafetyRules {
  blocklist: string[];
  allowlist: string[];
  requireConfirmForUnknown: boolean;
}

function loadRules(settingsPath: string): BashSafetyRules {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    return settings.bashSafety ?? { blocklist: [], allowlist: [], requireConfirmForUnknown: true };
  } catch {
    return { blocklist: [], allowlist: [], requireConfirmForUnknown: true };
  }
}

export default function (pi: ExtensionAPI) {
  const settingsPath = join(homedir(), ".pi", "agent", "settings.json");

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command: string = (event.input as { command?: string })?.command ?? "";
    const rules = loadRules(settingsPath);

    if (matchesAny(command, rules.blocklist)) {
      ctx.ui.notify(`Blocked: ${command.slice(0, 80)}`, "error");
      return { block: true, reason: "Command matches blocklist" };
    }

    if (matchesAny(command, rules.allowlist)) {
      return; // pre-approved
    }

    if (rules.requireConfirmForUnknown) {
      const ok = await ctx.ui.confirm(
        "Bash approval required",
        `Allow command:\n\n${command.slice(0, 300)}`
      );
      if (!ok) return { block: true, reason: "User denied" };
    }
  });
}
