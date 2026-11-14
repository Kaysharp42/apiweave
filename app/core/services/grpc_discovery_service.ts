import type { GrpcDiscoveryResult } from "@shared/types/GrpcDiscoveryResult"
import { loadGrpcSchema, type GrpcSchemaSource } from "../runner/grpc"
import { describeSchema, GrpcSchemaError } from "../runner/grpc_schema"
import { SafeHttp } from "../runner/safe_http"
import { ValidationError } from "../ipc/errors"

export interface GrpcDiscoveryRequest {
  /** `host:port`, literal: nothing here substitutes placeholders. */
  readonly target: string
  readonly tls: boolean
  readonly sslVerify: boolean
  readonly source: GrpcSchemaSource
}

/**
 * Lists the services and methods a gRPC server (reflection) or a set of inline
 * `.proto` files describes, with a request skeleton for each method. It reads
 * and calls nothing but the reflection service, so it sits behind a read-only
 * handler. TLS follows Settings > Network through the app's {@link SafeHttp}.
 */
export class GrpcDiscoveryService {
  public constructor(private readonly http: SafeHttp = new SafeHttp()) {}

  public async discover(request: GrpcDiscoveryRequest): Promise<GrpcDiscoveryResult> {
    try {
      if (request.source.kind === "reflection") this.http.assertHostAllowed(request.target)
      const schema = await loadGrpcSchema(
        { target: request.target, tls: request.tls, sslVerify: request.sslVerify, tlsOptionsFor: (url, verify) => this.http.tlsOptionsFor(url, verify) },
        request.source,
      )
      return describeSchema(schema)
    } catch (error) {
      if (error instanceof GrpcSchemaError) throw new ValidationError(error.message)
      throw error
    }
  }
}
