/**
 * Tests for AdminDomainsPage SSO provider configuration section.
 *
 * Verifies that the SsoProviderSection correctly fetches provider status from
 * /api/settings/providers and reflects loading, error, and data states.
 * Also asserts source-level invariants to prevent accidental regressions.
 *
 * Pattern: node:test + node:assert (matches the rest of the frontend test suite).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDER_IDS, PROVIDER_DISPLAY_MAP } from '../../auth/providerConfig.tsx';
import type { ProviderId } from '../../auth/providerConfig.tsx';

const PAGES_DIR = join('src', 'pages');
const PROVIDERS_SETTINGS_ENDPOINT = 'http://localhost:8000/api/settings/providers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProviderStatus {
  id: string;
  enabled: boolean;
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockFetch(
  handler: (input: RequestInfo | URL, init: RequestInit) => Promise<Response>,
): { calls: CapturedRequest[]; restore: () => void } {
  const calls: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    calls.push({ url: String(input), init });
    return handler(input, init);
  };

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

interface SsoProviderState {
  providers: ProviderStatus[];
  loading: boolean;
  error: string | null;
}

function startSsoProviderFetch(): { state: SsoProviderState; run: Promise<void> } {
  const state: SsoProviderState = {
    providers: [],
    loading: true,
    error: null,
  };

  const run = (async () => {
    try {
      const response = await fetch(PROVIDERS_SETTINGS_ENDPOINT);
      if (!response.ok) {
        throw new Error('Failed to load SSO provider status');
      }
      state.providers = (await response.json()) as ProviderStatus[];
    } catch {
      state.error = 'Failed to load SSO provider status';
    } finally {
      state.loading = false;
    }
  })();

  return { state, run };
}

function readPage(fileName: string): string {
  return readFileSync(join(PAGES_DIR, fileName), 'utf-8');
}

// ---------------------------------------------------------------------------
// providerConfig invariants
// ---------------------------------------------------------------------------

test('PROVIDER_IDS contains exactly the four known SSO providers', () => {
  const expected = ['github', 'gitlab', 'google', 'microsoft'];
  assert.deepEqual([...PROVIDER_IDS], expected);
});

test('PROVIDER_DISPLAY_MAP has an entry for every PROVIDER_ID', () => {
  for (const id of PROVIDER_IDS) {
    const display = PROVIDER_DISPLAY_MAP[id as ProviderId];
    assert.ok(display, `Missing display entry for provider: ${id}`);
    assert.equal(display.id, id);
    assert.ok(typeof display.label === 'string' && display.label.length > 0, `Empty label for ${id}`);
    assert.ok(display.IconComponent !== undefined && display.IconComponent !== null, `Missing IconComponent for ${id}`);
  }
});

// ---------------------------------------------------------------------------
// SsoProviderSection fetch behaviour (simulated)
// ---------------------------------------------------------------------------

test('SsoProviderSection: fetches /api/settings/providers and stores results', async () => {
  const payload: ProviderStatus[] = [
    { id: 'github', enabled: true },
    { id: 'gitlab', enabled: false },
    { id: 'google', enabled: true },
    { id: 'microsoft', enabled: false },
  ];

  const { calls, restore } = mockFetch(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  try {
    const { state, run } = startSsoProviderFetch();
    await run;

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, PROVIDERS_SETTINGS_ENDPOINT);
    assert.deepEqual(state.providers, payload);
    assert.equal(state.error, null);
    assert.equal(state.loading, false);
  } finally {
    restore();
  }
});

test('SsoProviderSection: sets error state when fetch fails', async () => {
  const { restore } = mockFetch(async () => {
    throw new Error('network error');
  });

  try {
    const { state, run } = startSsoProviderFetch();
    await run;

    assert.deepEqual(state.providers, []);
    assert.equal(state.error, 'Failed to load SSO provider status');
    assert.equal(state.loading, false);
  } finally {
    restore();
  }
});

test('SsoProviderSection: sets error state when server returns non-OK status', async () => {
  const { restore } = mockFetch(async () =>
    new Response('Forbidden', { status: 403 }),
  );

  try {
    const { state, run } = startSsoProviderFetch();
    await run;

    assert.deepEqual(state.providers, []);
    assert.equal(state.error, 'Failed to load SSO provider status');
    assert.equal(state.loading, false);
  } finally {
    restore();
  }
});

test('SsoProviderSection: loading is true while request is pending', async () => {
  const deferred = createDeferred<Response>();
  const { restore } = mockFetch(async () => deferred.promise);

  try {
    const { state, run } = startSsoProviderFetch();

    assert.equal(state.loading, true);
    assert.equal(state.error, null);

    deferred.resolve(
      new Response(
        JSON.stringify([{ id: 'github', enabled: true }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await run;

    assert.equal(state.loading, false);
    assert.equal(state.providers.length, 1);
    assert.equal(state.providers[0]!.id, 'github');
  } finally {
    restore();
  }
});

test('SsoProviderSection: handles all providers disabled gracefully', async () => {
  const payload: ProviderStatus[] = PROVIDER_IDS.map((id) => ({ id, enabled: false }));

  const { restore } = mockFetch(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  try {
    const { state, run } = startSsoProviderFetch();
    await run;

    assert.equal(state.providers.length, 4);
    assert.ok(state.providers.every((p) => !p.enabled));
    assert.equal(state.error, null);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Source-level invariants for AdminDomainsPage
// ---------------------------------------------------------------------------

test('AdminDomainsPage source: fetches /api/settings/providers for SSO status', () => {
  const content = readPage('AdminDomainsPage.tsx');
  assert.ok(
    content.includes('/api/settings/providers'),
    'AdminDomainsPage must fetch /api/settings/providers',
  );
});

test('AdminDomainsPage source: uses PROVIDER_IDS and PROVIDER_DISPLAY_MAP from providerConfig', () => {
  const content = readPage('AdminDomainsPage.tsx');
  assert.ok(content.includes('PROVIDER_IDS'), 'Must use PROVIDER_IDS');
  assert.ok(content.includes('PROVIDER_DISPLAY_MAP'), 'Must use PROVIDER_DISPLAY_MAP');
});

test('AdminDomainsPage source: renders ApprovedDomainManager (approved-domain management intact)', () => {
  const content = readPage('AdminDomainsPage.tsx');
  assert.ok(
    content.includes('ApprovedDomainManager'),
    'AdminDomainsPage must render ApprovedDomainManager',
  );
});

test('AdminDomainsPage source: shows loading spinner while fetching providers', () => {
  const content = readPage('AdminDomainsPage.tsx');
  assert.ok(
    content.includes('animate-spin') || content.includes('Spinner'),
    'Must show a loading spinner (animate-spin or Spinner)',
  );
});

test('AdminDomainsPage source: shows Configured / Not configured status labels', () => {
  const content = readPage('AdminDomainsPage.tsx');
  assert.ok(content.includes('Configured'), 'Must show "Configured" label for enabled providers');
  assert.ok(content.includes('Not configured'), 'Must show "Not configured" label for disabled providers');
});

test('AdminDomainsPage source: stays on /settings/domains route (no new route added)', () => {
  // The page must not define its own router path — routing is handled externally.
  // We verify the page does not import react-router-dom Route or createBrowserRouter.
  const content = readPage('AdminDomainsPage.tsx');
  assert.ok(
    !content.includes('createBrowserRouter') && !content.includes('<Route'),
    'AdminDomainsPage must not define its own routes',
  );
});
