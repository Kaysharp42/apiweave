import * as grpc from "@grpc/grpc-js"
import {
  createClient,
  fromMetadata,
  loadGrpcSchema,
  toMetadata,
  type GrpcConnection,
  type GrpcSchemaSource,
} from "../grpc"
import { GrpcSchemaError, serverStreamingMethod } from "../grpc_schema"
import {
  STREAM_MAX_CAPTURE_BYTES,
  StreamHandshakeError,
  type StreamAdapter,
  type StreamCollection,
  type StreamHandshake,
  type StreamMessage,
} from "../stream_listener"

export interface GrpcStreamAdapterOptions {
  readonly connection: GrpcConnection
  readonly source: GrpcSchemaSource
  readonly service: string
  readonly method: string
  /** The request message, already substituted and parsed. */
  readonly message: unknown
  /** Lowercase keys; keys ending in `-bin` are sent binary from base64. */
  readonly metadata: Readonly<Record<string, string>>
  /** The call deadline. A call that outlives it ends with DEADLINE_EXCEEDED, which fails the node. */
  readonly deadlineMs: number
  readonly signal: AbortSignal
  /** The status code name the node expects; a matching final status is an outcome, not a failure. */
  readonly expectedStatus?: string | undefined
}

/** What a finished server stream reported after its messages: the final status and trailers. */
interface GrpcStreamStatus {
  readonly code: number
  readonly codeName: string
  readonly statusMessage: string
}

/**
 * A gRPC server-streaming call driven as a stream node. The handshake is
 * accepted once the call starts (initial metadata, a first message, or a final
 * status), messages are decoded exactly as `schemaFromReflection` and
 * `schemaFromProtoFiles` describe them, and the final status and trailers are
 * reported on the result.
 *
 * gRPC says a status is the outcome of the call, not a connection failure, so
 * a non-OK status that the node expects is a normal end of the stream and one
 * that it does not expect fails the node with the code and message.
 */
export class GrpcStreamAdapter implements StreamAdapter {
  public readonly label = "gRPC"
  public readonly unit = "message"
  public readonly limitTermination = "message-limit"
  /** A server stream ending is the call completing, so it is not an incomplete capture. */
  public readonly endsCleanly = true

  private client: grpc.Client | undefined
  private call: grpc.ClientReadableStream<object> | undefined
  private readonly queue: StreamMessage[] = []
  private wake: (() => void) | null = null
  private opened = false
  private ended = false
  private failure: Error | null = null
  private receivedBytes = 0
  private headers: Record<string, string> = {}
  private trailers: Record<string, string> = {}
  private status: GrpcStreamStatus = { code: grpc.status.UNKNOWN, codeName: "UNKNOWN", statusMessage: "" }
  private resolveOpen: (() => void) | null = null
  private rejectOpen: ((error: Error) => void) | null = null
  private readonly onAbort = (): void => this.fail(new Error("gRPC stream cancelled"))

  public constructor(private readonly options: GrpcStreamAdapterOptions) {}

