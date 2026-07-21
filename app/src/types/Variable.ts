export interface Variable {
  id: string;
  name: string;
  value: string;
  type: "string" | "number" | "boolean" | "secret";
  scope: "workflow" | "environment" | "collection" | "global";
  description?: string;
}
