/**
 * S05 `mcp-bridge` — the MCP bridge is opt-in, loopback-bound, testable, and
 * exposes an explicit tool surface.
 *
 * The tool, resource and prompt lists are imported from the shipping registries
 * in `core/mcp`, never typed into a fixture: the counts this frame shows are
 * the counts the product really serves. The scene starts with the bridge
 * disabled and enables it through the panel's own control, so `Active` and
 * `Configured` are states the renderer reached, not strings placed in it.
 *
 * Framing note: the MCP surface is a full-height sidebar column
 * (`Sidebar.tsx` mounts `MCPManager` for the `mcp` nav section), so a crop that
 * fills 60% of a 4:3 frame with the panel is not achievable without cutting the
 * panel itself. The atlas frame therefore holds the whole column plus the
 * canvas it sits against.
 */

import { MCP_PROMPTS } from "../../../core/mcp/prompts";
import { MCP_RESOURCES } from "../../../core/mcp/resources";
import { MCP_TOOLS, toolName } from "../../../core/mcp/tools";
import {
  collapseChrome,
  openCapture,
  openNav,
  waitForVisibleText,
} from "../harness";
import { CAPTURE_ENVIRONMENT, CHECKOUT_WORKFLOW } from "../fixtures";
import type { Scene } from "../scene";

const TOOLS = MCP_TOOLS.map((spec) => ({
  name: toolName(spec),
  description: spec.description,
}));

/**
 * Loopback only, and the token is deliberately the empty string.
 *
 * The panel reads `token != null` for its `Configured` badge, so an empty token
 * still reports a configured server — while the connect snippets on the other
 * tabs fall back to their `YOUR_TOKEN` placeholder rather than printing a value.
 * That is the one combination where the status is truthful and no credential
 * can reach a frame.
 */
const CONFIG = {
  url: "http://127.0.0.1:47271/mcp",
  token: "",
  port: 47_271,
} as const;

export const mcpBridge: Scene = {
  id: "mcp-bridge",
  bridge: {
    workflow: CHECKOUT_WORKFLOW,
    environments: [CAPTURE_ENVIRONMENT],
    mcp: {
      // Already opted in: the panel is a status view, and the opt-in control
      // lives on the Settings > MCP Server page. An enabled loopback server is
      // the state this frame is about.
      running: true,
      config: CONFIG,
      tools: TOOLS,
      prompts: MCP_PROMPTS.map((spec) => ({
        name: spec.name,
        description: spec.description,
      })),
      resources: MCP_RESOURCES.map((spec) => ({
        name: spec.name,
        uri: spec.uriTemplate,
        description: spec.description,
      })),
      test: { ok: true, status: 200 },
    },
  },
  viewport: { width: 1600, height: 1000 },
  prepare: async (page) => {
    await openCapture(page, "/personal/workflows");
    await collapseChrome(page);
    await openNav(page, "MCP");
    await waitForVisibleText(page, "MCP Server");
    await waitForVisibleText(page, "Enabled");
  },
  requiredStrings: [
    "MCP Server",
    "Enabled",
    "HTTP Transport",
    "Active",
    "Access token",
    "Configured",
    "Tools",
    "Test HTTP Endpoint",
  ],
  stills: [
    {
      id: "atlas-mcp-controls",
      placement: "gallery",
      width: 1440,
      height: 900,
      claim: "The local bridge is opt-in, loopback-bound and exposes an explicit tool list.",
      alt: "The APIWeave MCP panel: the local server's state, its loopback endpoint, and the explicit list of tools it exposes.",
      caption: "MCP — an opt-in local bridge with an explicit tool surface.",
      subjects: ['[aria-label="Sidebar"]'],
      pad: 8,
      byteBudget: 160_000,
    },
  ],
};
