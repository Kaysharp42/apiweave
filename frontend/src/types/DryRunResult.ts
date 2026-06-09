import type { DryRunStats } from './DryRunStats';

export interface DryRunResult {
  valid: boolean;
  stats?: DryRunStats;
  errors?: string[];
  warnings?: string[];
}
