import type {
  ApiResponse,
  NodeResultMetadata,
  ResponseCookie,
} from "../../types";
import type { NodeModalNodeType } from "../../types/NodeModalNodeType";
import {
  Globe,
  Timer,
  GitMerge,
  Circle,
  Square,
  BadgeCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const getNodeIcon = (type: NodeModalNodeType): LucideIcon => {
  const iconMap: Record<NodeModalNodeType, LucideIcon> = {
    "http-request": Globe,
    assertion: BadgeCheck,
    delay: Timer,
    merge: GitMerge,
    start: Circle,
    end: Square,
  };
  return iconMap[type] ?? Circle;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getRecordValue = (
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined => {
  const value = source[key];
  return isRecord(value) ? value : undefined;
};

export const getStringValue = (
  source: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
};

export const getNumberValue = (
  source: Record<string, unknown> | undefined,
  key: string,
): number | undefined => {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
};

export const stringifyForRawBody = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return undefined;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const toStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, unknown] =>
          entry[1] !== undefined && entry[1] !== null,
      )
      .map(([key, entryValue]) => [key, String(entryValue)]),
  );
};

export const getCaseInsensitiveHeader = (
  headers: Record<string, string>,
  headerName: string,
): string | undefined => {
  const normalizedHeaderName = headerName.toLowerCase();
  return Object.entries(headers).find(
    ([key]) => key.toLowerCase() === normalizedHeaderName,
  )?.[1];
};

export const getRawBody = (
  output: Record<string, unknown>,
): string | undefined => {
  const rawBody =
    getStringValue(output, "rawBody") ?? getStringValue(output, "raw_body");
  return rawBody ?? stringifyForRawBody(output.body);
};

export const parseJsonBodyIfNeeded = (
  body: unknown,
  contentType: string,
): unknown => {
  if (typeof body !== "string" || !contentType.toLowerCase().includes("json"))
    return body;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
};

export const inferBodyFormat = (contentType: string, body: unknown): string => {
  const normalizedContentType = contentType.toLowerCase();
  if (normalizedContentType.includes("json") || typeof body === "object")
    return "json";
  if (normalizedContentType.includes("text/html")) return "html";
  if (normalizedContentType.startsWith("image/")) return "image";
  if (
    normalizedContentType.startsWith("text/") ||
    normalizedContentType.includes("xml")
  )
    return "text";
  if (normalizedContentType.includes("octet-stream")) return "binary";
  return "text";
};

const isResponseCookie = (value: unknown): value is ResponseCookie => {
  if (!isRecord(value)) return false;

  const { name, value: cookieValue, attributes } = value;

  return (
    typeof name === "string" &&
    typeof cookieValue === "string" &&
    isRecord(attributes) &&
    Object.values(attributes).every(
      (attributeValue) =>
        typeof attributeValue === "string" ||
        typeof attributeValue === "boolean",
    )
  );
};

const getResponseCookies = (
  source: Record<string, unknown> | undefined,
): ResponseCookie[] | undefined => {
  if (!source) return undefined;

  const cookies = source.cookies;
  if (!Array.isArray(cookies)) return undefined;

  const parsedCookies = cookies.filter(isResponseCookie);
  return parsedCookies.length > 0 ? parsedCookies : undefined;
};

const countCookies = (
  output: Record<string, unknown>,
  headers: Record<string, string>,
): number => {
  const responseCookies =
    getResponseCookies(output) ??
    getResponseCookies(getRecordValue(output, "response"));
  if (responseCookies) return responseCookies.length;

  const setCookieHeader = getCaseInsensitiveHeader(headers, "set-cookie");
  if (!setCookieHeader) return 0;
  return setCookieHeader.split(/,(?=\s*[^;,=]+=[^;,]+)/).filter(Boolean).length;
};

export const createInspectorResponse = (
  output: Record<string, unknown>,
): ApiResponse => {
  const nestedResponse = getRecordValue(output, "response");
  const headers = toStringRecord(output.headers ?? nestedResponse?.headers);
  const status =
    getNumberValue(output, "statusCode") ??
    getNumberValue(output, "status") ??
    getNumberValue(nestedResponse, "statusCode") ??
    getNumberValue(nestedResponse, "status") ??
    0;
  const responseTime =
    getNumberValue(output, "duration") ??
    getNumberValue(output, "responseTimeMs") ??
    getNumberValue(output, "responseTime") ??
    getNumberValue(nestedResponse, "responseTime") ??
    0;
  const contentType =
    getStringValue(getRecordValue(output, "metadata"), "contentType") ??
    getStringValue(output, "contentType") ??
    getCaseInsensitiveHeader(headers, "content-type") ??
    "";
  const body = parseJsonBodyIfNeeded(
    output.body ?? nestedResponse?.body,
    contentType,
  );
  const cookies =
    getResponseCookies(output) ?? getResponseCookies(nestedResponse);

  return {
    status,
    headers,
    body,
    responseTime,
    ...(cookies ? { cookies } : {}),
  };
};

export const createInspectorMetadata = (
  output: Record<string, unknown>,
  response: ApiResponse | null,
): NodeResultMetadata | undefined => {
  if (!response) return undefined;

  const rawMetadata = getRecordValue(output, "metadata");
  const rawBody = getRawBody(output) ?? "";
  const contentType =
    getStringValue(rawMetadata, "contentType") ??
    getStringValue(output, "contentType") ??
    getCaseInsensitiveHeader(response.headers, "content-type") ??
    "";

  return {
    responseSizeBytes:
      getNumberValue(rawMetadata, "responseSizeBytes") ??
      getNumberValue(output, "responseSizeBytes") ??
      new TextEncoder().encode(rawBody).length,
    contentType,
    bodyFormat:
      getStringValue(rawMetadata, "bodyFormat") ??
      getStringValue(output, "bodyFormat") ??
      inferBodyFormat(contentType, response.body),
    responseTimeMs:
      getNumberValue(rawMetadata, "responseTimeMs") ??
      getNumberValue(output, "responseTimeMs") ??
      getNumberValue(output, "duration") ??
      response.responseTime,
    cookieCount:
      getNumberValue(rawMetadata, "cookieCount") ??
      getNumberValue(output, "cookieCount") ??
      countCookies(output, response.headers),
    redirectCount:
      getNumberValue(rawMetadata, "redirectCount") ??
      getNumberValue(output, "redirectCount") ??
      0,
  };
};
