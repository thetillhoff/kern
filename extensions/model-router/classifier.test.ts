import { test, expect, mock, afterEach } from "bun:test";
import { callOllama } from "./classifier.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function ollamaResponse(text: string, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify({ response: text }), { status: ok ? 200 : 500 })
  );
}

test("returns tier from ollama response", async () => {
  globalThis.fetch = mock(() => ollamaResponse("heavy"));
  expect(await callOllama("http://localhost:11434", "qwen3:4b", "design the architecture", 2000)).toBe("heavy");
});

test("picks first valid word from verbose response", async () => {
  globalThis.fetch = mock(() => ollamaResponse("I think this is medium complexity."));
  expect(await callOllama("http://localhost:11434", "qwen3:4b", "write a function", 2000)).toBe("medium");
});

test("returns null for unrecognized response", async () => {
  globalThis.fetch = mock(() => ollamaResponse("unknown"));
  expect(await callOllama("http://localhost:11434", "qwen3:4b", "hi", 2000)).toBeNull();
});

test("returns null on non-ok response", async () => {
  globalThis.fetch = mock(() => ollamaResponse("", false));
  expect(await callOllama("http://localhost:11434", "qwen3:4b", "hi", 2000)).toBeNull();
});

test("returns null on network error", async () => {
  globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));
  expect(await callOllama("http://localhost:11434", "qwen3:4b", "hi", 2000)).toBeNull();
});

test("returns null on timeout", async () => {
  globalThis.fetch = mock(
    () => new Promise((_, reject) => setTimeout(() => reject(new DOMException("aborted", "AbortError")), 50))
  );
  expect(await callOllama("http://localhost:11434", "qwen3:4b", "hi", 10)).toBeNull();
});
