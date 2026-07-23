import type { KeyValuePair, NodeModalHTTPRequestConfig } from "../../types";
import {
  normalizeHttpRequestConfig,
  parseKeyValuePairs,
} from "./httpRequestConfigCompat";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function activePairs(
  value: NodeModalHTTPRequestConfig["headers"],
): KeyValuePair[] {
  return parseKeyValuePairs(value).filter((pair) => pair.key.trim());
}

function appendQueryParams(url: string, pairs: KeyValuePair[]): string {
  if (pairs.length === 0) return url;

  const hashIndex = url.indexOf("#");
  const baseUrl = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const separator = baseUrl.includes("?") ? "&" : "?";
  const query = pairs
    .filter((pair) => pair.key.trim())
    .map(
      (pair) =>
        `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`,
    )
    .join("&");

  if (!query) return url;
  return `${baseUrl}${separator}${query}${hash}`;
}

function authHeaders(config: NodeModalHTTPRequestConfig): KeyValuePair[] {
  const auth = config.auth;
  if (!auth || auth.type === "none") return [];
  if (auth.type === "bearer" && auth.bearer?.token)
    return [{ key: "Authorization", value: `Bearer ${auth.bearer.token}` }];
  if (auth.type === "basic" && auth.basic)
    return [
      {
        key: "Authorization",
        value: `Basic ${btoa(`${auth.basic.username}:${auth.basic.password}`)}`,
      },
    ];
  if (auth.type === "apiKey" && auth.apiKey?.addTo === "header")
    return [{ key: auth.apiKey.key, value: auth.apiKey.value }];
  return [];
}

function authQueryParams(config: NodeModalHTTPRequestConfig): KeyValuePair[] {
  const auth = config.auth;
  if (auth?.type === "apiKey" && auth.apiKey?.addTo === "query")
    return [{ key: auth.apiKey.key, value: auth.apiKey.value }];
  return [];
}

function bodyData(config: NodeModalHTTPRequestConfig): string | undefined {
  if (config.bodyType === "none" || config.bodyType === "binary")
    return undefined;
  if (config.bodyType === "x-www-form-urlencoded") {
    const params = (config.urlEncodedEntries || [])
      .filter((entry) => entry.active && entry.key.trim())
      .map(
        (entry) =>
          `${encodeURIComponent(entry.key)}=${encodeURIComponent(entry.value)}`,
      )
      .join("&");
    return params || undefined;
  }
  if (config.bodyType === "form-data") {
    return (
      (config.formDataEntries || [])
        .filter((entry) => entry.active && entry.key.trim())
        .map((entry) => `${entry.key}=${entry.value}`)
        .join("&") || undefined
    );
  }
  return config.body || undefined;
}

export function buildCurlCommand(
  rawConfig: NodeModalHTTPRequestConfig,
): string {
  const config = normalizeHttpRequestConfig(rawConfig);
  const queryParams = [
    ...activePairs(config.queryParams),
    ...authQueryParams(config),
  ];
  const url = appendQueryParams(
    config.url || "https://api.example.com",
    queryParams,
  );
  const method = config.method || "GET";
  const headers = [...activePairs(config.headers), ...authHeaders(config)];
  const body = bodyData(config);

  const parts = ["curl", "--request", method, shellQuote(url)];
  headers.forEach((header) =>
    parts.push("--header", shellQuote(`${header.key}: ${header.value}`)),
  );
  if (body) parts.push("--data", shellQuote(body));
  if (config.sslVerify === false) parts.push("--insecure");
  if (config.followRedirects) parts.push("--location");
  return parts.join([" \\", "  "].join("\n"));
}

export function buildFetchCommand(
  rawConfig: NodeModalHTTPRequestConfig,
): string {
  const config = normalizeHttpRequestConfig(rawConfig);
  const queryParams = [
    ...activePairs(config.queryParams),
    ...authQueryParams(config),
  ];
  const url = appendQueryParams(
    config.url || "https://api.example.com",
    queryParams,
  );
  const headers = Object.fromEntries(
    [...activePairs(config.headers), ...authHeaders(config)].map((pair) => [
      pair.key,
      pair.value,
    ]),
  );
  const body = bodyData(config);
  const requestInit: Record<string, unknown> = {
    method: config.method || "GET",
    headers,
    redirect: config.followRedirects ? "follow" : "manual",
  };
  if (body) requestInit.body = body;
  return `${"fetch"}(${JSON.stringify(url)}, ${JSON.stringify(requestInit, null, 2)});`;
}
