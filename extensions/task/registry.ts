import type { AgentSession } from "@earendil-works/pi-coding-agent";

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

// Status shown in the live status rows. Distinct from the logger's
// SubagentStatus (which records transitions); this is the current display state.
export type RowStatus = "running" | "awaiting" | "done" | "failed" | "timeout";

export interface ChildEntry {
	session: AgentSession;
	model: string;
	runPromise?: Promise<void>;
	resolveAsk?: (answer: string) => void;
	questionSignal: Deferred<{ question: string }>;
	tokensTotal: number;
	status: RowStatus;
	startedAt: number;
	// Session id of the caller that spawned this child (a parent child for a
	// nested subagent, or the human's root session for a top-level one). Used to
	// nest rows. The root session is absent from the registry.
	parentId?: string;
	// Latest action while running (tool name / "responding"), or the pending
	// question while awaiting. Overwritten, not accumulated - no step history.
	note?: string;
}

// Shared across the parent and every child: createAgentSession runs in the
// same Node process, so this module-level map is a single instance.
export const registry = new Map<string, ChildEntry>();

// Redraw callbacks keyed by tool-call id: each live `task` execution registers
// one that re-emits its onUpdate. Any session event (incl. a nested child's)
// calls notify() so every open row re-renders.
const redraws = new Map<string, () => void>();

export function registerRedraw(toolCallId: string, redraw: () => void): void {
	redraws.set(toolCallId, redraw);
}

export function unregisterRedraw(toolCallId: string): void {
	redraws.delete(toolCallId);
}

// Widget callback: called on every notify() to push the current row list to
// the belowEditor widget. Registered once per root session in session_start.
let widgetCallback: (() => void) | undefined;

export function setWidgetCallback(cb: (() => void) | undefined): void {
	widgetCallback = cb;
}

export function notify(): void {
	for (const redraw of redraws.values()) redraw();
	widgetCallback?.();
}

export interface Row {
	name: string;
	model: string;
	tokens: number;
	status: RowStatus;
	note?: string;
	depth: number;
}

// A child plus all its nested descendants, depth-first, indented by depth.
export function subtreeRows(rootId: string): Row[] {
	const out: Row[] = [];
	const visit = (id: string, depth: number) => {
		const e = registry.get(id);
		if (!e) return;
		out.push({
			name: id.slice(0, 8),
			model: e.model,
			tokens: e.tokensTotal,
			status: e.status,
			note: e.note,
			depth,
		});
		for (const [childId, child] of registry)
			if (child.parentId === id) visit(childId, depth + 1);
	};
	visit(rootId, 0);
	return out;
}

// Registry ids of every subagent spawned (directly or transitively) by the
// given session. Used to sweep orphans when that session shuts down - a child
// suspended in `awaiting` between segments has no live tool call to clean it up.
export function descendantsOf(sessionId: string): string[] {
	const ids: string[] = [];
	const visit = (parent: string) => {
		for (const [id, child] of registry)
			if (child.parentId === parent) {
				ids.push(id);
				visit(id);
			}
	};
	visit(sessionId);
	return ids;
}

const GLYPHS: Record<RowStatus, string> = {
	running: "⏵ running",
	awaiting: "⏸ awaiting",
	done: "✓ done",
	failed: "✖ failed",
	timeout: "⏱ timeout",
};

export function statusGlyph(status: RowStatus): string {
	return GLYPHS[status];
}

// Uncolored row text; the caller applies theme color to the glyph.
export function rowText(row: Row): string {
	const indent = "  ".repeat(row.depth);
	const note =
		(row.status === "running" || row.status === "awaiting") && row.note
			? `  ${row.note}`
			: "";
	return `${indent}${row.name}  ${row.model}  ${formatTokens(row.tokens)} tok  ${statusGlyph(row.status)}${note}`;
}

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	return `${(n / 1000).toFixed(1)}k`;
}

// All top-level rows (entries whose parentId is not itself in the registry),
// each with their full subtree. Used to render the belowEditor widget.
export function allTopLevelRows(): Row[] {
	const out: Row[] = [];
	for (const [id, entry] of registry) {
		if (!entry.parentId || !registry.has(entry.parentId)) {
			out.push(...subtreeRows(id));
		}
	}
	return out;
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
