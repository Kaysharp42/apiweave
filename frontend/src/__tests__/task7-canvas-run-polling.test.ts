/**
 * Task 7 — Canvas, run, history, and polling migration tests.
 *
 * Verifies:
 * (a) Run uses scoped route
 * (b) Run body has no `secrets` key
 * (c) Auto-save uses scoped PATCH
 * (d) No sessionStorage usage for secrets in polling hook
 * (e) All production files use scoped URL builders
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import API_BASE_URL from "../utils/apiweaveClient";
import {
  workflowRunUrl,
  workflowRunsListUrl,
  workflowLatestFailedUrl,
  workflowRunStatusUrl,
  workflowNodeResultUrl,
  workflowDetailUrl,
} from "../utils/apiweaveClient";

const SRC_DIR = path.resolve(__dirname, "..");

// ─── (a) Run uses scoped route ──────────────────────────────────────────────

describe("Task 7a: Run uses scoped route", () => {
  it("workflowRunUrl builds workspace-scoped run URL without environment", () => {
    const url = workflowRunUrl("ws-1", "wf-1");
    expect(url).toBe(`${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-1/run`);
  });

  it("workflowRunUrl includes environmentId query param when provided", () => {
    const url = workflowRunUrl("ws-1", "wf-1", "env-1");
    expect(url).toBe(
      `${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-1/run?environmentId=env-1`,
    );
  });

  it("workflowRunUrl encodes special characters", () => {
    const url = workflowRunUrl("ws#1", "wf&2", "env+3");
    expect(url).toContain("/api/workspaces/ws%231/workflows/wf%262/run");
    expect(url).toContain("environmentId=env%2B3");
  });

  it("useWorkflowPolling.ts does NOT contain legacy /api/workflows URLs", () => {
    const pollingFile = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingFile, "utf-8");
    expect(content).not.toContain("/api/workflows/");
    expect(content).not.toContain("API_BASE_URL");
  });

  it("WorkflowCanvas.tsx does NOT contain legacy /api/workflows URLs", () => {
    const canvasFile = path.join(SRC_DIR, "components", "WorkflowCanvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");
    const lines = content.split("\n");
    const legacyLines = lines.filter(
      (line) =>
        line.includes("/api/workflows/") &&
        !line.includes("// @legacy-allowed:"),
    );
    expect(legacyLines).toHaveLength(0);
  });

  it("HistoryModal.tsx uses scoped workflowRunsListUrl", () => {
    const historyFile = path.join(SRC_DIR, "components", "HistoryModal.tsx");
    const content = fs.readFileSync(historyFile, "utf-8");
    expect(content).toContain("workflowRunsListUrl");
    expect(content).not.toContain("/api/workflows/");
  });
});

// ─── (b) Run body has no secrets key ────────────────────────────────────────

describe("Task 7b: Run body has no secrets", () => {
  it("useWorkflowPolling.ts does NOT reference sessionStorage for secrets", () => {
    const pollingFile = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingFile, "utf-8");
    expect(content).not.toContain("sessionStorage");
    expect(content).not.toContain("runtimeSecrets");
    expect(content).not.toContain("payload.secrets");
  });

  it('useWorkflowPolling.ts does NOT contain "secrets" in run payload construction', () => {
    const pollingFile = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingFile, "utf-8");
    const lines = content.split("\n");

    const secretPayloadLines = lines.filter(
      (line) =>
        (line.includes("payload.secrets") ||
          line.includes('payload["secrets"]') ||
          line.includes("payload['secrets']")) &&
        !line.trim().startsWith("//"),
    );
    expect(secretPayloadLines).toHaveLength(0);
  });

  it("useWorkflowPolling.ts does NOT import API_BASE_URL", () => {
    const pollingFile = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingFile, "utf-8");
    expect(content).not.toMatch(/import\s+API_BASE_URL/);
  });

  it("run payload only contains resume field (no secrets)", () => {
    const pollingFile = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingFile, "utf-8");

    // Verify the payload construction pattern
    expect(content).toContain("const payload: Record<string, unknown> = {};");
    expect(content).toContain("payload.resume = runOptions.resume;");

    // Ensure no secrets assignment
    expect(content).not.toMatch(/payload\.secrets\s*=/);
    expect(content).not.toMatch(/payload\.runtime_secrets\s*=/);
  });
});

// ─── (c) Auto-save uses scoped PATCH ────────────────────────────────────────

describe("Task 7c: Auto-save uses scoped PATCH", () => {
  it("workflowDetailUrl builds correct scoped URL", () => {
    const url = workflowDetailUrl("ws-1", "wf-1");
    expect(url).toBe(`${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-1`);
  });

  it("WorkflowCanvas.tsx saveWorkflow uses PATCH method", () => {
    const canvasFile = path.join(SRC_DIR, "components", "WorkflowCanvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");

    // Find the saveWorkflow function and verify it uses PATCH
    const saveWorkflowMatch = content.match(
      /const saveWorkflow = useCallback\(\s*async[\s\S]*?method:\s*["'](\w+)["']/,
    );
    expect(saveWorkflowMatch).not.toBeNull();
    expect(saveWorkflowMatch?.[1]).toBe("PATCH");
  });

  it("WorkflowCanvas.tsx saveWorkflow uses workflowDetailUrl", () => {
    const canvasFile = path.join(SRC_DIR, "components", "WorkflowCanvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");
    expect(content).toContain("workflowDetailUrl");
  });

  it("WorkflowCanvas.tsx handleJsonApply uses PATCH method", () => {
    const canvasFile = path.join(SRC_DIR, "components", "WorkflowCanvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");

    // Find all PATCH occurrences — should be at least 2 (save + JSON apply)
    const patchCount = (content.match(/method:\s*["']PATCH["']/g) || []).length;
    expect(patchCount).toBeGreaterThanOrEqual(2);
  });

  it("WorkflowCanvas.tsx reloadWorkflowFromServer uses workflowDetailUrl", () => {
    const canvasFile = path.join(SRC_DIR, "components", "WorkflowCanvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");

    // Verify the reload function uses scoped URL
    const reloadSection = content.match(
      /const reloadWorkflowFromServer[\s\S]*?authenticatedFetch\(([^)]+)\)/,
    );
    expect(reloadSection).not.toBeNull();
    expect(reloadSection?.[1]).toContain("workflowDetailUrl");
  });
});

// ─── (d) Polling URLs are scoped ────────────────────────────────────────────

describe("Task 7d: Polling and history URLs are scoped", () => {
  it("workflowLatestFailedUrl builds correct scoped URL", () => {
    const url = workflowLatestFailedUrl("ws-1", "wf-1");
    expect(url).toBe(
      `${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-1/runs/latest-failed`,
    );
  });

  it("workflowRunStatusUrl builds correct scoped URL", () => {
    const url = workflowRunStatusUrl("ws-1", "wf-1", "run-42");
    expect(url).toBe(
      `${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-1/runs/run-42`,
    );
  });

  it("workflowRunsListUrl builds correct scoped URL with pagination", () => {
    const url = workflowRunsListUrl("ws-1", "wf-1", 2, 10);
    expect(url).toBe(
      `${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-1/runs?page=2&limit=10`,
    );
  });

  it("workflowNodeResultUrl builds correct scoped URL", () => {
    const url = workflowNodeResultUrl("ws-1", "wf-1", "run-42", "node-7");
    expect(url).toBe(
      `${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-1/runs/run-42/nodes/node-7/result`,
    );
  });

  it("useWorkflowPolling.ts uses scoped URL builders", () => {
    const pollingFile = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingFile, "utf-8");
    expect(content).toContain("workflowRunUrl");
    expect(content).toContain("workflowRunStatusUrl");
    expect(content).toContain("workflowLatestFailedUrl");
  });
});

// ─── (e) useScopeContext integration ────────────────────────────────────────

describe("Task 7e: Canvas uses useScopeContext for workspace ID", () => {
  it("WorkflowCanvas.tsx imports and uses useScopeContext", () => {
    const canvasFile = path.join(SRC_DIR, "components", "WorkflowCanvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");
    expect(content).toContain("useScopeContext");
    expect(content).toContain("scope.workspaceId");
  });

  it("WorkflowCanvas.tsx passes workspaceId to useWorkflowPolling", () => {
    const canvasFile = path.join(SRC_DIR, "components", "WorkflowCanvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");
    expect(content).toContain("workspaceId: scope.workspaceId");
  });

  it("WorkflowCanvas.tsx passes workspaceId to HistoryModal", () => {
    const canvasFile = path.join(SRC_DIR, "components", "WorkflowCanvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");
    expect(content).toContain("workspaceId={scope.workspaceId");
  });
});
