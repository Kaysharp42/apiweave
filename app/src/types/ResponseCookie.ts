import type { ResponseCookieAttributes } from "./ResponseCookieAttributes";

export interface ResponseCookie {
  name: string;
  value: string;
  attributes: ResponseCookieAttributes;
}
