/**
 * Deterministic product fixtures for the marketing capture scenes.
 *
 * Every value here is synthetic: `api.shop.dev` is not a real host, the secret
 * is a *reference* (`{{secrets.QA_PASSWORD}}`) and never a value, and both runs
 * are shapes the executor really produces — see `core/runner/executor.ts` for
 * the assertion evaluation fields and `shared/zod-schemas/RunSchema.ts` for the
 * run envelope.
 *
 * The graph is the one workflow the whole media set is composed from. Two
 * variants exist because the agent-repair story needs a *before*:
 *
 *   - `CHECKOUT_WORKFLOW` — the fail handle of `Cart total matches` is wired
 *     into `Merge`. Used by every scene except the opening state of
 *     `agent-repair`.
 *   - `CHECKOUT_WORKFLOW_UNWIRED` — the same graph with that one edge removed,
 *     which is what makes `Merge` and `End` stay pending on a failing run and
 *     is exactly what `workflow_diagnose` reports as `nodes_not_executed`.
 *
 * Leaving a fail handle unwired is legal — the graph analyzer emits no
 * diagnostic for it — so the *before* graph is a truthful product state rather
 * than a broken fixture.
 */

const WORKSPACE_ID = "workspace-personal";
const WORKFLOW_ID = "workflow-checkout-regression";
const STAGING_ENVIRONMENT_ID = "environment-staging";

/** Frozen so nothing in a capture can show a wall clock or a relative date. */
const T0 = "2026-03-02T09:12:00.000Z";

export const CAPTURE_WORKSPACE = {
  workspaceId: WORKSPACE_ID,
  slug: "personal",
  name: "Personal",
  description: "Local workspace",
  isPersonal: true,
  origin: "local",
  syncMode: "local_only",
  rev: 0,
  createdAt: T0,
  updatedAt: T0,
} as const;

export const CAPTURE_ENVIRONMENT = {
  environmentId: STAGING_ENVIRONMENT_ID,
  workspaceId: WORKSPACE_ID,
  name: "Staging",
  description: "Synthetic staging endpoints",
  swaggerDocUrl: null,
  baseEnvironmentId: null,
  variables: { BASE_URL: "https://api.shop.dev", CART_ID: "cart_7f31" },
  secrets: {},
  isDefault: true,
  scopeType: "workspace",
  scopeId: WORKSPACE_ID,
  rev: 3,
  createdAt: T0,
  updatedAt: T0,
} as const;

/** Names only. A capture that showed a value would fail `validate.mjs`. */
export const CAPTURE_SECRETS = [
  {
    name: "QA_PASSWORD",
    scopeType: "environment",
    scopeId: STAGING_ENVIRONMENT_ID,
    workspaceId: WORKSPACE_ID,
    label: "Staging QA login",
    keyId: "key-staging-1",
    rev: 1,
    createdAt: T0,
    updatedAt: T0,
  },
] as const;

const LOGIN_BODY =
  '{\n  "email": "qa@shop.dev",\n  "password": "{{secrets.QA_PASSWORD}}"\n}';

const NODES = [
  {
    nodeId: "start",
    type: "start",
    label: "Start",
    position: { x: 0, y: 260 },
    config: {},
  },
  {
    nodeId: "login",
    type: "http-request",
    label: "Login",
    position: { x: 200, y: 240 },
    config: {
      method: "POST",
      url: "{{env.BASE_URL}}/auth/login",
      queryParams: [],
      headers: [{ key: "Content-Type", value: "application/json" }],
      cookies: [],
      bodyType: "json",
      body: LOGIN_BODY,
      timeout: 30,
      followRedirects: true,
      sslVerify: true,
      continueOnFail: false,
      extractors: { token: "response.body.access_token" },
    },
  },
  {
    nodeId: "token-issued",
    type: "assertion",
    label: "Token issued",
    position: { x: 580, y: -20 },
    config: {
      assertions: [
        {
          source: "prev",
          path: "response.body.access_token",
          operator: "exists",
        },
      ],
      failureMode: "first",
    },
  },
  {
    nodeId: "get-cart",
    type: "http-request",
    label: "Get cart",
    position: { x: 580, y: 500 },
    config: {
      method: "GET",
      url: "{{env.BASE_URL}}/carts/{{env.CART_ID}}",
      queryParams: [],
      headers: [
        { key: "Authorization", value: "Bearer {{variables.token}}" },
        { key: "Accept", value: "application/json" },
      ],
      cookies: [],
      bodyType: "none",
      timeout: 30,
      followRedirects: true,
      sslVerify: true,
      continueOnFail: false,
    },
  },
  {
    nodeId: "cart-total",
    type: "assertion",
    label: "Cart total matches",
    position: { x: 940, y: 500 },
    config: {
      assertions: [
        {
          source: "prev",
          path: "response.body.total",
          operator: "equals",
          expectedValue: 4200,
        },
      ],
      failureMode: "first",
    },
  },
  {
    nodeId: "alert",
    type: "http-request",
    label: "Post regression alert",
    position: { x: 940, y: 800 },
    config: {
      method: "POST",
      url: "{{env.BASE_URL}}/alerts",
      queryParams: [],
      headers: [{ key: "Content-Type", value: "application/json" }],
      cookies: [],
      bodyType: "json",
      body: '{\n  "workflow": "Checkout API regression",\n  "check": "Cart total matches"\n}',
      timeout: 30,
      followRedirects: true,
      sslVerify: true,
      continueOnFail: false,
    },
  },
  {
    nodeId: "merge",
    type: "merge",
    label: "Merge",
    position: { x: 1300, y: 240 },
    config: { mergeStrategy: "all" },
  },
  {
    nodeId: "end",
    type: "end",
    label: "End",
    position: { x: 1580, y: 420 },
    config: {},
  },
] as const;

