import { test, expect } from "bun:test";
import { applyRules, estimateTokens } from "./rules.ts";

const rules = [
  { if: { tokenCount: { lt: 300 } }, then: "local" },
  { if: { keywords: ["ls", "grep", "cat"] }, then: "local" },
  { if: { keywords: ["analyze", "architecture"] }, then: "heavy" },
  { if: { tokenCount: { gt: 8000 } }, then: "heavy" },
];

test("no rule matches returns null", () => {
  expect(applyRules("write a function", 1000, rules)).toBeNull();
});

test("short message matches token lt rule", () => {
  expect(applyRules("hi", 50, rules)).toBe("local");
});

test("keyword match for local", () => {
  expect(applyRules("grep for errors in log", 1000, rules)).toBe("local");
});

test("keyword match is case-insensitive", () => {
  expect(applyRules("ANALYZE this codebase", 1000, rules)).toBe("heavy");
});

test("large token count matches gt rule", () => {
  expect(applyRules("refactor something", 9000, rules)).toBe("heavy");
});

test("first matching rule wins (keyword before token gt)", () => {
  expect(applyRules("grep for something", 9000, rules)).toBe("local");
});

test("estimateTokens: 4 chars per token", () => {
  expect(estimateTokens([{ content: "a".repeat(400) }])).toBe(100);
});

test("estimateTokens: joins messages", () => {
  // "aaaa aaaa" = 9 chars → ceil(9/4) = 3
  expect(estimateTokens([{ content: "aaaa" }, { content: "aaaa" }])).toBe(3);
});
