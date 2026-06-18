import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMcpConfig } from "./config.ts";

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

test("returns empty servers when file missing", () => {
  expect(loadMcpConfig("/nonexistent/mcp.json")).toEqual({ servers: [] });
});

test("loads valid config", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-"));
  tmpDirs.push(dir);
  const p = join(dir, "mcp.json");
  writeFileSync(p, JSON.stringify({ servers: [{ name: "fs", url: "http://localhost:3000" }] }));
  const result = loadMcpConfig(p);
  expect(result.servers).toHaveLength(1);
  expect(result.servers[0].name).toBe("fs");
});

test("returns empty on malformed JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-"));
  tmpDirs.push(dir);
  const p = join(dir, "mcp.json");
  writeFileSync(p, "not json");
  expect(loadMcpConfig(p)).toEqual({ servers: [] });
});
