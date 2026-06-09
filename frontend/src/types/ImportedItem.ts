export interface ImportedItem {
  label: string;
  url: string;
  method: string;
  headers: string;
  body: string;
  queryParams: string;
  pathVariables: string;
  cookies: string;
  timeout: number;
  openapiMeta: unknown;
}