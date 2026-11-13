import type { Response } from "undici"
import type { CookieJar } from "tough-cookie"
import { SIDE_TABLE_THRESHOLD_BYTES } from "../../db/constants"
import { toHeaderRecord, type SafeHttp } from "../safe_http"
import { STREAM_MAX_CAPTURE_BYTES, StreamHandshakeError, type StreamAdapter, type StreamCollection, type StreamHandshake, type StreamMessage } from "../stream_listener"

export interface SseAdapterOptions {
  readonly http: SafeHttp
  readonly url: string
  readonly headers: Record<string, string>
  readonly signal: AbortSignal
  readonly sslVerify: boolean
  readonly followRedirects: boolean
  readonly cookieJar?: CookieJar
  readonly timeoutMs: number
  /** Only events whose `event` field equals this are yielded. */
  readonly eventType?: string
}

/** A Server-Sent Events stream: the HTTP handshake, then parsed event messages. */
export class SseAdapter implements StreamAdapter {
  public readonly label = "SSE"
  public readonly unit = "event"
  public readonly limitTermination = "event-limit"
  private response: Response | undefined
  private statusCode = 0
  private responseHeaders: Record<string, string> = {}
  private retryMsValue: number | undefined

  public constructor(private readonly options: SseAdapterOptions) {}

  public async open(): Promise<void> {
    const { http, url, headers, signal, sslVerify, followRedirects, cookieJar, timeoutMs } = this.options
    const response = await http.safeFetch(
      url,
      { method: "GET", headers, signal },
      { followRedirects, rejectUnauthorized: sslVerify, timeoutMs, ...(cookieJar ? { cookieJar } : {}) },
    )
    this.response = response
    this.statusCode = response.status
    this.responseHeaders = toHeaderRecord(response.headers)
    if (this.statusCode < 200 || this.statusCode >= 300) {
      const { text, truncated } = await http.readTextCapped(response, SIDE_TABLE_THRESHOLD_BYTES)
      throw new StreamHandshakeError(`SSE endpoint returned HTTP ${this.statusCode}`, {
        statusCode: this.statusCode,
        headers: this.responseHeaders,
        body: text,
        response: { statusCode: this.statusCode, headers: this.responseHeaders, body: text, ...(truncated ? { truncated: true } : {}) },
      })
    }
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("text/event-stream")) {
      await response.body?.cancel()
      throw new StreamHandshakeError(`Expected text/event-stream response, received ${contentType || "no Content-Type"}`, {
        statusCode: this.statusCode,
        headers: this.responseHeaders,
        response: { statusCode: this.statusCode, headers: this.responseHeaders, body: { events: [], eventCount: 0 } },
      })
    }
  }

  public get handshake(): StreamHandshake {
    return { statusCode: this.statusCode, headers: this.responseHeaders }
  }

  public resultBody(collection: StreamCollection): Record<string, unknown> {
    return {
      events: collection.messages,
      eventCount: collection.messageCount,
      termination: collection.termination,
      ...(this.retryMsValue === undefined ? {} : { retryMs: this.retryMsValue }),
    }
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<StreamMessage> {
    if (!this.response) return
    for await (const message of iterateSseEvents(this.response, (retryMs) => {
      this.retryMsValue = retryMs
    })) {
      if (this.options.eventType === undefined || message["event"] === this.options.eventType) yield message
    }
  }

  public async close(): Promise<void> {
    // A body the iterator is reading is cancelled by the iterator's own cleanup.
    const body = this.response?.body
    if (body && !body.locked) await body.cancel()
  }
}

// fallow-ignore-next-line complexity -- this is the SSE framing state machine; its branches directly encode event-stream field, termination, and chunk-boundary rules.
export async function* iterateSseEvents(
  response: Response,
  onRetry: (retryMs: number) => void = () => undefined,
): AsyncGenerator<StreamMessage> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let receivedBytes = 0
  let buffer = ""
  let eventName = ""
  let eventId: string | undefined
  let dataLines: string[] = []

  const dispatch = (): StreamMessage | undefined => {
    if (dataLines.length === 0) {
      eventName = ""
      return undefined
    }
    const event = eventName || "message"
    const received: StreamMessage = { event, data: dataLines.join("\n"), ...(eventId === undefined ? {} : { id: eventId }) }
    eventName = ""
    dataLines = []
    return received
  }

  // fallow-ignore-next-line complexity -- each branch is a distinct SSE field rule, including comments, empty dispatches, and the NUL-id guard.
  const processLine = (rawLine: string): StreamMessage | undefined => {
    const line = rawLine
    if (line === "") return dispatch()
    if (line.startsWith(":")) return undefined
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
    if (field === "event") eventName = value
    if (field === "data") dataLines.push(value)
    if (field === "id" && !value.includes("\u0000")) eventId = value
    if (field === "retry" && /^\d+$/.test(value)) onRetry(Number(value))
    return undefined
  }

  const flushBufferedLines = (endOfStream = false): StreamMessage[] => {
    const emitted: StreamMessage[] = []
    for (;;) {
      const lineEndingIndex = buffer.search(/[\r\n]/)
      if (lineEndingIndex === -1) return emitted
      const first = buffer[lineEndingIndex]!
      if (!endOfStream && first === "\r" && lineEndingIndex === buffer.length - 1) {
        // A CRLF sequence may be split across chunks. Keep the CR until the
        // next chunk tells us whether this is CRLF or a standalone CR.
        return emitted
      }
      const lineEndingLength = first === "\r" && buffer[lineEndingIndex + 1] === "\n" ? 2 : 1
      const message = processLine(buffer.slice(0, lineEndingIndex))
      buffer = buffer.slice(lineEndingIndex + lineEndingLength)
      if (message !== undefined) emitted.push(message)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > STREAM_MAX_CAPTURE_BYTES) {
        throw new Error(`SSE response exceeded ${STREAM_MAX_CAPTURE_BYTES} byte capture limit`)
      }
      buffer += decoder.decode(value, { stream: true })
      for (const message of flushBufferedLines()) yield message
    }

    buffer += decoder.decode()
    for (const message of flushBufferedLines(true)) yield message
  } finally {
    // Stopping early (limit reached, finish rule matched) or failing: drop the connection.
    await reader.cancel().catch(() => undefined)
  }
}