const BASE_EDGES = [
  {
    edgeId: "e-start-login",
    source: "start",
    target: "login",
    sourceHandle: null,
    targetHandle: null,
    label: null,
  },
  {
    edgeId: "e-login-token",
    source: "login",
    target: "token-issued",
    sourceHandle: null,
    targetHandle: null,
    label: null,
  },
  {
    edgeId: "e-login-cart",
    source: "login",
    target: "get-cart",
    sourceHandle: null,
    targetHandle: null,
    label: null,
  },
  {
    edgeId: "e-token-merge",
    source: "token-issued",
    target: "merge",
    sourceHandle: "pass",
    targetHandle: null,
    label: null,
  },
  {
    edgeId: "e-cart-total",
    source: "get-cart",
    target: "cart-total",
    sourceHandle: null,
    targetHandle: null,
    label: null,
  },
  {
    edgeId: "e-total-merge",
    source: "cart-total",
    target: "merge",
    sourceHandle: "pass",
    targetHandle: null,
    label: null,
  },
  {
    edgeId: "e-merge-end",
    source: "merge",
    target: "end",
    sourceHandle: null,
    targetHandle: null,
    label: null,
  },
  {
    edgeId: "e-alert-end",
    source: "alert",
    target: "end",
    sourceHandle: null,
    targetHandle: null,
    label: null,
  },
] as const;

/**
 * The edge `workflows_patch` adds in the agent-repair scene.
 *
 * It reaches `Post regression alert` rather than `Merge` on purpose: `Merge`
 * runs the `all` strategy over the two parallel branches, and a conditional
 * fail handle joined into an `all` merge can never satisfy it. Routing the
 * failure to its own action and letting both outcomes reach the single `End`
 * node is the shape the product actually supports.
 */
export const FAIL_BRANCH_EDGE = {
  edgeId: "e-total-fail-alert",
  source: "cart-total",
  target: "alert",
  sourceHandle: "fail",
  targetHandle: null,
  label: null,
} as const;

function workflow(edges: readonly unknown[], rev: number) {
  return {
    workflowId: WORKFLOW_ID,
    workspaceId: WORKSPACE_ID,
    name: "Checkout API regression",
    description: "Login, read the cart, and check the total against staging.",
    nodes: NODES,
    edges,
    // Declared with an empty default and filled by `Login`'s extractor at run
    // time. The Variables panel lists declared variables, so this is what makes
    // `token` traceable through "Trace variable provenance".
    variables: { token: "" },
    tags: ["checkout"],
    collectionId: null,
    selectedEnvironmentId: STAGING_ENVIRONMENT_ID,
    nodeTemplates: [],
    rev,
    createdAt: T0,
    updatedAt: T0,
  } as const;
}

/** Repaired graph: the fail handle reaches `Merge`. rev 8 is post-patch. */
export const CHECKOUT_WORKFLOW = workflow([...BASE_EDGES, FAIL_BRANCH_EDGE], 8);

/** Pre-repair graph: no fail edge, so a failing run leaves `Merge`/`End` pending. */
export const CHECKOUT_WORKFLOW_UNWIRED = workflow(BASE_EDGES, 7);

export const CAPTURE_IDS = {
  workspaceId: WORKSPACE_ID,
  workflowId: WORKFLOW_ID,
  environmentId: STAGING_ENVIRONMENT_ID,
} as const;

