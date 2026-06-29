import { expect, test } from "bun:test";
import { queuedSelect } from "./permission-queue.ts";

function makeUI(response: string) {
	const log: string[] = [];
	return {
		log,
		ui: {
			async select(_msg: string, _opts: string[]) {
				return response;
			},
			notify(msg: string) {
				log.push(msg);
			},
		},
	};
}

test("resolves with select result", async () => {
	const { ui } = makeUI("Allow once");
	const result = await queuedSelect(ui, "Approve?", ["Allow once", "Deny"]);
	expect(result).toBe("Allow once");
});

test("serializes concurrent prompts — second select not called until first returns", async () => {
	let resolveFirst!: (v: string) => void;
	let secondSelectCalled = false;

	const ui1 = {
		notify() {},
		select() {
			return new Promise<string>((r) => {
				resolveFirst = r;
			});
		},
	};
	const ui2 = {
		notify() {},
		async select() {
			secondSelectCalled = true;
			return "Deny";
		},
	};

	const p1 = queuedSelect(ui1, "First", ["Allow once"]);
	const p2 = queuedSelect(ui2, "Second", ["Deny"]);

	// flush microtasks so queuedSelect reaches the ui.select() call
	await Promise.resolve();
	await Promise.resolve();

	expect(secondSelectCalled).toBe(false); // p2 blocked behind p1

	resolveFirst("Allow once");
	await Promise.all([p1, p2]);

	expect(secondSelectCalled).toBe(true); // p2 ran after p1 finished
});

test("notifies when prompt is queued behind another", async () => {
	const notified: string[] = [];
	let resolveFirst!: (v: string) => void;

	const ui1 = {
		notify(msg: string) {
			notified.push(msg);
		},
		select() {
			return new Promise<string>((r) => {
				resolveFirst = r;
			});
		},
	};
	const ui2 = {
		notify(msg: string) {
			notified.push(msg);
		},
		async select() {
			return "Deny";
		},
	};

	const p1 = queuedSelect(ui1, "First", ["Allow once"]);
	const p2 = queuedSelect(ui2, "Second", ["Deny"]);

	await Promise.resolve();
	await Promise.resolve();

	expect(notified.some((m) => m.includes("queued"))).toBe(true);

	resolveFirst("Allow once");
	await Promise.all([p1, p2]);
});
