import { test, expect, mock, afterEach } from "bun:test";
import { validateUrl, fetchText } from "./fetcher.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("accepts https URL", () => {
  expect(() => validateUrl("https://example.com/path")).not.toThrow();
});

test("rejects http URL", () => {
  expect(() => validateUrl("http://example.com")).toThrow("Only HTTPS URLs allowed");
});

test("rejects non-URL string", () => {
  expect(() => validateUrl("not a url")).toThrow("Invalid URL");
});

test("rejects ftp URL", () => {
  expect(() => validateUrl("ftp://files.example.com")).toThrow("Only HTTPS URLs allowed");
});

test("returns plain text as-is", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response("hello world", {
        headers: { "content-type": "text/plain" },
      })
    )
  );
  expect(await fetchText("https://example.com")).toBe("hello world");
});

test("strips HTML tags for text/html", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response("<html><body><p>Hello world</p></body></html>", {
        headers: { "content-type": "text/html" },
      })
    )
  );
  const result = await fetchText("https://example.com");
  expect(result).not.toContain("<");
  expect(result).toContain("Hello world");
});

test("throws on HTTP error status", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response("Not Found", { status: 404 }))
  );
  await expect(fetchText("https://example.com")).rejects.toThrow("HTTP 404");
});

test("throws on non-HTTPS URL", async () => {
  await expect(fetchText("http://example.com")).rejects.toThrow("Only HTTPS URLs allowed");
});
