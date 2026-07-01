import { expect, test } from "bun:test";
import {
	isValidPattern,
	matchesPattern,
	normalizePaths,
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

// quote-aware splitting

test("splitSegments: double-quoted | is not a separator", () => {
	expect(splitSegments('grep -E "foo|bar" file')).toEqual([
		'grep -E "foo|bar" file',
	]);
});

test("splitSegments: single-quoted | is not a separator", () => {
	expect(splitSegments("grep -E 'foo|bar' file")).toEqual([
		"grep -E 'foo|bar' file",
	]);
});

test("splitSegments: BRE \\| inside double quotes is not a separator", () => {
	expect(splitSegments('grep "foo\\|bar" file')).toEqual([
		'grep "foo\\|bar" file',
	]);
});

test("splitSegments: unquoted | after backslash-escaped quote splits correctly", () => {
	// cmd arg\" | rm -rf / — exploit case: \" is a literal quote char, not opening a string
	expect(splitSegments('cmd arg\\" | rm -rf /')).toEqual([
		'cmd arg\\"',
		"rm -rf /",
	]);
});

test("splitSegments: unmatched double quote returns null (block)", () => {
	// Unmatched quote → could hide segments via quote-state exploit
	expect(splitSegments('cmd "foo | rm -rf /')).toBeNull();
});

test("splitSegments: unmatched single quote returns null (block)", () => {
	expect(splitSegments("cmd 'foo | rm -rf /")).toBeNull();
});

test("splitSegments: properly closed quotes then unquoted pipe splits", () => {
	// echo 'it'\''s' | cat — single-quoted with escaped apostrophe
	expect(splitSegments("echo 'it'\\''s' | cat")).toEqual([
		"echo 'it'\\''s'",
		"cat",
	]);
});

test("splitSegments: escaped double quote inside double quotes stays in string", () => {
	expect(splitSegments('echo "say \\"hi\\" | cat"')).toEqual([
		'echo "say \\"hi\\" | cat"',
	]);
});

test("splitSegments: && outside quotes splits", () => {
	expect(splitSegments('echo "hello" && rm -rf /')).toEqual([
		'echo "hello"',
		"rm -rf /",
	]);
});

test("splitSegments: && inside quotes does not split", () => {
	expect(splitSegments('echo "hello && world"')).toEqual([
		'echo "hello && world"',
	]);
});

// normalizePaths

test("normalizePaths: /home/user/ prefix → ~/", () => {
	expect(normalizePaths("ls /home/alice/projects", "/home/alice")).toBe(
		"ls ~/projects",
	);
});

test("normalizePaths: /Users/user/ prefix → ~/", () => {
	expect(normalizePaths("ls /Users/alice/projects", "/Users/alice")).toBe(
		"ls ~/projects",
	);
});

test("normalizePaths: $HOME/ → ~/", () => {
	expect(normalizePaths("ls $HOME/projects", "/home/alice")).toBe(
		"ls ~/projects",
	);
});

test("normalizePaths: already ~ → unchanged", () => {
	expect(normalizePaths("ls ~/projects", "/home/alice")).toBe("ls ~/projects");
});

test("normalizePaths: multiple occurrences all rewritten", () => {
	expect(
		normalizePaths(
			"cp /home/alice/a.txt /home/alice/b.txt",
			"/home/alice",
		),
	).toBe("cp ~/a.txt ~/b.txt");
});

test("normalizePaths: path not under home → unchanged", () => {
	expect(normalizePaths("ls /etc/passwd", "/home/alice")).toBe(
		"ls /etc/passwd",
	);
});

test("normalizePaths: home as exact arg (no trailing slash) → ~", () => {
	expect(normalizePaths("ls /home/alice", "/home/alice")).toBe("ls ~");
});

test("normalizePaths: empty home → unchanged", () => {
	expect(normalizePaths("ls /home/alice/foo", "")).toBe("ls /home/alice/foo");
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
