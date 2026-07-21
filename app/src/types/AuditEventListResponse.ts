import type { AuditEvent } from "./AuditEvent";

export interface AuditEventListResponse {
  events: AuditEvent[];
  total: number;
  skip: number;
  limit: number;
}
