/**
 * The small, verified set of in-app destinations a lesson may link to. This is
 * deliberately not a command surface: each value resolves to a route that
 * already exists in the router.
 */
export type TutorialDestinationPath =
  | "workflows"
  | "environments"
  | "secrets"
  | "agents"
  | "canvas-settings"
  | "private-networks"
  | "mcp-server"
  | "updates"
  | "cloud-sync";
