// ============================================================
// APIWeave — Shared Type Definitions
// ============================================================
// This file is the single source of truth for all shared types.
// NEVER duplicate these types across components.
// ============================================================

// ============================================================
// Button System Types
// ============================================================

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonIntent = 'default' | 'success' | 'error' | 'warning' | 'info';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

// ============================================================
// Shared Component Props
// ============================================================

export interface PanelProps {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export interface FormFieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export interface CardProps {
  title?: string;
  icon?: React.ComponentType<{ className?: string }>;
  headerActions?: React.ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
}

export interface TabItem {
  key: string;
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
}

export interface PanelTabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export interface StatusBadgeProps {
  status: 'idle' | 'running' | 'success' | 'error' | 'warning' | 'info';
  label?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

// ============================================================
// Workflow Types
// ============================================================

export interface Workflow {
  workflowId: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables?: Variable[];
  createdAt: string;
  updatedAt: string;
  collectionId?: string;
  environmentId?: string;
  swaggerUrl?: string;
  swaggerLastRefreshed?: string;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  data?: Record<string, unknown>;
}

export type NodeType =
  | 'start'
  | 'end'
  | 'httpRequest'
  | 'assertion'
  | 'delay'
  | 'merge';

export interface NodeData {
  label: string;
  status?: NodeStatus;
  config: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

export type NodeStatus = 'idle' | 'running' | 'success' | 'error' | 'warning';

// ============================================================
// HTTP Request Node Types
// ============================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface HttpRequestConfig {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  body?: string;
  bodyType?: 'json' | 'form-data' | 'raw' | 'none';
  timeout?: number;
  extractors?: VariableExtractor[];
  followRedirects?: boolean;
}

export interface VariableExtractor {
  name: string;
  path: string;
  source?: 'body' | 'headers' | 'status';
}

// ============================================================
// Assertion Node Types
// ============================================================

export interface AssertionConfig {
  target: 'status' | 'body' | 'header' | 'responseTime';
  operator: AssertionOperator;
  value: string;
  path?: string;
  headerName?: string;
}

export type AssertionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'exists'
  | 'not_exists'
  | 'matches_regex';

// ============================================================
// Delay Node Types
// ============================================================

export interface DelayConfig {
  duration: number;
  unit: 'ms' | 's' | 'm';
}

// ============================================================
// Merge Node Types
// ============================================================

export interface MergeConfig {
  mode: 'all' | 'any';
  timeout?: number;
}

// ============================================================
// Variable Types
// ============================================================

export interface Variable {
  id: string;
  name: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'secret';
  scope: 'workflow' | 'environment' | 'collection' | 'global';
  description?: string;
}

// ============================================================
// Environment Types
// ============================================================

export interface Environment {
  id: string;
  name: string;
  description?: string;
  variables: Variable[];
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

// ============================================================
// Collection Types
// ============================================================

export interface Collection {
  id: string;
  name: string;
  description?: string;
  workflowIds: string[];
  createdAt: string;
  updatedAt: string;
  environmentId?: string;
}

// ============================================================
// Run Types
// ============================================================

export interface Run {
  runId: string;
  workflowId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  results: RunResult[];
  environmentId?: string;
  triggeredBy?: string;
}

export type RunStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

export interface RunResult {
  nodeId: string;
  nodeType: NodeType;
  status: NodeStatus;
  startedAt: string;
  completedAt?: string;
  response?: ApiResponse;
  error?: string;
  assertions?: AssertionResult[];
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  responseTime: number;
}

export interface AssertionResult {
  assertion: AssertionConfig;
  passed: boolean;
  actual?: unknown;
  message?: string;
}

// ============================================================
// Key-Value Pair Types
// ============================================================

export interface KeyValue {
  key: string;
  value: string;
  enabled?: boolean;
  description?: string;
}

// ============================================================
// Tab Types
// ============================================================

export interface WorkspaceTab {
  id: string;
  workflowId: string;
  name: string;
  workflow?: Workflow;
  isDirty: boolean;
}

// ============================================================
// Sidebar Types
// ============================================================

export interface PaginationState {
  skip: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export type NavSection = 'workflows' | 'collections';

// ============================================================
// Canvas Store Types
// ============================================================

export type CanvasActionType = 'duplicate' | 'copy' | 'paste';

export interface CanvasAction {
  type: CanvasActionType;
  nodeId?: string;
  timestamp: number;
}

export interface ClipboardNodeData {
  node: WorkflowNode;
  workflowId: string;
}

// ============================================================
// API Response Types
// ============================================================

export interface ApiResponseEnvelope<T> {
  data: T;
  total?: number;
  skip?: number;
  limit?: number;
}

export interface ApiError {
  detail: string;
  status_code: number;
}

export interface PaginatedResponse<T> {
  workflows: T[];
  total: number;
  skip: number;
  limit: number;
}

// ============================================================
// Import/Export Types
// ============================================================

export interface OpenAPIImportResult {
  workflows: Workflow[];
  errors: string[];
  count: number;
}

export interface CurlImportResult {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  body?: string;
}

export interface HARImportResult {
  requests: Array<{
    method: HttpMethod;
    url: string;
    headers: KeyValue[];
    body?: string;
  }>;
}

// ============================================================
// Node Handle Types
// ============================================================

export interface NodeHandleConfig {
  type: 'source' | 'target';
  id?: string;
  position?: 'left' | 'right' | 'top' | 'bottom';
  style?: React.CSSProperties;
}

// ============================================================
// Keyboard Shortcut Types
// ============================================================

export interface KeyboardShortcut {
  keys: string;
  description: string;
  category: string;
  handler: () => void;
}
