import { describe, expect, it } from "vitest"
import { Response } from "undici"
import { iterateSseEvents } from "../streams/sse"
import { collectStreamMessages, type StreamAdapter } from "../stream_listener"

async function collect(response: Response): Promise<unknown[]> {
  const events: unknown[] = []
  for await (const event of iterateSseEvents(response)) events.push(event)
  return events
}

describe("iterateSseEvents", () => {
  it("parses streams that use standalone carriage returns", async () => {
    const response = new Response("event: update\rdata: shipped\r\r", { headers: { "content-type": "text/event-stream" } })
    await expect(collect(response)).resolves.toEqual([{ event: "update", data: "shipped" }])
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
    await expect(collect(response)).resolves.toEqual([{ event: "message", data: "shipped" }])
  })
})

function fakeAdapter(messages: readonly Record<string, unknown>[]): StreamAdapter & { closed: number } {
  const adapter = {
    closed: 0,
    label: "Fake",
    unit: "message",
    limitTermination: "message-limit" as const,
    handshake: { statusCode: 200, headers: {} },
    async open() {},
    resultBody: () => ({}),
    async close() {
      adapter.closed++
    },
    async *[Symbol.asyncIterator]() {
      yield* messages
    },
  }
  return adapter
}

describe("collectStreamMessages", () => {
  it("stops at the message limit and closes the adapter", async () => {
    const adapter = fakeAdapter([{ data: "a" }, { data: "b" }, { data: "c" }])
    const collected = await collectStreamMessages(adapter, { maxMessages: 2 })
    expect(collected).toMatchObject({ messageCount: 2, termination: "message-limit" })
    expect(adapter.closed).toBe(1)
  })

  it("keeps the finishing message by displacing the oldest capture", async () => {
    const adapter = fakeAdapter([{ data: "a" }, { data: "b" }, { data: "done" }])
    const collected = await collectStreamMessages(adapter, { maxMessages: 2, finishWhen: (message) => message["data"] === "done" })
    expect(collected.messages).toEqual([{ data: "b" }, { data: "done" }])
    expect(collected.termination).toBe("finish-condition")
  })

  it("reports stream-ended when the stream ends first", async () => {
    const collected = await collectStreamMessages(fakeAdapter([{ data: "a" }]), { maxMessages: 2 })
    expect(collected.termination).toBe("stream-ended")
  })
})
