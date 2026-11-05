/** The environment picker: a named trigger, or a globe at the last density step. */
export interface CanvasToolbarEnvironmentPickerProps {
  readonly environments: Array<{ environmentId: string; name: string }>;
  readonly selectedEnvironment: string;
  readonly onEnvironmentChange: (value: string) => void;
  readonly showLabel: boolean;
  readonly workflowId?: string | undefined;
}