const LOGIN_RESPONSE = {
  statusCode: 201,
  headers: { "content-type": "application/json", "x-request-id": "req_a41c9" },
  // Deliberately short and obviously synthetic: a stored HTTP response body is
  // *not* secret-redacted by the runner (only the request is), so the fixture
  // endpoint must not return anything that reads as a real credential.
  body: {
    access_token: "staging-demo-token",
    token_type: "Bearer",
    expires_in: 3600,
  },
  responseTimeMs: 214,
  responseSizeBytes: 168,
};

function cartResponse(total: number) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "x-request-id": "req_c8f02" },
    body: {
      cart_id: "cart_7f31",
      currency: "EUR",
      items: [
        { sku: "SHOP-114", qty: 2, unit_price: 1450 },
        { sku: "SHOP-207", qty: 1, unit_price: 1000 },
      ],
      total,
    },
    responseTimeMs: 96,
    responseSizeBytes: 214,
  };
}

const LOGIN_REQUEST = {
  method: "POST",
  url: "https://api.shop.dev/auth/login",
  headers: { "content-type": "application/json" },
  body: '{\n  "email": "qa@shop.dev",\n  "password": "<SECRET>"\n}',
};

const CART_REQUEST = {
  method: "GET",
  url: "https://api.shop.dev/carts/cart_7f31",
  headers: { authorization: "Bearer <SECRET>", accept: "application/json" },
  body: null,
};

/** `startedAt`/`completedAt` place the waterfall bars; the two branches overlap. */
const WINDOW = {
  login: ["2026-03-02T09:12:00.100Z", "2026-03-02T09:12:00.314Z"],
  tokenIssued: ["2026-03-02T09:12:00.318Z", "2026-03-02T09:12:00.322Z"],
  getCart: ["2026-03-02T09:12:00.320Z", "2026-03-02T09:12:00.416Z"],
  cartTotal: ["2026-03-02T09:12:00.420Z", "2026-03-02T09:12:00.426Z"],
  merge: ["2026-03-02T09:12:00.430Z", "2026-03-02T09:12:00.432Z"],
} as const;

const RESOLVED_SECRETS = [
  { name: "QA_PASSWORD", scopeType: "environment", resolved: true },
] as const;

function assertionEvaluation(
  path: string,
  operator: string,
  outcome: "pass" | "fail",
  sourceNodeId: string,
  expectedType: string | null,
  actualType: string | null,
) {
  return {
    ruleIndex: 0,
    source: "prev",
    path,
    operator,
    sourceNodeId,
    expectedState: operator === "exists" ? "not-required" : "literal",
    expectedType,
    actualState: "present",
    actualType,
    outcome,
    reasonCode: outcome === "pass" ? "passed" : "comparison-failed",
  };
}

/** The green run behind the hero, the master demo and the Assemble/Run stills. */
export const PASSING_RUN = {
  runId: "run-checkout-2026030201",
  workspaceId: WORKSPACE_ID,
  workflowId: WORKFLOW_ID,
  selectedEnvironmentId: STAGING_ENVIRONMENT_ID,
  status: "completed",
  trigger: "manual",
  variables: { token: "<SECRET>" },
  results: [
    {
      nodeId: "login",
      status: "passed",
      duration: 214,
      startedAt: WINDOW.login[0],
      completedAt: WINDOW.login[1],
      secretRefs: ["QA_PASSWORD"],
      request: LOGIN_REQUEST,
      response: LOGIN_RESPONSE,
      extractorOutcomes: [
        {
          producerNodeId: "login",
          variableName: "token",
          path: "response.body.access_token",
          matched: true,
          observedType: "string",
        },
      ],
    },
    {
      nodeId: "token-issued",
      status: "passed",
      duration: 4,
      startedAt: WINDOW.tokenIssued[0],
      completedAt: WINDOW.tokenIssued[1],
      assertions: [
        assertionEvaluation(
          "response.body.access_token",
          "exists",
          "pass",
          "login",
          null,
          "string",
        ),
      ],
    },
    {
      nodeId: "get-cart",
      status: "passed",
      duration: 96,
      startedAt: WINDOW.getCart[0],
      completedAt: WINDOW.getCart[1],
      request: CART_REQUEST,
      response: cartResponse(4200),
    },
    {
      nodeId: "cart-total",
      status: "passed",
      duration: 6,
      startedAt: WINDOW.cartTotal[0],
      completedAt: WINDOW.cartTotal[1],
      assertions: [
        assertionEvaluation(
          "response.body.total",
          "equals",
          "pass",
          "get-cart",
          "number",
          "number",
        ),
      ],
    },
    {
      nodeId: "merge",
      status: "passed",
      duration: 2,
      startedAt: WINDOW.merge[0],
      completedAt: WINDOW.merge[1],
    },
  ],
  startedAt: "2026-03-02T09:12:00.000Z",
  completedAt: "2026-03-02T09:12:00.440Z",
  duration: 440,
  error: null,
  failedNodes: [],
  failureMessage: null,
  nodeStatuses: {
    start: { status: "passed" },
    login: { status: "passed" },
    "token-issued": { status: "passed" },
    "get-cart": { status: "passed" },
    "cart-total": { status: "passed" },
    // The fail handle was not taken, so its branch never ran.
    alert: { status: "skipped" },
    merge: { status: "passed" },
    end: { status: "passed" },
  },
  resolvedSecrets: RESOLVED_SECRETS,
  rev: 1,
  createdAt: T0,
  updatedAt: T0,
} as const;

