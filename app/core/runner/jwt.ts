import { createHmac, createPrivateKey, sign, type KeyObject } from "node:crypto"
import { AuthError } from "./auth_error"

/** JWS compact signing (RFC 7515/7518) for the algorithms the JWT Bearer auth offers, plain Node. */
export type JwtAlgorithm = "HS256" | "RS256" | "ES256"

const PEM = /^-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----$/

/**
 * A PEM block as Node reads it. A secret is typed into a one-line field or an
 * environment variable, which loses the line breaks or spells them `\n`, so
 * both are restored.
 */
export function normalizePem(text: string): string {
  const trimmed = text.replace(/\\n/g, "\n").trim()
  const match = PEM.exec(trimmed)
  if (!match) return trimmed
  const body = match[2]!.replace(/\s+/g, "")
  return `-----BEGIN ${match[1]}-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END ${match[1]}-----\n`
}

function privateKey(algorithm: "RS256" | "ES256", pem: string): KeyObject {
  let key: KeyObject
  try {
    key = createPrivateKey(normalizePem(pem))
  } catch {
    throw new AuthError(`JWT: the ${algorithm} signing key is not a PEM private key`)
  }
  const fits = algorithm === "RS256" ? key.asymmetricKeyType === "rsa" : key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"
  if (!fits) throw new AuthError(`JWT: ${algorithm} needs ${algorithm === "RS256" ? "an RSA" : "a P-256 EC"} private key`)
  return key
}

/** A signed JWT. `alg` is always the algorithm used; `typ` defaults to JWT. */
export function signJwt(
  algorithm: JwtAlgorithm,
  key: string,
  header: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
  const input = `${encode({ typ: "JWT", ...header, alg: algorithm })}.${encode(payload)}`
  const signature =
    algorithm === "HS256"
      ? createHmac("sha256", key).update(input).digest()
      : sign("sha256", Buffer.from(input), algorithm === "ES256"
        // JWS wants ECDSA's raw r||s, not DER.
        ? { key: privateKey(algorithm, key), dsaEncoding: "ieee-p1363" }
        : privateKey(algorithm, key))
  return `${input}.${signature.toString("base64url")}`
}
