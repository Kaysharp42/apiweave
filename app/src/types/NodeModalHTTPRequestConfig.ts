import type { FileUpload } from "./FileUpload";
import type { AuthConfig } from "@shared/types/AuthConfig";
import type { FormDataEntry } from "@shared/types/FormDataEntry";
import type { HTTPRequestBodyType } from "./HTTPRequestBodyType";
import type { KeyValuePair } from "@shared/types/KeyValuePair";
import type { UrlEncodedEntry } from "@shared/types/UrlEncodedEntry";

export interface NodeModalHTTPRequestConfig {
  url?: string;
  method?: string;
  queryParams?: string | KeyValuePair[];
  headers?: string | KeyValuePair[];
  cookies?: string | KeyValuePair[];
  body?: string;
  bodyType?: HTTPRequestBodyType;
  timeout?: number;
  extractors?: Record<string, string>;
  fileUploads?: FileUpload[];
  auth?: AuthConfig;
  followRedirects?: boolean;
  sslVerify?: boolean;
  continueOnFail?: boolean;
  formDataEntries?: FormDataEntry[];
  urlEncodedEntries?: UrlEncodedEntry[];
}
