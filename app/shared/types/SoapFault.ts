/** A SOAP Fault found in a response: its code and human-readable reason, when present. */
export interface SoapFault {
  readonly code?: string
  readonly reason?: string
}
