export type ContractErrorCode = "not_found" | "validation" | "conflict" | "denied"

export type ContractError = {
  readonly code: ContractErrorCode
  readonly message: string
  readonly details?: unknown
}

export type ContractResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ContractError }
