import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyRules, estimateTokens, type RoutingRule } from "./rules.ts";
import { callClassifier } from "./classifier.ts";
import { appendDecision } from "./logger.ts";

interface RouterConfig {
  rules: RoutingRule[];
  classifierUrl: string | null;
  classifierTimeoutMs: number;
  defaultModel: string | null;
  models: Record<string, string>;
}

function loadConfig(rulesPath: string): RouterConfig {
  if (!existsSync(rulesPath)) {
    return { rules: [], classifierUrl: null, classifierTimeoutMs: 2000, defaultModel: null, models: {} };
  }
  try {
    return JSON.parse(readFileSync(rulesPath, "utf-8")) as RouterConfig;
  } catch {
    return { rules: [], classifierUrl: null, classifierTimeoutMs: 2000, defaultModel: null, models: {} };
  }
}

export default function (pi: ExtensionAPI) {
  const rulesPath = join(homedir(), ".pi", "model-rules.json");
  const logPath = join(homedir(), ".pi", "model-decisions.jsonl");

  pi.on("before_agent_start", async (event, ctx) => {
    const config = loadConfig(rulesPath);
    const rawEvent = event as unknown as { messages?: Array<{ role: string; content?: string }> };
    const messages = rawEvent.messages ?? [];
    const lastMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const tokenCount = estimateTokens(messages);
    const start = Date.now();

    const session = ctx.sessionManager.getBranch() ?? "unknown";

    async function setModelByName(modelName: string): Promise<void> {
      const model = ctx.modelRegistry.find(undefined as unknown as string, modelName);
      if (model) await pi.setModel(model);
    }

    // Tier 1: rule-based fast path
    const ruleTier = applyRules(lastMessage, tokenCount, config.rules ?? []);
    if (ruleTier) {
      const modelName = config.models?.[ruleTier] ?? config.defaultModel;
      if (modelName) await setModelByName(modelName);
      appendDecision(logPath, {
        ts: new Date().toISOString(),
        session,
        tier: ruleTier,
        model: modelName ?? "unknown",
        reason: "rule",
        rule: ruleTier,
        latencyMs: Date.now() - start,
      });
      return;
    }

    // Tier 2: classifier (Python router)
    if (config.classifierUrl) {
      const tier = await callClassifier(config.classifierUrl, messages, config.classifierTimeoutMs ?? 2000);
      if (tier) {
        const modelName = config.models?.[tier] ?? config.defaultModel;
        if (modelName) await setModelByName(modelName);
        appendDecision(logPath, {
          ts: new Date().toISOString(),
          session,
          tier,
          model: modelName ?? "unknown",
          reason: "classifier",
          latencyMs: Date.now() - start,
        });
        return;
      }
    }

    // Tier 3: default — no model change; Pi uses whatever is configured
    appendDecision(logPath, {
      ts: new Date().toISOString(),
      session,
      tier: "default",
      model: config.defaultModel ?? (ctx.model as { id?: string } | null)?.id ?? "unknown",
      reason: "default",
      latencyMs: Date.now() - start,
    });
  });
}
