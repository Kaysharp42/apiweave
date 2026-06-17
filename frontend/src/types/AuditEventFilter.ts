export interface AuditEventFilter {
  actor?: string;
  action?: string;
  scope?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  skip?: number;
  limit?: number;
}
