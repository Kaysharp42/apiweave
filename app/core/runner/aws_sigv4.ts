import { createHash, createHmac } from "node:crypto"

/**
 * AWS Signature Version 4 (header-based), plain Node. Checked against AWS's
 * published SigV4 test suite (see __tests__/aws_sigv4.test.ts).
 */

export interface AwsCredentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** Temporary credentials: sent, and signed, as X-Amz-Security-Token. */
  readonly sessionToken?: string
}

export interface AwsSignRequest {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | Buffer | undefined
  readonly region: string
  readonly service: string
  readonly now: Date
}

export interface AwsSignedRequest {
  /** The URL to send: its query string rewritten in canonical form, so what is sent is exactly what was signed. */
  readonly url: string
  /** The request's headers plus X-Amz-Date, the session token, and Authorization. */
  readonly headers: Record<string, string>
  readonly canonicalRequest: string
  readonly stringToSign: string
}

/** Never signed: added or rewritten on the way out (a cookie jar, the HTTP client), or the signature itself. */
const UNSIGNED_HEADERS = new Set(["authorization", "cookie", "user-agent", "expect", "x-amzn-trace-id"])
/** Replaced by the signer. */
const SIGNER_HEADERS = new Set(["authorization", "x-amz-date", "x-amz-security-token", "x-amz-content-sha256", "host"])

const sha256Hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex")
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest()

/** RFC 3986: everything but A-Z a-z 0-9 - _ . ~ percent-encoded, as SigV4 requires. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** `20150830T123600Z` */
function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

function canonicalQuery(url: URL): string {
  const pairs = [...url.searchParams].map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
  return pairs.map(([key, value]) => `${key}=${value}`).join("&")
}

/**
 * A parsed URL's path is already percent-encoded once, and that is what goes
 * out. S3 signs it as sent; every other service signs each segment encoded
 * again (as the AWS SDKs do).
 */
function canonicalPath(url: URL, service: string): string {
  const path = url.pathname || "/"
  return service === "s3" ? path : path.split("/").map(uriEncode).join("/")
}

/** Sign `request`; the result is what to send. */
export function signAwsSigV4(request: AwsSignRequest, credentials: AwsCredentials): AwsSignedRequest {
  const url = new URL(request.url)
  const query = canonicalQuery(url)
  url.search = query
  const date = amzDate(request.now)
  const day = date.slice(0, 8)
  const payloadHash = sha256Hex(request.body ?? "")

  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (!SIGNER_HEADERS.has(name.toLowerCase())) headers[name] = value
  }
  headers["X-Amz-Date"] = date
  if (credentials.sessionToken) headers["X-Amz-Security-Token"] = credentials.sessionToken
  if (request.service === "s3") headers["X-Amz-Content-Sha256"] = payloadHash

  // Header names lowercased and merged, values trimmed with inner runs of spaces collapsed.
  const signed = new Map<string, string>([["host", url.host]])
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase()
    if (UNSIGNED_HEADERS.has(key)) continue
    const normalized = value.trim().replace(/\s+/g, " ")
    signed.set(key, signed.has(key) ? `${signed.get(key)},${normalized}` : normalized)
  }
  const names = [...signed.keys()].sort()
  const signedHeaders = names.join(";")

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(url, request.service),
    query,
    names.map((name) => `${name}:${signed.get(name)}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n")
  const scope = `${day}/${request.region}/${request.service}/aws4_request`
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n")
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), request.region), request.service), "aws4_request")
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex")
  headers["Authorization"] =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { url: url.toString(), headers, canonicalRequest, stringToSign }
}
