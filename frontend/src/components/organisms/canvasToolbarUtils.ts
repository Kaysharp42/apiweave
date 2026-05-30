export interface EnvironmentOption {
  value: string;
  label: string;
}

export function buildEnvironmentOptions(environments: Array<{ environmentId: string; name: string }>): EnvironmentOption[] {
  return [
    { value: '', label: 'No Environment' },
    ...environments.map((env) => ({ value: env.environmentId, label: env.name })),
  ];
}
