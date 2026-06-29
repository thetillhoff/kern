import { existsSync, readFileSync } from "node:fs";

export interface ModelRulesConfig {
	models?: Record<string, string>;
	defaultModel?: string | null;
}

export function loadModelRules(rulesPath: string): ModelRulesConfig {
	if (!existsSync(rulesPath)) return {};
	try {
		return JSON.parse(readFileSync(rulesPath, "utf-8")) as ModelRulesConfig;
	} catch {
		console.warn("[model-rules] failed to parse config");
		return {};
	}
}
