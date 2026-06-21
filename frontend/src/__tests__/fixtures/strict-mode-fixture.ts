/**
 * Strict-mode fixture: simulates a production file with a legacy API URL.
 *
 * This file is used by no-legacy-urls.test.ts to verify the guard's
 * detection logic works correctly in strict mode. The guard must detect
 * the legacy URL pattern below and report file:line in its output.
 *
 * @note This file is in __tests__/fixtures/ so it is excluded from the
 *       main production scan. It is explicitly read by the fixture test case.
 * @see ../no-legacy-urls.test.ts
 *
 * TypeScript STRICT: No `any` types. This file must compile cleanly.
 */

// Legacy URL that must be detected by the guard:
export const legacyUrl = "http://localhost:8000/api/workflows/fake-id";
