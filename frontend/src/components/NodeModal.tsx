import { useState, useEffect, useRef, Fragment, type ChangeEvent } from 'react';
import AssertionEditor from './AssertionEditor';
import FileUploadSection from './FileUploadSection';
import { Dialog, Transition, TransitionChild } from '@headlessui/react';
import { CheckCircle, Info, AlertTriangle, Pencil, Trash2, Globe, Timer, GitMerge, Circle, X, FileText, BadgeCheck, Square } from 'lucide-react';
import { Button } from './atoms/Button';
import { Input, TextArea } from './atoms';
import { useWorkflow } from '../contexts/WorkflowContext';
import { getNodeModalTypeName } from '../utils/nodeModalMeta';
import { formatNodeOutputDuration, getNodeOutputStatusClass } from '../utils/nodeOutputStatus';

type ModalNodeType = 'http-request' | 'assertion' | 'delay' | 'merge' | 'start' | 'end';

interface NodeModalNode {
  id: string;
  type: ModalNodeType;
  position: { x: number; y: number };
  data: NodeModalData;
}

interface NodeModalData {
  label: string;
  config: Record<string, unknown>;
  executionResult?: Record<string, unknown> | null;
}

import type { FileUpload } from './FileUploadSection';

interface HTTPRequestConfigType {
  url?: string;
  method?: string;
  queryParams?: string;
  headers?: string;
  cookies?: string;
  body?: string;
  timeout?: number;
  fileUploads?: FileUpload[];
}

interface AssertionItem {
  source: string;
  path: string;
  operator: string;
  expectedValue: string;
}

interface MergeConditionType {
  branchIndex: number;
  field: string;
  operator: string;
  value: string;
}

interface MergeConfigType {
  mergeStrategy: string;
  conditions: MergeConditionType[];
  conditionLogic: string;
}

interface HTTPRequestConfigProps {
  initialConfig: HTTPRequestConfigType;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
}

interface OutputPanelProps {
  node: NodeModalNode;
  initialConfig: HTTPRequestConfigType;
  output: Record<string, unknown> | null;
}

interface AssertionFormModalProps {
  onAdd: (assertion: AssertionItem) => void;
}

interface AssertionConfigProps {
  initialConfig: { assertions?: AssertionItem[] };
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
}

interface DelayConfigProps {
  initialConfig: { duration?: number };
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
}

interface MergeConfigProps {
  initialConfig: MergeConfigType;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
}

interface NodeModalProps {
  open: boolean;
  node: NodeModalNode;
  onClose: () => void;
  onSave: (node: NodeModalNode) => void;
}

interface FormFieldProps {
  label: string;
  children: React.ReactNode;
  hint?: string | undefined;
}

interface TabButtonProps {
  id: string;
  label: string;
  activeTab: string;
  setActiveTab: (id: string) => void;
  colorScheme?: 'default' | 'purple';
}

const getNodeIcon = (type: ModalNodeType): React.ReactNode => {
  const iconProps = { className: 'w-6 h-6' };
  switch (type) {
    case 'http-request':
      return <Globe {...iconProps} />;
    case 'assertion':
      return <BadgeCheck {...iconProps} />;
    case 'delay':
      return <Timer {...iconProps} />;
    case 'merge':
      return <GitMerge {...iconProps} />;
    case 'start':
      return <Circle {...iconProps} />;
    case 'end':
      return <Square {...iconProps} />;
    default:
      return <Circle {...iconProps} />;
  }
};

