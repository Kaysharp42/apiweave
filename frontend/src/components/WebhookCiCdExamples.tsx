import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from './atoms/Button';
import { IconButton } from './atoms/IconButton';

type CiProvider = 'github' | 'gitlab' | 'jenkins';
type SnippetMode = 'fire-and-forget' | 'blocking';
type SnippetAuth = 'token-only' | 'hmac';

const WEBHOOK_URL_PLACEHOLDER = '$APIWEAVE_BASE_URL/api/webhooks/workflows/WEBHOOK_ID/execute';

function buildGithubSnippet(mode: SnippetMode, auth: SnippetAuth): string {
  const url = WEBHOOK_URL_PLACEHOLDER;
  const tokenHeader = '-H "X-Webhook-Token: ${{ secrets.APIWEAVE_WEBHOOK_TOKEN }}"';
  const hmacSetup = `      - name: Compute HMAC signature
        id: hmac
        run: |
          TIMESTAMP=$(date +%s)
          PAYLOAD='{}'
          SIG=$(printf '%s' "$TIMESTAMP$PAYLOAD" | openssl dgst -sha256 -hmac "\${{ secrets.APIWEAVE_HMAC_SECRET }}" | awk '{print $2}')
          echo "::add-mask::$SIG"
          echo "sig=$SIG" >> "$GITHUB_OUTPUT"
          echo "ts=$TIMESTAMP" >> "$GITHUB_OUTPUT"`;
  const hmacHeaders = `-H "X-Webhook-Token: \${{ secrets.APIWEAVE_WEBHOOK_TOKEN }}" \\
          -H "X-Webhook-Timestamp: \${{ steps.hmac.outputs.ts }}" \\
          -H "X-Webhook-Signature: \${{ steps.hmac.outputs.sig }}"`;
  if (mode === 'fire-and-forget') {
    if (auth === 'token-only') {
      return `name: Trigger APIWeave (fire-and-forget)
 on: [push]
 jobs:
   trigger:
     runs-on: ubuntu-latest
     steps:
       - name: Trigger webhook
         run: |
           STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \\
             "${url}" \\
             ${tokenHeader} \\
             -H "Content-Type: application/json" \\
             -d '{}')
           [ "$STATUS" = "202" ] || (echo "Unexpected status $STATUS" && exit 1)`;
    }
    return `name: Trigger APIWeave HMAC (fire-and-forget)
 on: [push]
 jobs:
   trigger:
     runs-on: ubuntu-latest
     steps:
 ${hmacSetup}
       - name: Trigger webhook
         run: |
           STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \\
             "\${{ secrets.APIWEAVE_BASE_URL }}/api/webhooks/workflows/WEBHOOK_ID/execute" \\
             ${hmacHeaders} \\
             -H "Content-Type: application/json" \\
             -d '{}')
           [ "$STATUS" = "202" ] || (echo "Unexpected status $STATUS" && exit 1)`;
  }
  if (auth === 'token-only') {
    return `name: Trigger APIWeave (blocking)
 on: [push]
 jobs:
   trigger:
     runs-on: ubuntu-latest
     steps:
       - name: Trigger and poll webhook
         run: |
           RESPONSE=$(curl -s -X POST \\
             "${url}" \\
             ${tokenHeader} \\
             -H "Content-Type: application/json" \\
             -d '{}')
           RUN_ID=$(echo "$RESPONSE" | jq -r '.runId // empty')
           [ -n "$RUN_ID" ] || (echo "No runId in response" && exit 1)
           for i in $(seq 1 60); do
             RESULT=$(curl -s \\
               "\${{ secrets.APIWEAVE_BASE_URL }}/api/runs/$RUN_ID" \\
               ${tokenHeader})
             STATUS=$(echo "$RESULT" | jq -r '.status // empty')
             case "$STATUS" in
               success) echo "Run succeeded"; exit 0 ;;
               failed)  echo "Run failed";    exit 1 ;;
             esac
             echo "Attempt $i: status=$STATUS, waiting 5s..."
             sleep 5
           done
           echo "Timed out waiting for run" && exit 1`;
  }
  return `name: Trigger APIWeave HMAC (blocking)
 on: [push]
 jobs:
   trigger:
     runs-on: ubuntu-latest
     steps:
 ${hmacSetup}
       - name: Trigger and poll webhook
         run: |
           RESPONSE=$(curl -s -X POST \\
             "\${{ secrets.APIWEAVE_BASE_URL }}/api/webhooks/workflows/WEBHOOK_ID/execute" \\
             ${hmacHeaders} \\
             -H "Content-Type: application/json" \\
             -d '{}')
           RUN_ID=$(echo "$RESPONSE" | jq -r '.runId // empty')
           [ -n "$RUN_ID" ] || (echo "No runId in response" && exit 1)
           for i in $(seq 1 60); do
             RESULT=$(curl -s \\
               "\${{ secrets.APIWEAVE_BASE_URL }}/api/runs/$RUN_ID" \\
               -H "X-Webhook-Token: \${{ secrets.APIWEAVE_WEBHOOK_TOKEN }}")
             STATUS=$(echo "$RESULT" | jq -r '.status // empty')
             case "$STATUS" in
               success) echo "Run succeeded"; exit 0 ;;
               failed)  echo "Run failed";    exit 1 ;;
             esac
             echo "Attempt $i: status=$STATUS, waiting 5s..."
             sleep 5
           done
           echo "Timed out waiting for run" && exit 1`;
}

