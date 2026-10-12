import { describe, expect, it } from "vitest"
import { ScriptOutcomeSchema } from "@shared/zod-schemas"
import { runScript, type ScriptRun } from "../script_sandbox"
import { scriptSecretNames } from "../../services/secret_utils"

function run(source: string, overrides: Partial<ScriptRun> = {}, signal?: AbortSignal): ReturnType<typeof runScript> {
  return runScript({
    phase: "postResponse",
    source,
    timeoutMs: 1000,
    variables: {},
    env: {},
    data: {},
    secrets: {},
    uuid: () => "00000000-0000-4000-8000-000000000000",
    ...overrides,
  }, signal)
}

describe("script sandbox — isolation", () => {
  it("reaches nothing of the host: no require, process, timers, network or the host dispatcher", async () => {
    const { outcome } = await run(
      `const global = Function("return this")()
       console.log([typeof require, typeof process, typeof module, typeof fetch, typeof setTimeout,
         typeof global.process, typeof host, typeof globalThis.__awHost, typeof std, typeof os].join(","))`,
    )
    expect(outcome.error).toBeUndefined()
    expect(outcome.logs).toEqual([Array(10).fill("undefined").join(",")])
  })

  it("interrupts an infinite loop at the time limit", async () => {
    const started = Date.now()
    const { outcome } = await run("for (;;) {}", { timeoutMs: 200 })
    expect(outcome.error).toBe("Script timed out after 200 ms")
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("runs off the caller's thread, which keeps serving its event loop, and cancelling stops the script", async () => {
    const controller = new AbortController()
    let ticks = 0
    const ticker = setInterval(() => {
      ticks += 1
      if (ticks === 5) controller.abort()
    }, 20)
    const started = Date.now()
    const { outcome } = await run("while (true) {}", { timeoutMs: 30_000 }, controller.signal)
    clearInterval(ticker)
    expect(ticks).toBe(5)
    expect(outcome.error).toBe("Script cancelled")
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it("serves aw.crypto.uuid from the caller's generator, one call at a time", async () => {
    let n = 0
    const { outcome } = await run("console.log(aw.crypto.uuid(), aw.crypto.uuid())", { uuid: () => `uuid-${(n += 1)}` })
    expect(outcome.logs).toEqual(["uuid-1 uuid-2"])
  })

  it("an infinite loop cannot be caught and resumed by the script", async () => {
    const { outcome } = await run("try { for (;;) {} } catch (e) {}\nconsole.log('escaped')", { timeoutMs: 100 })
    expect(outcome.error).toBe("Script timed out after 100 ms")
    expect(outcome.logs).toEqual([])
  })

  it("contains a memory blowup inside the sandbox", async () => {
    const before = process.memoryUsage().rss
    const { outcome } = await run("const kept = []\nfor (;;) kept.push(new Array(1e6).fill(1))", { timeoutMs: 10_000 })
    expect(outcome.error).toBe("Script ran out of memory (limit 32 MB)")
    // The cap is on the WebAssembly memory itself: far below what the loop would take.
    expect(process.memoryUsage().rss - before).toBeLessThan(200 * 1024 * 1024)
  })

  it("stops runaway recursion, in the script and in the parser", async () => {
    expect((await run("function f() { return f() }\nf()")).outcome.error).toMatch(/^InternalError: stack overflow/)
    expect((await run("eval('['.repeat(100000) + ']'.repeat(100000))")).outcome.error).toBe("InternalError: stack overflow")
    // The next script gets a fresh instance and runs normally.
    expect((await run("console.log(1 + 1)")).outcome.logs).toEqual(["2"])
  })

  it("leaves nothing behind for the next script", async () => {
    await run("globalThis.leak = 'x'; Object.prototype.polluted = true")
    const { outcome } = await run("console.log(typeof leak, ({}).polluted)")
    expect(outcome.logs).toEqual(["undefined undefined"])
  })

  it("defines a variable named __proto__ without touching the host object's prototype", async () => {
    const variables: Record<string, unknown> = {}
    await run('aw.variables.set("__proto__", { polluted: true })', { variables })
    expect(Object.getPrototypeOf(variables)).toBe(Object.prototype)
    expect(Object.keys(variables)).toEqual(["__proto__"])
  })
})

describe("script sandbox — errors", () => {
  it("names the script's line and column", async () => {
    const { outcome } = await run("const a = 1\n\nnull.missing")
    expect(outcome.error).toBe("TypeError: cannot read property 'missing' of null (line 3, column 5)")
  })

  it("reports a syntax error with its location", async () => {
    expect((await run("let x = ;")).outcome.error).toMatch(/^SyntaxError: .* \(line 1, column \d+\)$/)
  })

  it("reports a thrown non-Error value", async () => {
    expect((await run("throw 'nope'")).outcome.error).toBe('Uncaught "nope"')
  })
})

describe("script sandbox — the aw API", () => {
  it("records aw.test results: an expect that throws is a failed test, not a script error", async () => {
    const { outcome } = await run(`
      aw.test("status", () => aw.expect(aw.response.status).toBe(201))
      aw.test("body", () => aw.expect(aw.response.json()).toEqual({ id: 7, tags: ["a"] }))
      aw.test("header", () => aw.expect(aw.response.header("Content-Type")).toContain("json"))
      aw.test("negated", () => aw.expect([1, 2]).not.toContain(3))
      aw.test("async", async () => {})
    `, {
      response: { status: 200, headers: { "content-type": "application/json" }, body: { tags: ["a"], id: 7 }, responseTime: 4 },
    })
    expect(outcome.error).toBeUndefined()
    expect(outcome.tests).toEqual([
      { name: "status", passed: false, error: "AssertionError: expected 200 to be 201" },
      { name: "body", passed: true },
      { name: "header", passed: true },
      { name: "negated", passed: true },
      { name: "async", passed: false, error: "Error: aw.test callbacks must be synchronous: scripts cannot await" },
    ])
    expect(ScriptOutcomeSchema.safeParse(outcome).success).toBe(true)
  })

  it("reads variables, environment, data and named secrets, and writes variables back", async () => {
    const variables: Record<string, unknown> = { count: 1 }
    const { outcome } = await run(
      `console.log(aw.variables.get("count"), aw.env.get("host"), aw.data.get("row"), aw.secrets.get("KEY"), aw.secrets.get("OTHER"))
       aw.variables.set("next", { n: aw.variables.get("count") + 1 })
       console.log(aw.variables.get("next").n)`,
      { variables, env: { host: "api" }, data: { row: 3 }, secrets: { KEY: "k" } },
    )
    expect(outcome.logs).toEqual(["1 api 3 k undefined", "2"])
    expect(variables).toEqual({ count: 1, next: { n: 2 } })
  })

  it("refuses a variable value that is not JSON", async () => {
    const { outcome } = await run('aw.variables.set("f", () => 1)')
    expect(outcome.error).toMatch(/^TypeError: aw\.variables\.set: the value must be JSON/)
  })

  it("computes HMAC-SHA256 and SHA-256 in the host (RFC 4231 test case 2)", async () => {
    const { outcome } = await run(`
      console.log(aw.crypto.hmacSha256("Jefe", "what do ya want for nothing?"))
      console.log(aw.crypto.hmacSha256(aw.crypto.base64Encode("Jefe"), "what do ya want for nothing?", "base64", "base64"))
      console.log(aw.crypto.sha256("abc"))
      console.log(aw.crypto.base64Decode(aw.crypto.base64Encode("héllo")), aw.crypto.uuid())
    `)
    expect(outcome.logs).toEqual([
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
      "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=",
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      "héllo 00000000-0000-4000-8000-000000000000",
    ])
  })

  it("caps console output", async () => {
    const { outcome } = await run(`for (let i = 0; i < 500; i++) console.log("x".repeat(5000))`)
    expect(outcome.logs).toHaveLength(101)
    expect(outcome.logs[0]).toHaveLength(2001)
    expect(outcome.logs[100]).toBe("… output after 100 lines dropped")
  })

  it("hands back the request as the pre-request script left it", async () => {
    const result = await run(
      `aw.request.headers["X-Signature"] = aw.crypto.sha256(aw.request.body)
       aw.request.url += "?signed=1"
       aw.request.method = "put"`,
      { phase: "preRequest", request: { method: "POST", url: "https://api.test/x", headers: { "Content-Type": "application/json" }, body: "{}" } },
    )
    expect(result.outcome.error).toBeUndefined()
    expect(result.request).toEqual({
      method: "PUT",
      url: "https://api.test/x?signed=1",
      headers: { "Content-Type": "application/json", "X-Signature": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" },
      body: "{}",
    })
  })

  it("refuses a request it could not send", async () => {
    const result = await run("aw.request.headers.retries = 3", {
      phase: "preRequest",
      request: { method: "GET", url: "https://api.test/", headers: {}, body: null },
    })
    expect(result.request).toBeUndefined()
    expect(result.outcome.error).toBe('aw.request.headers["retries"] must be a string')
  })
})

describe("scriptSecretNames", () => {
  it("finds literal names only, in source and in serialised config", () => {
    const source = `aw.secrets.get("API_KEY"); aw.secrets.get( 'OTHER' ); aw.secrets.get(name); aw.secrets.get("API_KEY")`
    expect(scriptSecretNames(source)).toEqual(["API_KEY", "OTHER"])
    expect(scriptSecretNames(JSON.stringify({ scripts: { preRequest: source } }))).toEqual(["API_KEY", "OTHER"])
  })
})
