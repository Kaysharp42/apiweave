import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  webhooksForWorkflowUrl,
  webhooksForProjectUrl,
  webhooksCreateUrl,
  webhookDetailUrl,
  webhookRegenerateUrl,
  webhookLogsUrl,
} from "../utils/scopedApi";
import API_BASE_URL from "../utils/api";

describe("Task 12: Webhook, MCP, and script legacy caller migration", () => {
  describe("scopedApi webhook URL builders", () => {
    it("webhooksForWorkflowUrl builds correct URL", () => {
      expect(webhooksForWorkflowUrl("wf-1")).toBe(
        `${API_BASE_URL}/api/webhooks/workflows/wf-1`,
      );
    });

    it("webhooksForProjectUrl builds correct URL", () => {
      expect(webhooksForProjectUrl("col-1")).toBe(
        `${API_BASE_URL}/api/webhooks/collections/col-1`,
      );
    });

    it("webhooksCreateUrl builds correct URL", () => {
      expect(webhooksCreateUrl()).toBe(`${API_BASE_URL}/api/webhooks`);
    });

    it("webhookDetailUrl builds correct URL", () => {
      expect(webhookDetailUrl("wh-1")).toBe(
        `${API_BASE_URL}/api/webhooks/wh-1`,
      );
    });

    it("webhookRegenerateUrl builds correct URL", () => {
      expect(webhookRegenerateUrl("wh-1")).toBe(
        `${API_BASE_URL}/api/webhooks/wh-1/regenerate-token`,
      );
    });

    it("webhookLogsUrl builds correct URL with default limit", () => {
      expect(webhookLogsUrl("wh-1")).toBe(
        `${API_BASE_URL}/api/webhooks/wh-1/logs?limit=50`,
      );
    });

    it("webhookLogsUrl builds correct URL with custom limit", () => {
      expect(webhookLogsUrl("wh-1", 100)).toBe(
        `${API_BASE_URL}/api/webhooks/wh-1/logs?limit=100`,
      );
    });

    it("webhook URL builders encode special characters in IDs", () => {
      expect(webhookDetailUrl("wh with spaces")).toBe(
        `${API_BASE_URL}/api/webhooks/wh%20with%20spaces`,
      );
    });
  });

  describe("source files no longer use legacy URLs", () => {
    const componentDir = resolve(__dirname, "..", "components");
    const hooksDir = resolve(__dirname, "..", "hooks");

    const filesToCheck = [
      resolve(componentDir, "WebhookManager.tsx"),
      resolve(hooksDir, "useWebhookRuns.ts"),
    ];

    for (const filePath of filesToCheck) {
      const fileName = filePath.split(/[/\\]/).pop();

      it(`${fileName} does not contain legacy /api/workflows URLs`, () => {
        const source = readFileSync(filePath, "utf-8");
        const legacyPattern = /\/api\/workflows(?!\/)/g;
        const legacyPattern2 = /\$\{[^}]*\}\/api\/workflows/g;
        const legacyPattern3 = /['"]\/api\/workflows[/'"?]/g;

        const matches = [
          ...source.matchAll(legacyPattern),
          ...source.matchAll(legacyPattern2),
          ...source.matchAll(legacyPattern3),
        ];

        const realLegacy = matches.filter((m) => {
          const start = Math.max(0, m.index! - 50);
          const context = source.slice(start, m.index! + m[0].length);
          return !context.includes("/workspaces/");
        });

        expect(realLegacy).toHaveLength(0);
      });

      it(`${fileName} does not contain legacy /api/collections URLs`, () => {
        const source = readFileSync(filePath, "utf-8");
        const legacyPattern = /\/api\/collections/g;
        const matches = [...source.matchAll(legacyPattern)];

        const realLegacy = matches.filter((m) => {
          const start = Math.max(0, m.index! - 50);
          const context = source.slice(start, m.index! + m[0].length);
          return !context.includes("/workspaces/");
        });

        expect(realLegacy).toHaveLength(0);
      });

      it(`${fileName} does not contain legacy /api/environments URLs`, () => {
        const source = readFileSync(filePath, "utf-8");
        const legacyPattern = /\/api\/environments/g;
        const matches = [...source.matchAll(legacyPattern)];

        const realLegacy = matches.filter((m) => {
          const start = Math.max(0, m.index! - 50);
          const context = source.slice(start, m.index! + m[0].length);
          return !context.includes("/workspaces/");
        });

        expect(realLegacy).toHaveLength(0);
      });
    }

    it("WebhookManager.tsx does not contain inline /api/webhooks URLs", () => {
      const source = readFileSync(
        resolve(componentDir, "WebhookManager.tsx"),
        "utf-8",
      );
      const inlinePattern = /`?\$\{[^}]*\}\/api\/webhooks/g;
      const matches = [...source.matchAll(inlinePattern)];
      expect(matches).toHaveLength(0);
    });

    it("WebhookManager.tsx imports from scopedApi", () => {
      const source = readFileSync(
        resolve(componentDir, "WebhookManager.tsx"),
        "utf-8",
      );
      expect(source).toContain("scopedApi");
    });

    it("WebhookManager.tsx uses useScopeContext", () => {
      const source = readFileSync(
        resolve(componentDir, "WebhookManager.tsx"),
        "utf-8",
      );
      expect(source).toContain("useScopeContext");
    });

    it("useWebhookRuns.ts imports from scopedApi", () => {
      const source = readFileSync(
        resolve(hooksDir, "useWebhookRuns.ts"),
        "utf-8",
      );
      expect(source).toContain("scopedApi");
    });

    it("useWebhookRuns.ts does not contain inline /api/webhooks URLs", () => {
      const source = readFileSync(
        resolve(hooksDir, "useWebhookRuns.ts"),
        "utf-8",
      );
      const inlinePattern = /`?\$\{[^}]*\}\/api\/webhooks/g;
      const matches = [...source.matchAll(inlinePattern)];
      expect(matches).toHaveLength(0);
    });
  });
});
