import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(join(process.cwd(), 'src/components/WebhookManager.tsx'), 'utf8');

// ---------------------------------------------------------------------------
// GitHub Actions snippets
// ---------------------------------------------------------------------------

test('GitHub Actions token-only snippet references secrets.APIWEAVE_WEBHOOK_TOKEN', () => {
  assert.match(source, /secrets\.APIWEAVE_WEBHOOK_TOKEN/);
});

test('GitHub Actions snippet uses curl POST with X-Webhook-Token header', () => {
  assert.match(source, /X-Webhook-Token: \$\{\{ secrets\.APIWEAVE_WEBHOOK_TOKEN \}\}/);
});

test('GitHub Actions HMAC snippet references secrets.APIWEAVE_HMAC_SECRET', () => {
  assert.match(source, /secrets\.APIWEAVE_HMAC_SECRET/);
});

test('GitHub Actions snippet includes fire-and-forget mode label', () => {
  assert.match(source, /Trigger APIWeave \(fire-and-forget\)/);
});

test('GitHub Actions snippet includes blocking mode label', () => {
  assert.match(source, /Trigger APIWeave \(blocking\)/);
});

// ---------------------------------------------------------------------------
// GitLab CI snippets
// ---------------------------------------------------------------------------

test('GitLab CI token-only snippet references $APIWEAVE_WEBHOOK_TOKEN', () => {
  assert.match(source, /\$APIWEAVE_WEBHOOK_TOKEN/);
});

test('GitLab CI snippet uses X-Webhook-Token header with variable placeholder', () => {
  assert.match(source, /X-Webhook-Token: \$APIWEAVE_WEBHOOK_TOKEN/);
});

test('GitLab CI HMAC snippet references $APIWEAVE_HMAC_SECRET', () => {
  assert.match(source, /\$APIWEAVE_HMAC_SECRET/);
});

test('GitLab CI snippet includes trigger_apiweave job name', () => {
  assert.match(source, /trigger_apiweave/);
});

// ---------------------------------------------------------------------------
// Jenkins snippets
// ---------------------------------------------------------------------------

test('Jenkins snippet uses withCredentials with APIWEAVE_WEBHOOK_TOKEN variable', () => {
  assert.match(source, /variable: 'APIWEAVE_WEBHOOK_TOKEN'/);
});

test('Jenkins snippet uses credentialsId apiweave-token', () => {
  assert.match(source, /credentialsId: 'apiweave-token'/);
});

test('Jenkins HMAC snippet uses credentialsId apiweave-secret', () => {
  assert.match(source, /credentialsId: 'apiweave-secret'/);
});

test('Jenkins snippet includes pipeline block', () => {
  assert.match(source, /pipeline \{/);
});

test('Jenkins snippet includes withCredentials block', () => {
  assert.match(source, /withCredentials\(\[/);
});

// ---------------------------------------------------------------------------
// No raw secret/token values in snippets
// ---------------------------------------------------------------------------

test('No raw webhook token values (wh_ prefix) appear in snippet strings', () => {
  assert.doesNotMatch(source, /wh_[a-f0-9]+/);
});

test('No raw HMAC secret values (hs_ prefix) appear in snippet strings', () => {
  assert.doesNotMatch(source, /hs_[a-f0-9]+/);
});

// ---------------------------------------------------------------------------
// Snippet builder functions are exported / present
// ---------------------------------------------------------------------------

test('buildGithubSnippet function is defined', () => {
  assert.match(source, /function buildGithubSnippet/);
});

test('buildGitlabSnippet function is defined', () => {
  assert.match(source, /function buildGitlabSnippet/);
});

test('buildJenkinsSnippet function is defined', () => {
  assert.match(source, /function buildJenkinsSnippet/);
});

test('getSnippet dispatcher function is defined', () => {
  assert.match(source, /function getSnippet/);
});

// ---------------------------------------------------------------------------
// CiCdExamples component structure
// ---------------------------------------------------------------------------

test('CiCdExamples component is defined', () => {
  assert.match(source, /function CiCdExamples/);
});

test('CiCdExamples renders GitHub Actions provider button', () => {
  assert.match(source, /GitHub Actions/);
});

test('CiCdExamples renders GitLab CI provider button', () => {
  assert.match(source, /GitLab CI/);
});

test('CiCdExamples renders Jenkins provider button', () => {
  assert.match(source, /Jenkins/);
});

test('CiCdExamples renders Fire-and-Forget mode button', () => {
  assert.match(source, /Fire-and-Forget/);
});

test('CiCdExamples renders Blocking mode button', () => {
  assert.match(source, /Blocking/);
});

test('Snippets use environment variable placeholders, not actual secret values', () => {
  // The disclaimer text must be present
  assert.match(source, /Snippets use environment variable\s+placeholders — never actual secret values/s);
});
