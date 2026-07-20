import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WorkflowExecutor, type WorkflowGraph, type WorkflowNode, type WorkflowEdge } from "../executor";
import { HarnessError } from "./harness-error";
import { diffJson, isRecord, type JsonValue, parseJsonValue } from "./json-utils";
import { type HttpFixturePair, MockHttpServer } from "./mock-server";
import { FixedClockProvider, SeededRandomProvider } from "./providers";
import { DynamicFunctions } from "../dynamic_functions";
import { SafeHttp } from "../safe_http";

type CaseFixture = {
  readonly name: string;
  readonly seed: string;
  readonly clock: string;
  readonly workflow: JsonValue;
  readonly httpTapeRefs: readonly string[];
  readonly expectedOutput: JsonValue;
  readonly secrets?: Readonly<Record<string, string>>;
};

type CaseResult = {
  readonly name: string;
  readonly passed: boolean;
  readonly mismatches: readonly string[];
};

const rootDir = join(process.cwd(), "core", "runner", "harness");
const fixturesDir = join(rootDir, "fixtures");
const casesDir = process.env.PARITY_CASES_DIR ?? join(fixturesDir, "cases");
const httpDir = join(fixturesDir, "http");

async function main(): Promise<void> {
  const capture = process.argv.includes("--capture") || process.env.PARITY_RECORD === "1";
  if (capture) {
    await captureCases();
    return;
  }
  const cases = await loadCases();
  const server = new MockHttpServer(httpDir);
  await server.load();
  await withTimeout(server.start(), 1000, "Mock server startup timed out");
  try {
    const results: CaseResult[] = [];
    for (const fixture of cases) {
      await exerciseTapes(fixture, server.baseUrl());
      const actual = await runRealExecutor(fixture, server.baseUrl());
      const mismatches = diffJson(fixture.expectedOutput, actual, "$");
      const passed = mismatches.length === 0;
      results.push({ name: fixture.name, passed, mismatches });
      console.log(`${passed ? "PASS" : "FAIL"} ${fixture.name}${passed ? "" : ` ${mismatches[0] ?? ""}`}`);
    }
    report(results);
  } finally {
    await server.stop();
  }
}

async function captureCases(): Promise<void> {
  if (process.env.PARITY_RECORD !== "1") {
    throw new HarnessError("record_disabled", "PARITY_RECORD=1 required for recording");
  }
  const entries = await readdir(casesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const expectedPath = join(casesDir, entry.name, "expected-output.json");
    try {
      await readFile(expectedPath, "utf8");
      throw new HarnessError(
        "capture_refuse_overwrite",
        `Refusing to overwrite existing expected-output.json (delete first to re-capture): ${expectedPath}`,
      );
    } catch (error) {
      if (error instanceof HarnessError) {
        throw error;
      }
    }
  }
  throw new HarnessError("capture_not_available", "Python executor capture is not available in this Wave 1 scaffold");
}

async function loadCases(): Promise<readonly CaseFixture[]> {
  const entries = await readdir(casesDir, { withFileTypes: true });
  const cases: CaseFixture[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const caseDir = join(casesDir, entry.name);
    const rawCase: unknown = JSON.parse(await readFile(join(caseDir, "case.json"), "utf8"));
    const rawExpected: unknown = JSON.parse(await readFile(join(caseDir, "expected-output.json"), "utf8"));
    cases.push(parseCase(rawCase, rawExpected, join(caseDir, "case.json")));
  }
  cases.sort((left, right) => left.name.localeCompare(right.name));
  return cases;
}

