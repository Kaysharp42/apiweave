# Scripting

*Run your own JavaScript on an HTTP Request node: just before the request is sent, to sign or rewrite it, and just after the response arrives, to turn values into variables or check things an Assertion node cannot express. For anyone testing an API that wants a request signature, a computed payload or a custom check.*

## Prerequisites

- An HTTP Request node. See [Workflows and Nodes](workflows-and-nodes.md#http-request).
- Workflow variables and extractors. See [Variables and Extractors](variables-and-extractors.md).

## When to script

Reach for a script when the built-in settings cannot do it:

- **Sign a request.** An API wants an HMAC of the method, URL, timestamp and body in a header.
- **Transform a value.** The next request needs a value built from several response fields, or reshaped.
- **Check something custom.** Every item in a list has a field, a total adds up, two values agree.

A value you can copy from a response path is an [extractor](variables-and-extractors.md), and a comparison against a fixed value is an [Assertion](workflows-and-nodes.md#assertion) node. Both are easier to read on the canvas than a script.

## Where scripts live

Open an HTTP Request node and choose the **Scripts** tab. Each request has two:

| Script | Runs | Reads | Can change |
|---|---|---|---|
| **Pre-request** | After placeholders are resolved and auth is applied, just before the request is sent. With [Retry](workflows-and-nodes.md#retry-and-polling), before every attempt. | `aw.request`, variables, environment, data row, named secrets | `aw.request` (method, URL, headers, body), variables |
| **Post-response** | Once the response arrives, after any retries and extractors. Not run when no response came back. | `aw.response`, variables, environment, data row, named secrets | variables |

Both editors highlight JavaScript. The **Script API** card beside them lists the API below, with an example of each script you can copy.

Scripts are stored in the node's `scripts` setting (`preRequest`, `postResponse`, `timeoutMs`), so they are exported with the workflow, and an agent can write them over MCP like any other node setting.

## The `aw` API

| API | What it does |
|---|---|
| `aw.request` | Pre-request only. `{ method, url, headers, body }`: the request as it would be sent, with placeholders resolved. Change it and the change is sent. `body` is the text body, or `null` when there is none or it is not text (form-data, a file); setting it to a string sends that string. |
| `aw.response` | Post-response only. `status` (also `statusCode`), `headers` (names in lower case), `body` (parsed JSON when the body was JSON, its text otherwise), `responseTime` in ms, `header(name)` (any case), `json()`, `text()`. |
| `aw.variables.get(name)`, `aw.variables.set(name, value)` | Workflow variables. A value you set is read by later nodes as `{{variables.name}}` and by later scripts. Values must be JSON: a string, number, boolean, null, array or object. |
| `aw.env.get(name)` | A variable of the selected environment. |
| `aw.data.get(column)` | A column of the current row in a [data-driven run](data-driven-runs.md). |
| `aw.secrets.get("NAME")` | A secret's value. See [Secrets](#secrets). |
| `aw.test(name, fn)` | A named check. It passes unless `fn` throws. Every test is recorded on the node's result; a failed one fails the node. |
| `aw.expect(value)` | Throws when the check does not hold: `.toBe(x)` (same value), `.toEqual(x)` (same JSON shape), `.toContain(x)` (substring, or array item), `.toMatch(regex or text)`, `.toBeGreaterThan(n)`, `.toBeLessThan(n)`, `.toBeTruthy()`, `.toBeDefined()`. Put `.not` in front to negate: `aw.expect(list).not.toContain(0)`. |
| `aw.crypto.hmacSha256(key, text, encoding?, keyEncoding?)` | HMAC-SHA256 of `text` (UTF-8). `encoding` is `"hex"` (default), `"base64"` or `"base64url"`. `keyEncoding` says how `key` is written: `"utf8"` (default), `"hex"` or `"base64"`, for APIs that issue the key as bytes. |
| `aw.crypto.sha256(text, encoding?)` | SHA-256 of `text`, encoded as above. |
| `aw.crypto.base64Encode(text)`, `aw.crypto.base64Decode(text)` | Base64 of UTF-8 text, and back. |
| `aw.crypto.uuid()` | A random UUID v4. |
| `console.log(...)` | Also `info`, `warn`, `error`, `debug`. Objects are printed as JSON. The output is kept on the node's result: the first 100 lines, each cut at 2,000 characters. |

The rest is standard JavaScript (ES2023): `JSON`, `Math`, `Date`, `RegExp`, `Array`, `Map` and so on.

### Sign a request

```js
const timestamp = String(Date.now())
const signature = aw.crypto.hmacSha256(
  aw.secrets.get("SIGNING_KEY"),
  timestamp + aw.request.method + aw.request.url + (aw.request.body ?? ""),
)
aw.request.headers["X-Timestamp"] = timestamp
aw.request.headers["X-Signature"] = signature
```

Because the script sees the request after placeholders are resolved, it signs exactly what is sent.

### Keep a computed value

```js
const order = aw.response.json()
aw.variables.set("lineCount", order.lines.length)
aw.variables.set("firstSku", order.lines[0].sku.toLowerCase())
```

### Check the response

```js
const users = aw.response.json().users
aw.test("every user has an email", () => {
  for (const user of users) aw.expect(user.email).toMatch(/@/)
})
aw.test("no duplicate ids", () => {
  aw.expect(new Set(users.map((u) => u.id)).size).toBe(users.length)
})
```

## When a script fails the node

The node fails, like a request that failed, when:

- a script throws, or hits its time or memory limit. The error names the script's line and column: `Post-response script failed: TypeError: cannot read property 'id' of undefined (line 3, column 22)`;
- an `aw.test` fails: `Post-response script: 1 of 3 tests failed`;
- a pre-request script leaves `aw.request` in a shape that cannot be sent (a header value that is not a string, an empty URL).

A pre-request script that fails stops the request: nothing is sent. A post-response script runs on a response that already failed too (a 404 you did not expect), and the node keeps the request's own reason. **Continue on failure** applies as it does to any failed request.

The output panel shows, for each script, its run time, its error, every test with its result, and its console output. Run history and [reports](visualization-and-debugging.md) carry the same results, and the MCP run summary counts a failed node's failed tests: JUnit lists each failed test in the failure text and puts console output in the test case's `<system-out>`, and the console reporter of [`apiweave run`](../guides/ci.md) prints both under a failed step.

## Secrets

A script reads a secret only by writing its name as a literal string: `aw.secrets.get("SIGNING_KEY")`. APIWeave resolves a run's secrets before it starts, so it reads the names from the script text the same way it finds `{{secrets.NAME}}` placeholders. A name built at run time (`aw.secrets.get(prefix + "_KEY")`) is not known in advance and reads `undefined`.

Because the names are found up front, a secret a script reads is treated like any other secret the workflow uses:

- it is masked as `<SECRET>` in console output, test messages, errors, variables and everything else stored or shown, as long as it appears as written (a value derived from it, such as its HMAC or its base64, is not recognized);
- it is listed as a required secret in an export, and `apiweave run` asks for it (`APIWEAVE_SECRET_NAME`) before sending anything;
- a run an agent starts over MCP that would read it waits for your approval (see below).

## Limits and the sandbox

Scripts run in a sandbox: QuickJS, a separate JavaScript engine compiled to WebAssembly, running inside the app (or the CLI) with its own memory. A script sees only the `aw` API and standard JavaScript. It has no network, no file system, no timers, no `require` or `import`, and nothing of the app.

- **Synchronous.** A script runs from top to bottom and ends. There is no `await`, `setTimeout` or `fetch`; an `aw.test` callback that returns a promise fails.
- **Time limit.** 1 second per script by default, up to 30 seconds (**Time limit** on the Scripts tab, `timeoutMs` in the node). A script still running then is stopped: `Script timed out after 1000 ms`. A script runs on the thread that runs the workflow, so keep scripts short.
- **Memory.** 32 MB per script. More fails with `Script ran out of memory (limit 32 MB)`, without affecting the app.
- **Fresh each time.** Every script runs in a new sandbox: nothing a script leaves on `globalThis` is seen by the next one. Pass values on with `aw.variables.set`.
- **Size.** A script holds at most 100,000 characters, a variable value set from a script at most 1 MB of JSON, and a script records at most 100 tests.

## Agents and scripts

An agent connected over [MCP](mcp-integration.md) can write scripts, since they are a node setting, and run them. A script is code the agent chose, so:

- a run an agent starts that would read a secret, from a script or a placeholder, waits for your approval, as before;
- when the workflow runs scripts, the approval dialog says so: a pre-request script can change a request and read the secrets it lists. It cannot send a request to a host the dialog did not list; such a request fails. Allow only workflows you trust.

An agent run whose scripts read no secret runs without asking, like any agent run that uses no secret: the sandbox gives a script no way to reach anything a workflow could not already reach.

## Coming from Postman

APIWeave's script API is modelled on Postman's, but it is not the same API, and imported `pm.*` scripts are not converted. The [Postman import](../guides/migrating-from-postman.md#scripts) keeps any script it could not turn into node settings in a **Postman scripts** note; you can port it by hand to the node's Scripts tab:

| Postman | APIWeave |
|---|---|
| Pre-request script | Pre-request script |
| Tests script | Post-response script |
| `pm.request.headers.add({key, value})` | `aw.request.headers[key] = value` |
| `pm.response.code`, `pm.response.json()` | `aw.response.status`, `aw.response.json()` |
| `pm.test(name, fn)`, `pm.expect(x).to.eql(y)` | `aw.test(name, fn)`, `aw.expect(x).toEqual(y)` |
| `pm.environment.set`, `pm.collectionVariables.set`, `pm.variables.set` | `aw.variables.set` (environments are not written from a run) |
| `pm.environment.get(name)` | `aw.env.get(name)`, or `aw.variables.get(name)` for a value set during the run |
| `CryptoJS.HmacSHA256(msg, key).toString()` | `aw.crypto.hmacSha256(key, msg)` |
| `pm.sendRequest(...)` | Not available: add another HTTP Request node. |

## Related

- [Workflows and Nodes](workflows-and-nodes.md)
- [Variables and Extractors](variables-and-extractors.md)
- [Environments and Secrets](environments-and-secrets.md)
- [Run tests in CI](../guides/ci.md)
- [Architecture](../reference/architecture.md)
