import { z } from "zod"

/**
 * How an HTTP node's contract check behaves against its `responseSchemas`:
 * `off` skips it, `warn` records violations without failing the node, and
 * `fail` records them and fails the node.
 */
export const ContractModeSchema = z.enum(["off", "warn", "fail"])
