import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const nodeModalSource = readFileSync(join(process.cwd(), 'src/components/NodeModal.tsx'), 'utf8');

test('NodeModal uses the legacy HTTP request Parameters and Settings editor', () => {
  assert.match(nodeModalSource, /const \[activeTab, setActiveTab\] = useState\('parameters'\)/);
  assert.match(nodeModalSource, /<TabButton id="parameters" label="Parameters"/);
  assert.match(nodeModalSource, /<TabButton id="settings" label="Settings"/);
  assert.match(nodeModalSource, /label="HTTP Method"/);
  assert.match(nodeModalSource, /label="URL"/);
});

test('NodeModal updates HTTP method button selection through React state', () => {
  assert.match(nodeModalSource, /const \[methodValue, setMethodValue\] = useState\(initialConfig\.method \|\| 'GET'\)/);
  assert.match(nodeModalSource, /const nextMethod = initialConfig\.method \|\| 'GET'/);
  assert.match(nodeModalSource, /setMethodValue\(method\)/);
  assert.match(nodeModalSource, /variant=\{methodValue === method \? 'primary' : 'ghost'\}/);
});

test('NodeModal keeps the legacy request text fields in a single Parameters form', () => {
  assert.match(nodeModalSource, /label="Query Parameters"/);
  assert.match(nodeModalSource, /label="Headers"/);
  assert.match(nodeModalSource, /label="Cookies"/);
  assert.match(nodeModalSource, /label="Request Body"/);
  assert.match(nodeModalSource, /hint="JSON format supported"/);
});

test('NodeModal uses the BeautifyButton request body editor', () => {
  assert.match(nodeModalSource, /import \{ BeautifyButton \} from '\.\/molecules';/);
  assert.match(nodeModalSource, /<BeautifyButton/);
  assert.match(nodeModalSource, /const \[bodyValue, setBodyValue\]/);
  assert.match(nodeModalSource, /const bodyRef = useRef/);
  assert.doesNotMatch(nodeModalSource, /RequestBodyEditor/);
  assert.doesNotMatch(nodeModalSource, /handleBodyConfigChange/);
});

test('NodeModal restores the compact node name section', () => {
  assert.match(nodeModalSource, /Node Name/);
  assert.match(nodeModalSource, /placeholder="Enter node name"/);
  assert.doesNotMatch(nodeModalSource, /Node ID/);
  assert.doesNotMatch(nodeModalSource, /Use a short action label/);
});

test('NodeModal renders HttpRequestOutputPanel for HTTP request nodes', () => {
  assert.match(
    nodeModalSource,
    /\{node\.type === 'http-request' \? \(\s*<HttpRequestOutputPanel/s,
  );
  assert.match(
    nodeModalSource,
    /<HttpRequestOutputPanel\s+node=\{node\}[\s\S]*initialConfig=\{\(node\.data\.config \|\| \{\}\) as HTTPRequestConfigType\}[\s\S]*output=\{\(node\.data\?\.executionResult as Record<string, unknown> \| null\) \|\| null\}/,
  );
});

test('NodeModal renders NodeOutputPanel for non-HTTP nodes', () => {
  assert.match(nodeModalSource, /\) : \(\s*<NodeOutputPanel/s);
  assert.match(
    nodeModalSource,
    /<NodeOutputPanel\s+output=\{\(node\.data\?\.executionResult as Record<string, unknown> \| null\) \|\| null\}/,
  );
});

test('HttpRequestOutputPanel mounts ResponseInspector when output exists', () => {
  assert.match(nodeModalSource, /\{output && node\.type === 'http-request' && \(/);
  assert.match(nodeModalSource, /<ResponseInspector\s+response=\{response\}/);
  assert.match(nodeModalSource, /\{\.\.\.\(metadata \? \{ metadata \} : \{\}\)\}/);
  assert.match(nodeModalSource, /\{\.\.\.\(rawBody !== undefined \? \{ rawBody \} : \{\}\)\}/);
});

test('NodeModal keeps the output column shrinkable for scrollable inspectors', () => {
  assert.match(
    nodeModalSource,
    /<div className="flex h-full min-h-0 flex-col">\s*\{node\.type === 'http-request' \?/,
  );
});

test('Output panels preserve empty state contract when execution output is missing', () => {
  assert.match(nodeModalSource, /\{!output && \(/);
  assert.match(nodeModalSource, /\{!output \? \(/);
  assert.match(nodeModalSource, /Execute this node to view data/);
});
