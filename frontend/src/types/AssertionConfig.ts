import type { AssertionOperator } from "./AssertionOperator";

export interface AssertionConfig {
  target: "status" | "body" | "header" | "responseTime";
  operator: AssertionOperator;
  value: string;
  path?: string;
  headerName?: string;
}
