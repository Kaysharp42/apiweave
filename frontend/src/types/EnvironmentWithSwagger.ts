import type { Environment } from './Environment';

export interface EnvironmentWithSwagger extends Environment {
  swaggerDocUrl?: string;
}