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
// fallow-ignore-next-line complexity -- this is the SSE framing state machine; its branches directly encode event-stream field, termination, and chunk-boundary rules.
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

  // fallow-ignore-next-line complexity -- dispatch keeps the SSE specification's event filtering, bounded capture, and terminal-event retention decisions together.
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

  // fallow-ignore-next-line complexity -- each branch is a distinct SSE field rule, including comments, empty dispatches, and the NUL-id guard.
  const processLine = (rawLine: string): void => {
    const line = rawLine
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

  const processBufferedLines = async (endOfStream = false): Promise<boolean> => {
    for (;;) {
      const lineEndingIndex = buffer.search(/[\r\n]/)
      if (lineEndingIndex === -1) return false

      const first = buffer[lineEndingIndex]!
      if (!endOfStream && first === "\r" && lineEndingIndex === buffer.length - 1) {
        // A CRLF sequence may be split across chunks. Keep the CR until the
        // next chunk tells us whether this is CRLF or a standalone CR.
        return false
      }

      const lineEndingLength = first === "\r" && buffer[lineEndingIndex + 1] === "\n" ? 2 : 1
      processLine(buffer.slice(0, lineEndingIndex))
      buffer = buffer.slice(lineEndingIndex + lineEndingLength)
      if (termination !== null) {
        await reader.cancel()
        return true
      }
    }
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
    if (await processBufferedLines()) {
      return { events, eventCount: events.length, termination: termination!, ...(retryMs === undefined ? {} : { retryMs }) }
    }
  }

  buffer += decoder.decode()
  if (await processBufferedLines(true)) {
    return { events, eventCount: events.length, termination: termination!, ...(retryMs === undefined ? {} : { retryMs }) }
  }
  return { events, eventCount: events.length, termination: "stream-ended", ...(retryMs === undefined ? {} : { retryMs }) }
}
