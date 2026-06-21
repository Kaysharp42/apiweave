export interface VariableExtractor {
  name: string;
  path: string;
  source?: "body" | "headers" | "status";
}
