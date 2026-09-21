import type { TutorialChapter } from "../../types";

/**
 * Chapter 2 — Requests and data. The HTTP Request node, variables and
 * extractors, placeholders, environments and the secret store.
 */
export const requestsAndDataChapter: TutorialChapter = {
  id: "requests-and-data",
  title: "Requests and data",
  summary:
    "Configure real HTTP calls, pass data between steps, and scope values to environments and secrets.",
  lessons: [
    {
      id: "http-requests",
      chapterId: "requests-and-data",
      title: "Configure an HTTP request",
      summary:
        "Methods, URL and path variables, query params, headers, cookies, auth, bodies, timeouts, redirects, TLS, expected status and continue-on-failure.",
      outcome:
        "You can build any request the node supports, including negative tests and file uploads, and copy it out as a cURL command.",
      keywords: [
        "http",
        "request",
        "method",
        "url",
        "query",
        "headers",
        "cookies",
        "auth",
        "bearer",
        "basic",
        "api key",
        "body",
        "json",
        "form-data",
        "urlencoded",
        "binary",
        "upload",
        "timeout",
        "redirect",
        "tls",
        "expected status",
        "curl",
      ],
      durationMinutes: 9,
      prerequisites: ["A workflow with an HTTP Request node on the canvas."],
      steps: [
        {
          title: "Choose the method and URL",
          instruction:
            "Open the node. The method selector on the request bar offers GET, POST, PUT, DELETE, PATCH, HEAD and OPTIONS. Type the URL beside it.",
          detail:
            "The URL accepts placeholders such as {{env.BASE_URL}}/users. A {{secrets.*}} reference in the URL is refused by the runner, so keep credentials in headers or the auth section.",
        },
        {
          title: "Add query parameters",
          instruction:
            "Open the Params tab and add key/value rows. Each row has an active toggle; the Full URL preview shows the assembled URL with placeholders highlighted.",
        },
        {
          title: "Add path variables",
          instruction:
            "In the node's expanded inline body, use the Path Variables field with the hint Use :varName in URL. Set the URL to /users/:id and the row to id=42.",
          detail:
            "Path variables substitute named segments in the URL path rather than appending a query string.",
        },
        {
          title: "Add headers and cookies",
          instruction:
            "Open the Headers tab and add key/value rows. Open the Cookies tab and add single-line key=value cookies.",
          detail:
            "Both accept placeholders, for example Authorization: Bearer {{variables.token}}.",
        },
        {
          title: "Configure authorization",
          instruction:
            "Open the Auth tab and pick an auth type: None, Bearer Token, Basic Auth or API Key. For API Key, set the key name, its value, and where it is added.",
          detail:
            "These credentials are stored with the workflow, so use a {{secrets.NAME}} reference for anything sensitive.",
        },
        {
          title: "Set a request body",
          instruction:
            "Open the Body tab and choose a body type: None, JSON, Raw, Form-data, x-www-form-urlencoded or Binary. Fill in the matching fields.",
          detail:
            "JSON gets a formatting helper and a Monaco editor. Form-data supports per-field rows and file uploads. Binary attaches a file directly.",
        },
        {
          title: "Tune request settings",
          instruction:
            "Open the Settings tab. Set Timeout (seconds, 1–300), and toggle Follow redirects and SSL verify.",
          detail:
            "Both follow-redirects and SSL-verify are on by default. Timeout defaults to 30 seconds.",
        },
        {
          title: "Assert a negative test with Expected status",
          instruction:
            "In the same Settings tab, fill Expected status with a code or list such as 409 or 409, 422.",
          detail:
            "Setting Expected status replaces the default any-2xx rule entirely: the node passes only when the actual status matches one of your values, and fails even on a 2xx. Use it to assert that an API rejects bad input.",
        },
        {
          title: "Override failure behaviour for this node",
          instruction:
            "Toggle Continue on failure in the Settings tab to let this node's failure not stop the workflow, regardless of the workflow-level setting.",
        },
        {
          title: "Copy the request as cURL",
          instruction:
            "After a run, open the node's output panel and use Copy as cURL to put the configured request on your clipboard.",
        },
      ],
      example: {
        caption: "A configured POST with a secret header",
        language: "http",
        code: "POST {{env.BASE_URL}}/orders\nHeaders:\n  Content-Type: application/json\n  Authorization: Bearer {{secrets.API_TOKEN}}\nBody (JSON):\n  { \"itemId\": \"{{variables.itemId}}\", \"qty\": 1 }\nTimeout: 30s   Follow redirects: on   SSL verify: on",
      },
      expectedResult:
        "The node runs the configured request and reports the status code. A request that matches Expected status passes even when that code is a non-2xx such as 409.",
      troubleshooting: [
        {
          title: "A placeholder arrives as literal text",
          instruction:
            "The referenced key does not exist in the selected scope. Confirm the name and namespace, and that an upstream node extracted it.",
        },
        {
          title: "The body is rejected before it is sent",
          instruction:
            "A placeholder inside JSON often leaves invalid JSON when unresolved. Resolve the variable first, or add a fallback value.",
        },
        {
          title: "Expected status passes a code you did not intend",
          instruction:
            "Expected status replaces the 2xx default, so an empty or malformed value behaves differently. Enter codes between 100 and 599.",
        },
      ],
      relatedLessonIds: [
        "variables-extractors",
        "assertions",
        "environments",
        "secrets",
      ],
    },
    {
      id: "variables-extractors",
      chapterId: "requests-and-data",
      title: "Chain requests with extracted data",
      summary:
        "Workflow variables, extractors from JSON bodies, headers and cookies, saving values straight from a response, and ordering.",
      outcome:
        "You can pull a token out of one response and send it in the next request as {{variables.name}}.",
      keywords: [
        "variables",
        "extractors",
        "extract",
        "jsonpath",
        "response",
        "chain",
        "token",
        "login",
        "store response",
      ],
      durationMinutes: 7,
      prerequisites: [
        "The HTTP Request lesson, or familiarity with configuring a request.",
      ],
      steps: [
        {
          title: "Add a variable by hand",
          instruction:
            "Open the side panel's Variables tab, click Add variable, and enter a name and value. Save it.",
          detail:
            "The name is the segment after the dot, so a variable named token is used as {{variables.token}}.",
        },
        {
          title: "Capture a value from a response",
          instruction:
            "Run the workflow once so the HTTP node holds a response. Open the node, switch the response to the Tree tab, hover the row you want, and click the variable icon beside the copy icon.",
          detail:
            "Accept or edit the suggested name and press Enter. The row keeps a {{name}} chip, and clicking that chip removes the variable again.",
        },
        {
          title: "Write an extractor path by hand",
          instruction:
            "Open the node's Settings tab, find Store response as variables, and click Add manually. Enter a name such as token and a path such as response.body.access_token.",
          detail:
            "Every extractor path starts with response. because it reads the node's response object.",
        },
        {
          title: "Use the extracted value downstream",
          instruction:
            "Add a later HTTP node and reference the variable in a header, for example Authorization: Bearer {{variables.token}}.",
          detail:
            "A node's own extractors are not available to itself; they are available to every later node in the run.",
        },
        {
          title: "Extract from headers and cookies too",
          instruction:
            "Use paths such as response.headers.content-type, response.headers.set-cookie, or response.statusCode to capture non-body values.",
        },
        {
          title: "Confirm the value after a run",
          instruction:
            "Open the Variables tab after the run. Each row shows the resolved value, including values written by extractors, so you can confirm the path matched.",
          detail:
            "The Settings tab of the HTTP node counts what the node stores and lists each entry with what it captured from the last response.",
        },
        {
          title: "Mind the order",
          instruction:
            "Place any node that consumes a variable downstream of the node that produces it. A reference before the extractor runs resolves to literal text.",
        },
      ],
      example: {
        caption: "Login, extract, reuse",
        language: "text",
        code: "HTTP Request: POST /login  ->  200 { \"access_token\": \"abc123\" }\nExtractor:\n  name = token\n  path = response.body.access_token\nLater node:\n  Authorization: Bearer {{variables.token}}",
      },
      expectedResult:
        "The Variables panel shows the extracted value after the run, and the downstream request sends it in place of the placeholder.",
      troubleshooting: [
        {
          title: "An extractor did not set a value",
          instruction:
            "The path does not match the real response shape. Inspect the response body for the exact field name and casing; arrays are zero-based.",
        },
        {
          title: "{{variable.token}} resolves to nothing",
          instruction:
            "The namespace is plural: use {{variables.token}}.",
        },
        {
          title: "A variable is empty in a later branch",
          instruction:
            "After a Merge, address a specific branch with an index, for example {{prev[0].response.body.id}}.",
        },
      ],
      relatedLessonIds: [
        "http-requests",
        "placeholders-functions",
        "assertions",
        "visual-debugging",
      ],
    },
    {
      id: "placeholders-functions",
      chapterId: "requests-and-data",
      title: "Placeholders and dynamic functions",
      summary:
        "The four namespaces, direct node references, substitution order, unresolved values, and every dynamic function.",
      outcome:
        "You can choose the right namespace for a value, predict which one wins, and generate fresh test data on every run.",
      keywords: [
        "placeholders",
        "variables",
        "env",
        "prev",
        "secrets",
        "functions",
        "uuid",
        "timestamp",
        "random",
        "substitution",
        "unresolved",
      ],
      durationMinutes: 8,
      prerequisites: ["At least one workflow with a variable or environment."],
      steps: [
        {
          title: "Use the four namespaces",
          instruction:
            "Reference env values as {{env.NAME}}, workflow variables as {{variables.name}}, the previous node's result as {{prev.response.body.field}}, and secrets as {{secrets.NAME}}.",
          detail:
            "Placeholders work in URLs, query params, headers, cookies, bodies and assertion expected values. The HTTP method and timeout are taken literally, and an assertion's path is not templated.",
        },
        {
          title: "Address a specific node by id",
          instruction:
            "Use {{<nodeId>.response.body.field}} to read a particular node's result without relying on prev adjacency.",
        },
        {
          title: "Know that namespaces are explicit",
          instruction:
            "Each namespace is chosen by its prefix, so {{variables.token}} and {{secrets.token}} are two different references, not one name that resolves to whichever wins. There is no collision to reason about: write the prefix for the source you actually mean.",
          detail:
            "The runner checks the prefix (secrets., env., variables., prev, then a node id) and resolves only that source. Nothing is tried in a fallback order, so a reference that does not exist stays literal rather than resolving to a same-named value from another namespace.",
        },
        {
          title: "Expect unresolved values to stay literal",
          instruction:
            "When a key is missing, the reference is left in place as literal text rather than erroring. The run records unresolved references per node so the misspelled key is visible.",
          detail:
            "In an assertion's expected value an unresolved template fails with a template-unresolved reason code rather than a value mismatch.",
        },
        {
          title: "Generate fresh data with functions",
          instruction:
            "Insert a function call like {{uuid()}} or {{randomString(12)}} into any interpolated field. Use the side panel's Functions tab to search functions and copy examples.",
        },
        {
          title: "Use the string and number generators",
          instruction:
            "randomString(length) alphanumeric, randomAlpha(length) letters only, randomNumeric(length) digits only, randomHex(length) hex, randomEmail() an address, and randomNumber(size) a numeric string.",
          detail:
            "Defaults: randomString and randomAlpha 10, randomNumeric 10, randomHex 16, randomNumber 6.",
        },
        {
          title: "Use the date and time functions",
          instruction:
            "uuid(), timestamp() in Unix seconds, iso_timestamp(), date(format) with a strftime pattern, futureDate(days, format), and pastDate(days, format).",
          detail:
            "Date formats default to %Y-%m-%d; directives include %Y, %m, %d, %H, %M, %S.",
        },
        {
          title: "Pick randomly from a list",
          instruction:
            "Use randomChoice(options) with a comma-separated list, for example {{randomChoice(staging,production,local)}}.",
          detail:
            "Write the options without wrapping quotes: the resolver splits the call on commas and strips surrounding quotes per argument, so a quoted list is parsed as several arguments and only the first is used.",
        },
      ],
      example: {
        caption: "Functions and namespaces together",
        language: "text",
        code: "Request id:   {{uuid()}}\nRecipient:    user_{{randomNumber(4)}}@test.com\nEnv base:     {{env.BASE_URL}}/orders/{{variables.orderId}}\nPrior status: {{prev.response.statusCode}}\nCredential:   {{secrets.API_KEY}}",
      },
      expectedResult:
        "Each placeholder is substituted before the request is sent, functions produce a fresh value on every run, and any unresolved reference remains visible as literal text in the field.",
      troubleshooting: [
        {
          title: "A function's output looks like the raw call",
          instruction:
            "The placeholder was not evaluated. Check the field supports substitution and the function name is spelled exactly.",
        },
        {
          title: "A function returns the same value across runs",
          instruction:
            "Placeholders resolve at run time, so re-run the workflow to get a fresh value.",
        },
        {
          title: "randomChoice returns an empty string",
          instruction:
            "The options argument was empty. Pass a non-empty comma-separated list.",
        },
        {
          title: "A date format is ignored",
          instruction:
            "Use strftime directives. Literal characters outside the directives pass through unchanged.",
        },
      ],
      relatedLessonIds: [
        "variables-extractors",
        "environments",
        "secrets",
        "assertions",
      ],
    },
    {
      id: "environments",
      chapterId: "requests-and-data",
      title: "Environments and inheritance",
      summary:
        "Selecting and defaulting an environment, variable maps, base inheritance with overrides and cycle limits, and the per-environment spec URL.",
      outcome:
        "You can run one workflow against staging or production by switching environments, and share variables through a base environment.",
      keywords: [
        "environment",
        "env",
        "variables",
        "default",
        "inheritance",
        "base environment",
        "override",
        "swagger url",
        "staging",
        "production",
      ],
      durationMinutes: 6,
      prerequisites: ["A workflow with at least one {{env.*}} reference."],
      steps: [
        {
          title: "Create an environment",
          instruction:
            "Open Settings → Environments and click New environment. Give it a name, an optional description, and add key/value variable rows.",
          detail:
            "Variables are plain key/value strings or numbers. Common patterns are BASE_URL, API_VERSION, TIMEOUT_SECONDS and feature flags.",
        },
        {
          title: "Reference its variables",
          instruction:
            "Use the values anywhere a placeholder is allowed, for example {{env.BASE_URL}}/users or {{env.BASE_URL}}/orders/{{variables.orderId}}.",
        },
        {
          title: "Select the environment for a run",
          instruction:
            "Open a workflow and pick an environment from the canvas toolbar selector before clicking Run.",
          detail:
            "The selected environment is the one whose variables feed {{env.*}} and whose secret store wins the scope chain.",
        },
        {
          title: "Set a default environment",
          instruction:
            "Pick an environment in the header's Default environment selector so it is preselected for new workflows.",
          detail:
            "The default is a per-machine convenience preference remembered locally. It is not the same thing as the environment a run uses, which is always the one chosen on the canvas.",
        },
        {
          title: "Inherit from a base environment",
          instruction:
            "In the environment editor, set Base Environment to another environment in the same workspace. Your environment then defines only what differs.",
          detail:
            "At run time the whole chain merges from the root down, with each descendant overriding the names it redefines. The editor shows inherited rows muted and read-only, labelled with their source, and marks ones you override.",
        },
        {
          title: "Know the inheritance limits",
          instruction:
            "Plain variables only: secrets are not inherited and still resolve environment → workspace. Loops are refused, and chains are followed at most 8 levels deep.",
        },
        {
          title: "Pin an OpenAPI/Swagger URL",
          instruction:
            "Paste a spec URL into the environment's OpenAPI/Swagger URL field to enable Refresh in the canvas toolbar for that environment.",
        },
        {
          title: "Delete safely",
          instruction:
            "Deleting an environment is immediate, but deleting the environment marked as your default is refused until you pick a different default.",
          detail:
            "Environment-scoped secrets are keyed to the environment's id and are not automatically deleted with it.",
        },
      ],
      example: {
        caption: "A chain merged from the root down",
        language: "text",
        code: "base            HOST=api.example.com   REGION=us   TIMEOUT=30\n  staging       HOST=api.staging.example.com\n       staging-eu   REGION=eu\n\nRunning against staging-eu resolves:\n  HOST=api.staging.example.com  (from staging)\n  REGION=eu                     (from staging-eu)\n  TIMEOUT=30                    (from base)",
      },
      expectedResult:
        "The same workflow targets different hosts by switching environments, and an environment with a base shows the merged effective set without running anything.",
      troubleshooting: [
        {
          title: "{{env.BASE_URL}} arrives as plain text",
          instruction:
            "The selected environment does not define that key. Add it on the Environments page and re-run.",
        },
        {
          title: "An inherited variable does not reach the run",
          instruction:
            "Check the chain in the editor. A locally defined name overrides the inherited one, and only rows shown in the inherited section are in the effective set.",
        },
        {
          title: "A base environment is missing from the picker",
          instruction:
            "It is either this environment itself or one whose chain leads back here; both would form a cycle and are excluded on purpose.",
        },
      ],
      relatedLessonIds: ["secrets", "openapi", "http-requests", "settings"],
      destination: { label: "Manage environments", path: "environments" },
    },
    {
      id: "secrets",
      chapterId: "requests-and-data",
      title: "Secrets and the encrypted store",
      summary:
        "Workspace and environment scopes, the environment-first chain, write-only values, metadata-only display, masking, and resolution confidence.",
      outcome:
        "You can store an API key without ever exposing it, reference it as {{secrets.NAME}}, and see whether it resolved.",
      keywords: [
        "secret",
        "secrets",
        "encrypted",
        "libsodium",
        "write-only",
        "scope",
        "masking",
        "api key",
        "credential",
        "resolution",
      ],
      durationMinutes: 7,
      prerequisites: ["A workflow that needs an API key or token."],
      steps: [
        {
          title: "Add a secret",
          instruction:
            "Open Settings → Secrets and click Add secret. Choose the Workspace scope, enter a name such as HTTPBIN_AUTH, and submit.",
          detail:
            "The renderer encrypts the value against the install's public key with a Libsodium sealed box before the write request leaves. The main process never receives plaintext.",
        },
        {
          title: "Reference it in a request",
          instruction:
            "Add a header such as Authorization: Bearer {{secrets.HTTPBIN_AUTH}} and run the workflow.",
        },
        {
          title: "Understand the scope chain",
          instruction:
            "Know that {{secrets.NAME}} resolves through a fixed chain: the selected environment's store first, then the workspace store. The first scope that declares the key wins.",
          detail:
            "The chain is read-only: a secret can be overwritten or deleted through the write flow, but never read back.",
        },
        {
          title: "Choose the right scope",
          instruction:
            "Use Workspace for a key any workflow in the workspace can use, and Environment for a key only workflows selecting that environment should see.",
          detail:
            "The scope is fixed at creation time; delete and recreate to change it.",
        },
        {
          title: "Confirm metadata-only display",
          instruction:
            "After saving, look at the secret row. It shows the name, scope, key id and timestamps — never the value or the ciphertext.",
        },
        {
          title: "Check resolution confidence",
          instruction:
            "After a run, open the HTTP node's response panel and read the Secrets row, or the run timeline's Resolved secrets summary. Each badge reads NAME · environment, NAME · workspace, or NAME · missing.",
          detail:
            "A green environment or workspace badge means it resolved; a red missing badge means no scope declared the key, so the placeholder was not substituted.",
        },
        {
          title: "Know where secrets never travel",
          instruction:
            "Secret values are scrubbed before any result is persisted, never appear in .awecollection exports, never sync to Cloud, and are never returned by any read API or MCP tool.",
        },
      ],
      example: {
        caption: "Write, reference, verify",
        language: "text",
        code: "1. Add secret   scope=Workspace  name=HTTPBIN_AUTH\n2. Reference    Authorization: Bearer {{secrets.HTTPBIN_AUTH}}\n3. Run          request goes out with the decrypted value\n4. Verify       response panel shows: HTTPBIN_AUTH . workspace (green)",
      },
      expectedResult:
        "The upstream service receives the decrypted value, the value never appears in the canvas or run history, and the resolution badge reports which scope supplied it.",
      troubleshooting: [
        {
          title: "{{secrets.NAME}} appears as plain text",
          instruction:
            "No scope in the chain declares that key. Add it on the right scope through the write flow.",
        },
        {
          title: "A secret looks unreadable after copying the database",
          instruction:
            "The keyfile did not travel with it. Copy keyfile.json from the source user-data directory, or re-enter the secret.",
        },
        {
          title: "You want to paste an existing value into the UI",
          instruction:
            "There is no paste field or plaintext read path by design. Re-enter the value through the write flow.",
        },
      ],
      relatedLessonIds: ["environments", "http-requests", "visual-debugging", "mcp"],
      destination: { label: "Manage secrets", path: "secrets" },
    },
  ],
};
