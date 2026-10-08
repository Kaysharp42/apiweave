import type { HttpRetryConfig } from "@shared/types/HttpRetryConfig";
import type { AssertionItem } from "./AssertionItem";

/** `HttpRetryConfig` with its `until` rules in the editor's string-valued form. */
export type NodeModalHttpRetryConfig = Omit<HttpRetryConfig, "until"> & {
  until?: AssertionItem[];
};
