const SYSTEM_PROMPT = `Classify the user message into exactly one routing tier.
Reply with a single word only — no punctuation, no explanation.

Tiers:
- light: shell commands, quick lookups
- medium: coding, debugging, explanations, general questions
- heavy: architecture, design, research, deep analysis`;

const VALID_TIERS = new Set(["light", "medium", "heavy"]);

export async function callOllama(
  baseUrl: string,
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, system: SYSTEM_PROMPT, prompt, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json() as { response?: string };
    return data.response?.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z]/g, "")).find((w) => VALID_TIERS.has(w)) ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}
