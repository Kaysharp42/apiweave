/** A picked file, parsed as a JSON object. */
export interface LoadedJsonFile {
  readonly name: string;
  readonly json: Record<string, unknown>;
}