function parseCase(value: unknown, expectedOutput: unknown, path: string): CaseFixture {
  if (!isRecord(value)) {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: expected object`);
  }
  if (typeof value.name !== "string" || typeof value.seed !== "string" || typeof value.clock !== "string") {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: name, seed, and clock are required`);
  }
  if (!Array.isArray(value.httpTapeRefs) || !value.httpTapeRefs.every((item) => typeof item === "string")) {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: httpTapeRefs must be string[]`);
  }
  const secrets = value.secrets !== undefined && isRecord(value.secrets)
    ? Object.fromEntries(Object.entries(value.secrets).filter(([, v]) => typeof v === "string")) as Record<string, string>
    : undefined;
  return {
    name: value.name,
    seed: value.seed,
    clock: value.clock,
    workflow: parseJsonValue(value.workflow, path) ?? null,
    httpTapeRefs: value.httpTapeRefs,
    expectedOutput: parseJsonValue(expectedOutput, join(dirname(path), "expected-output.json")) ?? null,
    secrets,
  };
}

async function exerciseTapes(fixture: CaseFixture, baseUrl: string): Promise<void> {
  for (const tapeRef of fixture.httpTapeRefs) {
    const path = join(fixturesDir, tapeRef);
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    const pair = parseTape(raw, path);
    const response = await fetch(`${baseUrl}${pair.request.url}`, {
      method: pair.request.method,
      headers: pair.request.headers,
      body: pair.request.body === undefined ? undefined : JSON.stringify(pair.request.body),
      signal: AbortSignal.timeout(1000),
    });
    if (response.status !== pair.response.status) {
      throw new HarnessError("mock_replay_mismatch", `${fixture.name}: ${tapeRef} returned ${response.status}`);
    }
  }
}

function normalizeWorkflow(raw: JsonValue): WorkflowGraph {
  if (!isRecord(raw)) {
    throw new HarnessError("fixture_validation", "workflow must be an object");
  }
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];

  const typeMap: Record<string, WorkflowNode["type"]> = {
    httpRequest: "http-request",
    "http-request": "http-request",
    assertion: "assertion",
    delay: "delay",
    merge: "merge",
    start: "start",
    end: "end",
  };

  const nodes: WorkflowNode[] = rawNodes.map((rawNode: unknown) => {
    if (!isRecord(rawNode)) {
      throw new HarnessError("fixture_validation", "workflow node must be an object");
    }
    const nodeId = (typeof rawNode.id === "string" ? rawNode.id : rawNode.nodeId) as string;
    if (!nodeId || typeof nodeId !== "string") {
      throw new HarnessError("fixture_validation", "workflow node must have id or nodeId");
    }
    const rawType = typeof rawNode.type === "string" ? rawNode.type : "start";
    const type = typeMap[rawType] ?? "start";
    const config = isRecord(rawNode.config) ? rawNode.config as Record<string, unknown> : undefined;
    return { nodeId, type, config };
  });

  const edges: WorkflowEdge[] = rawEdges.map((rawEdge: unknown, idx: number) => {
    if (!isRecord(rawEdge)) {
      throw new HarnessError("fixture_validation", "workflow edge must be an object");
    }
    return {
      edgeId: typeof rawEdge.edgeId === "string" ? rawEdge.edgeId : `e${idx}`,
      source: String(rawEdge.source ?? ""),
      target: String(rawEdge.target ?? ""),
      sourceHandle: typeof rawEdge.sourceHandle === "string" ? rawEdge.sourceHandle : null,
      targetHandle: typeof rawEdge.targetHandle === "string" ? rawEdge.targetHandle : null,
    };
  });

  return { nodes, edges };
}

async function runRealExecutor(fixture: CaseFixture, baseUrl: string): Promise<JsonValue> {
  const clock = new FixedClockProvider(fixture.clock);
  const rng = new SeededRandomProvider(fixture.seed);
  const http = new SafeHttp({ allowLoopback: true });
  const functions = new DynamicFunctions(clock, rng);

  const executor = new WorkflowExecutor({
    clock,
    rng,
    http,
    functions,
    baseUrl,
    secrets: fixture.secrets,
  });

  const workflow = normalizeWorkflow(fixture.workflow);
  const output = await executor.executeWorkflow(workflow, {}, fixture.name, fixture.seed);

  // Convert to JsonValue for diff comparison
  return toJsonValue(output);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = toJsonValue(val);
    }
    return out;
  }
  return null;
}

function report(results: readonly CaseResult[]): void {
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  if (failed === 0) {
    console.log(`${passed}/${results.length} fixtures pass`);
    return;
  }
  const failedCases = results.filter((result) => !result.passed);
  for (const result of failedCases) {
    console.log(`case=${result.name}, mismatches=${result.mismatches.length}`);
    for (const mismatch of result.mismatches.slice(0, 5)) {
      console.log(`  ${mismatch}`);
    }
  }
  console.log(`${passed}/${results.length} pass; ${failed}/${results.length} fail`);
  process.exitCode = 1;
}

function parseTape(value: unknown, path: string): HttpFixturePair {
  if (!isRecord(value) || !isRecord(value.request) || !isRecord(value.response)) {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: request and response are required`);
  }
  if (typeof value.request.method !== "string" || typeof value.request.url !== "string" || typeof value.response.status !== "number") {
    throw new HarnessError("fixture_validation", `Validation error in ${path}: invalid request/response shape`);
  }
  return {
    request: {
      method: value.request.method,
      url: value.request.url,
      headers: parseStringRecord(value.request.headers),
      body: parseJsonValue(value.request.body, path),
    },
    response: {
      status: value.response.status,
      headers: parseStringRecord(value.response.headers),
      body: parseJsonValue(value.response.body, path),
    },
  };
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (typeof item === "string") {
      out[key] = item;
    }
  }
  return out;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new HarnessError("timeout", message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof HarnessError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
