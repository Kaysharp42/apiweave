import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnabledProviders } from '../../auth/providerConfig.tsx';
import type { ProviderInfo } from '../../types/ProviderInfo.ts';

const PAGES_DIR = join('src', 'pages');
const PROVIDERS_ENDPOINT = 'http://localhost:8000/api/auth/providers';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

interface ProviderVisibilityState {
  providers: string[];
  providerError: string | null;
  providersLoading: boolean;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function assertIncludes(markup: string, expected: string): void {
  assert.ok(markup.includes(expected), `Expected content to include ${expected}: ${markup}`);
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
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

function readPage(fileName: string): string {
  return readFileSync(join(PAGES_DIR, fileName), 'utf-8');
}

function startProviderVisibilityFlow(): { state: ProviderVisibilityState; run: Promise<void> } {
  const state: ProviderVisibilityState = {
    providers: [],
    providerError: null,
    providersLoading: true,
  };

  const run = (async () => {
    try {
      const response = await fetch(PROVIDERS_ENDPOINT);

      if (!response.ok) {
        throw new Error('Failed to load providers');
      }

      const data = (await response.json()) as ProviderInfo[];
      state.providers = getEnabledProviders(data).map((provider) => provider.id);
    } catch {
      state.providerError = 'Unable to load sign-in options';
    } finally {
      state.providersLoading = false;
    }
  })();

  return { state, run };
}

function assertProviderPageSource(fileName: string, emptyMessage: string): void {
  const content = readPage(fileName);

  assertIncludes(content, "authenticatedFetch(`${API_BASE_URL}/api/auth/providers`)");
  assertIncludes(content, 'getEnabledProviders');
  assertIncludes(content, 'Unable to load sign-in options');
  assertIncludes(content, emptyMessage);
  assertIncludes(content, 'Spinner');
}

function assertOAuthHookPageSource(fileName: string, emptyMessage: string): void {
  const content = readPage(fileName);

  assertIncludes(content, 'useOAuthProviders');
  assertIncludes(content, 'Sign-in options unavailable');
  assertIncludes(content, emptyMessage);
  assertIncludes(content, 'Spinner');
}

test('LoginPage renders only enabled providers and hides disabled ones', async () => {
  const { calls, restore } = mockFetch(async () => {
    const providers: ProviderInfo[] = [
      { id: 'github', enabled: true, label: 'GitHub' },
      { id: 'gitlab', enabled: false, label: 'GitLab' },
      { id: 'google', enabled: true, label: 'Google' },
    ];

    return new Response(JSON.stringify(providers), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const { state, run } = startProviderVisibilityFlow();
    await run;

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, PROVIDERS_ENDPOINT);
    assert.deepEqual(state.providers, ['github', 'google']);
    assert.equal(state.providerError, null);
    assert.equal(state.providersLoading, false);
  } finally {
    restore();
  }
});

test('LoginPage shows inline error state when provider fetch fails', async () => {
  const { restore } = mockFetch(async () => {
    throw new Error('network down');
  });

  try {
    const { state, run } = startProviderVisibilityFlow();
    await run;

    assert.deepEqual(state.providers, []);
    assert.equal(state.providerError, 'Unable to load sign-in options');
    assert.equal(state.providersLoading, false);
  } finally {
    restore();
  }
});

test('LoginPage shows empty state when all providers are disabled', async () => {
  const { restore } = mockFetch(async () => {
    const providers: ProviderInfo[] = [
      { id: 'github', enabled: false, label: 'GitHub' },
      { id: 'gitlab', enabled: false, label: 'GitLab' },
    ];

    return new Response(JSON.stringify(providers), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const { state, run } = startProviderVisibilityFlow();
    await run;

    assert.deepEqual(state.providers, []);
    assert.equal(state.providerError, null);
    assert.equal(state.providersLoading, false);
  } finally {
    restore();
  }
});

test('LoginPage shows loading state while provider request is pending', async () => {
  const deferred = createDeferred<Response>();
  const { restore } = mockFetch(async () => deferred.promise);

  try {
    const { state, run } = startProviderVisibilityFlow();

    assert.equal(state.providersLoading, true);
    assert.equal(state.providerError, null);

    deferred.resolve(
      new Response(JSON.stringify([{ id: 'github', enabled: true, label: 'GitHub' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await run;

    assert.equal(state.providersLoading, false);
    assert.deepEqual(state.providers, ['github']);
  } finally {
    restore();
  }
});

test('LoginPage source keeps provider visibility UI and loading/error states', () => {
  assertOAuthHookPageSource('LoginPage.tsx', 'No sign-in providers configured');
});

test('SetupPage source keeps provider visibility UI and loading/error states', () => {
  assertProviderPageSource(
    'SetupPage.tsx',
    'No sign-in providers configured',
  );
});

test('InvitePage source keeps provider visibility UI and loading/error states', () => {
  assertProviderPageSource(
    'InvitePage.tsx',
    'No sign-in providers configured',
  );
});
