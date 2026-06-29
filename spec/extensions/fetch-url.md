# Extension: fetch-url

Adds a `fetch_url` tool that fetches an HTTPS URL and returns its text content.
HTML is stripped to plain text. Output is capped at 40 000 characters.

## Tool

```text
fetch_url(url: string) → string
```

- HTTPS only. HTTP and file URLs are rejected.
- Private/loopback addresses are rejected (SSRF protection):
  - IPv4: localhost, 127.x, 0.0.0.0, 169.254.x (link-local), 10.x, 172.16-31.x,
    192.168.x (RFC 1918)
  - IPv6: `::`, `::1`, `::ffff:*`, `fe80:*`, `fc00::/7` (ULA)
- DNS pre-resolution: hostname is resolved before connecting. If any returned
  address is in a blocked range, the request is rejected. (TOCTOU window exists
  but blocks passive enumeration.)
- Redirects: followed manually (up to 5), each redirect URL is re-validated.
- Body limit: 2 MB buffered before the 40 k-char text truncation applies.
- HTML: tags stripped with a simple regex (`/<[^>]+>/g`), whitespace collapsed.
- Non-HTML: returned as-is.

If the response exceeds 40 000 chars, the content is truncated and a note is
appended: `[Truncated: N chars total]`.

## Files

| File | Role |
| --- | --- |
| `index.ts` | Tool registration; truncation at 40 000 chars |
| `fetcher.ts` | `validateUrl`, `validateUrlWithDns`, `fetchText`; SSRF blocklists, redirect loop, body reader |
