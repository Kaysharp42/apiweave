export class HarnessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
  }
}
