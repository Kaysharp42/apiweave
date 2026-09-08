import { describe, expect, it } from "vitest"
import { Response } from "undici"
import { collectSseEvents } from "../sse"

describe("collectSseEvents", () => {
  it("parses streams that use standalone carriage returns", async () => {
    const response = new Response("event: update\rdata: shipped\r\r", {
      headers: { "content-type": "text/event-stream" },
    })

    await expect(collectSseEvents(response, { maxEvents: 1 })).resolves.toMatchObject({
      termination: "event-limit",
      events: [{ event: "update", data: "shipped" }],
    })
  })

  it("treats a CRLF split across chunks as one line ending", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: shipped\r"))
        controller.enqueue(new TextEncoder().encode("\n\r"))
        controller.enqueue(new TextEncoder().encode("\n"))
        controller.close()
      },
    })
    const response = new Response(body, { headers: { "content-type": "text/event-stream" } })

    await expect(collectSseEvents(response, { maxEvents: 1 })).resolves.toMatchObject({
      termination: "event-limit",
      events: [{ event: "message", data: "shipped" }],
    })
  })
})
