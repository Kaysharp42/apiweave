import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"

export interface TokenCall {
  readonly headers: IncomingHttpHeaders
  readonly form: URLSearchParams
}

export interface FakeOAuthServer {
  readonly url: string
  readonly tokenCalls: TokenCall[]
  /** Authorization headers the API saw, in order. */
  readonly apiCalls: string[]
  /** Tokens the API accepts. Every issued token is accepted unless revoked. */
  readonly revoked: Set<string>
  /** What `/token` answers next; defaults to a fresh token with `expires_in: 3600`. */
  tokenResponse: ((call: TokenCall, issued: string) => { status: number; body: Record<string, unknown> }) | null
  close(): Promise<void>
}

/**
 * A token endpoint (`POST /token`) that issues `tok-1`, `tok-2`, … and an API
 * (`GET /api`) that accepts any issued, unrevoked bearer token and echoes the
 * Authorization header back — the worst case for masking.
 */
export async function startFakeOAuthServer(): Promise<FakeOAuthServer> {
  const issued = new Set<string>()
  let counter = 0
  const fake: FakeOAuthServer = {
    url: "",
    tokenCalls: [],
    apiCalls: [],
    revoked: new Set(),
    tokenResponse: null,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      res.setHeader("content-type", "application/json")
      if (req.url === "/token" && req.method === "POST") {
        const call = { headers: req.headers, form: new URLSearchParams(body) }
        fake.tokenCalls.push(call)
        counter += 1
        const token = `tok-${counter}-abcdef`
        issued.add(token)
        const answer = fake.tokenResponse?.(call, token) ?? {
          status: 200,
          body: { access_token: token, token_type: "Bearer", expires_in: 3600 },
        }
        res.statusCode = answer.status
        res.end(JSON.stringify(answer.body))
        return
      }
      const authorization = req.headers.authorization ?? ""
      fake.apiCalls.push(authorization)
      const token = authorization.replace(/^Bearer /, "")
      res.statusCode = issued.has(token) && !fake.revoked.has(token) ? 200 : 401
      res.end(JSON.stringify({ youSent: authorization }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return Object.assign(fake, { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
}
