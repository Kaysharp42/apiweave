import type { ApiKeyAuthConfig } from './ApiKeyAuthConfig';
import type { BasicAuthConfig } from './BasicAuthConfig';
import type { BearerAuthConfig } from './BearerAuthConfig';

export interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'apiKey';
  bearer?: BearerAuthConfig;
  basic?: BasicAuthConfig;
  apiKey?: ApiKeyAuthConfig;
}
