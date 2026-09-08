import { describe, expect, it } from "vitest";
import { cloudAttentionSignature, getCloudAttention } from "./cloudAttention";
import type { CloudSyncStatus } from "../types/cloud";

const base: CloudSyncStatus = {
  linked: true,
  active: true,
  linkState: "linked",
  syncState: "idle",
  state: "idle",
  pendingCount: 0,
  deadLetterCount: 0,
  conflictCount: 0,
  workspaceIds: [],
  bindings: [],
  workspaceCatalog: [],
  teamCatalog: [],
  encryptionDecisionPending: [],
};

function binding(
  overrides: Partial<CloudSyncStatus["bindings"][number]> = {},
): CloudSyncStatus["bindings"][number] {
  return {
    workspaceId: "local-1",
    workspaceName: "qqqq",
    cloudWorkspaceId: "cloud-1",
    cloudWorkspaceName: "qqqq",
    syncMode: "bi-directional",
    initializationState: "initialized",
    pendingCount: 0,
    deadLetterCount: 0,
    conflictCount: 0,
    boundAt: "2026-09-06T00:00:00.000Z",
    encryption: "plaintext",
    ...overrides,
  };
}

describe("getCloudAttention", () => {
  it("stays silent when nothing needs the user", () => {
    expect(getCloudAttention(base)).toEqual([]);
    expect(getCloudAttention(null)).toEqual([]);
    expect(getCloudAttention(base, true)).toEqual([]);
    expect(
      getCloudAttention({ ...base, bindings: [binding({ encryption: "unlocked" })] }),
    ).toEqual([]);
  });

  it("treats a still-checking workspace as silence, not a problem", () => {
    expect(
      getCloudAttention({ ...base, bindings: [binding({ encryption: "unknown" })] }),
    ).toEqual([]);
  });

  it("names the locked workspace so the banner can offer its passphrase", () => {
    const items = getCloudAttention({
      ...base,
      bindings: [binding({ encryption: "locked" })],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("locked");
    expect(items[0]?.title).toContain("qqqq");
    expect(items[0]?.workspaces).toEqual([{ id: "local-1", name: "qqqq" }]);
  });

  it("reports every problem at once, worst first", () => {
    const items = getCloudAttention({
      ...base,
      syncState: "error",
      lastError: "boom",
      conflictCount: 2,
      bindings: [binding({ encryption: "locked" })],
      encryptionDecisionPending: [{ workspaceId: "local-2", workspaceName: "df" }],
    });
    expect(items.map((item) => item.kind)).toEqual([
      "locked",
      "conflicts",
      "encryptionChoice",
      "error",
    ]);
    expect(items[1]?.title).toBe("2 sync conflicts need your review");
  });

  it("drops everything else when the session itself expired", () => {
    const items = getCloudAttention({
      ...base,
      linkState: "authenticationRequired",
      conflictCount: 3,
    });
    expect(items.map((item) => item.kind)).toEqual(["authRequired"]);
  });

  it("changes signature when a new problem appears, so a dismissal can't hide it", () => {
    const locked = getCloudAttention({
      ...base,
      bindings: [binding({ encryption: "locked" })],
    });
    const lockedPlusConflict = getCloudAttention({
      ...base,
      conflictCount: 1,
      bindings: [binding({ encryption: "locked" })],
    });
    expect(cloudAttentionSignature(locked)).not.toBe(
      cloudAttentionSignature(lockedPlusConflict),
    );
  });
});
