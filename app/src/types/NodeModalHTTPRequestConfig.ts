import type { FileUpload } from "./FileUpload";
import type { AuthConfig } from "@shared/types/AuthConfig";
import type { FormDataEntry } from "@shared/types/FormDataEntry";
import type { HTTPRequestBodyType } from "./HTTPRequestBodyType";
import type { KeyValuePair } from "@shared/types/KeyValuePair";
import type { UrlEncodedEntry } from "@shared/types/UrlEncodedEntry";
import type { NodeModalHttpRetryConfig } from "./NodeModalHttpRetryConfig";
import type { HttpScriptsConfig } from "@shared/types/HttpScriptsConfig";
import type { JsonValue } from "@shared/types/JsonValue";
import type { GraphqlBody } from "@shared/types/GraphqlBody";

export interface NodeModalHTTPRequestConfig {
  url?: string;
  method?: string;
  queryParams?: string | KeyValuePair[];
  headers?: string | KeyValuePair[];
  cookies?: string | KeyValuePair[];
  body?: string;
  bodyType?: HTTPRequestBodyType;
  graphql?: GraphqlBody | undefined;
  timeout?: number;
  extractors?: Record<string, string>;
  fileUploads?: FileUpload[];
  auth?: AuthConfig;
  followRedirects?: boolean;
  sslVerify?: boolean;
  useCookieJar?: boolean;
  continueOnFail?: boolean;
  expectedStatus?: number | number[] | undefined;
  retry?: NodeModalHttpRetryConfig | undefined;
  scripts?: HttpScriptsConfig | undefined;
  responseSchemas?: Record<string, JsonValue> | undefined;
  formDataEntries?: FormDataEntry[];
  urlEncodedEntries?: UrlEncodedEntry[];
}
