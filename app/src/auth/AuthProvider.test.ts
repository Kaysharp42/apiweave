/**
 * Tests for AuthProvider auth logic.
 *
 * These tests verify the auth state machine behaviour using node:test + node:assert/strict.
 * React rendering is not required — we test the underlying logic and hook contracts.
 */

import { test } from "vitest";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

interface CapturedRequest {
  domain: string;
  action: string;
  payload: unknown;
}

type TestIpcBridge = NonNullable<Window["__APIWEAVE_IPC__"]>;
type TestGlobal = typeof globalThis & { __APIWEAVE_IPC__?: TestIpcBridge };

function mockFetch(
  statusCode = 200,
  body: unknown = {},
): { calls: CapturedRequest[]; restore: () => void } {
  const calls: CapturedRequest[] = [];
  const originalWindowIpc = window.__APIWEAVE_IPC__;
  const globalTarget = globalThis as TestGlobal;
  const originalGlobalIpc = globalTarget.__APIWEAVE_IPC__;

  const bridge: TestIpcBridge = {
    invoke: async (domain, action, payload) => {
      calls.push({ domain, action, payload });
      if (statusCode >= 200 && statusCode < 300)
        return { ok: true, data: body };
      return {
        ok: false,
        error: {
          code: "denied",
          message: `${statusCode} Not authenticated`,
          details: { status: statusCode },
        },
      };
    },
    onRunProgress: () => () => undefined,
  };
  window.__APIWEAVE_IPC__ = bridge;
  globalTarget.__APIWEAVE_IPC__ = bridge;

  return {
    calls,
    restore: () => {
      if (originalWindowIpc) window.__APIWEAVE_IPC__ = originalWindowIpc;
      else delete window.__APIWEAVE_IPC__;
      if (originalGlobalIpc) globalTarget.__APIWEAVE_IPC__ = originalGlobalIpc;
      else delete globalTarget.__APIWEAVE_IPC__;
    },
  };
}

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

const { authenticatedFetch, authenticatedJson } = await import(
  "../utils/apiweaveClient.ts"
);

// ---------------------------------------------------------------------------
// Unauthenticated redirect behaviour (logic layer)
// ---------------------------------------------------------------------------

test("unauthenticated: /api/auth/me 401 results in unauthenticated status", async () => {
  const { restore } = mockFetch(401, { detail: "Not authenticated" });
  try {
    let caughtError: Error | null = null;
    try {
      await authenticatedJson("/api/auth/me");
    } catch (err) {
      caughtError = err as Error;
    }
    assert.ok(caughtError !== null, "Should throw on 401");
    assert.ok(
      caughtError.message.includes("401"),
      `Expected 401 in error message, got: ${caughtError.message}`,
    );
  } finally {
    restore();
  }
});

test("unauthenticated: /api/auth/me goes through auth.me IPC", async () => {
  const { calls, restore } = mockFetch(401, { detail: "Not authenticated" });
  try {
    await authenticatedFetch("/api/auth/me");
    assert.deepEqual(calls[0], { domain: "auth", action: "me", payload: {} });
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Profile hydration
// ---------------------------------------------------------------------------

test("profile hydration: /api/auth/me 200 returns user profile", async () => {
  const mockUser = {
    userId: "user-123",
    verified_email: "test@example.com",
    display_name: "Test User",
    avatar_url: null,
    roles: ["user"],
    permissions: ["workflows:read", "workflows:write"],
    is_setup_complete: true,
    created_at: "2026-01-01T00:00:00Z",
  };
  const { restore } = mockFetch(200, mockUser);
  try {
    const user = (await authenticatedJson("/api/auth/me")) as typeof mockUser;
    assert.equal(user.userId, "user-123");
    assert.equal(user.verified_email, "test@example.com");
    assert.deepEqual(user.roles, ["user"]);
    assert.deepEqual(user.permissions, ["workflows:read", "workflows:write"]);
    assert.equal(user.is_setup_complete, true);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test("logout: POST /api/auth/logout goes through auth.logout IPC", async () => {
  const { calls, restore } = mockFetch(200, {});
  try {
    await authenticatedFetch("/api/auth/logout", { method: "POST" });
    assert.deepEqual(calls[0], {
      domain: "auth",
      action: "logout",
      payload: {},
    });
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// hasPermission logic
// ---------------------------------------------------------------------------

interface PermissionUser {
  roles: string[];
  permissions?: string[] | null | undefined;
}

function hasPermission(user: PermissionUser, permission: string): boolean {
  if (user.roles.includes("admin")) {
    return true;
  }

  return (
    Array.isArray(user.permissions) && user.permissions.includes(permission)
  );
}

test("hasPermission: returns true when permission is in user.permissions", () => {
  const user: PermissionUser = {
    roles: ["user"],
    permissions: ["workflows:read", "workflows:write"],
  };

  assert.equal(hasPermission(user, "workflows:read"), true);
  assert.equal(hasPermission(user, "workflows:write"), true);
  assert.equal(hasPermission(user, "superuser"), false);
});

test("hasPermission: returns false when permissions are missing", () => {
  const user: PermissionUser = { roles: ["user"], permissions: undefined };

  assert.equal(hasPermission(user, "workflows:read"), false);
});

test("hasPermission: admin role grants admin-only permissions", () => {
  const user: PermissionUser = { roles: ["admin"], permissions: undefined };

  assert.equal(hasPermission(user, "users:invite"), true);
  assert.equal(hasPermission(user, "admin"), true);
});

test("hasPermission: explicit permission grants access without admin role", () => {
  const user: PermissionUser = {
    roles: ["user"],
    permissions: ["users:invite"],
  };

  assert.equal(hasPermission(user, "users:invite"), true);
  assert.equal(hasPermission(user, "admin"), false);
});
