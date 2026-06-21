/**
 * Shared Playwright fixtures for APIWeave E2E tests.
 *
 * Provides mock authentication and API route handlers so tests can run
 * without a real backend or OAuth flow. Uses Playwright's `page.route()`
 * to intercept API calls and return seeded data.
 */
import { type Page, type Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

export const MOCK_USER = {
  userId: "usr-test-001",
  verified_email: "owner@example.com",
  display_name: "Test Owner",
  avatar_url: null,
  roles: ["admin"],
  permissions: [],
  is_setup_complete: true,
  created_at: "2026-01-01T00:00:00Z",
} as const;

export const MOCK_ORG = {
  orgId: "org-test-001",
  slug: "acme",
  name: "Acme Corp",
  description: "Test organization",
  avatarUrl: null,
  ownerUserId: MOCK_USER.userId,
  createdAt: "2026-01-15T00:00:00Z",
  updatedAt: "2026-01-15T00:00:00Z",
} as const;

export const MOCK_PERSONAL_WORKSPACE = {
  workspaceId: "ws-personal-001",
  slug: "personal",
  name: "Personal",
  description: "Personal workspace",
  isPersonal: true,
  orgId: null,
  ownerType: "user" as const,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as const;

export const MOCK_ORG_WORKSPACE = {
  workspaceId: "ws-org-001",
  slug: "main",
  name: "Main",
  description: "Primary workspace",
  isPersonal: false,
  orgId: MOCK_ORG.orgId,
  ownerType: "org" as const,
  createdAt: "2026-01-15T00:00:00Z",
  updatedAt: "2026-01-15T00:00:00Z",
} as const;

export const MOCK_PROJECT = {
  projectId: "proj-001",
  workspaceId: MOCK_ORG_WORKSPACE.workspaceId,
  name: "API Tests",
  description: "Core API test suite",
  color: "#3b82f6",
  createdAt: "2026-02-01T00:00:00Z",
  updatedAt: "2026-02-01T00:00:00Z",
} as const;

export const MOCK_WORKFLOW = {
  workflowId: "wf-001",
  name: "Health Check",
  description: "Basic health check workflow",
  nodes: [{ id: "start_1", type: "start" }],
  edges: [],
  variables: {},
  createdAt: "2026-02-01T00:00:00Z",
  updatedAt: "2026-02-01T00:00:00Z",
} as const;

export const MOCK_ENVIRONMENT = {
  environmentId: "env-001",
  name: "Development",
  description: "Dev environment",
  scopeType: "workspace" as const,
  scopeId: MOCK_ORG_WORKSPACE.workspaceId,
  variables: { BASE_URL: "http://localhost:8080" },
  isDefault: true,
  allowedWorkspaceIds: [],
  createdAt: "2026-02-01T00:00:00Z",
  updatedAt: "2026-02-01T00:00:00Z",
} as const;

export const MOCK_SECRET_METADATA = {
  secretId: "sec-001",
  name: "API_KEY",
  scopeType: "workspace" as const,
  scopeId: MOCK_ORG_WORKSPACE.workspaceId,
  createdAt: "2026-02-10T00:00:00Z",
  updatedAt: "2026-02-10T00:00:00Z",
} as const;

export const MOCK_SERVICE_TOKEN = {
  tokenId: "tok-001",
  name: "CI Token",
  scopeType: "workspace" as const,
  scopeId: MOCK_ORG_WORKSPACE.workspaceId,
  permissions: ["workflow:run", "workflow:read"],
  createdAt: "2026-02-10T00:00:00Z",
  expiresAt: "2027-02-10T00:00:00Z",
  lastUsedAt: null,
} as const;

export const MOCK_AUDIT_EVENT = {
  eventId: "evt-001",
  actor: MOCK_USER.userId,
  action: "secret.create",
  scope: "workspace",
  resourceType: "secret",
  resourceId: MOCK_SECRET_METADATA.secretId,
  context: {},
  timestamp: "2026-02-10T12:00:00Z",
} as const;

export const MOCK_INVITE = {
  inviteId: "inv-001",
  orgId: MOCK_ORG.orgId,
  email: "newmember@example.com",
  role: "member" as const,
  status: "pending" as const,
  createdAt: "2026-02-15T00:00:00Z",
  expiresAt: "2026-03-15T00:00:00Z",
} as const;

export const MOCK_MEMBER = {
  memberId: "mem-001",
  orgId: MOCK_ORG.orgId,
  userId: MOCK_USER.userId,
  role: "owner" as const,
  createdAt: "2026-01-15T00:00:00Z",
  updatedAt: "2026-01-15T00:00:00Z",
} as const;

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * Install mock API routes on a Playwright page.
 * Intercepts all /api/* calls and returns seeded data.
 */
export async function mockApiRoutes(page: Page): Promise<void> {
  // Auth: /api/auth/me — return authenticated user
  await page.route("**/api/auth/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_USER),
    }),
  );

  // Auth: /api/auth/providers
  await page.route("**/api/auth/providers", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "github", name: "GitHub", enabled: true }]),
    }),
  );

  // Auth: /api/auth/logout
  await page.route("**/api/auth/logout", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revoked: true }),
    }),
  );

  // CSRF token
  await page.route("**/api/csrf-token", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "mock-csrf-token" }),
    }),
  );

  // Orgs
  await page.route("**/api/orgs", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([MOCK_ORG]),
    }),
  );

  await page.route("**/api/orgs/by-slug/*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ orgId: MOCK_ORG.orgId }),
    }),
  );

  await page.route(`**/api/orgs/${MOCK_ORG.orgId}`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ORG),
    }),
  );

  await page.route(`**/api/orgs/${MOCK_ORG.slug}`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ORG),
    }),
  );

  await page.route(`**/api/orgs/${MOCK_ORG.orgId}/workspaces`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([MOCK_ORG_WORKSPACE]),
    }),
  );

  await page.route(
    `**/api/orgs/${MOCK_ORG.orgId}/environments`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
  );

  await page.route(`**/api/orgs/${MOCK_ORG.orgId}/members`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([MOCK_MEMBER]),
    }),
  );

  await page.route(`**/api/orgs/${MOCK_ORG.orgId}/invites`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([MOCK_INVITE]),
    }),
  );

  await page.route(`**/api/orgs/${MOCK_ORG.orgId}/invites`, (route: Route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(MOCK_INVITE),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([MOCK_INVITE]),
    });
  });

  // Workspaces
  await page.route("**/api/workspaces", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspaces: [MOCK_PERSONAL_WORKSPACE, MOCK_ORG_WORKSPACE],
        total: 2,
      }),
    }),
  );

  await page.route("**/api/workspaces/by-slug/*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspaceId: MOCK_ORG_WORKSPACE.workspaceId }),
    }),
  );

  await page.route(
    `**/api/workspaces/${MOCK_ORG_WORKSPACE.workspaceId}/environments`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([MOCK_ENVIRONMENT]),
      }),
  );

  await page.route(
    `**/api/workspaces/${MOCK_ORG_WORKSPACE.workspaceId}/environments/*/protection`,
    (route: Route) => {
      if (route.request().method() === "PUT") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            environmentId: MOCK_ENVIRONMENT.environmentId,
            requiredReviewers: [MOCK_USER.userId],
            allowSelfApproval: false,
            bypassPolicy: "org_owner",
            bypassAllowlist: [],
          }),
        });
      }
      if (route.request().method() === "DELETE") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "unprotected" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "unprotected" }),
      });
    },
  );

  await page.route(
    `**/api/workspaces/${MOCK_ORG_WORKSPACE.workspaceId}/pending-approvals`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
  );

  // User environments
  await page.route(
    `**/api/users/${MOCK_USER.userId}/environments`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
  );

  // Projects
  await page.route(
    `**/api/workspaces/${MOCK_ORG_WORKSPACE.workspaceId}/projects*`,
    (route: Route) => {
      const url = route.request().url();
      if (url.includes(MOCK_PROJECT.projectId)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_PROJECT),
        });
      }
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(MOCK_PROJECT),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: [MOCK_PROJECT], total: 1 }),
      });
    },
  );

  // Workflows
  await page.route(
    `**/api/workspaces/${MOCK_ORG_WORKSPACE.workspaceId}/workflows*`,
    (route: Route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(MOCK_WORKFLOW),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workflows: [MOCK_WORKFLOW], total: 1 }),
      });
    },
  );

  // Secrets
  await page.route(
    `**/api/workspaces/${MOCK_ORG_WORKSPACE.workspaceId}/secrets*`,
    (route: Route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(MOCK_SECRET_METADATA),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([MOCK_SECRET_METADATA]),
      });
    },
  );

  // Public key for secret encryption
  await page.route("**/api/keys/public", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        publicKey: "MCowBQYDK2VvAyEA" + "A".repeat(32),
      }),
    }),
  );

  // Service tokens
  await page.route(
    `**/api/workspaces/${MOCK_ORG_WORKSPACE.workspaceId}/tokens*`,
    (route: Route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            ...MOCK_SERVICE_TOKEN,
            token: "awt_one_time_secret_value_do_not_store",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([MOCK_SERVICE_TOKEN]),
      });
    },
  );

  // Audit
  await page.route("**/api/audit/events/export*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Content-Disposition": 'attachment; filename="audit-events.json"',
      },
      body: JSON.stringify({
        exported_at: new Date().toISOString(),
        total: 1,
        events: [MOCK_AUDIT_EVENT],
      }),
    }),
  );

  await page.route("**/api/audit/events*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events: [MOCK_AUDIT_EVENT],
        total: 1,
      }),
    }),
  );

  // Catch-all for any unmatched /api/ routes — return 200 with empty JSON
  await page.route("**/api/**", (route: Route) => {
    // Only handle if not already handled by a more specific route
    // Playwright matches the most recently registered route first
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

/**
 * Mock an unauthenticated state — /api/auth/me returns 401.
 */
export async function mockUnauthenticated(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route: Route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Not authenticated" }),
    }),
  );

  await page.route("**/api/auth/providers", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "github", name: "GitHub", enabled: true }]),
    }),
  );
}

/**
 * Navigate to a page and wait for the app to hydrate.
 * Waits for the auth check to resolve (either redirect or render).
 * Also dismisses the Vite error overlay if present (pre-existing TS errors).
 */
export async function navigateAndWait(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");

  await page.evaluate(() => {
    document.querySelector("vite-error-overlay")?.remove();
  });

  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

/**
 * Capture a screenshot to the evidence directory.
 */
export async function captureEvidence(
  page: Page,
  filename: string,
  options?: { fullPage?: boolean },
): Promise<void> {
  await page.screenshot({
    path: `.omo/evidence/${filename}`,
    fullPage: options?.fullPage ?? true,
  });
}
