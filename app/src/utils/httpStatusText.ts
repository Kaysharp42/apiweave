/**
 * Reason phrases for the status codes an API test actually produces.
 *
 * The run strip's result summary reads `200 OK` / `502 Bad Gateway`, so the code
 * needs a phrase. Codes outside this table fall back to their class — `418` on a
 * node reads `418 Client Error`, which is still true and still useful. A full
 * IANA table would be mostly dead weight in a renderer bundle.
 */
const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  206: "Partial Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  412: "Precondition Failed",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  424: "Failed Dependency",
  428: "Precondition Required",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
};

/**
 * The reason phrase for a status code, or its class when unknown.
 *
 * Returns null for a code outside 100–599, so a caller can fall back to the
 * metrics placeholder rather than printing nonsense.
 */
export function httpStatusText(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  if (!Number.isFinite(code)) return null;

  const known = STATUS_TEXT[code];
  if (known !== undefined) return known;

  if (code >= 100 && code < 200) return "Informational";
  if (code >= 200 && code < 300) return "Success";
  if (code >= 300 && code < 400) return "Redirect";
  if (code >= 400 && code < 500) return "Client Error";
  if (code >= 500 && code < 600) return "Server Error";
  return null;
}
