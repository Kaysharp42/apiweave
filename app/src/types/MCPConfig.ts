import type { MCPTool } from "@shared/types/MCPTool";
import type { MCPPrompt } from "@shared/types/MCPPrompt";

export type MCPConfig = {
  enabled: boolean;
  httpEnabled: boolean;
  baseUrl: string;
  apiKeyConfigured: boolean;
  token: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  tools: MCPTool[];
  prompts: MCPPrompt[];
};
