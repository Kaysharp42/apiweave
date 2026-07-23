import { test } from "vitest";
import assert from "node:assert/strict";
import React, { type Dispatch, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiResponse, NodeResultMetadata } from "../../types";

type ResponseInspectorTab =
  | "tree"
  | "raw"
  | "headers"
  | "cookies"
  | "preview"
  | "timing";

let forcedTab: ResponseInspectorTab | undefined;
let useStateCallCount = 0;

const assertIncludes = (markup: string, expected: string): void => {
  assert.ok(
    markup.includes(expected),
    `Expected markup to include ${expected}: ${markup}`,
  );
};

type ReactDispatcher = Record<string, unknown> & {
  useState<State>(
    initialState: State | (() => State),
  ): [State, Dispatch<SetStateAction<State>>];
};

const documentStub: Record<string, unknown> = {
  head: {
    appendChild: (): void => undefined,
    insertAdjacentElement: (): void => undefined,
  },
  documentElement: {
    style: {
      setProperty: (): void => undefined,
    },
  },
  createElement: () => ({
    appendChild: (): void => undefined,
    insertAdjacentElement: (): void => undefined,
    setAttribute: (): void => undefined,
    // React 18's renderToStaticMarkup calls getVendorPrefixedEventName which
    // does 'WebkitAnimation' in <created-div>.style; the empty object lets
    // every `in` check return false without throwing.
    style: {},
    styleSheet: { cssText: "" },
  }),
  createTextNode: (text: string) => ({ text }),
  getElementsByTagName: (tagName: string) =>
    tagName === "head" ? [documentStub.head] : [],
};

Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: documentStub,
});

const reactInternals = (
  React as typeof React & {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      ReactCurrentDispatcher: { current: ReactDispatcher | null };
    };
  }
).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

const reactCurrentDispatcher = reactInternals.ReactCurrentDispatcher;
const originalDispatcherDescriptor = Object.getOwnPropertyDescriptor(
  reactCurrentDispatcher,
  "current",
);

const installForcedTabDispatcher = (): (() => void) => {
  const originalDispatcherValue = reactCurrentDispatcher.current;
  let currentDispatcher: ReactDispatcher | null = originalDispatcherValue;

  Object.defineProperty(reactCurrentDispatcher, "current", {
    configurable: true,
    get: () => currentDispatcher,
    set: (nextDispatcher: ReactDispatcher | null) => {
      if (nextDispatcher === null || forcedTab === undefined) {
        currentDispatcher = nextDispatcher;
        return;
      }

      const originalDispatcherUseState =
        nextDispatcher.useState.bind(nextDispatcher);
      currentDispatcher = {
        ...nextDispatcher,
        useState<State>(
          initialState: State | (() => State),
        ): [State, Dispatch<SetStateAction<State>>] {
          useStateCallCount += 1;

          if (useStateCallCount === 1) {
            return [forcedTab as State, () => undefined];
          }

          return originalDispatcherUseState(initialState);
        },
      };
    },
  });

  return () => {
    if (originalDispatcherDescriptor) {
      Object.defineProperty(
        reactCurrentDispatcher,
        "current",
        originalDispatcherDescriptor,
      );
      reactCurrentDispatcher.current = originalDispatcherValue;
    }
  };
};

const { ResponseInspector } = await import("./ResponseInspector");

const renderInspector = (
  response: ApiResponse | null,
  options: {
    activeTab?: ResponseInspectorTab;
    metadata?: NodeResultMetadata;
    rawBody?: string;
  } = {},
): string => {
  forcedTab = options.activeTab;
  useStateCallCount = 0;
  const restoreDispatcher = options.activeTab
    ? installForcedTabDispatcher()
    : () => undefined;

  try {
    return renderToStaticMarkup(
      React.createElement(ResponseInspector, {
        response,
        ...(options.metadata ? { metadata: options.metadata } : {}),
        ...(options.rawBody !== undefined ? { rawBody: options.rawBody } : {}),
      }),
    );
  } finally {
    restoreDispatcher();
    forcedTab = undefined;
    useStateCallCount = 0;
  }
};

