import type { DelayJitterConfig } from "./DelayJitterConfig";

export interface NodeModalDelayConfig {
  duration: number;
  jitter?: DelayJitterConfig;
  continueOnFail?: boolean;
}
