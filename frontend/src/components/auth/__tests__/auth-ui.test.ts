import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AUTH_DIR = join('src', 'components', 'auth');
const PAGES_DIR = join('src', 'pages');

test('AuthInteractiveHero contains reduced-motion fallback', () => {
  const content = readFileSync(join(AUTH_DIR, 'AuthInteractiveHero.tsx'), 'utf-8');
  assert.ok(
    content.includes('data-testid="auth-hero-static"'),
    'Missing static fallback test id'
  );
  assert.ok(
    content.includes('data-testid="auth-hero-animated"'),
    'Missing animated test id'
  );
  assert.ok(
    content.includes('motion-reduce:flex') || content.includes('motion-reduce:block'),
    'Missing motion-reduce class for static fallback'
  );
  assert.ok(
    content.includes('motion-reduce:hidden'),
    'Missing motion-reduce:hidden class for animated version'
  );
});

test('SplitAuthLayout handles mobile layout', () => {
  const content = readFileSync(join(AUTH_DIR, 'SplitAuthLayout.tsx'), 'utf-8');
  assert.ok(
    content.includes('hidden md:flex'),
    'Hero section should be hidden on mobile and flex on md screens'
  );
});

test('LoginPage fetches configured-only providers and preserves inline states', () => {
  const content = readFileSync(join(PAGES_DIR, 'LoginPage.tsx'), 'utf-8');
  assert.ok(content.includes('authenticatedFetch(`${API_BASE_URL}/api/auth/providers`)'), 'Should fetch provider availability');
  assert.ok(content.includes('getEnabledProviders(data)'), 'Should filter enabled providers only');
  assert.ok(content.includes('Unable to load sign-in options'), 'Should show provider load error state');
  assert.ok(content.includes('No sign-in providers are configured.'), 'Should show empty provider state');
  assert.ok(content.includes('error = searchParams.get(\'error\')'), 'Should extract error from search params');
});

test('InvitePage reads token and shows providers', () => {
  const content = readFileSync(join(PAGES_DIR, 'InvitePage.tsx'), 'utf-8');
  assert.ok(content.includes('useParams<{ token: string }>()'), 'Should extract token from params');
  assert.ok(content.includes('login(provider.id, token)'), 'Should pass token to login');
});

test('SetupPage shows setup message and providers', () => {
  const content = readFileSync(join(PAGES_DIR, 'SetupPage.tsx'), 'utf-8');
  assert.ok(content.includes('Setup APIWeave'), 'Should show setup message');
});
