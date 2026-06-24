import type {
  AuthConfig,
  FormDataEntry,
  HTTPRequestBodyType,
  KeyValuePair,
  NodeModalHTTPRequestConfig,
  UrlEncodedEntry,
} from "../../types";

const DEFAULT_AUTH: AuthConfig = { type: "none" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bodyToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

export function stringifyKeyValuePairs(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (isRecord(entry) && "key" in entry) {
          return `${getString(entry.key)}=${getString(entry.value)}`;
        }
        return String(entry ?? "");
      })
      .join("\n");
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([k, v]) => `${k}=${String(v ?? "")}`)
      .join("\n");
  }
  return String(value);
}

export function stringifyBody(value: unknown): string {
  return bodyToString(value);
}

export function previewBody(value: unknown, maxLength = 50): string {
  const normalized = bodyToString(value).trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

export function countKeyValuePairs(value: unknown): number {
  if (value == null) return 0;
  if (Array.isArray(value)) {
    return value.filter(
      (entry) => isRecord(entry) && getString(entry.key).trim().length > 0,
    ).length;
  }
  if (isRecord(value)) {
    return Object.keys(value).length;
  }
  if (typeof value === "string") {
    return value.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  }
  return 0;
}

export function parseKeyValuePairs(value: unknown): KeyValuePair[] {
  if (Array.isArray(value)) {
    return value.reduce<KeyValuePair[]>((pairs, entry) => {
      if (!isRecord(entry)) return pairs;
      pairs.push({ key: getString(entry.key), value: getString(entry.value) });
      return pairs;
    }, []);
  }

  if (isRecord(value)) {
    return Object.entries(value).map(([key, entryValue]) => ({
      key,
      value: String(entryValue ?? ""),
    }));
  }

  if (typeof value !== "string") return [];

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.includes("=")
        ? line.indexOf("=")
        : line.indexOf(":");
      if (separatorIndex < 0) return { key: line, value: "" };
      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      };
    });
}

export function normalizeFormDataEntries(value: unknown): FormDataEntry[] {
  if (!Array.isArray(value)) return [];

  return value.reduce<FormDataEntry[]>((entries, entry) => {
    if (!isRecord(entry)) return entries;
    const type = entry.type === "file" ? "file" : "text";
    entries.push({
      key: getString(entry.key),
      value: getString(entry.value),
      type,
      active: getBoolean(entry.active, true),
    });
    return entries;
  }, []);
}

export function normalizeUrlEncodedEntries(value: unknown): UrlEncodedEntry[] {
  if (Array.isArray(value)) {
    return value.reduce<UrlEncodedEntry[]>((entries, entry) => {
      if (!isRecord(entry)) return entries;
      entries.push({
        key: getString(entry.key),
        value: getString(entry.value),
        active: getBoolean(entry.active, true),
      });
      return entries;
    }, []);
  }

  return parseKeyValuePairs(value).map((pair) => ({ ...pair, active: true }));
}

export function normalizeAuthConfig(value: unknown): AuthConfig {
  if (!isRecord(value)) return DEFAULT_AUTH;

  const type =
    value.type === "bearer" || value.type === "basic" || value.type === "apiKey"
      ? value.type
      : "none";
  const authConfig: AuthConfig = { type };

  const bearer = isRecord(value.bearer) ? value.bearer : undefined;
  if (bearer) authConfig.bearer = { token: getString(bearer.token) };

  const basic = isRecord(value.basic) ? value.basic : undefined;
  if (basic)
    authConfig.basic = {
      username: getString(basic.username),
      password: getString(basic.password),
    };

  const apiKey = isRecord(value.apiKey) ? value.apiKey : undefined;
  if (apiKey) {
    authConfig.apiKey = {
      key: getString(apiKey.key),
      value: getString(apiKey.value),
      addTo: apiKey.addTo === "query" ? "query" : "header",
    };
  }

  return authConfig;
}

function normalizeBodyType(value: unknown): HTTPRequestBodyType {
  if (
    value === "none" ||
    value === "json" ||
    value === "raw" ||
    value === "form-data" ||
    value === "x-www-form-urlencoded" ||
    value === "binary"
  ) {
    return value;
  }

  return "json";
}

export function normalizeHttpRequestConfig(
  config: NodeModalHTTPRequestConfig,
): NodeModalHTTPRequestConfig {
  return {
    ...config,
    method: config.method || "GET",
    url: config.url || "",
    queryParams: parseKeyValuePairs(config.queryParams),
    headers: parseKeyValuePairs(config.headers),
    cookies: parseKeyValuePairs(config.cookies),
    body: bodyToString(config.body),
    bodyType: normalizeBodyType(config.bodyType),
    timeout: Math.min(Math.max(getNumber(config.timeout, 30), 1), 300),
    fileUploads: config.fileUploads || [],
    auth: normalizeAuthConfig(config.auth),
    followRedirects: getBoolean(config.followRedirects, true),
    sslVerify: getBoolean(config.sslVerify, true),
    continueOnFail: getBoolean(config.continueOnFail, false),
    formDataEntries: normalizeFormDataEntries(config.formDataEntries),
    urlEncodedEntries: normalizeUrlEncodedEntries(config.urlEncodedEntries),
  };
}

export function getPairs(
  value: NodeModalHTTPRequestConfig["headers"],
): KeyValuePair[] {
  return parseKeyValuePairs(value);
}
