import type { Response } from "undici"

export const SSE_MAX_CAPTURE_BYTES = 1024 * 1024

export interface SseEvent {
  readonly event: string
  readonly data: string
  readonly id?: string
}

export type SseTermination = "event-limit" | "finish-condition" | "stream-ended"

/**
 * Consume an SSE response until the configured number of matching events has
 * arrived. This intentionally models a finite test probe, not a subscription
 * that survives the workflow run.
 */
export async function collectSseEvents(
  response: Response,
  options: {
    readonly maxEvents: number
    readonly eventType?: string
    readonly maxBytes?: number
    readonly finishWhen?: (event: SseEvent) => boolean
  },
): Promise<{
  readonly events: readonly SseEvent[]
  readonly eventCount: number
  readonly termination: SseTermination
  readonly retryMs?: number
}> {
  const reader = response.body?.getReader()
  if (!reader) {
    return { events: [], eventCount: 0, termination: "stream-ended" }
  }

  const decoder = new TextDecoder()
  const events: SseEvent[] = []
  const maxBytes = options.maxBytes ?? SSE_MAX_CAPTURE_BYTES
  let receivedBytes = 0
  let buffer = ""
  let eventName = ""
  let eventId: string | undefined
  let dataLines: string[] = []
  let retryMs: number | undefined
  let termination: SseTermination | null = null

  const dispatch = (): void => {
    if (dataLines.length === 0) {
      eventName = ""
      return
    }
    const event = eventName || "message"
    if (options.eventType === undefined || options.eventType === event) {
      const received: SseEvent = { event, data: dataLines.join("\n"), ...(eventId === undefined ? {} : { id: eventId }) }
      const finished = options.finishWhen?.(received) ?? false
      if (events.length < options.maxEvents) {
        events.push(received)
      } else if (finished) {
        // The terminal event is evidence for why this listener completed, so it
        // displaces the oldest capture rather than being silently discarded.
        events.shift()
        events.push(received)
      }
      if (finished) termination = "finish-condition"
      else if (options.finishWhen === undefined && events.length >= options.maxEvents) termination = "event-limit"
    }
    eventName = ""
    dataLines = []
  }

  const processLine = (rawLine: string): void => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    if (line === "") {
      dispatch()
      return
    }
    if (line.startsWith(":")) return
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
    if (field === "event") eventName = value
    if (field === "data") dataLines.push(value)
    if (field === "id" && !value.includes("\u0000")) eventId = value
    if (field === "retry" && /^\d+$/.test(value)) retryMs = Number(value)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    receivedBytes += value.byteLength
    if (receivedBytes > maxBytes) {
      await reader.cancel()
      throw new Error(`SSE response exceeded ${maxBytes} byte capture limit`)
    }
    buffer += decoder.decode(value, { stream: true })
    let newlineIndex = buffer.indexOf("\n")
    while (newlineIndex !== -1) {
      processLine(buffer.slice(0, newlineIndex))
      buffer = buffer.slice(newlineIndex + 1)
       if (termination !== null) {
         await reader.cancel()
         return { events, eventCount: events.length, termination, ...(retryMs === undefined ? {} : { retryMs }) }
      }
      newlineIndex = buffer.indexOf("\n")
    }
  }

  buffer += decoder.decode()
  return { events, eventCount: events.length, termination: "stream-ended", ...(retryMs === undefined ? {} : { retryMs }) }
}