function buildGitlabSnippet(mode: SnippetMode, auth: SnippetAuth): string {
  const url = '$APIWEAVE_BASE_URL/api/webhooks/workflows/WEBHOOK_ID/execute';
  const tokenHeader = '-H "X-Webhook-Token: $APIWEAVE_WEBHOOK_TOKEN"';
  const hmacSetup = `  compute_hmac:
    script:
      - TIMESTAMP=$(date +%s)
      - PAYLOAD='{}'
      - SIG=$(printf '%s' "$TIMESTAMP$PAYLOAD" | openssl dgst -sha256 -hmac "$APIWEAVE_HMAC_SECRET" | awk '{print $2}')`;
  if (mode === 'fire-and-forget') {
    if (auth === 'token-only') {
      return `trigger_apiweave:
  stage: test
  script:
    - |
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \\
        "${url}" \\
        ${tokenHeader} \\
        -H "Content-Type: application/json" \\
        -d '{}')
      [ "$STATUS" = "202" ] || (echo "Unexpected status $STATUS" && exit 1)`;
    }
    return `trigger_apiweave_hmac:
  stage: test
  script:
    - TIMESTAMP=$(date +%s)
    - PAYLOAD='{}'
    - SIG=$(printf '%s' "$TIMESTAMP$PAYLOAD" | openssl dgst -sha256 -hmac "$APIWEAVE_HMAC_SECRET" | awk '{print $2}')
    - |
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \\
        "${url}" \\
        -H "X-Webhook-Token: $APIWEAVE_WEBHOOK_TOKEN" \\
        -H "X-Webhook-Timestamp: $TIMESTAMP" \\
        -H "X-Webhook-Signature: $SIG" \\
        -H "Content-Type: application/json" \\
        -d '{}')
      [ "$STATUS" = "202" ] || (echo "Unexpected status $STATUS" && exit 1)
  # Enable "Mask variable" in GitLab CI/CD settings for APIWEAVE_HMAC_SECRET`;
  }
  if (auth === 'token-only') {
    return `trigger_apiweave_blocking:
  stage: test
  script:
    - |
      RESPONSE=$(curl -s -X POST \\
        "${url}" \\
        ${tokenHeader} \\
        -H "Content-Type: application/json" \\
        -d '{}')
      RUN_ID=$(echo "$RESPONSE" | jq -r '.runId // empty')
      [ -n "$RUN_ID" ] || (echo "No runId in response" && exit 1)
      for i in $(seq 1 60); do
        RESULT=$(curl -s \\
          "$APIWEAVE_BASE_URL/api/runs/$RUN_ID" \\
          ${tokenHeader})
        STATUS=$(echo "$RESULT" | jq -r '.status // empty')
        case "$STATUS" in
          success) echo "Run succeeded"; exit 0 ;;
          failed)  echo "Run failed";    exit 1 ;;
        esac
        echo "Attempt $i: status=$STATUS, waiting 5s..."
        sleep 5
      done
      echo "Timed out waiting for run" && exit 1`;
  }
  return `trigger_apiweave_hmac_blocking:
  stage: test
  script:
    - TIMESTAMP=$(date +%s)
    - PAYLOAD='{}'
    - SIG=$(printf '%s' "$TIMESTAMP$PAYLOAD" | openssl dgst -sha256 -hmac "$APIWEAVE_HMAC_SECRET" | awk '{print $2}')
    - |
      RESPONSE=$(curl -s -X POST \\
        "${url}" \\
        -H "X-Webhook-Token: $APIWEAVE_WEBHOOK_TOKEN" \\
        -H "X-Webhook-Timestamp: $TIMESTAMP" \\
        -H "X-Webhook-Signature: $SIG" \\
        -H "Content-Type: application/json" \\
        -d '{}')
      RUN_ID=$(echo "$RESPONSE" | jq -r '.runId // empty')
      [ -n "$RUN_ID" ] || (echo "No runId in response" && exit 1)
      for i in $(seq 1 60); do
        RESULT=$(curl -s \\
          "$APIWEAVE_BASE_URL/api/runs/$RUN_ID" \\
          -H "X-Webhook-Token: $APIWEAVE_WEBHOOK_TOKEN")
        STATUS=$(echo "$RESULT" | jq -r '.status // empty')
        case "$STATUS" in
          success) echo "Run succeeded"; exit 0 ;;
          failed)  echo "Run failed";    exit 1 ;;
        esac
        echo "Attempt $i: status=$STATUS, waiting 5s..."
        sleep 5
      done
      echo "Timed out waiting for run" && exit 1
  # Enable "Mask variable" in GitLab CI/CD settings for APIWEAVE_HMAC_SECRET
 ${hmacSetup.split('\n').map((l) => `  # ${l}`).join('\n')}`;
}

