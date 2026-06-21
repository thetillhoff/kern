import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SubagentStatus } from "./logger.ts";

export interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

export interface ChildEntry {
	session: AgentSession;
	model: string;
	runPromise?: Promise<void>;
	resolveAsk?: (answer: string) => void;
	questionSignal: Deferred<{ question: string }>;
	tokensTotal: number;
	status: SubagentStatus;
	startedAt: number;
}

// Shared across the parent and every child: createAgentSession runs in the
// same Node process, so this module-level map is a single instance.
export const registry = new Map<string, ChildEntry>();

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	return `${(n / 1000).toFixed(1)}k`;
}

// Ensure a subagent can always ask its caller and spawn further subagents,
// even when the caller restricts the child's tools.
export function augmentTools(
	tools: string[] | undefined,
): string[] | undefined {
	if (!tools) return undefined;
	const set = new Set(tools);
	set.add("ask-caller");
	set.add("task");
	return [...set];
}
