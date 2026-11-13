import { Buffer } from "node:buffer"
import { setTimeout as sleep } from "node:timers/promises"
import { WebSocket, type Dispatcher } from "undici"
import { describeNetworkError } from "../safe_http"
import {
  STREAM_MAX_CAPTURE_BYTES,
  StreamHandshakeError,
  type StreamAdapter,
  type StreamCollection,
  type StreamHandshake,
  type StreamMessage,
} from "../stream_listener"

export interface WebsocketMessageToSend {
  readonly data: string
  readonly type: "text" | "binary"
  readonly delayMs?: number
}

export interface WebsocketAdapterOptions {
  /** A validated ws:// or wss:// URL, query string included. */
  readonly url: string
  readonly headers: Record<string, string>
  /** Aborts the connection (run cancelled, or the executor settling its listeners). */
  readonly signal: AbortSignal
  /** Whole-connection deadline, handshake included. Zero: none. */
  readonly timeoutMs: number
  /** From `SafeHttp.dispatcherFor`: proxy, trusted CAs, client certificate, TLS verification. */
  readonly dispatcher: Dispatcher | undefined
  readonly subprotocols?: readonly string[]
  /** Sent in order once the handshake completes. */
  readonly messages?: readonly WebsocketMessageToSend[]
}

/**
 * A WebSocket connection backed by undici's `WebSocket`. Incoming frames are
 * yielded as `{ type: "text" | "binary", data }`; binary `data` is base64.
 * The socket is closed on timeout, cancellation, a capture overflow and when
 * the consumer stops reading.
 */
export class WebsocketAdapter implements StreamAdapter {
  public readonly label = "WebSocket"
  public readonly unit = "message"
  public readonly limitTermination = "message-limit"

  private ws: WebSocket | undefined
  private readonly queue: StreamMessage[] = []
  private wake: (() => void) | null = null
  private opened = false
  private closed = false
  private closeCode = 1005
  private closeReason = ""
  private failure: Error | null = null
  private receivedBytes = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private rejectOpen: ((error: Error) => void) | null = null
  private readonly onAbort = (): void => this.fail(new Error("WebSocket cancelled"))

  public constructor(private readonly options: WebsocketAdapterOptions) {}

  public async open(): Promise<void> {
    await this.connect()
    await this.sendAll()
  }

  /** A completed handshake is always `101 Switching Protocols`; undici exposes no upgrade headers. */
  public get handshake(): StreamHandshake {
    return { statusCode: 101, headers: {} }
  }

  public resultBody(collection: StreamCollection): Record<string, unknown> {
    return {
      messages: collection.messages,
      messageCount: collection.messageCount,
      termination: collection.termination,
      closeCode: this.closeCode,
      closeReason: this.closeReason,
    }
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<StreamMessage> {
    for (;;) {
      const message = this.queue.shift()
      if (message !== undefined) {
        yield message
        continue
      }
      if (this.failure) throw this.failure
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }

  public async close(): Promise<void> {
    this.release()
    try {
      this.ws?.close()
    } catch {
      // Already closing.
    }
  }

  private connect(): Promise<void> {
    const { url, headers, subprotocols, dispatcher, signal, timeoutMs } = this.options
    return new Promise<void>((resolve, reject) => {
      this.rejectOpen = reject
      if (signal.aborted) {
        reject(new Error("WebSocket cancelled"))
        return
      }
      const ws = new WebSocket(url, {
        ...(subprotocols && subprotocols.length > 0 ? { protocols: [...subprotocols] } : {}),
        ...(dispatcher ? { dispatcher } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      })
      ws.binaryType = "arraybuffer"
      this.ws = ws
      signal.addEventListener("abort", this.onAbort, { once: true })
      if (timeoutMs > 0) {
        this.timer = setTimeout(() => this.fail(new Error(`WebSocket timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      }
      ws.addEventListener("open", () => {
        this.opened = true
        this.rejectOpen = null
        resolve()
      })
      ws.addEventListener("message", (event) => this.onMessage(event.data))
      ws.addEventListener("close", (event) => this.onClose(event.code, event.reason))
      ws.addEventListener("error", (event) => this.fail(new Error(describeNetworkError(event.error, url) ?? (event.message || "WebSocket connection failed"))))
    })
  }

  private async sendAll(): Promise<void> {
    for (const message of this.options.messages ?? []) {
      if (message.delayMs) {
        try {
          await sleep(message.delayMs, undefined, { signal: this.options.signal })
        } catch {
          return
        }
      }
      if (this.closed || this.failure) return
      this.ws?.send(message.type === "binary" ? Buffer.from(message.data, "base64") : message.data)
    }
  }

  private onMessage(data: unknown): void {
    if (typeof data === "string") {
      this.receivedBytes += Buffer.byteLength(data)
      this.queue.push({ type: "text", data })
    } else if (data instanceof ArrayBuffer) {
      const bytes = Buffer.from(data)
      this.receivedBytes += bytes.byteLength
      this.queue.push({ type: "binary", data: bytes.toString("base64") })
    }
    if (this.receivedBytes > STREAM_MAX_CAPTURE_BYTES) {
      this.fail(new Error(`WebSocket response exceeded ${STREAM_MAX_CAPTURE_BYTES} byte capture limit`))
      return
    }
    this.notify()
  }

  private onClose(code: number, reason: string): void {
    this.closed = true
    this.closeCode = code
    this.closeReason = reason
    this.release()
    if (!this.opened) {
      this.failOpen(new StreamHandshakeError(`WebSocket handshake failed (close code ${code})`))
    }
    this.notify()
  }

  /** Record a failure, reject a pending open, wake the reader and drop the socket. */
  private fail(error: Error): void {
    if (this.failure === null) this.failure = error
    this.failOpen(error)
    this.release()
    try {
      this.ws?.close()
    } catch {
      // Already closing.
    }
    this.notify()
  }

  private failOpen(error: Error): void {
    this.rejectOpen?.(this.failure ?? error)
    this.rejectOpen = null
  }

  private release(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.options.signal.removeEventListener("abort", this.onAbort)
  }

  private notify(): void {
    const wake = this.wake
    this.wake = null
    wake?.()
  }
}
