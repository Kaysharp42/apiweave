/**
 * Type-level tests for APIWeave shared types.
 *
 * These files verify that our type definitions behave as expected.
 * If any of these produce TypeScript errors, the type definitions are broken.
 *
 * Usage: `npx tsc --noEmit --project tsconfig.test.json`
 */

import type {
  ButtonVariant,
  ButtonIntent,
  ButtonSize,
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  NodeType,
  NodeStatus,
  HttpMethod,
  RunStatus,
  Variable,
  Environment,
  Collection,
  Run,
  RunResult,
  KeyValue,
  WorkspaceTab,
  PaginationState,
  CanvasAction,
  ApiResponseEnvelope,
  PaginatedResponse,
} from '../index';

// ============================================================
// Button type tests — verify union members are correct
// ============================================================

const _validVariants: ButtonVariant[] = ['primary', 'secondary', 'ghost'];
const _validIntents: ButtonIntent[] = ['default', 'success', 'error', 'warning', 'info'];
const _validSizes: ButtonSize[] = ['xs', 'sm', 'md', 'lg'];

// ============================================================
// Workflow type tests — verify structure
// ============================================================

const _mockWorkflow: Workflow = {
  workflowId: 'wf-1',
  name: 'Test Workflow',
  nodes: [],
  edges: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const _mockNode: WorkflowNode = {
  id: 'node-1',
  type: 'httpRequest',
  position: { x: 0, y: 0 },
  data: {
    label: 'HTTP Request',
    status: 'idle',
    config: {},
  },
};

const _mockEdge: WorkflowEdge = {
  id: 'edge-1',
  source: 'node-1',
  target: 'node-2',
};

// ============================================================
// Node type tests — verify union members
// ============================================================

const _validNodeTypes: NodeType[] = ['start', 'end', 'httpRequest', 'assertion', 'delay', 'merge'];
const _validNodeStatuses: NodeStatus[] = ['idle', 'running', 'success', 'error', 'warning'];

// ============================================================
// HTTP method type tests
// ============================================================

const _validMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ============================================================
// Run type tests
// ============================================================

const _validRunStatuses: RunStatus[] = ['pending', 'running', 'success', 'error', 'cancelled'];

const _mockRun: Run = {
  runId: 'run-1',
  workflowId: 'wf-1',
  status: 'success',
  startedAt: '2026-01-01T00:00:00Z',
  results: [],
};

const _mockRunResult: RunResult = {
  nodeId: 'node-1',
  nodeType: 'httpRequest',
  status: 'success',
  startedAt: '2026-01-01T00:00:00Z',
};

// ============================================================
// Variable type tests
// ============================================================

const _mockVariable: Variable = {
  id: 'var-1',
  name: 'baseUrl',
  value: 'https://api.example.com',
  type: 'string',
  scope: 'environment',
};

// ============================================================
// Environment type tests
// ============================================================

const _mockEnvironment: Environment = {
  id: 'env-1',
  environmentId: 'env-1',
  name: 'Production',
  variables: [_mockVariable],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// ============================================================
// Collection type tests
// ============================================================

const _mockCollection: Collection = {
  id: 'col-1',
  collectionId: 'col-1',
  name: 'API Tests',
  workflowIds: ['wf-1', 'wf-2'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// ============================================================
// KeyValue type tests
// ============================================================

const _mockKeyValue: KeyValue = {
  key: 'Content-Type',
  value: 'application/json',
  enabled: true,
};

// ============================================================
// WorkspaceTab type tests
// ============================================================

const _mockTab: WorkspaceTab = {
  id: 'wf-1',
  workflowId: 'wf-1',
  name: 'Test Workflow',
  isDirty: false,
};

// ============================================================
// PaginationState type tests
// ============================================================

const _mockPagination: PaginationState = {
  skip: 0,
  limit: 20,
  total: 100,
  hasMore: true,
};

// ============================================================
// CanvasAction type tests
// ============================================================

const _mockAction: CanvasAction = {
  type: 'duplicate',
  nodeId: 'node-1',
  timestamp: Date.now(),
};

// ============================================================
// API response type tests
// ============================================================

const _mockPaginatedResponse: PaginatedResponse<Workflow> = {
  workflows: [_mockWorkflow],
  total: 1,
  skip: 0,
  limit: 20,
};

const _mockEnvelope: ApiResponseEnvelope<Workflow> = {
  data: _mockWorkflow,
  total: 1,
};

// ============================================================
// Suppress "unused variable" warnings — these are type-only tests
// ============================================================
void _validVariants;
void _validIntents;
void _validSizes;
void _mockWorkflow;
void _mockNode;
void _mockEdge;
void _validNodeTypes;
void _validNodeStatuses;
void _validMethods;
void _validRunStatuses;
void _mockRun;
void _mockRunResult;
void _mockVariable;
void _mockEnvironment;
void _mockCollection;
void _mockKeyValue;
void _mockTab;
void _mockPagination;
void _mockAction;
void _mockPaginatedResponse;
void _mockEnvelope;
