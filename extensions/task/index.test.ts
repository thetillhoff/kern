import { expect, test } from "bun:test";
import { lastAssistantText } from "./index.ts";

test("extracts and concatenates text from last assistant message", () => {
	const messages = [
		{ role: "user", content: "hi" },
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "hmm" },
				{ type: "text", text: "Hello " },
				{ type: "toolCall", id: "1", name: "x", arguments: {} },
				{ type: "text", text: "world" },
			],
		},
	];
	expect(lastAssistantText(messages)).toBe("Hello world");
});

test("returns last assistant message, not earlier ones", () => {
	const messages = [
		{ role: "assistant", content: [{ type: "text", text: "first" }] },
		{ role: "toolResult", content: [{ type: "text", text: "tool out" }] },
		{ role: "assistant", content: [{ type: "text", text: "final" }] },
	];
	expect(lastAssistantText(messages)).toBe("final");
});

test("returns empty string when no assistant message", () => {
	expect(lastAssistantText([{ role: "user", content: "hi" }])).toBe("");
});
