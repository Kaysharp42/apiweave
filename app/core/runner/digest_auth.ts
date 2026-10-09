import { createHash, randomBytes } from "node:crypto"
import { AuthError } from "./auth_error"

/**
 * HTTP Digest access authentication (RFC 7616), plain Node: MD5 and SHA-256,
 * each with its `-sess` variant, qop=auth (or none, for RFC 2069 servers).
 * ponytail: every request is challenged afresh (nc is always 1); keep the
 * nonce per host and count up if a server's extra round trip ever matters.
 */

export interface DigestChallenge {
  readonly realm: string
  readonly nonce: string
  readonly opaque?: string
  readonly algorithm: string
  /** The qop values offered; absent for an RFC 2069 challenge. */
  readonly qop?: readonly string[]
}

const SUPPORTED_ALGORITHMS = new Set(["MD5", "MD5-SESS", "SHA-256", "SHA-256-SESS"])
const PARAM = /\s*([A-Za-z][\w-]*)\s*(?:=\s*("(?:[^"\\]|\\.)*"|[^\s,"]*))?\s*,?/y

/**
 * The first Digest challenge in a WWW-Authenticate header (a server lists
 * its preferred first) whose algorithm is supported, or null.
 */
export function parseDigestChallenge(header: string): DigestChallenge | null {
  const challenges: { scheme: string; params: Map<string, string> }[] = []
  PARAM.lastIndex = 0
  while (PARAM.lastIndex < header.length) {
    const start = PARAM.lastIndex
    const match = PARAM.exec(header)
    if (!match || PARAM.lastIndex === start) break
    const [, name, raw] = match
    if (raw === undefined) challenges.push({ scheme: name!.toLowerCase(), params: new Map() })
    else challenges.at(-1)?.params.set(name!.toLowerCase(), raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw)
  }
  for (const { scheme, params } of challenges) {
    const algorithm = (params.get("algorithm") ?? "MD5").toUpperCase()
    const realm = params.get("realm")
    const nonce = params.get("nonce")
    if (scheme !== "digest" || realm === undefined || !nonce || !SUPPORTED_ALGORITHMS.has(algorithm)) continue
    const opaque = params.get("opaque")
    const qop = params.get("qop")
    return {
      realm,
      nonce,
      algorithm,
      ...(opaque === undefined ? {} : { opaque }),
      ...(qop === undefined ? {} : { qop: qop.split(",").map((value) => value.trim().toLowerCase()) }),
    }
  }
  return null
}

const quote = (value: string): string => `"${value.replace(/["\\]/g, "\\$&")}"`

/** The Authorization header answering `challenge` for the request `method uri`. */
export function digestAuthorization(
  challenge: DigestChallenge,
  request: { readonly username: string; readonly password: string; readonly method: string; readonly uri: string; readonly cnonce?: string },
): string {
  const { realm, nonce, algorithm } = challenge
  if (challenge.qop && !challenge.qop.includes("auth")) {
    throw new AuthError(`Digest auth: the server offers only qop=${challenge.qop.join(",")}, and only qop=auth is supported`)
  }
  const qop = challenge.qop ? "auth" : undefined
  const cnonce = request.cnonce ?? randomBytes(16).toString("hex")
  const nc = "00000001"
  const hash = (text: string): string => createHash(algorithm.startsWith("SHA-256") ? "sha256" : "md5").update(text, "utf8").digest("hex")
  let ha1 = hash(`${request.username}:${realm}:${request.password}`)
  if (algorithm.endsWith("-SESS")) ha1 = hash(`${ha1}:${nonce}:${cnonce}`)
  const ha2 = hash(`${request.method.toUpperCase()}:${request.uri}`)
  const response = qop ? hash(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : hash(`${ha1}:${nonce}:${ha2}`)
  const fields = [
    `username=${quote(request.username)}`,
    `realm=${quote(realm)}`,
    `nonce=${quote(nonce)}`,
    `uri=${quote(request.uri)}`,
    `algorithm=${algorithm.replace("-SESS", "-sess")}`,
    `response=${quote(response)}`,
    ...(challenge.opaque === undefined ? [] : [`opaque=${quote(challenge.opaque)}`]),
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`] : []),
  ]
  return `Digest ${fields.join(", ")}`
}
