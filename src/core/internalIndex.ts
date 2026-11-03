/**
 * Compact `fields=index` is only for the MCP worker.
 *
 * ApiClient sets this header on those calls. The API worker keeps it only
 * when the request came through the service binding (`http://internal`,
 * env.API) or through loopback (`API_BASE_URL` under wrangler dev). Any other
 * host has the header and `fields=index` removed before routing, so a public
 * caller cannot opt in and the edge never forwards the header.
 */
export const INTERNAL_INDEX_HEADER = "x-th-internal";
export const INTERNAL_INDEX_VALUE = "index";

export function isTrustedIndexHost(hostname: string): boolean {
  return (
    hostname === "internal" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/** Leave the request unchanged when this caller may use the compact read. */
export function gateCompactIndex(request: Request): Request {
  const url = new URL(request.url);
  const asked = url.searchParams.get("fields") === "index";
  const headerOk =
    request.headers.get(INTERNAL_INDEX_HEADER) === INTERNAL_INDEX_VALUE;
  if (asked && headerOk && isTrustedIndexHost(url.hostname)) return request;

  if (!asked && !request.headers.has(INTERNAL_INDEX_HEADER)) return request;

  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_INDEX_HEADER);
  if (asked) url.searchParams.delete("fields");
  return new Request(url.toString(), {
    method: request.method,
    headers,
  });
}
