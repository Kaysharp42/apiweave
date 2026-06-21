export interface ApiKeyAuthConfig {
  key: string;
  value: string;
  addTo: "header" | "query";
}