const createMetadata = (
  overrides: Partial<NodeResultMetadata> = {},
): NodeResultMetadata => ({
  responseSizeBytes: 64,
  contentType: "application/json",
  bodyFormat: "json",
  responseTimeMs: 42,
  cookieCount: 0,
  redirectCount: 0,
  ...overrides,
});

const createResponse = (overrides: Partial<ApiResponse> = {}): ApiResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: { ok: true },
  responseTime: 38,
  ...overrides,
});

test("ResponseInspector renders all six response tabs", () => {
  const markup = renderInspector(createResponse());

  ["Tree", "Raw", "Headers", "Cookies", "Preview", "Timing"].forEach(
    (label) => {
      assertIncludes(markup, label);
    },
  );

  ["tree", "raw", "headers", "cookies", "preview", "timing"].forEach((key) => {
    assertIncludes(markup, `aria-controls="panel-tab-${key}"`);
  });
});

test("ResponseInspector renders refreshed empty state when no response exists", () => {
  const markup = renderInspector(null);

  assertIncludes(markup, "Response inspector");
  assertIncludes(markup, "No response captured yet");
  assertIncludes(markup, "Run this HTTP node and select a completed execution");
});

test("ResponseInspector renders response summary header with status, content-type, and response-time chip", () => {
  const markup = renderInspector(
    createResponse({
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" },
      responseTime: 88,
    }),
    { metadata: createMetadata({ responseTimeMs: 135 }) },
  );

  assertIncludes(markup, ">201<");
  assertIncludes(markup, "application/json");
  assertIncludes(markup, "135 ms");
  assertIncludes(markup, "Auto tab");
});

test("ResponseInspector tree tab renders nested JSON data as a collapsible object viewer", () => {
  const markup = renderInspector(
    createResponse({
      body: {
        user: {
          id: 7,
          profile: { name: "Ada Lovelace" },
        },
        roles: ["admin", "editor"],
      },
    }),
    { activeTab: "tree" },
  );

  assertIncludes(markup, "Response body tree");
  assertIncludes(markup, "panel-tab-tree");
  assertIncludes(
    markup,
    'role="tabpanel" class="flex flex-1 min-h-0 flex-col gap-4"',
  );
  assertIncludes(markup, "rounded-sm border border-border");
});

test("ResponseInspector preview tab renders HTML in a sandboxed iframe", () => {
  const htmlBody =
    "<main><h1>Preview</h1><script>window.parent.hacked = true</script></main>";
  const markup = renderInspector(
    createResponse({
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: htmlBody,
    }),
    { activeTab: "preview", rawBody: htmlBody },
  );

  assertIncludes(markup, "HTML preview");
  assertIncludes(markup, "<iframe");
  assertIncludes(markup, 'title="Response HTML preview"');
  assertIncludes(markup, 'sandbox=""');
  assertIncludes(markup, "srcDoc=");
  assertIncludes(markup, "&lt;main&gt;&lt;h1&gt;Preview&lt;/h1&gt;");
});

test("ResponseInspector timing tab displays metadata timing and response size accurately", () => {
  const markup = renderInspector(
    createResponse({ responseTime: 91, body: { message: "ok" } }),
    {
      activeTab: "timing",
      metadata: createMetadata({
        responseTimeMs: 123,
        responseSizeBytes: 1536,
      }),
    },
  );

  assertIncludes(markup, "Response time");
  assertIncludes(markup, "123 ms");
  assertIncludes(markup, "Duration");
  assertIncludes(markup, "91 ms");
  assertIncludes(markup, "Request size");
  assertIncludes(markup, "Not captured");
  assertIncludes(markup, "Response size");
  assertIncludes(markup, "1.5 KB");
});

