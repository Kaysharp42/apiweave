/**
 * The protocol-neutral stream-listener seam.
 *
 * SSE, WebSocket, and (later) gRPC server streaming and message-queue consume
 * share one two-phase lifecycle: a Ready output that fires once the handshake
 * succeeds, then a bounded background consumer that closes on a message limit,
 * a finish rule, a timeout or the end of the stream, and fires the Complete
 * output. This module holds the pieces every protocol shares; each protocol
 * contributes an adapter (`streams/{sse,websocket}.ts`) for its own handshake,
 * framing and teardown.
 */

/** Raw bytes a stream listener will capture before it stops pulling. */
export const STREAM_MAX_CAPTURE_BYTES = 1024 * 1024

/**
 * One message from a stream adapter, normalized to a JSON-able record. The
 * shape is protocol-specific (`{ event, id?, data }` for SSE, `{ type, data }`
 * for WebSocket); a finish rule's path addresses the record's keys.
 */
export type StreamMessage = Readonly<Record<string, unknown>>

/** Why a stream listener closed. */
export type StreamTermination = "message-limit" | "finish-condition" | "stream-ended"

/** The collected messages plus why the listener stopped. */
export interface StreamCollection {
  readonly messages: readonly StreamMessage[]
  readonly messageCount: number
  readonly termination: StreamTermination
}

/**
 * The adapter contract a protocol implements to ride the seam:
 *
 * 1. `open()` completes the handshake. It resolves when the stream is ready
 *    (which fires the Ready output) and rejects — with a
 *    {@link StreamHandshakeError} to carry result fields — to fail the node.
 * 2. The async iterator yields normalized messages.
 * 3. `close()` tears the connection down. It must be idempotent.
 *
 * `handshake` and `resultBody` carry the protocol's own result facts so the
 * executor stays protocol-agnostic.
 */
export interface StreamAdapter {
  /** Complete the handshake. Resolves when ready; rejects to fail the node. */
  open(): Promise<void>
  /** The normalized messages, yielded as they arrive. */
  [Symbol.asyncIterator](): AsyncIterator<StreamMessage>
  /** Close the connection, releasing any socket. Idempotent. */
  close(): Promise<void>
  /** Handshake facts merged into the node result (SSE's statusCode and headers). */
  readonly handshake: Readonly<Record<string, unknown>>
  /** The collected `response.body`: shared fields plus protocol extras. */
  resultBody(collection: StreamCollection): Record<string, unknown>
}

/** A handshake failure that also carries the result fields the node should record. */
export class StreamHandshakeError extends Error {
  public constructor(
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = "StreamHandshakeError"
  }
}

/**
 * Consume an adapter's messages until the message limit, a matching finish
 * rule, or the end of the stream. The terminal message that satisfies a finish
 * rule displaces the oldest capture rather than being discarded, so the result
 * always names why the listener closed.
 */
export async function collectStreamMessages(
  adapter: StreamAdapter,
  options: {
    readonly maxMessages: number
    readonly finishWhen?: (message: StreamMessage) => boolean
  },
): Promise<StreamCollection> {
  const messages: StreamMessage[] = []
  let termination: StreamTermination | null = null
  try {
    for await (const message of adapter) {
      const finished = options.finishWhen?.(message) ?? false
      if (messages.length < options.maxMessages) {
        messages.push(message)
      } else if (finished) {
        messages.shift()
        messages.push(message)
      }
      if (finished) {
        termination = "finish-condition"
      } else if (options.finishWhen === undefined && messages.length >= options.maxMessages) {
        termination = "message-limit"
      }
      if (termination !== null) break
    }
  } finally {
    await adapter.close()
  }
  return { messages, messageCount: messages.length, termination: termination ?? "stream-ended" }
}
