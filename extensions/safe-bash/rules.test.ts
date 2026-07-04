import { expect, test } from "bun:test";
import {
	isValidPattern,
	matchesAllowlistEntry,
	matchesPattern,
	normalizePaths,
	isPureAssignment,
	parseConfined,
	resolveAbs,
	splitSegments,
	suggestPattern,
	withinBase,
} from "./rules.ts";

const CWD = "/Users/me/code/proj";
const HOME = "/Users/me";

// isPureAssignment

test("isPureAssignment: simple value assignments are pure", () => {
	expect(isPureAssignment("SCRIPTS=/path/to/scripts")).toBe(true);
	expect(isPureAssignment("FOO=bar")).toBe(true);
	expect(isPureAssignment("_VAR=123")).toBe(true);
	expect(isPureAssignment("MY_VAR=hello world")).toBe(true);
});

test("isPureAssignment: command substitution in value is not pure", () => {
	expect(isPureAssignment("VAR=$(rm -rf /)")).toBe(false);
	expect(isPureAssignment("VAR=`rm -rf /`")).toBe(false);
});

test("isPureAssignment: assignment-prefixed commands are not pure", () => {
	// env-style prefix (space before the command) is not a bare assignment
	expect(isPureAssignment("env FOO=bar cmd")).toBe(false);
});

test("isPureAssignment: plain commands are not assignments", () => {
	expect(isPureAssignment("git status")).toBe(false);
	expect(isPureAssignment("cd /tmp")).toBe(false);
	expect(isPureAssignment("sqlc generate 2>&1")).toBe(false);
});

test("isPureAssignment: empty and invalid identifier forms", () => {
	expect(isPureAssignment("")).toBe(false);
	expect(isPureAssignment("=value")).toBe(false); // no name
	expect(isPureAssignment("1VAR=x")).toBe(false); // starts with digit
});


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

test("splitSegments splits on newline and single & (each is a new command)", () => {
	expect(splitSegments("cat ok\nrm -rf ./trash")).toEqual([
		"cat ok",
		"rm -rf ./trash",
	]);
	expect(splitSegments("cat ok & rm -rf ./trash")).toEqual([
		"cat ok",
		"rm -rf ./trash",
	]);
	// quoted separators are still preserved (quote-aware)
	expect(splitSegments("echo 'a&b'")).toEqual(["echo 'a&b'"]);
});

test("splitSegments: >& fd redirect is not a separator (e.g. 2>&1)", () => {
	expect(splitSegments("sqlc generate 2>&1")).toEqual(["sqlc generate 2>&1"]);
	expect(splitSegments("cmd >&2")).toEqual(["cmd >&2"]);
	expect(splitSegments("cmd 3>&-")).toEqual(["cmd 3>&-"]);
});

test("splitSegments: &> and &>> redirect-both-streams are not separators", () => {
	expect(splitSegments("make build &>/dev/null")).toEqual([
		"make build &>/dev/null",
	]);
	expect(splitSegments("make build &>> /tmp/out.log")).toEqual([
		"make build &>> /tmp/out.log",
	]);
});

