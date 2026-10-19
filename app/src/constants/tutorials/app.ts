import type { TutorialChapter } from "../../types";

/**
 * Chapter 7 — App. Settings, and updates/startup.
 */
export const appChapter: TutorialChapter = {
  id: "app",
  title: "App",
  summary:
    "Preferences and keeping the app up to date.",
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
            "Open Settings from the left navigation rail. The sidebar splits into Workspace settings (Projects, Environments, Secrets, Version history (git)) and App settings (Agents, Canvas, MCP Server, Updates).",
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
        code: "Workspace settings          App settings (per machine)\n  Projects                    Agents\n  Environments                Canvas\n  Secrets                     MCP Server\n  Version history             Updates",
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
      relatedLessonIds: ["canvas", "environments", "updates"],
      destination: { label: "Open Canvas settings", path: "canvas-settings" },
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
            "If a check or download misbehaves, use Settings → Updates → Show update log to reveal today's log file (apiweave-main-YYYY-MM-DD.log) in your file manager. It records every check, download and error.",
        },
        {
          title: "Recover from a failed startup",
          instruction:
            "If startup fails, for example because the database was written by a newer APIWeave build, the app shows an APIWeave could not start dialog that names the error, the log file and the data folder, then exits. Fix the cause it names, then relaunch the app.",
          detail:
            "The app opens the local database and secrets keyfile before any window appears, so a startup failure never leaves a blank window behind.",
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
          title: "APIWeave could not start",
          instruction:
            "Startup failed before a window opened. Read the error in the dialog, check the log file it names and the data folder's disk permissions, then relaunch.",
        },
      ],
      relatedLessonIds: ["settings"],
      destination: { label: "Open Updates", path: "updates" },
    },
  ],
};
