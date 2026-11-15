# Browser Steps

*Drive a web page in a real browser as part of a workflow: open a URL, log in, click, type and check what the page shows, one node per step, mixed freely with HTTP nodes. For anyone who wants a check of a web page after a merge, against a dev environment, in the same workflow as their API checks.*

## Prerequisites

- [Workflows and Nodes](workflows-and-nodes.md) for the canvas, edges and running a graph.
- An environment holding the addresses and the test account you use, such as `BASE_URL` and `TEST_EMAIL`, and the account's password in a secret. See [Environments and Secrets](environments-and-secrets.md).
- Google Chrome, Microsoft Edge, or Playwright's own Chromium on the machine that runs the steps. [Settings > Browser](#settings--browser) says which one is used.

## Table of Contents

- [What Browser Steps Are](#what-browser-steps-are)
- [A Worked Example](#a-worked-example)
- [Recording Steps](#recording-steps)
- [Actions](#actions)
- [Finding an Element](#finding-an-element)
- [Placeholders and Secrets](#placeholders-and-secrets)
- [How a Run Uses the Browser](#how-a-run-uses-the-browser)
- [Graph Rules](#graph-rules)
- [When a Step Fails](#when-a-step-fails)
- [Agents](#agents)
- [Settings > Browser](#settings--browser)
- [On the CLI](#on-the-cli)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## What Browser Steps Are

A `browser` node is **one step in a web page**. It carries one `action` — open a page, click, type into a field, check some text — and the runner turns it into one Playwright call against a real Chrome, Edge or Chromium on your machine.

One node per step is deliberate. The canvas then reads as the list of things a person would do on the page, and each step has its own result, its own error and its own place to fix, instead of one opaque script to debug. A workflow can mix those steps with its HTTP nodes on one graph, so a single run can check the API and the page that uses it.

Add one from the **Add Nodes** panel: the **Browser** section has presets for **Open a page**, **Click**, **Type into a field**, **Check text** and **Save a value**. The node editor's action picker offers all thirteen actions below.

Browser steps check what a person sees, which an HTTP check cannot reach: that the form rendered, that the button is enabled, that the signed-in page shows the account's name. They are not a substitute for API tests — the same request sent through a page tells you less about the response than a request node does.

## A Worked Example

The flow this feature is built for: after a merge, sign in to the dev environment and check that the dashboard loaded. Five browser steps:

```json
[
  { "nodeId": "b1", "type": "browser", "config": { "action": "navigate", "url": "{{env.BASE_URL}}/login" } },
  { "nodeId": "b2", "type": "browser", "config": { "action": "fill", "locator": { "kind": "role", "role": "textbox", "name": "Email" }, "value": "{{env.TEST_EMAIL}}" } },
  { "nodeId": "b3", "type": "browser", "config": { "action": "fill", "locator": { "kind": "role", "role": "textbox", "name": "Password" }, "value": "{{secrets.TEST_PASSWORD}}" } },
  { "nodeId": "b4", "type": "browser", "config": { "action": "click", "locator": { "kind": "role", "role": "button", "name": "Sign in" } } },
  { "nodeId": "b5", "type": "browser", "config": { "action": "expect-text", "locator": { "kind": "role", "role": "heading", "name": "Dashboard" }, "text": "Dashboard", "match": "contains" } }
]
```

| Node | What it does |
| --- | --- |
| `b1` | The first browser step starts the browser and loads the login page. `{{env.BASE_URL}}` comes from the run's environment, so the same workflow points at staging or a local server without an edit |
| `b2` | Types the test account's email, also from the environment |
| `b3` | Types the password from a secret. The value never enters the workflow, a stored result or an export |
| `b4` | Clicks **Sign in** by its accessible name, not by position or styling |
| `b5` | Waits up to 10 seconds for the dashboard heading. A miss fails the run with the text it found last |

On the canvas the chain is:

```text
[ Start ] -> [ Open a page ] -> [ Type into a field: Email ] -> [ Type into a field: Password ]
          -> [ Click: Sign in ] -> [ Check text: Dashboard ] -> [ End ]
```

To run it, put `BASE_URL` and `TEST_EMAIL` in the environment selected in the toolbar, and store `TEST_PASSWORD` as a secret once. Nothing else is needed: there is no test script to write.

## Recording Steps

The canvas toolbar has a **Record** button beside the Run controls, marked with a red dot. It opens a dialog titled **Record browser steps** and asks for a start address, then opens a real browser window on that address with Playwright's recorder toolbar inside the page: click and type through the flow, and each action arrives on the canvas as a `browser` node. The address is prefilled with `{{env.BASE_URL}}/` when the selected environment, or a base environment it inherits from, defines `BASE_URL`, and with `https://` otherwise; `{{env.*}}` placeholders in it are filled from the selected environment, and it must start with `http://` or `https://`.

**Start recording.** The button opens a window in the browser chosen in [Settings > Browser](#settings--browser), with a fresh, empty profile and the same 1280×720 page a run uses. Recording is not a run: the steps are added to the workflow on the canvas, and nothing is executed until you run them.

**While it records.** The canvas toolbar reads **Recording — N steps** and carries a **Stop** button. One recording runs at a time in the whole app, so **Record** is disabled while another workflow is being recorded, while a run is in progress, and while the workflow is loading.

**What becomes a step.** Each action becomes one node, live, as it happens:

| What you do | The step |
| --- | --- |
| Load a page | **Open a page** |
| Click an element | **Click** |
| Type into a field | **Type into a field**, one step per field, updated as you type |
| Tick or untick a box | **Tick a checkbox** / **Untick a checkbox** |
| Choose an option | **Choose an option** |
| Move onto an element | **Hover** |
| Press a key | **Press a key**, with its modifiers: `ControlOrMeta+Enter` |
| Click **Assert visibility** in the recorder toolbar | **Check it is visible** |
| Confirm **Assert text** in the recorder toolbar | **Check text**, `contains` the confirmed text |
| Click **Assert value** on a form field | **Check a field's value** |

Clicking into a field before typing into it is not a step of its own.

**Checks.** The toolbar's assert buttons record a check on the element they name:

- **Assert visibility** records **Check it is visible**.
- **Assert text** opens a small box inside the page, prefilled with the element's text and editable. Confirming it with ✓, or with Ctrl+Enter — Enter adds a new line — records **Check text** with `match: "contains"` and the confirmed text. When Playwright reports a whole-text check, `match` is `equals`.
- **Assert value** on a form field records **Check a field's value** with the field's current value.

The expected text goes through the same substitution as a typed value:

- **Text equal to a variable of the selected environment becomes `{{env.NAME}}`** when the variable's value is four characters or more.
- **A check cannot hold `{{secrets.*}}`.** A check whose expected text is a secret of any length, or contains one, is not recorded, and a toast says "A step was not recorded because it contained a secret value."
- **A value check on a password field is not recorded**, and a toast says "A check on a password field was not recorded: it would have stored the password."

**Dialogs.** Every `alert()`, `confirm()` and `prompt()` the recorded page shows is answered with **OK**, and a prompt gets its default text. The click or key press that opened it is recorded with `dialog: "accept"`, shown in the step's panel as **If the page asks for confirmation: Click OK**, so the run does what the recording did. A toast says so once per recording and names the step to change. The recording itself always clicks OK: to record the Cancel path, record the flow, set that step to **Click Cancel**, then re-record or edit the steps after it.

If a dialog follows a step that cannot answer one — a page load, typing, a check — a toast says that dialog is cancelled when the workflow runs.

**Where the steps go.** They are collected in a new frame named `Recording <date and time>`, placed below the selected node when exactly one node is selected, or below Start, and the steps are chained after that node. Whatever that node was connected to follows the last recorded step, so recording after Start in a Start → End workflow gives Start → steps → End. That splice happens only when the node has exactly one outgoing connection; otherwise the steps are added as an extra branch. Steps are saved by auto-save like any other edit, and **Undo** removes them. A step deleted while recording stays deleted.

**Values.** The recorder never stores a value it can name instead.

- **A typed value equal to a variable of the selected environment becomes `{{env.NAME}}`.** Typing the test email that `TEST_EMAIL` holds gives `{{env.TEST_EMAIL}}`, and a page address that starts with an environment variable's URL becomes `{{env.BASE_URL}}/login`.
- **A typed value equal to a secret of the workspace or the selected environment becomes `{{secrets.NAME}}`**, and a secret inside longer text is replaced by its placeholder.
- **Text typed into a password field (`<input type="password">`) that matches no secret becomes `{{secrets.UNSET_PASSWORD_1}}`**, numbered, never reusing a name already in scope or in the workflow. The typed value is discarded and is never sent to the canvas, not even partly typed. The node shows a **needs secret** badge, and its **Text to type** field says the secret is not set, with a **Save as secret** button that opens the workspace secret form with that name filled in; or type `{{` in the field to pick an existing secret. Until it is set, a run fails that step with `{{secrets.UNSET_PASSWORD_1}} is not set` rather than typing the placeholder.
- **Text that ends in the beginning of a stored secret is held back** once it matches four characters or more, until it either completes the secret or stops matching. A recording that ends while text is still held back gives the step a placeholder secret, `{{secrets.UNSET_SECRET_n}}`.
- **A page address that contains a secret is not recorded, and neither is a step whose element locator would show one.** A toast says so.

The element the recorder picked becomes the same structured locator the node editor edits: role and name, label, placeholder, text, alt, title, test id, CSS, with **inside** parents, `nth` and iframe. When it has no structured equivalent it is kept as a raw `selector` locator (see [Finding an Element](#finding-an-element)).

**Not recorded.** Each shows a warning toast once per recording:

- Actions in a popup or a new tab. Browser steps drive one page.
- The toolbar's checkbox-state and ARIA snapshot checks. Neither has a browser step yet.
- File uploads.

**Saving a value.** The recorder toolbar has no save-a-value mode. Right-click any browser step on the canvas that acts on an element — it has a locator and is not already an extract — and its menu offers **Turn into extract**. It asks for a variable name, suggesting one made from the element's name: an element named "Order number" suggests `orderNumber`. The step keeps its element and becomes **Save a value** (`extract`): a form field — one a step typed into, chose an option in, or checked the value of — is read for its value, any other element for its text. The step's own fields are dropped — the typed text, the expected text, the click options, the dialog setting — while its `description`, `timeoutMs` and `continueOnFail` stay, and its title becomes **Save a value** unless it was renamed. Characters a variable name cannot hold are dropped from the name typed, and a name with no letter is refused. **Undo** takes the change back. Later steps read the value as `{{variables.NAME}}`. This works on a recorded step and on one added by hand.

**Finishing.** Press **Stop**, or close the browser window. The frame stays on the canvas as ordinary steps: edit them, move them, run them, or undo the recording. Recording is a desktop-app feature only — an agent cannot record over MCP and the CLI cannot record — and it never writes a workflow itself: the canvas inserts the steps.

## Actions

Each node has exactly one `action`. The table lists the action name as the workflow stores it, its fields, and what it does.

| Action | Fields | What it does |
| --- | --- | --- |
| Open a page (`navigate`) | `url` | `page.goto(url, { waitUntil: "load" })`. The URL must be an absolute `http://` or `https://` address. Default timeout 30 seconds |
| Click (`click`) | `locator`, plus optional `button` (`left`, `right`, `middle`), `clickCount` (1 to 3; 2 is a double-click), `modifiers` (`Alt`, `Control`, `ControlOrMeta`, `Meta`, `Shift`) and `dialog` | Clicks the element |
| Type into a field (`fill`) | `locator`, `value` | Replaces the field's contents with `value`; empty clears it. The only field on any step that accepts `{{secrets.*}}` |
| Press a key (`press`) | `key`, optional `locator`, `dialog` | Presses a Playwright key name such as `Enter`, `Tab`, `Escape`, `ArrowDown`, or a chord such as `Control+A`. With a locator the element is focused first; without one the page's keyboard is used |
| Choose an option (`select`) | `locator`, `values` | Selects one option by its value or its visible label. Several values select several options of a multi-select |
| Tick a checkbox (`check`) | `locator` | Checks the box |
| Untick a checkbox (`uncheck`) | `locator` | Unchecks the box |
| Hover (`hover`) | `locator` | Moves the pointer onto the element, for a menu that opens on hover |
| Check it is visible (`expect-visible`) | `locator`, optional `visible` (default `true`) | Waits until the element is visible, or with `visible: false` until it is hidden or gone |
| Check text (`expect-text`) | `locator`, `text`, optional `match` | Waits until the element's text matches. The check that a page loaded correctly |
| Check a field's value (`expect-value`) | `locator`, `value` | Waits until a form field holds exactly this value, for a prefilled form |
| Check the page address (`expect-url`) | `url`, optional `match` | Waits until the page's address matches, for a redirect after a sign-in |
| Save a value (`extract`) | `from` (`text`, `value`, `attribute`, `url` or `title`), optional `locator` and `attribute`, `variable` | Reads something off the page into a workflow variable, which later nodes read as `{{variables.<variable>}}` |

Every step also takes these three fields:

| Field | What it does |
| --- | --- |
| `timeoutMs` | The longest the step keeps trying, in milliseconds (100 to 300000). Default 10000, or 30000 for **Open a page** |
| `description` | Free text for the reader. The canvas label falls back to a generated summary — `click`, `type into`, `expect text contains` — with the element as Playwright code |
| `continueOnFail` | Whether a failed step lets the run continue down its outgoing edge. The run is still marked failed |

**Waiting.** Playwright waits for the element to exist, become visible and become clickable before acting, so a step does not need a Delay in front of it. `expect-*` steps keep reading the page until the condition holds or `timeoutMs` runs out, then fail with what was expected and what the page showed last.

**Text comparison.** Runs of whitespace in both texts are collapsed and the ends trimmed, so line breaks in the markup do not matter. `match` decides the rest:

| `match` | Passes when |
| --- | --- |
| `contains` (the default) | The element's text contains the expected text |
| `equals` | The two texts are the same |
| `matches` | The expected text is a JavaScript regular expression that matches. It runs in the same sandbox as the `matches` assertion operator, so a runaway pattern is stopped after 100 ms |

**Dialogs.** An `alert()`, `confirm()` or `prompt()` a step opens is **cancelled** unless the step says otherwise, which means a `confirm()` flow stops the way a person clicking Cancel would. Set `dialog` to `accept` on the `click` or `press` that opens it to click OK instead, or to `dismiss` to be explicit. In the node editor this is **If the page asks for confirmation**. A [recording](#recording-steps) answers dialogs with OK and records `accept` on the step that opened them.

## Finding an Element

A locator says which element a step acts on. It is structured rather than a string, so the node editor edits it field by field and it survives a restyle.

| `kind` | Finds | Playwright method |
| --- | --- | --- |
| `role` | An element by its accessible role, and optionally its accessible name | `getByRole(role, { name })` |
| `label` | A form field by its label | `getByLabel` |
| `placeholder` | An input by its placeholder text | `getByPlaceholder` |
| `text` | An element by its visible text | `getByText` |
| `testId` | An element by its test id, usually `data-testid` | `getByTestId` |
| `alt` | An image by its alt text | `getByAltText` |
| `title` | An element by its title attribute | `getByTitle` |
| `css` | An element by a CSS selector | `locator` |
| `selector` | A raw Playwright selector, produced by the recorder when nothing better exists | `locator` |

**Pick a role and a name first.** It is what the page exposes to a screen reader, it is what a person reads on the button, and it does not change when the layout does. Then `label` for a form field, then `testId` when the page has one, then `placeholder`, `text`, `alt` or `title`. `css` is the fallback when nothing names the element. `selector` exists so a recording never loses a step; do not write one by hand, and the graph check raises a notice when a step has one.

A role without a name is usually ambiguous — most pages have several `button` elements. Useful roles include `button`, `textbox`, `heading`, `link`, `checkbox`, `combobox`, `radio`, `tab`, `dialog`, `listitem`, `row`, `navigation` and `main`. The ARIA snapshot of a failed step lists the roles and names the page actually has.

`exact` is off by default, so `name` and the text kinds match case-insensitively as a substring. Set `exact: true` to require the whole string.

Four modifiers narrow a locator further:

| Modifier | What it does |
| --- | --- |
| `hasText` | Keeps only elements whose text contains this. Placeholders work in it |
| `nth` | Picks one match by zero-based index. `-1` is the last one |
| `within` | Searches inside a parent locator: the button in one specific table row |
| `frame` | The CSS selector of an iframe; the rest of the locator is searched inside its content |

They apply outside-in: `frame`, then `within`, then the kind, then `hasText`, then `nth`. A delete button in a named row:

```json
{
  "kind": "role",
  "role": "button",
  "name": "Delete",
  "within": { "kind": "role", "role": "row", "hasText": "{{variables.orderId}}" }
}
```

When more than one element matches and the step cannot tell them apart, it fails with a message that says how to fix it: `matches 3 elements; add hasText, nth or within to pick one`. The node editor and the canvas display a locator as the Playwright code it becomes, such as `getByRole('button', { name: 'Save' })`.

## Placeholders and Secrets

Placeholders work in every text field of a step: the URL, a fill's value, expected text, expected values, the options of a select, and every locator value and `hasText`.

| Namespace | Where it resolves from | Example |
| --- | --- | --- |
| `{{env.*}}` | The environment selected for the run | `{{env.BASE_URL}}/login` |
| `{{variables.*}}` | A workflow variable, from the workflow's own definitions or an `extract` step | `{{variables.orderId}}` |
| `{{prev.*}}` | The result of the previous node | `{{prev.response.body.id}}` |
| `{{secrets.*}}` | The local secret store. **Only in a fill's value** | `{{secrets.TEST_PASSWORD}}` |

- **A secret anywhere else fails the step** before the page is touched: `{{secrets.*}} is only allowed in a fill step's value`. A page address, a locator or an expected text cannot reference one.
- **An unresolved placeholder fails the step** instead of being typed or navigated to, whatever its namespace — an environment variable, a workflow variable, `{{prev.*}}`, a direct node reference such as `{{order.response.body.id}}`, or a function the run does not know: `{{env.TEST_EMAIL}} is not set`.
- **A password belongs in a secret.** A literal typed into a password field is masked in the run's stored results anyway, and password boxes are painted over in screenshots, but a literal in the node travels in `.aweproject` exports and git.
- **`extract` is how a page value reaches the rest of the workflow.** `Save a value` writes `{{variables.<variable>}}`, which a later HTTP node, assertion or `expect-text` reads like any other variable. It also counts as that variable's producer, so the graph check does not report it missing.

```json
{ "nodeId": "b6", "type": "browser", "config": { "action": "extract", "from": "text", "locator": { "kind": "role", "role": "heading", "name": "Order" }, "variable": "orderTitle" } }
```

## How a Run Uses the Browser

- **One browser per run.** The first browser step launches it, every later browser step of the run uses its page, and the run closes it at the end, whether the run passed, failed or was cancelled. A workflow with no browser steps never starts one.
- **One step at a time.** Steps run in graph order on one page, so each acts on what the earlier ones left behind. Two steps cannot run at the same time (see [Graph Rules](#graph-rules)).
- **A fresh, empty profile.** The browser starts with no cookies and no signed-in account: your own profile, logins and extensions are never touched, so each run starts signed out.
- **Call Workflow shares the page.** A sub-workflow's browser steps run on the caller's page, so a login sub-workflow leaves the caller signed in. A call therefore belongs to the browser chain: two calls with browser steps must not sit on parallel branches (see [Graph Rules](#graph-rules)). A **For each** with a `concurrency` above 1 refuses a target that has browser steps, because its iterations would fight over one page; `concurrency: 1` shares the page like any other call.
- **The browser's cookies are its own.** The run's HTTP nodes keep using the run's cookie jar, not the browser's. Signing in on the page does not sign in an HTTP node, and signing in through an HTTP node does not sign in the page — carry a value across with `extract` when a request needs it.
- **Each run and each data-driven iteration gets its own browser**, launched fresh, so no two of them share a signed-in state.
- **A rerun reaches back to the first browser step.** A page cannot be restored from an earlier run, so rerunning from a node that leads to a browser step replays the chain from its first step, while everything before it keeps the earlier run's results.
- **Load runs refuse a workflow with browser steps**, in the app and on the CLI: each iteration would start a real browser, and the load run would measure this machine rather than the service.

## Graph Rules

Browser steps share one page, so they must form **one ordered chain**: any two browser steps in a workflow are connected by a path. HTTP, assertion, delay and merge nodes may branch around them freely; the browser steps themselves cannot. A **Call Workflow** node whose target has browser steps, directly or through further calls, drives the same page, so it is part of the chain too: two such calls on parallel branches, or one beside a browser step, are the same error.

The graph check reports three things. An agent sees them from `workflow_diagnose`, and from the `diagnosis` member of every graph write.

| Code | Severity | Meaning |
| --- | --- | --- |
| `browser_parallel_branches` | error | Two page-driving nodes are on parallel branches, so neither reaches the other. Connect them into one chain. Counts `browser` steps and Call Workflow nodes whose target has browser steps |
| `browser_chain_starts_without_navigate` | warning | The first browser step is not **Open a page**, so it runs on a blank page. Add a navigate step, or ignore it when a Call Workflow before it opens the page |
| `browser_selector_fallback` | notice | A step finds its element with a raw recorder `selector`, which breaks easily. Replace it with a role, label or test id locator |

Steps on the **pass** and **fail** sides of one assertion are allowed. A run takes one side of the assertion, so those steps never run together; the check knows the difference between that and a genuine parallel branch.

The runner refuses the same graph before any node runs, with a value-free error starting with `Browser step:`, so a run cannot interleave two calls on one page just because the graph was edited over MCP or in the JSON editor.

The `diagnosis` member of every graph write can see the called workflows, so it also reports a Call Workflow node beside another page-driving node. A diagnosis run from the canvas cannot read other workflows, so it compares `browser` steps only; the runner still refuses the graph when it starts.

## When a Step Fails

A failed step's error is one value-free sentence starting with `Browser step:` that names the action and the locator as Playwright code, for example `Browser step: the text of getByRole('heading', { name: 'Dashboard' }) did not contain the expected text within 10s`. Page content and resolved values are not in it. The step's result pane carries the evidence:

| Item | What it holds |
| --- | --- |
| Expected and found | For `expect-*`, what the step waited for and what the page showed last. A missing element reads as nothing found |
| Page address and title | Where the page was after the step. The address keeps its path; its query string and fragment are replaced with `<REDACTED>`, because they can carry tokens |
| Playwright's message | Playwright's own account of the failure: which element matched, which action it waited on |
| Page structure | The page's ARIA (accessibility) tree, capped at 64 KB — what the page offered to a locator, role by role |
| Screenshot | A JPEG of the viewport, with password fields, every field a secret was typed into and every element showing a masked value painted over |
| Note | Present when part of the evidence could not be captured, for example when the page was gone before the screenshot |

**Masking.** Secrets and every value typed into a password field are replaced with `<SECRET>` in the stored result, the ARIA snapshot included. The screenshot is taken with every password field painted over, every field a fill typed a secret into — an API key box, say — and every element that shows a masked value painted over too, because an image cannot be masked after it is taken.

**The screenshot is stored with the run**, shown in the step's result pane, deleted when the run is deleted, and never part of an export, a JUnit report or an HTML report. It is taken only on failure, is at most 1 MB, and is dropped with a note when it is larger.

**One limitation worth knowing.** Pixels are covered, not masked. Password fields, and any element showing a value the run masks — a secret, a typed password, an OAuth token — are painted over before the JPEG is taken. Other sensitive text the page displays is not, and the covering reaches the main frame only, so a secret shown inside an iframe stays visible. See [Known Limitations](../reference/known-limitations.md#browser-steps).

## Agents

An agent connected over MCP can build and repair browser steps by looking at the page, instead of guessing locators from the frontend code.

- **`browser_inspect`** runs the workflow headless up to a browser step — or the whole workflow when no step is given — and returns the page it left open: address, title and the page's accessibility tree, with secrets masked. The agent reads role and label locators from that tree, which is the same one Playwright's own recorder picks locators from. It sends real traffic and records a run, like `runs_create`, and asks before sending secrets. There is no way to open an arbitrary address: add an **Open a page** step and inspect after it.
- **Failure evidence** reaches the agent from `workflows_debugContext` and from `runs_getNodeResult` with `sections: ["browser"]`: the expected and found values, Playwright's message, the page address and title, and the masked accessibility snapshot at the failure. The screenshot is opt-in (`screenshot: true` with one step) and arrives as an image rather than text.
- **The loop.** Write the page address and the login steps, inspect the page, add the next steps from what it shows, and run. On a failure, patch only the failing step and rerun: a rerun that reaches a browser step replays the chain from its first step.

Agent runs are always headless, and a run that sends secrets is confined to the hosts the user approved for it — see [Agent runs](#settings--browser) and [MCP Integration](mcp-integration.md).

## Settings > Browser

**Settings > Browser** decides which browser runs the steps. It is per machine, like the network settings, and is never part of a workflow, a project bundle or an export.

| Setting | What it does |
| --- | --- |
| Browser | **Automatic** (the default) launches the first of Chrome, Edge and Playwright's Chromium that starts on this machine. Or pick one explicitly. The page marks a browser it could not start as **not found** |
| Show the browser during runs | Off by default. When on, runs you start from the app open a visible window so you can watch the steps. Runs an agent starts always stay hidden |

If the chosen browser is missing, the step fails with a message naming it: `Microsoft Edge was not found on this machine. Choose another browser in Settings → Browser, or pass --browser to apiweave run.`

**Agent runs.** A run an agent starts over MCP is always headless, whatever this setting says, so no window opens on your screen. Such a run is also confined to the hosts you approved for it: a `navigate` step to another host, or a secret typed into a page — or into an iframe — on another host, fails with `… was refused: this run may only reach the hosts approved for it`.

## On the CLI

`apiweave run` runs browser steps with the same runner as the app, under plain Node:

```bash
apiweave run api.aweproject --env Staging --browser msedge
apiweave run api.aweproject --env Staging --headed
```

| Option | What it does |
| --- | --- |
| `--browser <chrome\|msedge\|chromium>` | Which browser to drive. Default: the first of `chrome`, `msedge`, `chromium` that starts |
| `--headed` | Show the browser window while the steps run |

The machine needs Google Chrome or Microsoft Edge installed, or Playwright's Chromium (`npx playwright install chromium`). A missing browser exits with an error naming it. The console, JUnit and HTML reports carry the step's error like any other node's, but not the screenshot yet. See [Run APIWeave Tests in CI](../guides/ci.md#browser-steps).

## Limitations

- **Chromium family only.** Firefox and WebKit are not supported.
- **One page.** Popups and new tabs are not supported: a step that opens one closes it and fails with "the step opened a new tab or window".
- **No files.** Uploading and downloading files, and drag and drop, are not supported.
- **No visual diffs.** Steps compare text, values and visibility, not pixels.
- **No saved login state.** Every run starts signed out, so sign in with steps, ideally once, in a sub-workflow called through **Call Workflow**.
- **Network settings do not apply.** `Settings > Network`'s proxy, CA certificates and client certificates are not used by browser steps; the browser uses the machine's own network configuration.
- **Recording covers one page.** Actions in a popup or a new tab, the toolbar's checkbox-state and ARIA snapshot checks, and file uploads are not recorded yet; each shows a warning toast once per recording.
- **A recording always clicks OK on a dialog.** Record the flow, then set the step that opened the dialog to **Click Cancel** and re-record or edit the steps after it.
- **Only password fields are treated as passwords.** Text typed into a field that is not an `<input type="password">` is stored as typed, unless it matches an environment variable or a secret. Save a value as a secret before recording and it is recorded as `{{secrets.NAME}}`.
- **Only `type="password"` fields are treated as passwords.** A secret typed into an ordinary text field is recorded as text, unless it is saved as a secret first, in which case it becomes `{{secrets.NAME}}`.

The [Known Limitations](../reference/known-limitations.md#browser-steps) page keeps the same list with the rest of the product's boundaries.

## Troubleshooting

- **If a step shows `needs secret`**, its typed password matched no secret. Set it with **Save as secret**, or type `{{` in **Text to type** to pick one; until then a run fails with `{{secrets.UNSET_PASSWORD_1}} is not set`.
- **If Record is disabled**, another workflow is being recorded, a run is in progress, or the workflow is loading. Stop the other recording or wait for the run to finish.
- **If a recorded check was not recorded**, its expected text would have held a secret or a password field's value, or it was a checkbox-state or ARIA snapshot check, which has no step. Add an expect step by hand, reading the value from `{{env.*}}` or `{{variables.*}}`.
- **If Turn into extract is missing from a step's menu**, the step has no element — a page load, or a key press without one — or is already an extract, or its element is half-filled in.
- **If the recording could not start**, the toast names the reason: the browser was not found, so choose another one in **Settings → Browser**, or the start page did not load.
- **If a step fails with `no supported browser was found on this machine`**, install Google Chrome or Microsoft Edge, or run `npx playwright install chromium`, then pick it in **Settings > Browser**.
- **If a step fails with `… was not found on this machine`**, the chosen browser is not installed. Choose another one, **Automatic**, or pass `--browser` on the CLI.
- **If a step fails with `matches N elements; add hasText, nth or within to pick one`**, the locator is not specific enough. Add the visible text with `hasText`, pick one with `nth`, or scope it to a parent with `within`.
- **If a step fails with `{{…}} is not set`**, that placeholder could not be resolved: the run's environment or the workflow has no such variable, the node a direct reference names has not run yet, or the function is unknown. Check the spelling and the namespace it reads from.
- **If a step fails with `{{secrets.*}} is only allowed in a fill step's value`**, the secret is in a URL, a locator or a check. Move the value into a fill, or read the page's value with an `extract` step instead.
- **If a click times out because another element covers it**, a banner, a cookie notice or a modal is on top. Add the step that dismisses it before the click.
- **If `browser_parallel_branches` appears**, two things that act on the page — browser steps, or calls into workflows with browser steps — are on branches that never meet. Join them into one chain.
- **If a run is refused with `Browser step: these nodes drive the run's page but are on parallel branches`**, the graph check found the same thing at run time: chain the named nodes one after another.
- **If `browser_chain_starts_without_navigate` appears**, the first browser step acts on a blank page. Add **Open a page** at the start of the chain.
- **If a load run is refused with `A load run cannot run a workflow with browser steps`**, run the workflow normally or from the CLI; load runs are for HTTP timing.
- **If a For each node fails with `a for-each with concurrency above 1 cannot call a workflow with browser steps`**, set its concurrency to 1, or move the browser steps out of the target.
- **If a step passed on your machine and fails in CI**, the page content differs, not the browser: run with `--headed` locally to watch the same steps, and check the environment the CI run selects.

## Related

- [Workflows and Nodes](workflows-and-nodes.md): the `browser` node beside the other node types, and how a run moves through a graph.
- [Environments and Secrets](environments-and-secrets.md): the environment a step's `{{env.*}}` reads and the secret store behind `{{secrets.*}}`.
- [Placeholders](../reference/placeholders.md): the four namespaces and the substitution order.
- [Known Limitations](../reference/known-limitations.md#browser-steps): the browser boundary, beside every other one.
- [Run APIWeave Tests in CI](../guides/ci.md#browser-steps): `--browser` and `--headed` in a pipeline.
