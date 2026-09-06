import { spawn } from "node:child_process"
import process from "node:process"
import { loadEnv } from "vite"

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    })

    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`))
    })
  })
}

const localEnv = loadEnv("development", process.cwd(), "")
const developmentEnv = { ...process.env, ...localEnv }

await run(process.execPath, ["scripts/rebuild-sqlite.mjs", "electron"], developmentEnv)
await run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--mode", "development"], developmentEnv)
await run(process.execPath, ["esbuild.config.cjs"], developmentEnv)
await run(process.execPath, ["node_modules/electron/cli.js", "."], developmentEnv)
