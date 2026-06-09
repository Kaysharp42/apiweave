import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const nodeModalSource = readFileSync(join(process.cwd(), 'src/components/NodeModal.tsx'), 'utf8');
const httpRequestConfigSource = readFileSync(join(process.cwd(), 'src/components/node-modal/HTTPRequestConfigPanel.tsx'), 'utf8');
const httpRequestOutputSource = readFileSync(join(process.cwd(), 'src/components/node-modal/HttpRequestOutputPanel.tsx'), 'utf8');
const nodeOutputSource = readFileSync(join(process.cwd(), 'src/components/node-modal/NodeOutputPanel.tsx'), 'utf8');

test('NodeModal uses the Modal molecule for focus trapping and Escape key handling', () => {
  assert.match(nodeModalSource, /import \{ Modal \} from '\.\/molecules\/Modal'/);
  assert.match(nodeModalSource, /<Modal/);
  assert.match(nodeModalSource, /isOpen=\{open\}/);
  assert.match(nodeModalSource, /onClose=\{handleClose\}/);
});

test('NodeModal delegates HTTP request config to HTTPRequestConfigPanel', () => {
  assert.match(nodeModalSource, /import \{ HTTPRequestConfigPanel/);
  assert.match(nodeModalSource, /<HTTPRequestConfigPanel/);
});

test('NodeModal delegates HTTP output to HttpRequestOutputPanel', () => {
  assert.match(nodeModalSource, /import \{.*HttpRequestOutputPanel/);
  assert.match(nodeModalSource, /<HttpRequestOutputPanel/);
});

test('NodeModal delegates non-HTTP output to NodeOutputPanel', () => {
  assert.match(nodeModalSource, /import \{.*NodeOutputPanel/);
  assert.match(nodeModalSource, /<NodeOutputPanel/);
});

test('NodeModal delegates assertion config to AssertionConfigPanel', () => {
  assert.match(nodeModalSource, /import \{.*AssertionConfigPanel/);
  assert.match(nodeModalSource, /<AssertionConfigPanel/);
});

test('NodeModal delegates delay config to DelayConfigPanel', () => {
  assert.match(nodeModalSource, /import \{.*DelayConfigPanel/);
  assert.match(nodeModalSource, /<DelayConfigPanel/);
});

test('NodeModal delegates merge config to MergeConfigPanel', () => {
  assert.match(nodeModalSource, /import \{.*MergeConfigPanel/);
  assert.match(nodeModalSource, /<MergeConfigPanel/);
});

test('HTTPRequestConfigPanel uses PanelTabs for Parameters and Settings', () => {
  assert.match(httpRequestConfigSource, /import \{ PanelTabs \} from '\.\.\/molecules\/PanelTabs'/);
  assert.match(httpRequestConfigSource, /\{ key: 'parameters', label: 'Parameters' \}/);
  assert.match(httpRequestConfigSource, /\{ key: 'settings', label: 'Settings' \}/);
  assert.match(httpRequestConfigSource, /label="HTTP Method"/);
  assert.match(httpRequestConfigSource, /label="URL"/);
});

test('HTTPRequestConfigPanel updates HTTP method button selection through React state', () => {
  assert.match(httpRequestConfigSource, /const \[methodValue, setMethodValue\] = useState\(initialConfig\.method \|\| 'GET'\)/);
  assert.match(httpRequestConfigSource, /setMethodValue\(method\)/);
  assert.match(httpRequestConfigSource, /variant=\{methodValue === method \? 'primary' : 'ghost'\}/);
});

test('HTTPRequestConfigPanel keeps the legacy request text fields in a single Parameters form', () => {
  assert.match(httpRequestConfigSource, /label="Query Parameters"/);
  assert.match(httpRequestConfigSource, /label="Headers"/);
  assert.match(httpRequestConfigSource, /label="Cookies"/);
  assert.match(httpRequestConfigSource, /label="Request Body"/);
  assert.match(httpRequestConfigSource, /hint="JSON format supported"/);
});

test('HTTPRequestConfigPanel uses the BeautifyButton request body editor', () => {
  assert.match(httpRequestConfigSource, /import \{ BeautifyButton \} from '\.\.\/molecules\/BeautifyButton'/);
  assert.match(httpRequestConfigSource, /<BeautifyButton/);
  assert.match(httpRequestConfigSource, /const \[bodyValue, setBodyValue\]/);
  assert.match(httpRequestConfigSource, /const bodyRef = useRef/);
  assert.doesNotMatch(httpRequestConfigSource, /RequestBodyEditor/);
  assert.doesNotMatch(httpRequestConfigSource, /handleBodyConfigChange/);
});

test('NodeModal restores the compact node name section', () => {
  assert.match(nodeModalSource, /NodeModalHeader/);
  const headerSource = readFileSync(join(process.cwd(), 'src/components/node-modal/NodeModalHeader.tsx'), 'utf8');
  assert.match(headerSource, /Node Name/);
  assert.match(headerSource, /placeholder="Enter node name"/);
  assert.doesNotMatch(headerSource, /Node ID/);
  assert.doesNotMatch(headerSource, /Use a short action label/);
});

test('HttpRequestOutputPanel mounts ResponseInspector when output exists', () => {
  assert.match(httpRequestOutputSource, /\{output && node\.type === 'http-request' && \(/);
  assert.match(httpRequestOutputSource, /<ResponseInspector/);
  assert.match(httpRequestOutputSource, /response=\{response\}/);
  assert.match(httpRequestOutputSource, /\{\.\.\.\(metadata \? \{ metadata \} : \{\}\)\}/);
  assert.match(httpRequestOutputSource, /\{\.\.\.\(rawBody !== undefined \? \{ rawBody \} : \{\}\)\}/);
});

test('NodeModal keeps the output column shrinkable for scrollable inspectors', () => {
  assert.match(nodeModalSource, /xl:basis-\[44%\]/);
  assert.match(nodeModalSource, /min-h-0/);
});

test('Output panels preserve empty state contract when execution output is missing', () => {
  assert.match(httpRequestOutputSource, /\{!output && \(/);
  assert.match(nodeOutputSource, /\{!output \? \(/);
  assert.match(httpRequestOutputSource, /Execute this node to view data/);
  assert.match(nodeOutputSource, /Execute this node to view data/);
});

test('NodeModal types are barrel-exported from types/index.ts', () => {
  const typesIndex = readFileSync(join(process.cwd(), 'src/types/index.ts'), 'utf8');
  assert.match(typesIndex, /NodeModalNodeType/);
  assert.match(typesIndex, /NodeModalNode/);
  assert.match(typesIndex, /NodeModalData/);
  assert.match(typesIndex, /NodeModalHTTPRequestConfig/);
  assert.match(typesIndex, /NodeModalMergeConfig/);
  assert.match(typesIndex, /MergeConditionType/);
  assert.match(typesIndex, /NodeModalProps/);
  assert.match(typesIndex, /HTTPRequestConfigPanelProps/);
  assert.match(typesIndex, /HttpRequestOutputPanelProps/);
  assert.match(typesIndex, /NodeOutputPanelProps/);
  assert.match(typesIndex, /AssertionConfigPanelProps/);
  assert.match(typesIndex, /DelayConfigPanelProps/);
  assert.match(typesIndex, /MergeConfigPanelProps/);
});

test('NodeModal uses Modal molecule with focus trapping', () => {
  assert.match(nodeModalSource, /<Modal/);
  assert.match(nodeModalSource, /isOpen=\{open\}/);
  assert.match(nodeModalSource, /onClose=\{handleClose\}/);
  assert.match(nodeModalSource, /initialFocus=\{nameLabelRef\}/);
});

test('NodeModal uses CSS variable tokens for colors', () => {
  assert.match(httpRequestOutputSource, /var\(--aw-status-info\)/);
  assert.match(httpRequestOutputSource, /var\(--aw-primary\)/);
});

test('NodeModal uses focus-visible outlines on interactive elements', () => {
  const headerSource = readFileSync(join(process.cwd(), 'src/components/node-modal/NodeModalHeader.tsx'), 'utf8');
  assert.match(headerSource, /focus-visible:outline-2/);
  assert.match(headerSource, /focus-visible:outline-\[var\(--aw-primary\)\]/);
});

test('NodeModal uses cursor-pointer on clickable elements', () => {
  const footerSource = readFileSync(join(process.cwd(), 'src/components/node-modal/NodeModalFooter.tsx'), 'utf8');
  assert.match(footerSource, /cursor-pointer/);
});