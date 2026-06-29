import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { promises as dns } from "node:dns";
import { fetchText, validateUrl, validateUrlWithDns } from "./fetcher.ts";

const originalFetch = globalThis.fetch;
const setFetch = (impl: unknown) => {
	globalThis.fetch = impl as typeof fetch;
};

// Always return a benign public IP for hostname lookups in tests so we don't
// hit real DNS or fail on private addresses that only exist on CI.
const originalLookup = dns.lookup.bind(dns);
dns.lookup = mock(async () => [
	{ address: "93.184.216.34", family: 4 },
]) as unknown as typeof dns.lookup;

afterEach(() => {
	globalThis.fetch = originalFetch;
	// Reset to benign mock so per-test DNS overrides don't bleed into subsequent tests.
	dns.lookup = mock(async () => [
		{ address: "93.184.216.34", family: 4 },
	]) as unknown as typeof dns.lookup;
});

afterAll(() => {
	dns.lookup = originalLookup;
});

test("accepts https URL", () => {
	expect(() => validateUrl("https://example.com/path")).not.toThrow();
});

test("rejects http URL", () => {
	expect(() => validateUrl("http://example.com")).toThrow(
		"Only HTTPS URLs allowed",
	);
});

test("rejects non-URL string", () => {
	expect(() => validateUrl("not a url")).toThrow("Invalid URL");
});

test("rejects ftp URL", () => {
	expect(() => validateUrl("ftp://files.example.com")).toThrow(
		"Only HTTPS URLs allowed",
	);
});

test("returns plain text as-is", async () => {
	setFetch(
		mock(() =>
			Promise.resolve(
				new Response("hello world", {
					headers: { "content-type": "text/plain" },
				}),
			),
		),
	);
	expect(await fetchText("https://example.com")).toBe("hello world");
});

test("strips HTML tags for text/html", async () => {
	setFetch(
		mock(() =>
			Promise.resolve(
				new Response("<html><body><p>Hello world</p></body></html>", {
					headers: { "content-type": "text/html" },
				}),
			),
		),
	);
	const result = await fetchText("https://example.com");
	expect(result).not.toContain("<");
	expect(result).toContain("Hello world");
});

test("throws on HTTP error status", async () => {
	setFetch(
		mock(() => Promise.resolve(new Response("Not Found", { status: 404 }))),
	);
	await expect(fetchText("https://example.com")).rejects.toThrow("HTTP 404");
});

test("throws on non-HTTPS URL", async () => {
	await expect(fetchText("http://example.com")).rejects.toThrow(
		"Only HTTPS URLs allowed",
	);
});

test("rejects IPv6 loopback ::1", () => {
	expect(() => validateUrl("https://[::1]/path")).toThrow("Blocked host");
});

test("rejects IPv4-mapped loopback ::ffff:127.0.0.1", () => {
	expect(() => validateUrl("https://[::ffff:127.0.0.1]/")).toThrow(
		"Blocked host",
	);
});

test("rejects IPv4-mapped private ::ffff:192.168.1.1", () => {
	expect(() => validateUrl("https://[::ffff:192.168.1.1]/")).toThrow(
		"Blocked host",
	);
});

test("rejects ULA fc address", () => {
	expect(() => validateUrl("https://[fc00::1]/")).toThrow("Blocked host");
});

test("rejects ULA fd address", () => {
	expect(() => validateUrl("https://[fd12:3456::1]/")).toThrow("Blocked host");
});

test("rejects link-local fe80 address", () => {
	expect(() => validateUrl("https://[fe80::1]/")).toThrow("Blocked host");
});

// ---- DNS rebinding test ----

test("validateUrlWithDns blocks hostname that resolves to private IP", async () => {
	dns.lookup = mock(async () => [
		{ address: "192.168.1.1", family: 4 },
	]) as unknown as typeof dns.lookup;
	await expect(validateUrlWithDns("https://evil.example.com/")).rejects.toThrow(
		"Blocked host",
	);
});

// ---- redirect SSRF tests ----

test("fetchText blocks redirect to private IP", async () => {
	setFetch(
		mock(async (url: string) => {
			if (url === "https://evil.com/") {
				return new Response("", {
					status: 302,
					headers: { location: "https://192.168.1.1/admin" },
				});
			}
			return new Response("private data");
		}),
	);
	await expect(fetchText("https://evil.com/")).rejects.toThrow("Blocked host");
});

test("fetchText follows safe redirects", async () => {
	setFetch(
		mock(async (url: string) => {
			if (url === "https://short.example.com/") {
				return new Response("", {
					status: 301,
					headers: { location: "https://docs.example.com/page" },
				});
			}
			return new Response("content", {
				headers: { "content-type": "text/plain" },
			});
		}),
	);
	expect(await fetchText("https://short.example.com/")).toBe("content");
});

test("fetchText throws on too many redirects", async () => {
	setFetch(
		mock(
			async () =>
				new Response("", {
					status: 302,
					headers: { location: "https://loop.example.com/" },
				}),
		),
	);
	await expect(fetchText("https://loop.example.com/")).rejects.toThrow(
		"Too many redirects",
	);
});

// ---- body size limit test ----

test("fetchText reads at most MAX_RESPONSE_BYTES", async () => {
	// 3 MB body — should not OOM, should return truncated text
	const big = "x".repeat(3 * 1024 * 1024);
	setFetch(
		mock(() =>
			Promise.resolve(
				new Response(big, { headers: { "content-type": "text/plain" } }),
			),
		),
	);
	const result = await fetchText("https://example.com");
	// Result must be shorter than the full 3 MB body
	expect(result.length).toBeLessThan(big.length);
});
