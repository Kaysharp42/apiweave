import type { ImportedVariable } from "./ImportedVariable"

/** A parsed variables file, in file order. */
export interface VariablesFile {
  readonly format: "dotenv" | "json" | "postman"
  readonly variables: readonly ImportedVariable[]
}
