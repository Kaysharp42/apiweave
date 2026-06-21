#!/usr/bin/env node
// Pre-commit ESLint wrapper.
//
// Pre-commit invokes hooks from the repo root and passes absolute file paths,
// but ESLint 8.57.x only auto-discovers flat config (eslint.config.cjs) when
// (a) run from a directory containing the config OR
// (b) ESLINT_USE_FLAT_CONFIG=true is set.
//
// This script does both: sets the env var and re-execs ESLint with cwd=frontend/.
import { spawnSync } from "node:child_process";
import { dirname, resolve, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eslintBin = resolve(frontendDir, "node_modules/eslint/bin/eslint.js");

const args = process.argv
  .slice(2)
  .filter((arg) => {
    const abs = isAbsolute(arg) ? arg : resolve(arg);
    // Pre-commit may pass paths outside frontend/. Skip them silently.
    return abs.startsWith(frontendDir);
  })
  .map((arg) => {
    const abs = isAbsolute(arg) ? arg : resolve(arg);
    return relative(frontendDir, abs).replaceAll("\\", "/");
  });

if (args.length === 0) {
  process.exit(0);
}

const result = spawnSync(process.execPath, [eslintBin, ...args], {
  cwd: frontendDir,
  stdio: "inherit",
  env: { ...process.env, ESLINT_USE_FLAT_CONFIG: "true" },
});

process.exit(result.status ?? 1);
