import { describe, expect, it } from "vitest"
import { compareSnapshot, snapshotValue, type SnapshotStore } from "../snapshots"
import type { JsonValue } from "@shared/types/JsonValue"

const baseline = {
  id: "o-1",
  total: { currency: "EUR", cents: 900 },
  items: [{ sku: "a", qty: 1 }, { sku: "b", qty: 2 }],
  updatedAt: "2026-01-01T00:00:00.000Z",
}

describe("compareSnapshot", () => {
  it("is equal to itself", () => {
    expect(compareSnapshot(baseline, structuredClone(baseline)).equal).toBe(true)
  })

  it("names the location and both values of a changed field", () => {
    const actual = { ...structuredClone(baseline), total: { currency: "USD", cents: 900 } }
    const comparison = compareSnapshot(baseline, actual)
    expect(comparison.equal).toBe(false)
    expect(comparison.differences).toEqual([{ path: `$['total']['currency']`, expected: "EUR", actual: "USD" }])
    expect(comparison.differenceCount).toBe(1)
  })

  it("reports an added and a removed field", () => {
    const actual = { ...structuredClone(baseline), extra: true }
    delete (actual as Record<string, unknown>)["id"]
    const paths = compareSnapshot(baseline, actual).differences.map((difference) => difference.path)
    expect(paths).toContain(`$['extra']`)
    expect(paths).toContain(`$['id']`)
  })

  it("compares arrays by index and length", () => {
    const actual = { ...structuredClone(baseline), items: [{ sku: "a", qty: 1 }] }
    const comparison = compareSnapshot(baseline, actual)
    expect(comparison.differences.map((difference) => difference.path)).toEqual([`$['items'][1]`])
  })

  it("ignores the locations a JSONPath selects, on either side", () => {
    const actual = { ...structuredClone(baseline), updatedAt: "2026-11-13T00:00:00.000Z", total: { currency: "EUR", cents: 901 } }
    const comparison = compareSnapshot(baseline, actual, ["$..updatedAt", `$['total']['cents']`])
    expect(comparison.equal).toBe(true)
  })

  it("ignores a whole subtree a wildcard selects", () => {
    const actual = { ...structuredClone(baseline), items: [{ sku: "z", qty: 9 }] }
    expect(compareSnapshot(baseline, actual, [`$['items']`]).equal).toBe(true)
  })

  it("still compares what an ignore path does not select", () => {
    const actual = { ...structuredClone(baseline), updatedAt: "changed", total: { currency: "USD", cents: 900 } }
    const comparison = compareSnapshot(baseline, actual, ["$..updatedAt"])
    expect(comparison.differences.map((difference) => difference.path)).toEqual([`$['total']['currency']`])
  })

  it("caps the reported differences but counts them all", () => {
    const wide = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`k${index}`, index]))
    const comparison = compareSnapshot(wide as JsonValue, Object.fromEntries(Object.keys(wide).map((key) => [key, -1])) as JsonValue)
    expect(comparison.differenceCount).toBe(30)
    expect(comparison.differences).toHaveLength(20)
  })
})

describe("snapshotValue", () => {
  it("keeps JSON values and turns a missing value into null", () => {
    expect(snapshotValue({ a: 1 })).toEqual({ a: 1 })
    expect(snapshotValue(undefined)).toBeNull()
    expect(snapshotValue("text")).toBe("text")
  })
})

describe("SnapshotStore contract", () => {
  it("is implemented by a map for tests", () => {
    const store: SnapshotStore = new MapStore()
    expect(store.read("w", "n", 0)).toBeUndefined()
    store.write("w", "n", 0, { ok: true }, "2026-01-01T00:00:00.000Z")
    expect(store.read("w", "n", 0)).toEqual({ value: { ok: true }, updatedAt: "2026-01-01T00:00:00.000Z" })
  })
})

class MapStore implements SnapshotStore {
  private readonly entries = new Map<string, { value: JsonValue; updatedAt: string }>()
  public read(workflowId: string, nodeId: string, ruleIndex: number) {
    return this.entries.get(`${workflowId}/${nodeId}/${ruleIndex}`)
  }
  public write(workflowId: string, nodeId: string, ruleIndex: number, value: JsonValue, updatedAt: string): void {
    this.entries.set(`${workflowId}/${nodeId}/${ruleIndex}`, { value, updatedAt })
  }
}
