/**
 * POST to the Python router's /v1/chat/completions with model:"auto".
 * The router classifies and returns X-Router-Tier header.
 * Returns null on timeout, network error, or missing header.
 */
export async function callClassifier(
  baseUrl: string,
  messages: Array<{ role: string; content?: string }>,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "auto", messages }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.headers.get("x-router-tier") ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}
