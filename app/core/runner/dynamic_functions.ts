import type { ClockProvider, RngProvider } from "./harness/providers"

/**
 * Dynamic functions for workflow variable substitution.
 *
 * Ported from `backend/app/runner/dynamic_functions.py`. Every function goes
 * through the injected `ClockProvider` / `RngProvider` so the parity harness
 * can pin outputs deterministically (FixedClockProvider + SeededRandomProvider).
 * Production wires `WallClockProvider` + `CryptoRandomProvider`.
 *
 * Surface mirrors Python exactly (13 functions). No new functions added.
 */
export class DynamicFunctions {
  public constructor(
    private readonly clock: ClockProvider,
    private readonly rng: RngProvider,
  ) {}

  /** Random alphanumeric string (a-zA-Z0-9). Default length 10. */
  public randomString(length: unknown): string {
    const len = coerceLength(length, 10)
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return sampleAlphabet(this.rng, alphabet, len)
  }

  /** Random number as a string with `size` digits. Default 6. */
  public randomNumber(size: unknown): string {
    const sz = coerceLength(size, 6)
    const max = Number("9".repeat(sz))
    const min = sz > 1 ? Number("1" + "0".repeat(sz - 1)) : 1
    const n = Math.floor(this.rng.next() * (max - min + 1)) + min
    return String(n)
  }

  /** Random email: `<randomString(10)>@example.com`. */
  public randomEmail(): string {
    return `${this.randomString(10)}@example.com`
  }

  /** UUID v4 string. */
  public uuid(): string {
    const bytes = this.rng.bytes(16)
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = Buffer.from(bytes).toString("hex")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  /** Current Unix timestamp as a string. */
  public timestamp(): string {
    return String(Math.floor(this.clock.now().getTime() / 1000))
  }

  /** Current ISO 8601 timestamp. */
  public iso_timestamp(): string {
    return this.clock.now().toISOString()
  }

  /** Current date formatted. Default `%Y-%m-%d`. */
  public date(format?: unknown): string {
    return formatDate(this.clock.now(), typeof format === "string" && format.length > 0 ? format : "%Y-%m-%d")
  }

  /** Future date `days` from now. Default 1 day, `%Y-%m-%d`. */
  public futureDate(days?: unknown, format?: unknown): string {
    const d = coerceLength(days, 1)
    const fmt = typeof format === "string" && format.length > 0 ? format : "%Y-%m-%d"
    return formatDate(new Date(this.clock.now().getTime() + d * 86_400_000), fmt)
  }

  /** Past date `days` before now. Default 1 day, `%Y-%m-%d`. */
  public pastDate(days?: unknown, format?: unknown): string {
    const d = coerceLength(days, 1)
    const fmt = typeof format === "string" && format.length > 0 ? format : "%Y-%m-%d"
    return formatDate(new Date(this.clock.now().getTime() - d * 86_400_000), fmt)
  }

  /** Pick a random choice from comma-separated options. */
  public randomChoice(options: unknown): string {
    if (typeof options !== "string") return ""
    const opts = options.split(",").map((o) => o.trim()).filter((o) => o.length > 0)
    if (opts.length === 0) return ""
    const idx = Math.floor(this.rng.next() * opts.length)
    return opts[idx] ?? ""
  }

  /** Random alphabetic string (a-zA-Z). Default length 10. */
  public randomAlpha(length: unknown): string {
    const len = coerceLength(length, 10)
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return sampleAlphabet(this.rng, alphabet, len)
  }

  /** Random numeric string (0-9). Default length 10. */
  public randomNumeric(length: unknown): string {
    const len = coerceLength(length, 10)
    const alphabet = "0123456789"
    return sampleAlphabet(this.rng, alphabet, len)
  }

  /** Random hexadecimal string (0-9a-f). Default length 16. */
  public randomHex(length: unknown): string {
    const len = coerceLength(length, 16)
    const alphabet = "0123456789abcdef"
    return sampleAlphabet(this.rng, alphabet, len)
  }

  /** Get a function by name, or `undefined` if unknown. */
  public getFunction(name: string): ((...args: unknown[]) => string) | undefined {
    const map: Record<string, (...args: unknown[]) => string> = {
      randomString: (a) => this.randomString(a),
      randomNumber: (a) => this.randomNumber(a),
      randomEmail: () => this.randomEmail(),
      uuid: () => this.uuid(),
      timestamp: () => this.timestamp(),
      iso_timestamp: () => this.iso_timestamp(),
      date: (a) => this.date(a),
      futureDate: (a, b) => this.futureDate(a, b),
      pastDate: (a, b) => this.pastDate(a, b),
      randomChoice: (a) => this.randomChoice(a),
      randomAlpha: (a) => this.randomAlpha(a),
      randomNumeric: (a) => this.randomNumeric(a),
      randomHex: (a) => this.randomHex(a),
    }
    return map[name]
  }

  /** Documentation map for the UI panel. */
  public getAllFunctions(): Record<string, string> {
    return {
      "randomString(length)": "Generate a random alphanumeric string. Default length: 10",
      "randomNumber(size)": "Generate a random number with specified digits. Default: 6 digits",
      "randomEmail()": "Generate a random email address",
      "uuid()": "Generate a UUID v4",
      "timestamp()": "Get current Unix timestamp",
      "iso_timestamp()": "Get current ISO 8601 timestamp",
      "date(format)": "Get current date. Default format: %Y-%m-%d",
      "futureDate(days, format)": "Get a future date. Default: 1 day, format: %Y-%m-%d",
      "pastDate(days, format)": "Get a past date. Default: 1 day, format: %Y-%m-%d",
      "randomChoice(options)": "Pick random choice from comma-separated options",
      "randomAlpha(length)": "Generate random alphabetic string (letters only). Default: 10",
      "randomNumeric(length)": "Generate random numeric string (digits only). Default: 10",
      "randomHex(length)": "Generate random hexadecimal string. Default: 16",
    }
  }
}

function coerceLength(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.floor(n)
}

function sampleAlphabet(rng: RngProvider, alphabet: string, length: number): string {
  let out = ""
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(rng.next() * alphabet.length)
    out += alphabet[idx] ?? ""
  }
  return out
}

/**
 * Minimal Python `strftime` subset covering the tokens Python's default
 * formats use (%Y-%m-%d, %d/%m/%Y, etc.) plus the common ones the UI exposes.
 * Anything unrecognized falls back to the literal char pair, matching the
 * Python behavior of `strftime` for unknown directives (platform-dependent,
 * but the parity harness only uses the tokens below).
 */
function formatDate(date: Date, format: string): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0")
  const replacements: Record<string, string> = {
    "%Y": String(date.getFullYear()),
    "%m": pad(date.getMonth() + 1),
    "%d": pad(date.getDate()),
    "%H": pad(date.getHours()),
    "%M": pad(date.getMinutes()),
    "%S": pad(date.getSeconds()),
    "%y": pad(date.getFullYear() % 100),
    "%B": MONTHS[date.getMonth()] ?? "",
    "%b": (MONTHS[date.getMonth()] ?? "").slice(0, 3),
    "%A": DAYS[date.getDay()] ?? "",
    "%a": (DAYS[date.getDay()] ?? "").slice(0, 3),
    "%%": "%",
  }
  let out = ""
  for (let i = 0; i < format.length; i++) {
    const ch = format[i]!
    if (ch === "%" && i + 1 < format.length) {
      const token = format.slice(i, i + 2)
      out += replacements[token] ?? token
      i += 1
    } else {
      out += ch
    }
  }
  return out
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