  public async open(): Promise<void> {
    const { connection, source, service, method, message, metadata, deadlineMs, signal } = this.options
    let definition: ReturnType<typeof serverStreamingMethod>
    let schema
    try {
      schema = await loadGrpcSchema(connection, source)
      definition = serverStreamingMethod(schema, service, method)
      // A message that does not fit the request type is the author's mistake: report it before connecting.
      definition.requestSerialize(message as object)
    } catch (error) {
      const text = error instanceof GrpcSchemaError ? error.message : String(error)
      throw new StreamHandshakeError(text, { method: "GRPC", url: connection.target })
    }

    if (signal.aborted) throw new StreamHandshakeError("gRPC stream cancelled", { method: "GRPC", url: connection.target })

    const client = createClient(connection)
    this.client = client
    const accepted = new Promise<void>((resolve, reject) => {
      this.resolveOpen = resolve
      this.rejectOpen = reject
    })
    const call = client.makeServerStreamRequest(definition.path, definition.requestSerialize, definition.responseDeserialize, message as object, toMetadata(metadata), {
      deadline: Date.now() + deadlineMs,
    })
    this.call = call
    signal.addEventListener("abort", this.onAbort, { once: true })

    call.on("metadata", (received) => {
      this.headers = fromMetadata(received)
      this.markOpen()
    })
    call.on("data", (value: unknown) => this.onMessage(value))
    call.on("error", (error: grpc.ServiceError) => {
      // grpc-js reports an unexpected non-OK status as an error and then a status;
      // `status` owns the outcome, so a call that never opened is judged there.
      if (!this.opened) return
      this.fail(error)
    })
    call.on("end", () => {
      this.ended = true
      this.markOpen()
      this.notify()
    })
    call.on("status", (status: grpc.StatusObject) => {
      this.status = {
        code: status.code,
        codeName: grpc.status[status.code] ?? String(status.code),
        statusMessage: status.details,
      }
      this.trailers = fromMetadata(status.metadata)
      this.ended = true
      if (!this.opened) {
        // The call finished before it produced anything: a status the node
        // expects is that outcome, anything else is this node's failure.
        if (this.options.expectedStatus === this.status.codeName) {
          this.markOpen()
          this.notify()
          return
        }
        this.rejectOpen?.(new StreamHandshakeError(this.describeStatus(), this.statusDetails()))
        this.rejectOpen = null
        this.notify()
        return
      }
      if (this.status.code !== grpc.status.OK && this.options.expectedStatus !== this.status.codeName) {
        this.fail(new Error(this.describeStatus()))
        return
      }
      this.notify()
    })

    await accepted
  }

  public get handshake(): StreamHandshake {
    return {
      statusCode: this.status.code,
      status: this.status.codeName,
      statusMessage: this.status.statusMessage,
      headers: this.headers,
      trailers: this.trailers,
    }
  }

  public resultBody(collection: StreamCollection): Record<string, unknown> {
    return {
      messages: collection.messages,
      messageCount: collection.messageCount,
      termination: collection.termination,
      status: this.status.codeName,
      statusCode: this.status.code,
      statusMessage: this.status.statusMessage,
      trailers: this.trailers,
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
      if (this.ended) return
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }

  public async close(): Promise<void> {
    this.options.signal.removeEventListener("abort", this.onAbort)
    try {
      this.call?.cancel()
    } catch {
      // Already finished.
    }
    try {
      this.client?.close()
    } catch {
      // Already closed.
    }
  }

  private onMessage(value: unknown): void {
    const message: StreamMessage = typeof value === "object" && value !== null ? (value as StreamMessage) : { value }
    this.receivedBytes += Buffer.byteLength(JSON.stringify(message))
    this.queue.push(message)
    this.markOpen()
    if (this.receivedBytes > STREAM_MAX_CAPTURE_BYTES) {
      this.fail(new Error(`gRPC stream exceeded ${STREAM_MAX_CAPTURE_BYTES} byte capture limit`))
      return
    }
    this.notify()
  }

  private markOpen(): void {
    if (this.opened) return
    this.opened = true
    this.rejectOpen = null
    this.resolveOpen?.()
    this.resolveOpen = null
  }

  /** Record a failure, reject a pending open, wake the reader and drop the call. */
  private fail(error: Error): void {
    if (this.failure === null) this.failure = error
    this.rejectOpen?.(error)
    this.rejectOpen = null
    this.options.signal.removeEventListener("abort", this.onAbort)
    try {
      this.call?.cancel()
    } catch {
      // Already finished.
    }
    this.notify()
  }

  private notify(): void {
    const wake = this.wake
    this.wake = null
    wake?.()
  }

  private describeStatus(): string {
    const expectation = this.options.expectedStatus === undefined ? "" : ` (expected ${this.options.expectedStatus})`
    const reason = this.status.statusMessage === "" ? "" : `: ${this.status.statusMessage}`
    return `gRPC ${this.options.service}/${this.options.method} returned ${this.status.codeName}${expectation}${reason}`
  }

  /** The result fields a handshake failure records, so the node shows the status it got. */
  private statusDetails(): Readonly<Record<string, unknown>> {
    return {
      method: "GRPC",
      url: this.options.connection.target,
      statusCode: this.status.code,
      headers: this.headers,
      body: this.resultBody({ messages: [], messageCount: 0, termination: "stream-ended" }),
    }
  }
}
