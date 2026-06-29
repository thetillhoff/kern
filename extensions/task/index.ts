import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AgentSession,
	type AgentToolUpdateCallback,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { loadModelRules } from "../shared/model-rules.ts";
import { appendSubagentLog, type SubagentStatus } from "./logger.ts";
import {
	allTopLevelRows,
	augmentTools,
	type ChildEntry,
	deferred,
	descendantsOf,
	notify,
	registerRedraw,
	registry,
	rowText,
	setWidgetCallback,
	subtreeRows,
	unregisterRedraw,
} from "./registry.ts";

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

// Returns the resolved model object, or undefined when no mapping exists or the
// model id is missing from the registry. Emits a warning via `warn` when falling
// back to the default model or when the configured model id is not registered.
function resolveModelByTier(
	tier: string,
	modelRegistry: { getAll(): { id: string }[] },
	warn: (msg: string) => void,
): { id: string } | undefined {
	const config = loadModelRules(join(homedir(), ".pi", "model-rules.json"));
	const explicitId = config.models?.[tier];
	const modelId = explicitId ?? config.defaultModel ?? null;
	if (!modelId) return undefined;
	if (!explicitId)
		warn(
			`[task] no model mapped for tier "${tier}", using default: ${modelId}`,
		);
	const model = modelRegistry.getAll().find((m) => m.id === modelId);
	if (!model) {
		warn(`[task] model "${modelId}" not found in registry (tier: ${tier})`);
		return undefined;
	}
	return model;
}

