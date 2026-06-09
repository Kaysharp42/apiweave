export interface DelayConfigPanelProps {
  initialConfig: { duration?: number };
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
}