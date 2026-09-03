/** Dynamic placeholder helpers accepted by the workflow executor. */
export const DYNAMIC_FUNCTIONS = [
  { signature: "randomString(length)", description: "Random alphanumeric string; default length 10." },
  { signature: "randomNumber(size)", description: "Random numeric string with this many digits; default 6." },
  { signature: "randomEmail()", description: "Random email address at example.com." },
  { signature: "uuid()", description: "UUID v4." },
  { signature: "timestamp()", description: "Current Unix timestamp in seconds." },
  { signature: "iso_timestamp()", description: "Current ISO 8601 timestamp." },
  { signature: "date(format)", description: "Current date; default format %Y-%m-%d." },
  { signature: "futureDate(days, format)", description: "Date this many days ahead; defaults to 1 day and %Y-%m-%d." },
  { signature: "pastDate(days, format)", description: "Date this many days ago; defaults to 1 day and %Y-%m-%d." },
  { signature: "randomChoice(options)", description: "Random item from a comma-separated list." },
  { signature: "randomAlpha(length)", description: "Random alphabetic string; default length 10." },
  { signature: "randomNumeric(length)", description: "Random numeric string; default length 10." },
  { signature: "randomHex(length)", description: "Random hexadecimal string; default length 16." },
] as const

export const DYNAMIC_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  DYNAMIC_FUNCTIONS.map(({ signature }) => signature.slice(0, signature.indexOf("("))),
)
