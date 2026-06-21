import { useState } from "react";
import { Info, Shuffle, Timer, type LucideIcon } from "lucide-react";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Toggle } from "../atoms/Toggle";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import type {
  DelayConfigPanelProps,
  DelayJitterConfig,
  NodeModalDelayConfig,
  NodeModalDelayTabKey,
} from "../../types";

const DURATION_PRESETS = [100, 500, 1000, 5000, 10000, 30000];

function createCardIcon(Icon: LucideIcon) {
  return function CardIcon({ className }: { className?: string }) {
    return <Icon className={className} />;
  };
}

const InfoCardIcon = createCardIcon(Info);
const ShuffleCardIcon = createCardIcon(Shuffle);
const TimerCardIcon = createCardIcon(Timer);

function formatPresetLabel(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${milliseconds / 1000}s`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds === 1000) return "≈ 1 second";
  if (milliseconds < 1000) return `≈ ${milliseconds} milliseconds`;
  const seconds = milliseconds / 1000;
  return `≈ ${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)} seconds`;
}

function normalizeNumber(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function DelayConfigPanel({
  initialConfig,
  workingDataRef,
  activeTab = "duration",
}: DelayConfigPanelProps) {
  const [duration, setDuration] = useState(initialConfig.duration ?? 1000);
  const [jitterEnabled, setJitterEnabled] = useState(
    Boolean(initialConfig.jitter),
  );
  const [jitter, setJitter] = useState<DelayJitterConfig>(
    initialConfig.jitter ?? { minMs: 100, maxMs: 500 },
  );
  const [continueOnFail, setContinueOnFail] = useState(
    initialConfig.continueOnFail ?? false,
  );

  const writeConfig = (
    nextDuration = duration,
    nextJitterEnabled = jitterEnabled,
    nextJitter = jitter,
    nextContinueOnFail = continueOnFail,
  ) => {
    const nextConfig: NodeModalDelayConfig = {
      duration: nextDuration,
      continueOnFail: nextContinueOnFail,
      ...(nextJitterEnabled ? { jitter: nextJitter } : {}),
    };
    workingDataRef.current = {
      ...workingDataRef.current,
      config: { ...nextConfig },
    };
  };

  const updateDuration = (nextDuration: number) => {
    setDuration(nextDuration);
    writeConfig(nextDuration);
  };

  const updateJitter = (patch: Partial<DelayJitterConfig>) => {
    const nextJitter = { ...jitter, ...patch };
    setJitter(nextJitter);
    writeConfig(duration, jitterEnabled, nextJitter);
  };

  const renderDuration = () => (
    <div className="space-y-4">
      <Card title="Delay duration" icon={TimerCardIcon}>
        <div className="space-y-4">
          <FormField
            label="Delay (ms)"
            hint="The workflow pauses at this node before continuing."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="number"
                value={duration}
                onChange={(event) =>
                  updateDuration(normalizeNumber(event.target.value, duration))
                }
                min="0"
                step="100"
                size="lg"
                className="max-w-48 font-mono text-lg"
              />
              <span className="rounded-sm border border-border bg-surface-overlay px-3 py-2 font-mono text-sm text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
                {formatDuration(duration)}
              </span>
            </div>
          </FormField>

          <div className="flex flex-wrap gap-2">
            {DURATION_PRESETS.map((preset) => (
              <Button
                key={preset}
                size="xs"
                variant={duration === preset ? "primary" : "secondary"}
                onClick={() => updateDuration(preset)}
              >
                {formatPresetLabel(preset)}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <div className="border-t border-border dark:border-border-dark" />

      <Card title="Random Jitter (optional)" icon={ShuffleCardIcon}>
        <div className="space-y-4">
          <FormField
            label="Enable jitter"
            hint="When enabled, executor can randomize the delay between min and max each run."
          >
            <Toggle
              label={
                jitterEnabled
                  ? "Randomized delay enabled"
                  : "Use fixed delay only"
              }
              checked={jitterEnabled}
              onChange={(event) => {
                const nextEnabled = event.target.checked;
                setJitterEnabled(nextEnabled);
                writeConfig(duration, nextEnabled, jitter);
              }}
            />
          </FormField>

          {jitterEnabled && (
            <Card
              title="Jitter bounds"
              icon={ShuffleCardIcon}
              className="bg-surface-overlay dark:bg-surface-dark-overlay"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  label="Min (ms)"
                  hint="Smallest possible randomized delay."
                >
                  <Input
                    type="number"
                    value={jitter.minMs}
                    onChange={(event) =>
                      updateJitter({
                        minMs: normalizeNumber(
                          event.target.value,
                          jitter.minMs,
                        ),
                      })
                    }
                    min="0"
                    step="100"
                    className="font-mono"
                  />
                </FormField>
                <FormField
                  label="Max (ms)"
                  hint="Largest possible randomized delay."
                >
                  <Input
                    type="number"
                    value={jitter.maxMs}
                    onChange={(event) =>
                      updateJitter({
                        maxMs: normalizeNumber(
                          event.target.value,
                          jitter.maxMs,
                        ),
                      })
                    }
                    min="0"
                    step="100"
                    className="font-mono"
                  />
                </FormField>
              </div>
            </Card>
          )}
        </div>
      </Card>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-4">
      <Card title="Execution behavior" icon={InfoCardIcon}>
        <div className="space-y-4">
          <FormField
            label="Continue on failure"
            hint="Delay failures are usually timeout or cancellation conditions; enable this only when downstream steps can recover."
          >
            <Toggle
              label={
                continueOnFail
                  ? "Continue if the delay fails"
                  : "Stop if the delay fails"
              }
              checked={continueOnFail}
              onChange={(event) => {
                const nextValue = event.target.checked;
                setContinueOnFail(nextValue);
                writeConfig(duration, jitterEnabled, jitter, nextValue);
              }}
            />
          </FormField>
          <div className="rounded-sm border border-status-info/30 bg-status-info/10 p-3 text-xs text-status-info dark:border-[var(--aw-status-info)]/30 dark:bg-[var(--aw-status-info)]/10 dark:text-[var(--aw-status-info)]">
            Delays intentionally pause execution. Timeouts are external limits
            that can interrupt a run; this setting controls what happens if the
            delay node itself reports a failure.
          </div>
        </div>
      </Card>
    </div>
  );

  const tabRenderers: Record<NodeModalDelayTabKey, () => JSX.Element> = {
    duration: renderDuration,
    settings: renderSettings,
  };

  return <div className="space-y-4">{tabRenderers[activeTab]()}</div>;
}
