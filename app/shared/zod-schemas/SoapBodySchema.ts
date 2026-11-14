import { z } from "zod"

/**
 * A SOAP request (`bodyType: "soap"`). The envelope is sent as XML with the
 * Content-Type and action header the SOAP version prescribes; a SOAP Fault in
 * the response fails the node unless its status is the expected one.
 */
export const SoapBodySchema = z
  .object({
    version: z
      .enum(["1.1", "1.2"])
      .optional()
      .describe('The SOAP version: "1.1" (default) sends text/xml with a SOAPAction header, "1.2" sends application/soap+xml with the action in the Content-Type.'),
    action: z.string().optional().describe('The SOAP action (the operation\'s SOAPAction). Substituted; a SOAP 1.2 envelope usually needs it.'),
    envelope: z
      .string()
      .describe("The complete SOAP envelope as XML text, placeholders substituted. Sent as the request body; nothing is wrapped around it."),
  })
  .strict()
