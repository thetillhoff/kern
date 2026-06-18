import { existsSync, readFileSync } from "node:fs";

export interface McpServer {
  name: string;
  url: string;
  description?: string;
}

export interface McpConfig {
  servers: McpServer[];
}

export function loadMcpConfig(configPath: string): McpConfig {
  if (!existsSync(configPath)) return { servers: [] };
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as McpConfig;
  } catch {
    return { servers: [] };
  }
}
