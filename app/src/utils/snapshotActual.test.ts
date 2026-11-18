import { describe, expect, it } from "vitest";
import { readSnapshotActual } from "./snapshotActual";

const result = {
  statusCode: 200,
  status: "success",
  duration: 12,
  body: { id: "sku_1", tags: ["a", "b"] },
  headers: { "Content-Type": "application/json" },
  response: {
    statusCode: 200,
    status: "OK",
    body: { id: "sku_1", tags: ["a", "b"] },
    fault: { code: "soap:Server" },
  },
};

describe("readSnapshotActual", () => {
  it("reads a response. path off the response object first, as the runner does", () => {
    expect(readSnapshotActual(result, { source: "prev", path: "response.body" })).toEqual(result.body);
    expect(readSnapshotActual(result, { source: "prev", path: "response.status" })).toBe("OK");
    expect(readSnapshotActual(result, { source: "prev", path: "response.fault.code" })).toBe("soap:Server");
    expect(readSnapshotActual(result, { source: "prev", path: "response.body.tags[1]" })).toBe("b");
  });

  it("falls back to the result for a field only it has, and reads unprefixed and JSONPath paths off it", () => {
    expect(readSnapshotActual(result, { source: "prev", path: "response.duration" })).toBe(12);
    expect(readSnapshotActual(result, { source: "prev", path: "body.id" })).toBe("sku_1");
    expect(readSnapshotActual(result, { source: "prev", path: "$.response.body.tags" })).toEqual(["a", "b"]);
  });

  it("reads the status code and a header by name, and nothing for a variable or a missing result", () => {
    expect(readSnapshotActual(result, { source: "status", path: "" })).toBe(200);
    expect(readSnapshotActual(result, { source: "headers", path: "content-type" })).toBe("application/json");
    expect(readSnapshotActual(result, { source: "variables", path: "token" })).toBeUndefined();
    expect(readSnapshotActual(undefined, { source: "prev", path: "response.body" })).toBeUndefined();
  });
});
