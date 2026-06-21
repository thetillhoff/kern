import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callOllama } from "./classifier.ts";
import { currentModelId } from "./decision.ts";
import { appendDecision } from "./logger.ts";
import {
	isPinned,
	noteRouterSet,
	pinSession,
	takeTierOverride,
	wasRouterSet,
} from "./override.ts";

interface RouterConfig {
	ollamaUrl: string | null;
	ollamaModel: string | null;
	classifierTimeoutMs: number;
	defaultModel: string | null;
	models: Record<string, string>;
}

function saveConfig(rulesPath: string, config: RouterConfig): void {
	writeFileSync(rulesPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// The model a session starts on absent any selection: settings.json's
// defaultModel. A live model differing from this baseline means the human
// chose it explicitly (e.g. `pi --model X`), which the router must honor.
function loadSettingsDefaultModel(settingsPath: string): string | null {
	if (!existsSync(settingsPath)) return null;
	try {
		const s = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
			defaultModel?: string;
		};
		return s.defaultModel ?? null;
	} catch {
		return null;
	}
}

function loadConfig(rulesPath: string): RouterConfig {
	if (!existsSync(rulesPath)) {
		return {
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
	const settingsPath = join(homedir(), ".pi", "agent", "settings.json");

	pi.on("before_agent_start", async (_event, ctx) => {
		const config = loadConfig(rulesPath);
		const session = ctx.sessionManager.getSessionId();
		const start = Date.now();

		async function setModelByTier(
			tier: string,
			reason: "explicit" | "ollama" | "fallback",
		): Promise<void> {
			const modelName = config.models?.[tier] ?? config.defaultModel;
			if (modelName) {
				const model = ctx.modelRegistry
					.getAll()
					.find((m) => m.id === modelName);
				if (model) {
					noteRouterSet(session, modelName);
					await pi.setModel(model);
				} else {
					console.warn(`[model-router] model not found: ${modelName}`);
				}
			}
			appendDecision(logPath, {
				ts: new Date().toISOString(),
				session,
				tier,
				model: modelName ?? "unknown",
				reason,
				latencyMs: Date.now() - start,
			});
		}

		// 1. Explicit subagent tier override (from a task() call). Hard win.
		const overrideTier = takeTierOverride(session);
		if (overrideTier) {
			await setModelByTier(overrideTier, "explicit");
			return;
		}

		// First-turn human --model: a launch flag does not emit a model_select
		// event, so detect it here. If the live model differs from the startup
		// default and the router did not set it, the human pinned it explicitly.
		const liveId = (ctx.model as { id?: string } | undefined)?.id;
		if (liveId && !isPinned(session) && !wasRouterSet(session, liveId)) {
			const settingsDefault = loadSettingsDefaultModel(settingsPath);
			if (settingsDefault && liveId !== settingsDefault) {
				pinSession(session);
			}
		}

		// 2. Human-pinned session: keep whatever model the human selected.
		if (isPinned(session)) {
			appendDecision(logPath, {
				ts: new Date().toISOString(),
				session,
				tier: "explicit",
				model: currentModelId(
					ctx.model as { id?: string } | undefined,
					config.defaultModel,
				),
				reason: "explicit",
				latencyMs: Date.now() - start,
			});
			return;
		}

		// 3. Ollama classifier.
		if (config.ollamaUrl && config.ollamaModel) {
			const tier = await callOllama(
				config.ollamaUrl,
				config.ollamaModel,
				_event.prompt,
				config.classifierTimeoutMs ?? 2000,
			);
			if (tier) {
				await setModelByTier(tier, "ollama");
				return;
			}
		}

		// 4. Fallback to the light model when no classifier answer.
		await setModelByTier("light", "fallback");
	});

	// Pin a session when the human (not the router) selects a model.
	pi.on("model_select", (event, ctx) => {
		const session = ctx.sessionManager.getSessionId();
		const modelId = (event.model as { id?: string }).id ?? "";
		if (wasRouterSet(session, modelId)) return; // the router's own set
		if (event.source === "set" || event.source === "cycle") {
			pinSession(session);
		}
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
