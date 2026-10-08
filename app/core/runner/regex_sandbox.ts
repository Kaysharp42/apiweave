import { shouldInterruptAfterDeadline, type QuickJSHandle, type QuickJSWASMModule } from "quickjs-emscripten-core"
import { parseRegexSource } from "@shared/analysis/assertion_expected"
import { MAX_STACK_BYTES, newSandboxModule } from "./script_sandbox"

/** Longest value a "matches" rule tests; a longer one fails the rule rather than being cut. */
export const MAX_REGEX_INPUT_LENGTH = 100_000
export const MAX_REGEX_PATTERN_LENGTH = 1_000
/** Time one match may take before it is abandoned as runaway backtracking. */
export const REGEX_TIMEOUT_MS = 100

const TEST = "(pattern, flags, input) => new RegExp(pattern, flags).test(input)"

/**
 * Runs the "matches"/"notMatches" operators' regular expressions. A pattern
 * comes from the workflow and the input from a server response, so a
 * backtracking pattern like `^(a+)+$` against a long run of `a`s would hang
 * V8's regex engine — and with it the whole main process — for as long as it
 * likes: V8 has no regex time limit. The match runs in QuickJS instead (the
 * script sandbox's engine, same ECMAScript regex syntax), whose regex engine
 * polls the interrupt handler, so it is stopped at REGEX_TIMEOUT_MS. The input
 * is capped too, which bounds memory.
 *
 * One instance per run (see `load`), one QuickJS runtime per match, so a
 * match that was interrupted leaves nothing for the next.
 */
export class RegexSandbox {
  private constructor(private readonly quickjs: QuickJSWASMModule) {}

  /** Async only because instantiating WebAssembly is; `test` is synchronous. */
  static async load(): Promise<RegexSandbox> {
    return new RegexSandbox(await newSandboxModule())
  }

  /** Whether `source` (`/pattern/flags` or a bare pattern) matches `input`. Throws an Error saying why it could not tell. */
  test(source: string, input: string): boolean {
    if (input.length > MAX_REGEX_INPUT_LENGTH) {
      throw new Error(`Value is ${input.length} characters; "matches" tests at most ${MAX_REGEX_INPUT_LENGTH}`)
    }
    const { pattern, flags } = parseRegexSource(source)
    if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
      throw new Error(`Regular expression is longer than ${MAX_REGEX_PATTERN_LENGTH} characters`)
    }
    const runtime = this.quickjs.newRuntime()
    runtime.setMaxStackSize(MAX_STACK_BYTES)
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + REGEX_TIMEOUT_MS))
    const context = runtime.newContext()
    // Every handle is freed before the runtime: QuickJS aborts on a leaked one.
    const handles: QuickJSHandle[] = []
    try {
      const fn = context.evalCode(TEST)
      if (fn.error) {
        handles.push(fn.error)
        throw new Error("Regular expression engine failed to start")
      }
      handles.push(fn.value)
      const args = [pattern, flags, input].map((value) => context.newString(value))
      handles.push(...args)
      const result = context.callFunction(fn.value, context.undefined, ...args)
      if (result.error) {
        handles.push(result.error)
        throw new Error(describe(context.dump(result.error)))
      }
      handles.push(result.value)
      return context.dump(result.value) === true
    } finally {
      for (const handle of handles) handle.dispose()
      context.dispose()
      runtime.dispose()
    }
  }
}

function describe(error: unknown): string {
  const fields = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {}
  const name = typeof fields["name"] === "string" ? fields["name"] : "Error"
  const message = typeof fields["message"] === "string" ? fields["message"] : String(error)
  if (name === "InternalError" && message === "interrupted") return `Regular expression timed out after ${REGEX_TIMEOUT_MS} ms`
  if (name === "InternalError" && message === "out of memory") return "Regular expression ran out of memory"
  return name === "SyntaxError" ? `Invalid regular expression: ${message}` : `${name}: ${message}`
}