const TabButton = ({ id, label, activeTab, setActiveTab, colorScheme = 'default' }: TabButtonProps) => {
  const isActive = activeTab === id;
  const activeBorder = colorScheme === 'purple' ? 'border-purple-500' : 'border-primary';
  const activeText = colorScheme === 'purple' ? 'text-purple-600 dark:text-purple-400' : 'text-primary';

  return (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        isActive
          ? `${activeBorder} ${activeText}`
          : 'border-transparent text-text-muted dark:text-text-muted-dark hover:text-text-primary dark:hover:text-text-primary-dark'
      }`}
    >
      {label}
    </button>
  );
};

const FormField = ({ label, children, hint }: FormFieldProps) => (
  <div className="mb-4">
    <label className="block text-xs font-medium text-text-muted dark:text-text-muted-dark mb-1.5 uppercase tracking-wide">
      {label}
    </label>
    {children}
    {hint && <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">{hint}</p>}
  </div>
);

export function NodeModal({ open, node, onClose, onSave }: NodeModalProps) {
  const workingDataRef = useRef<Record<string, unknown>>({ ...node.data });

  useEffect(() => {
    if (node) workingDataRef.current = { ...node.data };
  }, [node?.id]);

  const handleClose = () => {
    onClose();
  };

  const handleSave = () => {
    onSave({ ...node, data: workingDataRef.current as unknown as NodeModalData });
    handleClose();
  };

  const handleLabelChange = (newLabel: string) => {
    workingDataRef.current = { ...workingDataRef.current, label: newLabel };
  };

  const nodeInfo = { name: getNodeModalTypeName(node.type) };

  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={handleClose} className="relative z-50">
        <TransitionChild
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-sm" />
        </TransitionChild>
        <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-5">
          <TransitionChild
            enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="h-[90vh] w-[96vw] max-w-[1800px]">
              <div className="grid h-full grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <div className="min-h-0 overflow-hidden rounded-2xl border border-border dark:border-border-dark bg-gradient-to-br from-surface-raised to-surface dark:from-surface-dark dark:to-surface-dark-raised shadow-xl">
                  <div className="flex h-full min-h-0 flex-col p-5 sm:p-6">
                    <div className="mb-5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-surface-overlay dark:bg-surface-dark-overlay p-2 text-text-secondary dark:text-text-secondary-dark">
                          {getNodeIcon(node.type)}
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
                            {nodeInfo.name}
                          </h2>
                          <p className="text-xs text-text-muted dark:text-text-muted-dark">Configure node</p>
                        </div>
                      </div>
                      <Button
                        onClick={handleClose}
                        variant="ghost"
                        size="sm"
                        className="!p-2 !min-w-0"
                        title="Close"
                      >
                        <X className="w-6 h-6" />
                      </Button>
                    </div>

                    <div className="mb-4 rounded-xl border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4 shadow-sm">
                      <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
                        Node Name
                      </label>
                      <Input
                        type="text"
                        defaultValue={node.data.label || ''}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleLabelChange(e.target.value)}
                        className="font-mono"
                        placeholder="Enter node name"
                      />
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border dark:border-border-dark bg-surface dark:bg-surface-dark shadow-inner">
                      <div className="h-full overflow-y-auto p-4">
                        {node.type === 'http-request' && (
                          <HTTPRequestConfig
                            initialConfig={(node.data.config || {}) as HTTPRequestConfigType}
                            workingDataRef={workingDataRef}
                          />
                        )}
                        {node.type === 'assertion' && (
                          <AssertionConfig
                            initialConfig={(node.data.config || {}) as { assertions?: AssertionItem[] }}
                            workingDataRef={workingDataRef}
                          />
                        )}
                        {node.type === 'delay' && (
                          <DelayConfig
                            initialConfig={(node.data.config || {}) as { duration?: number }}
                            workingDataRef={workingDataRef}
                          />
                        )}
                        {node.type === 'merge' && (
                          <MergeConfig
                            initialConfig={(node.data.config || {}) as unknown as MergeConfigType}
                            workingDataRef={workingDataRef}
                          />
                        )}
                        {(node.type === 'start' || node.type === 'end') && (
                          <div className="p-4">
                            <p className="text-sm text-text-muted dark:text-text-muted-dark">
                              No configuration needed for {node.type} nodes.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 flex flex-shrink-0 justify-end gap-3">
                      <Button onClick={handleClose} variant="ghost">Cancel</Button>
                      <Button onClick={handleSave} variant="primary">Save</Button>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 overflow-hidden rounded-2xl border border-border dark:border-border-dark bg-surface dark:bg-surface-dark shadow-xl">
                  <div className="h-full">
                    <OutputPanel
                      node={node}
                      initialConfig={(node.data.config || {}) as HTTPRequestConfigType}
                      output={(node.data?.executionResult as Record<string, unknown> | null) || null}
                    />
                  </div>
                </div>
              </div>
            </Dialog.Panel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}

const HTTPRequestConfig = ({ initialConfig, workingDataRef }: HTTPRequestConfigProps) => {
  const [activeTab, setActiveTab] = useState('parameters');
  const { variables } = useWorkflow();

  const urlRef = useRef(initialConfig.url || '');
  const methodRef = useRef(initialConfig.method || 'GET');
  const queryParamsRef = useRef(initialConfig.queryParams || '');
  const headersRef = useRef(initialConfig.headers || '');
  const cookiesRef = useRef(initialConfig.cookies || '');
  const bodyRef = useRef(initialConfig.body || '');
  const timeoutRef = useRef(initialConfig.timeout || 30);
  const fileUploadsRef = useRef(initialConfig.fileUploads || []);
  const [fileUploads, setFileUploads] = useState<FileUpload[]>(initialConfig.fileUploads || []);

  const updateRef = () => {
    const newConfig: HTTPRequestConfigType = {
      ...initialConfig,
      url: urlRef.current,
      method: methodRef.current,
      queryParams: queryParamsRef.current,
      headers: headersRef.current,
      cookies: cookiesRef.current,
      body: bodyRef.current,
      timeout: timeoutRef.current,
      fileUploads: fileUploadsRef.current,
    };
    if (workingDataRef) {
      workingDataRef.current = { ...workingDataRef.current, config: newConfig };
    }
  };

  const handleFileUploadsUpdate = (files: FileUpload[]) => {
    fileUploadsRef.current = files;
    setFileUploads(files);
    updateRef();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex border-b border-border dark:border-border-dark px-4">
        <TabButton id="parameters" label="Parameters" activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="settings" label="Settings" activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'parameters' && (
          <div className="space-y-4">
            <FormField label="HTTP Method">
              <div className="flex gap-2">
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((method) => (
                  <Button
                    key={method}
                    onClick={() => {
                      methodRef.current = method;
                      updateRef();
                    }}
                    variant={methodRef.current === method ? 'primary' : 'ghost'}
                    size="xs"
                    className={methodRef.current === method ? '' : ''}
                  >
                    {method}
                  </Button>
                ))}
              </div>
            </FormField>

            <FormField
              label="URL"
              hint="Supports variables: {{prev.response.body.id}} or {{variables.baseUrl}}"
            >
              <Input
                type="text"
                defaultValue={initialConfig.url || ''}
                onBlur={() => updateRef()}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  urlRef.current = e.target.value;
                }}
                className="font-mono"
                placeholder="https://api.example.com/endpoint"
              />
            </FormField>

            <FormField
              label="Query Parameters"
              hint="One per line: key=value"
            >
              <TextArea
                defaultValue={initialConfig.queryParams || ''}
                onBlur={() => updateRef()}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                  queryParamsRef.current = e.target.value;
                }}
                className="font-mono"
                placeholder="page=1&#10;limit=10"
                rows={3}
              />
            </FormField>

            <FormField
              label="Headers"
              hint="One per line: key=value"
            >
              <TextArea
                defaultValue={initialConfig.headers || ''}
                onBlur={() => updateRef()}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                  headersRef.current = e.target.value;
                }}
                className="font-mono"
                placeholder="Content-Type=application/json&#10;Authorization=Bearer {{variables.token}}"
                rows={3}
              />
            </FormField>

            <FormField
              label="Cookies"
              hint="One per line: key=value"
            >
              <TextArea
                defaultValue={initialConfig.cookies || ''}
                onBlur={() => updateRef()}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                  cookiesRef.current = e.target.value;
                }}
                className="font-mono"
                placeholder="session={{variables.sessionId}}"
                rows={2}
              />
            </FormField>

            <FormField
              label="Request Body"
              hint="JSON format supported"
            >
              <TextArea
                defaultValue={initialConfig.body || ''}
                onBlur={() => updateRef()}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                  bodyRef.current = e.target.value;
                }}
                className="font-mono"
                placeholder='{"key": "{{variables.value}}"}'
                rows={6}
              />
            </FormField>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-4">
            <FormField label="Request Timeout" hint="Maximum time to wait for response">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  defaultValue={initialConfig.timeout || 30}
                  onBlur={() => updateRef()}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    timeoutRef.current = parseInt(e.target.value) || 30;
                  }}
                  className="w-24"
                  min="1"
                  max="300"
                />
                <span className="text-sm text-text-secondary dark:text-text-secondary-dark">seconds</span>
              </div>
            </FormField>

            <FormField label="Extract Variables" hint="Save response values as workflow variables">
              <div className="text-xs text-text-muted dark:text-text-muted-dark">
                Configure in the node&apos;s extractors field or Variables Panel
              </div>
            </FormField>

            <div>
              <FileUploadSection
                fileUploads={fileUploads}
                onUpdate={handleFileUploadsUpdate}
                variables={(variables || {}) as Record<string, string>}
              />
              <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">
                Add files here to send this request as multipart/form-data.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
HTTPRequestConfig.displayName = 'HTTPRequestConfig';

const OutputPanel = ({ node, initialConfig, output }: OutputPanelProps) => {
  const [activeTab, setActiveTab] = useState('body');

  const statusCode = output?.statusCode as number | undefined;
  const headers = (output?.headers as Record<string, unknown>) || {};
  const cookies = (output?.cookies as Record<string, unknown>) || {};
  const body = output?.body;
  const statusColor = getNodeOutputStatusClass(statusCode);
  const durationLabel = formatNodeOutputDuration((output?.duration) as number | undefined);

  const CodeBlock = ({ value }: { value: unknown }) => (
    <pre className="w-full h-full overflow-auto p-4 text-xs text-text-secondary dark:text-text-secondary-dark font-mono bg-surface dark:bg-surface-dark border-0 leading-relaxed">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );

  return (
    <div className="h-full flex flex-col bg-surface dark:bg-surface-dark">
      <div className="flex-shrink-0 px-4 py-4 border-b border-border dark:border-border-dark flex items-center justify-between bg-surface-raised dark:bg-surface-dark-raised">
        <h3 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Response Output
        </h3>
        {node.type === 'http-request' && statusCode && (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-1 rounded ${statusColor}`}>
              {statusCode}
            </span>
            {durationLabel && (
              <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                {durationLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {!output && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <FileText className="w-16 h-16 mx-auto mb-4 text-text-muted dark:text-text-muted-dark/70" />
            <p className="text-sm text-text-muted dark:text-text-muted-dark mb-2">
              Execute this node to view data
            </p>
          </div>
        </div>
      )}

      {output && node.type === 'http-request' && (
        <>
          <div className="flex-shrink-0 px-4 py-3 bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold px-2 py-1 rounded bg-primary/15 dark:bg-primary-dark/25 text-primary dark:text-primary-dark">
                {initialConfig.method || 'GET'}
              </span>
              <span className="text-text-secondary dark:text-text-secondary-dark truncate font-mono text-xs">
                {initialConfig.url || '\u2014'}
              </span>
            </div>
          </div>

          <div className="flex-shrink-0 px-4 py-2 bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark flex gap-1 overflow-x-auto">
            <Button
              onClick={() => setActiveTab('body')}
              variant={activeTab === 'body' ? 'primary' : 'ghost'}
              size="xs"
            >
              Body
            </Button>
            <Button
              onClick={() => setActiveTab('headers')}
              variant={activeTab === 'headers' ? 'primary' : 'ghost'}
              size="xs"
            >
              Headers ({Object.keys(headers).length})
            </Button>
            <Button
              onClick={() => setActiveTab('cookies')}
              variant={activeTab === 'cookies' ? 'primary' : 'ghost'}
              size="xs"
            >
              Cookies ({Object.keys(cookies).length})
            </Button>
            <Button
              onClick={() => setActiveTab('raw')}
              variant={activeTab === 'raw' ? 'primary' : 'ghost'}
              size="xs"
            >
              Raw
            </Button>
          </div>

          <div className="flex-1 overflow-auto bg-surface dark:bg-surface-dark">
            {activeTab === 'body' && <CodeBlock value={body ?? '(empty)'} />}
            {activeTab === 'headers' && <CodeBlock value={headers} />}
            {activeTab === 'cookies' && <CodeBlock value={cookies} />}
            {activeTab === 'raw' && <CodeBlock value={output} />}
          </div>
        </>
      )}

      {output && node.type !== 'http-request' && (
        <div className="flex-1 overflow-auto bg-surface dark:bg-surface-dark p-4">
          <CodeBlock value={output} />
        </div>
      )}
    </div>
  );
};
OutputPanel.displayName = 'OutputPanel';

