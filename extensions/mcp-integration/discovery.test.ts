import { afterEach, expect, mock, test } from "bun:test";
import { fetchMcpTools } from "./discovery.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("returns tools from server response", async () => {
	const tools = [
		{ name: "read_file", description: "Read a file", parameters: [] },
	];
	globalThis.fetch = mock(() =>
		Promise.resolve(new Response(JSON.stringify({ tools }))),
	);
	const result = await fetchMcpTools("http://localhost:3000");
	expect(result).toHaveLength(1);
	expect(result[0].name).toBe("read_file");
});

test("returns empty array on non-ok response", async () => {
	globalThis.fetch = mock(() =>
		Promise.resolve(new Response("Error", { status: 500 })),
	);
	expect(await fetchMcpTools("http://localhost:3000")).toEqual([]);
});

test("returns empty array on network error", async () => {
	globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));
	expect(await fetchMcpTools("http://localhost:3000")).toEqual([]);
});

test("returns empty array when tools key missing", async () => {
	globalThis.fetch = mock(() =>
		Promise.resolve(new Response(JSON.stringify({ other: "data" }))),
	);
	expect(await fetchMcpTools("http://localhost:3000")).toEqual([]);
});
