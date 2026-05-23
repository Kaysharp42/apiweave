export const NODE_MODAL_TYPE_LABELS: Record<string, string> = {
  'http-request': 'HTTP Request',
  assertion: 'Assertion',
  delay: 'Delay',
  merge: 'Merge',
  start: 'Start',
  end: 'End',
};

export const getNodeModalTypeName = (type: string): string => NODE_MODAL_TYPE_LABELS[type] ?? 'Node';