const AssertionFormModal = ({ onAdd }: AssertionFormModalProps) => {
  const [source, setSource] = useState('prev');
  const [path, setPath] = useState('');
  const [operator, setOperator] = useState('equals');
  const [expectedValue, setExpectedValue] = useState('');
  const [errors, setErrors] = useState({ path: '', expectedValue: '' });

  const handleAdd = () => {
    if (source === 'status') {
      onAdd({
        source: source.trim(),
        path: '',
        operator,
        expectedValue: expectedValue.trim(),
      });
    } else if (['exists', 'notExists'].includes(operator)) {
      if (path.trim()) {
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator,
          expectedValue: '',
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        setErrors({ path: 'Path is required', expectedValue: '' });
        return;
      }
    } else if (operator === 'count') {
      if (path.trim() && expectedValue.trim()) {
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator: 'count',
          expectedValue: expectedValue.trim(),
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        setErrors({ path: path.trim() ? '' : 'Path is required', expectedValue: expectedValue.trim() ? '' : 'Expected count is required' });
        return;
      }
    } else {
      if (path.trim() && expectedValue.trim()) {
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator,
          expectedValue: expectedValue.trim(),
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        setErrors({ path: path.trim() ? '' : 'Path is required', expectedValue: expectedValue.trim() ? '' : 'Expected value is required' });
        return;
      }
    }

    setPath('');
    setExpectedValue('');
    setSource('prev');
    setOperator('equals');
  };

  return (
    <div className="space-y-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
      <div>
        <label className="block text-xs font-semibold text-text-secondary dark:text-text-secondary-dark mb-1.5">
          Assert On
        </label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full px-3 py-2 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="prev">Previous Node Result (prev.*)</option>
          <option value="variables">Workflow Variables (variables.*)</option>
          <option value="status">HTTP Status Code</option>
          <option value="cookies">Cookies</option>
          <option value="headers">Response Headers</option>
        </select>
      </div>

      {source !== 'status' && (
        <div>
          <label className="block text-xs font-semibold text-text-secondary dark:text-text-secondary-dark mb-1.5">
            {source === 'prev' ? 'JSONPath (e.g., body.status)' :
             source === 'variables' ? 'Variable name' :
             source === 'cookies' ? 'Cookie name' : 'Header name'}
          </label>
          <div>
            <Input
              type="text"
              placeholder={source === 'prev' ? 'body.status' : source === 'variables' ? 'tokenId' : 'Set-Cookie'}
              value={path}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setPath(e.target.value); setErrors({ ...errors, path: '' }); }}
              {...(errors.path ? { error: errors.path } : {})}
            />
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-text-secondary dark:text-text-secondary-dark mb-1.5">
          Operator
        </label>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          className="w-full px-3 py-2 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="equals">Equals (==)</option>
          <option value="notEquals">Not Equals (!=)</option>
          <option value="contains">Contains</option>
          <option value="notContains">Does Not Contain</option>
          <option value="gt">Greater Than (&gt;)</option>
          <option value="gte">Greater Than or Equal (&gt;=)</option>
          <option value="lt">Less Than (&lt;)</option>
          <option value="lte">Less Than or Equal (&lt;=)</option>
          <option value="count">Count (array length)</option>
          <option value="exists">Exists</option>
          <option value="notExists">Does Not Exist</option>
        </select>
      </div>

      {!['exists', 'notExists'].includes(operator) && (
        <div>
          <label className="block text-xs font-semibold text-text-secondary dark:text-text-secondary-dark mb-1.5">
            {operator === 'count' ? 'Expected Count' : 'Expected Value'}
          </label>
          <div>
            <Input
              type="text"
              placeholder={operator === 'count' ? '5' : '200'}
              value={expectedValue}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setExpectedValue(e.target.value); setErrors({ ...errors, expectedValue: '' }); }}
              {...(errors.expectedValue ? { error: errors.expectedValue } : {})}
              className="font-mono"
            />
          </div>
        </div>
      )}

      <Button onClick={handleAdd} variant="primary" intent="success" size="sm" fullWidth>
        Add Assertion
      </Button>
    </div>
  );
};

