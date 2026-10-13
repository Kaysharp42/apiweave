import { runCli } from "./cli"

// Entry point of dist/cli/apiweave.cjs. exitCode rather than exit(), so
// stdout is flushed when it is a pipe.
void runCli(process.argv.slice(2), { env: process.env, cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr }).then((code) => {
  process.exitCode = code
})
