import type { ContractErrorCode } from "@shared/contract/errors"

export type McpToolError = {
  readonly code: ContractErrorCode
  readonly message: string
  /** Router errors occur before a handler can return a successful write result. */
  readonly writeCommitted: false
  readonly details?: {
    readonly expectedRevision?: number
    readonly currentRevision?: number
    readonly paths?: readonly string[]
    readonly issues?: readonly McpValidationIssue[]
  }
}

type McpValidationIssue = {
  readonly code?: string
  readonly path?: readonly (string | number)[]
  readonly expected?: string
  readonly message: string
}

const MAX_ISSUES = 20

/** Preserve only details an agent can act on, never submitted values or raw Zod objects. */
export function projectMcpError(code: ContractErrorCode, message: string, details: unknown): McpToolError {
  const projected = code === "conflict"
    ? conflictDetails(details)
    : code === "validation"
      ? validationDetails(details)
      : undefined
  return projected === undefined
    ? { code, message, writeCommitted: false }
    : { code, message, writeCommitted: false, details: projected }
}

function conflictDetails(details: unknown): McpToolError["details"] | undefined {
  if (!isRecord(details)) return undefined
  const expectedRevision = numberAt(details, "expectedRevision")
  const currentRevision = numberAt(details, "currentRevision")
  return {
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
  }
}

function validationDetails(details: unknown): McpToolError["details"] | undefined {
  if (Array.isArray(details)) {
    const issues = details
      .slice(0, MAX_ISSUES)
      .flatMap((issue) => validationIssue(issue) === undefined ? [] : [validationIssue(issue)!])
    return issues.length > 0 ? { issues } : undefined
  }
  if (!isRecord(details)) return undefined
  const paths = Array.isArray(details["paths"])
    ? details["paths"].filter((path): path is string => typeof path === "string").slice(0, MAX_ISSUES)
    : []
  return paths.length > 0 ? { paths } : undefined
}

function validationIssue(value: unknown): McpValidationIssue | undefined {
  if (!isRecord(value) || typeof value["message"] !== "string") return undefined
  const path = Array.isArray(value["path"])
    ? value["path"].filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    : undefined
  return {
    ...(typeof value["code"] === "string" ? { code: value["code"] } : {}),
    ...(path === undefined ? {} : { path }),
    ...(typeof value["expected"] === "string" ? { expected: value["expected"] } : {}),
    message: value["message"],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function numberAt(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" ? value[key] : undefined
}
