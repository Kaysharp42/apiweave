import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Copy, Check, AlertTriangle, Sparkles, Pencil } from 'lucide-react';

/**
 * Generates a comprehensive AI prompt for creating/updating workflows
 */
function buildAIPrompt(currentWorkflowJson, includeWorkflow) {
  const hasWorkflow = includeWorkflow && currentWorkflowJson?.nodes?.length > 0;

  const existingSection = hasWorkflow
    ? `
## Current Workflow (to update)
\`\`\`json
${JSON.stringify(currentWorkflowJson, null, 2)}
\`\`\`
Modify the JSON above according to my instructions. Keep existing nodes/edges that should remain unchanged.
`
    : `
## Task
Create a **new** APIWeave workflow JSON from scratch based on my instructions.
`;

  return `# APIWeave Workflow — AI Agent Reference

You are building (or updating) an API test workflow for **APIWeave**, a visual API test workflow builder. Your output must be a single valid JSON object that conforms to the schema below.

---
${existingSection}
---

## Output Format

Return **only** a JSON object with this top-level shape:

\`\`\`json
{
  "nodes": [ ... ],
  "edges": [ ... ],
  "variables": { "key": "value", ... }
}
\`\`\`

---

## Node Schema

Every node has:

| Field      | Type   | Required | Description |
|-----------|--------|----------|-------------|
| nodeId    | string | yes | Unique ID. Convention: \`{type}_{unix_timestamp_ms}\` e.g. \`httpRequest_1738900000000\` |
| type      | string | yes | One of: \`start\`, \`end\`, \`http-request\`, \`assertion\`, \`delay\`, \`merge\`, \`condition\` |
| label     | string | no  | Display name shown on the canvas |
| position  | object | yes | \`{ "x": number, "y": number }\` — canvas coordinates |
| config    | object | yes | Node-type-specific configuration (see below) |

### Layout Guidelines
- Place nodes left-to-right, top-to-bottom
- Start node at approximately \`{ "x": 100, "y": 200 }\`
- Space nodes ~300px apart horizontally, ~200px vertically
- End node at the rightmost position

---

## Node Types & Configs

### 1. Start Node (\`type: "start"\`)
Entry point. Every workflow must have exactly one.

\`\`\`json
{
  "nodeId": "start_1738900000000",
  "type": "start",
  "label": "Start",
  "position": { "x": 100, "y": 200 },
  "config": {}
}
\`\`\`

### 2. End Node (\`type: "end"\`)
Exit point. Every workflow must have exactly one.

\`\`\`json
{
  "nodeId": "end_1738900000001",
  "type": "end",
  "label": "End",
  "position": { "x": 1600, "y": 200 },
  "config": {}
}
\`\`\`

### 3. HTTP Request Node (\`type: "http-request"\`)
Makes an API call. The most commonly used node.

\`\`\`json
{
  "nodeId": "httpRequest_1738900000002",
  "type": "http-request",
  "label": "Create User",
  "position": { "x": 400, "y": 200 },
  "config": {
    "method": "POST",
    "url": "{{env.BASE_URL}}/api/users",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer {{variables.token}}"
    },
    "body": "{\\"name\\": \\"{{randomString(8)}}\\", \\"email\\": \\"{{randomEmail()}}\\"}",
    "timeout": 30,
    "followRedirects": true,
    "extractors": {
      "userId": "response.body.id",
      "userName": "response.body.name"
    }
  }
}
\`\`\`

**Config fields:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| method | string | — | \`GET\`, \`POST\`, \`PUT\`, \`PATCH\`, \`DELETE\`, \`HEAD\`, \`OPTIONS\` |
| url | string | — | Full URL. Supports variable templates |
| headers | object | \`{}\` | Key-value header pairs |
| body | string | \`null\` | Request body (usually JSON string). Set to \`null\` for GET/DELETE |
| timeout | int | \`30\` | Request timeout in seconds |
| followRedirects | bool | \`true\` | Whether to follow HTTP redirects |
| extractors | object | \`{}\` | Extract values from response into workflow variables. Key = variable name, Value = JSONPath |

**Extractor paths:**
- \`response.body.field\` — JSON body field
- \`response.body.nested.deep.field\` — Nested JSON
- \`response.body.items[0].id\` — Array indexing
- \`response.statusCode\` — HTTP status code
- \`response.headers.Content-Type\` — Response header

### 4. Assertion Node (\`type: "assertion"\`)
Validates API responses. Has **two output handles**: Pass (✓) and Fail (✗) for branching.

\`\`\`json
{
  "nodeId": "assertion_1738900000003",
  "type": "assertion",
  "label": "Verify User Created",
  "position": { "x": 700, "y": 200 },
  "config": {
    "assertions": [
      {
        "source": "status",
        "path": "",
        "operator": "equals",
        "expectedValue": "201"
      },
      {
        "source": "prev",
        "path": "body.name",
        "operator": "contains",
        "expectedValue": "test"
      },
      {
        "source": "prev",
        "path": "body.id",
        "operator": "exists",
        "expectedValue": ""
      }
    ]
  }
}
\`\`\`

**Assertion fields:**
| Field | Type | Description |
|-------|------|-------------|
| source | string | \`"prev"\` (previous node response), \`"status"\` (HTTP status code), \`"variables"\` (workflow variable), \`"headers"\` (response headers), \`"cookies"\` (cookies) |
| path | string | JSONPath from source. Empty for \`status\`. e.g. \`body.user.name\`, \`Set-Cookie\` |
| operator | string | See operator table below |
| expectedValue | string | Value to compare against. Empty for \`exists\`/\`notExists\` |

**Assertion operators:**
| Operator | Description | Example |
|----------|-------------|---------|
| \`equals\` | Exact match (numeric-aware) | Status \`equals\` "200" |
| \`notEquals\` | Not equal | Status \`notEquals\` "404" |
| \`contains\` | String contains substring | body.msg \`contains\` "success" |
| \`notContains\` | String does not contain | body.error \`notContains\` "fatal" |
| \`gt\` | Greater than (numeric) | body.count \`gt\` "0" |
| \`gte\` | Greater than or equal | body.age \`gte\` "18" |
| \`lt\` | Less than | body.latency \`lt\` "500" |
| \`lte\` | Less than or equal | body.retries \`lte\` "3" |
| \`exists\` | Field exists (not null) | body.token \`exists\` |
| \`notExists\` | Field is null/missing | body.error \`notExists\` |
| \`count\` | Array/string length equals | body.items \`count\` "5" |

**Pass/Fail routing:**
- If ALL assertions pass → routes through the **"pass"** sourceHandle
- If ANY assertion fails → routes through the **"fail"** sourceHandle
- Connect edges with \`sourceHandle: "pass"\` or \`sourceHandle: "fail"\` (see Edges)

### 5. Delay Node (\`type: "delay"\`)
Pauses execution for a duration.

\`\`\`json
{
  "nodeId": "delay_1738900000004",
  "type": "delay",
  "label": "Wait 2s",
  "position": { "x": 700, "y": 400 },
  "config": {
    "duration": 2000
  }
}
\`\`\`

| Field | Type | Description |
|-------|------|-------------|
| duration | int | Milliseconds to wait |

### 6. Merge Node (\`type: "merge"\`)
Synchronizes parallel branches back into a single flow.

\`\`\`json
{
  "nodeId": "merge_1738900000005",
  "type": "merge",
  "label": "Merge Branches",
  "position": { "x": 1000, "y": 300 },
  "config": {
    "mergeStrategy": "all"
  }
}
\`\`\`

| Field | Type | Description |
|-------|------|-------------|
| mergeStrategy | string | \`"all"\` (wait for every branch), \`"any"\` (first to finish), \`"first"\`, \`"conditional"\` |

### 7. Condition Node (\`type: "condition"\`)
Conditional branching based on expressions.

\`\`\`json
{
  "nodeId": "condition_1738900000006",
  "type": "condition",
  "label": "Check Status",
  "position": { "x": 700, "y": 200 },
  "config": {
    "condition": "response.body.status",
    "operator": "equals",
    "value": "active"
  }
}
\`\`\`

---

## Edge Schema

Every edge connects two nodes:

\`\`\`json
{
  "edgeId": "edge_1738900000010",
  "source": "start_1738900000000",
  "target": "httpRequest_1738900000002",
  "sourceHandle": null,
  "targetHandle": null,
  "label": null
}
\`\`\`

| Field | Type | Description |
|-------|------|-------------|
| edgeId | string | Unique edge ID |
| source | string | Source nodeId |
| target | string | Target nodeId |
| sourceHandle | string or null | \`"pass"\` or \`"fail"\` for assertion nodes. \`null\` for all others |
| targetHandle | string or null | Usually \`null\` |
| label | string or null | Optional label: \`"Pass"\`, \`"Fail"\`, etc. |

**Assertion edge examples:**
\`\`\`json
{ "edgeId": "e1", "source": "assertion_1", "target": "nextNode_1", "sourceHandle": "pass", "label": "Pass" },
{ "edgeId": "e2", "source": "assertion_1", "target": "errorHandler_1", "sourceHandle": "fail", "label": "Fail" }
\`\`\`

**Parallel branches:** Multiple edges from the same source node create parallel execution. Use a Merge node to recombine.

---

## Variable System

### Template Syntax
Variables are substituted in URLs, headers, body, and assertion fields using double-brace syntax:

| Pattern | Source | Example |
|---------|--------|---------|
| \`{{variables.name}}\` | Workflow variables (extracted or user-defined) | \`{{variables.userId}}\` |
| \`{{env.NAME}}\` | Environment variables | \`{{env.BASE_URL}}\` |
| \`{{prev.response.body.field}}\` | Previous node's response | \`{{prev.response.body.token}}\` |
| \`{{functionName(args)}}\` | Dynamic functions | \`{{uuid()}}\`, \`{{randomString(10)}}\` |

### Extractors
HTTP Request nodes can extract values from responses into workflow variables:
\`\`\`json
"extractors": {
  "token": "response.body.access_token",
  "userId": "response.body.data.id",
  "statusCode": "response.statusCode",
  "headerValue": "response.headers.X-Request-Id"
}
\`\`\`
Extracted values become available as \`{{variables.token}}\`, \`{{variables.userId}}\`, etc. for all subsequent nodes.

### Dynamic Functions
Use these in any template field:

| Function | Description | Example |
|----------|-------------|---------|
| \`{{uuid()}}\` | UUID v4 | \`550e8400-e29b-41d4...\` |
| \`{{randomString(N)}}\` | Random alphanumeric (default 10) | \`aBcD1eFg2H\` |
| \`{{randomAlpha(N)}}\` | Letters only (default 10) | \`aBcDeFgHiJ\` |
| \`{{randomNumeric(N)}}\` | Digits only (default 10) | \`1234567890\` |
| \`{{randomNumber(N)}}\` | Random number with N digits (default 6) | \`482910\` |
| \`{{randomHex(N)}}\` | Hex string (default 16) | \`a1b2c3d4e5f6\` |
| \`{{randomEmail()}}\` | Random email | \`xK9mP2q@example.com\` |
| \`{{randomChoice(a,b,c)}}\` | Random pick from list | \`b\` |
| \`{{timestamp()}}\` | Unix epoch seconds | \`1738900000\` |
| \`{{iso_timestamp()}}\` | ISO 8601 datetime | \`2026-02-09T12:00:00\` |
| \`{{date(format)}}\` | Current date (default \`%Y-%m-%d\`) | \`2026-02-09\` |
| \`{{futureDate(days,format)}}\` | Future date | \`2026-02-16\` |
| \`{{pastDate(days,format)}}\` | Past date | \`2026-02-02\` |

---

## Workflow Patterns

### Linear Flow
\`Start → HTTP Request → Assertion → HTTP Request → End\`

### Parallel Branches (Fan-out / Fan-in)
\`Start → [Branch A, Branch B, Branch C] → Merge → End\`
Create multiple edges from one node to fan out. Use a Merge node to rejoin.

### Assertion Branching (Pass/Fail)
\`HTTP Request → Assertion → (Pass) → Continue → End\`
\`                           → (Fail) → Error Handler → End\`

### Variable Chaining
1. Node A: POST /login → extract \`{{variables.token}}\`
2. Node B: GET /profile with \`Authorization: Bearer {{variables.token}}\`
3. Node C: Assert \`body.email\` exists

---

## Complete Example

\`\`\`json
{
  "nodes": [
    { "nodeId": "start_1", "type": "start", "label": "Start", "position": { "x": 100, "y": 250 }, "config": {} },
    {
      "nodeId": "http_login",
      "type": "http-request",
      "label": "Login",
      "position": { "x": 400, "y": 250 },
      "config": {
        "method": "POST",
        "url": "{{env.BASE_URL}}/api/auth/login",
        "headers": { "Content-Type": "application/json" },
        "body": "{\\"email\\": \\"admin@test.com\\", \\"password\\": \\"{{env.PASSWORD}}\\"}",
        "timeout": 30,
        "followRedirects": true,
        "extractors": { "token": "response.body.access_token" }
      }
    },
    {
      "nodeId": "assert_login",
      "type": "assertion",
      "label": "Check Login",
      "position": { "x": 700, "y": 250 },
      "config": {
        "assertions": [
          { "source": "status", "path": "", "operator": "equals", "expectedValue": "200" },
          { "source": "prev", "path": "body.access_token", "operator": "exists", "expectedValue": "" }
        ]
      }
    },
    {
      "nodeId": "http_profile",
      "type": "http-request",
      "label": "Get Profile",
      "position": { "x": 1000, "y": 150 },
      "config": {
        "method": "GET",
        "url": "{{env.BASE_URL}}/api/profile",
        "headers": { "Authorization": "Bearer {{variables.token}}" },
        "body": null,
        "timeout": 30,
        "followRedirects": true,
        "extractors": { "userName": "response.body.name" }
      }
    },
    {
      "nodeId": "http_error",
      "type": "http-request",
      "label": "Log Error",
      "position": { "x": 1000, "y": 400 },
      "config": {
        "method": "POST",
        "url": "{{env.BASE_URL}}/api/logs",
        "headers": { "Content-Type": "application/json" },
        "body": "{\\"error\\": \\"Login assertion failed\\"}",
        "timeout": 10,
        "followRedirects": true,
        "extractors": {}
      }
    },
    { "nodeId": "end_1", "type": "end", "label": "End", "position": { "x": 1300, "y": 250 }, "config": {} }
  ],
  "edges": [
    { "edgeId": "e1", "source": "start_1", "target": "http_login", "sourceHandle": null, "targetHandle": null, "label": null },
    { "edgeId": "e2", "source": "http_login", "target": "assert_login", "sourceHandle": null, "targetHandle": null, "label": null },
    { "edgeId": "e3", "source": "assert_login", "target": "http_profile", "sourceHandle": "pass", "targetHandle": null, "label": "Pass" },
    { "edgeId": "e4", "source": "assert_login", "target": "http_error", "sourceHandle": "fail", "targetHandle": null, "label": "Fail" },
    { "edgeId": "e5", "source": "http_profile", "target": "end_1", "sourceHandle": null, "targetHandle": null, "label": null },
    { "edgeId": "e6", "source": "http_error", "target": "end_1", "sourceHandle": null, "targetHandle": null, "label": null }
  ],
  "variables": {}
}
\`\`\`

---

## Rules
1. Every workflow **must** have exactly one \`start\` node and one \`end\` node.
2. All nodes must be connected — no orphan nodes.
3. Node IDs must be unique. Use the convention \`{type}_{timestamp}\`.
4. Edge IDs must be unique.
5. Assertion nodes should use \`sourceHandle: "pass"\` and \`sourceHandle: "fail"\` on their outgoing edges.
6. Non-assertion nodes use \`sourceHandle: null\`.
7. All string values in \`body\` must be properly escaped JSON (double-escaped quotes).
8. Use \`{{env.VAR}}\` for values that change per environment (base URLs, credentials).
9. Use \`{{variables.name}}\` for values extracted during execution.
10. Use dynamic functions for test data generation: \`{{uuid()}}\`, \`{{randomEmail()}}\`, etc.
11. Always include appropriate assertions after HTTP requests.
12. Return **only** the JSON object — no markdown fences, no explanations.
`;
}

