export interface FileUpload {
  name: string;
  type: "base64" | "path" | "variable";
  value: string;
  fieldName: string;
  mimeType: string;
  description: string;
}
