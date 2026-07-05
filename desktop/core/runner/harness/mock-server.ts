import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HarnessError } from "./harness-error";

export type HttpFixtureRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: JsonValue;
};

export type HttpFixtureResponse = {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: JsonValue;
};

export type HttpFixturePair = {
  readonly request: HttpFixtureRequest;
  readonly response: HttpFixtureResponse;
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type RecordedPair = {
  readonly path: string;
  readonly pair: HttpFixturePair;
};

export class MockHttpServer {
  private readonly fixtures = new Map<string, RecordedPair>();
  private server: Server | undefined;
  private port: number | undefined;

  constructor(private readonly fixtureDir: string) {}

  async load(): Promise<void> {
    const entries = await readdir(this.fixtureDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const path = join(this.fixtureDir, entry.name);
      const raw: unknown = JSON.parse(await readFile(path, "utf8"));
      const pair = parsePair(raw, path);
      this.fixtures.set(signature(pair.request), { path, pair });
    }
  }

  async start(): Promise<string> {
    if (this.server !== undefined) {
      throw new HarnessError("mock_server_running", "Mock server is already running");
    }
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(new HarnessError("mock_server_address", "Mock server did not bind to a TCP port"));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
    return this.baseUrl();
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return;
    }
    this.server = undefined;
    this.port = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  baseUrl(): string {
    if (this.port === undefined) {
      throw new HarnessError("mock_server_stopped", "Mock server is not running");
    }
    return `http://127.0.0.1:${this.port}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request);
    const replayRequest: HttpFixtureRequest = {
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: lowerSelectedHeaders(request.headers),
      body: body.length === 0 ? undefined : parseBody(body),
    };
    const hit = this.fixtures.get(signature(replayRequest));
    if (hit === undefined) {
      writeJson(response, 599, {
        error: "No replay fixture matched request",
        signature: signature(replayRequest),
      });
      return;
    }
    const headers = hit.pair.response.headers ?? { "content-type": "application/json" };
    response.writeHead(hit.pair.response.status, headers);
    response.end(serializeBody(hit.pair.response.body));
  }
}

export async function recordPair(path: string, pair: HttpFixturePair): Promise<void> {
  if (process.env.PARITY_RECORD !== "1") {
    throw new HarnessError("record_disabled", "PARITY_RECORD=1 required for recording");
  }
  await writeFile(path, `${JSON.stringify(pair, null, 2)}\n`, { flag: "wx" });
}

function parsePair(value: unknown, path: string): HttpFixturePair {
  if (!isRecord(value)) {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: expected object`);
  }
  const request = parseRequest(value.request, path);
  const response = parseResponse(value.response, path);
  return { request, response };
}

function parseRequest(value: unknown, path: string): HttpFixtureRequest {
  if (!isRecord(value) || typeof value.method !== "string" || typeof value.url !== "string") {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: request.method and request.url are required`);
  }
  return {
    method: value.method,
    url: value.url,
    headers: parseHeaders(value.headers, path),
    body: parseJsonValue(value.body, path),
  };
}

function parseResponse(value: unknown, path: string): HttpFixtureResponse {
  if (!isRecord(value) || typeof value.status !== "number") {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: response.status is required`);
  }
  return {
    status: value.status,
    headers: parseHeaders(value.headers, path),
    body: parseJsonValue(value.body, path),
  };
}

function parseHeaders(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: headers must be an object`);
  }
  const headers: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) {
    const headerValue = value[key];
    if (typeof headerValue !== "string") {
      throw new HarnessError("fixture_validation", `Validation error in ${path}: header ${key} must be a string`);
    }
    headers[key.toLowerCase()] = headerValue;
  }
  return headers;
}

function parseJsonValue(value: unknown, path: string): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => parseJsonValue(item, path) ?? null);
  }
  if (!isRecord(value)) {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: body must be JSON-compatible`);
  }
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = parseJsonValue(value[key], path) ?? null;
  }
  return out;
}

function signature(request: HttpFixtureRequest): string {
  return JSON.stringify({
    method: request.method.toUpperCase(),
    url: request.url,
    headers: request.headers ?? {},
    body: request.body ?? null,
  });
}

function lowerSelectedHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const name of ["authorization", "content-type", "x-api-key", "x-branch"]) {
    const value = headers[name];
    if (typeof value === "string") {
      selected[name] = value;
    }
  }
  return selected;
}

function parseBody(body: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(body);
    return parseJsonValue(parsed, "request body") ?? null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return body;
    }
    throw error;
  }
}

function serializeBody(body: JsonValue | undefined): string {
  if (body === undefined) {
    return "";
  }
  return typeof body === "string" ? body : JSON.stringify(body);
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }
  return body;
}

function writeJson(response: ServerResponse, status: number, body: JsonValue): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
