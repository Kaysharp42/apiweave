export interface PaginatedResponse<T> {
  workflows: T[];
  total: number;
  skip: number;
  limit: number;
}
