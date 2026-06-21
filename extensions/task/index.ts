import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendSubagentLog } from "./logger.ts";
import {
	augmentTools,
	type ChildEntry,
	deferred,
	formatTokens,
	registry,
} from "./registry.ts";

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
	modelRegistry: ModelRegistry,
): RegistryModel | undefined {
	const id = tierModelId(tier);
	if (!id) return undefined;
	return modelRegistry.getAll().find((m) => m.id === id);
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

const SUBAGENT_APPEND_PROMPT = [
	"You are a subagent working for a calling agent.",
	"If you need information or a decision you cannot determine yourself, call the `ask-caller` tool with a single clear question; its result is the caller's answer.",
];

const LOG_PATH = join(homedir(), ".pi", "subagent.jsonl");

function readChildTokens(session: AgentSession): number {
	try {
		return session.getSessionStats().tokens.total;
	} catch {
		return 0;
	}
}

function logEvent(
	entry: ChildEntry,
	parentSession: string,
	childSession: string,
	model: string,
	status: ChildEntry["status"],
): void {
	appendSubagentLog(LOG_PATH, {
		ts: new Date().toISOString(),
		parentSession,
		childSession,
		model,
		tokens: entry.tokensTotal,
		status,
		durationMs: Date.now() - entry.startedAt,
	});
}

type ToolResult = {
	content: { type: "text"; text: string }[];
	details: unknown;
};

async function runSegment(
	entry: ChildEntry,
	childId: string,
	parentSession: string,
	ctx: {
		ui: { setStatus(key: string, text: string | undefined): void };
		model: { id?: string } | undefined;
	},
	timeoutMs: number | undefined,
): Promise<ToolResult> {
	const modelId = entry.model;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<"timeout">((resolve) => {
		if (timeoutMs && timeoutMs > 0)
			timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	const completed = (entry.runPromise ?? Promise.resolve()).then(
		() => "completed" as const,
		(err) => ({ failed: err instanceof Error ? err.message : String(err) }),
	);
	const asked = entry.questionSignal.promise.then((q) => ({
		question: q.question,
	}));

	const outcome = await Promise.race([completed, asked, timeout]);
	if (timer) clearTimeout(timer);

	entry.tokensTotal = readChildTokens(entry.session);
	ctx.ui.setStatus(
		"subagents",
		`subagent ${childId.slice(0, 8)}: ${formatTokens(entry.tokensTotal)} tok`,
	);

	if (outcome === "timeout") {
		entry.status = "timeout";
		logEvent(entry, parentSession, childId, modelId, "timeout");
		await entry.session.abort();
		entry.session.dispose();
		registry.delete(childId);
		return {
			content: [
				{ type: "text", text: `Subagent timed out after ${timeoutMs}ms.` },
			],
			details: { status: "timeout", tokens: entry.tokensTotal },
		};
	}

	if (typeof outcome === "object" && outcome !== null && "failed" in outcome) {
		entry.status = "aborted";
		logEvent(entry, parentSession, childId, modelId, "aborted");
		entry.session.dispose();
		registry.delete(childId);
		ctx.ui.setStatus("subagents", undefined);
		return {
			content: [{ type: "text", text: `Subagent failed: ${outcome.failed}` }],
			details: { status: "aborted", tokens: entry.tokensTotal },
		};
	}

	if (outcome === "completed") {
		entry.status = "completed";
		logEvent(entry, parentSession, childId, modelId, "completed");
		const text = lastAssistantText(entry.session.messages);
		entry.session.dispose();
		registry.delete(childId);
		ctx.ui.setStatus("subagents", undefined);
		return {
			content: [
				{ type: "text", text: text || "(subagent returned no text output)" },
			],
			details: { status: "completed", tokens: entry.tokensTotal },
		};
	}

	// outcome is the asked question
	entry.status = "awaiting_answer" as ChildEntry["status"];
	logEvent(entry, parentSession, childId, modelId, "asked");
	return {
		content: [
			{
				type: "text",
				text: `Subagent ${childId} asks: ${outcome.question}`,
			},
		],
		details: {
			status: "awaiting_answer",
			resume: childId,
			question: outcome.question,
			tokens: entry.tokensTotal,
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "task",
		label: "Task (subagent)",
		description:
			"Delegate a self-contained task to a subagent with its own context window. " +
			"Provide `prompt` to spawn a subagent; set `timeout_ms` to bound each run segment. " +
			"If the result has status 'awaiting_answer', the subagent asked a question: answer it " +
			"by calling task again with `resume` set to the returned id and `answer` set to your reply, " +
			"or escalate by calling `ask-caller` yourself. Issue multiple task calls in one turn to run subagents in parallel.",
		promptSnippet: "Delegate self-contained work to an isolated subagent",
		executionMode: "parallel",
		parameters: Type.Object({
			prompt: Type.Optional(
				Type.String({
					description:
						"Complete, standalone instructions for a new subagent. Omit when resuming.",
				}),
			),
			model_tier: Type.Optional(
				Type.Union(
					[
						Type.Literal("light"),
						Type.Literal("medium"),
						Type.Literal("heavy"),
					],
					{ description: "Model tier. Omit to inherit the default model." },
				),
			),
			tools: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Allowlist of tool names for the subagent. `ask-caller` and `task` are always added.",
				}),
			),
			timeout_ms: Type.Optional(
				Type.Number({
					description:
						"Abort a run segment that takes longer than this many milliseconds.",
				}),
			),
			resume: Type.Optional(
				Type.String({
					description:
						"A subagent id from a prior 'awaiting_answer' result, to deliver an answer.",
				}),
			),
			answer: Type.Optional(
				Type.String({ description: "The answer to feed a resumed subagent." }),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const parentSession = ctx.sessionManager.getSessionId();

			// --- Resume path -------------------------------------------------
			if (params.resume) {
				const entry = registry.get(params.resume);
				if (!entry?.resolveAsk) {
					return {
						content: [
							{
								type: "text" as const,
								text: `No subagent awaiting an answer for id ${params.resume}.`,
							},
						],
						details: { status: "error" },
					};
				}
				logEvent(entry, parentSession, params.resume, entry.model, "answered");
				const resolve = entry.resolveAsk;
				entry.resolveAsk = undefined;
				entry.questionSignal = deferred<{ question: string }>();
				entry.status = "running" as ChildEntry["status"];
				resolve(params.answer ?? "");
				return runSegment(
					entry,
					params.resume,
					parentSession,
					ctx,
					params.timeout_ms,
				);
			}

			// --- Fresh spawn -------------------------------------------------
			if (!params.prompt) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Provide `prompt` to spawn a subagent or `resume` to answer one.",
						},
					],
					details: { status: "error" },
				};
			}

			const model = resolveTierModel(params.model_tier, ctx.modelRegistry);
			const loader = new DefaultResourceLoader({
				cwd: ctx.cwd,
				agentDir: join(homedir(), ".pi", "agent"),
				systemPrompt: ctx.getSystemPrompt(),
				appendSystemPrompt: SUBAGENT_APPEND_PROMPT,
			});
			await loader.reload();

			const askCaller = {
				name: "ask-caller",
				label: "Ask caller",
				description:
					"Ask your calling agent a question and wait for the answer. Use only when you cannot proceed without input.",
				parameters: Type.Object({
					question: Type.String({
						description: "A single, self-contained question.",
					}),
				}),
				async execute(
					_id: string,
					p: { question: string },
					_sig: AbortSignal | undefined,
					_upd: unknown,
					childCtx: { sessionManager: { getSessionId(): string } },
				): Promise<ToolResult> {
					const myId = childCtx.sessionManager.getSessionId();
					const entry = registry.get(myId);
					if (!entry) {
						return {
							content: [
								{
									type: "text" as const,
									text: "No caller is available to answer.",
								},
							],
							details: {},
						};
					}
					return new Promise<ToolResult>((resolve) => {
						entry.resolveAsk = (answer: string) =>
							resolve({
								content: [{ type: "text" as const, text: answer }],
								details: {},
							});
						entry.questionSignal.resolve({ question: p.question });
					});
				},
			};

			const { session } = await createAgentSession({
				cwd: ctx.cwd,
				modelRegistry: ctx.modelRegistry,
				resourceLoader: loader,
				// biome-ignore lint/suspicious/noExplicitAny: ask-caller's execute ctx is the child's tool context, which the SDK types loosely; the registry-based handshake is verified at runtime in Task 6.
				customTools: [askCaller as any],
				...(model ? { model } : {}),
				...(augmentTools(params.tools)
					? { tools: augmentTools(params.tools) }
					: {}),
			});

			// Route the child's permission prompts up to the human via the parent UI.
			session.extensionRunner.setUIContext(ctx.ui, ctx.mode);

			const childId = session.sessionId;
			const entry: ChildEntry = {
				session,
				model: model?.id ?? "default",
				questionSignal: deferred<{ question: string }>(),
				tokensTotal: 0,
				status: "running" as ChildEntry["status"],
				startedAt: Date.now(),
			};
			registry.set(childId, entry);
			logEvent(
				entry,
				parentSession,
				childId,
				model?.id ?? "default",
				"spawned",
			);

			const onAbort = () => void session.abort();
			signal?.addEventListener("abort", onAbort, { once: true });

			// Kick off the run; runSegment races it against question/timeout.
			entry.runPromise = session.prompt(params.prompt);
			try {
				return await runSegment(
					entry,
					childId,
					parentSession,
					ctx,
					params.timeout_ms,
				);
			} finally {
				signal?.removeEventListener("abort", onAbort);
			}
		},
	});
}
