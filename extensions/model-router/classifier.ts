const SYSTEM_PROMPT = `Classify the user message into exactly one routing tier.
Reply with a single bare word only — no quotes, no punctuation, no explanation.

Tiers:
- light: shell commands, quick lookups
- medium: coding, debugging, explanations, general questions
- heavy: architecture, design, research, deep analysis`;

const VALID_TIERS = new Set(["light", "medium", "heavy"]);

export interface ClassifyResult {
	/** The classified tier, or null if the call failed/timed out/was unrecognised. */
	tier: string | null;
	/** Wall-clock time the call took, for latency evaluation (logged even on fallback). */
	latencyMs: number;
}

export async function callOllama(
	baseUrl: string,
	model: string,
	prompt: string,
	timeoutMs: number,
): Promise<ClassifyResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const start = Date.now();
	try {
		const res = await fetch(`${baseUrl}/api/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				system: SYSTEM_PROMPT,
				prompt,
				stream: false,
			}),
			signal: controller.signal,
		});
		clearTimeout(timer);
		if (!res.ok) return { tier: null, latencyMs: Date.now() - start };
		const data = (await res.json()) as { response?: string };
		const tier =
			data.response
				?.toLowerCase()
				.split(/\s+/)
				.map((w) => w.replace(/[^a-z]/g, ""))
				.find((w) => VALID_TIERS.has(w)) ?? null;
		return { tier, latencyMs: Date.now() - start };
	} catch {
		clearTimeout(timer);
		return { tier: null, latencyMs: Date.now() - start };
	}
}

// Fire-and-forget: load the classifier model into Ollama's memory so the next
// real classification is warm. Errors are swallowed; never awaited by callers.
export function warmupOllama(baseUrl: string, model: string): void {
	void fetch(`${baseUrl}/api/generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model, prompt: "", stream: false }),
	}).catch(() => {});
}
