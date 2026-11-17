import crypto from "node:crypto"

/**
 * Crockford base32 alphabet — excludes I, L, O, U to avoid OCR confusion.
 * Used by the ULID spec for both the time and random segments.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LEN = 10
const RANDOM_LEN = 16

/** The prefix and random part of the previous id, for monotonic generation. */
let lastTime: string | null = null
let lastRandom: readonly number[] = []

/**
 * Generates a 26-character ULID: 10-char time prefix (48-bit millisecond
 * timestamp, big-endian) + 16-char random suffix (80 bits of randomness, 5 bits
 * per char).
 *
 * Why ULID over UUIDv4: lexicographically sortable on time-of-birth, so
 * backends can stream stable client-generated ids without re-hashing. Ids made
 * in the same millisecond sort in the order they were made: the random suffix
 * is incremented like a base-32 counter instead of re-randomised.
 *
 * The `now` parameter is exposed for tests that need deterministic time
 * prefixes; production callers omit it.
 */
export function generateId(now: number = Date.now()): string {
  const time = encodeTime(now)
  // Only an exactly-equal prefix continues the counter. A clock that moved,
  // even backwards, gets a fresh suffix so nothing is carried across.
  lastRandom = time === lastTime ? incrementRandom(lastRandom) : randomDigits()
  lastTime = time
  return time + encodeRandom(lastRandom)
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

function encodeRandom(digits: readonly number[]): string {
  const chars: string[] = []
  for (let i = 0; i < RANDOM_LEN; i++) {
    chars.push(ALPHABET[digits[i] ?? 0] ?? "")
  }
  return chars.join("")
}

function randomDigits(): number[] {
  const bytes = crypto.randomBytes(RANDOM_LEN)
  return Array.from(bytes, (byte) => byte & 0x1f)
}

/**
 * The next suffix in base 32: +1 from the rightmost digit, carrying left. A
 * suffix of all 31s cannot be incremented, so it overflows to a fresh random
 * one rather than throwing.
 */
function incrementRandom(digits: readonly number[]): number[] {
  const next = [...digits]
  for (let i = next.length - 1; i >= 0; i--) {
    const digit = next[i] ?? 0
    if (digit < 31) {
      next[i] = digit + 1
      return next
    }
    next[i] = 0
  }
  return randomDigits()
}

/**
 * A 26-character id derived from `seed` alone: the same seed always gives the
 * same id. For records whose identity must survive being imported again from
 * the same file; anything created fresh uses `generateId`.
 */
export function stableId(seed: string): string {
  const digest = crypto.createHash("sha256").update(seed).digest()
  let id = ""
  for (let i = 0; i < 26; i++) id += ALPHABET[digest[i]! & 0x1f] ?? ""
  return id
}
