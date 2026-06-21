import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "vitest";

const nodeModalSource = readFileSync(
  join(process.cwd(), "src/components/NodeModal.tsx"),
  "utf8",
);
const httpRequestConfigSource = readFileSync(
  join(process.cwd(), "src/components/node-modal/HTTPRequestConfigPanel.tsx"),
  "utf8",
);
const httpRequestOutputSource = readFileSync(
  join(process.cwd(), "src/components/node-modal/HttpRequestOutputPanel.tsx"),
  "utf8",
);
const nodeModalShellSource = readFileSync(
  join(process.cwd(), "src/components/node-modal/NodeModalShell.tsx"),
  "utf8",
);
const nodeOutputSource = readFileSync(
  join(process.cwd(), "src/components/node-modal/NodeOutputPanel.tsx"),
  "utf8",
);
const badgeSource = readFileSync(
  join(process.cwd(), "src/components/atoms/Badge.tsx"),
  "utf8",
);

test("NodeModal uses the Modal molecule for focus trapping and Escape key handling", () => {
  assert.match(
    nodeModalShellSource,
    /import \{ Modal \} from '\.\.\/molecules\/Modal'/,
  );
  assert.match(nodeModalShellSource, /<Modal/);
  assert.match(nodeModalShellSource, /isOpen=\{open\}/);
  assert.match(nodeModalShellSource, /onClose=\{onClose\}/);
  assert.match(nodeModalSource, /<NodeModalShell/);
  assert.match(nodeModalSource, /onClose=\{handleClose\}/);
});

