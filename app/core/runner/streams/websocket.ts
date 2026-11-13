import { Buffer } from "node:buffer"
import { setTimeout as sleep } from "node:timers/promises"
import { WebSocket, type Dispatcher } from "undici"
import { STREAM_MAX_CAPTURE_BYTES, StreamHandshakeError, type StreamAdapter, type StreamCollection, type StreamMessage } from "../stream_listener"

export interface WebsocketMessageToSend {
  readonly data: string
  readonly type: "text" | "binary"
  readonly delayMs?: number
}

export interface WebsocketAdapterOptions {
  readonly url: string
  readonly headers: Record<string, string>
  readonly signal: AbortSignal
  readonly sslVerify: boolean
  readonly timeoutMs: number
  readonly dispatcher: Dispatcher | undefined
  readonly subprotocols?: readonly string[]
  readonly messages?: readonly WebsocketMessageToSend[]
}

/**
 * A WebSocket connection backed by undici's `WebSocket`. Messages are yielded
 * as `{ type: "text" | "binary", data }`; binary `data` is base64. The socket
 * is closed on timeout, cancellation and when the consumer stops reading.
 */
export class WebsocketAdapter implements StreamAdapter {
  private ws: WebSocket | undefined
  private readonly queue: StreamMessage[] = []
  private waiter: (() => void) | null = null
  private closed = false
  private closeCode = 1005
  private closeReason = ""
  private error: Error | null = null
  private receivedBytes = 0
  private timedOut = false
  private openResolve: (() => void) | null = null
  private openReject: ((error: Error) => void) | null = null

  public constructor(private readonly options: WebsocketAdapterOptions) {}

  public async open(): Promise<void> {
    this.validateUrl(this.options.url)
    await this.waitForOpen()
    await this.sendAll()
  }

  private static isWebSocketUrl(url: string): boolean {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    return parsed.protocol === "ws:" || parsed.protocol === "wss:"
  }

  private validateUrl(url: string): void {
    if (!WebsocketAdapter.isWebSocketUrl(url)) {
      throw new StreamHandshakeError(`Not a WebSocket (ws:// or wss://) URL: ${url}`)
    }
  }

  private waitForOpen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.openResolve = resolve
      this.openReject = reject
      const { url, headers, subprotocols, dispatcher } = this.options
      const ws = new WebSocket(url, {
        ...(subprotocols && subprotocols.length > 0 ? { protocols: [...subprotocols] } : {}),
        ...(dispatcher ? { dispatcher } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      })
      ws.binaryType = "arraybuffer"
      this.ws = ws
      ws.addEventListener("open", () => this.openResolve?.())
      ws.addEventListener("message", (event) => this.onMessage(event))
      ws.addEventListener("close", (event) => this.onClose(event))
      ws.addEventListener("error", () => this.onError())
      this.options.signal.addEventListener("abort", () => this.abort())
      if (this.options.timeoutMs > 0) {
        const timer = setTimeout(() => {
          this.timedOut = true
          this.error = new Error(`WebSocket timed out after ${this.options.timeoutMs / 1000}s`)
          this.ws?.close()
        }, this.options.timeoutMs)
        timer.unref?.()
      }
    })
  }

  private async sendAll(): Promise<void> {
    for (const message of this.options.messages ?? []) {
      if (this.closed || this.error) return
      if (message.delayMs) {
        try {
          await sleep(message.delayMs, undefined, { signal: this.options.signal })
        } catch {
          return
        }
      }
      if (this.closed || this.error) return
      const data = message.type === "binary" ? Buffer.from(message.data, "base64") : message.data
      try {
        this.ws?.send(data)
      } catch {
        return
      }
    }
  }

  private onMessage(event: { readonly data: unknown }): void {
    const data = event.data
    if (typeof data === "string") {
      this.receivedBytes += Buffer.byteLength(data)
      this.push({ type: "text", data })
    } else if (data instanceof ArrayBuffer) {
      const bytes = Buffer.from(data)
      this.receivedBytes += bytes.byteLength
      this.push({ type: "binary", data: bytes.toString("base64") })
    }
    if (this.receivedBytes > STREAM_MAX_CAPTURE_BYTES) {
      this.error = new Error(`WebSocket response exceeded ${STREAM_MAX_CAPTURE_BYTES} byte capture limit`)
      this.ws?.close()
    }
  }

  private onClose(event: { readonly code: number; readonly reason: string }): void {
    this.closed = true
    this.closeCode = event.code
    this.closeReason = event.reason
    this.waiter?.()
  }

  private onError(): void {
    this.error = this.error ?? new Error("WebSocket connection failed")
    this.openReject?.(this.error)
    this.waiter?.()
  }

  private abort(): void {
    if (!this.error) this.error = new Error("WebSocket cancelled")
    this.ws?.close()
  }

  private push(message: StreamMessage): void {
    this.queue.push(message)
    this.waiter?.()
  }

  public get handshake(): Record<string, unknown> {
    return {}
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
      if (this.error) throw this.error
      if (this.closed && this.queue.length === 0) return
      const message = this.queue.shift()
      if (message !== undefined) {
        yield message
        continue
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
    }
  }

  public async close(): Promise<void> {
    try {
      this.ws?.close()
    } catch {
      // Already closed.
    }
  }
}
