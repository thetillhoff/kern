# Extension: mcp-integration

Auto-discovers tools from MCP servers listed in `~/.pi/mcp.json` and registers
them in Pi on every `resources_discover` event.

## Config (`~/.pi/mcp.json`)

```json
{
  "servers": [
    { "name": "filesystem", "url": "http://localhost:3000" },
    { "name": "browser",    "url": "http://localhost:3001" }
  ]
}
```

Optional per-server `description` field is stored but not currently used.

## Discovery protocol

On `resources_discover` (fires on session start and on manual refresh):

1. For each server, `GET <url>/tools` (3 s timeout). Expects:

   ```json
   { "tools": [{ "name": "...", "description": "...", "parameters": [...] }] }
   ```

2. Tools not seen before for that server are registered. Tools that were
   registered in a prior cycle and are still returned are skipped (not
   re-registered). If a server returns zero tools after previously returning
   some, emit a warning and clear the server's tracking set so it can recover.

## Tool registration

Each MCP tool is registered in Pi as `mcp__<serverName>__<toolName>`:

- Parameters are mapped from the MCP type string (`boolean`, `integer`, `number`,
  `object`, `array`, or default `string`) to typebox schemas.
- `execute` calls `POST <serverUrl>/tools/<toolName>` with
  `{ parameters: <params> }`. The response's `output` string is returned as text;
  non-string responses are JSON-serialised.

## Files

| File | Role |
| --- | --- |
| `index.ts` | Extension entry; `resources_discover` handler; tool registration |
| `config.ts` | `loadMcpConfig` — reads `~/.pi/mcp.json` |
| `discovery.ts` | `fetchMcpTools` — HTTP GET `/tools` with timeout |
