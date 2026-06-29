import { promises as dns } from "node:dns";

const BLOCKED_IPV4_HOST =
	/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|169\.254\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)$/i;

// :: (unspecified/all-zeros), ::1 (loopback), ::ffff:* (IPv4-mapped), fe80: (link-local),
// f[cd]* (ULA fc00::/7 — any address starting with fc or fd).
// Bun's URL API keeps brackets in .hostname for IPv6; strip them before matching.
const BLOCKED_IPV6_HOST = /^(::$|::1$|::ffff:|fe80:|f[cd])/i;

// Maximum bytes to buffer from any single HTTP response before truncating.
// Prevents OOM from large bodies before the 40 000-char text limit in index.ts applies.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

// Maximum number of redirects to follow before giving up.
const MAX_REDIRECTS = 5;

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
	// Strip brackets that Bun (and some runtimes) keep in IPv6 hostnames.
	const h = parsed.hostname.replace(/^\[|\]$/g, "");
	if (BLOCKED_IPV4_HOST.test(h) || BLOCKED_IPV6_HOST.test(h)) {
		throw new Error(`Blocked host: ${parsed.hostname}`);
	}
}

// Validate URL then pre-resolve the hostname to catch hostnames that resolve
// to private IPs (DNS rebinding). TOCTOU window exists between lookup and
// connect, but this blocks passive enumeration and most practical attacks.
export async function validateUrlWithDns(url: string): Promise<void> {
	validateUrl(url);
	// validateUrl already throws on invalid URL/non-HTTPS, so new URL() is safe here.
	const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
	// Literal IPs are already caught by validateUrl; only resolve domain names.
	if (BLOCKED_IPV4_HOST.test(hostname) || BLOCKED_IPV6_HOST.test(hostname))
		return;
	try {
		const addresses = await dns.lookup(hostname, { all: true });
		for (const { address } of addresses) {
			if (BLOCKED_IPV4_HOST.test(address) || BLOCKED_IPV6_HOST.test(address)) {
				throw new Error(
					`Blocked host (resolves to private IP ${address}): ${hostname}`,
				);
			}
		}
	} catch (err) {
		// Re-throw our own SSRF errors; ignore DNS lookup failures (let fetch handle them).
		if (err instanceof Error && err.message.startsWith("Blocked host"))
			throw err;
	}
}

async function readBodyLimited(response: Response): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done || !value) break;
		const fits = Math.min(value.length, MAX_RESPONSE_BYTES - totalBytes);
		chunks.push(value.subarray(0, fits));
		totalBytes += fits;
		if (totalBytes >= MAX_RESPONSE_BYTES) break;
	}
	try {
		reader.cancel();
	} catch {
		/* stream may already be closed */
	}
	const combined = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}
	const charset = response.headers
		.get("content-type")
		?.match(/charset=([^\s;]+)/i)?.[1];
	return new TextDecoder(charset ?? "utf-8").decode(combined);
}

export async function fetchText(url: string): Promise<string> {
	await validateUrlWithDns(url);

	let currentUrl = url;
	for (let i = 0; i <= MAX_REDIRECTS; i++) {
		const response = await fetch(currentUrl, {
			headers: { "User-Agent": "pi-fetch-url/1.0" },
			redirect: "manual",
		});

		// Only follow actual redirects; 304 Not Modified is not a redirect and
		// carries no Location header - it must fall through to the !response.ok check.
		if (
			response.status === 301 ||
			response.status === 302 ||
			response.status === 303 ||
			response.status === 307 ||
			response.status === 308
		) {
			const location = response.headers.get("location");
			if (!location) {
				throw new Error(`Redirect with no Location header from ${currentUrl}`);
			}
			const nextUrl = new URL(location, currentUrl).toString();
			await validateUrlWithDns(nextUrl);
			currentUrl = nextUrl;
			continue;
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${currentUrl}`);
		}

		const contentType = response.headers.get("content-type") ?? "";
		const text = await readBodyLimited(response);
		if (contentType.includes("text/html")) {
			return text
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}
		return text;
	}

	throw new Error(`Too many redirects for ${url}`);
}
