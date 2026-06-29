export interface McpToolParam {
	name: string;
	type: string;
	description?: string;
	required?: boolean;
}

export interface McpTool {
	name: string;
	description: string;
	parameters?: McpToolParam[];
}

export async function fetchMcpTools(
	serverUrl: string,
	timeoutMs = 3000,
): Promise<McpTool[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${serverUrl}/tools`, {
			signal: controller.signal,
		});
		clearTimeout(timer);
		if (!response.ok) return [];
		const data = (await response.json()) as { tools?: McpTool[] };
		return Array.isArray(data.tools) ? data.tools : [];
	} catch {
		clearTimeout(timer);
		return [];
	}
}
