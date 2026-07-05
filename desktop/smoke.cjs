// Render smoke test for the Electron shell. Launches the app WITHOUT sidecars
// (APIWEAVE_SKIP_SIDECARS), waits for the renderer-loaded marker main.cjs logs,
// and exits 0 on success / non-zero on failure. Confirms the shell + preload +
// app:// protocol + built frontend/dist all wire up (not a blank error page).
//
// Run locally:  node desktop/smoke.cjs   (needs frontend/dist built)
// CI runs it under xvfb; --no-sandbox because CI containers lack the SUID sandbox.
const { spawn } = require("child_process");
const electronBin = require("electron");

const args = ["."];
if (process.platform === "linux") args.push("--no-sandbox");

const child = spawn(electronBin, args, {
  cwd: __dirname,
  env: { ...process.env, APIWEAVE_SKIP_SIDECARS: "1" },
});

let out = "";
let done = false;
const finish = (msg, code) => {
  if (done) return;
  done = true;
  console.log("\n>>> " + msg);
  try { child.kill(); } catch {}
  setTimeout(() => process.exit(code), 800);
};

const scan = (d) => {
  const s = d.toString();
  out += s;
  process.stdout.write(s);
  if (out.includes("[renderer] loaded")) finish("SMOKE OK: renderer loaded", 0);
  else if (out.includes("did-fail-load") || out.includes("render-process-gone"))
    finish("SMOKE FAIL: renderer load error", 1);
};

child.stdout.on("data", scan);
child.stderr.on("data", scan);
child.on("exit", (c) => finish(`electron exited early (code ${c})`, c ? 1 : 0));
setTimeout(() => finish("SMOKE TIMEOUT: no load marker in 30s", 1), 30000);
