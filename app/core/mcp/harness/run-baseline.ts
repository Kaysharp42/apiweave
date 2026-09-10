import { createMcpBaselineReport } from "./baseline"

async function main(): Promise<void> {
  const report = await createMcpBaselineReport()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

void main()
