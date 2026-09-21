import type { TutorialChapter } from "../../types";

/**
 * Chapter 7 — App. Settings, optional Cloud sync, and updates/startup.
 */
export const appChapter: TutorialChapter = {
  id: "app",
  title: "App",
  summary:
    "Preferences, optional Cloud collaboration, and keeping the app up to date.",
  lessons: [
    {
      id: "settings",
      chapterId: "app",
      title: "Settings and preferences",
      summary:
        "Canvas interaction and tips, and the split between workspace-scoped and app-scoped settings.",
      outcome:
        "You can find every preference and know which ones are per-machine and which are per-workspace.",
      keywords: [
        "settings",
        "preferences",
        "canvas",
        "tips",
        "drag",
        "snap",
        "zoom",
        "workspace settings",
      ],
      durationMinutes: 5,
      prerequisites: ["The app is open."],
      steps: [
        {
          title: "Find the two settings groups",
          instruction:
            "Open Settings from the left navigation rail. The sidebar splits into Workspace settings (Projects, Environments, Secrets) and App settings (Agents, Canvas, MCP Server, Updates).",
          detail:
            "Workspace settings are scoped to the workspace you are in; app settings are per-machine.",
        },
        {
          title: "Choose the left-drag behaviour",
          instruction:
            "Open Settings → Canvas and set Left-drag on empty canvas to Pan the canvas or Box-select nodes.",
          detail:
            "Holding Space always pans, whichever mode is chosen, and middle-drag pans either way.",
        },
        {
          title: "Tune zoom and snapping",
          instruction:
            "Toggle Wheel zooms. Turn on Snap to grid and set Grid size in pixels; 24 matches the dots you can see.",
        },
        {
          title: "Control contextual tips",
          instruction:
            "Toggle Contextual canvas tips to show or hide the shortcut hints that appear when a selection unlocks an action.",
        },
        {
          title: "Use the workspace-scoped settings",
          instruction:
            "Use Settings → Environments and Settings → Secrets for the resources scoped to the current workspace, and the Projects row to switch the sidebar to the projects list.",
        },
        {
          title: "Reach the app-scoped panels",
          instruction:
            "Open Settings → Agents, MCP Server and Updates for the per-machine configuration covered in their own lessons.",
        },
      ],
      example: {
        caption: "What lives where",
        language: "text",
        code: "Workspace settings          App settings (per machine)\n  Projects                    Agents\n  Environments                Canvas\n  Secrets                     MCP Server\n                              Updates",
      },
      expectedResult:
        "Canvas interaction feels the way you configured it, and you can tell a per-machine preference from a per-workspace resource at a glance.",
      troubleshooting: [
        {
          title: "A preference did not stick",
          instruction:
            "Canvas preferences persist locally. Reopen Settings to confirm the current value.",
        },
        {
          title: "You cannot find an environment you expected",
          instruction:
            "Environments are workspace-scoped. Switch to the workspace that owns it.",
        },
      ],
      relatedLessonIds: ["canvas", "environments", "cloud", "updates"],
      destination: { label: "Open Canvas settings", path: "canvas-settings" },
    },
    {
      id: "cloud",
      chapterId: "app",
      title: "Optional Cloud sync",
      summary:
        "Signing in, Cloud Teams and Workspaces, linking and sync status, conflicts and dead letters, encryption/unlock, and what stays local.",
      outcome:
        "You can turn on structure sync across machines and resolve a conflict, while secret values and run history stay local.",
      keywords: [
        "cloud",
        "sync",
        "account",
        "team",
        "workspace",
        "conflict",
        "dead letter",
        "encryption",
        "unlock",
        "collaboration",
      ],
      durationMinutes: 7,
      prerequisites: [
        "An optional APIWeave Cloud account. The desktop app is fully usable without one.",
      ],
      steps: [
        {
          title: "Know what syncs and what never does",
          instruction:
            "Understand that Cloud syncs test structure — workflows, environments, projects and secret references — while secret values and run history always stay local and are rejected from sync payloads.",
          detail:
            "Cloud never builds or runs tests; all execution stays on the desktop.",
        },
        {
          title: "Sign in from the account menu",
          instruction:
            "Open the account menu in the header and sign in with a Cloud account. Signing in is optional and does not change local usage.",
        },
        {
          title: "Understand Cloud Teams and Workspaces",
          instruction:
            "Know that shared Cloud Workspaces belong to a Cloud Team from the Cloud account, and let multiple machines collaborate.",
          detail:
            "Locally, work is organized into local workspaces; Cloud Workspaces are the collaboration layer on top.",
        },
        {
          title: "Link and read sync status",
          instruction:
            "Open the Cloud sync page to see link state, binding, and sync status. Push and pull structure-only payloads over a durable outbox.",
        },
        {
          title: "Resolve a conflict",
          instruction:
            "When a push detects a conflict, open the conflicts list and choose a winner for the affected record. A detail view shows the differences.",
          detail:
            "Resolution converges to the server-returned revision, so a keep-local choice does not loop back as the same conflict.",
        },
        {
          title: "Handle dead letters",
          instruction:
            "If a record cannot be synced, it lands in the failed-records list with a real rejection reason. Open it to see what was rejected, fix the cause, then use Retry failed on the workspace row to try again.",
        },
        {
          title: "Handle encryption and unlock where surfaced",
          instruction:
            "Where a Cloud Workspace requires it, the app surfaces an encryption decision or an unlock step. Complete it to enable sync for that workspace.",
        },
        {
          title: "Rely on local execution",
          instruction:
            "Remember that a synced workflow still runs locally against the secrets stored on the machine that runs it. Nothing about sync changes where a run happens.",
        },
      ],
      example: {
        caption: "Synced versus local",
        language: "text",
        code: "Cloud syncs (structure)          Stays local (never synced)\n  workflows                        secret values\n  environments + plain variables   run history\n  projects                         node presets\n  secret references                run artifacts",
      },
      expectedResult:
        "Structure appears on a second signed-in machine while each machine keeps its own secret values and run history, and a conflict resolves to a single winner without looping.",
      troubleshooting: [
        {
          title: "A synced workflow fails on an unresolved secret",
          instruction:
            "Secret values do not sync. Re-enter each secret on the machine that runs it.",
        },
        {
          title: "A record keeps failing to sync",
          instruction:
            "Open the failed-records list for the real rejection reason, fix the cause, and retry.",
        },
        {
          title: "An environment's base link did not arrive",
          instruction:
            "The base-environment link is not part of the sync payload. Define the shared values on the environment itself for reproducible runs on another machine.",
        },
      ],
      relatedLessonIds: ["settings", "environments", "secrets", "import-export"],
      destination: { label: "Open Cloud sync", path: "cloud-sync" },
    },
    {
      id: "updates",
      chapterId: "app",
      title: "Updates and startup",
      summary:
        "Notify, Automatic and Manual policies; check/download/install controls; the update banner; and what a failed startup looks like.",
      outcome:
        "You control when the app checks for and installs new versions, and you can diagnose a startup that does not finish.",
      keywords: [
        "update",
        "updates",
        "version",
        "release",
        "policy",
        "notify",
        "automatic",
        "manual",
        "install",
        "startup",
        "boot",
      ],
      durationMinutes: 5,
      prerequisites: ["The app is running."],
      steps: [
        {
          title: "Open the update settings",
          instruction:
            "Open Settings → Updates. The panel shows your current version and the last time a check ran.",
        },
        {
          title: "Pick a policy",
          instruction:
            "Choose Notify me, Automatic, or Manual only.",
          detail:
            "Notify me checks on launch and periodically and downloads only when you ask. Automatic downloads in the background and installs on quit. Manual only never checks on its own; the Check for updates button is the only thing that reaches the network.",
        },
        {
          title: "Know the platform limits",
          instruction:
            "Know that Windows and Linux AppImage builds can download and stage an update themselves, while macOS and the .deb/.rpm/.pacman packages only ever show a new-version notice with a link to the release page.",
          detail:
            "On those platforms Automatic is not offered, because the app cannot install the update itself.",
        },
        {
          title: "Check and install",
          instruction:
            "Click Check for updates to run a check on demand. When a release is found, use the download and install controls; a downloaded update raises a banner with Restart now and Later.",
        },
        {
          title: "Notice the update indicator",
          instruction:
            "Watch for a dot on the Settings icon in the left navigation rail when a release is available or a downloaded update is waiting.",
        },
        {
          title: "Read the update log",
          instruction:
            "If a check or download misbehaves, use Settings → Updates → Show update log to reveal main.log in your file manager, which records every check, download and error.",
        },
        {
          title: "Recover from a failed startup",
          instruction:
            "If the app cannot bring up its local services, the window can settle on an Auth bootstrap failed screen instead of the workspace. Note the message and any error text it shows, check main.log, then quit and relaunch the app.",
          detail:
            "The app brings up the local database and services before the workspace; a first launch can take a few seconds.",
        },
      ],
      example: {
        caption: "What each policy reaches the network for",
        language: "text",
        code: "Notify me (default)  check on launch + periodically; download only when asked\nAutomatic            check + download in background; install on quit (self-install platforms)\nManual only          never checks on its own; only Check for updates does",
      },
      expectedResult:
        "The app checks for updates on the schedule you chose, self-installs where the platform supports it, and reports a failed check quietly unless you asked for it.",
      troubleshooting: [
        {
          title: "Automatic is not offered",
          instruction:
            "This platform cannot self-install (macOS, or a .deb/.rpm/.pacman package). Use Notify me and install from the release page.",
        },
        {
          title: "A background check reported nothing",
          instruction:
            "Self-initiated checks stay quiet unless they find something; a check that failed because the machine was briefly offline is written to the log rather than shown.",
        },
        {
          title: "The app is stuck on Starting APIWeave",
          instruction:
            "Local services did not come up. Quit and relaunch; if it persists, check main.log and disk permissions.",
        },
      ],
      relatedLessonIds: ["settings", "cloud"],
      destination: { label: "Open Updates", path: "updates" },
    },
  ],
};
