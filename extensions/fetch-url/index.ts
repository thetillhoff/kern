import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchText } from "./fetcher.ts";

const MAX_CHARS = 40_000;

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "fetch_url",
		label: "Fetch URL",
		description:
			"Fetch the text content of an HTTPS URL. Returns plain text; strips HTML tags for web pages. Use for reading documentation, APIs, or any public HTTPS resource.",
		promptSnippet: "Use fetch_url to read any HTTPS web page or API response",
		parameters: Type.Object({
			url: Type.String({ description: "The HTTPS URL to fetch" }),
		}),
		async execute(_toolCallId, params, _signal) {
			const text = await fetchText(params.url);
			const truncated = text.length > MAX_CHARS;
			const content = truncated
				? text.slice(0, MAX_CHARS) + `\n[Truncated: ${text.length} chars total]`
				: text;
			return {
				content: [{ type: "text", text: content }],
				details: { url: params.url, totalChars: text.length, truncated },
			};
		},
	});
}
