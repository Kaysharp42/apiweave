import type { z } from "zod"

export type ContractAction<Domain extends string = string, Action extends string = string> =
  `${Domain}.${Action}`

export type ContractSchemaEntry<
  Input extends z.ZodType = z.ZodType,
  Output extends z.ZodType = z.ZodType,
> = {
  readonly input: Input
  readonly output: Output
}

export type Contract = Record<ContractAction, ContractSchemaEntry>

export type ContractInput<Entry extends ContractSchemaEntry> = z.infer<Entry["input"]>
export type ContractOutput<Entry extends ContractSchemaEntry> = z.infer<Entry["output"]>
export type { ContractError, ContractErrorCode, ContractResult } from "./errors"
export {
  createApiweaveClient,
  type ApiweaveClient,
  type ClientMethod,
  type InvokeFn,
} from "./client"
