import crypto from "node:crypto"

/**
 * Crockford base32 alphabet — excludes I, L, O, U to avoid OCR confusion.
 * Used by the ULID spec for both the time and random segments.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LEN = 10
const RANDOM_LEN = 16

/**
 * Generates a 26-character ULID: 10-char time prefix (48-bit millisecond
 * timestamp, big-endian) + 16-char random suffix (80 bits of cryptographic
 * randomness, 5 bits per char).
 *
 * Why ULID over UUIDv4: lexicographically sortable on time-of-birth, so
 * backends can stream stable client-generated ids without re-hashing. This
 * is baseline seam #1 of the refactor plan ("Architecture Baseline for
 * Future Cloud Sync + Teams + Real-Time").
 *
 * The `now` parameter is exposed for tests that need deterministic time
 * prefixes; production callers omit it.
 */
export function generateId(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom()
}

function encodeTime(now: number): string {
  let ms = Math.floor(now)
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const chars = new Array<string>(TIME_LEN)
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    chars[i] = ALPHABET[ms % 32] ?? ""
    ms = Math.floor(ms / 32)
  }
  return chars.join("")
}

function encodeRandom(): string {
  const bytes = crypto.randomBytes(RANDOM_LEN)
  const chars: string[] = []
  for (let i = 0; i < RANDOM_LEN; i++) {
    // Lower 5 bits of a uniformly-random byte → uniform 0..31 (256 % 32 == 0, no bias).
    chars.push(ALPHABET[bytes[i]! & 0x1f] ?? "")
  }
  return chars.join("")
}
