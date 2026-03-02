export const NODE_MODAL_TYPE_LABELS = {
  'http-request': 'HTTP Request',
  assertion: 'Assertion',
  delay: 'Delay',
  merge: 'Merge',
  start: 'Start',
  end: 'End',
};

export const getNodeModalTypeName = (type) => NODE_MODAL_TYPE_LABELS[type] || 'Node';
