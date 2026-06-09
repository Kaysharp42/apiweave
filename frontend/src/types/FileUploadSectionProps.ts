import type { FileUpload } from './FileUpload';

export interface FileUploadSectionProps {
  fileUploads?: FileUpload[];
  onUpdate: (uploads: FileUpload[]) => void;
  variables?: Record<string, unknown>;
}
