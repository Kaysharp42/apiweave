import type { OAuth2AuthConfig } from "@shared/types/OAuth2AuthConfig";

export interface OAuth2AuthFieldsProps {
  config: OAuth2AuthConfig;
  onChange: (patch: Partial<OAuth2AuthConfig>) => void;
  buttonClass: string;
}
