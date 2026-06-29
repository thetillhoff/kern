import { expect, test } from "bun:test";
import {
	isValidPattern,
	matchesPattern,
	splitSegments,
	suggestPattern,
} from "./rules.ts";

test("exact match", () => {
	expect(matchesPattern("git status", "git status")).toBe(true);
});

test("no match", () => {
	expect(matchesPattern("rm -rf /", "git status")).toBe(false);
});

test("wildcard matches suffix", () => {
	expect(matchesPattern("git add src/file.ts", "git add *")).toBe(true);
	expect(matchesPattern("npm install lodash", "npm install *")).toBe(true);
});

test("wildcard does not match partial prefix", () => {
	expect(matchesPattern("git status", "npm *")).toBe(false);
});

test("trimmed command matches", () => {
	expect(matchesPattern("  git status  ", "git status")).toBe(true);
});

test("wildcard matches at any position", () => {
	expect(matchesPattern("git rebase commit foo", "git * commit *")).toBe(true);
	expect(matchesPattern("git status", "* status")).toBe(true);
	expect(matchesPattern("git other", "git * commit *")).toBe(false);
});

test("pattern with separator never matches", () => {
	expect(matchesPattern("git status", "git status | rm *")).toBe(false);
	expect(matchesPattern("git status", "git * && rm *")).toBe(false);
	expect(matchesPattern("git status", "git *; rm *")).toBe(false);
});

test("isValidPattern rejects separators", () => {
	expect(isValidPattern("git *")).toBe(true);
	expect(isValidPattern("git * | rm *")).toBe(false);
	expect(isValidPattern("git * && ls")).toBe(false);
	expect(isValidPattern("git *; ls")).toBe(false);
	expect(isValidPattern("git * || ls")).toBe(false);
});

test("isValidPattern rejects substitution syntax", () => {
	expect(isValidPattern("echo $(rm -rf /)")).toBe(false);
	expect(isValidPattern("echo `rm -rf /`")).toBe(false);
	expect(isValidPattern("git diff <(cat /etc/passwd)")).toBe(false);
	expect(isValidPattern("tee >(cat)")).toBe(false);
});

test("splitSegments splits on every separator", () => {
	expect(splitSegments("echo abc | cat")).toEqual(["echo abc", "cat"]);
	expect(splitSegments("a && b || c ; d | e")).toEqual([
		"a",
		"b",
		"c",
		"d",
		"e",
	]);
});

test("splitSegments treats || as one separator (no empty segments)", () => {
	expect(splitSegments("a || b")).toEqual(["a", "b"]);
});

test("splitSegments returns single segment when no separators", () => {
	expect(splitSegments("git status")).toEqual(["git status"]);
});

test("suggestPattern globs the first token", () => {
	expect(suggestPattern("git push origin main")).toBe("git *");
	expect(suggestPattern("  rm -rf foo  ")).toBe("rm *");
});

test("suggestPattern returns empty string for an empty command", () => {
	expect(suggestPattern("")).toBe("");
});

test("suggestPattern: bare command → exact pattern", () => {
	expect(suggestPattern("ls")).toBe("ls");
});

test("suggestPattern: command with args → cmd *", () => {
	expect(suggestPattern("ls -la")).toBe("ls *");
});

test("matchesPattern: bare command matches its own exact pattern", () => {
	expect(matchesPattern("ls", "ls")).toBe(true);
});

test("matchesPattern: bare command does not match cmd * pattern", () => {
	expect(matchesPattern("ls", "ls *")).toBe(false);
});
