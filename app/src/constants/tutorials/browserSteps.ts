import type { TutorialChapter } from "../../types";

/**
 * Chapter 5 — Browser steps. Recording steps in a real browser, running them
 * in the same run as API requests and reading their evidence, and fixing one
 * step without recording the whole flow again.
 */
export const browserStepsChapter: TutorialChapter = {
  id: "browser-steps",
  title: "Browser steps",
  summary:
    "Record what a person does on a web page, run it beside your API requests, read what each step saw, and fix one step at a time.",
  lessons: [
    {
      id: "browser-record",
      chapterId: "browser-steps",
      title: "Record browser steps",
      summary:
        "The Record button, the start address, live steps in a Recording frame, recorder checks, and how typed values become {{env.*}} and {{secrets.*}}.",
      outcome:
        "You can record a sign-in flow in a real browser and get a chain of browser steps on the canvas that holds no typed password.",
      keywords: [
        "browser",
        "browser steps",
        "record",
        "recorder",
        "recording",
        "playwright",
        "ui test",
        "web page",
        "login",
        "check text",
        "needs secret",
        "save as secret",
      ],
      durationMinutes: 8,
      prerequisites: [
        "Google Chrome, Microsoft Edge or Playwright's Chromium on this machine.",
        "An environment that defines BASE_URL, and the test account's password stored as a secret.",
      ],
      steps: [
        {
          title: "Prepare the environment",
          instruction:
            "Select an environment in the canvas toolbar that defines BASE_URL and, for a sign-in, TEST_EMAIL. Store the account's password as a secret before you record.",
          detail:
            "The recorder never stores a value it can name instead, so values that already exist as variables or secrets come out as placeholders.",
        },
        {
          title: "Choose where the steps go",
          instruction:
            "Select exactly one node, such as Start, to record after it. With nothing selected the steps go below Start.",
          detail:
            "The steps are chained after that node, and whatever it was connected to follows the last recorded step, so recording after Start in a Start → End workflow gives Start → steps → End. That happens only when the node has exactly one outgoing connection.",
        },
        {
          title: "Start recording",
          instruction:
            "Click Record, the button with a red dot in the canvas toolbar. In the Record browser steps dialog, keep or edit the start address and click Start recording.",
          detail:
            "The address is prefilled with {{env.BASE_URL}}/ when the selected environment defines BASE_URL, and with https:// otherwise. It must start with http:// or https://.",
        },
        {
          title: "Use the page",
          instruction:
            "Click and type through the flow in the browser window. The toolbar reads Recording — N steps, and each action arrives as one step in a new frame named Recording <date and time>.",
          detail:
            "A page load becomes Open a page, a click becomes Click, typing becomes Type into a field (one step per field), and ticks, options, hover and key presses get their own steps. The step is titled after what it acts on, such as Fill Email, Click Continuer or Open /login, and a placeholder in that title reads as its variable or secret name. Clicking into a field before typing is not a step of its own.",
        },
        {
          title: "Let the recording add checks",
          instruction:
            "After a click or key press that changes the page, the recording adds one check after it: Check the page address when the path changed, otherwise Check it is visible on the message, dialog or heading that appeared, such as Expect Step 2 visible.",
          detail:
            "A run then waits for that change before the next step acts, so a page that swaps its content without changing the address does not race ahead. Nothing is added when nothing changed, or when the only new text holds a secret or a value you typed. If the steps still end on a click, the graph check notes browser_chain_without_check: add a check that proves the outcome.",
        },
        {
          title: "Record checks from the recorder toolbar",
          instruction:
            "Use the toolbar inside the page: Assert visibility records Check it is visible, Assert text records Check text, and Assert value on a form field records Check a field's value.",
          detail:
            "Assert text opens a small box prefilled with the element's text; confirm it with ✓ or Ctrl+Enter. Expected text that equals an environment variable becomes {{env.NAME}}, and a check that would hold a secret is not recorded.",
        },
        {
          title: "Let typed values become placeholders",
          instruction:
            "Type the test email and the password as you normally would. A value equal to an environment variable is saved as {{env.NAME}}, and one equal to a stored secret as {{secrets.NAME}}.",
          detail:
            "A page address that starts with an environment variable's URL becomes {{env.BASE_URL}}/login. A page address or an element locator that would show a secret is not recorded, and a toast says so.",
        },
        {
          title: "Resolve a needs secret badge",
          instruction:
            "Text typed into a password field that matches no secret becomes {{secrets.UNSET_PASSWORD_1}} and the step shows needs secret. Open the step and click Save as secret under Text to type, or type {{ there to pick an existing secret.",
          detail:
            "The typed value is discarded and never reaches the canvas. Until the secret is set, a run fails that step with {{secrets.UNSET_PASSWORD_1}} is not set.",
        },
        {
          title: "Stop the recording",
          instruction:
            "Press Stop in the toolbar, or close the browser window. The frame stays on the canvas as ordinary steps you can edit, move and run; Undo removes the recording.",
          detail:
            "Recording only adds steps: nothing runs until you click Run. A dialog the page opens is answered with OK, and the step that opened it is recorded with If the page asks for confirmation: Click OK.",
        },
      ],
      example: {
        caption: "What a recorded sign-in holds: one config per browser step",
        language: "json",
        code: '[\n  { "action": "navigate", "url": "{{env.BASE_URL}}/login" },\n  { "action": "fill", "locator": { "kind": "role", "role": "textbox", "name": "Email" }, "value": "{{env.TEST_EMAIL}}" },\n  { "action": "fill", "locator": { "kind": "role", "role": "textbox", "name": "Password" }, "value": "{{secrets.TEST_PASSWORD}}" },\n  { "action": "click", "locator": { "kind": "role", "role": "button", "name": "Sign in" } },\n  { "action": "expect-url", "url": "/dashboard", "match": "contains" },\n  { "action": "expect-text", "locator": { "kind": "role", "role": "heading", "name": "Dashboard" }, "text": "Dashboard", "match": "contains" }\n]',
      },
      expectedResult:
        "A Recording frame holds one browser step per action, chained into the workflow, with environment values and the password stored as placeholders rather than as typed text.",
      troubleshooting: [
        {
          title: "Record is disabled",
          instruction:
            "Another workflow is being recorded, a run is in progress, or the workflow is still loading. Stop the other recording or wait for the run to finish.",
        },
        {
          title: "The recording could not start",
          instruction:
            "The toast names the reason: the browser was not found, so choose another one in Settings → Browser, or the start page did not load.",
        },
        {
          title: "A check or an action was not recorded",
          instruction:
            "A check that would hold a secret or a password field's value is dropped. Actions in a popup or a new tab, file uploads, and the toolbar's checkbox-state and ARIA snapshot checks are not recorded yet; each shows a warning toast.",
        },
      ],
      relatedLessonIds: ["browser-run", "browser-fix", "secrets", "environments"],
    },
    {
      id: "browser-run",
      chapterId: "browser-steps",
      title: "Run browser steps with API requests",
      summary:
        "One page per run, one ordered chain, Settings → Browser, mixing steps with HTTP nodes, and reading the evidence every step keeps.",
      outcome:
        "You can run a workflow that calls the API and checks the page in the same run, and read what the page looked like at each step.",
      keywords: [
        "browser",
        "browser steps",
        "evidence",
        "screenshot",
        "aria snapshot",
        "accessibility tree",
        "chrome",
        "edge",
        "chromium",
        "headed",
        "show the browser",
        "browser_parallel_branches",
      ],
      durationMinutes: 7,
      prerequisites: [
        "A workflow with browser steps, such as the one from Record browser steps.",
      ],
      steps: [
        {
          title: "Choose the browser",
          instruction:
            "Open Settings → Browser. Leave Browser on Automatic to use the first of Chrome, Edge and Playwright Chromium that starts on this machine, or pick one.",
          detail:
            "A browser that could not start is marked not found. The setting belongs to this machine and is never part of a workflow or an export.",
        },
        {
          title: "Decide whether to watch",
          instruction:
            "Turn on Show the browser during runs to open a visible window for runs you start from the app. It is off by default.",
          detail: "Runs an agent starts always stay hidden.",
        },
        {
          title: "Keep the browser steps in one chain",
          instruction:
            "Connect every browser step so that any two are joined by a path. HTTP, assertion, delay and merge nodes may branch around them freely; the browser steps themselves cannot.",
          detail:
            "Two browser steps on parallel branches are reported as browser_parallel_branches, and a chain whose first step is not Open a page gets a warning. Steps on the pass and fail sides of one assertion are allowed, because a run takes only one side.",
        },
        {
          title: "Mix steps with API requests",
          instruction:
            "Put HTTP nodes before, between or after the chain. A request can create data and extract an id, and a later Check text can look for {{variables.orderId}} on the page.",
          detail:
            "The browser's cookies are its own: signing in on the page does not sign in an HTTP node, and the other way round. To carry a page value to a request, use a Save a value step.",
        },
        {
          title: "Run it",
          instruction:
            "Click Run. The first browser step launches the browser with a fresh, empty profile, every later step uses the same page, and the run closes the browser at the end, passed, failed or cancelled.",
          detail:
            "A Call Workflow target's browser steps run on the caller's page, so a login sub-workflow leaves the caller signed in.",
        },
        {
          title: "Read a step's evidence",
          instruction:
            "Double-click a browser step after the run. Its result pane shows Page title, Page address, Duration, Expected and found for a check, a Screenshot, and the Page structure (accessibility tree). A failed step adds Playwright's message. Click the screenshot to see it full size.",
          detail:
            "Evidence is kept for every step, pass or fail. The address's query string and fragment are replaced with <REDACTED>. To compare steps side by side, expand them on the canvas with their chevron: each shows its screenshot, address and, for a check, what it expected and found.",
        },
        {
          title: "Know what is masked",
          instruction:
            "Secrets and anything typed into a password field read <SECRET> in the stored result, and the screenshot paints over password fields and elements that show a masked value.",
          detail:
            "Screenshots stay with the run and are never exported. Other text the page displays is not covered.",
        },
        {
          title: "Run them in CI",
          instruction:
            "apiweave run runs browser steps headless. Add --browser chrome, msedge or chromium to pick the browser, --headed to watch locally, and --evidence-dir <dir> to write every step's screenshot and ARIA snapshot for the reports to link.",
        },
      ],
      example: {
        caption: "API and page checks in one run",
        language: "text",
        code: "[ Start ] -> [ POST /orders ]  extract orderId = response.body.id\n          -> [ Open /login ] -> [ Fill Email ] -> [ Fill Password ]\n          -> [ Click Sign in ] -> [ Expect orderId text ] -> [ End ]\n\nOpen any browser step afterwards: Page title, Page address, Screenshot,\nPage structure (accessibility tree), and Expected and found for a check.",
      },
      expectedResult:
        "The run sends the request, drives the page in one browser, and every browser step shows its own page address, screenshot and accessibility tree, passed or failed.",
      troubleshooting: [
        {
          title: "A step fails with no supported browser was found on this machine",
          instruction:
            "Install Google Chrome or Microsoft Edge, or Playwright's Chromium at the version the app uses, then pick it in Settings → Browser.",
        },
        {
          title: "A step fails with matches N elements",
          instruction:
            "The locator is not specific enough. Add hasText, pick one with nth, or scope it to a parent with within.",
        },
        {
          title: "The run is refused because nodes are on parallel branches",
          instruction:
            "Two things that drive the page, browser steps or calls into workflows with browser steps, never meet. Chain them one after another.",
        },
        {
          title: "A step fails with {{…}} is not set",
          instruction:
            "The placeholder could not be resolved. Check the spelling and the namespace, and that the selected environment defines it.",
        },
      ],
      relatedLessonIds: [
        "browser-record",
        "browser-fix",
        "runs-history",
        "git-ci",
      ],
      destination: { label: "Open Browser settings", path: "browser-settings" },
    },
    {
      id: "browser-fix",
      chapterId: "browser-steps",
      title: "Fix one browser step",
      summary:
        "Re-pick element, Re-record from here, Record after this step, Turn into extract and Make value a variable from a step's action menu, and editing a step by hand.",
      outcome:
        "When a page changes, you can repair the one step it broke instead of recording the whole flow again.",
      keywords: [
        "browser",
        "re-pick element",
        "re-record from here",
        "record after this step",
        "continue recording",
        "turn into extract",
        "make value a variable",
        "save a value",
        "locator",
        "replay",
        "fix step",
      ],
      durationMinutes: 6,
      prerequisites: [
        "A workflow whose browser chain starts with Open a page.",
        "The steps before the one you fix pass.",
      ],
      steps: [
        {
          title: "Open the step's menu",
          instruction:
            "Right-click a browser step on the canvas, or click its ⋯ button; both open the same menu. Next to Run from here, it offers Re-pick element, Re-record from here, Record after this step, Turn into extract and Make value a variable when they apply to that step.",
        },
        {
          title: "Understand the replay",
          instruction:
            "Re-pick element and Re-record from here save the canvas, then replay the workflow up to the step, not including it, in a visible browser; Record after this step replays the step too. The toolbar reads Replaying the steps… with Cancel.",
          detail:
            "The replay is an ordinary run with the selected environment and its secrets, and it appears in run history. The steps before must pass; if one fails, fix that one first.",
        },
        {
          title: "Re-pick the element",
          instruction:
            "Choose Re-pick element. When the toolbar reads Click the element in the browser, point at the element you want and click it. The step's element is replaced and nothing else changes.",
          detail:
            "Clicking picks the element without clicking it, so picking a Delete button deletes nothing. Undo takes the change back, and Cancel or closing the window changes nothing.",
        },
        {
          title: "Re-record from here",
          instruction:
            "Choose Re-record from here. After the replay, recording starts on the page as it was left, and the toolbar reads Recording — N steps with Stop. Record the new steps and press Stop.",
          detail:
            "The first new step replaces this step and the browser steps after it in a straight line, in one edit that a single Undo restores. The line stops at another kind of step, a step with more than one way out, or a step two connections lead into.",
        },
        {
          title: "Record after this step",
          instruction:
            "Choose Record after this step to add steps without replacing any. The replay runs this step too, recording starts on the page it left, and the new steps go between this step and whatever followed it.",
          detail:
            "Use it to extend a flow from its last step, or to insert steps in the middle of one. The step must have at most one way out, and not a condition's or an assertion's pass and fail outputs.",
        },
        {
          title: "Turn a step into an extract",
          instruction:
            "Choose Turn into extract on a step that acts on an element, enter a variable name (one is suggested from the element's name), and confirm. The step becomes Save a value.",
          detail:
            "A form field is read for its value and any other element for its text. A step that ticks or unticks a checkbox, or is already an extract, does not offer it. Later steps and requests read the value as {{variables.NAME}}.",
        },
        {
          title: "Make a value a variable",
          instruction:
            "Choose Make value a variable on a step that holds a literal. Pick the value if the step has several, name the variable, and leave Also replace the same value in N other steps on if those steps should use it too.",
          detail:
            "The literal moves into a workflow variable and the step reads it as {{variables.NAME}}, so you can try other data without editing the step. A variable already holding the value is reused. Value fields and locator fields are separate: a fill typing Search never rewrites the button named Search. A fill whose element looks like a password field is never offered.",
        },
        {
          title: "Edit a step by hand",
          instruction:
            "Double-click the step. On the Step tab, What this step does sets the action and the Element card sets the locator; on the Settings tab, set Wait up to (milliseconds) and Continue the run if this step fails.",
          detail:
            "Prefer a role and a name for the element, then a label, then a test id. A raw selector from the recorder, or CSS that picks an element by its position, breaks easily and is flagged with a notice.",
        },
        {
          title: "Run the fix",
          instruction:
            "Use Run from here on the fixed step, or click Run. A rerun that reaches a browser step replays the chain from its first browser step, because a page cannot be restored from an earlier run.",
        },
      ],
      example: {
        caption: "A step after Turn into extract",
        language: "json",
        code: '{ "action": "extract", "from": "text", "locator": { "kind": "role", "role": "heading", "name": "Order" }, "variable": "orderTitle" }',
      },
      expectedResult:
        "The repaired step finds the right element or reads its value into a variable, the steps around it are unchanged, and one Undo reverts the fix.",
      troubleshooting: [
        {
          title: "Re-pick element or Re-record from here is missing",
          instruction:
            "No browser step before it opens a page, the step has no element (for Re-pick), the step is on a branch or has more than one way in or out (for Re-record), or a recording or run is in progress.",
        },
        {
          title: "The replay stops with The steps before this one did not pass",
          instruction:
            "Open the run in history, fix the first failing step — a re-pick on it may be the fix — then try again.",
        },
        {
          title: "The picked element was not saved",
          instruction:
            "Its locator would show a secret or the start of one, or Playwright could not describe it. Pick an element near it, or edit the step's element by hand.",
        },
      ],
      relatedLessonIds: ["browser-record", "browser-run", "variables-extractors"],
    },
  ],
};
