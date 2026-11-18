import { describe, expect, it } from "vitest";
import { projectInWorkspace } from "./projectInWorkspace";
import type { Project } from "../types/Project";

const base: Project = {
  id: "c-1",
  collectionId: "c-1",
  name: "Checkout",
  workflowCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const inWs = { ...base, workspaceId: "ws-1" };
const inOtherWs = { ...base, workspaceId: "ws-2" };

describe("projectInWorkspace", () => {
  it("keeps a project that belongs to the workspace", () => {
    expect(projectInWorkspace(inWs, "ws-1")).toBe(true);
  });

  it("drops a project that provably belongs to another workspace", () => {
    expect(projectInWorkspace(inOtherWs, "ws-1")).toBe(false);
  });

  it("keeps a project whose workspaceId is unknown", () => {
    expect(projectInWorkspace(base, "ws-1")).toBe(true);
  });

  it("keeps every project while no workspace is resolved", () => {
    expect(projectInWorkspace(inWs, null)).toBe(false);
    // Unknown-workspace rows still render, so the list is never blank while
    // the route resolves.
    expect(projectInWorkspace(base, null)).toBe(true);
  });
});