function sessionLogPath(childId: string): string {
	return join(homedir(), ".pi", "sessions", `${childId}.jsonl`);
}

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
	status: SubagentStatus,
): void {
	appendSubagentLog(sessionLogPath(childSession), {
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
	onUpdate: AgentToolUpdateCallback | undefined,
	toolCallId: string,
	timeoutMs: number | undefined,
): Promise<ToolResult> {
	// Re-emit the current subtree as a partial result so renderResult redraws.
	const emit = () => {
		entry.tokensTotal = readChildTokens(entry.session);
		onUpdate?.({ content: [], details: { rows: subtreeRows(childId) } });
	};
	registerRedraw(toolCallId, emit);

	// Track the child's latest action, live model, and tokens. Any event in any
	// session (including a nested grandchild) fans out to every open row.
	const unsubscribe = entry.session.subscribe((ev) => {
		if (ev.type === "tool_execution_start") entry.note = ev.toolName;
		else if (ev.type === "message_start") entry.note = "responding";
		entry.tokensTotal = readChildTokens(entry.session);
		entry.model = entry.session.model?.id ?? entry.model;
		notify();
	});

	try {
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

		// Capture the actual model the child router chose (available once prompt() starts).
		entry.model = entry.session.model?.id ?? entry.model;
		entry.tokensTotal = readChildTokens(entry.session);

		if (outcome === "timeout") {
			entry.status = "timeout";
			entry.note = undefined;
			logEvent(entry, parentSession, childId, entry.model, "timeout");
			const rows = subtreeRows(childId);
			await entry.session.abort();
			entry.session.dispose();
			registry.delete(childId);
			notify();
			return {
				content: [
					{ type: "text", text: `Subagent timed out after ${timeoutMs}ms.` },
				],
				details: { status: "timeout", model: entry.model, rows },
			};
		}

		if (
			typeof outcome === "object" &&
			outcome !== null &&
			"failed" in outcome
		) {
			entry.status = "failed";
			entry.note = undefined;
			logEvent(entry, parentSession, childId, entry.model, "aborted");
			const rows = subtreeRows(childId);
			entry.session.dispose();
			registry.delete(childId);
			notify();
			return {
				content: [{ type: "text", text: `Subagent failed: ${outcome.failed}` }],
				details: { status: "aborted", model: entry.model, rows },
			};
		}

		if (outcome === "completed") {
			entry.status = "done";
			entry.note = undefined;
			logEvent(entry, parentSession, childId, entry.model, "completed");
			const text = lastAssistantText(entry.session.messages);
			const rows = subtreeRows(childId);
			entry.session.dispose();
			registry.delete(childId);
			notify();
			return {
				content: [
					{ type: "text", text: text || "(subagent returned no text output)" },
				],
				details: { status: "completed", model: entry.model, rows },
			};
		}

		// outcome is the asked question
		entry.status = "awaiting";
		entry.note = outcome.question;
		logEvent(entry, parentSession, childId, entry.model, "asked");
		return {
			content: [
				{
					type: "text",
					text: `Subagent ${childId} asks: ${outcome.question}`,
				},
			],
			details: {
				status: "awaiting_answer",
				model: entry.model,
				resume: childId,
				question: outcome.question,
				rows: subtreeRows(childId),
			},
		};
	} finally {
		unsubscribe();
		unregisterRedraw(toolCallId);
	}
}

const WIDGET_KEY = "task-subagents";

export default function (pi: ExtensionAPI) {
	// Wire up the belowEditor widget for the root (non-child) session only.
	// Child sessions are headless; setWidget is a no-op on them but the widget
	// callback would still fire - skip by checking the session is not registered
	// as a child when the first event arrives.
	pi.on("session_start", (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		// Only the root session drives the widget; child sessions are in the registry.
		if (registry.has(sessionId)) return;
		setWidgetCallback(() => {
			const rows = allTopLevelRows();
			if (!rows.length) {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
				return;
			}
			ctx.ui.setWidget(
				WIDGET_KEY,
				rows.map((row) => rowText(row)),
				{ placement: "belowEditor" },
			);
		});
	});

	// Sweep subagents this session spawned that are still parked in the registry
	// (a child suspended in `awaiting` outlives the tool call that created it).
	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (!registry.has(sessionId)) {
			// Root session shutting down: clear widget and callback.
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			setWidgetCallback(undefined);
		}
		for (const id of descendantsOf(sessionId)) {
			const entry = registry.get(id);
			if (!entry) continue;
			try {
				await entry.session.abort();
				entry.session.dispose();
			} catch {
				// Best effort: still drop the entry so it cannot leak.
			}
			registry.delete(id);
		}
	});

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
		async execute(toolCallId, params, signal, onUpdate, ctx) {
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
				entry.status = "running";
				entry.note = undefined;
				resolve(params.answer ?? "");
				return runSegment(
					entry,
					params.resume,
					parentSession,
					onUpdate,
					toolCallId,
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

			const augmented = augmentTools(params.tools);
			const resolvedModel = params.model_tier
				? resolveModelByTier(params.model_tier, ctx.modelRegistry, (msg) =>
						ctx.ui.notify(msg, "warning"),
					)
				: undefined;
			const { session } = await createAgentSession({
				cwd: ctx.cwd,
				modelRegistry: ctx.modelRegistry,
				resourceLoader: loader,
				// biome-ignore lint/suspicious/noExplicitAny: model type from SDK is opaque; resolved via modelRegistry
				...(resolvedModel ? { model: resolvedModel as any } : {}),
				// biome-ignore lint/suspicious/noExplicitAny: ask-caller's execute ctx is the child's tool context, which the SDK types loosely; the registry-based handshake is verified at runtime in Task 6.
				customTools: [askCaller as any],
				...(augmented ? { tools: augmented } : {}),
			});

			// Route the child's permission prompts up to the human via the parent UI.
			session.extensionRunner.setUIContext(ctx.ui, ctx.mode);

			const childId = session.sessionId;

			const entry: ChildEntry = {
				session,
				model: "pending",
				questionSignal: deferred<{ question: string }>(),
				tokensTotal: 0,
				status: "running",
				startedAt: Date.now(),
				parentId: parentSession,
			};
			registry.set(childId, entry);
			logEvent(entry, parentSession, childId, "pending", "spawned");

			const onAbort = () => void session.abort();
			signal?.addEventListener("abort", onAbort, { once: true });

			// Model tier: resolved directly here and passed to createAgentSession
			// rather than via the globalThis override store, because child sessions
			// have no model-router extension to consume that store.
			// Kick off the run; runSegment races it against question/timeout.
			entry.runPromise = session.prompt(params.prompt);
			try {
				return await runSegment(
					entry,
					childId,
					parentSession,
					onUpdate,
					toolCallId,
					params.timeout_ms,
				);
			} finally {
				signal?.removeEventListener("abort", onAbort);
			}
		},
		renderResult(result, _options, _theme) {
			const text = result.content
				.map((c) => (c.type === "text" ? c.text : ""))
				.join("");
			return new Text(text);
		},
	});
}
