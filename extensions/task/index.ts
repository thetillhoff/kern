import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	type ExtensionAPI,
	type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type RegistryModel = ReturnType<ModelRegistry["getAll"]>[number];

// Look up the model id for a tier in the model-router config on disk.
export function tierModelId(tier: string | undefined): string | undefined {
	if (!tier) return undefined;
	const path = join(homedir(), ".pi", "model-rules.json");
	if (!existsSync(path)) return undefined;
	try {
		const cfg = JSON.parse(readFileSync(path, "utf-8")) as {
			models?: Record<string, string>;
		};
		return cfg.models?.[tier];
	} catch {
		return undefined;
	}
}

// Reuse the tier → model-id map maintained by the model-router extension.
function resolveTierModel(
	tier: string | undefined,
	registry: ModelRegistry,
): RegistryModel | undefined {
	const id = tierModelId(tier);
	if (!id) return undefined;
	return registry.getAll().find((m) => m.id === id);
}

type MessageLike = { role: string; content?: unknown };

export function lastAssistantText(messages: MessageLike[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === "assistant" && Array.isArray(m.content)) {
			return m.content
				.filter(
					(c): c is { type: "text"; text: string } =>
						typeof c === "object" &&
						c !== null &&
						(c as { type?: unknown }).type === "text",
				)
				.map((c) => c.text)
				.join("")
				.trim();
		}
	}
	return "";
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "task",
		label: "Task (subagent)",
		description:
			"Delegate a self-contained task to a fresh subagent with its own context window. " +
			"The subagent runs to completion and returns only its final answer. " +
			"Use for context-isolating or parallelizable work: codebase searches, file summaries, " +
			"independent investigations. The subagent cannot ask follow-up questions — give it a " +
			"complete, standalone prompt. Issue multiple task calls in one turn to run subagents in parallel.",
		promptSnippet:
			"Use task to delegate self-contained work to an isolated subagent",
		executionMode: "parallel",
		parameters: Type.Object({
			prompt: Type.String({
				description: "Complete, standalone instructions for the subagent.",
			}),
			model_tier: Type.Optional(
				Type.Union(
					[Type.Literal("light"), Type.Literal("medium"), Type.Literal("heavy")],
					{
						description:
							"Model tier (light/medium/heavy). Omit to inherit the default model.",
					},
				),
			),
			tools: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Allowlist of tool names the subagent may use. Omit for the defaults (read, bash, edit, write).",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const model = resolveTierModel(params.model_tier, ctx.modelRegistry);
			const { session } = await createAgentSession({
				cwd: ctx.cwd,
				modelRegistry: ctx.modelRegistry,
				...(model ? { model } : {}),
				...(params.tools ? { tools: params.tools } : {}),
			});

			// Propagate the parent's abort to the child session.
			const onAbort = () => void session.abort();
			signal?.addEventListener("abort", onAbort, { once: true });

			try {
				await session.prompt(params.prompt);
				const text = lastAssistantText(session.messages);
				return {
					content: [
						{
							type: "text" as const,
							text: text || "(subagent returned no text output)",
						},
					],
					details: {
						model_tier: params.model_tier ?? "default",
						tools: params.tools ?? "default",
						aborted: signal?.aborted ?? false,
					},
				};
			} finally {
				signal?.removeEventListener("abort", onAbort);
				session.dispose();
			}
		},
	});
}