function buildJenkinsSnippet(mode: SnippetMode, auth: SnippetAuth): string {
  const url = '${env.APIWEAVE_BASE_URL}/api/webhooks/workflows/WEBHOOK_ID/execute';
  if (mode === 'fire-and-forget') {
    if (auth === 'token-only') {
      return `pipeline {
  agent any
  stages {
    stage('Trigger APIWeave') {
      steps {
        withCredentials([string(credentialsId: 'apiweave-token', variable: 'APIWEAVE_WEBHOOK_TOKEN')]) {
          sh """
            STATUS=\\$(curl -s -o /dev/null -w "%{http_code}" -X POST \\
              "${url}" \\
              -H "X-Webhook-Token: \\$APIWEAVE_WEBHOOK_TOKEN" \\
              -H "Content-Type: application/json" \\
              -d '{}')
            [ "\\$STATUS" = "202" ] || (echo "Unexpected status \\\$STATUS" && exit 1)
          """
        }
      }
    }
  }
}`;
    }
    return `pipeline {
  agent any
  stages {
    stage('Trigger APIWeave HMAC') {
      steps {
        withCredentials([
          string(credentialsId: 'apiweave-token',  variable: 'APIWEAVE_WEBHOOK_TOKEN'),
          string(credentialsId: 'apiweave-secret', variable: 'APIWEAVE_HMAC_SECRET')
        ]) {
          sh """
            TIMESTAMP=\\$(date +%s)
            PAYLOAD='{}'
            SIG=\\$(printf '%s' "\\$TIMESTAMP\\$PAYLOAD" | openssl dgst -sha256 -hmac "\\$APIWEAVE_HMAC_SECRET" | awk '{print \\$2}')
            STATUS=\\$(curl -s -o /dev/null -w "%{http_code}" -X POST \\
              "${url}" \\
              -H "X-Webhook-Token: \\$APIWEAVE_WEBHOOK_TOKEN" \\
              -H "X-Webhook-Timestamp: \\$TIMESTAMP" \\
              -H "X-Webhook-Signature: \\$SIG" \\
              -H "Content-Type: application/json" \\
              -d '{}')
            [ "\\$STATUS" = "202" ] || (echo "Unexpected status \\\$STATUS" && exit 1)
          """
        }
      }
    }
  }
}`;
  }
  if (auth === 'token-only') {
    return `pipeline {
  agent any
  stages {
    stage('Trigger and Poll APIWeave') {
      steps {
        withCredentials([string(credentialsId: 'apiweave-token', variable: 'APIWEAVE_WEBHOOK_TOKEN')]) {
          sh """
            RESPONSE=\\$(curl -s -X POST \\
              "${url}" \\
              -H "X-Webhook-Token: \\$APIWEAVE_WEBHOOK_TOKEN" \\
              -H "Content-Type: application/json" \\
              -d '{}')
            RUN_ID=\\$(echo "\\$RESPONSE" | jq -r '.runId // empty')
            [ -n "\\$RUN_ID" ] || (echo "No runId in response" && exit 1)
            for i in \\$(seq 1 60); do
              RESULT=\\$(curl -s \\
                "\${env.APIWEAVE_BASE_URL}/api/runs/\\$RUN_ID" \\
                -H "X-Webhook-Token: \\$APIWEAVE_WEBHOOK_TOKEN")
              STATUS=\\$(echo "\\$RESULT" | jq -r '.status // empty')
              case "\\$STATUS" in
                success) echo "Run succeeded"; exit 0 ;;
                failed)  echo "Run failed";    exit 1 ;;
              esac
              echo "Attempt \\$i: status=\\$STATUS, waiting 5s..."
              sleep 5
            done
            echo "Timed out waiting for run" && exit 1
          """
        }
      }
    }
  }
}`;
  }
  return `pipeline {
  agent any
  stages {
    stage('Trigger and Poll APIWeave HMAC') {
      steps {
        withCredentials([
          string(credentialsId: 'apiweave-token',  variable: 'APIWEAVE_WEBHOOK_TOKEN'),
          string(credentialsId: 'apiweave-secret', variable: 'APIWEAVE_HMAC_SECRET')
        ]) {
          sh """
            TIMESTAMP=\\$(date +%s)
            PAYLOAD='{}'
            SIG=\\$(printf '%s' "\\$TIMESTAMP\\$PAYLOAD" | openssl dgst -sha256 -hmac "\\$APIWEAVE_HMAC_SECRET" | awk '{print \\$2}')
            RESPONSE=\\$(curl -s -X POST \\
              "${url}" \\
              -H "X-Webhook-Token: \\$APIWEAVE_WEBHOOK_TOKEN" \\
              -H "X-Webhook-Timestamp: \\$TIMESTAMP" \\
              -H "X-Webhook-Signature: \\$SIG" \\
              -H "Content-Type: application/json" \\
              -d '{}')
            RUN_ID=\\$(echo "\\$RESPONSE" | jq -r '.runId // empty')
            [ -n "\\$RUN_ID" ] || (echo "No runId in response" && exit 1)
            for i in \\$(seq 1 60); do
              RESULT=\\$(curl -s \\
                "\${env.APIWEAVE_BASE_URL}/api/runs/\\$RUN_ID" \\
                -H "X-Webhook-Token: \\$APIWEAVE_WEBHOOK_TOKEN")
              STATUS=\\$(echo "\\$RESULT" | jq -r '.status // empty')
              case "\\$STATUS" in
                success) echo "Run succeeded"; exit 0 ;;
                failed)  echo "Run failed";    exit 1 ;;
              esac
              echo "Attempt \\$i: status=\\$STATUS, waiting 5s..."
              sleep 5
            done
            echo "Timed out waiting for run" && exit 1
          """
        }
      }
    }
  }
}`;
}