test("splitSegments: bare & background operator still splits", () => {
	expect(splitSegments("cmd &")).toEqual(["cmd"]);
	expect(splitSegments("cmd & cmd2")).toEqual(["cmd", "cmd2"]);
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

// heredoc support

test("splitSegments: heredoc with single-quoted delimiter is one segment", () => {
	const cmd = "cat >> /tmp/file.md << 'EOF'\nhello\nworld\nEOF";
	expect(splitSegments(cmd)).toEqual([cmd]);
});

test("splitSegments: heredoc with unquoted delimiter is one segment", () => {
	const cmd = "cat >> /tmp/file.md << EOF\nhello\nworld\nEOF";
	expect(splitSegments(cmd)).toEqual([cmd]);
});

test("splitSegments: heredoc with double-quoted delimiter is one segment", () => {
	const cmd = 'cat >> /tmp/file.md << "EOF"\nhello\nEOF';
	expect(splitSegments(cmd)).toEqual([cmd]);
});

test("splitSegments: heredoc with custom delimiter (FOO) is one segment", () => {
	const cmd = "cat >> /tmp/file.md << 'FOO'\nsome content\nFOO";
	expect(splitSegments(cmd)).toEqual([cmd]);
});

test("splitSegments: heredoc with multi-line body is one segment", () => {
	const cmd =
		"cat >> /tmp/progress.md << 'EOF'\n\n---\n\n# Progress\n\nTask 1: pending\nEOF";
	expect(splitSegments(cmd)).toEqual([cmd]);
});

test("splitSegments: <<- strips leading tabs from terminator", () => {
	const cmd = "cat <<-EOF\n\thello\nEOF";
	expect(splitSegments(cmd)).toEqual([cmd]);
});

test("splitSegments: heredoc followed by && splits into two segments", () => {
	const heredocPart = "cat >> /tmp/a << 'EOF'\ncontent\nEOF";
	const cmd = `${heredocPart}\n&& echo done`;
	expect(splitSegments(cmd)).toEqual([heredocPart, "echo done"]);
});

test("splitSegments: <<< (herestring) is not treated as heredoc", () => {
	// herestring — the <<< and its word stay as one segment, no split
	const cmd = "cat <<< 'hello world'";
	expect(splitSegments(cmd)).toEqual([cmd]);
});

test("splitSegments: unterminated heredoc (no closing delimiter) is one segment", () => {
	const cmd = "cat << 'EOF'\nsome content without closing";
	expect(splitSegments(cmd)).toEqual([cmd]);
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
		normalizePaths("cp /home/alice/a.txt /home/alice/b.txt", "/home/alice"),
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

test("normalizePaths: cwd prefix → ./", () => {
	expect(
		normalizePaths(
			"ls /home/alice/code/myproject/src",
			"/home/alice",
			"/home/alice/code/myproject",
		),
	).toBe("ls ./src");
});

test("normalizePaths: cwd exact match → .", () => {
	expect(
		normalizePaths(
			"ls /home/alice/code/myproject",
			"/home/alice",
			"/home/alice/code/myproject",
		),
	).toBe("ls .");
});

test("normalizePaths: cwd rewrite takes priority over home rewrite", () => {
	// cwd is under home — should become ./, not ~/code/myproject/src
	expect(
		normalizePaths(
			"ls /home/alice/code/myproject/src",
			"/home/alice",
			"/home/alice/code/myproject",
		),
	).toBe("ls ./src");
});

test("normalizePaths: path outside cwd but under home → ~/", () => {
	expect(
		normalizePaths(
			"ls /home/alice/other",
			"/home/alice",
			"/home/alice/code/myproject",
		),
	).toBe("ls ~/other");
});

test("normalizePaths: no cwd provided → only home normalization", () => {
	expect(normalizePaths("ls /home/alice/src", "/home/alice")).toBe("ls ~/src");
});

test("normalizePaths: ~/subdir rewritten to ./ when under cwd", () => {
	expect(
		normalizePaths(
			"ls ~/code/myproject/src",
			"/home/alice",
			"/home/alice/code/myproject",
		),
	).toBe("ls ./src");
});

test("normalizePaths: ~/other not under cwd stays ~/other", () => {
	expect(
		normalizePaths("ls ~/other", "/home/alice", "/home/alice/code/myproject"),
	).toBe("ls ~/other");
});

test("normalizePaths: ~ alone (exact cwd) → .", () => {
	expect(normalizePaths("ls ~", "/home/alice", "/home/alice")).toBe("ls .");
});

test("suggestPattern globs the first token", () => {
	expect(suggestPattern("git push origin main")).toBe("git *");
	expect(suggestPattern("  rm -rf foo  ")).toBe("rm *");
});

test("suggestPattern returns empty string for an empty command", () => {
	expect(suggestPattern("")).toBe("");
});

test("suggestPattern: bare command → cmd *", () => {
	expect(suggestPattern("ls")).toBe("ls *");
});

test("suggestPattern: command with args → cmd *", () => {
	expect(suggestPattern("ls -la")).toBe("ls *");
});

test("matchesPattern: bare command matches its own exact pattern", () => {
	expect(matchesPattern("ls", "ls")).toBe(true);
});

test("matchesPattern: trailing ' *' matches the bare command (no args)", () => {
	expect(matchesPattern("ls", "ls *")).toBe(true);
	expect(matchesPattern("ls -la", "ls *")).toBe(true);
	expect(matchesPattern("git status", "git status *")).toBe(true);
	expect(matchesPattern("git status -s", "git status *")).toBe(true);
});

test("matchesPattern: trailing ' *' does not match a different command", () => {
	expect(matchesPattern("lsof", "ls *")).toBe(false);
	expect(matchesPattern("npm status", "git status *")).toBe(false);
});

// resolveAbs

test("resolveAbs: absolute path is normalized, not joined", () => {
	expect(resolveAbs("/etc/passwd", CWD, HOME)).toBe("/etc/passwd");
	expect(resolveAbs("/var/./log/../log", CWD, HOME)).toBe("/var/log");
});

test("resolveAbs: ~ expands against home", () => {
	expect(resolveAbs("~/code/x", CWD, HOME)).toBe("/Users/me/code/x");
	expect(resolveAbs("~", CWD, HOME)).toBe("/Users/me");
});

test("resolveAbs: relative and ./ join against cwd, .. collapses", () => {
	expect(resolveAbs("README.md", CWD, HOME)).toBe(
		"/Users/me/code/proj/README.md",
	);
	expect(resolveAbs("./sub/../file", CWD, HOME)).toBe(
		"/Users/me/code/proj/file",
	);
	expect(resolveAbs("../x", CWD, HOME)).toBe("/Users/me/code/x");
});

// parseConfined

test("parseConfined: splits prefix and base off a trailing /*", () => {
	expect(parseConfined("cat ./*", CWD, HOME)).toEqual({
		prefix: "cat",
		base: ".",
	});
	expect(parseConfined("find ~/code/*", CWD, HOME)).toEqual({
		prefix: "find",
		base: "~/code",
	});
	expect(parseConfined("git log ./*", CWD, HOME)).toEqual({
		prefix: "git log",
		base: ".",
	});
	expect(parseConfined("tail /var/log/*", CWD, HOME)).toEqual({
		prefix: "tail",
		base: "/var/log",
	});
});

test("parseConfined: null for non-confined patterns", () => {
	expect(parseConfined("grep *", CWD, HOME)).toBeNull(); // trailing ' *', not '/*'
	expect(parseConfined("find ~/code/x", CWD, HOME)).toBeNull(); // no trailing /*
	expect(parseConfined("cat", CWD, HOME)).toBeNull(); // no /* and no space
});

test("parseConfined: null for root/degenerate bases", () => {
	expect(parseConfined("/*", CWD, HOME)).toBeNull(); // no command before base
	expect(parseConfined("cat /*", CWD, HOME)).toBeNull(); // base empty after dropping /*
	expect(parseConfined("cat //*", CWD, HOME)).toBeNull(); // base '/' resolves to root
});

// withinBase

// cwd is under ~/code, so bare-relative args resolve inside a ~/code base too.
const within = (cmd: string, prefix: string, base: string) =>
	withinBase(cmd, prefix, base, CWD, HOME);

test("withinBase: cwd base allows in-tree, bare names, flags, stdin", () => {
	expect(within("cat README.md", "cat", ".")).toBe(true);
	expect(within("cat -n README.md", "cat", ".")).toBe(true);
	expect(within("cat ./src/x", "cat", ".")).toBe(true);
	expect(within("cat ./sub/../file", "cat", ".")).toBe(true); // collapses in-tree
	expect(within("cat", "cat", ".")).toBe(true); // stdin, no args
});

test("withinBase: cwd base prompts on escapes", () => {
	expect(within("cat /etc/passwd", "cat", ".")).toBe(false);
	expect(within("cat ./../../etc/passwd", "cat", ".")).toBe(false);
	expect(within("cat ../x", "cat", ".")).toBe(false);
});

test("withinBase: prefix must be token-aligned", () => {
	expect(within("lsof foo", "ls", ".")).toBe(false);
	expect(within("npm x", "cat", ".")).toBe(false);
	expect(within("ls", "ls", ".")).toBe(true);
});

test("withinBase: home and absolute bases", () => {
	expect(within("find ~/code/foo -name x", "find", "~/code")).toBe(true);
	expect(within("find /etc -name x", "find", "~/code")).toBe(false);
	expect(within("find ~/../../etc", "find", "~/code")).toBe(false);
	expect(within("tail /var/log/syslog", "tail", "/var/log")).toBe(true);
	expect(within("tail /etc/x", "tail", "/var/log")).toBe(false);
});

test("withinBase: --file= is split before the flag skip", () => {
	expect(within("cat --file=/etc/passwd", "cat", ".")).toBe(false);
});

test("withinBase: all quote chars stripped (concat escape)", () => {
	expect(within('cat "../../etc/passwd"', "cat", ".")).toBe(false);
	expect(within('cat ".."/../etc/passwd', "cat", ".")).toBe(false);
});

test("withinBase: glued flag+path bails to a prompt", () => {
	expect(within("grep -f/etc/shadow", "grep", ".")).toBe(false);
	expect(within("cat -n README.md", "cat", ".")).toBe(true); // pure flag still skipped
});

test("withinBase: multi-word prefix", () => {
	expect(within("git log ./x", "git log", ".")).toBe(true);
	expect(within("git log /abs", "git log", ".")).toBe(false);
});

test("withinBase: newline-spanning args never approved (multi-command)", () => {
	// A second command smuggled after a newline must not ride in as `cat`'s args.
	expect(within("cat README.md\nrm -rf ./trash", "cat", ".")).toBe(false);
	expect(within("cat ok\rcurl http://evil", "cat", ".")).toBe(false);
});

test("withinBase: unexpanded shell variables fail safe", () => {
	expect(within("cat $SECRET", "cat", ".")).toBe(false);
	// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell variable under test
	expect(within("cat ${SECRET}", "cat", ".")).toBe(false);
	expect(within("cat --file=$SECRET", "cat", ".")).toBe(false);
});

// matchesAllowlistEntry

const allow = (cmd: string, pat: string) =>
	matchesAllowlistEntry(cmd, pat, CWD, HOME);

test("matchesAllowlistEntry: confined entries use containment", () => {
	expect(allow("cat README.md", "cat ./*")).toBe(true);
	expect(allow("cat /etc/passwd", "cat ./*")).toBe(false);
	expect(allow("find ~/code/foo", "find ~/code/*")).toBe(true);
});

test("matchesAllowlistEntry: non-confined entries fall back to glob", () => {
	expect(allow("grep -i foo", "grep *")).toBe(true); // trailing ' *' glob
	expect(allow("ls", "ls *")).toBe(true); // trailing ' *' still matches bare
	expect(allow("git status -s", "git status *")).toBe(true);
	expect(allow("rm -rf /", "git status *")).toBe(false);
});

test("matchesAllowlistEntry: bare /* is a glob, not confined", () => {
	// base empty after dropping /* → parseConfined returns null → plain glob
	expect(allow("cat /etc/x", "cat /*")).toBe(true);
});

// integration: normalizePaths → matchesAllowlistEntry

test("integration: normalizePaths then confined match (cwd-absolute + home)", () => {
	// A cwd-absolute path normalizes to ./… then matches a cwd-confined entry.
	const abs = normalizePaths(`cat ${CWD}/README.md`, HOME, CWD);
	expect(matchesAllowlistEntry(abs, "cat ./*", CWD, HOME)).toBe(true);
	// A home path normalizes to ~/… then matches a home-confined entry.
	const homePath = normalizePaths(`ls ${HOME}/code/x`, HOME, CWD);
	expect(matchesAllowlistEntry(homePath, "ls ~/code/*", CWD, HOME)).toBe(true);
	// An out-of-tree absolute path still prompts.
	expect(matchesAllowlistEntry("cat /etc/passwd", "cat ./*", CWD, HOME)).toBe(
		false,
	);
});
