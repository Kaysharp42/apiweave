import type { PreviewNode } from './PreviewNode';
import type { PreviewStats } from './PreviewStats';
import type { PreviewWorkflow } from './PreviewWorkflow';
import type { PreviewServer } from './PreviewServer';
import type { PreviewTag } from './PreviewTag';

export interface PreviewData {
  nodes?: PreviewNode[];
  stats?: PreviewStats;
  workflow?: PreviewWorkflow;
  availableServers?: PreviewServer[];
  availableTags?: PreviewTag[];
}
