import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyRules, estimateTokens, type RoutingRule } from "./rules.ts";
import { callOllama } from "./classifier.ts";
import { appendDecision } from "./logger.ts";

interface RouterConfig {
  rules: RoutingRule[];
  ollamaUrl: string | null;
  ollamaModel: string | null;
  classifierTimeoutMs: number;
  defaultModel: string | null;
  models: Record<string, string>;
}

function loadConfig(rulesPath: string): RouterConfig {
  if (!existsSync(rulesPath)) {
    return { rules: [], ollamaUrl: null, ollamaModel: null, classifierTimeoutMs: 2000, defaultModel: null, models: {} };
  }
  try {
    return JSON.parse(readFileSync(rulesPath, "utf-8")) as RouterConfig;
  } catch {
    return { rules: [], ollamaUrl: null, ollamaModel: null, classifierTimeoutMs: 2000, defaultModel: null, models: {} };
  }
}

export default function (pi: ExtensionAPI) {
  const rulesPath = join(homedir(), ".pi", "model-rules.json");
  const logPath = join(homedir(), ".pi", "model-decisions.jsonl");

  pi.on("before_agent_start", async (event, ctx) => {
    const config = loadConfig(rulesPath);
    const lastMessage = event.prompt;
    const tokenCount = estimateTokens(event.prompt);
    const start = Date.now();

    const session = ctx.sessionManager.getSessionId();

    async function setModelByName(modelName: string): Promise<void> {
      const model = ctx.modelRegistry.getAll().find((m) => m.id === modelName);
      if (model) {
        await pi.setModel(model);
      } else {
        console.warn(`[model-router] model not found in registry: ${modelName}`);
      }
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

    // Tier 2: Ollama classifier
    if (config.ollamaUrl && config.ollamaModel) {
      const tier = await callOllama(config.ollamaUrl, config.ollamaModel, lastMessage, config.classifierTimeoutMs ?? 2000);
      if (tier) {
        const modelName = config.models?.[tier] ?? config.defaultModel;
        if (modelName) await setModelByName(modelName);
        appendDecision(logPath, {
          ts: new Date().toISOString(),
          session,
          tier,
          model: modelName ?? "unknown",
          reason: "ollama",
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
