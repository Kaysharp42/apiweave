import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outfile = resolve("core/runner/harness/.parity-runner-bundled.mjs");

try {
  await build({
    bundle: true,
    entryPoints: [resolve("core/runner/harness/parity-runner.ts")],
    packages: "external",
    format: "esm",
    logLevel: "silent",
    outfile,
    platform: "node",
    target: "node24",
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(outfile, { force: true });
}
