import { useState, useRef, type ChangeEvent } from 'react';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { TextArea } from '../atoms/TextArea';
import { BeautifyButton } from '../molecules/BeautifyButton';
import { FormField } from '../molecules/FormField';
import { PanelTabs } from '../molecules/PanelTabs';
import FileUploadSection from '../FileUploadSection';
import { useWorkflow } from '../../contexts/WorkflowContext';
import type { HttpMethod } from '../../types/HttpMethod';
import type { HTTPRequestConfigPanelProps } from '../../types/HTTPRequestConfigPanelProps';
import type { FileUpload } from '../../types/FileUpload';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

export function HTTPRequestConfigPanel({ initialConfig, workingDataRef }: HTTPRequestConfigPanelProps) {
  const [activeTab, setActiveTab] = useState('parameters');
  const { variables } = useWorkflow();

  const urlRef = useRef(initialConfig.url || '');
  const methodRef = useRef(initialConfig.method || 'GET');
  const [methodValue, setMethodValue] = useState(initialConfig.method || 'GET');
  const queryParamsRef = useRef(initialConfig.queryParams || '');
  const headersRef = useRef(initialConfig.headers || '');
  const cookiesRef = useRef(initialConfig.cookies || '');
  const bodyRef = useRef(initialConfig.body || '');
  const [bodyValue, setBodyValue] = useState(initialConfig.body || '');
  const timeoutRef = useRef(initialConfig.timeout || 30);
  const fileUploadsRef = useRef(initialConfig.fileUploads || []);
  const [fileUploads, setFileUploads] = useState<FileUpload[]>(initialConfig.fileUploads || []);

  const updateRef = () => {
    const newConfig = {
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
      <PanelTabs
        tabs={[
          { key: 'parameters', label: 'Parameters' },
          { key: 'settings', label: 'Settings' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'parameters' && (
          <div className="space-y-4">
            <FormField label="HTTP Method">
              <div className="flex gap-2">
                {HTTP_METHODS.map((method) => (
                  <Button
                    key={method}
                    type="button"
                    size="xs"
                    variant={methodValue === method ? 'primary' : 'ghost'}
                    onClick={() => {
                      methodRef.current = method;
                      setMethodValue(method);
                      updateRef();
                    }}
                    className="cursor-pointer"
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
              <div className="relative">
                <TextArea
                  value={bodyValue}
                  onBlur={() => { bodyRef.current = bodyValue; updateRef(); }}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                    setBodyValue(e.target.value);
                    bodyRef.current = e.target.value;
                  }}
                  className="font-mono"
                  placeholder='{"key": "{{variables.value}}"}'
                  rows={6}
                />
                <div className="absolute top-2 right-2 z-10">
                  <BeautifyButton
                    value={bodyValue}
                    onChange={(val) => {
                      setBodyValue(val);
                      bodyRef.current = val;
                      updateRef();
                    }}
                  />
                </div>
              </div>
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
}