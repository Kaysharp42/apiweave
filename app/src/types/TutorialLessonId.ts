/**
 * Stable identifiers for every bundled tutorial lesson. These are the keys
 * persisted in tutorial progress and used in `/tutorials/:lessonId` routes, so
 * they must not change once shipped.
 */
export type TutorialLessonId =
  | "first-workflow"
  | "workspaces"
  | "canvas"
  | "http-requests"
  | "variables-extractors"
  | "placeholders-functions"
  | "environments"
  | "secrets"
  | "assertions"
  | "delay-merge"
  | "sse"
  | "call-workflow"
  | "runs-history"
  | "visual-debugging"
  | "presets"
  | "projects"
  | "import-export"
  | "openapi"
  | "curl-har"
  | "embedded-agents"
  | "mcp"
  | "settings"
  | "cloud"
  | "updates";
