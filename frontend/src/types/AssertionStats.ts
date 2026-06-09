export interface AssertionStats {
  passedCount: number;
  failedCount: number;
  totalCount: number;
  passed?: { index: number }[];
  failed?: { index: number; message: string }[];
}
