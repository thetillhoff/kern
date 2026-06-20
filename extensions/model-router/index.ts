import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callOllama } from "./classifier.ts";
import { currentModelId } from "./decision.ts";
import { appendDecision } from "./logger.ts";
import { applyRules, estimateTokens, type RoutingRule } from "./rules.ts";

interface RouterConfig {
	rules: RoutingRule[];
	ollamaUrl: string | null;
	ollamaModel: string | null;
	classifierTimeoutMs: number;
	defaultModel: string | null;
	models: Record<string, string>;
}

function saveConfig(rulesPath: string, config: RouterConfig): void {
	writeFileSync(rulesPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function loadConfig(rulesPath: string): RouterConfig {
	if (!existsSync(rulesPath)) {
		return {
			rules: [],
			ollamaUrl: null,
			ollamaModel: null,
			classifierTimeoutMs: 2000,
			defaultModel: null,
			models: {},
		};
	}
	try {
		return JSON.parse(readFileSync(rulesPath, "utf-8")) as RouterConfig;
	} catch {
		return {
			rules: [],
			ollamaUrl: null,
			ollamaModel: null,
			classifierTimeoutMs: 2000,
			defaultModel: null,
			models: {},
		};
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
		const sessionModel = ctx.model as { id?: string } | undefined;

		async function setModelByName(modelName: string): Promise<void> {
			const model = ctx.modelRegistry.getAll().find((m) => m.id === modelName);
			if (model) {
				await pi.setModel(model);
			} else {
				console.warn(
					`[model-router] model not found in registry: ${modelName}`,
				);
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
			const tier = await callOllama(
				config.ollamaUrl,
				config.ollamaModel,
				lastMessage,
				config.classifierTimeoutMs ?? 2000,
			);
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
			// Classifier ran but produced no usable tier: record the failure
			// instead of silently falling through to the default reason.
			appendDecision(logPath, {
				ts: new Date().toISOString(),
				session,
				tier: "default",
				model: currentModelId(sessionModel, config.defaultModel),
				reason: "ollama-failed",
				latencyMs: Date.now() - start,
			});
			return;
		}

		// Tier 3: default — no model change; Pi uses whatever is configured
		appendDecision(logPath, {
			ts: new Date().toISOString(),
			session,
			tier: "default",
			model: currentModelId(
				ctx.model as { id?: string } | undefined,
				config.defaultModel,
			),
			reason: "default",
			latencyMs: Date.now() - start,
		});
	});

	pi.registerCommand("ollama", {
		description:
			"Configure Ollama classifier (enable/disable/status/url/model)",
		getArgumentCompletions: (prefix) => {
			if (/^(enable|url)\s/.test(prefix)) {
				return [
					{
						value: "http://localhost:11434",
						label: "http://localhost:11434",
						description: "default",
					},
				];
			}
			return ["status", "enable", "disable", "url", "model"].map((v) => ({
				value: v,
				label: v,
			}));
		},
		handler: async (args, ctx) => {
			const config = loadConfig(rulesPath);
			const [sub, ...rest] = args.trim().split(/\s+/);
			const value = rest.join(" ");

			if (!sub) {
				ctx.ui.notify(
					"subcommands: status · enable [url] · disable · url <url> · model <name>",
					"info",
				);
				return;
			}

			if (sub === "status") {
				const on = !!config.ollamaUrl;
				ctx.ui.notify(
					`ollama: ${on ? "enabled" : "disabled"} | url: ${config.ollamaUrl ?? "null"} | model: ${config.ollamaModel ?? "unset"}`,
					"info",
				);
				return;
			}

			if (sub === "enable") {
				config.ollamaUrl = "http://localhost:11434";
				saveConfig(rulesPath, config);
				ctx.ui.notify(
					`ollama enabled → ${config.ollamaUrl} (model: ${config.ollamaModel}) — use /ollama url <url> to change`,
					"info",
				);
				return;
			}

			if (sub === "disable") {
				config.ollamaUrl = null;
				saveConfig(rulesPath, config);
				ctx.ui.notify("ollama disabled", "info");
				return;
			}

			if (sub === "url" && value) {
				config.ollamaUrl = value;
				saveConfig(rulesPath, config);
				ctx.ui.notify(`ollama url → ${value}`, "info");
				return;
			}

			if (sub === "model" && value) {
				config.ollamaModel = value;
				saveConfig(rulesPath, config);
				ctx.ui.notify(`ollama model → ${value}`, "info");
				return;
			}

			ctx.ui.notify(
				"unknown subcommand. try: status · enable [url] · disable · url <url> · model <name>",
				"warning",
			);
		},
	});
}