test("NodeModal delegates HTTP request config to HTTPRequestConfigPanel", () => {
  assert.match(nodeModalSource, /import \{ HTTPRequestConfigPanel/);
  assert.match(nodeModalSource, /<HTTPRequestConfigPanel/);
});

test("NodeModal delegates HTTP output to HttpRequestOutputPanel", () => {
  assert.match(nodeModalSource, /import \{.*HttpRequestOutputPanel/);
  assert.match(nodeModalSource, /<HttpRequestOutputPanel/);
});

test("NodeModal delegates non-HTTP output to NodeOutputPanel", () => {
  assert.match(nodeModalSource, /import \{.*NodeOutputPanel/);
  assert.match(nodeModalSource, /<NodeOutputPanel/);
});

test("NodeModal delegates assertion config to AssertionConfigPanel", () => {
  assert.match(nodeModalSource, /import \{.*AssertionConfigPanel/);
  assert.match(nodeModalSource, /<AssertionConfigPanel/);
});

test("NodeModal delegates delay config to DelayConfigPanel", () => {
  assert.match(nodeModalSource, /import \{.*DelayConfigPanel/);
  assert.match(nodeModalSource, /<DelayConfigPanel/);
});

test("NodeModal delegates merge config to MergeConfigPanel", () => {
  assert.match(nodeModalSource, /import \{.*MergeConfigPanel/);
  assert.match(nodeModalSource, /<MergeConfigPanel/);
});

test("NodeModal exposes HTTP request sections and request bar controls", () => {
  assert.match(nodeModalSource, /\{ key: 'params', label: 'Params'/);
  assert.match(nodeModalSource, /\{ key: 'settings', label: 'Settings'/);
  assert.match(httpRequestConfigSource, /<FormField label="Params"/);
  assert.match(nodeModalSource, /HTTP_METHODS\.map\(\(method\)/);
  assert.match(nodeModalSource, /aria-label="Request URL"/);
});

test("HTTPRequestConfigPanel updates HTTP method button selection through React state", () => {
  assert.match(nodeModalSource, /const \[httpConfig, setHttpConfig\]/);
  assert.match(nodeModalSource, /patchHttpConfig\(\{ method \}\)/);
  assert.match(
    nodeModalSource,
    /variant=\{httpConfig\.method === method \? 'primary' : 'ghost'\}/,
  );
});

test("HTTPRequestConfigPanel keeps request parameter, header, cookie, and body editors", () => {
  assert.match(httpRequestConfigSource, /title="Query parameters"/);
  assert.match(httpRequestConfigSource, /title="Headers"/);
  assert.match(httpRequestConfigSource, /title="Cookies"/);
  assert.match(httpRequestConfigSource, /title="Request body"/);
  assert.match(httpRequestConfigSource, /label="JSON body"/);
});

test("HTTPRequestConfigPanel uses the BeautifyButton request body editor", () => {
  assert.match(
    httpRequestConfigSource,
    /import \{ BeautifyButton \} from '\.\.\/molecules\/BeautifyButton'/,
  );
  assert.match(httpRequestConfigSource, /<BeautifyButton/);
  assert.match(httpRequestConfigSource, /value=\{draftConfig\.body \|\| ''\}/);
  assert.match(
    httpRequestConfigSource,
    /onChange=\{\(body\) => updateConfig\(\{ body \}\)\}/,
  );
  assert.doesNotMatch(httpRequestConfigSource, /RequestBodyEditor/);
  assert.doesNotMatch(httpRequestConfigSource, /handleBodyConfigChange/);
});

test("NodeModal restores the compact node name section", () => {
  assert.match(nodeModalSource, /<NodeModalShell/);
  assert.match(nodeModalShellSource, /<Dialog\.Title/);
  assert.match(nodeModalShellSource, /aria-label="Node name"/);
  assert.match(nodeModalShellSource, /placeholder="Enter node name"/);
  assert.doesNotMatch(nodeModalShellSource, /Node ID/);
  assert.doesNotMatch(nodeModalShellSource, /Use a short action label/);
});

test("HttpRequestOutputPanel mounts ResponseInspector when output exists", () => {
  assert.match(
    httpRequestOutputSource,
    /if \(!output \|\| node\.type !== 'http-request'\) \{/,
  );
  assert.match(httpRequestOutputSource, /<ResponseInspector/);
  assert.match(httpRequestOutputSource, /response=\{response\}/);
  assert.match(
    httpRequestOutputSource,
    /\{\.\.\.\(metadata \? \{ metadata \} : \{\}\)\}/,
  );
  assert.match(
    httpRequestOutputSource,
    /\{\.\.\.\(rawBody !== undefined \? \{ rawBody \} : \{\}\)\}/,
  );
});

test("NodeModal keeps the output column shrinkable for scrollable inspectors", () => {
  assert.match(
    nodeModalShellSource,
    /<Allotment\.Pane minSize=\{340\} preferredSize="42%">/,
  );
  assert.match(nodeModalShellSource, /<NodeModalResponsePane/);
  assert.match(nodeModalShellSource, /min-h-0/);
});

test("Output panels preserve empty state contract when execution output is missing", () => {
  assert.match(
    httpRequestOutputSource,
    /if \(!output \|\| node\.type !== 'http-request'\) \{/,
  );
  assert.match(nodeOutputSource, /\{isEmptyOutput\(output\) \? \(/);
  assert.match(httpRequestOutputSource, /Execute this node to view data/);
  assert.match(nodeOutputSource, /Run the workflow to see results here\./);
});

test("NodeModal types are barrel-exported from types/index.ts", () => {
  const typesIndex = readFileSync(
    join(process.cwd(), "src/types/index.ts"),
    "utf8",
  );
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

test("NodeModal uses Modal molecule with focus trapping", () => {
  assert.match(nodeModalShellSource, /<Modal/);
  assert.match(nodeModalShellSource, /isOpen=\{open\}/);
  assert.match(nodeModalShellSource, /onClose=\{onClose\}/);
  assert.match(
    nodeModalShellSource,
    /\{\.\.\.\(initialFocus && \{ initialFocus \}\)\}/,
  );
  assert.match(
    nodeModalSource,
    /const nameLabelRef = useRef<HTMLElement \| null>\(null\)/,
  );
  assert.match(nodeModalSource, /initialFocus=\{nameLabelRef\}/);
});

test("NodeModal uses CSS variable tokens for colors", () => {
  assert.match(httpRequestOutputSource, /statusVariant\(statusCode\)/);
  assert.match(badgeSource, /var\(--aw-status-info\)/);
});

test("NodeModal uses focus-visible outlines on interactive elements", () => {
  const headerSource = readFileSync(
    join(process.cwd(), "src/components/node-modal/NodeModalHeader.tsx"),
    "utf8",
  );
  assert.match(headerSource, /focus-visible:outline-2/);
  assert.match(headerSource, /focus-visible:outline-\[var\(--aw-primary\)\]/);
});

test("NodeModal uses cursor-pointer on clickable elements", () => {
  const footerSource = readFileSync(
    join(process.cwd(), "src/components/node-modal/NodeModalFooter.tsx"),
    "utf8",
  );
  assert.match(footerSource, /cursor-pointer/);
});
