import type { ComponentType } from 'react';
import type { ProviderId } from './ProviderId';
import type { ProviderIconProps } from './ProviderIconProps';

export interface ProviderDisplay {
  id: ProviderId;
  label: string;
  IconComponent: ComponentType<ProviderIconProps>;
}
