import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadMcpConfig } from "./config.ts";
import { fetchMcpTools, type McpTool } from "./discovery.ts";

export default async function (pi: ExtensionAPI) {
	const configPath = join(homedir(), ".pi", "mcp.json");
	const config = loadMcpConfig(configPath);

	if (config.servers.length === 0) return;

	// Per-server: set of tool names currently registered in pi. Tracks which
	// tools are live so re-registration is skipped only for unchanged tools.
	// A tool removed from a server and re-added with the same name is re-registered
	// on the next discover because prev will no longer contain it.
	const registered = new Map<string, Set<string>>();

	pi.on("resources_discover", async (_event, ctx) => {
		const results = await Promise.all(
			config.servers.map((server) =>
				fetchMcpTools(server.url).then((tools) => ({ server, tools })),
			),
		);

		for (const { server, tools } of results) {
			const prev = registered.get(server.name) ?? new Set<string>();

			if (tools.length === 0) {
				if (prev.size > 0) {
					registered.delete(server.name); // clear so recovery triggers re-registration
					ctx.ui.notify(`MCP: ${server.name} returned no tools`, "warning");
				}
				continue;
			}

			registered.set(server.name, new Set(tools.map((t) => t.name)));

			let count = 0;
			for (const tool of tools) {
				if (prev.has(tool.name)) continue;
				registerMcpTool(pi, server.name, server.url, tool);
				count++;
			}

			if (count > 0) {
				ctx.ui.notify(
					`MCP: registered ${count} tool(s) from ${server.name}`,
					"info",
				);
			}
		}
	});
}

function mcpParamType(type: string, description?: string) {
	switch (type) {
		case "boolean":
			return Type.Boolean({ description });
		case "integer":
			return Type.Integer({ description });
		case "number":
			return Type.Number({ description });
		case "object":
			return Type.Object({}, { description });
		case "array":
			return Type.Array(Type.Unknown(), { description });
		default:
			return Type.String({ description });
	}
}

function registerMcpTool(
	pi: ExtensionAPI,
	serverName: string,
	serverUrl: string,
	tool: McpTool,
): void {
	const props: Record<string, ReturnType<typeof Type.String>> = {};
	for (const param of tool.parameters ?? []) {
		props[param.name] = mcpParamType(
			param.type,
			param.description,
		) as ReturnType<typeof Type.String>;
	}

	pi.registerTool({
		name: `mcp__${serverName}__${tool.name}`,
		label: `${serverName}: ${tool.name}`,
		description: tool.description,
		parameters: Type.Object(props),
		async execute(_id, params, signal) {
			const response = await fetch(
				`${serverUrl}/tools/${encodeURIComponent(tool.name)}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ parameters: params }),
					signal,
				},
			);
			if (!response.ok) {
				throw new Error(`MCP ${tool.name}: HTTP ${response.status}`);
			}
			const result = (await response.json()) as { output?: string };
			const text =
				typeof result.output === "string"
					? result.output
					: JSON.stringify(result);
			return {
				content: [{ type: "text", text }],
				details: { server: serverName, tool: tool.name },
			};
		},
	});
}
