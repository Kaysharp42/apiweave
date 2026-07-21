import type { ServiceTokenCreateResponse } from "./ServiceTokenCreateResponse";

export interface ServiceTokenCreateFormProps {
  scopeType: "workspace" | "organization";
  scopeId: string;
  onCreated: (response: ServiceTokenCreateResponse) => void;
  className?: string;
}
