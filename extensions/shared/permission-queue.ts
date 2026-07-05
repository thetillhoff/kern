import { Input, Key, matchesKey, SelectList } from "@earendil-works/pi-tui";

// Global mutex for permission prompts — prevents multiple prompts from stacking.
// Uses globalThis so the queue is shared across all extensions (each runs in its
// own module graph). Symbol.for ensures the same key across module instances.
const KEY = Symbol.for("kern.permissionQueue");

interface Queue {
	chain: Promise<void>;
	pending: number;
}

function getQueue(): Queue {
	if (!(globalThis as Record<symbol, unknown>)[KEY]) {
		(globalThis as Record<symbol, unknown>)[KEY] = {
			chain: Promise.resolve(),
			pending: 0,
		};
	}
	return (globalThis as Record<symbol, unknown>)[KEY] as Queue;
}

interface UI {
	select(
		message: string,
		options: string[],
		opts?: Record<string, unknown>,
	): Promise<string | undefined>;
	notify(message: string, level?: string): void;
}

export async function queuedSelect(
	ui: UI,
	message: string,
	options: string[],
	opts: Record<string, unknown> = {},
): Promise<string | undefined> {
	const q = getQueue();
	q.pending++;

	if (q.pending > 1) {
		ui.notify(`${q.pending - 1} permission prompt(s) queued`, "info");
	}

	let release!: () => void;
	const prev = q.chain;
	q.chain = new Promise<void>((r) => {
		release = r;
	});

	await prev;
	q.pending--;

	try {
		return await ui.select(message, options, opts);
	} finally {
		release();
	}
}

// Result returned by queuedApproval: the choice plus an optional note the user
// typed inline (triggered by pressing Tab on a note-capable option).
export interface ApprovalResult {
	choice: string | undefined;
	note?: string;
}

// Minimal shape of ui.custom() required by queuedApproval.
// Typed loosely so it accepts the full ExtensionUIContext without importing
// pi-coding-agent types into this shared utility.
interface ApprovalUI {
	// biome-ignore lint/suspicious/noExplicitAny: factory args are typed by pi-tui/pi-coding-agent internals
	custom<T>(
		factory: (tui: any, theme: any, kb: any, done: (r: T) => void) => any,
	): Promise<T>;
	notify(message: string, level?: string): void;
}

/**
 * Approval prompt with optional inline note.
 *
 * Shows a select list. For each option in `noteOptions`, pressing Tab while
 * that option is highlighted enters note mode: the label becomes "<label>, "
 * and the user types a note after it. Enter confirms; Esc returns to the list.
 *
 * Returns `{ choice, note? }`. `note` is undefined when confirmed without one.
 */
export async function queuedApproval(
	ui: ApprovalUI,
	message: string,
	options: string[],
	noteOptions: ReadonlySet<string>,
): Promise<ApprovalResult> {
	const q = getQueue();
	q.pending++;

	if (q.pending > 1) {
		ui.notify(`${q.pending - 1} permission prompt(s) queued`, "info");
	}

	let release!: () => void;
	const prev = q.chain;
	q.chain = new Promise<void>((r) => {
		release = r;
	});

	await prev;
	q.pending--;

	try {
		return await ui.custom<ApprovalResult>((tui, theme, _kb, done) => {
			const slTheme = {
				selectedPrefix: (t: string) => theme.fg("accent", t),
				selectedText: (t: string) => theme.fg("accent", t),
				description: (t: string) => theme.fg("muted", t),
				scrollInfo: (t: string) => theme.fg("dim", t),
				noMatch: (t: string) => theme.fg("warning", t),
			};
			const items = options.map((o) => ({ value: o, label: o }));
			const selectList = new SelectList(items, options.length + 2, slTheme);
			const input = new Input();
			input.focused = true;

			let noteMode = false;
			let noteChoice = "";

			selectList.onSelect = (item) => done({ choice: item.value });
			selectList.onCancel = () => done({ choice: undefined });

			return {
				render(width: number): string[] {
					if (noteMode) {
						const prefix = `${noteChoice}, `;
						// Input renders one line; prepend the choice label as prefix.
						const inputLine =
							input.render(Math.max(1, width - prefix.length))[0] ?? "";
						return [message, prefix + inputLine];
					}
					return [message, ...selectList.render(width)];
				},
				handleInput(data: string) {
					if (noteMode) {
						if (matchesKey(data, Key.escape)) {
							// Esc: discard note, return to select
							noteMode = false;
							noteChoice = "";
							input.setValue("");
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.enter)) {
							// Enter: confirm with note (empty = undefined)
							done({
								choice: noteChoice,
								note: input.getValue().trim() || undefined,
							});
							return;
						}
						input.handleInput(data);
						tui.requestRender();
						return;
					}
					// Select mode: intercept Tab for note-capable options
					if (matchesKey(data, Key.tab)) {
						const selected = selectList.getSelectedItem();
						if (selected && noteOptions.has(selected.value)) {
							noteMode = true;
							noteChoice = selected.value;
							tui.requestRender();
							return;
						}
					}
					selectList.handleInput(data);
					tui.requestRender();
				},
				invalidate() {
					selectList.invalidate();
					input.invalidate();
				},
			};
		});
	} finally {
		release();
	}
}