test("ResponseInspector chooses the default tab from Content-Type and body format", () => {
  const jsonMarkup = renderInspector(
    createResponse({ headers: { "content-type": "application/vnd.api+json" } }),
  );
  assertIncludes(jsonMarkup, "Response body tree");

  const htmlMarkup = renderInspector(
    createResponse({
      headers: { "content-type": "text/html" },
      body: "<p>Hello</p>",
    }),
  );
  assertIncludes(htmlMarkup, "HTML preview");

  const imageMarkup = renderInspector(
    createResponse({
      headers: { "content-type": "image/png" },
      body: "iVBORw0KGgo=",
    }),
  );
  assertIncludes(imageMarkup, "Image preview");
  assertIncludes(imageMarkup, "data:image/png;base64,iVBORw0KGgo=");

  const metadataMarkup = renderInspector(
    createResponse({
      headers: {},
      body: "<strong>metadata html</strong>",
    }),
    {
      metadata: createMetadata({
        contentType: "text/html",
        bodyFormat: "html",
      }),
    },
  );
  assertIncludes(metadataMarkup, "HTML preview");
});

test("ResponseInspector renders legacy response shapes without metadata", () => {
  const legacyResponse = createResponse({
    headers: {
      "Content-Type": "text/plain",
      "Set-Cookie":
        "sid=abc; Secure; HttpOnly; Path=/, theme=dark; SameSite=Lax",
    },
    body: "legacy body",
    responseTime: 17,
  });

  const headersMarkup = renderInspector(legacyResponse, {
    activeTab: "headers",
  });
  assertIncludes(headersMarkup, "Headers (2)");
  assertIncludes(headersMarkup, "Content-Type");
  assertIncludes(headersMarkup, "text/plain");

  const cookiesMarkup = renderInspector(legacyResponse, {
    activeTab: "cookies",
  });
  assertIncludes(cookiesMarkup, "Cookies (2)");
  assertIncludes(cookiesMarkup, "sid");
  assertIncludes(cookiesMarkup, "Secure");
  assertIncludes(cookiesMarkup, "HttpOnly");
  assertIncludes(cookiesMarkup, "theme");
  assertIncludes(cookiesMarkup, "SameSite=Lax");
});

test("ResponseInspector falls back to text preview for non-JSON text responses", () => {
  const markup = renderInspector(
    createResponse({
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "plain text payload",
    }),
    { activeTab: "preview" },
  );

  assertIncludes(markup, "Text preview");
  assertIncludes(markup, "plain text payload");
});

test("ResponseInspector renders error status contract in summary bar", () => {
  const markup = renderInspector(
    createResponse({
      status: 503,
      headers: { "content-type": "application/json" },
      body: { error: "upstream unavailable" },
    }),
  );

  assertIncludes(markup, ">503<");
  assertIncludes(markup, "application/json");
});

test("ResponseInspector dark-mode detection path renders without errors in SSR env", () => {
  const markup = renderInspector(createResponse());

  assertIncludes(markup, "Response body tree");
});

test("ResponseInspector renders structured persisted cookies without Set-Cookie headers", () => {
  const structuredResponse = createResponse({
    headers: { "content-type": "application/json" },
    cookies: [
      {
        name: "session",
        value: "abc123",
        attributes: {
          HttpOnly: true,
          Secure: true,
          Path: "/",
          SameSite: "Lax",
        },
      },
      {
        name: "theme",
        value: "dark",
        attributes: {
          Path: "/",
          Domain: "example.com",
          Expires: "Wed, 21 Oct 2026 07:28:00 GMT",
        },
      },
    ],
  });

  const cookiesMarkup = renderInspector(structuredResponse, {
    activeTab: "cookies",
  });

  assertIncludes(cookiesMarkup, "Cookies (2)");
  assertIncludes(cookiesMarkup, "session");
  assertIncludes(cookiesMarkup, "abc123");
  assertIncludes(cookiesMarkup, "HttpOnly");
  assertIncludes(cookiesMarkup, "Secure");
  assertIncludes(cookiesMarkup, "Path=/");
  assertIncludes(cookiesMarkup, "SameSite=Lax");
  assertIncludes(cookiesMarkup, "theme");
  assertIncludes(cookiesMarkup, "Domain=example.com");
  assertIncludes(cookiesMarkup, "Expires=Wed, 21 Oct 2026 07:28:00 GMT");
});
