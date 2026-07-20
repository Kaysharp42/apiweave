import type { ServiceToken } from "./ServiceToken";

export interface ServiceTokenListProps {
  scopeType: "workspace" | "organization";
  scopeId: string;
  onChanged: () => void;
  onSelect?: ((token: ServiceToken) => void) | undefined;
  selectedId?: string | undefined;
  className?: string;
}
