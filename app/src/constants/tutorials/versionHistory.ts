import type { TutorialChapter } from "../../types";

/**
 * Chapter 6 — Version history and sync. Keeping a workspace in git: tracking
 * it, connecting a remote, opening it on another machine, settling a merge,
 * and running a checkout in CI.
 */
export const versionHistoryChapter: TutorialChapter = {
  id: "version-history",
  title: "Version history and sync",
  summary:
    "Keep a workspace's history in git, share it through a remote, and run it from a checkout.",
  lessons: [
    {
      id: "git-track",
      chapterId: "version-history",
      title: "Track a workspace in git",
      summary:
        "Turn version history on, choose automatic or manual commits, name your commits, and see what a commit holds and what never reaches it.",
      outcome:
        "Every change to the workspace is a commit in a local git repository you can browse with any git tool, and no secret value is in it.",
      keywords: [
        "version history",
        "git",
        "track",
        "track this workspace",
        "commit",
        "commit automatically",
        "commit now",
        "auto",
        "manual",
        "repository",
        "history",
        "secret",
        "<secret>",
      ],
      durationMinutes: 6,
      prerequisites: ["Git installed on this machine."],
      steps: [
        {
          title: "Open the version history panel",
          instruction:
            "Open Settings from the left navigation rail and choose Version history (git) under Workspace.",
          detail:
            "The settings row, the page header and the panel all read Version history (git).",
        },
        {
          title: "Track the workspace",
          instruction:
            "Click Track this workspace. The first commit holds the whole workspace.",
          detail:
            "The repository is an ordinary git repository in the app's data folder at <userData>/git/<workspace id>/, where <userData> is %APPDATA%\\APIWeave on Windows, ~/Library/Application Support/APIWeave on macOS and ~/.config/APIWeave on Linux. It is browsable with any git tool, and only APIWeave should write there.",
        },
        {
          title: "Choose when commits happen",
          instruction:
            "Leave Commit automatically on to commit about 30 seconds after your last edit, or turn it off to commit only when you choose.",
        },
        {
          title: "Commit by hand in manual mode",
          instruction:
            "With Commit automatically off, Sync now (Commit now while there is no remote) commits. With edits waiting it first lists what the commit would hold by record name, takes an optional Commit message, and commits with Commit and sync (Commit with no remote).",
          detail:
            "Leave the message empty and the commit names the files it changed. With nothing waiting, Sync now just syncs, and a local history with nothing uncommitted has nothing to commit and offers no action.",
        },
        {
          title: "Name your commits",
          instruction:
            "If git does not know who you are, the panel asks once for Your name and Your email address and saves them in this workspace's repository only, with Save and commit.",
          detail:
            "Your global git configuration is not touched, so commits elsewhere are unaffected.",
        },
        {
          title: "Look at what a commit holds",
          instruction:
            "Open the repository with any git tool: each commit is a tree of JSON files — workspace.json, projects/, workflows/ and environments/ — plus .apiweave/format.json marking the folder as a workspace repository.",
          detail:
            "Files are named <slug>--<id>.json, with sorted keys and lists, rounded positions, 2-space indent and LF line endings, so a change reviews as a small diff. A README or CI configuration you keep there is left alone.",
        },
        {
          title: "Keep credentials out of it",
          instruction:
            "Reference secrets as {{secrets.NAME}}. The reference stays as written, so the repository says which secrets a workflow uses without holding a value.",
          detail:
            "A credential typed straight into a request or variable is withheld as <SECRET>, or a secret-named header is left out. Secret values, their ciphertext and keys, user-scoped environments, run history, node presets, agents, workflow revisions and an environment's base environment are never written.",
        },
        {
          title: "Know what Stop tracking does",
          instruction:
            "Stop tracking asks first, then deletes the repository and every commit in it. The workspace itself is not changed.",
          detail:
            "Tracking again starts a new history, so a remote holding the old one no longer has anything in common with it.",
        },
      ],
      example: {
        caption: "What tracking gives you, and what it leaves out",
        language: "text",
        code: "Settings → Workspace → Version history (git)\n\nRepository on this machine   <userData>/git/<workspace id>/\nCommit automatically on      a commit about 30 seconds after your last edit\nCommit automatically off     only Sync now (Commit now) commits\nIn a commit                  workspace.json, projects/, workflows/, environments/\nNever in a commit            secret values; {{secrets.NAME}} stays a reference",
      },
      expectedResult:
        "The workspace has a local git history you can browse with any git tool, each edit committed on the schedule you chose, and no secret value in any commit.",
      troubleshooting: [
        {
          title: "A commit asks who you are",
          instruction:
            "Enter a name and email in the panel's form and save; they are written into this workspace's repository only.",
        },
        {
          title: "A request sends <SECRET>",
          instruction:
            "The repository holds a withheld credential. Replace it with a {{secrets.NAME}} reference in the app; the next commit writes the reference.",
        },
        {
          title: "Old history is gone after Stop tracking",
          instruction:
            "Stop tracking deletes the repository and its commits by design. Track again for a new history, and connect a fresh empty remote rather than the one holding the old history.",
        },
      ],
      relatedLessonIds: ["workspaces", "secrets", "git-remote", "import-export"],
      destination: { label: "Open Version history", path: "version-history" },
    },
    {
      id: "git-remote",
      chapterId: "version-history",
      title: "Connect a remote and sync",
      summary:
        "Create an empty repository, connect it with an accepted URL, know what a sync cycle does, and read the status the header reports.",
      outcome:
        "The workspace keeps a remote repository in step with it, and you can tell from the header what it is doing and what to do when it stops.",
      keywords: [
        "remote",
        "connect to remote",
        "remote url",
        "disconnect",
        "sync",
        "sync now",
        "retry",
        "fetch",
        "push",
        "pull",
        "branch",
        "read-only",
        "five minutes",
        "sync status",
      ],
      durationMinutes: 8,
      prerequisites: [
        "A tracked workspace with at least one commit.",
        "An empty repository on a git host: no README, no first commit.",
      ],
      steps: [
        {
          title: "Pick a repository, or create one",
          instruction:
            "In Version history (git), choose the Account to connect as, then the Repository from its list, and click Connect to remote.",
          detail:
            "The list holds the account's empty repositories it can push to. Create repository… above the list makes a new empty one on the host for you, and Use a URL instead takes any other repository's URL, or another host's, signed in with your own git credentials.",
        },
        {
          title: "Know what the connect does",
          instruction:
            "An empty repository receives the workspace's history on main and becomes the sync target. One that already holds this workspace's history is joined as it is and syncs both ways.",
          detail:
            "A URL took directly must be one of https://host/owner/repo.git, ssh://git@host/owner/repo.git, git@host:owner/repo.git or file:///path/to/repo.git; plain http:// and git://, a bare path, and a URL carrying a user name or password are refused. A refused connection leaves the workspace unconnected and its history untouched.",
        },

        {
          title: "Sync on demand",
          instruction:
            "Click Sync now in the header's popover or in the panel to run a cycle immediately. In manual mode with edits waiting it opens the commit dialog first.",
          detail:
            "Retry is Sync now under another name: it is offered after a failure and when a push was refused.",
        },
        {
          title: "Know the automatic cycle",
          instruction:
            "In auto mode a commit about 30 seconds after your last edit starts a cycle: fetch the remote's branch, bring its changes in, then push yours. The app also runs a cycle when it launches and every 5 minutes while it is open.",
          detail:
            "In manual mode the launches and the interval only fetch, so the header can report how many commits are waiting; Sync now is what commits and pushes.",
        },
        {
          title: "Read the sync status in the header",
          instruction:
            "The header shows the workspace's state as an icon and a word. Click it for an explanation, when the workspace last synced, its last commit, and a link to Version history settings.",
          detail:
            "With a remote it reads Synced, Pending, Pending (N to push) when only commits are waiting, Syncing, Incoming (N) when the remote has new commits in manual mode, Merge needed, Diverged, Read-only or Sync error. With no remote it reads Local history, Local history · uncommitted, Committing or Commit error. Commit now is offered only while edits are waiting, so a settled local history has nothing to commit and offers no action, and Commit error offers Retry.",
        },
        {
          title: "Handle a refused push",
          instruction:
            "If the host refuses a push, the workspace becomes Read-only. Edits still save and commit here, the remote's commits still come in and merge, and automatic cycles stop pushing.",
          detail:
            "Retry still attempts the push, in either mode. Only a push that sends commits and succeeds clears Read-only; one that sends nothing proves nothing, so the flag stays.",
        },
        {
          title: "Disconnect or discard",
          instruction:
            "Disconnect removes the remote after you confirm and keeps every local commit. Discard local changes asks first, then throws away this device's commits and uncommitted edits for the remote's version.",
          detail:
            "Discarding cannot be undone. The Branch field shows the branch and does not choose it.",
        },
      ],
      example: {
        caption: "Remote URL forms, and the ones that are refused",
        language: "text",
        code: "https://host/owner/repo.git        HTTPS\nssh://git@host/owner/repo.git      SSH\ngit@host:owner/repo.git            SSH, scp-like\nfile:///path/to/repo.git           a drive or share\n\nRefused: http://, git://, a bare path, a URL with credentials",
      },
      expectedResult:
        "The workspace pushes to the remote on its own schedule and brings other machines' commits in, and the header says what it is doing and what to do when it stops short.",
      troubleshooting: [
        {
          title: "Connecting says Commit the workspace once before connecting a remote",
          instruction:
            "The workspace has no commit yet, because git did not know who you are when tracking started. Enter a name and email in the panel, then connect again.",
        },
        {
          title: "Connecting fails with an authentication error",
          instruction:
            "Git could not sign in to the host without asking. Sign in once with your usual git tool, or add an SSH key for the host, then connect again.",
        },
        {
          title: "The header says Read-only",
          instruction:
            "The host does not accept pushes from your account to that repository, or the branch is protected. Read-only clears on the next push that sends commits and succeeds.",
        },
        {
          title: "The sync says someone pushed at the same moment",
          instruction:
            "The remote moved during the push. Retry to bring their changes in first.",
        },
        {
          title: "The header says Merge needed",
          instruction:
            "Both sides changed the same field differently. Review merge is covered in the merge lesson.",
        },
      ],
      relatedLessonIds: ["git-track", "git-merge", "git-open"],
      destination: { label: "Open Version history", path: "version-history" },
    },
    {
      id: "git-open",
      chapterId: "version-history",
      title: "Open a workspace from git",
      summary:
        "Clone a workspace repository from the workspace switcher, know what the open checks, and set the secrets the repository references.",
      outcome:
        "A workspace another machine pushed opens here with its projects, workflows and environments, and runs once its secrets are set.",
      keywords: [
        "open from git",
        "clone",
        "second machine",
        "repository",
        "workspace switcher",
        "import",
        "secrets",
        "already in apiweave",
        "default branch",
      ],
      durationMinutes: 6,
      prerequisites: [
        "A repository that holds a workspace, such as one a teammate pushed.",
        "Access to that repository from this machine.",
      ],
      steps: [
        {
          title: "Start the open",
          instruction:
            "Open the workspace switcher at the top of the sidebar and choose Open from git…. When no workflow is open, the empty state offers the same button.",
        },
        {
          title: "Pick the repository",
          instruction:
            "Choose the Account to open it as, then the Repository from its list, and click Open workspace.",
          detail:
            "The list holds the account's repositories tagged apiweave-workspace — the topic APIWeave gives the repositories it creates; Show all repositories lists the rest, and Use a URL instead takes any other repository's URL in the forms Connect to remote accepts. Only the repository's default branch is opened.",
        },
        {
          title: "Know what is checked first",
          instruction:
            "The repository is cloned into a scratch folder and checked: .apiweave/format.json must be there at a format version this app reads, and every file the format reads must be valid.",
          detail:
            "Otherwise the open is refused, the message names the file and the problem, and nothing is left behind.",
        },
        {
          title: "Know what is created",
          instruction:
            "The workspace takes the id its workspace.json holds and imports its projects, workflows and environments. If its name's slug is taken, the new one gets -2, then -3.",
          detail:
            "The clone moves to <userData>/git/<workspace id>/, and the workspace is tracked in auto mode and connected to that URL on the branch the clone is on.",
        },
        {
          title: "Handle a workspace that is already here",
          instruction:
            "If the repository's workspace is already in the app, the dialog says This workspace is already in APIWeave and names it. Open it goes there and Back returns to the URL; nothing in the app changes.",
        },
        {
          title: "Review what the import reports",
          instruction:
            "When the import has something to report — a credential withheld as <SECRET>, or a default environment it had to pick — the dialog lists it before switching. Open workspace switches to it; Close leaves you where you are.",
          detail:
            "With nothing to report the app switches straight to the new workspace.",
        },
        {
          title: "Set the secrets it references",
          instruction:
            "Secret values are not in a repository, so the workspace starts with none. Add each {{secrets.NAME}} it references in Settings → Secrets for this workspace, and replace any credential written as <SECRET>.",
        },
        {
          title: "Let it sync from then on",
          instruction:
            "Treat it as any connected workspace: later cycles push your commits and bring in other people's.",
        },
      ],
      example: {
        caption: "What the open gesture is called at each step",
        language: "text",
        code: "Sidebar workspace switcher   Open from git…\nModal                        Open workspace from git\nField                        Account, then Repository\nPrimary action               Open workspace\n\nCreated as   a new workspace, id from workspace.json\nTracked      auto mode, connected to the URL and its branch\nStarts with  no secrets",
      },
      expectedResult:
        "The repository opens as a new workspace with its projects, workflows and environments in place, syncing with the same remote as the machine that pushed it, and only its secrets left to add.",
      troubleshooting: [
        {
          title: "Opening says .apiweave/format.json is missing",
          instruction:
            "The repository is empty or holds something other than a workspace. Check the URL, and that the workspace is on the repository's default branch.",
        },
        {
          title: "Opening says the repository was written by a newer APIWeave",
          instruction:
            "It uses a format version this build does not read. Update the app.",
        },
        {
          title: "Opening names a file as invalid",
          instruction:
            "That file was edited by hand or has an unresolved merge conflict. Fix it in the repository.",
        },
        {
          title: "Opening fails with git clone failed",
          instruction:
            "Git's own message follows: an unreachable host, a repository that does not exist, or a sign-in git could not complete without asking. Sign in once with your usual git tool.",
        },
        {
          title: "Secret references resolve to nothing",
          instruction:
            "The repository holds references, never values. Add each one in Settings → Secrets for the workspace before running.",
        },
      ],
      relatedLessonIds: ["git-track", "git-remote", "secrets", "git-ci"],
    },
    {
      id: "git-merge",
      chapterId: "version-history",
      title: "Resolve a merge between machines",
      summary:
        "What happens when both machines change the same field, how Review merge settles it field by field or per record, and what Abandon merge keeps.",
      outcome:
        "You can settle a merge by keeping your copy or the remote's for each conflict, and you know what abandoning one keeps on this device.",
      keywords: [
        "merge",
        "review merge",
        "finish merge",
        "abandon merge",
        "conflict",
        "merge needed",
        "diverged",
        "keep your copy",
        "keep remote copy",
        "two machines",
      ],
      durationMinutes: 7,
      prerequisites: [
        "A connected workspace changed both on this machine and on another since the two last agreed.",
      ],
      steps: [
        {
          title: "Notice Merge needed",
          instruction:
            "When both this device and the remote gained commits, the app merges them by record, node and field. Edits that touch different things are combined into one merge commit.",
          detail:
            "Where the same field changed differently on each side, the workspace stops at Merge needed in the header.",
        },
        {
          title: "Know what waits",
          instruction:
            "While the merge waits, nothing is pushed and nothing is imported, and commits pause: edits still save but are not committed. Resolving commits them first and redoes the merge on top.",
        },
        {
          title: "Open the picker",
          instruction:
            "Click Review merge in the header's popover or in the panel. The Resolve merge dialog opens over whatever you were doing.",
          detail:
            "Closing it changes nothing in the workspace, but choices you have not sent with Finish merge are lost. Decisions sent by a Finish that left conflicts are stored, and reopening starts from them.",
        },
        {
          title: "Read a card",
          instruction:
            "Each card is one conflicted record or file, with both copies side by side under Your copy and Remote copy. A side that deleted it or never had it says Not present.",
          detail:
            "The card's header carries the author, short commit and subject of the commit each side last made to it. Commit details unavailable means those could not be read; the choices still work.",
        },
        {
          title: "Pick per field",
          instruction:
            "Use Keep your copy or Keep remote copy under a conflicted field. A field choice overrides the record choice for that field only.",
          detail:
            "Every change that did not conflict is already part of the merge, from both sides.",
        },
        {
          title: "Or settle a whole record",
          instruction:
            "Use Keep your copy for all conflicts or Keep remote copy for all conflicts in a card's header to settle every conflicted field in it at once.",
          detail:
            "A card reading Whole record or Whole file, or holding copies that cannot be combined into a valid record, offers only those buttons. Choosing one clears that card's earlier field choices, so the record choice is not beaten by an old field pick.",
        },
        {
          title: "Finish the merge",
          instruction:
            "Finish merge stays disabled until every listed conflict has a decision. It sends them together, then commits, imports and pushes the merge.",
          detail:
            "A resolve that leaves conflicts, because the merge was redone on top of edits made while it waited, lists what is left and keeps the decisions already made.",
        },
        {
          title: "Or abandon it",
          instruction:
            "Abandon merge asks first. Every local commit and change stays on this device, nothing is pushed, and the workspace becomes Diverged.",
          detail:
            "Sync now then merges again, and Discard local changes is still the way to match the remote.",
        },
      ],
      example: {
        caption: "Where each choice lives",
        language: "text",
        code: "Header                  Merge needed\nPopover or panel        Review merge\nDialog                   Resolve merge, one card per record or file\nA conflicted field      Keep your copy  |  Keep remote copy\nA whole record          Keep your copy for all conflicts\n                        Keep remote copy for all conflicts\nSettle everything       Finish merge\nGive the merge up       Abandon merge -> Diverged",
      },
      expectedResult:
        "The merge is settled field by field without losing either side's work, and the merge commit is imported and pushed, so both machines agree again.",
      troubleshooting: [
        {
          title: "Finish merge is disabled",
          instruction:
            "At least one listed conflict has no decision. Pick your copy or the remote's for each one.",
        },
        {
          title: "The header says Diverged",
          instruction:
            "A merge was abandoned. Sync now combines the two again, or Discard local changes matches the remote.",
        },
        {
          title: "Conflicts came back after finishing",
          instruction:
            "Edits arrived while the merge waited, so the merge was redone on top of them. The dialog lists what is left and keeps the decisions already made.",
        },
        {
          title: "Merge needed survived a restart",
          instruction:
            "It is stored, not lost: reopen Review merge. Decisions sent with an earlier Finish merge are still there; others must be made again.",
        },
      ],
      relatedLessonIds: ["git-remote", "git-track"],
      destination: { label: "Open Version history", path: "version-history" },
    },
    {
      id: "git-ci",
      chapterId: "version-history",
      title: "Run a repository in CI",
      summary:
        "Run a checkout with apiweave run, pick projects, workflows and environments, fail fast, supply secrets from the environment, and write a JUnit report.",
      outcome:
        "A pipeline checks out the connected repository and runs its API tests from the files alone: apiweave run needs no database, no app and no git.",
      keywords: [
        "ci",
        "apiweave run",
        "cli",
        "junit",
        "html report",
        "bail",
        "project",
        "workflow",
        "env",
        "exit code",
        "pipeline",
        "github actions",
        "secret",
      ],
      durationMinutes: 7,
      prerequisites: [
        "Node.js 22 or later on the CI machine.",
        "A checkout of the APIWeave repository to build the command from: it is not published to npm yet.",
        "A checkout of a repository that holds a workspace.",
      ],
      steps: [
        {
          title: "Build the command",
          instruction:
            "In the APIWeave checkout's app/ folder run npm ci --ignore-scripts, then npm run build:cli, which writes dist/cli/apiweave.cjs. Run npm link in that folder to put apiweave on PATH, or call node dist/cli/apiweave.cjs instead.",
          detail:
            "--ignore-scripts skips the Electron download, which the CLI does not need.",
        },
        {
          title: "Run the folder",
          instruction:
            "Point the command at the repository folder: apiweave run ./tests. It reads .apiweave/format.json, imports the files into an in-memory database, and runs them with the same runner the app uses.",
          detail:
            "Git is never involved: a repository is read as files, so a checkout is all CI needs.",
        },
        {
          title: "Pick what runs",
          instruction:
            "By default every project runs, in the repository's order. --project <name|id> runs one project, and --workflow <name|id> runs one workflow — of that project when both are given, of the whole repository otherwise.",
          detail:
            "--env <name> picks an environment by name; without it each workflow runs against the environment it was saved with. A workflow in no project is reachable with --workflow.",
        },
        {
          title: "Fail fast",
          instruction:
            "--bail stops at the first failed workflow, iteration or project.",
        },
        {
          title: "Read the exit code",
          instruction:
            "0 when everything passed, 1 when a test failed, 2 for a usage or configuration error such as a missing secret or an invalid file.",
        },
        {
          title: "Supply the secrets",
          instruction:
            "The repository holds {{secrets.NAME}} references only. Set APIWEAVE_SECRET_<NAME> in the job's environment — APIWEAVE_SECRET_API_TOKEN for {{secrets.API_TOKEN}} — or pass --secret NAME=value or --secrets-file <file>.",
          detail:
            "A run that would send an unresolved reference refuses to start and names what to set.",
        },
        {
          title: "Write a JUnit report",
          instruction:
            "Add --reporter-junit-export <path>: the JUnit XML goes to that file and the console output stays. With --reporter junit and no export path, the report goes to apiweave-report.xml and the console report is replaced.",
          detail:
            "Reporters are a comma-separated list, and --reporter replaces the default cli reporter: --reporter junit,html writes both reports and no console output. --reporter-html-export <path> writes an HTML report the same way.",
        },
        {
          title: "Only committed changes travel",
          instruction:
            "An auto-mode workspace commits about 30 seconds after the last edit, and manual mode's Sync now is what commits and pushes, so a pipeline only sees what was committed.",
        },
        {
          title: "Leave the app's repository alone",
          instruction:
            "Do not add a remote, edit or commit in <userData>/git/<workspace id>/ by hand: Connect to remote and Disconnect are how its remote is set, and only APIWeave writes there.",
        },
      ],
      example: {
        caption: "A pipeline's test step, from broadest to narrowest",
        language: "bash",
        code: "APIWEAVE_SECRET_API_TOKEN=... apiweave run ./tests\napiweave run ./tests --project \"Shop API\" --env Staging\napiweave run ./tests --workflow \"Login\" --bail\napiweave run ./tests --reporter-junit-export reports/junit.xml",
      },
      expectedResult:
        "A CI job checks out the repository, runs the chosen tests against the chosen environment with its secrets supplied from the environment, fails the build on a failed test, and leaves a JUnit report behind.",
      troubleshooting: [
        {
          title: "apiweave run says .apiweave/format.json is missing",
          instruction:
            "The folder is not a workspace repository. Point it at the folder that holds .apiweave/.",
        },
        {
          title: "It exits 2 naming a secret",
          instruction:
            "Set APIWEAVE_SECRET_<NAME> in the job's environment, or pass --secret NAME=value or --secrets-file.",
        },
        {
          title: "It exits 2 naming a file as invalid",
          instruction:
            "That file was edited by hand or has an unresolved merge conflict. Fix it in the repository.",
        },
        {
          title: "--project names nothing",
          instruction:
            "An unknown or ambiguous name exits 2 and lists the projects. Use a name or id from that list.",
        },
        {
          title: "A new test is missing in CI",
          instruction:
            "Only committed changes travel. Commit and push the workspace first.",
        },
      ],
      relatedLessonIds: ["git-remote", "git-open", "projects", "secrets"],
    },
  ],
};
