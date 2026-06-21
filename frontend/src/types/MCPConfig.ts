import type { MCPTool } from "./MCPTool";

export type MCPConfig = {
  enabled: boolean;
  httpEnabled: boolean;
  baseUrl: string;
  apiKeyConfigured: boolean;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  tools: MCPTool[];
};
