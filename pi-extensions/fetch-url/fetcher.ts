export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Only HTTPS URLs allowed, got: ${parsed.protocol}`);
  }
}

export async function fetchText(url: string): Promise<string> {
  validateUrl(url);
  const response = await fetch(url, {
    headers: { "User-Agent": "pi-fetch-url/1.0" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("text/html")) {
    return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return text;
}
