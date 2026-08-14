/**
 * What a rejected workflow save can tell us about itself. The IPC shim reports
 * failures as `{ detail, code, details }`; `detail` is the human message,
 * `code` the contract error code, and `issues` the zod validation issues
 * (path + message each) when the request failed input validation.
 */
export interface SaveFailureEnvelope {
  detail?: string;
  code?: string;
  issues: readonly string[];
}
