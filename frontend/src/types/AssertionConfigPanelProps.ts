export interface AssertionConfigPanelProps {
  initialConfig: { assertions?: Array<{ source: string; path: string; operator: string; expectedValue: string }> };
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
}