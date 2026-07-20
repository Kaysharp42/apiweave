import { useState, useCallback, type ChangeEvent } from "react";
import { FilePlus2, Image, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./atoms/Button";
import { IconButton } from "./atoms/IconButton";
import { Input } from "./atoms/Input";
import { TextArea } from "./atoms/TextArea";
import { EmptyState } from "./molecules/EmptyState";
import { FormField } from "./molecules/FormField";
import type { FileUpload } from "../types/FileUpload";
import type { FileUploadSectionProps } from "../types";

// Re-export for backward compatibility
export type { FileUpload } from "../types/FileUpload";

const EMPTY_FILE_UPLOADS: FileUpload[] = [];
const EMPTY_VARIABLES: Record<string, unknown> = {};

interface FormData {
  name: string;
  type: FileUpload["type"];
  value: string;
  fieldName: string;
  mimeType: string;
  description: string;
}

const defaultFormData: FormData = {
  name: "",
  type: "base64",
  value: "",
  fieldName: "file",
  mimeType: "application/octet-stream",
  description: "",
};

export default function FileUploadSection({
  fileUploads = EMPTY_FILE_UPLOADS,
  onUpdate,
  variables = EMPTY_VARIABLES,
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
        type: "base64",
        value: base64String,
        mimeType: file.type || "application/octet-stream",
        name: file.name,
      }));

      if (file.type.startsWith("image/")) {
        setPreviewImage(base64String);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAddFile = () => {
    if (
      !formData.name.trim() ||
      !formData.value.trim() ||
      !formData.fieldName.trim()
    ) {
      toast.error("Please fill in name, value, and field name");
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
    <div className="space-y-3">
      {fileUploads.map((file, index) => (
        <div
          key={`${file.fieldName}-${file.name}`}
          className="flex items-center gap-3 rounded-sm border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay"
        >
          <FilePlus2
            className="h-5 w-5 flex-shrink-0 text-text-muted dark:text-text-muted-dark"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-primary dark:text-text-primary-dark">
              {file.name}
            </p>
            <p className="truncate font-mono text-xs text-text-secondary dark:text-text-secondary-dark">
              {file.type} · {file.fieldName} · {file.mimeType}
            </p>
            {file.description && (
              <p className="mt-1 text-xs text-text-muted dark:text-text-muted-dark">
                {file.description}
              </p>
            )}
            {file.type === "base64" &&
              file.value.startsWith("data:image") && (
                <p className="mt-1 flex items-center gap-1 text-xs text-primary dark:text-primary-light">
                  <Image className="h-3.5 w-3.5" aria-hidden="true" />
                  Image preview available
                </p>
              )}
          </div>
          <IconButton
            tooltip={`Remove ${file.name}`}
            size="xs"
            variant="ghost"
            onClick={() => handleRemoveFile(index)}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      ))}

      {fileUploads.length === 0 && !showForm && (
        <EmptyState
          icon={
            <FilePlus2
              className="h-10 w-10 text-text-muted dark:text-text-muted-dark"
              strokeWidth={1.5}
            />
          }
          title="No binary file"
          description="Attach embedded content, a local path, or a workflow variable."
          action={
            <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
              <FilePlus2 className="h-4 w-4" />
              Add file
            </Button>
          }
          className="min-h-80 rounded-sm border border-dashed border-border bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-overlay"
        />
      )}

      {fileUploads.length > 0 && !showForm && (
        <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
          <FilePlus2 className="h-4 w-4" />
          Add another file
        </Button>
      )}

      {showForm && (
        <div className="space-y-4 rounded-sm border border-border bg-surface-overlay p-4 dark:border-border-dark dark:bg-surface-dark-overlay">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="File name" required>
              <Input
                value={formData.name}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }))
                }
                placeholder="resume"
              />
            </FormField>
            <FormField label="Reference type" required>
              <select
                value={formData.type}
                onChange={(event) => {
                  setFormData((previous) => ({
                    ...previous,
                    type: event.target.value as FileUpload["type"],
                    value: "",
                  }));
                  setPreviewImage(null);
                }}
                className="h-10 w-full cursor-pointer rounded-sm border border-border bg-surface-raised px-3 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
              >
                <option value="base64">Embedded base64</option>
                <option value="path">Local file path</option>
                <option value="variable">Variable reference</option>
              </select>
            </FormField>
          </div>

          {formData.type === "base64" ? (
            <div className="space-y-4">
              <FormField label="Choose file">
                <Input
                  type="file"
                  onChange={handleFileSelect}
                  aria-label="Upload base64 file"
                />
              </FormField>
              <FormField label="Base64 content" required>
                <TextArea
                  value={formData.value}
                  onChange={(event) =>
                    setFormData((previous) => ({
                      ...previous,
                      value: event.target.value,
                    }))
                  }
                  placeholder="Paste base64 content"
                  rows={4}
                  className="font-mono"
                />
              </FormField>
            </div>
          ) : (
            <FormField
              label={formData.type === "path" ? "File path" : "Variable reference"}
              required
            >
              <TextArea
                value={formData.value}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    value: event.target.value,
                  }))
                }
                placeholder={
                  formData.type === "path"
                    ? "/uploads/document.pdf"
                    : "{{variables.filePath}}"
                }
                rows={3}
                className="font-mono"
              />
            </FormField>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Form field name" required>
              <Input
                value={formData.fieldName}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    fieldName: event.target.value,
                  }))
                }
                placeholder="file"
              />
            </FormField>
            <FormField label="MIME type">
              <Input
                value={formData.mimeType}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    mimeType: event.target.value,
                  }))
                }
                placeholder="application/octet-stream"
                className="font-mono"
              />
            </FormField>
          </div>

          <FormField label="Description">
            <Input
              value={formData.description}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  description: event.target.value,
                }))
              }
              placeholder="Optional note"
            />
          </FormField>

          {previewImage && (
            <img
              src={previewImage}
              alt="Selected file preview"
              className="max-h-32 max-w-full rounded-sm border border-border dark:border-border-dark"
            />
          )}

          {formData.type === "variable" && Object.keys(variables).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.keys(variables).map((variableName) => (
                <Button
                  key={variableName}
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setFormData((previous) => ({
                      ...previous,
                      value: `{{variables.${variableName}}}`,
                    }))
                  }
                >
                  {`{{variables.${variableName}}}`}
                </Button>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setFormData(defaultFormData);
                setPreviewImage(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleAddFile}>
              Add file
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