/**
 * WorkflowJsonEditor — Full-screen modal that shows the raw JSON of the
 * current workflow (nodes, edges, variables, settings).  Users can read,
 * copy, edit, and apply changes.  Invalid JSON is rejected gracefully.
 */
const WorkflowJsonEditor = ({ workflowJson, onApply, onClose }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [viewMode, setViewMode] = useState('json'); // 'json' or 'ai-prompt'
  const [includeWorkflow, setIncludeWorkflow] = useState(
    workflowJson?.nodes?.length > 0
  );
  const textareaRef = useRef(null);
  const promptRef = useRef(null);

  // Seed editor with pretty-printed JSON on open
  useEffect(() => {
    try {
      const pretty = JSON.stringify(workflowJson, null, 2);
      setValue(pretty);
      setError(null);
      setIsDirty(false);
    } catch {
      setValue('{}');
    }
  }, [workflowJson]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleChange = useCallback((e) => {
    setValue(e.target.value);
    setIsDirty(true);
    setError(null);
  }, []);

  const handleCopy = useCallback(async () => {
    const textToCopy = viewMode === 'json' 
      ? value 
      : buildAIPrompt(workflowJson, includeWorkflow);
    
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback
      if (viewMode === 'json') {
        textareaRef.current?.select();
        document.execCommand('copy');
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [value, viewMode, workflowJson, includeWorkflow]);

  const handleApply = useCallback(() => {
    try {
      const parsed = JSON.parse(value);

      // Basic shape validation
      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        setError('"nodes" must be an array.');
        return;
      }
      if (!parsed.edges || !Array.isArray(parsed.edges)) {
        setError('"edges" must be an array.');
        return;
      }

      onApply(parsed);
    } catch (e) {
      setError(`Invalid JSON: ${e.message}`);
    }
  }, [value, onApply]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleApply();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, handleApply]);

  // Count lines for line numbers
  const lineCount = value.split('\n').length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-[90vw] max-w-5xl h-[85vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">
              Workflow Editor
            </h2>
            {isDirty && viewMode === 'json' && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded">
                Unsaved changes
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* View mode tabs */}
            <div className="flex items-center gap-1 mr-2 bg-gray-200 dark:bg-gray-700 rounded-md p-0.5">
              <button
                onClick={() => setViewMode('json')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                  viewMode === 'json'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit JSON
              </button>
              <button
                onClick={() => setViewMode('ai-prompt')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                  viewMode === 'ai-prompt'
                    ? 'bg-white dark:bg-gray-600 text-purple-600 dark:text-purple-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI Prompt
              </button>
            </div>
            
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors"
              title={viewMode === 'json' ? 'Copy JSON to clipboard' : 'Copy AI prompt to clipboard'}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            {viewMode === 'json' && (
              <button
                onClick={handleApply}
                disabled={!isDirty}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-600 hover:bg-cyan-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Apply changes (Ctrl+S)"
              >
                Apply
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error bar */}
        {error && viewMode === 'json' && (
          <div className="flex items-center gap-2 px-5 py-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Include workflow toggle (only in AI prompt mode) */}
        {viewMode === 'ai-prompt' && workflowJson?.nodes?.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeWorkflow}
                onChange={(e) => setIncludeWorkflow(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Include current workflow JSON (for updating)
              </span>
            </label>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {includeWorkflow ? 'AI will see and modify existing nodes' : 'AI will create from scratch'}
            </span>
          </div>
        )}

        {/* Content */}
        {viewMode === 'json' ? (
          <div className="flex-1 relative overflow-hidden">
            <div className="absolute inset-0 flex overflow-auto">
              {/* Line numbers */}
              <div className="flex-shrink-0 py-3 px-2 bg-gray-100 dark:bg-gray-800 text-right select-none border-r border-gray-200 dark:border-gray-700 overflow-hidden"
                   style={{ minWidth: 48 }}>
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} className="text-[11px] leading-[1.6] text-gray-400 dark:text-gray-600 font-mono pr-1">
                    {i + 1}
                  </div>
                ))}
              </div>
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={value}
                onChange={handleChange}
                spellCheck={false}
                className="flex-1 p-3 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-[12px] leading-[1.6] resize-none outline-none border-none"
                style={{ tabSize: 2 }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto" ref={promptRef}>
            <pre className="p-5 text-[12px] leading-relaxed font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
              {buildAIPrompt(workflowJson, includeWorkflow)}
            </pre>
          </div>
        )}

        {/* Footer / hint */}
        <div className="flex items-center justify-between px-5 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[10px] text-gray-500 dark:text-gray-400">
          {viewMode === 'json' ? (
            <>
              <span>{lineCount} lines</span>
              <span>Ctrl+S to apply &middot; Esc to close</span>
            </>
          ) : (
            <>
              <span>{buildAIPrompt(workflowJson, includeWorkflow).length.toLocaleString()} characters</span>
              <span>Copy this prompt → paste into AI agent → paste output into JSON editor</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowJsonEditor;
