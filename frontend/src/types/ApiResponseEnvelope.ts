export interface ApiResponseEnvelope<T> {
  data: T;
  total?: number;
  skip?: number;
  limit?: number;
}
