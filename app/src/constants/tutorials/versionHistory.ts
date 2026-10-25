import type { TutorialChapter } from "../../types";

/**
 * Chapter 6 — Version history and sync. Keeping a workspace in git: tracking
 * it, signing in to a host, connecting a remote, opening it on another machine,
 * settling a merge, and running a checkout in CI.
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
            "Tracking again starts a new history, so a remote holding the old one no longer has anything in common with it. Connecting that remote again merges the two ways in the merge view; a fresh empty repository starts without the old copy.",
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
            "Stop tracking deletes the repository and its commits by design. Track again for a new history. Connecting the repository that holds the old one merges the two ways; connect a fresh empty repository instead if you want to start without the old copy.",
        },
      ],
      relatedLessonIds: [
        "workspaces",
        "secrets",
        "git-accounts",
        "git-remote",
        "import-export",
      ],
      destination: { label: "Open Version history", path: "version-history" },
    },
    {
      id: "git-accounts",
      chapterId: "version-history",
      title: "Connect a GitHub or GitLab account",
      summary:
        "Sign in from APIWeave, choose which account a workspace syncs as, create its repository, and start a workspace already synced.",
      outcome:
        "The repository a workspace syncs with is reached as the GitHub or GitLab account you chose, and APIWeave can create that repository for you.",
      keywords: [
        "github",
        "gitlab",
        "account",
        "git accounts",
        "gh",
        "glab",
        "sign in",
        "one-time code",
        "create repository",
        "private",
        "apiweave-workspace",
        "use a url instead",
        "sync with github or gitlab",
        "one account per host",
        "ssh",
      ],
      durationMinutes: 8,
      prerequisites: [
        "Git installed on this machine.",
        "Optional: the GitHub CLI (gh) or the GitLab CLI (glab). Without one, a remote is still connected by its URL with your own git credentials.",
        "A tracked workspace, for the Version history steps.",
      ],
      steps: [
        {
          title: "Open the accounts menu",
          instruction:
            "Open the round account button at the right end of the header, after the theme toggle. It shows the initials of the account the current workspace syncs as, or a plain person icon when it has none, with the workspace's sync icon as a corner badge.",
          detail:
            "The panel lists every account gh and glab hold, grouped by host, marks the one this workspace uses, and offers Add GitHub account, Add GitLab account and Settings > Git accounts. For a workspace that is not tracked, or has no remote, it also offers Set up sync for this workspace…, which opens its Version history. The accounts are read from the tools each time the menu opens.",
        },
        {
          title: "See what Settings > Git accounts says",
          instruction:
            "Open Settings from the left navigation rail and choose Git accounts under App. It has a card for each tool: whether it is installed and its version, or where to get it; the accounts it holds; and the workspaces that sync as each one.",
          detail:
            "Sign in… on a card opens the same sign-in dialog, and Refresh asks gh and glab again after a sign-in made in a terminal. A sign-in that has expired, or a tool that did not answer, is said on its card.",
        },
        {
          title: "Install the command-line tool",
          instruction:
            "Install the GitHub CLI (gh) from cli.github.com or the GitLab CLI (glab) from gitlab.com/gitlab-org/cli, then click Refresh. The tool keeps the token; APIWeave stores none.",
          detail:
            "Until a tool is installed its sign-in is disabled; the menu says the tool is missing and points to Settings > Git accounts, which says where to get it. A remote can still be connected by its URL, signed in with your own git credentials. GitLab sign-in needs GitLab 17.9 or later for its device flow, and a glab whose auth status --output json APIWeave can read.",
        },
        {
          title: "Sign in",
          instruction:
            "Choose Add GitHub account or Add GitLab account in the menu, or Sign in… in settings. Keep the Host at github.com or gitlab.com, or name another instance, then click Sign in in the browser.",
          detail:
            "The dialog shows the one-time code and opens the page to enter it on. Paste the code there and finish in the browser; the dialog waits and then says Signed in to <host> as <login>. Open browser again reopens the page, and Cancel stops the tool. A GitHub Enterprise Server without a device flow has no code: the browser page alone finishes it.",
        },
        {
          title: "Know what changes outside APIWeave",
          instruction:
            "Signing in does what the same command does in a terminal. On GitHub the account becomes gh's active account on that host, so gh commands, and repositories that use gh's credential helper there, act as it. On GitLab it replaces the account glab had for that host, sets that host to HTTPS and may make it glab's default host.",
          detail:
            "Your git configuration is not changed by either tool. gh keeps several accounts per host, so a second GitHub account is a separate sign-in; glab keeps one per host, so a second GitLab account needs another host.",
        },
        {
          title: "Give a workspace its account",
          instruction:
            "For a connected https:// workspace, open Version history (git) and choose the Account under Remote. Only accounts on the remote's host are offered, plus Your own git sign-in (credential manager or SSH key).",
          detail:
            "APIWeave asks gh or glab for that account's token on every fetch, push and clone, and stores none. A bound account that is no longer signed in stays listed, so the choice never changes silently. An SSH remote signs in with your SSH key: it shows no Account picker, and an account signs in over https:// to its own host only.",
        },
        {
          title: "Create the repository",
          instruction:
            "In Version history (git), with no remote yet, choose Create repository… under the Repository list. Choose the Account and Owner, keep the Repository name (the workspace's slug) or change it, leave Visibility at Private, and click Create and connect.",
          detail:
            "It creates an empty repository — no README, licence or first commit — owned by the account or one of its GitHub organizations or GitLab groups, and tags it with the topic apiweave-workspace so APIWeave can find it later. The workspace is connected and, over https://, bound to the account. A name that is already taken is refused by name, never reused, and APIWeave never deletes a repository. If the tag could not be added, the panel says so and the repository still works.",
        },
        {
          title: "Pick a repository, or use a URL",
          instruction:
            "With an account signed in, every remote form asks for the Account first, then lists its Repository: for Connect to remote, the empty repositories it can push to; for Open from git…, those tagged apiweave-workspace, with Show all repositories for the rest. Use a URL instead takes anything the list does not hold.",
          detail:
            "The refresh button beside Repository reads the list again, and a line under it says when an owner could not be listed or a list stopped at 100. An https:// URL on the host of an account that signs in over HTTPS is reached as that account; any other URL, and the last Account option, Your own git sign-in (credential manager or SSH key) — another host, sign in with your own git credentials. With no account signed in, the form is the URL field alone.",
        },
        {
          title: "Start a workspace already synced",
          instruction:
            "In Create workspace, turn on Sync with GitHub or GitLab. Fill in the same Account, Owner, Repository name and Visibility fields; the name follows the workspace's slug until you change it, then click Create workspace.",
          detail:
            "The section is off by default. Create workspace creates the workspace, tracks it, creates the repository and connects to it. If git does not know who you are, it asks for Your name and Your email address and carries on when you click Save and commit. If a later step fails, the workspace stays created — and tracked, once tracking has succeeded — the dialog says what happened, and Open Version history is where to finish.",
        },
      ],
      example: {
        caption: "Where each account step lives",
        language: "text",
        code: "Header, round account button   this workspace's account, sync badge\nSettings > App > Git accounts  tools, versions, accounts, Refresh, Sign in…\nSign-in dialog                 one-time code, Open browser again, Cancel\nVersion history > Remote       Account, then Repository, Create repository…\nCreate workspace               Sync with GitHub or GitLab (off by default)\nA created repository           empty, Private unless changed, apiweave-workspace",
      },
      expectedResult:
        "A GitHub or GitLab account is signed in from APIWeave, the workspace reaches its repository as that account, and APIWeave holds no token of its own.",
      troubleshooting: [
        {
          title: "Add GitHub account is disabled",
          instruction:
            "The GitHub CLI (gh) is not installed. Install it from cli.github.com, click Refresh, then sign in. Until then, connect a remote by its URL.",
        },
        {
          title: "Signing in failed",
          instruction:
            "The dialog shows the tool's last words. A code that expired makes the tool give up waiting; start the sign-in again. Cancel stops the tool, and so does closing the dialog.",
        },
        {
          title: "A GitLab sign-in replaced another account",
          instruction:
            "glab keeps one account per host. Signing in to a host it already has replaces that host's account; use a second host for a second GitLab account.",
        },
        {
          title:
            "A sync says APIWeave couldn't get this workspace's account's sign-in",
          instruction:
            "Sign in to that account again, or choose another Account in Version history. A url.insteadOf or pushInsteadOf rule, or an extra remote.origin url or pushurl in your git configuration, can also cause it: the remote must resolve to exactly one https URL on the account's host. Remove the rule, or choose Your own git sign-in.",
        },
        {
          title: "The repository was created but connecting failed",
          instruction:
            "The repository is kept. The message says so, the connect form is filled in with its URL, and Connect to remote is the retry. APIWeave never deletes a repository.",
        },
        {
          title: "Create workspace finished but the workspace is not synced",
          instruction:
            "The workspace exists, and is tracked if tracking succeeded; the dialog says which step stopped. Open Version history to create the repository or connect to the one that was made.",
        },
      ],
      relatedLessonIds: ["git-track", "git-remote", "git-open"],
      destination: { label: "Open Git accounts", path: "git-accounts" },
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
            "The list holds the account's empty repositories it can push to, so a repository with commits is connected with Use a URL instead. Create repository… under the list makes a new empty one on the host for you, and Use a URL instead takes any other repository's URL, or another host's, signed in with your own git credentials. With no account signed in, the form is the URL field alone.",
        },
        {
          title: "Know what the connect does",
          instruction:
            "An empty repository receives the workspace's history on main and becomes the sync target. One that already holds this workspace's history is joined as it is and syncs both ways. One that holds this same workspace but no commit in common — after Stop tracking, say — starts a two-way merge in the merge view; a repository holding a different workspace is refused, naming it.",
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
          title:
            "Connecting says Commit the workspace once before connecting a remote",
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
            "Both sides changed the same field differently, or the two copies share no history. Review merge opens the merge view: choose a copy or a value for each conflict. The merge lesson covers it.",
        },
        {
          title: "Connecting says the repository holds a different workspace",
          instruction:
            "The repository belongs to another workspace. Open it from git to work on that one, or connect a repository that belongs to this workspace. If the message says the ids differ only in letter case, rename the workspace in the repository's workspace.json and connect again.",
        },
      ],
      relatedLessonIds: ["git-track", "git-accounts", "git-merge", "git-open"],
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
            "The list holds the account's repositories tagged apiweave-workspace — the topic APIWeave gives the repositories it creates; Show all repositories lists the rest, and Use a URL instead takes any other repository's URL in the forms Connect to remote accepts. The last Account option, Your own git sign-in (credential manager or SSH key) — another host, is for other hosts; with no account signed in at all, the form is the URL field alone. Only the repository's default branch is opened.",
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
      relatedLessonIds: ["git-track", "git-remote", "git-accounts", "secrets", "git-ci"],
    },
    {
      id: "git-merge",
      chapterId: "version-history",
      title: "Resolve a merge in the merge view",
      summary:
        "What a merge waits on, how the merge view settles it with yours, a result of your own, or the remote's, and what closing, finishing or abandoning keeps.",
      outcome:
        "You can settle every conflict in the merge view — by a copy or by a value you type — and you know what Finish merge, closing, and Abandon merge keep on this device.",
      keywords: [
        "merge",
        "review merge",
        "merge view",
        "finish merge",
        "abandon merge",
        "conflict",
        "merge needed",
        "diverged",
        "yours result remote",
        "use yours",
        "use theirs",
        "accept all",
        "compare",
        "own value",
        "previous conflict",
        "next conflict",
        "no shared history",
        "reconnect",
        "two machines",
      ],
      durationMinutes: 10,
      prerequisites: [
        "A connected workspace changed both on this machine and on another since the two last agreed, or a workspace was reconnected to a repository holding the same workspace with no shared history.",
      ],
      steps: [
        {
          title: "Notice Merge needed",
          instruction:
            "When both this device and the remote gained commits, the app merges them by record, node and field. Changes that touch different things are combined into one merge commit.",
          detail:
            "Where the same field changed differently on each side, the workspace stops at Merge needed in the header. A reconnect with no common commit lists a difference between the two copies the same way.",
        },
        {
          title: "Know what waits",
          instruction:
            "While the merge waits, nothing is pushed and nothing is imported, and commits pause: edits still save but are not committed. Finishing commits them first and redoes the merge on top.",
          detail:
            "The merge survives a restart. Closing the view saves the decisions you have made, so reopening starts from them.",
        },
        {
          title: "Open the merge view",
          instruction:
            "Click Review merge in the header's popover or in Version history settings. The Resolve merge view opens full-window over whatever you were doing.",
          detail:
            "Connecting a repository that holds this same workspace but no shared commit opens it as soon as Connect returns. Closing saves every valid choice; a value that is not valid JSON settles nothing and is not saved.",
        },
        {
          title: "Know when the history was restarted",
          instruction:
            "Stop tracking deletes this device's history, and tracking again starts a new one. Connecting the old repository then merges the two ways instead of refusing it: content the copies share passes silently, what only one copy has is kept, and a place both copies hold with different values is a conflict in this view.",
          detail:
            "A repository holding a different workspace is still refused, naming it. Ids that differ only in letter case say to rename the workspace in the repository, and a repository a newer APIWeave wrote says to update the app.",
        },
        {
          title: "Read the item list",
          instruction:
            "The left list groups every conflict under Workspace, Projects, Workflows, Environments and Files. Each entry shows the record's name, how many conflicts it holds and either Resolved or N left; the open one is highlighted.",
          detail:
            "Tab reaches each entry and the arrow keys move between them, so the whole merge can be walked from the keyboard.",
        },
        {
          title: "Read one item",
          instruction:
            "The pane names the item's kind and name, then the author, short commit and date of the commit each copy last made to it. Commit details unavailable means those could not be read; the choices still work.",
          detail:
            "A record whose two copies cannot make a valid record together says what is wrong and offers only a whole-copy choice.",
        },
        {
          title: "Read a field row",
          instruction:
            "Each conflict is a row headed by the field's name, or Whole record or Whole file at the record's root. Yours, Result and Remote sit side by side: Result shows what the merge would write — the remote copy's value until you decide — and says Unresolved while it waits. A side that deleted or never had the value says Not present.",
          detail:
            "On the widest layout the columns sit side by side; when the view is narrower they stack, and each copy gets its own labelled button.",
        },
        {
          title: "Take a copy with the arrows",
          instruction:
            "Click the » beside Yours to take this device's copy, or the « beside Remote for the remote's. The value moves into Result and the field reads Resolved. When the columns are stacked, the same choice is Use yours or Use theirs under the copy.",
          detail:
            "A whole-record or whole-file conflict, or a record its copies cannot make valid, is a choice of copies only.",
        },
        {
          title: "Or type a value of your own",
          instruction:
            "Edit Result. A text field is edited as its text and stays text; anything else is edited as JSON — text in quotes, numbers, true, false and null as they are. Empty or invalid text settles nothing, and the error is said under the control.",
          detail:
            "Finish checks the value against the record. A value holding secret storage is refused with a plain sentence; keep one copy instead.",
        },
        {
          title: "Compare a long value",
          instruction:
            "For a long value — a body, a script, a structured value — Compare under the row opens a read-only diff of both copies; Hide comparison folds it again. The diff is side by side when the view is wide and inline when it is narrow.",
        },
        {
          title: "Settle a whole item, or everything",
          instruction:
            "Accept yours or Accept remote above an item's fields settles all of them; if a value you typed would be replaced, it asks first. Accept all yours or Accept all remote in the header settles every conflict in every record and file after a confirmation, and any field can still be changed afterwards.",
          detail:
            "A whole-item or accept-all copy choice clears that item's field choices, so no older field pick can override it.",
        },
        {
          title: "Move between what is left",
          instruction:
            "Previous conflict and Next conflict step through the conflicts that are still undecided, wrapping at the ends; Alt+↑ and Alt+↓ do the same from the view.",
          detail:
            "Both are disabled once every listed conflict has a decision.",
        },
        {
          title: "Watch what merged automatically",
          instruction:
            "Above the conflicts, N changes merged automatically folds the repairs the merge made without asking: positions both copies moved, a project's workflow order, an edge or frame a deletion left dangling, and a workflow's reference to a project or environment the other copy deleted. The notes follow your decisions, so a pick can change them before you finish.",
          detail:
            "Finish writes the notes into the merge commit's message.",
        },
        {
          title: "Finish or abandon",
          instruction:
            "Finish merge is enabled only when every listed conflict has a decision. It sends them all, commits the merge, imports it and pushes it. Abandon merge asks first: every local commit and change stays on this device, nothing is pushed, and the workspace becomes Diverged, where Sync now offers the merge again.",
          detail:
            "With no git author, Finish asks inline for Your name and Your email address; Save and commit carries on with the finish. A finish that leaves conflicts keeps the decisions and says what is left.",
        },
      ],
      example: {
        caption: "Where each choice lives in the merge view",
        language: "text",
        code: "Header                This device ↔ github.com   2 of 5 conflicts resolved\n                      Accept all yours | Accept all remote\n                      3 changes merged automatically\nLeft list             Workspace  Projects  Workflows  Environments  Files\n                      Checkout  3  ·  1 left\nItem pane             Workflow · Checkout\n                      Your copy · Ada · 3f9a2c1 · 2026-10-20\n                      Remote copy · Sam · 8b1d4e2 · 2026-10-21\n                      Accept yours | Accept remote\nA field               Yours | » Result (editable) « | Remote\n                      Use yours / Use theirs when the view is narrow\n                      Compare → read-only diff of a long value\nFooter                Abandon merge  Previous conflict  Next conflict  Finish merge",
      },
      expectedResult:
        "Every conflict is settled by a copy or by a value you typed, the notes say what the merge repaired, and the merge commit is imported and pushed — including a two-way merge with a repository whose history was restarted.",
      troubleshooting: [
        {
          title: "Finish merge is disabled",
          instruction:
            "At least one listed conflict has no decision. Take a copy, type a value, or use Accept all yours or Accept all remote for everything.",
        },
        {
          title: "Accepting a copy replaced values I typed",
          instruction:
            "A whole-item or accept-all copy choice takes the place of that item's earlier field choices. The confirmation Replace the values you typed? says how many it will replace; Cancel leaves them as they are.",
        },
        {
          title: "Result says Not JSON",
          instruction:
            "Text needs quotes, and numbers, true, false and null do not. Empty text settles nothing: type a value or keep one copy.",
        },
        {
          title: "The merged automatically count changed as I picked",
          instruction:
            "The notes are recomputed with the decisions made so far. A pick can leave an edge or frame dangling, and the merge drops it and says so before Finish.",
        },
        {
          title: "I closed the view before finishing",
          instruction:
            "Every valid choice was saved, and reopening starts from them. Decisions sent by a finish that left conflicts are kept too; only text that is not valid JSON was not saved.",
        },
        {
          title: "Every conflict is settled but Finish left some",
          instruction:
            "A value you typed does not make a valid record. Keep one copy for the field it changed, then finish again.",
        },
        {
          title: "The header says Diverged",
          instruction:
            "A merge was abandoned. Every local commit is kept; Sync now combines the two again, and Discard local changes loads the remote's version instead.",
        },
        {
          title: "A reconnect to a restarted history opened the merge view",
          instruction:
            "That is the two-way merge, not an error. Settle it and Finish merge pushes the merge, or Abandon merge keeps this device's commits and pushes nothing.",
        },
      ],
      relatedLessonIds: ["git-remote", "git-track", "git-open"],
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
        code: 'APIWEAVE_SECRET_API_TOKEN=... apiweave run ./tests\napiweave run ./tests --project "Shop API" --env Staging\napiweave run ./tests --workflow "Login" --bail\napiweave run ./tests --reporter-junit-export reports/junit.xml',
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
