import { afterEach, expect, mock, test } from "bun:test";
import { callOllama } from "./classifier.ts";

const originalFetch = globalThis.fetch;
const setFetch = (impl: unknown) => {
	globalThis.fetch = impl as typeof fetch;
};
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function ollamaResponse(text: string, ok = true) {
	return Promise.resolve(
		new Response(JSON.stringify({ response: text }), {
			status: ok ? 200 : 500,
		}),
	);
}

test("returns tier from ollama response", async () => {
	setFetch(mock(() => ollamaResponse("heavy")));
	expect(
		await callOllama(
			"http://localhost:11434",
			"qwen3:4b",
			"design the architecture",
			2000,
		),
	).toBe("heavy");
});

test("picks first valid word from verbose response", async () => {
	setFetch(mock(() => ollamaResponse("I think this is medium complexity.")));
	expect(
		await callOllama(
			"http://localhost:11434",
			"qwen3:4b",
			"write a function",
			2000,
		),
	).toBe("medium");
});

test("returns null for unrecognized response", async () => {
	setFetch(mock(() => ollamaResponse("unknown")));
	expect(
		await callOllama("http://localhost:11434", "qwen3:4b", "hi", 2000),
	).toBeNull();
});

test("returns null on non-ok response", async () => {
	setFetch(mock(() => ollamaResponse("", false)));
	expect(
		await callOllama("http://localhost:11434", "qwen3:4b", "hi", 2000),
	).toBeNull();
});

test("returns null on network error", async () => {
	setFetch(mock(() => Promise.reject(new Error("ECONNREFUSED"))));
	expect(
		await callOllama("http://localhost:11434", "qwen3:4b", "hi", 2000),
	).toBeNull();
});

test("returns null on timeout", async () => {
	setFetch(
		mock(
			() =>
				new Promise((_, reject) =>
					setTimeout(
						() => reject(new DOMException("aborted", "AbortError")),
						50,
					),
				),
		),
	);
	expect(
		await callOllama("http://localhost:11434", "qwen3:4b", "hi", 10),
	).toBeNull();
});
