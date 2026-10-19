import { describe, expect, it, vi } from "vitest"
import { moveIntoPlace } from "../move_into_place"

function failure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation failed`), { code })
}

const NO_WAIT = [0, 0, 0]

describe("moveIntoPlace", () => {
  it.each(["EPERM", "EACCES", "EBUSY"])("retries a rename that fails with %s while the folder is held, then succeeds", async (code) => {
    const rename = vi.fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValueOnce(failure(code))
      .mockRejectedValueOnce(failure(code))
      .mockResolvedValueOnce(undefined)

    await moveIntoPlace("scratch", "target", { rename, retryDelaysMs: NO_WAIT })

    expect(rename).toHaveBeenCalledTimes(3)
    expect(rename).toHaveBeenLastCalledWith("scratch", "target")
  })

  it("gives up after its retries, saying in plain words that another program holds the files", async () => {
    const rename = vi.fn<(from: string, to: string) => Promise<void>>().mockRejectedValue(failure("EPERM"))

    const move = moveIntoPlace("C:\\clones\\.open-1", "C:\\clones\\ws-1", { rename, retryDelaysMs: NO_WAIT })

    await expect(move).rejects.toThrow(/^Another program is holding files in the downloaded repository, so it could not be moved into place\. .*try again\.$/)
    await expect(move).rejects.not.toThrow(/clones/)
    expect(rename).toHaveBeenCalledTimes(NO_WAIT.length + 1)
  })

  it("throws any other failure at once, as it is", async () => {
    const rename = vi.fn<(from: string, to: string) => Promise<void>>().mockRejectedValue(failure("ENOENT"))

    await expect(moveIntoPlace("scratch", "target", { rename, retryDelaysMs: NO_WAIT })).rejects.toThrow("ENOENT: operation failed")
    expect(rename).toHaveBeenCalledTimes(1)
  })
})
