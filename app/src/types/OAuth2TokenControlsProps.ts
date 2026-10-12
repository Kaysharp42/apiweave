import type { OAuth2AuthConfig } from "@shared/types/OAuth2AuthConfig";

export interface OAuth2TokenControlsProps {
  config: OAuth2AuthConfig;
  ready: boolean;
}
