import type { ProviderId } from './ProviderId';

export interface OAuthProvider {
  id: ProviderId;
  name: string;
  icon: string;
}
