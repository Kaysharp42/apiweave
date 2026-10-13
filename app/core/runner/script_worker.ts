import { parentPort } from "node:worker_threads"
import { evaluateScript, type ScriptJob, type ScriptWorkerMessage } from "./script_sandbox"

/**
 * The worker thread `runScript` evaluates scripts on, one at a time, so a
 * script that spins until its deadline stalls this thread and not the
 * caller's. Built as its own entry (dist/desktop/script-worker.cjs,
 * dist/cli/script-worker.cjs).
 *
 * `aw.crypto.uuid()` is synchronous inside the script but must come from the
 * run's own generator (the parity harness pins it), which lives on the
 * caller's thread: the worker asks for one and blocks on the job's `channel`
 * until the caller has written it there.
 */
const port = parentPort
if (port === null) throw new Error("script_worker must run as a worker thread")
const post = (message: ScriptWorkerMessage): void => port.postMessage(message)

port.on("message", ({ run, channel }: ScriptJob) => {
  const flags = new Int32Array(channel, 0, 2)
  const uuid = (): string => {
    Atomics.store(flags, 0, 0)
    post({ type: "uuid" })
    Atomics.wait(flags, 0, 0)
    return Buffer.from(new Uint8Array(channel, 8, flags[1])).toString("utf8")
  }
  const assigned: Record<string, unknown> = {}
  void evaluateScript({ ...run, uuid }, assigned).then((result) => post({ type: "done", result, assigned }))
})
