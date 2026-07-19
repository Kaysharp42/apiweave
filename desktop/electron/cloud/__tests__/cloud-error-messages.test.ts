import { describe, it, expect } from "vitest"
import { RejectionReason } from "@apiweave/proto/apiweave/v1/sync_service_pb"
import { rejectionMessage, transportErrorMessage } from "../cloud-error-messages"
import { ErrCloudOffline } from "../cloud-client"

describe("cloud-error-messages", () => {
  it("maps every rejection reason to a plain sentence, never a raw code", () => {
    const reasons = [
      RejectionReason.FORBIDDEN_PAYLOAD,
      RejectionReason.WORKSPACE_NOT_FOUND,
      RejectionReason.RECORD_NOT_FOUND,
      RejectionReason.UNAUTHORIZED,
      RejectionReason.INVALID_KIND,
      RejectionReason.INTERNAL,
      RejectionReason.UNSPECIFIED,
    ]
    for (const reason of reasons) {
      const message = rejectionMessage(reason)
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toMatch(/status=|rejectionReason=|transport error:/)
      expect(message).toMatch(/[a-z]/)
    }
  })

  it("gives a distinct, actionable message for a missing cloud workspace", () => {
    expect(rejectionMessage(RejectionReason.WORKSPACE_NOT_FOUND)).toContain("Reconnect")
  })

  it("falls back to the retry message for unknown reasons", () => {
    expect(rejectionMessage(999)).toBe(rejectionMessage(RejectionReason.INTERNAL))
  })

  it("distinguishes offline from generic transport errors", () => {
    expect(transportErrorMessage(new ErrCloudOffline(new Error("net")))).toContain("online")
    const generic = transportErrorMessage(new Error("boom"))
    expect(generic).not.toMatch(/transport error:|boom/)
    expect(generic.length).toBeGreaterThan(0)
  })
})
