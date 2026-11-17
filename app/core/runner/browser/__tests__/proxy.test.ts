import { describe, expect, it } from "vitest"
import { browserProxy } from "../proxy"

describe("browserProxy", () => {
  it("is undefined without a proxy, leaving the browser on its own", () => {
    expect(browserProxy({})).toBeUndefined()
    expect(browserProxy({ proxy: "", noProxy: "localhost" })).toBeUndefined()
  })

  it("moves the URL's credentials to their own fields, decoded", () => {
    expect(browserProxy({ proxy: "http://ada%40corp:p%3Ass@proxy.corp:3128" })).toEqual({
      server: "http://proxy.corp:3128",
      username: "ada@corp",
      password: "p:ss",
    })
    expect(browserProxy({ proxy: "https://proxy.corp" })).toEqual({ server: "https://proxy.corp" })
  })

  it("bypasses a name and its subdomains, as NO_PROXY does for requests", () => {
    expect(browserProxy({ proxy: "http://proxy:8080", noProxy: "localhost, .internal,*.corp example.com:8443" })?.bypass).toBe(
      "localhost,.localhost,internal,.internal,corp,.corp,example.com:8443,.example.com:8443",
    )
  })

  it("keeps addresses, ranges and a lone * as they are", () => {
    expect(browserProxy({ proxy: "http://proxy:8080", noProxy: "10.0.0.1,10.0.0.0/8,127.0.0.1:8080,::1,[::1]:443,*" })?.bypass).toBe(
      "10.0.0.1,10.0.0.0/8,127.0.0.1:8080,::1,[::1]:443,*",
    )
  })
})
