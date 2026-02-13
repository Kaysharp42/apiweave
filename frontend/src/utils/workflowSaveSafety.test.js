import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDefaultStartOnlyGraph,
  shouldBlockDestructiveAutosave,
} from './workflowSaveSafety.js';

test('isDefaultStartOnlyGraph returns true for canonical default graph', () => {
  const nodes = [
    {
      nodeId: 'start-1',
      type: 'start',
      label: 'Start',
      position: { x: 250, y: 50 },
      config: {},
    },
  ];
  const edges = [];

  assert.equal(isDefaultStartOnlyGraph(nodes, edges), true);
});

test('isDefaultStartOnlyGraph returns false for larger graph', () => {
  const nodes = [
    { nodeId: 'start-1', type: 'start' },
    { nodeId: 'http-1', type: 'http-request' },
  ];
  const edges = [{ edgeId: 'e-1', source: 'start-1', target: 'http-1' }];

  assert.equal(isDefaultStartOnlyGraph(nodes, edges), false);
});

test('shouldBlockDestructiveAutosave blocks when baseline is larger and payload is default', () => {
  const payloadNodes = [{ nodeId: 'start-1', type: 'start' }];
  const payloadEdges = [];
  const baseline = { nodeCount: 14, edgeCount: 13 };

  assert.equal(
    shouldBlockDestructiveAutosave(payloadNodes, payloadEdges, baseline),
    true,
  );
});

test('shouldBlockDestructiveAutosave allows default graph for new workflows', () => {
  const payloadNodes = [{ nodeId: 'start-1', type: 'start' }];
  const payloadEdges = [];
  const baseline = { nodeCount: 1, edgeCount: 0 };

  assert.equal(
    shouldBlockDestructiveAutosave(payloadNodes, payloadEdges, baseline),
    false,
  );
});
