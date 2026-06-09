import type { FileUpload } from './FileUpload';

export interface NodeModalHTTPRequestConfig {
  url?: string;
  method?: string;
  queryParams?: string;
  headers?: string;
  cookies?: string;
  body?: string;
  timeout?: number;
  fileUploads?: FileUpload[];
}