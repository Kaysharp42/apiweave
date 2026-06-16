import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/components/WebhookCiCdExamples.tsx'), 'utf8');

describe('WebhookManager CI/CD snippets', () => {
  // ---------------------------------------------------------------------------
  // GitHub Actions snippets
  // ---------------------------------------------------------------------------

  it('GitHub Actions token-only snippet references secrets.APIWEAVE_WEBHOOK_TOKEN', () => {
    expect(source).toMatch(/secrets\.APIWEAVE_WEBHOOK_TOKEN/);
  });

  it('GitHub Actions snippet uses curl POST with X-Webhook-Token header', () => {
    expect(source).toMatch(/X-Webhook-Token: \$\{\{ secrets\.APIWEAVE_WEBHOOK_TOKEN \}\}/);
  });

  it('GitHub Actions HMAC snippet references secrets.APIWEAVE_HMAC_SECRET', () => {
    expect(source).toMatch(/secrets\.APIWEAVE_HMAC_SECRET/);
  });

  it('GitHub Actions snippet includes fire-and-forget mode label', () => {
    expect(source).toMatch(/Trigger APIWeave \(fire-and-forget\)/);
  });

  it('GitHub Actions snippet includes blocking mode label', () => {
    expect(source).toMatch(/Trigger APIWeave \(blocking\)/);
  });

  // ---------------------------------------------------------------------------
  // GitLab CI snippets
  // ---------------------------------------------------------------------------

  it('GitLab CI token-only snippet references $APIWEAVE_WEBHOOK_TOKEN', () => {
    expect(source).toMatch(/\$APIWEAVE_WEBHOOK_TOKEN/);
  });

  it('GitLab CI snippet uses X-Webhook-Token header with variable placeholder', () => {
    expect(source).toMatch(/X-Webhook-Token: \$APIWEAVE_WEBHOOK_TOKEN/);
  });

  it('GitLab CI HMAC snippet references $APIWEAVE_HMAC_SECRET', () => {
    expect(source).toMatch(/\$APIWEAVE_HMAC_SECRET/);
  });

  it('GitLab CI snippet includes trigger_apiweave job name', () => {
    expect(source).toMatch(/trigger_apiweave/);
  });

  // ---------------------------------------------------------------------------
  // Jenkins snippets
  // ---------------------------------------------------------------------------

  it('Jenkins snippet uses withCredentials with APIWEAVE_WEBHOOK_TOKEN variable', () => {
    expect(source).toMatch(/variable: 'APIWEAVE_WEBHOOK_TOKEN'/);
  });

  it('Jenkins snippet uses credentialsId apiweave-token', () => {
    expect(source).toMatch(/credentialsId: 'apiweave-token'/);
  });

  it('Jenkins HMAC snippet uses credentialsId apiweave-secret', () => {
    expect(source).toMatch(/credentialsId: 'apiweave-secret'/);
  });

  it('Jenkins snippet includes pipeline block', () => {
    expect(source).toMatch(/pipeline \{/);
  });

  it('Jenkins snippet includes withCredentials block', () => {
    expect(source).toMatch(/withCredentials\(\[/);
  });

  // ---------------------------------------------------------------------------
  // No raw secret/token values in snippets
  // ---------------------------------------------------------------------------

  it('No raw webhook token values (wh_ prefix) appear in snippet strings', () => {
    expect(source).not.toMatch(/wh_[a-f0-9]+/);
  });

  it('No raw HMAC secret values (hs_ prefix) appear in snippet strings', () => {
    expect(source).not.toMatch(/hs_[a-f0-9]+/);
  });

  // ---------------------------------------------------------------------------
  // Snippet builder functions are exported / present
  // ---------------------------------------------------------------------------

  it('buildGithubSnippet function is defined', () => {
    expect(source).toMatch(/function buildGithubSnippet/);
  });

  it('buildGitlabSnippet function is defined', () => {
    expect(source).toMatch(/function buildGitlabSnippet/);
  });

  it('buildJenkinsSnippet function is defined', () => {
    expect(source).toMatch(/function buildJenkinsSnippet/);
  });

  it('getSnippet dispatcher function is defined', () => {
    expect(source).toMatch(/function getSnippet/);
  });

  // ---------------------------------------------------------------------------
  // WebhookCiCdExamples component structure
  // ---------------------------------------------------------------------------

  it('WebhookCiCdExamples component is defined', () => {
    expect(source).toMatch(/function WebhookCiCdExamples/);
  });

  it('WebhookCiCdExamples renders GitHub Actions provider button', () => {
    expect(source).toMatch(/GitHub Actions/);
  });

  it('WebhookCiCdExamples renders GitLab CI provider button', () => {
    expect(source).toMatch(/GitLab CI/);
  });

  it('WebhookCiCdExamples renders Jenkins provider button', () => {
    expect(source).toMatch(/Jenkins/);
  });

  it('WebhookCiCdExamples renders Fire-and-Forget mode button', () => {
    expect(source).toMatch(/Fire-and-Forget/);
  });

  it('WebhookCiCdExamples renders Blocking mode button', () => {
    expect(source).toMatch(/Blocking/);
  });

  it('Snippets use environment variable placeholders, not actual secret values', () => {
    // The disclaimer text must be present
    expect(source).toMatch(/Snippets use environment variable\s+placeholders\s*--\s*never actual secret values/s);
  });
});