/**
 * The failing run behind the failure feature, the Inspect step and the
 * assertion/timeline atlas stills. `3900` is the *actual* value and lives only
 * in `Get cart`'s recorded response body — the product deliberately keeps
 * expected/actual out of the assertion evaluation (see
 * `AssertionEvaluationSchema`), so a still that must prove "expected 4200,
 * actual 3900" has to frame the assertion rule together with that response.
 */
export const FAILING_RUN = {
  ...PASSING_RUN,
  runId: "run-checkout-2026030202",
  status: "failed",
  results: [
    PASSING_RUN.results[0],
    PASSING_RUN.results[1],
    {
      ...PASSING_RUN.results[2],
      response: cartResponse(3900),
    },
    {
      nodeId: "cart-total",
      status: "failed",
      duration: 6,
      startedAt: WINDOW.cartTotal[0],
      completedAt: WINDOW.cartTotal[1],
      // `scheduler.ts` runs every stored result error through `safeErrorClass`,
      // so this is the string the product really persists. The rule-level
      // detail lives in `assertions` below, and the actual `3900` only in
      // `Get cart`'s response body.
      error: "Node execution failed",
      assertions: [
        assertionEvaluation(
          "response.body.total",
          "equals",
          "fail",
          "get-cart",
          "number",
          "number",
        ),
      ],
    },
    {
      nodeId: "alert",
      status: "passed",
      duration: 88,
      startedAt: "2026-03-02T09:12:00.430Z",
      completedAt: "2026-03-02T09:12:00.518Z",
      request: {
        method: "POST",
        url: "https://api.shop.dev/alerts",
        headers: { "content-type": "application/json" },
        body: '{\n  "workflow": "Checkout API regression",\n  "check": "Cart total matches"\n}',
      },
      response: {
        statusCode: 202,
        headers: { "content-type": "application/json" },
        body: { queued: true },
        responseTimeMs: 88,
        responseSizeBytes: 17,
      },
    },
  ],
  completedAt: "2026-03-02T09:12:00.530Z",
  duration: 530,
  // `safeFailureMessage` is what the run-level failure really reads.
  error: "Workflow execution failed in 1 node",
  failedNodes: ["cart-total"],
  failureMessage: "Workflow execution failed in 1 node",
  nodeStatuses: {
    start: { status: "passed" },
    login: { status: "passed" },
    "token-issued": { status: "passed" },
    "get-cart": { status: "passed" },
    "cart-total": { status: "failed" },
    alert: { status: "passed" },
    // `all` over both parallel branches: the checked branch stopped, so the
    // join never became satisfiable. This is what `nodes_not_executed` names.
    merge: { status: "pending" },
    end: { status: "passed" },
  },
} as const;

/**
 * The same failure on the *pre-repair* graph.
 *
 * With no edge on `Cart total matches`'s fail handle, the run stops there: the
 * alert never runs, `Merge` never becomes satisfiable, and `End` is never
 * reached. That is the state `workflow_diagnose` reports as `assertion_failed`
 * plus `nodes_not_executed`, and the state the agent-repair scene opens on.
 */
export const FAILING_RUN_UNWIRED = {
  ...FAILING_RUN,
  runId: "run-checkout-2026030203",
  results: FAILING_RUN.results.slice(0, 4),
  completedAt: "2026-03-02T09:12:00.430Z",
  duration: 430,
  nodeStatuses: {
    start: { status: "passed" },
    login: { status: "passed" },
    "token-issued": { status: "passed" },
    "get-cart": { status: "passed" },
    "cart-total": { status: "failed" },
    alert: { status: "pending" },
    merge: { status: "pending" },
    end: { status: "pending" },
  },
} as const;
