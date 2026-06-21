import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callOllama, warmupOllama } from "./classifier.ts";
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

// Safety cap on a classifier call kept running for measurement after the gate.
const CLASSIFIER_SAFETY_MS = 60000;
// Re-warm the classifier model at most this often while the user types.
const WARMUP_INTERVAL_MS = 60000;

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
			latencyMs?: number,
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
				latencyMs: latencyMs ?? Date.now() - start,
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

		// 3. Ollama classifier — gated for routing, but always measured. If the
		// gate is exceeded we fall back now yet let the call finish in the
		// background and log how long it would have taken (reason "ollama-late").
		if (config.ollamaUrl && config.ollamaModel) {
			const gateMs = config.classifierTimeoutMs ?? 2000;
			const classifyP = callOllama(
				config.ollamaUrl,
				config.ollamaModel,
				_event.prompt,
				CLASSIFIER_SAFETY_MS,
			);
			const gateP = new Promise<{ gate: true }>((resolve) =>
				setTimeout(() => resolve({ gate: true }), gateMs),
			);
			const winner = await Promise.race([classifyP, gateP]);
			if ("gate" in winner) {
				// Gate exceeded: route fallback now, log the late result for eval.
				const light = config.models?.light ?? config.defaultModel;
				classifyP
					.then(({ tier, latencyMs }) => {
						appendDecision(logPath, {
							ts: new Date().toISOString(),
							session,
							tier: tier ?? "light",
							model: (tier ? config.models?.[tier] : light) ?? "unknown",
							reason: "ollama-late",
							latencyMs,
						});
					})
					.catch(() => {});
			} else if (winner.tier) {
				await setModelByTier(winner.tier, "ollama", winner.latencyMs);
				return;
			}
			// else: answered within the gate but no valid tier → fall through.
		}

		// 4. Fallback to the light model.
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

	// Warm the classifier model so the first real classification isn't a cold
	// load (~14s cold vs ~1s warm). Fire on session start (earliest chance) and
	// again as the user types, in case it was evicted since. Throttled to once
	// per WARMUP_INTERVAL_MS so repeated subagent spawns don't spam Ollama.
	let lastWarmup = 0;
	const maybeWarmup = (url: string, model: string) => {
		const now = Date.now();
		if (now - lastWarmup > WARMUP_INTERVAL_MS) {
			lastWarmup = now;
			warmupOllama(url, model);
		}
	};
	pi.on("session_start", (_event, ctx) => {
		const { ollamaUrl, ollamaModel } = loadConfig(rulesPath);
		if (!ollamaUrl || !ollamaModel) return;
		maybeWarmup(ollamaUrl, ollamaModel);
		ctx.ui.onTerminalInput(() => {
			maybeWarmup(ollamaUrl, ollamaModel);
			return undefined;
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
