import { test, expect, mock, afterEach } from "bun:test";
import { callClassifier } from "./classifier.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("returns tier from X-Router-Tier header", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({}), {
        headers: { "x-router-tier": "heavy" },
      })
    )
  );
  const tier = await callClassifier("http://localhost:8080", [{ role: "user", content: "hi" }], 2000);
  expect(tier).toBe("heavy");
});

test("returns null when header missing", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({})))
  );
  const tier = await callClassifier("http://localhost:8080", [{ role: "user", content: "hi" }], 2000);
  expect(tier).toBeNull();
});

test("returns null on network error", async () => {
  globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));
  const tier = await callClassifier("http://localhost:8080", [], 2000);
  expect(tier).toBeNull();
});

test("returns null on abort (timeout)", async () => {
  globalThis.fetch = mock(
    () => new Promise((_, reject) => setTimeout(() => reject(new DOMException("aborted", "AbortError")), 50))
  );
  const tier = await callClassifier("http://localhost:8080", [], 10);
  expect(tier).toBeNull();
});
