import type { TutorialChapter } from "../../types";

/**
 * Chapter 3 — Control flow. Assertions, snapshot and contract checks, delay
 * and merge, SSE streams, gRPC, WebSocket, SOAP and JSON-RPC, and calling
 * another workflow as a step.
 */
export const controlFlowChapter: TutorialChapter = {
  id: "control-flow",
  title: "Control flow",
  summary:
    "Branch on results, catch changed responses, pace and combine parallel work, listen to streams, call non-REST APIs, and reuse a workflow as a step.",
  lessons: [
    {
      id: "assertions",
      chapterId: "control-flow",
      title: "Assertions and negative tests",
      summary:
        "Sources, operators, pass/fail routing, failure modes, and asserting that an API rejects bad input.",
      outcome:
        "You can lock in an API contract with assertions and route the fail path somewhere useful.",
      keywords: [
        "assertion",
        "assert",
        "status",
        "headers",
        "cookies",
        "variables",
        "operator",
        "pass",
        "fail",
        "negative test",
        "expected status",
        "regex",
        "json schema",
        "jsonpath",
      ],
      durationMinutes: 7,
      prerequisites: ["A workflow with an HTTP Request node and an End node."],
      steps: [
        {
          title: "Add an assertion",
          instruction:
            "Drag an Assertion node from the Validation palette section and connect the previous node's output to its input.",
        },
        {
          title: "Pick a source",
          instruction:
            "Open the Rules tab. The Source selector offers Previous result, Workflow variables, Status code, Cookies and Headers.",
        },
        {
          title: "Set the path for each source",
          instruction:
            "For Previous result use a path such as response.body.id, response.headers.content-type or response.statusCode. For headers, cookies and variables use just the name. For Status code, leave the path empty.",
          detail:
            "A bare field name is not a path: the top of a JSON body is response.body.id, not id. A path starting with $ is JSONPath, such as $.response.body.items[*].id, and one starting with xpath: reads an XML body.",
        },
        {
          title: "Choose an operator",
          instruction:
            "Pick from equals, notEquals, contains, notContains, gt, gte, lt, lte, count, exists, notExists, matches, notMatches, type, matchesSchema and matchesSnapshot.",
          detail:
            "count takes a non-negative integer and compares the length of an array or string. matches and notMatches take a regular expression, type a JSON type name such as string or array, and matchesSchema a JSON Schema. exists, notExists and matchesSnapshot take no expected value. Status accepts only the numeric comparison operators.",
        },
        {
          title: "Add multiple rules and a failure mode",
          instruction:
            "Use Quick Add for common rules such as Status is 200 or Response time < 1000ms. Add more rules as needed; all rules must pass for the node to pass.",
          detail:
            "The failure mode chooses whether the node reports only the first failed rule or every failed rule.",
        },
        {
          title: "Route the pass and fail handles",
          instruction:
            "Connect the pass handle to your success path. Optionally connect the fail handle to a cleanup or reporting node.",
          detail:
            "Leaving fail unwired is normal: the run records the failed assertion and terminates that branch.",
        },
        {
          title: "Assert a negative test on the request itself",
          instruction:
            "For an API that must reject input, prefer setting Expected status on the HTTP Request node over a continue-on-fail flag plus a downstream assertion on a non-2xx status.",
          detail:
            "With Expected status set, the node passes only when the actual status matches your list, even for a non-2xx such as 409.",
        },
        {
          title: "Use continue-on-failure deliberately",
          instruction:
            "Toggle Continue on failure in the Assertion node's Settings tab to let a failed assertion not stop the run.",
        },
      ],
      example: {
        caption: "A house rule set on one assertion node",
        language: "json",
        code: "[\n  { \"source\": \"status\", \"path\": \"\", \"operator\": \"equals\", \"expectedValue\": 200 },\n  { \"source\": \"prev\", \"path\": \"response.body.token\", \"operator\": \"exists\" },\n  { \"source\": \"headers\", \"path\": \"content-type\", \"operator\": \"contains\", \"expectedValue\": \"application/json\" },\n  { \"source\": \"prev\", \"path\": \"response.body.items\", \"operator\": \"count\", \"expectedValue\": 3 },\n  { \"source\": \"prev\", \"path\": \"response.body.id\", \"operator\": \"type\", \"expectedValue\": \"string\" }\n]",
      },
      expectedResult:
        "A passing node fires the pass handle and renders green; a failing node fires the fail handle, renders red, and reports the failed rule and its reason.",
      troubleshooting: [
        {
          title: "An assertion path never matches",
          instruction:
            "Confirm the source and the prefix. prev paths must address the response object, and array indexes use zero-based [0].",
        },
        {
          title: "A template in the expected value fails oddly",
          instruction:
            "An unresolved placeholder in expectedValue fails with a template-unresolved reason code, not a value mismatch. Resolve the variable first.",
        },
        {
          title: "The fail branch never runs",
          instruction:
            "No edge leaves the fail handle. Add a node and connect from fail.",
        },
      ],
      relatedLessonIds: [
        "http-requests",
        "variables-extractors",
        "snapshots-contracts",
        "runs-history",
      ],
    },
    {
      id: "snapshots-contracts",
      chapterId: "control-flow",
      title: "Snapshot and contract checks",
      summary:
        "Record a response as a baseline with matchesSnapshot, mask changing fields, accept intended changes, and check responses against their OpenAPI schemas.",
      outcome:
        "You can catch any unexpected change in a response without writing a rule per field, and hold imported endpoints to their spec.",
      keywords: [
        "snapshot",
        "matchesSnapshot",
        "baseline",
        "ignore paths",
        "accept snapshot",
        "update snapshots",
        "contract",
        "contract check",
        "response schema",
        "openapi",
        "regression",
      ],
      durationMinutes: 7,
      prerequisites: [
        "The Assertions lesson, or familiarity with assertion rules.",
        "For contract checks, a request imported from an OpenAPI spec.",
      ],
      steps: [
        {
          title: "Add a snapshot rule",
          instruction:
            "In an Assertion node's Rules tab, add a rule with source Previous result, a path such as response.body, and the operator matchesSnapshot. It takes no expected value.",
          detail:
            "The baseline belongs to the rule, so one node can snapshot several values separately.",
        },
        {
          title: "Mask what changes every run",
          instruction:
            "Fill Ignore paths with JSONPath expressions for values that differ on every run, separated by commas, for example $..updatedAt, $..requestId.",
          detail:
            "A location an ignore path selects is treated as equal on both sides, whatever it holds.",
        },
        {
          title: "Record the baseline",
          instruction:
            "Run the workflow. The first run has no baseline yet, so it records the value at the rule's path and passes.",
        },
        {
          title: "Read a changed response",
          instruction:
            "Run again after the API changes. A different value fails the rule and lists the locations that differ, with the baseline value and the new one.",
        },
        {
          title: "Accept an intended change",
          instruction:
            "Open the node after the run. Each failed snapshot rule lists where it differs and offers Accept snapshot #N, which records the value just received as the new baseline.",
          detail:
            "In the app, baselines live in the local database.",
        },
        {
          title: "Share baselines with CI",
          instruction:
            "apiweave run reads and writes .apiweave-snapshots.json, or the file named by --snapshots <file>. Commit it so CI compares against what you accepted, and use --update-snapshots to record every baseline again when a change is intended.",
        },
        {
          title: "Set a contract check",
          instruction:
            "Open an HTTP Request node's Settings tab and find the Contract check card. Set Mode to Off, Warn or Fail, or leave Default (fail for imported endpoints).",
          detail:
            "The body is checked against the node's response schema for the status: the exact code, then its class such as 2XX, then default. A status the spec does not declare is itself a violation. Warn records violations without failing the node.",
        },
        {
          title: "Override the contract in CI",
          instruction:
            "Pass --contract off, warn or fail to apiweave run to override every node's setting for that run. The HTML and JUnit reports list the violations.",
          detail:
            "A negative test is checked too: a request expecting 404 is checked against the 404 (or 4XX) schema, so a negative test of an undeclared status needs Warn or Off.",
        },
      ],
      example: {
        caption: "Snapshot the body, ignoring the fields that change every run",
        language: "json",
        code: "[\n  { \"source\": \"status\", \"path\": \"\", \"operator\": \"equals\", \"expectedValue\": 200 },\n  { \"source\": \"prev\", \"path\": \"response.body\", \"operator\": \"matchesSnapshot\", \"ignorePaths\": [\"$..updatedAt\", \"$..requestId\"] }\n]",
      },
      expectedResult:
        "The first run records the baseline and passes; a later run with a changed body fails and names the differing locations, and Accept snapshot makes the new body the baseline.",
      troubleshooting: [
        {
          title: "A snapshot fails on every run",
          instruction:
            "A field such as a timestamp or an id changes every time. Add its JSONPath to Ignore paths.",
        },
        {
          title: "CI records a new baseline every run",
          instruction:
            "The snapshots file was not committed, or --snapshots points somewhere else. Commit .apiweave-snapshots.json next to the tests.",
        },
        {
          title: "A hand-built request is never checked against its schema",
          instruction:
            "Contract checks default to off on a node that was not imported from OpenAPI. Set Mode to Warn or Fail.",
        },
      ],
      relatedLessonIds: ["assertions", "openapi", "git-ci"],
    },
    {
      id: "delay-merge",
      chapterId: "control-flow",
      title: "Delay and Merge",
      summary:
        "Pause with optional jitter, then synchronise parallel branches with all, any, first or conditional merges.",
      outcome:
        "You can pace rate-limited calls and fan out work, then bring branches back together predictably.",
      keywords: [
        "delay",
        "jitter",
        "merge",
        "parallel",
        "branch",
        "fan-out",
        "all",
        "any",
        "first",
        "conditional",
        "wait",
      ],
      durationMinutes: 6,
      prerequisites: ["A workflow with at least one branch you can split."],
      steps: [
        {
          title: "Add a delay",
          instruction:
            "Drag a Delay node from Control Flow and connect it in the path you want to pace. On the Duration tab, set Delay (ms); the default is 1000.",
        },
        {
          title: "Add jitter",
          instruction:
            "On the Random Jitter (optional) card, enable jitter and set Min (ms) and Max (ms).",
          detail:
            "With jitter on, the wait becomes a random duration between Min and Max and the base Delay (ms) value is not added on top, which spreads retries against a rate-limited API.",
        },
        {
          title: "Split into parallel branches",
          instruction:
            "Connect two or more nodes from one upstream output, or fan out from the Start node, to run branches concurrently.",
        },
        {
          title: "Bring branches together with a Merge",
          instruction:
            "Drag a Merge node from Control Flow and connect each branch's output into it. On the Strategy tab, choose one of Wait for All, Wait for Any, First Completes or Conditional.",
          detail:
            "Wait for All needs every branch; Wait for Any continues after the first successful branch; First Completes uses the first branch result.",
        },
        {
          title: "Configure a conditional merge",
          instruction:
            "Choose Conditional, then on the Conditions tab add rules with Branch index, Field path, Operator and Value. Set Evaluate with to AND or OR.",
          detail:
            "Each condition is checked against that branch's result, for example branch 0, response.statusCode, equals, 200.",
        },
        {
          title: "Address branch results downstream",
          instruction:
            "After a merge, reference a specific branch with an index, for example {{prev[0].response.body.id}} and {{prev[1].response.body.id}}.",
        },
        {
          title: "Finish each path at an End node",
          instruction:
            "Converge paths on one End node when they mean the same thing, or use separate End nodes when the outcomes are genuinely distinct. The runner marks each End it reaches as passed on its own.",
        },
      ],
      example: {
        caption: "Fan out, wait for all, index the results",
        language: "text",
        code: "[ Start ] -> +-> [ GET /users ]  -+\n              +-> [ GET /orders ] -+-> [ Merge: Wait for All ] -> [ End ]\n\nDownstream:\n  users  = {{prev[0].response.body}}\n  orders = {{prev[1].response.body}}",
      },
      expectedResult:
        "Delay paces execution by the configured window, parallel branches overlap on the run timeline, and the merge resumes the single downstream path under the chosen strategy.",
      troubleshooting: [
        {
          title: "A merge never continues",
          instruction:
            "Under Wait for All, one branch has not completed or has failed. Check the run timeline for the branch that stalled.",
        },
        {
          title: "prev.* after a merge is empty",
          instruction:
            "The index does not match a completed branch. Branch indices start at 0 and follow the order of the edges arriving at the merge (the same order as the Branch index field in the Conditions tab).",
        },
        {
          title: "A conditional merge behaves unexpectedly",
          instruction:
            "Check whether Evaluate with is AND or OR, and confirm the branch index points at the branch you mean.",
        },
      ],
      relatedLessonIds: ["assertions", "visual-debugging", "sse"],
    },
    {
      id: "sse",
      chapterId: "control-flow",
      title: "Listen to an SSE stream",
      summary:
        "Bounded Server-Sent Events listening for contract testing: handshake, filters, event cap, finish trigger, timeout and Ready vs Complete.",
      outcome:
        "You can subscribe to a stream, trigger a downstream action only after the handshake, and assert on the collected events.",
      keywords: [
        "sse",
        "stream",
        "server-sent events",
        "event stream",
        "ready",
        "complete",
        "finish trigger",
        "handshake",
        "contract test",
      ],
      durationMinutes: 7,
      prerequisites: [
        "An endpoint that emits Server-Sent Events.",
        "Familiarity with the HTTP Request node and assertions.",
      ],
      steps: [
        {
          title: "Add an SSE Stream node",
          instruction:
            "Drag SSE Stream from the Streaming palette section. It has one input and two outputs: Ready and Complete.",
        },
        {
          title: "Set the endpoint",
          instruction:
            "On the Endpoint tab, set the SSE URL, for example {{env.BASE_URL}}/events. It supports environment and variable placeholders.",
          detail:
            "The node always sends Accept: text/event-stream over GET. Secrets are not resolved in the URL; put Authorization: Bearer {{secrets.NAME}} in the headers instead.",
        },
        {
          title: "Add query params and headers",
          instruction:
            "Use the Query parameters card and the Headers tab for optional request values. Put Authorization: Bearer {{secrets.NAME}} here for an authenticated stream.",
        },
        {
          title: "Filter by event type",
          instruction:
            "Optionally set Event type to an exact SSE event name such as order.updated. Other events are ignored and do not count toward the target.",
        },
        {
          title: "Cap the number of events",
          instruction:
            "Set Events to collect between 1 and 100. The default is 1, and with no finish trigger the connection closes as soon as that many matching events arrive.",
        },
        {
          title: "Add a finish trigger",
          instruction:
            "On the Finish tab, add rules with Event path, Operator and Expected value. All rules must match the same event to close the stream.",
          detail:
            "Paths support event, id, raw data, and JSON data fields. Use data.status for a JSON field, or data, event and id for the raw event fields. The WebSocket node and a server-streaming gRPC Call share the same Finish tab, Ready and Complete outputs, and finish-rule editor.",
        },
        {
          title: "Set the timeout",
          instruction:
            "On the Settings tab, set Timeout (seconds). Set it to 0 only when a finish trigger is present, to wait until that state arrives.",
          detail:
            "Follow redirects and Verify TLS are on by default. A finish rule is required when the timeout is 0.",
        },
        {
          title: "Wire Ready and Complete",
          instruction:
            "Use the Ready output for a downstream trigger that must not race the subscription. Use the Complete output for a regular Assertion node that checks the collected events.",
        },
        {
          title: "Assert on the collected events",
          instruction:
            "On the Complete path, assert against paths such as response.body.events[0].data or response.body.eventCount.",
          detail:
            "The output body carries events, eventCount and termination. Each event records its event type, optional id, and exact data string, including multi-line data.",
        },
        {
          title: "Extract a value from the stream",
          instruction:
            "On the Settings tab, use Extract variables to map a variable name to a path such as response.body.events[0].data.",
        },
      ],
      example: {
        caption: "Wait for the handshake, then assert on the final result",
        language: "text",
        code: "[ Start ] -> [ SSE Stream ] --Ready----> [ HTTP Request: POST /trigger ]\n                              \\--Complete-> [ Assertion: response.body.eventCount gte 1 ]",
      },
      expectedResult:
        "The Ready path runs only after the SSE handshake succeeds, so the trigger is not missed. Complete fires only when the event cap or a finish rule ends the collection; a timeout, cancellation, empty stream-end or failure terminates the node without traversing Complete. On success, Complete carries the bounded event list.",
      troubleshooting: [
        {
          title: "The stream never completes",
          instruction:
            "No finish trigger matched and the event cap was not reached. Confirm the event type filter, the finish path, and the timeout.",
        },
        {
          title: "A downstream trigger races the subscription",
          instruction:
            "It is wired to Complete instead of Ready. Move it to the Ready output.",
        },
        {
          title: "The finish rule never matches",
          instruction:
            "Use data.status for a JSON field, or data / event / id for the raw event fields, and check that every rule can match the same event.",
        },
      ],
      relatedLessonIds: ["http-requests", "assertions", "protocols"],
    },
    {
      id: "protocols",
      chapterId: "control-flow",
      title: "Call gRPC, WebSocket, SOAP and JSON-RPC",
      summary:
        "JSON-RPC and SOAP bodies on the HTTP node, WSDL import, the WebSocket node, and the gRPC Call node with Discover, unary or server streaming.",
      outcome:
        "You can test an API that does not speak plain REST, with the same extractors, assertions and Ready/Complete outputs as the rest of the canvas.",
      keywords: [
        "grpc",
        "protobuf",
        "proto",
        "reflection",
        "discover",
        "server streaming",
        "websocket",
        "ws",
        "soap",
        "wsdl",
        "xml",
        "xpath",
        "json-rpc",
        "jsonrpc",
      ],
      durationMinutes: 9,
      prerequisites: [
        "The HTTP Request and SSE lessons, or familiarity with nodes that have Ready and Complete outputs.",
        "A service that speaks the protocol you want to test.",
      ],
      steps: [
        {
          title: "Call a JSON-RPC 2.0 method",
          instruction:
            "On an HTTP Request node's Body tab, choose JSON-RPC. Fill Method, and Params as a JSON object (by name) or array (by position). Turn on Send as a notification for a call with no reply.",
          detail:
            "The request is POSTed as application/json with an id that increases through the run. A response with an error member fails the node with its code and message unless Allow error responses is on; then assert on response.body.error.code.",
        },
        {
          title: "Send a SOAP envelope",
          instruction:
            "On the Body tab, choose SOAP. Pick the SOAP version (1.1 or 1.2), fill Action, and paste the complete Envelope.",
          detail:
            "Each version gets the Content-Type and SOAPAction it prescribes. A SOAP Fault fails the node unless its status is the expected one, with the fault's code and reason on response.fault.",
        },
        {
          title: "Read XML with XPath",
          instruction:
            "Write an extractor or assertion path that starts with xpath:, for example xpath://*[local-name()=\"Total\"]/text().",
          detail:
            "An unprefixed name never matches a namespaced element, so use local-name() or declare prefixes inline: xpath[s=http://schemas.xmlsoap.org/soap/envelope/]:/s:Envelope.",
        },
        {
          title: "Import a WSDL",
          instruction:
            "Open Import to Add Nodes, choose the WSDL tab, and paste or choose a WSDL 1.1 document. Each operation becomes a POST node addressed from its port's soap:address, with an envelope skeleton.",
        },
        {
          title: "Open a WebSocket",
          instruction:
            "Drag WebSocket from the Streaming palette section. On the Endpoint tab set the WebSocket URL (ws:// or wss://) and any Subprotocols, on the Headers tab the handshake headers, and on the Messages tab the outbound messages to send in order.",
          detail:
            "Each message has Data, a Type of text or binary (base64), and an optional Delay before send (ms). On the Settings tab, Timeout (seconds) and Messages to collect bound the connection.",
        },
        {
          title: "Assert on the collected frames",
          instruction:
            "Wire a trigger to Ready and an Assertion to Complete, as with SSE. Assert on response.body.messages, messageCount, termination, closeCode or closeReason.",
        },
        {
          title: "Add a gRPC Call and discover the schema",
          instruction:
            "Drag gRPC Call from the gRPC palette section. On the Endpoint tab set Target to host:port, choose Schema source (Server reflection or Proto files), and click Discover. Pick a Service and a Method; the Message tab is filled with a skeleton of the request.",
          detail:
            "Proto files are stored inside the workflow, so they travel in exports and git; reflection needs the server to be reachable. Use TLS takes its CA and client certificate from Settings → Network.",
        },
        {
          title: "Check the gRPC status",
          instruction:
            "Read response.body for the decoded message and response.status for the code name. On the Settings tab, set Expected status to a code such as NOT_FOUND for a negative test; empty expects OK.",
          detail:
            "response.statusCode, response.statusMessage, response.headers and response.trailers are there too, and $ JSONPath works on them like on an HTTP response.",
        },
        {
          title: "Stream from a gRPC server",
          instruction:
            "Set Call type to Server streaming. The node gets Ready and Complete outputs, collects responses into response.body.messages, and closes when the server ends the stream, a Finish rule matches, Max responses is reached or the deadline expires.",
        },
      ],
      example: {
        caption: "Three non-REST calls on one canvas",
        language: "text",
        code: "HTTP Request, Body: JSON-RPC   method = subtract   params = [42, 23]\n  -> assert response.body.result equals 19\n\nWebSocket  wss://{{env.HOST}}/socket   message: {\"action\":\"subscribe\"}\n  --Complete-> assert response.body.messageCount gte 1\n\ngRPC Call  {{env.GRPC_HOST}}:443   shop.Orders / GetOrder   Expected status: OK\n  -> assert response.body.order_id exists",
      },
      expectedResult:
        "Each node reports a pass or fail like an HTTP request, the streaming ones fire Ready then Complete, and their results are read with the same dot, JSONPath and XPath paths.",
      troubleshooting: [
        {
          title: "Discover fails with server reflection",
          instruction:
            "The server does not expose reflection or is not reachable. Switch Schema source to Proto files and add the .proto files instead.",
        },
        {
          title: "A gRPC call ignores the proxy",
          instruction:
            "A gRPC channel is not proxied: Settings → Network's proxy does not apply to it, only its CAs and client certificates.",
        },
        {
          title: "A JSON-RPC call fails although the server answered 200",
          instruction:
            "The body carries an error member. Fix the call, or turn on Allow error responses and assert on response.body.error.",
        },
        {
          title: "An XPath path never matches",
          instruction:
            "The element is namespaced. Use *[local-name()=\"Name\"], or declare the prefix inline in xpath[prefix=uri]:.",
        },
      ],
      relatedLessonIds: ["sse", "http-requests", "variables-extractors", "assertions"],
    },
    {
      id: "call-workflow",
      chapterId: "control-flow",
      title: "Call another workflow as a step",
      summary:
        "Reuse a workflow inline with input and output variable mappings, shared environment and secrets, and recursion limits.",
      outcome:
        "You can reuse a login or setup flow inside another workflow without duplicating it.",
      keywords: [
        "call workflow",
        "sub-workflow",
        "reuse",
        "input mapping",
        "output mapping",
        "recursion",
        "nesting",
        "inline",
        "for each",
        "loop",
        "iteration",
      ],
      durationMinutes: 6,
      prerequisites: [
        "At least two workflows in the same workspace.",
        "Familiarity with workflow variables.",
      ],
      steps: [
        {
          title: "Add a Call Workflow node",
          instruction:
            "Drag Call Workflow from Control Flow. It has one input and one output.",
        },
        {
          title: "Pick the target",
          instruction:
            "On the Target workflow card, choose a workflow from the picker. It lists workflows in the current workspace and excludes the current one.",
        },
        {
          title: "Pass inputs",
          instruction:
            "On the Input mapping card, add entries as target variable = caller expression, for example tenant = {{variables.tenantId}}.",
          detail:
            "Each entry names a variable the sub-workflow reads as {{variables.NAME}}, resolved in the caller's context.",
        },
        {
          title: "Map outputs back",
          instruction:
            "On the Output mapping card, add entries as caller variable = sub-workflow variable, for example authToken = accessToken.",
          detail:
            "An output entry is applied only when the sub-workflow actually produced that variable. Anything you did not map stays inside the sub-workflow.",
        },
        {
          title: "Run it once per item with For each",
          instruction:
            "On the For each card, turn on Run once per item. Set Items to a placeholder or JSON array literal such as {{variables.userIds}}, Item variable to the name the target reads each item as, and optionally Index variable, Concurrency (1 to 16) and Stop on failure.",
          detail:
            "Items also takes a $ JSONPath such as $.variables.users[?@.active==true].id. Each iteration is its own run of the target, every output-mapping variable becomes an array in item order, at most 1000 items run, and the node passes only if every iteration passes.",
        },
        {
          title: "Let the sub-workflow resolve env and secrets itself",
          instruction:
            "Do not map {{env.*}} or {{secrets.*}}; the sub-workflow shares the run's environment and secret store and resolves them on its own.",
          detail:
            "A {{secrets.NAME}} on the right-hand side of an input mapping fails the node by design, so a secret value can never be copied into a plain child variable.",
        },
        {
          title: "Understand how it runs",
          instruction:
            "Know that the call runs in-process inside the current run. The child is recorded as its own run in the target workflow's history; open that workflow's History, or use the link on the calling node, to inspect it. The calling node's result carries only a summary: the target, its status, node and failure counts, and which outputs were mapped back.",
        },
        {
          title: "Respect the recursion limit",
          instruction:
            "Saving a node whose target is in another workspace, or is the calling workflow itself, is rejected. An indirect cycle is not caught at save time, so the runner caps nesting at 8 levels and fails the node with a recursion-depth error.",
        },
        {
          title: "Follow the failure behaviour",
          instruction:
            "A failed sub-workflow fails the calling node, which then follows the workflow's continue-on-failure setting like any other failure.",
        },
      ],
      example: {
        caption: "Reuse an Authenticate flow from a checkout flow",
        language: "text",
        code: "[ Start ] -> [ Call Workflow: Authenticate ] -> [ POST /cart ] -> [ End ]\n                        input mapping:  tenant = {{variables.tenantId}}\n                        output mapping: authToken = accessToken\n\nCheckout then uses {{variables.authToken}} in its own headers.",
      },
      expectedResult:
        "The sub-workflow runs to completion as a single step, the caller continues only where mappings were declared, and the calling node's result summarises the child run.",
      troubleshooting: [
        {
          title: "The node fails with no target workflow configured",
          instruction:
            "The node was dropped but never pointed at a workflow. Open it and pick a target.",
        },
        {
          title: "The node fails with recursion depth exceeded",
          instruction:
            "The call graph loops or nests deeper than 8 levels. Open the target chain and break the loop.",
        },
        {
          title: "A sub-workflow variable is missing in the caller",
          instruction:
            "It was not in the output mapping, or the right-hand name does not match the variable the sub-workflow ends with. Run the sub-workflow alone to check its final variables.",
        },
      ],
      relatedLessonIds: ["variables-extractors", "presets", "projects"],
    },
  ],
};
