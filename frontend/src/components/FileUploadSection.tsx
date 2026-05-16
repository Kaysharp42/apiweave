import { useState, useCallback, type ChangeEvent } from 'react';
import { Plus, Trash2, Image } from 'lucide-react';
import { toast } from 'sonner';

export interface FileUpload {
  name: string;
  type: 'base64' | 'path' | 'variable';
  value: string;
  fieldName: string;
  mimeType: string;
  description: string;
}

export interface FileUploadSectionProps {
  fileUploads?: FileUpload[];
  onUpdate: (uploads: FileUpload[]) => void;
  variables?: Record<string, string>;
}

interface FormData {
  name: string;
  type: FileUpload['type'];
  value: string;
  fieldName: string;
  mimeType: string;
  description: string;
}

const defaultFormData: FormData = {
  name: '',
  type: 'base64',
  value: '',
  fieldName: 'file',
  mimeType: 'application/octet-stream',
  description: '',
};

export default function FileUploadSection({
  fileUploads = [],
  onUpdate,
  variables = {},
}: FileUploadSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target?.result as string;
      setFormData((prev) => ({
        ...prev,
        type: 'base64',
        value: base64String,
        mimeType: file.type || 'application/octet-stream',
        name: file.name,
      }));

      if (file.type.startsWith('image/')) {
        setPreviewImage(base64String);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAddFile = () => {
    if (!formData.name.trim() || !formData.value.trim() || !formData.fieldName.trim()) {
      toast.error('Please fill in name, value, and field name');
      return;
    }

    const newFile: FileUpload = {
      name: formData.name,
      type: formData.type,
      value: formData.value,
      fieldName: formData.fieldName,
      mimeType: formData.mimeType,
      description: formData.description,
    };

    onUpdate([...fileUploads, newFile]);
    setFormData(defaultFormData);
    setPreviewImage(null);
    setShowForm(false);
  };

  const handleRemoveFile = (index: number) => {
    onUpdate(fileUploads.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t dark:border-gray-700 pt-2 mt-2">
      <label className="block text-[10px] font-semibold text-text-secondary dark:text-text-primary-dark mb-0.5 flex items-center gap-1">
        File Attachments
        <span className="text-text-muted dark:text-text-muted-dark font-normal text-[9px]">
          ({fileUploads.length})
        </span>
      </label>

      <div className="space-y-1 mb-2">
        {fileUploads.length > 0 ? (
          fileUploads.map((file, idx) => (
            <div key={idx} className="flex gap-1 items-center text-[9px] p-1 bg-surface dark:bg-surface-dark/30 rounded">
              <div className="flex-1">
                <div className="font-semibold text-text-primary dark:text-text-primary-dark">{file.name}</div>
                <div className="text-[8px] text-text-muted dark:text-text-muted-dark">
                  Type: <span className="font-mono">{file.type}</span> | Field: <span className="font-mono">{file.fieldName}</span>
                </div>
                {file.description && (
                  <div className="text-[8px] text-text-muted dark:text-text-muted-dark italic">{file.description}</div>
                )}
                {file.type === 'base64' && file.value.startsWith('data:image') && (
                  <div className="mt-0.5 text-primary dark:text-primary-dark flex items-center gap-1">
                    <Image className="w-3 h-3" />
                    Image preview available
                  </div>
                )}
              </div>
              <button
                className="text-status-error dark:text-status-error hover:text-status-error/80 dark:hover:text-status-error/80 nodrag flex-shrink-0"
                onClick={() => handleRemoveFile(idx)}
                title="Delete file"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))
        ) : (
          <div className="text-[9px] text-text-muted dark:text-text-muted-dark italic">No files attached</div>
        )}
      </div>

      {!showForm ? (
        <button
          className="w-full px-2 py-1 bg-primary dark:bg-primary/90 hover:bg-primary/90 dark:hover:bg-primary/80 text-white text-[9px] font-semibold rounded nodrag transition-colors flex items-center justify-center gap-1"
          onClick={() => setShowForm(true)}
        >
          <Plus className="w-3 h-3" />
          <span>Add File</span>
        </button>
      ) : (
        <div className="space-y-1 p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded border border-dashed border-blue-300 dark:border-blue-600">
          <div>
            <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-primary-dark mb-0.5">
              File Name (identifier)
            </label>
            <input
              type="text"
              placeholder="e.g., resume, invoice"
              className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-text-muted rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-primary"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-primary-dark mb-0.5">
              Reference Type
            </label>
            <select
              className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-primary"
              value={formData.type}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, type: e.target.value as FileUpload['type'], value: '' }));
                setPreviewImage(null);
              }}
            >
              <option value="base64">Base64 Encoded (Embedded)</option>
              <option value="path">File Path (Read from disk)</option>
              <option value="variable">Variable Reference</option>
            </select>
          </div>

          <div>
            <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-primary-dark mb-0.5">
              {formData.type === 'base64' && 'Upload File or Paste Base64'}
              {formData.type === 'path' && 'File Path'}
              {formData.type === 'variable' && 'Variable Reference'}
            </label>
            {formData.type === 'base64' ? (
              <div className="space-y-1">
                <input
                  type="file"
                  onChange={handleFileSelect}
                  className="nodrag w-full text-[9px] border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary"
                  title="Select a file to upload"
                />
                <textarea
                  placeholder="Or paste base64 content here..."
                  className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-text-muted rounded text-[9px] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  value={formData.value}
                  onChange={(e) => setFormData((prev) => ({ ...prev, value: e.target.value }))}
                />
              </div>
            ) : formData.type === 'path' ? (
              <textarea
                placeholder={`e.g., /uploads/document.pdf\nor {{env.UPLOAD_DIR}}/{{variables.filename}}`}
                className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-text-muted rounded text-[9px] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                rows={2}
                value={formData.value}
                onChange={(e) => setFormData((prev) => ({ ...prev, value: e.target.value }))}
              />
            ) : (
              <textarea
                placeholder={`e.g., {{variables.filePath}}\nor {{variables.fileContent}}`}
                className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-text-muted rounded text-[9px] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                rows={2}
                value={formData.value}
                onChange={(e) => setFormData((prev) => ({ ...prev, value: e.target.value }))}
              />
            )}
          </div>

          <div>
            <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-primary-dark mb-0.5">
              HTML Field Name
            </label>
            <input
              type="text"
              placeholder="e.g., document, image, attachment"
              className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-text-muted rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-primary"
              value={formData.fieldName}
              onChange={(e) => setFormData((prev) => ({ ...prev, fieldName: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-primary-dark mb-0.5">
              MIME Type
            </label>
            <input
              type="text"
              placeholder="e.g., application/pdf, image/png"
              className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-text-muted rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-primary"
              value={formData.mimeType}
              onChange={(e) => setFormData((prev) => ({ ...prev, mimeType: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-primary-dark mb-0.5">
              Description (optional)
            </label>
            <input
              type="text"
              placeholder="e.g., User resume document"
              className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-text-muted rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-primary"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>

          {previewImage && (
            <div className="text-center">
              <img
                src={previewImage}
                alt="Preview"
                className="max-w-full max-h-20 rounded border border-border dark:border-border-dark mx-auto"
              />
            </div>
          )}

          <div className="flex gap-1">
            <button
              onClick={handleAddFile}
              className="flex-1 px-2 py-1 bg-status-success dark:bg-status-success/90 hover:bg-status-success/90 dark:hover:bg-status-success/80 text-white text-[9px] font-semibold rounded nodrag transition-colors"
            >
              Add File
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setFormData(defaultFormData);
                setPreviewImage(null);
              }}
              className="flex-1 px-2 py-1 bg-surface dark:bg-surface-dark-raised hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay text-text-primary dark:text-text-primary-dark text-[9px] font-semibold rounded nodrag transition-colors"
            >
              Cancel
            </button>
          </div>

          {formData.type === 'variable' && Object.keys(variables).length > 0 && (
            <div className="text-[8px] text-text-muted dark:text-text-muted-dark p-1 bg-surface dark:bg-surface-dark rounded">
              <strong>Available variables:</strong>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {Object.keys(variables).map((varName) => (
                  <code
                    key={varName}
                    className="bg-surface-raised dark:bg-surface-dark-raised px-1 py-0.5 rounded cursor-pointer hover:bg-primary/20 dark:hover:bg-primary/30"
                    onClick={() => setFormData((prev) => ({
                      ...prev,
                      value: `{{variables.${varName}}}`,
                    }))}
                    title="Click to insert"
                  >
                    {`{{variables.${varName}}}`}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
