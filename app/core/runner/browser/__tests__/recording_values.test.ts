import { describe, expect, it } from "vitest"
import { templateFill, type RecordingValues } from "../recording_values"

describe("templateFill environment matching", () => {
  const values: RecordingValues = {
    env: { PAGE_SIZE: "10", REGION: "us", THEME: "dark", TEST_EMAIL: "ada@acme.test" },
    secrets: {},
  }

  it.each(["10", "us"])("keeps the short value %j literal, however it matches the environment", (text) => {
    expect(templateFill(text, values, false)).toEqual({ kind: "value", value: text })
  })

  it("templates a value long enough that the match is no accident", () => {
    expect(templateFill("dark", values, false)).toEqual({ kind: "value", value: "{{env.THEME}}" })
    expect(templateFill("ada@acme.test", values, false)).toEqual({ kind: "value", value: "{{env.TEST_EMAIL}}" })
  })
})