function getSnippet(provider: CiProvider, mode: SnippetMode, auth: SnippetAuth): string {
  if (provider === 'github') return buildGithubSnippet(mode, auth);
  if (provider === 'gitlab') return buildGitlabSnippet(mode, auth);
  return buildJenkinsSnippet(mode, auth);
}

export function WebhookCiCdExamples() {
  const [provider, setProvider] = useState<CiProvider>('github');
  const [mode, setMode] = useState<SnippetMode>('fire-and-forget');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copySnippet = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (e) {
      console.error('Failed to copy snippet:', e);
    }
  };

  const providers: { id: CiProvider; label: string }[] = [
    { id: 'github', label: 'GitHub Actions' },
    { id: 'gitlab', label: 'GitLab CI' },
    { id: 'jenkins', label: 'Jenkins' },
  ];

  const modes: { id: SnippetMode; label: string }[] = [
    { id: 'fire-and-forget', label: 'Fire-and-Forget' },
    { id: 'blocking', label: 'Blocking' },
  ];

  const auths: { id: SnippetAuth; label: string; desc: string }[] = [
    { id: 'token-only', label: 'Token Only', desc: 'Development only when HMAC is not required' },
    { id: 'hmac', label: 'HMAC', desc: 'Required in production with timestamp signing' },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted dark:text-text-muted-dark">
        Copy a ready-to-use snippet into your CI/CD pipeline. Snippets use environment variable placeholders -- never actual secret values.
      </p>
      <div className="flex gap-1 flex-wrap">
        {providers.map((p) => (
          <Button key={p.id} variant={provider === p.id ? 'secondary' : 'ghost'} size="xs" onClick={() => setProvider(p.id)}>
            {p.label}
          </Button>
        ))}
      </div>
      <div className="flex gap-1">
        {modes.map((m) => (
          <Button key={m.id} variant={mode === m.id ? 'primary' : 'ghost'} size="xs" onClick={() => setMode(m.id)}>
            {m.label}
          </Button>
        ))}
      </div>
      <div className="space-y-3">
        {auths.map((a) => {
          const snippet = getSnippet(provider, mode, a.id);
          const key = `cicd-${provider}-${mode}-${a.id}`;
          return (
            <div key={a.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-text-primary dark:text-text-primary-dark">{a.label}</span>
                  <span className="text-xs text-text-muted dark:text-text-muted-dark ml-2"> -- {a.desc}</span>
                </div>
                <IconButton onClick={() => copySnippet(snippet, key)} variant="ghost" size="sm" title="Copy snippet">
                  {copiedKey === key ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
                </IconButton>
              </div>
              <pre className="bg-base-300 dark:bg-surface-dark-raised rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre border border-border dark:border-border-dark">
                <code>{snippet}</code>
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
