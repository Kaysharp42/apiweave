import { createMcpBaselineReport } from "./baseline"

// A CommonJS entry (.cts): core/db resolves better-sqlite3 with `require` and
// its migrations from `__dirname`, which an ESM entry under tsx would not have.
async function main(): Promise<void> {
  const report = await createMcpBaselineReport()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

void main()
