import { describe, expect, it } from "vitest"
import { signAwsSigV4 } from "../aws_sigv4"

/**
 * Cases from AWS's SigV4 test suite (aws-sig-v4-test-suite, as vendored by
 * botocore under tests/unit/auth/aws4_testsuite), verbatim: the request, then
 * the expected canonical request, string to sign and Authorization header.
 */
const credentials = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" }
const now = new Date("2015-08-30T12:36:00Z")
const STS_TOKEN =
  "AQoDYXdzEPT//////////wEXAMPLEtc764bNrC9SAPBSM22wDOk4x4HIZ8j4FZTwdQWLWsKWHGBuFqwAeMicRXmxfpSPfIeoIYRqTflfKD8YUuwthAx7mSEI/qkPpKPi/kMcGdQrmGdeehM4IC1NtBmUpp2wUE8phUZampKsburEDy0KPkyQDYwT7WZ0wq5VSXDvp75YU9HFvlRd8Tx6q6fE8YQcHNVXAkiY9q6d+xo0rKwT38xVqr7ZD0u0iPPkUL64lIZbqBAz+scqKmlzm8FDrypNC9Yjc8fPOLn9FX9KSYvKTr4rvx3iSIlTJabIQwj2ICCR/oLxBA=="
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
const UNRESERVED = "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

const cases = [
  {
    name: "get-vanilla",
    request: { method: "GET", url: "https://example.amazonaws.com/", headers: {}, body: undefined },
    creq: `GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY_HASH}`,
    sts: "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nbb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
    authz:
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  },
  {
    name: "get-vanilla-query-order-key-case",
    request: { method: "GET", url: "https://example.amazonaws.com/?Param2=value2&Param1=value1", headers: {}, body: undefined },
    creq: `GET\n/\nParam1=value1&Param2=value2\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY_HASH}`,
    sts: "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0",
    authz:
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
  },
  {
    name: "get-vanilla-query-unreserved",
    request: { method: "GET", url: `https://example.amazonaws.com/?${UNRESERVED}=${UNRESERVED}`, headers: {}, body: undefined },
    creq: `GET\n/\n${UNRESERVED}=${UNRESERVED}\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY_HASH}`,
    sts: "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nc30d4703d9f799439be92736156d47ccfb2d879ddf56f5befa6d1d6aab979177",
    authz:
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197",
  },
  {
    name: "post-x-www-form-urlencoded",
    request: {
      method: "POST",
      url: "https://example.amazonaws.com/",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Param1=value1",
    },
    creq:
      "POST\n/\n\ncontent-type:application/x-www-form-urlencoded\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\ncontent-type;host;x-amz-date\n9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e",
    sts: "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n42a5e5bb34198acb3e84da4f085bb7927f2bc277ca766e6d19c73c2154021281",
    authz:
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a",
  },
  {
    name: "post-sts-header-before",
    request: { method: "POST", url: "https://example.amazonaws.com/", headers: {}, body: undefined },
    sessionToken: STS_TOKEN,
    creq: `POST\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\nx-amz-security-token:${STS_TOKEN}\n\nhost;x-amz-date;x-amz-security-token\n${EMPTY_HASH}`,
    sts: "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nc237e1b440d4c63c32ca95b5b99481081cb7b13c7e40434868e71567c1a882f6",
    authz:
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=85d96828115b5dc0cfc3bd16ad9e210dd772bbebba041836c64533a82be05ead",
  },
]

describe("signAwsSigV4 — AWS SigV4 test suite", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const signed = signAwsSigV4(
        { ...testCase.request, region: "us-east-1", service: "service", now },
        { ...credentials, ...(testCase.sessionToken ? { sessionToken: testCase.sessionToken } : {}) },
      )
      expect(signed.canonicalRequest).toBe(testCase.creq)
      expect(signed.stringToSign).toBe(testCase.sts)
      expect(signed.headers["Authorization"]).toBe(testCase.authz)
      expect(signed.headers["X-Amz-Date"]).toBe("20150830T123600Z")
    })
  }
})

describe("signAwsSigV4", () => {
  const sign = (url: string, service = "execute-api", headers: Record<string, string> = {}) =>
    signAwsSigV4({ method: "GET", url, headers, body: undefined, region: "eu-west-1", service, now }, credentials)

  it("sends the query string in the canonical form it signed", () => {
    const signed = sign("https://api.example.com/items?b=two words&a=1&a=0")
    expect(signed.url).toBe("https://api.example.com/items?a=0&a=1&b=two%20words")
    expect(signed.canonicalRequest.split("\n")[2]).toBe("a=0&a=1&b=two%20words")
  })

  it("encodes the path again except for S3, and adds the payload hash header for S3", () => {
    expect(sign("https://api.example.com/a b/c").canonicalRequest.split("\n")[1]).toBe("/a%2520b/c")
    const s3 = sign("https://bucket.s3.amazonaws.com/a b/c", "s3")
    expect(s3.canonicalRequest.split("\n")[1]).toBe("/a%20b/c")
    expect(s3.headers["X-Amz-Content-Sha256"]).toBe(EMPTY_HASH)
  })

  it("replaces an Authorization the request carried and never signs the Cookie header", () => {
    const signed = sign("https://api.example.com/", "execute-api", { authorization: "Bearer old", Cookie: "a=1", "X-Trace": "  a   b " })
    expect(signed.headers["authorization"]).toBeUndefined()
    expect(signed.headers["Authorization"]).toContain("SignedHeaders=host;x-amz-date;x-trace,")
    expect(signed.canonicalRequest).toContain("x-trace:a b\n")
  })
})
