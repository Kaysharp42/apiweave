/**
 * Task 10 — Secret write-only and no-runtime-prompt security tests.
 *
 * Verifies:
 * (a) Secret value updates use the scoped write-only route.
 * (b) Workflow run does NOT prompt for runtime secrets.
 * (c) No plaintext or ciphertext fields appear in UI from backend responses.
 * (d) No sessionStorage usage for runtime secrets.
 * (e) No `secrets` or `runtime_secrets` keys in run request bodies.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_DIR = path.resolve(__dirname, "..");

// ─── (a) Scoped write-only route ─────────────────────────────────────────────

describe("Task 10: Secret write-only route", () => {
  it("useSecretValues.ts uses scoped POST route (not legacy /api/environments)", () => {
    const hookPath = path.join(SRC_DIR, "hooks", "useSecretValues.ts");
    const content = fs.readFileSync(hookPath, "utf-8");

    // Must use scoped route
    expect(content).toContain("/api/scopes/");
    // Must NOT use legacy environment route
    expect(content).not.toContain("/api/environments/");
    // Must use the scoped public-key route (via publicKeyUrl helper or directly)
    expect(content).toMatch(/publicKeyUrl|\/api\/secrets\/public-key/);
  });

  it("postScopedEncryptedSecret sends only ciphertext, never plaintext", () => {
    const hookPath = path.join(SRC_DIR, "hooks", "useSecretValues.ts");
    const content = fs.readFileSync(hookPath, "utf-8");

    // Body must contain ciphertext field
    expect(content).toContain("ciphertext");
    // Body must NOT contain encrypted_value field (old API)
    expect(content).not.toMatch(/\bencrypted_value\b/);
    // The JSON.stringify body must not include a 'value' or 'plaintext' key
    // (comments mentioning 'plaintext' are OK — only the body matters)
    const bodyMatch = content.match(/JSON\.stringify\(\{[^}]+\}/);
    if (bodyMatch) {
      expect(bodyMatch[0]).not.toMatch(/\bplaintext\b/);
      expect(bodyMatch[0]).not.toMatch(/\bvalue:/);
    }
  });

  it("SecretForm.tsx uses scoped public-key route", () => {
    const formPath = path.join(SRC_DIR, "components", "SecretForm.tsx");
    const content = fs.readFileSync(formPath, "utf-8");

    expect(content).toContain("/api/secrets/public-key?scope=");
    expect(content).toContain("/api/scopes/");
    expect(content).not.toContain("/api/environments/");
  });
});

// ─── (b) No runtime secret prompt ────────────────────────────────────────────

describe("Task 10: No runtime secret prompt", () => {
  it("SecretsPrompt.tsx does not exist", () => {
    const promptPath = path.join(SRC_DIR, "components", "SecretsPrompt.tsx");
    expect(fs.existsSync(promptPath)).toBe(false);
  });

  it("SecretsPromptProps.ts does not exist", () => {
    const propsPath = path.join(SRC_DIR, "types", "SecretsPromptProps.ts");
    expect(fs.existsSync(propsPath)).toBe(false);
  });

  it("useWorkflowPolling.ts has no showSecretsPrompt or handleSecretsProvided", () => {
    const pollingPath = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingPath, "utf-8");

    expect(content).not.toContain("showSecretsPrompt");
    expect(content).not.toContain("handleSecretsProvided");
    expect(content).not.toContain("pendingRunRef");
    expect(content).not.toContain("ensureSecretsThenRun");
    expect(content).not.toContain("executeRunWithSecrets");
  });

  it("WorkflowCanvas.tsx does not import or render SecretsPrompt", () => {
    const canvasPath = path.join(SRC_DIR, "components", "WorkflowCanvas.tsx");
    const content = fs.readFileSync(canvasPath, "utf-8");

    expect(content).not.toContain("SecretsPrompt");
    expect(content).not.toContain("showSecretsPrompt");
    expect(content).not.toContain("handleSecretsProvided");
  });

  it("MainLayout.tsx does not import or render SecretsPrompt", () => {
    const layoutPath = path.join(
      SRC_DIR,
      "components",
      "layout",
      "MainLayout.tsx",
    );
    const content = fs.readFileSync(layoutPath, "utf-8");

    expect(content).not.toContain("SecretsPrompt");
    expect(content).not.toContain("environmentWithSecrets");
    expect(content).not.toContain("dismissedEnvironmentId");
  });
});

// ─── (c) No plaintext/ciphertext in UI responses ─────────────────────────────

describe("Task 10: No plaintext/ciphertext in UI", () => {
  it("SecretsPanel.tsx does not render ciphertext or plaintext fields", () => {
    const panelPath = path.join(SRC_DIR, "components", "SecretsPanel.tsx");
    const content = fs.readFileSync(panelPath, "utf-8");

    // Should not contain references to ciphertext or value display
    expect(content).not.toMatch(/\bciphertext\b/);
    expect(content).not.toMatch(/\bencrypted_value\b/);
    // Should show metadata only (key names, encrypted status indicator)
    expect(content).toContain("Value is encrypted");
  });

  it("SecretValueEditor clears plaintext from state immediately", () => {
    const editorPath = path.join(
      SRC_DIR,
      "components",
      "SecretValueEditor.tsx",
    );
    const content = fs.readFileSync(editorPath, "utf-8");

    // Must clear value after encryption
    expect(content).toMatch(/setValue\(["']["']\)/);
    // Must use password input type
    expect(content).toContain('type="password"');
  });

  it("types/index.ts does not export SecretsPromptProps", () => {
    const indexPath = path.join(SRC_DIR, "types", "index.ts");
    const content = fs.readFileSync(indexPath, "utf-8");

    expect(content).not.toContain("SecretsPromptProps");
  });
});

// ─── (d) No sessionStorage for runtime secrets ───────────────────────────────

describe("Task 10: No sessionStorage for secrets", () => {
  it("useWorkflowPolling.ts does not use sessionStorage for secrets", () => {
    const pollingPath = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingPath, "utf-8");

    expect(content).not.toContain("sessionStorage");
    expect(content).not.toContain("secret_");
    expect(content).not.toContain("runtimeSecrets");
  });

  it("no production file uses sessionStorage for secret_ keys", () => {
    const productionDirs = [
      "hooks",
      "components",
      "utils",
      "contexts",
      "stores",
      "pages",
    ];
    const violations: string[] = [];

    for (const dir of productionDirs) {
      const fullDir = path.join(SRC_DIR, dir);
      if (!fs.existsSync(fullDir)) continue;
      walkAndCheck(fullDir, violations);
    }

    expect(
      violations,
      `Found sessionStorage secret_ usage in: ${violations.join(", ")}`,
    ).toHaveLength(0);
  });
});

// ─── (e) No secrets/runtime_secrets in run request bodies ────────────────────

describe("Task 10: No secrets in run request body", () => {
  it("useWorkflowPolling.ts does not include secrets in run payload", () => {
    const pollingPath = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingPath, "utf-8");

    // Must not set payload.secrets or payload.runtime_secrets
    expect(content).not.toMatch(/payload\.secrets\b/);
    expect(content).not.toMatch(/payload\.runtime_secrets\b/);
    expect(content).not.toMatch(/runtimeSecrets/);
  });

  it("run payload only contains resume option (no secret fields)", () => {
    const pollingPath = path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts");
    const content = fs.readFileSync(pollingPath, "utf-8");

    // The payload construction should only have 'resume' as a possible key
    expect(content).toContain("payload.resume");
    // And should NOT have secrets-related keys
    expect(content).not.toMatch(/payload\.(secrets|runtime_secrets|secret)/);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function walkAndCheck(dir: string, violations: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name.startsWith(".") ||
      entry.name === "__tests__"
    ) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAndCheck(fullPath, violations);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      const content = fs.readFileSync(fullPath, "utf-8");
      if (content.includes("sessionStorage") && content.includes("secret_")) {
        violations.push(path.relative(SRC_DIR, fullPath));
      }
    }
  }
}
