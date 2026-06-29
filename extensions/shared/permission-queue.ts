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