const AssertionConfig = ({ initialConfig, workingDataRef }: AssertionConfigProps) => {
  const [activeTab, setActiveTab] = useState('parameters');
  const [assertions, setAssertions] = useState<AssertionItem[]>(initialConfig.assertions || []);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editDraft, setEditDraft] = useState<AssertionItem | null>(null);

  const handleAddAssertion = (assertion: AssertionItem) => {
    const updated = [...assertions, assertion];
    setAssertions(updated);

    if (workingDataRef) {
      workingDataRef.current = {
        ...workingDataRef.current,
        config: {
          ...(workingDataRef.current.config as Record<string, unknown>),
          assertions: updated
        }
      };
    }
  };

  const handleDeleteAssertion = (index: number) => {
    const updated = assertions.filter((_, i) => i !== index);
    setAssertions(updated);

    if (workingDataRef) {
      workingDataRef.current = {
        ...workingDataRef.current,
        config: {
          ...(workingDataRef.current.config as Record<string, unknown>),
          assertions: updated
        }
      };
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex border-b border-border dark:border-border-dark px-4">
        <TabButton id="parameters" label="Assertions" activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="settings" label="Settings" activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'parameters' && (
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1 flex items-center gap-2">
                <Info className="w-4 h-4" />
                <span>Assertion Configuration</span>
              </p>
              <p className="text-xs">
                Assertions configured: <span className="font-bold">{assertions.length}</span>
              </p>
              <p className="text-xs mt-2">
                If ANY assertion fails, the workflow will fail at this node.
              </p>
            </div>

            <AssertionFormModal onAdd={handleAddAssertion} />

            {assertions.length > 0 ? (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark">
                  Current Assertions ({assertions.length})
                </h4>
                {assertions.map((assertion, index) => (
                  <div
                    key={index}
                    className="p-3 bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark rounded-lg space-y-2"
                  >
                    {editingIndex === index ? (
                      <AssertionEditor
                        value={editDraft as AssertionItem}
                        onChange={(next) => setEditDraft(next as AssertionItem)}
                        onCancel={() => {
                          setEditingIndex(-1);
                          setEditDraft(null);
                        }}
                        onSave={() => {
                          const updatedAssertion = { ...editDraft } as AssertionItem;
                          const updated = assertions.map((a, i) => (i === index ? updatedAssertion : a));
                          setAssertions(updated);
                          if (workingDataRef) {
                            workingDataRef.current = {
                              ...workingDataRef.current,
                              config: {
                                ...(workingDataRef.current.config as Record<string, unknown>),
                                assertions: updated
                              }
                            };
                          }
                          setEditingIndex(-1);
                          setEditDraft(null);
                        }}
                      />
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 text-sm">
                          <div className="text-green-700 dark:text-green-300 font-semibold font-mono">
                            {assertion.source === 'prev' ? '{{prev.' :
                             assertion.source === 'variables' ? '{{variables.' :
                             assertion.source === 'status' ? 'status' :
                             assertion.source === 'cookies' ? 'Cookie: ' :
                             'Header: '}
                            {assertion.source !== 'status' && assertion.path}
                            {(assertion.source === 'prev' || assertion.source === 'variables') && '}}'}
                          </div>
                          <div className="text-text-secondary dark:text-text-secondary-dark mt-1 text-xs">
                            <span className="font-medium">{assertion.operator}</span>
                            {assertion.expectedValue && (
                              <>
                                {' '}<code className="bg-surface dark:bg-surface-dark-raised px-1.5 py-0.5 rounded">{assertion.expectedValue}</code>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 min-w-[92px]">
                          <Button
                            onClick={() => {
                              setEditingIndex(index);
                              setEditDraft({ ...assertion });
                            }}
                            variant="primary"
                            intent="warning"
                            size="xs"
                            className="!justify-start"
                            title="Edit assertion"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </Button>
                          <Button
                            onClick={() => handleDeleteAssertion(index)}
                            variant="primary"
                            intent="error"
                            size="xs"
                            className="!justify-start"
                            title="Delete assertion"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-text-muted dark:text-text-muted-dark italic text-center py-6 border-2 border-dashed border-border dark:border-border-dark rounded-lg">
                No assertions yet. Add one above to get started.
              </div>
            )}

            <div className="text-xs text-text-muted dark:text-text-muted-dark space-y-1 p-3 bg-surface-overlay dark:bg-surface-dark-overlay rounded-lg border border-border dark:border-border-dark">
              <p><strong>Tips:</strong></p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Use <code className="bg-surface dark:bg-surface-dark-raised px-1">prev.*</code> to reference the previous node&apos;s response</li>
                <li>Use <code className="bg-surface dark:bg-surface-dark-raised px-1">variables.*</code> to reference workflow variables</li>
                <li>JSONPath example: <code className="bg-surface dark:bg-surface-dark-raised px-1">body.data[0].id</code></li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted dark:text-text-muted-dark">
              No additional settings for assertion nodes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
AssertionConfig.displayName = 'AssertionConfig';

const DelayConfig = ({ initialConfig, workingDataRef }: DelayConfigProps) => {
  const [activeTab, setActiveTab] = useState('parameters');

  const durationRef = useRef(initialConfig.duration || 1000);

  const updateRef = () => {
    const newConfig = {
      duration: durationRef.current
    };
    if (workingDataRef) {
      workingDataRef.current = { ...workingDataRef.current, config: newConfig };
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex border-b border-border dark:border-border-dark px-4">
        <TabButton id="parameters" label="Parameters" activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <FormField
          label="Duration"
          hint={`${(durationRef.current || 1000) / 1000} second${(durationRef.current || 1000) !== 1000 ? 's' : ''}`}
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              defaultValue={initialConfig.duration || 1000}
              onBlur={() => updateRef()}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                durationRef.current = parseInt(e.target.value) || 1000;
              }}
              className="w-32"
              min="100"
              step="100"
            />
            <span className="text-sm text-text-secondary dark:text-text-secondary-dark">milliseconds</span>
          </div>
        </FormField>
      </div>
    </div>
  );
};
DelayConfig.displayName = 'DelayConfig';

const MergeConfig = ({ initialConfig, workingDataRef }: MergeConfigProps) => {
  const [activeTab, setActiveTab] = useState('parameters');
  const [currentStrategy, setCurrentStrategy] = useState(initialConfig.mergeStrategy || 'all');
  const [conditions, setConditions] = useState<MergeConditionType[]>(initialConfig.conditions || []);
  const [conditionLogic, setConditionLogic] = useState(initialConfig.conditionLogic || 'OR');

  const strategyRef = useRef(initialConfig.mergeStrategy || 'all');
  const conditionsRef = useRef<MergeConditionType[]>(initialConfig.conditions || []);
  const conditionLogicRef = useRef(initialConfig.conditionLogic || 'OR');

  const updateRef = () => {
    const newConfig: MergeConfigType = {
      mergeStrategy: strategyRef.current,
      conditions: conditionsRef.current,
      conditionLogic: conditionLogicRef.current
    };
    if (workingDataRef) {
      workingDataRef.current = { ...workingDataRef.current, config: newConfig };
    }
  };

  const strategyDescriptions: Record<string, string> = {
    all: 'Waits for all incoming branches to complete before continuing (AND logic).',
    any: 'Continues as soon as any branch completes (OR logic).',
    first: 'Uses the first branch that completes and ignores the rest.',
    conditional: 'Merges only branches that match the configured conditions.'
  };

  const addCondition = () => {
    const newConditions: MergeConditionType[] = [
      ...conditionsRef.current,
      { branchIndex: 0, field: 'statusCode', operator: 'equals', value: '200' }
    ];
    conditionsRef.current = newConditions;
    setConditions(newConditions);
    updateRef();
  };

  const removeCondition = (index: number) => {
    const newConditions = conditionsRef.current.filter((_, i) => i !== index);
    conditionsRef.current = newConditions;
    setConditions(newConditions);
    updateRef();
  };

  const updateCondition = (index: number, updates: Partial<MergeConditionType>) => {
    const newConditions = conditionsRef.current.map((cond, i) =>
      i === index ? { ...cond, ...updates } : cond
    );
    conditionsRef.current = newConditions;
    setConditions(newConditions);
    updateRef();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex border-b border-border dark:border-border-dark px-4">
        <TabButton id="parameters" label="Merge Strategy" activeTab={activeTab} setActiveTab={setActiveTab} colorScheme="purple" />
        {currentStrategy === 'conditional' && (
          <TabButton id="conditions" label="Conditions" activeTab={activeTab} setActiveTab={setActiveTab} colorScheme="purple" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'parameters' && (
          <>
            <FormField
              label="Wait Strategy"
              hint={strategyDescriptions[currentStrategy] || strategyDescriptions.all}
            >
              <select
                value={currentStrategy}
                onChange={(e) => {
                  const newStrategy = e.target.value;
                  strategyRef.current = newStrategy;
                  setCurrentStrategy(newStrategy);
                  updateRef();
                  if (newStrategy === 'conditional') {
                    setActiveTab('conditions');
                  }
                }}
                className="w-full px-3 py-2 text-sm border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="all">Wait for All (AND)</option>
                <option value="any">Wait for Any (OR)</option>
                <option value="first">First Completes</option>
                <option value="conditional">Conditional Merge</option>
              </select>
            </FormField>

            <div className="mt-6 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg">
              <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-200 mb-2">How Merge Works</h4>
              <ul className="text-xs text-purple-800 dark:text-purple-300 space-y-1">
                <li> Multiple edges leading to this node create parallel branches</li>
                <li> Access branch results using: <code className="bg-surface dark:bg-surface-dark px-1 py-0.5 rounded">{'{{prev[0].response}}'}</code></li>
                <li> Index [0], [1], [2]... corresponds to branch execution order</li>
                <li> Use <code className="bg-surface dark:bg-surface-dark px-1 py-0.5 rounded">{'{{prev.response}}'}</code> for single predecessor (backward compatible)</li>
                {currentStrategy === 'conditional' && (
                  <li className="mt-2 pt-2 border-t border-purple-300 dark:border-purple-700">
                    <strong>Conditional:</strong> Define conditions to filter which branches to merge
                  </li>
                )}
              </ul>
            </div>
          </>
        )}

        {activeTab === 'conditions' && currentStrategy === 'conditional' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark">
                Merge Conditions
              </h3>
              <Button
                onClick={addCondition}
                variant="primary"
                size="xs"
                className="!px-3"
              >
                Add Condition
              </Button>
            </div>

            {conditions.length > 1 && (
              <div className="mb-4 p-3 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-lg">
                <label className="block text-xs font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                  Evaluation Logic:
                </label>
                <div className="flex gap-3">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="conditionLogic"
                      value="OR"
                      checked={conditionLogic === 'OR'}
                      onChange={(e) => {
                        const newLogic = e.target.value;
                        conditionLogicRef.current = newLogic;
                        setConditionLogic(newLogic);
                        updateRef();
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm text-text-secondary dark:text-text-secondary-dark">
                      <strong>OR</strong> - Match ANY condition
                    </span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="conditionLogic"
                      value="AND"
                      checked={conditionLogic === 'AND'}
                      onChange={(e) => {
                        const newLogic = e.target.value;
                        conditionLogicRef.current = newLogic;
                        setConditionLogic(newLogic);
                        updateRef();
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm text-text-secondary dark:text-text-secondary-dark">
                      <strong>AND</strong> - Match ALL conditions
                    </span>
                  </label>
                </div>
                <p className="text-xs text-text-muted dark:text-text-muted-dark mt-2 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>
                    {conditionLogic === 'OR'
                      ? 'A branch is merged if it matches at least one condition'
                      : 'A branch is merged only if it matches all conditions'}
                  </span>
                </p>
              </div>
            )}

            {conditions.length === 0 ? (
              <div className="text-sm text-text-muted dark:text-text-muted-dark text-center py-8 border-2 border-dashed border-border dark:border-border-dark rounded-lg">
                No conditions defined. Click &quot;Add Condition&quot; to start.
              </div>
            ) : (
              <div className="space-y-3">
                {conditions.map((condition, index) => (
                  <div
                    key={index}
                    className="p-3 border border-border dark:border-border-dark rounded-lg bg-surface dark:bg-surface-dark"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-text-secondary dark:text-text-secondary-dark">
                        Condition {index + 1} {conditions.length > 1 && index < conditions.length - 1 && (
                          <span className="ml-2 text-purple-600 dark:text-purple-400 font-bold">
                            {conditionLogic}
                          </span>
                        )}
                      </span>
                      <Button
                        onClick={() => removeCondition(index)}
                        variant="ghost"
                        size="xs"
                        className="!p-1 !min-w-0 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-text-secondary dark:text-text-secondary-dark mb-1">Branch</label>
                        <Input
                          type="number"
                          value={condition.branchIndex}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateCondition(index, { branchIndex: parseInt(e.target.value) || 0 })}
                          className="w-full"
                          min="0"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-text-secondary dark:text-text-secondary-dark mb-1">
                          Field
                          <span className="ml-1 text-[10px] text-purple-600 dark:text-purple-400">
                            (supports variables)
                          </span>
                        </label>
                        <Input
                          type="text"
                          value={condition.field}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateCondition(index, { field: e.target.value })}
                          className="w-full font-mono"
                          placeholder="statusCode or {{prev[0].response.body.name}}"
                        />
                        <div className="mt-0.5 text-[9px] text-text-muted dark:text-text-muted-dark">
                          Common: <code>statusCode</code>, <code>response.body</code>, <code>response.headers</code>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-text-secondary dark:text-text-secondary-dark mb-1">Operator</label>
                        <select
                          value={condition.operator}
                          onChange={(e) => updateCondition(index, { operator: e.target.value })}
                          className="w-full px-2 py-1 text-xs border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                        >
                          <option value="equals">Equals</option>
                          <option value="notEquals">Not Equals</option>
                          <option value="contains">Contains</option>
                          <option value="gt">Greater Than</option>
                          <option value="lt">Less Than</option>
                          <option value="exists">Exists</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-text-secondary dark:text-text-secondary-dark mb-1">
                          Value
                          <span className="ml-1 text-[10px] text-purple-600 dark:text-purple-400">
                            (supports variables)
                          </span>
                        </label>
                        <Input
                          type="text"
                          value={condition.value}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateCondition(index, { value: e.target.value })}
                          className="w-full font-mono"
                          placeholder="200 or {{prev[0].id}}"
                        />
                      </div>
                    </div>

                    <div className="mt-2 text-[10px] text-text-muted dark:text-text-muted-dark bg-surface-overlay dark:bg-surface-dark-overlay rounded p-1.5">
                      Examples: <code className="text-purple-600 dark:text-purple-400">200</code>,
                      <code className="ml-1 text-purple-600 dark:text-purple-400">{'{{prev[0].response.body.status}}'}</code>,
                      <code className="ml-1 text-purple-600 dark:text-purple-400">{'{{variables.expectedCode}}'}</code>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
              <p className="text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <span><strong>How it works:</strong> {conditionLogic === 'OR'
                  ? 'Each branch is evaluated independently. If a branch matches ANY condition, it passes.'
                  : 'Each branch is evaluated independently. A branch passes ONLY if it matches ALL conditions.'}</span>
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-2 font-semibold flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span><strong>Important:</strong> If ANY branch fails its conditions, the entire merge FAILS and the workflow stops (like an assertion).</span>
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-2 flex items-start gap-2">
                <span><strong>Variable support:</strong> Use <code className="bg-surface dark:bg-surface-dark px-1 rounded">{'{{prev[N].path}}'}</code> to reference other branch data or <code className="bg-surface dark:bg-surface-dark px-1 rounded">{'{{variables.name}}'}</code> for workflow variables.</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
MergeConfig.displayName = 'MergeConfig';

export default NodeModal;
